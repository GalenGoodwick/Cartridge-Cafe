// branch→fork transition — the PURE, testable core of retiring the branch
// paradigm. A branch scene is named `BASE ⑂ handle[ · label] · vN` (see
// api/engine/scene/route.ts, where branches are minted). To move every existing
// brancher into an owned fork (a private playerSpace), we parse those names,
// keep the latest version of each distinct branch line, and hand the base +
// handle to the migration so it can resolve a real owner and copy the snapshot.
//
// No DB, no I/O here — just string grammar — so it unit-tests without a runtime.

export type ParsedBranch = {
  scene: string        // the full scene name, verbatim
  base: string         // the world it was branched from (BASE, before ⑂)
  handle: string       // the brancher's handle (email local-part, sanitized)
  label: string | null // an optional human label between handle and version
  version: number      // vN
}

const SEP = ' ⑂ '   // exactly how scene/route.ts joins base and brancher

/** Parse `BASE ⑂ handle[ · label] · vN` → its parts, or null if the name is not
 *  a versioned branch scene (a plain world, a house scene, a malformed name). */
export function parseBranchScene(name: string): ParsedBranch | null {
  if (typeof name !== 'string') return null
  const i = name.indexOf(SEP)
  if (i < 0) return null
  const base = name.slice(0, i).trim()
  const rest = name.slice(i + SEP.length).trim()
  const vm = rest.match(/^(.*?)\s*·\s*v(\d+)\s*$/)
  if (!vm) return null
  const version = parseInt(vm[2], 10)
  if (!Number.isFinite(version)) return null
  const head = vm[1].trim()                    // handle[ · label]
  const parts = head.split(' · ').map(s => s.trim()).filter(Boolean)
  const handle = parts.shift() || ''
  const label = parts.length ? parts.join(' · ') : null
  if (!base || !handle) return null
  return { scene: name, base, handle, label, version }
}

/** A stable key for one branch LINE — a brancher's distinct work off a base.
 *  Different labels off the same base are different works → different forks;
 *  versions of one line collapse onto this key so only the latest is migrated. */
export function branchLineKey(p: ParsedBranch): string {
  return `${p.base}${SEP}${p.handle}${p.label ? ' · ' + p.label : ''}`
}

/** From a flat list of scene names, keep only the LATEST version of each
 *  distinct branch line (base + handle + label). Non-branch names are dropped. */
export function latestBranchPerLine(names: string[]): ParsedBranch[] {
  const best = new Map<string, ParsedBranch>()
  for (const n of names) {
    const p = parseBranchScene(n)
    if (!p) continue
    const k = branchLineKey(p)
    const cur = best.get(k)
    if (!cur || p.version > cur.version) best.set(k, p)
  }
  return [...best.values()]
}

/** The marker stamped into a migrated fork's worldData so a re-run is idempotent
 *  (find-by-marker instead of creating a twin). base + handle, never the version. */
export function branchOriginMarker(p: ParsedBranch): string {
  return `${p.base}${SEP}${p.handle}`
}

/** The fork's display name: the brancher's label if they gave one, else the base
 *  with a remix suffix. Kept ≤ 60 to match the PlayerSpace.name budget. */
export function forkNameFor(p: ParsedBranch): string {
  const raw = p.label && p.label.trim() ? p.label.trim() : `${p.base} (fork)`
  return raw.slice(0, 60)
}
