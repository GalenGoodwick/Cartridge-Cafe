// Gameplay primitives — a PALETTE the AI draws from, not a form it must fill.
// A universal environment (zen garden, music visualizer, ambient world) draws
// NONE: no win condition, no lose condition, no requirement imposed. A game draws
// the ones that fit. Each primitive carries three things:
//   · summary   — what it is (for the AI + the guide)
//   · codeHint  — the drawable implementation seed (like a built-in visual is real
//                 WGSL, a primitive is real hook logic the AI composes)
//   · acceptance — the check that drawing it IMPLIES, so completion is verified
//                 from what the world actually drew, never from hand-declared
//                 requirements (item 3).

import type { AcceptanceCheck, GamePrimitive, GamePrimitiveKind } from '@/lib/build-spec'

export interface GamePrimitiveDef {
  kind: GamePrimitiveKind
  summary: string
  /** recognized param names (for docs / the MCP schema) */
  params: string[]
  /** the acceptance check(s) drawing this primitive implies */
  acceptance: (p: GamePrimitive) => AcceptanceCheck[]
  /** a hook-code seed the AI composes into its step hook */
  codeHint: (p: GamePrimitive) => string
}

const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const q = (s: unknown) => (typeof s === 'string' && s.trim() ? ` (${s.trim()})` : '')

const DEFS: GamePrimitiveDef[] = [
  {
    kind: 'scoring',
    summary: 'a running score the player grows by acting',
    params: ['start', 'per'],
    acceptance: p => [{ id: 'p-score', description: `score increases${p.per ? ` when ${p.per}` : ' as the player acts'}`, verification: 'playthrough' }],
    codeHint: p => `wd.__score = wd.__score ?? ${n(p.start, 0)};   // then: wd.__score++ ${p.per ? `when ${p.per}` : 'on a scoring action'}`,
  },
  {
    kind: 'lives',
    summary: 'a finite number of lives; running out can end the run',
    params: ['start'],
    acceptance: p => [{ id: 'p-lives', description: `losing a life decrements from ${n(p.start, 3)}; reaching 0 ends the run`, verification: 'playthrough' }],
    codeHint: p => `wd.__lives = wd.__lives ?? ${n(p.start, 3)};   // on a miss: if (--wd.__lives <= 0) wd.__over = true`,
  },
  {
    kind: 'timer',
    summary: 'elapsed / remaining time',
    params: ['seconds', 'when'],
    acceptance: p => [{ id: 'p-timer', description: `a timer ${p.when === 'down' ? 'counts down' : 'counts'}${p.target ? ` from ${p.target}` : ''}`, verification: 'playthrough' }],
    codeHint: p => p.when === 'down'
      ? `wd.__time = wd.__time ?? ${n(p.seconds, n(p.target, 60))}; wd.__time = Math.max(0, wd.__time - dt);`
      : `wd.__time = (wd.__time || 0) + dt;`,
  },
  {
    kind: 'waves',
    summary: 'discrete waves the player clears in sequence',
    params: ['target'],
    acceptance: p => [{ id: 'p-waves', description: `waves advance${p.target ? ` toward ${p.target}` : ''}`, verification: 'playthrough' }],
    codeHint: p => `wd.__wave = wd.__wave ?? 1;   // advance when a wave clears: wd.__wave++${p.target ? ` (win at ${p.target})` : ''}`,
  },
  {
    kind: 'spawner',
    summary: 'entities that appear over time',
    params: ['note'],
    acceptance: () => [{ id: 'p-spawn', description: 'entities spawn over time', verification: 'playthrough' }],
    codeHint: p => `// spawn on a cadence: accumulate dt, then push a field/entity${q(p.note)}`,
  },
  {
    kind: 'collectible',
    summary: 'things the player gathers',
    params: ['note'],
    acceptance: () => [{ id: 'p-collect', description: 'collectibles can be picked up', verification: 'playthrough' }],
    codeHint: p => `// on overlap with a collectible: remove it + reward${q(p.note)}`,
  },
  {
    kind: 'checkpoint',
    summary: 'progress that survives a restart',
    params: ['note'],
    acceptance: () => [{ id: 'p-checkpoint', description: 'progress persists past a checkpoint on restart', verification: 'playthrough' }],
    codeHint: () => `wd.__resets = wd.__resets || []; // keep checkpoint keys OUT of __resets so they survive`,
  },
  {
    kind: 'progression',
    summary: 'the world changes as play continues (difficulty, unlocks, mood)',
    params: ['note'],
    acceptance: p => [{ id: 'p-progression', description: `the world changes over${q(p.note) || ' play'}`, verification: 'human' }],
    codeHint: p => `// scale something by progress${q(p.note)} (speed, spawn rate, palette)`,
  },
  {
    kind: 'winCondition',
    summary: 'a terminal WIN — reaching it ends the run successfully',
    params: ['when', 'target', 'note'],
    acceptance: p => [{ id: 'p-win', description: `reaching the win condition${winWhen(p)} ends the run as a WIN`, verification: 'playthrough' }],
    codeHint: p => `if (${winExpr(p)}) { wd.__over = 'win'; }`,
  },
  {
    kind: 'loseCondition',
    summary: 'a terminal LOSE — reaching it ends the run',
    params: ['when', 'note'],
    acceptance: p => [{ id: 'p-lose', description: `the lose condition${loseWhen(p)} ends the run`, verification: 'playthrough' }],
    codeHint: p => `if (${loseExpr(p)}) { wd.__over = 'lose'; }`,
  },
]

