// BASE MANIFEST (base-matrix P2) — the teardown map a subtraction-first base
// carries in worldData.baseManifest. The manifest IS the AI's carving guide:
// every node/field/visual/module in the base appears here with its role, its
// removability, its dependents, and a carve hint. The conformance check makes
// drift impossible — a manifest that lies about the snapshot goes red.

export type BaseKind = 'hook' | 'field' | 'visual' | 'module'

export interface BaseManifestEntry {
  kind: BaseKind
  /** hookId / fieldId / visual name / module name */
  id: string
  role: string
  /** true = carve freely · 'load-bearing' = the world breaks without it */
  removable: boolean | 'load-bearing'
  /** entries that must be removed WITH this one (they depend on it) */
  deps?: string[]
  carveHint?: string
}

export interface BaseManifest {
  v: 1
  cell: string            // e.g. '2d-mobile'
  entries: BaseManifestEntry[]
}

export interface SnapshotIds {
  hooks: string[]
  fields: string[]
  visuals: string[]
  modules: string[]
}

export function snapshotIds(snap: {
  stepHooks?: Array<{ hookId?: string; id?: string }>
  fields?: Array<{ id?: string; name?: string }>
  visualTypes?: Array<{ name?: string }>
  modules?: Array<{ name?: string }>
}): SnapshotIds {
  return {
    hooks: (snap.stepHooks ?? []).map(h => String(h.hookId ?? h.id ?? '')).filter(Boolean),
    fields: (snap.fields ?? []).map(f => String(f.id ?? f.name ?? '')).filter(Boolean),
    visuals: (snap.visualTypes ?? []).map(v => String(v.name ?? '')).filter(Boolean),
    modules: (snap.modules ?? []).map(m => String(m.name ?? '')).filter(Boolean),
  }
}

export interface Conformance {
  ok: boolean
  /** in the snapshot but not the manifest — the map is missing territory */
  unmapped: string[]
  /** in the manifest but not the snapshot — the map claims ghosts */
  ghosts: string[]
  /** deps that reference entries which don't exist */
  badDeps: string[]
  loadBearing: string[]
  removable: string[]
}

const key = (kind: BaseKind, id: string) => `${kind}:${id}`

export function checkConformance(ids: SnapshotIds, manifest: BaseManifest): Conformance {
  const mapped = new Set(manifest.entries.map(e => key(e.kind, e.id)))
  const real = new Set<string>([
    ...ids.hooks.map(h => key('hook', h)),
    ...ids.fields.map(f => key('field', f)),
    ...ids.visuals.map(v => key('visual', v)),
    ...ids.modules.map(m => key('module', m)),
  ])
  const unmapped = [...real].filter(k => !mapped.has(k))
  const ghosts = [...mapped].filter(k => !real.has(k))
  const entryIds = new Set(manifest.entries.map(e => e.id))
  const badDeps: string[] = []
  for (const e of manifest.entries) for (const d of e.deps ?? []) {
    if (!entryIds.has(d)) badDeps.push(`${e.id} → ${d}`)
  }
  return {
    ok: unmapped.length === 0 && ghosts.length === 0 && badDeps.length === 0,
    unmapped, ghosts, badDeps,
    loadBearing: manifest.entries.filter(e => e.removable === 'load-bearing').map(e => e.id),
    removable: manifest.entries.filter(e => e.removable === true).map(e => e.id),
  }
}

/** everything that must go when `id` goes: the entry + transitive dependents */
export function carveSet(manifest: BaseManifest, id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const e of manifest.entries) {
      if (out.has(e.id)) continue
      if ((e.deps ?? []).some(d => out.has(d))) { out.add(e.id); grew = true }
    }
  }
  return out
}

/** P4 — LOAD-BEARING TEETH. The carve verbs consult this before removing:
 *  a load-bearing target refuses (with the manifest's own carve hint) unless
 *  the carver says force. Worlds without a manifest are untouched. */
export function checkBaseCarve(
  manifest: BaseManifest | undefined | null,
  kind: BaseKind,
  id: string,
  force?: boolean,
): { refused: true; error: string } | null {
  if (!manifest?.entries || force) return null
  const e = manifest.entries.find(e => e.kind === kind && e.id === id)
  if (!e || e.removable !== 'load-bearing') return null
  return { refused: true, error:
    `"${id}" is LOAD-BEARING in this base (${e.role}) — removing it breaks the world.` +
    (e.carveHint ? ` ${e.carveHint}.` : '') +
    ` If you truly mean it, resend with {"force": true}.` }
}
