import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { getSpaceSnapshot, setSpaceSnapshot } from '../../engine/space-store'
import { readTypeRegistry } from '../../engine/cards-registry'
import { normalizeTypeId, type CardType } from '@/lib/cards'

export const dynamic = 'force-dynamic'

/** BACKFILL CARD TYPES — no card left typeless (MAP.cards: backfill-types).
 *  Every public world without a valid worldData.card gets one, classified from
 *  the words the world already carries (vision/blurb/name/instructions) against
 *  the registry vocabulary. Keyword heuristics now; an AI classifier can raise
 *  confidence later. GET = dry run (the plan, writes nothing) · POST {confirm}
 *  = execute idempotently. Uncertain worlds default to 'toy' and are FLAGGED
 *  for curation, never silently confident. Admin only. */

/** Signals beyond the type labels themselves — the vocabulary each type answers
 *  to in the wild. Extend freely; ties break toward the higher score then the
 *  earlier registry entry. Exported PURE for the unit tests. */
const SIGNALS: Record<string, string[]> = {
  'platformer': ['platform', 'jump', 'side-scroll', 'sidescroll', 'gravity', 'runner', 'bounce', 'fling'],
  'action-dungeon': ['dungeon', 'crawl', 'rooms', 'loot', 'monster', 'demon', 'sword', 'lair'],
  'shooter': ['shoot', 'gun', 'bullet', 'fps', 'aim', 'weapon', 'blast'],
  'puzzle': ['puzzle', 'riddle', 'solve', 'logic', 'match', 'unlock', 'keyhole', 'mystery'],
  'adventure': ['adventure', 'explore', 'journey', 'island', 'quest', 'story', 'discover'],
  'arcade': ['arcade', 'score', 'combo', 'pinball', 'high score', 'wave'],
  'racer': ['race', 'racing', 'lap', 'speed', 'drift', 'kart'],
  'tactics': ['tactic', 'strategy', 'turn-based', 'battle', 'army', 'command'],
  'sandbox': ['sandbox', 'build anything', 'creative', 'free play', 'playground'],
  'toy': ['toy', 'fidget', 'relax', 'ambient', 'vibe', 'screensaver'],
  'builder': ['builder', 'craft', 'assemble', 'construct', 'factory', 'forge'],
  'sim': ['sim', 'simulation', 'ecosystem', 'physics', 'fluid', 'weather', 'colony'],
  'arena': ['arena', 'multiplayer', 'versus', 'pvp', 'deathmatch', 'io game'],
  'co-op': ['co-op', 'coop', 'together', 'cooperative'],
  'rhythm': ['rhythm', 'music', 'beat', 'song', 'melody'],
  'horror': ['horror', 'scary', 'dread', 'dark ritual', 'nightmare'],
  'narrative': ['narrative', 'tale', 'dialogue', 'visual novel', 'chapters'],
  'sports': ['sport', 'ball game', 'soccer', 'golf', 'basketball'],
  'tower defense': ['tower defense', 'towers', 'waves of enemies', 'defend the'],
  'roguelike': ['roguelike', 'roguelite', 'permadeath', 'procedural run'],
}

/** Classify a world's type from its own words. PURE — exported for tests.
 *  Returns the registry id + whether the pick is confident (any signal hit)
 *  or the uncertain default ('toy', flagged for curation). */
export function classifyType(
  words: string,
  registry: CardType[],
): { type: string; confident: boolean } {
  const hay = words.toLowerCase()
  let best: { id: string; score: number } | null = null
  for (const t of registry) {
    const keys = [t.label, ...(SIGNALS[t.id] ?? SIGNALS[t.label] ?? [])]
    let score = 0
    for (const k of keys) if (k && hay.includes(k)) score += k.length > 4 ? 2 : 1
    if (score > 0 && (!best || score > best.score)) best = { id: t.id, score }
  }
  if (best) return { type: best.id, confident: best.score >= 2 }
  const fallback = registry.some(t => t.id === 'toy') ? 'toy' : (registry[0]?.id ?? 'toy')
  return { type: fallback, confident: false }
}

type PlanItem = { slug: string; type: string; confident: boolean; already?: true }

async function buildPlan() {
  const registry = (await readTypeRegistry()).types
  const validIds = new Set(registry.map(t => t.id))
  const spaces = await prisma.playerSpace.findMany({
    where: { isPublic: true },
    select: { id: true, slug: true, name: true, snapshot: true },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  const items: Array<PlanItem & { id: string }> = []
  for (const s of spaces) {
    const wd = (s.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData || {}
    const cur = wd.card as { type?: unknown } | undefined
    if (cur && typeof cur.type === 'string' && validIds.has(normalizeTypeId(cur.type))) {
      items.push({ id: s.id, slug: s.slug, type: normalizeTypeId(cur.type), confident: true, already: true })
      continue
    }
    const words = [s.name, wd.blurb, wd.vision, wd.instructions, wd.creation_brief && (wd.creation_brief as { prompt?: string }).prompt]
      .filter((x): x is string => typeof x === 'string').join(' \n ')
    items.push({ id: s.id, slug: s.slug, ...classifyType(words, registry) })
  }
  return items
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const items = await buildPlan()
  const todo = items.filter(i => !i.already)
  return NextResponse.json({
    dryRun: true,
    scanned: items.length,
    alreadyTyped: items.length - todo.length,
    willType: todo.length,
    uncertain: todo.filter(i => !i.confident).map(i => i.slug),
    plan: todo.map(({ slug, type, confident }) => ({ slug, type, confident })),
  })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const body = await req.json().catch(() => null) as { confirm?: boolean } | null
  if (!body?.confirm) return NextResponse.json({ error: 'pass { confirm: true } — GET first for the dry-run plan' }, { status: 400 })
  const items = await buildPlan()
  let typed = 0
  const failed: string[] = []
  for (const it of items) {
    if (it.already) continue
    try {
      // through the store (cache + persist + __bridge_rev bump riding the next
      // snapshot write) — mirrors handleSetCard's path without a world token
      const snap = await getSpaceSnapshot(it.id, true)
      if (!snap) { failed.push(it.slug); continue }
      const wd = (snap.worldData ?? {}) as Record<string, unknown>
      wd.card = { type: it.type, tags: Array.isArray((wd.card as { tags?: unknown } | undefined)?.tags) ? (wd.card as { tags: string[] }).tags : [] }
      wd.__bridge_rev = (Number(wd.__bridge_rev) || 0) + 1
      snap.worldData = wd
      await setSpaceSnapshot(it.id, snap)
      typed++
    } catch { failed.push(it.slug) }
  }
  return NextResponse.json({ ok: true, typed, failed, uncertainFlagged: items.filter(i => !i.already && !i.confident).map(i => ({ slug: i.slug, defaulted: i.type })) })
}
