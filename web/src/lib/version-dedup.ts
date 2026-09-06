// NO IDENTICAL SAVE POINTS (Galen, Sep 5: "dont let a point be saved if it is
// identical to something that exists so no spamming"). ONE law, three doors —
// the save-point POST, the pre-restore auto-save, and the flag freeze all ask
// this helper instead of hand-rolling the compare. Identity is BYTE identity
// (JSON.stringify): key order counts, which is correct here because every
// candidate snapshot comes from the same serializer over the same live row.

type Versionish = { version: number; snapshot: unknown }

/** The existing version whose snapshot is byte-identical to `current`, or null.
 *  O(n) stringify — callers fetch versions newest-first so the common spam case
 *  (re-saving the state just saved) matches on the first compare. */
export function findIdenticalVersion<V extends Versionish>(versions: V[], current: unknown): V | null {
  const cur = JSON.stringify(current)
  for (const v of versions) {
    if (JSON.stringify(v.snapshot) === cur) return v
  }
  return null
}
