import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { composeIcon, dominantHue, IconField } from '@/lib/icon-compose'
import { handleOf } from '@/lib/notify'
import { loadGameSlot } from '../../engine/store'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/browse — Public worlds gallery; signed-in callers also see
 *  their own private/blank worlds (fuel for the MY WORLDS submain) */
export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null)
  const uid = session?.user?.id
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
  const out = spaces.map(({ snapshot, ...rest }) => {
    const sn = snapshot as { fields?: IconField[]; stepHooks?: unknown[]; visualTypes?: Array<{ name?: string; wgsl?: string }>; modules?: Array<{ name?: string; wgsl?: string }>; worldData?: { icon_wgsl?: unknown; creation_brief?: unknown; brief_done?: unknown } } | null
    const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
    // still being built by an AI: a creation_brief was set but never finished.
    // Such a world is "stuck in AI is working" and must NOT surface on main.
    const building = !!(sn?.worldData?.creation_brief) && !(sn?.worldData?.brief_done)
    const hue = sn?.fields?.length ? dominantHue(sn.fields) : null
    // bespoke icon (MAKE ICON) wins; else the world's own composed visual; else
    // (null) the door falls back to the color emblem.
    const iconWgsl = composeIcon(sn?.fields || [], sn?.visualTypes || [], sn?.worldData?.icon_wgsl, sn?.modules || [])
    // owner, resolved to a maker handle for the PLAYER WORLDS directory. A guest
    // account (@guest.cartridge.cafe) is UNCLAIMED — those worlds belong to the
    // house until someone signs up and claims them. Never leak the raw email.
    const email = rest.owner?.email || ''
    const isGuest = /@guest\.cartridge\.cafe$/i.test(email) || !email
    const owner = rest.owner ? { id: rest.owner.id, name: rest.owner.name, image: rest.owner.image, handle: isGuest ? null : handleOf(email), isGuest } : null
    return { ...rest, owner, blank, building, hue, iconWgsl }
  })

  // each space wears its OWNER's brewed icon on the bubble (attribution — see
  // whose world is whose): load the owner's player-icon (fx preset + hue) once
  // per owner and attach it to their spaces.
  const ownerIds = [...new Set(out.map(s => s.owner?.id).filter(Boolean))] as string[]
  const ownerIcons = new Map<string, { fx?: number; hue?: number }>()
  await Promise.all(ownerIds.map(async (oid) => {
    const ic = (await loadGameSlot('player-icon:' + oid).catch(() => null)) as { fx?: number; hue?: number } | null
    if (ic) ownerIcons.set(oid, ic)
  }))
  for (const s of out) {
    const ic = s.owner?.id ? ownerIcons.get(s.owner.id) : null
    ;(s as unknown as { ownerFx: number | null; ownerHue: number | null }).ownerFx = typeof ic?.fx === 'number' ? ic.fx : null
    ;(s as unknown as { ownerFx: number | null; ownerHue: number | null }).ownerHue = typeof ic?.hue === 'number' ? ic.hue : null
  }

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

  return NextResponse.json({ spaces: out, makers, sceneMakers })
}
