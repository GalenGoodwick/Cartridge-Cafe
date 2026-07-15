// Lineage records — the spine of king-of-the-hill world promotion.
//
// A "lineage" is a world + all its branches, keyed by BASE (the name before
// ' ⑂ '). One record per lineage, stored as a save-slot `lineage:<BASE>` in the
// same KV store as tournaments (see DESIGN-branch-promotion.md).
//
// `original`  — the immortal root's launch target (a scene name, or "space:<slug>").
//               Never changes; the original can never be deleted.
// `mainHolder`— whoever currently holds the throne (defaults to original). A branch
//               that wins the arena swaps in here; main renders it UNDER the BASE.
import { loadGameSlot, saveGameSlot } from './store'

export type Lineage = {
  base: string
  original: string
  mainHolder: string
  reignSince: number
  history: { holder: string; at: number }[]
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
  const now = Date.now()
  const lin: Lineage = {
    base: base.trim().toUpperCase(),
    original: originalLaunch,
    mainHolder: originalLaunch,
    reignSince: now,
    history: [],
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

/** Crown a new throne-holder for a lineage. The tournament — not edit access —
 *  drives this: when the world arena's champion settles, the winning scene swaps
 *  in here and main renders it under the base. The original never changes and can
 *  reclaim the throne by winning again. No-op if `holder` already reigns. */
export async function setMainHolder(base: string, holder: string): Promise<Lineage | null> {
  const lin = await getLineage(base)
  if (!lin || !holder || lin.mainHolder === holder) return lin
  const now = Date.now()
  lin.history = [...(lin.history || []), { holder: lin.mainHolder, at: lin.reignSince || now }].slice(-50)
  lin.mainHolder = holder
  lin.reignSince = now
  await saveGameSlot(slotOf(base), lin)
  return lin
}
