import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadGameSlot } from '../../engine/store'
import { iconSnapshotHash, iconHealth, needsBake, iconSlotKey, type IconRecord } from '@/lib/icon-bake'
import { enqueueBake } from '@/lib/icon-bake-queue'
import { cached } from '@/lib/ttl-cache'

export const dynamic = 'force-dynamic'

// Twin of browse: the hub also blocks on this icon feed, and it likewise pulls
// up to 200 snapshots + hashes each + reads every icon slot. Same per-visitor-
// class cache. Lazy bake is OFF on prod (ICON_LAZY_BAKE), so the only side effect
// a cache hit skips is the enqueue — which the heal sweep covers anyway.
const ICONS_TTL_MS = 20_000

type Snap = {
  fields?: unknown[]
  stepHooks?: unknown[]
  visualTypes?: unknown[]
  modules?: unknown[]
  worldData?: { creation_brief?: unknown; brief_done?: unknown } & Record<string, unknown>
} | null

/** GET /api/spaces/icons — the UNIFIED shelf-icon feed. For each world we hold a
 *  photographed frame (baked by the eye) in slot `world_icon:<slug>`. Healthy,
 *  current icons are returned as base64 PNGs the door decodes straight into its
 *  atlas; anything missing or stale is lazily queued for a bake and shows its
 *  shader/emblem placeholder (from browse) until the real icon lands next visit.
 *  Session-aware like browse: signed-in callers also get their own worlds. */
export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null)
  const uid = session?.user?.id
  const icons = await cached('icons', uid || 'anon', ICONS_TTL_MS, () => build(uid))
  return NextResponse.json({ icons }, { headers: { 'Cache-Control': uid ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300' } })   // anon = one shared payload; CDN absorbs (audit)
}

async function build(uid: string | undefined) {
  const spaces = await prisma.playerSpace.findMany({
    where: uid ? { OR: [{ isPublic: true }, { ownerId: uid }] } : { isPublic: true },
    select: { slug: true, name: true, snapshot: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })

  // photograph-ready worlds only (skip blanks and half-built drafts)
  const ready = spaces
    .map(s => ({ s, sn: s.snapshot as Snap }))
    .filter(({ sn }) => {
      const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
      if (blank) return false
      if (sn?.worldData?.creation_brief && !sn?.worldData?.brief_done) return false
      return true
    })
    .map(({ s, sn }) => ({ s, sn, hash: iconSnapshotHash(sn as never) }))

  // read every icon record in parallel — one round-trip's worth, not 200 serial
  const records = await Promise.all(
    ready.map(({ s }) => loadGameSlot(iconSlotKey(s.slug)).catch(() => undefined) as Promise<IconRecord | undefined>),
  )

  const icons: { name: string; hash: string; png: string }[] = []
  ready.forEach(({ s, sn, hash }, i) => {
    const health = iconHealth(records[i], hash)
    if (health === 'ok' && records[i]?.png_b64) {
      icons.push({ name: (s.name || s.slug).toUpperCase(), hash, png: records[i]!.png_b64! })
    } else if (needsBake(health)) {
      // self-heal: queue it (deduped, rate-limited). 'black' worlds are left alone.
      // LAZY BAKE IS OFF BY DEFAULT: on prod the per-lambda concurrency cap does
      // NOT bound total load across Vercel's many instances, so bake-on-visit lets
      // ordinary traffic stampede the (small software-GPU) eye and OOM it. Baking
      // is a CONTROLLED op — the heal sweep + publish hook. Flip ICON_LAZY_BAKE=1
      // only once there's a GLOBAL rate limit.
      if (process.env.ICON_LAZY_BAKE === '1') enqueueBake(s.slug, sn as never)
    }
  })

  return icons
}
