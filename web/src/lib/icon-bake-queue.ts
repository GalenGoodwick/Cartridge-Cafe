/** The bake orchestrator: turns "this world's icon is missing/stale" into a
 *  stored PNG, without hammering the render-service.
 *
 *  In-process, concurrency-limited, and DEDUPED by slug — a lazy trigger from
 *  the shelf and a nightly sweep can both ask for the same world and only one
 *  bake runs. Like the slot cache, this state is per-lambda and best-effort; the
 *  heal sweep (/api/spaces/icons/heal) is the deterministic backstop. */

import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'
import { renderSnapshot, type RenderSnapshot } from './render-service'
import {
  iconSnapshotHash, iconHealth, needsBake, bakeIconRecord, iconSlotKey,
  type IconRecord, type IconHealth,
} from './icon-bake'

const MAX_CONCURRENT = 3
const inFlight = new Set<string>()
const pending: Array<() => Promise<void>> = []
let active = 0

function pump(): void {
  while (active < MAX_CONCURRENT && pending.length) {
    const job = pending.shift()!
    active++
    job().finally(() => { active--; pump() })
  }
}

/** Bake ONE world now (awaited). Loads its stored record, and only calls the eye
 *  if the icon is missing or stale for the world's current look. Returns the
 *  health it found (before any bake) so sweeps can summarize. */
export async function bakeIconIfNeeded(slug: string, snap: RenderSnapshot): Promise<IconHealth> {
  const hash = iconSnapshotHash(snap as never)
  const key = iconSlotKey(slug)
  const existing = (await loadGameSlot(key).catch(() => undefined)) as IconRecord | undefined
  const health = iconHealth(existing, hash)
  if (!needsBake(health)) return health
  const res = await bakeIconRecord(snap, hash, renderSnapshot, Date.now())
  // transient failure (eye down) → do NOT persist, so it retries next time
  if (res.ok) await saveGameSlot(key, res.record).catch(() => {})
  return health
}

/** Fire-and-forget lazy heal — queue a bake for a world the shelf just found
 *  without a healthy icon. Deduped by slug and rate-limited by MAX_CONCURRENT so
 *  a cold shelf of 200 worlds trickles through the eye instead of stampeding it. */
export function enqueueBake(slug: string, snap: RenderSnapshot): void {
  if (inFlight.has(slug)) return
  inFlight.add(slug)
  pending.push(async () => {
    try { await bakeIconIfNeeded(slug, snap) } catch { /* best-effort */ } finally { inFlight.delete(slug) }
  })
  pump()
}

export type HealSummary = { checked: number; baked: number; ok: number; black: number; skipped: number }

/** Deterministic sweep: check every given world and re-bake the unhealthy ones,
 *  bounded to MAX_CONCURRENT at a time. Used by the heal endpoint / cron. */
export async function bakeAllUnhealthy(
  worlds: Array<{ slug: string; snap: RenderSnapshot }>,
): Promise<HealSummary> {
  const summary: HealSummary = { checked: 0, baked: 0, ok: 0, black: 0, skipped: 0 }
  let i = 0
  async function worker(): Promise<void> {
    while (i < worlds.length) {
      const w = worlds[i++]
      summary.checked++
      const before = await bakeIconIfNeeded(w.slug, w.snap).catch(() => 'skipped' as const)
      if (before === 'ok') summary.ok++
      else if (before === 'black') summary.black++
      else if (before === 'missing' || before === 'stale') summary.baked++
      else summary.skipped++
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, worlds.length || 1) }, worker))
  return summary
}
