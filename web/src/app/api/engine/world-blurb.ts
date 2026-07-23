// THE AI WRITES ITS OWN WORLD'S HOOK — Galen, Jul 23: "the AI writes its own
// world description when it makes the game." When a world finishes (brief_done),
// the AI that built it is best placed to write the one-line pitch: it knows what
// it made. That blurb becomes the share preview, the gallery card, the search
// snippet, the fuel for social posts — every world turns into shareable content.
//
// It lands in TWO places: worldData.blurb (the durable record) and — if empty —
// PlayerSpace.description, which generateMetadata already reads. So the OG/share
// card improves with ZERO metadata-code change.
import { callClaude } from '@/lib/claude'
import { prisma } from '@/lib/prisma'
import { getSpaceSnapshot, applyCommandToSnapshot } from './space-store'

const SYS = `You write the one-line HOOK for a little AI-built game world — the tagline shown when someone shares it or sees it on a shelf. Rules: ONE sentence, at most 140 characters. Concrete and evocative — name what the player DOES or SEES, not "a world where...". No quotes, no emoji, no "explore/discover/immerse", no marketing fluff. Make a stranger want to click and play. Reply with ONLY the sentence.`

/** Best-effort: generate + store the world's shareable hook. Never throws. */
export async function writeWorldBlurb(spaceId: string): Promise<void> {
  try {
    const snap = await getSpaceSnapshot(spaceId)
    if (!snap) return
    const wd = (snap.worldData ?? {}) as Record<string, unknown>
    if (typeof wd.blurb === 'string' && (wd.blurb as string).trim()) return   // already written

    const sp = await prisma.playerSpace.findUnique({ where: { id: spaceId }, select: { name: true, description: true } })
    const brief = (wd.creation_brief as { prompt?: string } | undefined)?.prompt
    const instr = typeof wd.instructions === 'string' ? wd.instructions : ''
    const elements = (snap.fields ?? [])
      .map((f) => (f as { name?: string }).name)
      .filter((n): n is string => !!n && n.length > 0)
      .slice(0, 14)

    const context = [
      `World name: ${sp?.name || 'untitled'}`,
      brief ? `The maker asked for: ${brief}` : null,
      instr ? `Instructions: ${instr.replace(/\s+/g, ' ').slice(0, 300)}` : null,
      elements.length ? `Things in it: ${elements.join(', ')}` : null,
    ].filter(Boolean).join('\n')

    const raw = await callClaude(SYS, [{ role: 'user', content: context }], 'haiku', 80)
    const blurb = raw.trim().replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 180)
    if (!blurb) return

    await applyCommandToSnapshot(spaceId, { type: 'set_world_data', data: { blurb } })
    if (!sp?.description) {
      await prisma.playerSpace.updateMany({ where: { id: spaceId, description: null }, data: { description: blurb } }).catch(() => {})
    }
  } catch {
    // the hook is a courtesy — a failed blurb must never fail a build's finish
  }
}
