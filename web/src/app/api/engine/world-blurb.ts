// THE BUILDER WRITES ITS OWN WORLD'S HOOK — Galen, Jul 23: "the daemon should be
// writing blurbs." The AI that builds a world is already an AI, already there,
// already spending its OWN tokens, and it knows exactly what it made — so it
// sets worldData.blurb (a one-line shareable hook) as part of finishing, the
// same way it must write worldData.instructions. See the AI guide.
//
// This does NOT call any AI. It just MIRRORS the builder's blurb into
// PlayerSpace.description (which generateMetadata already reads) so the share
// card / shelf caption uses it — and only when the maker left the description
// blank. Zero platform AI cost; nothing to do with AI_DISABLED.
import { prisma } from '@/lib/prisma'
import { getSpaceSnapshot } from './space-store'

export async function mirrorWorldBlurb(spaceId: string): Promise<void> {
  try {
    const snap = await getSpaceSnapshot(spaceId)
    const raw = (snap?.worldData as { blurb?: unknown } | undefined)?.blurb
    if (typeof raw !== 'string' || !raw.trim()) return                 // builder wrote none — fine
    const blurb = raw.replace(/\s+/g, ' ').trim().slice(0, 180)
    const sp = await prisma.playerSpace.findUnique({ where: { id: spaceId }, select: { description: true } })
    if (sp && !sp.description) {                                       // never clobber a maker's own words
      await prisma.playerSpace.updateMany({ where: { id: spaceId, description: null }, data: { description: blurb } }).catch(() => {})
    }
  } catch (e) {
    console.error('[world-blurb] mirror failed:', e instanceof Error ? e.message : e)
  }
}
