import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadGameSlot } from '../../engine/store'
import { iconSnapshotHash, iconHealth, needsBake, iconSlotKey, type IconRecord } from '@/lib/icon-bake'
import { enqueueBake } from '@/lib/icon-bake-queue'

export const dynamic = 'force-dynamic'

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
      enqueueBake(s.slug, sn as never)
    }
  })

  return NextResponse.json({ icons }, { headers: { 'Cache-Control': 'no-store' } })
}