function winWhen(p: GamePrimitive): string {
  if (!p.when) return p.note ? ` (${p.note})` : ''
  const t = p.target != null ? ` ${p.target}` : ''
  return ` (${p.when}${t})`
}
function loseWhen(p: GamePrimitive): string {
  if (!p.when) return p.note ? ` (${p.note})` : ''
  return ` (${p.when})`
}
function winExpr(p: GamePrimitive): string {
  switch (p.when) {
    case 'reachScore': return `(wd.__score||0) >= ${n(p.target, 100)}`
    case 'survive': return `(wd.__time||0) >= ${n(p.target, 60)}`
    case 'clearWaves': return `(wd.__wave||1) > ${n(p.target, 5)}`
    default: return `/* ${p.when || p.note || 'win check'} */ false`
  }
}
function loseExpr(p: GamePrimitive): string {
  switch (p.when) {
    case 'livesZero': return `(wd.__lives||0) <= 0`
    case 'timeout': return `(wd.__time||0) <= 0`
    default: return `/* ${p.when || p.note || 'lose check'} */ false`
  }
}

export const GAME_PRIMITIVES: Record<string, GamePrimitiveDef> = Object.fromEntries(DEFS.map(d => [d.kind, d]))
export const GAME_PRIMITIVE_KINDS: GamePrimitiveKind[] = DEFS.map(d => d.kind)

const KNOWN_PARAMS = ['when', 'target', 'start', 'per', 'seconds', 'count', 'note'] as const

/** Validate + clamp a raw primitives list: drop unknown kinds, keep known params. */
export function normalizeGamePrimitives(raw: unknown): GamePrimitive[] {
  if (!Array.isArray(raw)) return []
  const out: GamePrimitive[] = []
  for (const item of raw.slice(0, 24)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind = o.kind as GamePrimitiveKind
    if (!GAME_PRIMITIVES[kind]) continue
    const prim = { kind } as GamePrimitive
    const w = prim as Record<string, unknown>
    for (const k of KNOWN_PARAMS) {
      const v = o[k]
      if (typeof v === 'number' && Number.isFinite(v)) w[k] = v
      else if (typeof v === 'string' && v.trim()) w[k] = v.slice(0, 400)
    }
    out.push(prim)
  }
  return out
}

/** The acceptance checks a set of drawn primitives IMPLIES. Universal worlds draw
 *  none → this returns [] → no requirement to satisfy. */
export function acceptanceFromPrimitives(prims: GamePrimitive[] | undefined): AcceptanceCheck[] {
  if (!prims?.length) return []
  const out: AcceptanceCheck[] = []
  const seen = new Set<string>()
  for (const p of prims) {
    const def = GAME_PRIMITIVES[p.kind]
    if (!def) continue
    for (const c of def.acceptance(p)) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}
