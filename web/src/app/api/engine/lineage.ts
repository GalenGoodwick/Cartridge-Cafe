// Lineage records — a world + all its branches, keyed by BASE (the name before
// ' ⑂ '). One record per lineage, stored as a save-slot `lineage:<BASE>` in the
// same KV store as scenes.
//
// `original` — the immortal root's launch target (a scene name, or "space:<slug>").
//              Never changes; the original can never be deleted.
//
// NOTE: the king-of-the-hill "throne" (mainHolder / setMainHolder — a branch
// swapping in as what main serves) was REMOVED when the tournament was pulled
// from worlds (nothing legitimately crowns a holder anymore). Main always serves
// the original. Lineage now only tracks the immortal root for the delete guards
// and branch bookkeeping.
import { loadGameSlot, saveGameSlot } from './store'

export type Lineage = {
  base: string
  original: string
}

const slotOf = (base: string) => 'lineage:' + base.trim().toUpperCase()

export async function getLineage(base: string): Promise<Lineage | null> {
  const d = await loadGameSlot(slotOf(base))
  return d && typeof d === 'object' ? (d as Lineage) : null
}

/** Ensure a lineage record exists for `base`, stamping `original` the FIRST time
 *  (i.e. the first branch ever created off this world). `originalLaunch` is what
 *  main launches for the root today — a scene BASE name, or "space:<slug>". */
export async function ensureLineage(base: string, originalLaunch: string): Promise<Lineage> {
  const existing = await getLineage(base)
  if (existing) return existing
  const lin: Lineage = {
    base: base.trim().toUpperCase(),
    original: originalLaunch,
  }
  await saveGameSlot(slotOf(base), lin)
  return lin
}

/** True if `launch` is the immortal original of ANY known lineage keyed by `base`.
 *  Used by the delete guards to refuse removing a root. */
export async function isOriginal(base: string, launch: string): Promise<boolean> {
  const lin = await getLineage(base)
  return !!lin && lin.original === launch
}
