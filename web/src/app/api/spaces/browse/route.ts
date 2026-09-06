import { NextResponse } from 'next/server'
import { iconSlotKey } from '@/lib/icon-bake'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { composeIcon, dominantHue, IconField } from '@/lib/icon-compose'
import { handleOf } from '@/lib/notify'
import { loadGameSlot } from '../../engine/store'
import { cached } from '@/lib/ttl-cache'

export const dynamic = 'force-dynamic'

// The hub blocks its first paint on this feed, and it's expensive (pulls up to
// 200 full snapshots + composes an icon per row + a directory rollup). Recompute
// at most once per window PER VISITOR-CLASS instead of once per visitor: anon
// callers all share the public list; each signed-in uid gets its own (it also
// carries their private worlds). Staleness is bounded by BROWSE_TTL_MS.
const BROWSE_TTL_MS = 20_000

/** GET /api/spaces/browse — Public worlds gallery; signed-in callers also see
 *  their own private/blank worlds (fuel for the MY WORLDS submain) */
export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null)
  const uid = session?.user?.id
  const payload = await cached('browse', uid || 'anon', BROWSE_TTL_MS, () => build(uid))
  // ANON responses are one shared payload — let the CDN absorb the hub's 30s
  // loop (scalability audit: this feed was the site's single biggest faucet)
  return NextResponse.json(payload, uid ? undefined : { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } })
}

async function build(uid: string | undefined) {
  const spaces = await prisma.playerSpace.findMany({
    where: uid ? { OR: [{ isPublic: true }, { ownerId: uid }] } : { isPublic: true },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isPublic: true,
      updatedAt: true,
      owner: { select: { id: true, name: true, image: true, email: true } },
      forkOf: { select: { slug: true, name: true } },
      _count: { select: { versions: true, forks: true, flags: true } },
      snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  // a world is BLANK until it holds something; only unblank worlds join the door
  const out = await Promise.all(spaces.map(async ({ snapshot, ...rest }) => {
    const sn = snapshot as { fields?: IconField[]; stepHooks?: unknown[]; visualTypes?: Array<{ name?: string; wgsl?: string }>; modules?: Array<{ name?: string; wgsl?: string }>; worldData?: { icon_wgsl?: unknown; creation_brief?: unknown; brief_done?: unknown; __bridge_rev?: unknown } } | null
    const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
    // still being built by an AI: a creation_brief was set but never finished.
    // Such a world is "stuck in AI is working" and must NOT surface on main.
    const building = !!(sn?.worldData?.creation_brief) && !(sn?.worldData?.brief_done)
    const hue = sn?.fields?.length ? dominantHue(sn.fields) : null
    // bespoke icon (MAKE ICON) wins; else the world's own composed visual; else
    // (null) the door falls back to the color emblem.
    // the baked PHOTO wins in the client atlas anyway — when one exists, the
    // composed shader is dead weight (audit: iconWgsl was 95% of this payload,
    // one world's compose was 265KB). Bespoke MAKE-ICON shaders still ship.
    const baked = await loadGameSlot(iconSlotKey(rest.slug)).catch(() => null) as { png_b64?: string } | null
    const iconWgsl = (baked?.png_b64 && !sn?.worldData?.icon_wgsl)
      ? null
      : composeIcon(sn?.fields || [], sn?.visualTypes || [], sn?.worldData?.icon_wgsl, sn?.modules || [])
    // owner, resolved to a maker handle for the PLAYER WORLDS directory. A guest
    // account (@guest.cartridge.cafe) is UNCLAIMED — those worlds belong to the
    // house until someone signs up and claims them. Never leak the raw email.
    const email = rest.owner?.email || ''
    const isGuest = /@guest\.cartridge\.cafe$/i.test(email) || !email
    const owner = rest.owner ? { id: rest.owner.id, name: rest.owner.name, image: rest.owner.image, handle: isGuest ? null : handleOf(email), isGuest } : null
    // rev = REAL builder edits only (__bridge_rev bumps per key-authed bridge
    // batch). updatedAt bumps on ANY row write (owner-tab sync, icon bake,
    // save states) — keying "reworked" on it made idle worlds cry rework.
    return { ...rest, owner, blank, building, hue, iconWgsl, rev: Number(sn?.worldData?.__bridge_rev) || 0 }
  }))

  // MAKERS directory — one entry per player who has a real (non-blank) world,
  // carrying their BREWED ICON (avatar) so the PLAYER WORLDS bubbles wear it.
  const makerIds = new Map<string, { handle: string; name: string; worldHue: number | null }>()
  for (const s of out) {
    if (s.blank || s.building || s.isPublic === false) continue
    const o = s.owner
    if (!o || !o.handle || o.isGuest) continue
    if (!makerIds.has(o.id)) makerIds.set(o.id, { handle: o.handle, name: o.name || o.handle, worldHue: s.hue })
  }
  // canonical (house/AI-made) worlds can be ATTRIBUTED to a maker — a single
  // slot maps SCENE NAME → { handle, name }. Attributed worlds leave the house
  // and count toward that maker (who then appears in the directory even with no
  // player spaces of their own).
  const sceneMakers = ((await loadGameSlot('scene-makers').catch(() => null)) || {}) as Record<string, { handle: string; name?: string; hue?: number }>
  const makerRows = new Map(makerIds)
  for (const nm of Object.keys(sceneMakers)) {
    const a = sceneMakers[nm]
    if (!a?.handle) continue
    if (![...makerRows.values()].some(m => m.handle === a.handle)) {
      makerRows.set('scene:' + a.handle, { handle: a.handle, name: a.name || a.handle, worldHue: a.hue ?? null })
    }
  }
  const makers = await Promise.all([...makerRows.entries()].map(async ([key, m]) => {
    const uid = key.startsWith('scene:') ? null : key
    const icon = uid ? ((await loadGameSlot('player-icon:' + uid).catch(() => null)) as { fx?: number; hue?: number; size?: number } | null) : null
    return { handle: m.handle, name: m.name, hue: (typeof icon?.hue === 'number' ? icon.hue : m.worldHue), fx: typeof icon?.fx === 'number' ? icon.fx : null }
  }))

  return { spaces: out, makers, sceneMakers }
}
