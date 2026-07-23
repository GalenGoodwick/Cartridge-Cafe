// THE AI WRITES ITS OWN WORLD'S HOOK — Galen, Jul 23. When a world finishes
// (brief_done), the AI that built it writes the one-line pitch. It lands in
// worldData.blurb + seeds PlayerSpace.description (if blank) — which
// generateMetadata already reads, so shares improve with zero metadata change.
// No-ops cleanly when server-side AI is off (AI_DISABLED=1); fires the moment
// AI is enabled.
import { callClaude } from '@/lib/claude'
import { prisma } from '@/lib/prisma'
import { getSpaceSnapshot, applyCommandToSnapshot } from './space-store'

const SYS = `You write the one-line HOOK for a little AI-built game world — the tagline shown when someone shares it or sees it on a shelf. Rules: ONE sentence, at most 140 characters. Concrete and evocative — name what the player DOES or SEES, not "a world where...". No quotes, no emoji, no "explore/discover/immerse", no marketing fluff. Make a stranger want to click and play. Reply with ONLY the sentence.`

export async function writeWorldBlurb(spaceId: string): Promise<void> {
  try {
    if (process.env.AI_DISABLED === '1') return
    const snap = await getSpaceSnapshot(spaceId)
    if (!snap) return
    const wd = (snap.worldData ?? {}) as Record<string, unknown>
    if (typeof wd.blurb === 'string' && (wd.blurb as string).trim()) return

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
  } catch (e) {
    console.error('[world-blurb] failed:', e instanceof Error ? e.message : e)
  }
}
