// SWARM WORK-GRAPH — the dynamic-swarm methodology, over the wire.
//
// Region claims ([[regions-store]]) coordinate many AIs carving ONE world. This
// is the other axis: building a whole multi-part SYSTEM as a graph of work-NODES.
// You predesign a MAP (nodes with a contract, dependencies, and the keys each
// owes); a pool of peer AIs works it with no dispatcher — each DOCKS an open node
// whose foundations are green, builds it, and it goes green only when the eye
// agrees. Mirrors the local substrate (cartridge-cafe/swarm/: dock/status/loop)
// so the `/swarm` skill and the bridge drive the SAME model.
//
// Green is DERIVED from KEYS, never declared. Tests are one key; a visual node
// also owes `render-verified` — and THAT evidence is written only by a
// server-run render_probe (the bridge's swarm_probe), so it cannot be faked by a
// caller asserting "it's done". Same KV as everything else (no schema):
//   swarmmap:<spaceId>  → { project, trunk, nodes: SwarmNode[], seq, updatedAt }
import { loadGameSlot, saveGameSlot } from './store'
import crypto from 'crypto'

export type NodeStatus = 'green' | 'red' | 'partial' | 'gated' | 'claimed' | 'open' | 'unknown'
export interface SwarmClaim { by: string; holder: string; at: number; ttl: number }
export interface SwarmNode {
  id: string
  area: string
  kind: string                       // selects the keys owed (see KEY_BY_KIND)
  files: string[]                    // the clobber law — one owner per file
  exports: string[]                  // this node's contract
  dependsOn: string[]                // build only on GREEN foundations
  tests: string[]                    // the referee (attested via evidence over the wire)
  status: NodeStatus
  claim: SwarmClaim | null
  evidence: Record<string, unknown>  // key → proof (unit-tested:true, render-verified:{verdict}, …)
  needsHeal?: boolean                // a foundation changed its exports — re-verify
  statusNote?: string
  // ── the game-element model (BuilderBox reads these) ──
  element?: string                   // the element's name/label ("the ship-builder screen")
  pseudocode?: string                // the orchestrator's design draft — a docking AI reads intent, not a blank file
  seed?: { from?: string; note?: string }         // pre-populated working code to refine, not rewrite
  connects?: Array<{ to: string; via: string }>   // orchestrator-indicated wiring: {to, via} = the contract that flows
  children?: SwarmNode[]             // subnodes of a complex element (parent greens only when children + own keys green)
}
export interface SwarmMap { project: string; trunk: string; nodes: SwarmNode[]; seq: number; updatedAt: number }

// keys owed by node KIND — ported from the local keys.mjs so both sides agree.
export const KEY_BY_KIND: Record<string, string[]> = {
  lib: ['unit-tested'], hook: ['unit-tested'], util: ['unit-tested'],
  mechanic: ['unit-tested', 'playthrough-confirmed'],
  puzzle: ['unit-tested', 'playthrough-confirmed'],
  collision: ['unit-tested', 'playthrough-confirmed'],
  character: ['unit-tested', 'playthrough-confirmed', 'visual-reference'],
  game: ['playthrough-confirmed'], audio: ['playthrough-confirmed'], deploy: ['playthrough-confirmed'],
  shader: ['render-verified', 'visual-reference'], render: ['render-verified', 'visual-reference'],
  ui: ['render-verified'], scene: ['render-verified'],
  tooling: ['self-hosted'], perf: ['perf-verified'],
  contracts: [], spec: [], action: [],
}
// which keys the SERVER can write itself (un-fakeable). Others are caller-attested.
export const SERVER_VERIFIED = new Set(['render-verified'])

const CLAIM_TTL = 20 * 60_000
const now = () => Date.now()
const slot = (spaceId: string) => 'swarmmap:' + spaceId
export function holderOf(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
}
/** every node, flattened depth-first (the tree may nest via `children`). */
export function allNodes(map: SwarmMap): SwarmNode[] {
  const out: SwarmNode[] = []
  const walk = (ns: SwarmNode[]) => { for (const n of ns) { out.push(n); if (n.children?.length) walk(n.children) } }
  walk(map.nodes)
  return out
}
const byId = (map: SwarmMap, id: string) => allNodes(map).find(n => n.id === id)
const liveClaim = (c: SwarmClaim | null): SwarmClaim | null => (c && c.ttl > now() ? c : null)

function keysOf(n: SwarmNode): string[] { return KEY_BY_KIND[n.kind] ?? ['unit-tested'] }

/** derive one node's status (recurses into children first, then rolls up). A
 *  parent greens only when its own keys pass AND every child is green. */
function deriveNode(n: SwarmNode): void {
  const kids = n.children ?? []
  if (kids.length) kids.forEach(deriveNode)   // post-order: children first
  if (n.needsHeal) { n.status = 'red'; n.statusNote = 'needs-heal — a foundation changed its exports; re-verify'; return }
  const keys = keysOf(n)
  const states = keys.map(k => (n.evidence?.[k] === false ? 'fail' : n.evidence?.[k] != null ? 'pass' : 'pending'))
  const keyNote = keys.length ? keys.map((k, i) => `${states[i] === 'pass' ? '✓' : states[i] === 'fail' ? '✗' : '·'}${k}`).join('  ') : ''
  const ownFail = states.includes('fail')
  const ownAllPass = keys.length === 0 || states.every(s => s === 'pass')
  const started = !!liveClaim(n.claim) || Object.keys(n.evidence || {}).length > 0
  if (kids.length) {
    const ks = kids.map(k => k.status)
    if (ownFail || ks.includes('red')) n.status = 'red'
    else if (ownAllPass && ks.every(s => s === 'green')) n.status = 'green'
    else if (liveClaim(n.claim)) n.status = 'claimed'
    else if (started || ks.some(s => ['partial', 'claimed', 'green'].includes(s))) n.status = 'partial'
    else n.status = 'open'
    n.statusNote = (keyNote ? keyNote + '  |  ' : '') + kids.map(k => k.id + '·' + k.status).join(' ')
    return
  }
  if (!keys.length) { n.status = 'green'; n.statusNote = 'no keys (contract/spec — verified by use)'; return }
  if (ownFail) n.status = 'red'
  else if (ownAllPass) n.status = 'green'
  else if (liveClaim(n.claim)) n.status = 'claimed'
  else if (started) n.status = 'partial'
  else n.status = 'open'
  n.statusNote = keyNote
}
export function deriveAll(map: SwarmMap): SwarmMap {
  for (const n of map.nodes) deriveNode(n)   // deriveNode recurses into children
  return map
}
export function depsGreen(map: SwarmMap, n: SwarmNode): boolean {
  return (n.dependsOn || []).every(d => byId(map, d)?.status === 'green')
}
/** the clobber guard: another LIVE-claimed node sharing any of this node's files. */
function fileConflict(map: SwarmMap, n: SwarmNode): SwarmNode | null {
  const mine = new Set(n.files || [])
  if (!mine.size) return null
  for (const o of allNodes(map)) {
    if (o.id === n.id) continue
    if (liveClaim(o.claim) && (o.files || []).some(f => mine.has(f))) return o
  }
  return null
}

export async function readSwarmMap(spaceId: string): Promise<SwarmMap | null> {
  const doc = (await loadGameSlot(slot(spaceId))) as SwarmMap | undefined
  if (!doc || !Array.isArray(doc.nodes)) return null
  return deriveAll(doc)
}
async function write(spaceId: string, map: SwarmMap): Promise<void> {
  map.updatedAt = now()
  await saveGameSlot(slot(spaceId), map)
}

/** PREDESIGN — set/replace the work-graph. Merges: existing claims + evidence on
 *  a node id are preserved unless the caller sends a fresh node for that id with
 *  `reset:true`. Returns the derived map + a summary. */
export async function setSwarmMap(
  spaceId: string,
  input: { project?: unknown; trunk?: unknown; nodes?: unknown; reset?: unknown },
): Promise<{ ok: boolean; map?: SwarmMap; error?: string }> {
  if (!Array.isArray(input.nodes)) return { ok: false, error: 'swarm_map needs `nodes: [...]` (the work-graph). Read the current map with swarm_map {}.' }
  const prev = (await loadGameSlot(slot(spaceId))) as SwarmMap | undefined
  // flatten the previous tree so claims + evidence survive a re-map at any depth
  const prevFlat = new Map<string, SwarmNode>()
  if (prev?.nodes) for (const n of allNodes(prev)) prevFlat.set(n.id, n)
  const arr = (v: unknown, d: string[]) => (Array.isArray(v) ? v.map(String).slice(0, 40) : d)
  const seed = (v: unknown, d: SwarmNode['seed']) => (v && typeof v === 'object'
    ? { from: String((v as Record<string, unknown>).from ?? '').slice(0, 200), note: String((v as Record<string, unknown>).note ?? '').slice(0, 400) } : d)
  const conns = (v: unknown, d: SwarmNode['connects']) => (Array.isArray(v)
    ? v.slice(0, 24).map(c => ({ to: String((c as Record<string, unknown>)?.to ?? '').slice(0, 60), via: String((c as Record<string, unknown>)?.via ?? '').slice(0, 240) })) : d)
  const build = (raw: Record<string, unknown>): SwarmNode => {
    const id = String(raw.id ?? '').trim().slice(0, 60)
    if (!id) throw new Error('every node needs an `id`')
    const keep = !input.reset ? prevFlat.get(id) : undefined
    return {
      id,
      area: String(raw.area ?? keep?.area ?? '').slice(0, 240),
      element: raw.element != null ? String(raw.element).slice(0, 200) : keep?.element,
      kind: String(raw.kind ?? keep?.kind ?? 'lib').slice(0, 24),
      pseudocode: raw.pseudocode != null ? String(raw.pseudocode).slice(0, 4000) : keep?.pseudocode,
      seed: seed(raw.seed, keep?.seed),
      connects: conns(raw.connects, keep?.connects),
      files: arr(raw.files, keep?.files ?? []),
      exports: arr(raw.exports, keep?.exports ?? []),
      dependsOn: arr(raw.dependsOn, keep?.dependsOn ?? []),
      tests: arr(raw.tests, keep?.tests ?? []),
      status: 'open',
      claim: keep?.claim ?? null,
      evidence: keep?.evidence ?? {},
      needsHeal: keep?.needsHeal,
      children: Array.isArray(raw.children) ? (raw.children as Array<Record<string, unknown>>).map(build) : keep?.children,
    }
  }
  let nodes: SwarmNode[]
  try { nodes = (input.nodes as Array<Record<string, unknown>>).map(build) }
  catch (e) { return { ok: false, error: (e as Error).message } }
  const map: SwarmMap = {
    project: String(input.project ?? prev?.project ?? 'untitled').slice(0, 80),
    trunk: String(input.trunk ?? prev?.trunk ?? 'main').slice(0, 60),
    nodes, seq: (prev?.seq ?? 0) + 1, updatedAt: now(),
  }
  deriveAll(map)
  await write(spaceId, map)
  return { ok: true, map }
}

export interface Situation {
  node: SwarmNode
  foundations: Array<{ id: string; status: NodeStatus; exports: string[] }>
  foundationsGreen: boolean
  dependents: Array<{ id: string; status: NodeStatus; open: boolean }>
  jumpTo: Array<{ id: string; area: string }>
}
function situation(map: SwarmMap, n: SwarmNode): Situation {
  const foundations = (n.dependsOn || []).map(d => byId(map, d)).filter(Boolean).map(d => ({ id: d!.id, status: d!.status, exports: d!.exports }))
  const dependents = allNodes(map).filter(x => (x.dependsOn || []).includes(n.id)).map(d => ({ id: d.id, status: d.status, open: ['open', 'partial'].includes(d.status) && !liveClaim(d.claim) }))
  return { node: n, foundations, foundationsGreen: depsGreen(map, n), dependents, jumpTo: jumpList(map, n.id) }
}
/** a node you can DOCK: a leaf (no children — dock at the file grain), foundations
 *  green, unclaimed, and no live-claimed peer shares its files (the clobber law). */
function dockable(map: SwarmMap, n: SwarmNode): boolean {
  return !(n.children && n.children.length) && !liveClaim(n.claim)
    && ['open', 'partial', 'red', 'unknown'].includes(n.status) && depsGreen(map, n) && !fileConflict(map, n)
}
function jumpList(map: SwarmMap, excludeId?: string): Array<{ id: string; area: string }> {
  return allNodes(map).filter(n => n.id !== excludeId && dockable(map, n)).map(n => ({ id: n.id, area: n.element || n.area }))
}

/** DOCK — claim an open node and get the situation. Guards: exists, foundations
 *  green, not already held by a live peer claim. */
export async function dockNode(
  spaceId: string, holder: string, who: string, nodeId: string,
): Promise<{ ok: boolean; situation?: Situation; error?: string }> {
  const map = await readSwarmMap(spaceId)
  if (!map) return { ok: false, error: 'no swarm map for this space yet — predesign it with swarm_map {project, nodes:[…]}' }
  const n = byId(map, nodeId)
  if (!n) return { ok: false, error: `no node "${nodeId}". nodes: ${map.nodes.map(x => x.id).join(', ')}` }
  const held = liveClaim(n.claim)
  if (held && held.holder !== holder) return { ok: false, error: `"${nodeId}" is docked by ${held.by} (until ${new Date(held.ttl).toISOString()}). Take another: ${jumpList(map, nodeId).map(j => j.id).join(', ') || '(none open)'}` }
  if (n.children && n.children.length) return { ok: false, error: `"${nodeId}" is a grouping element — dock one of its subnodes: ${n.children.map(c => c.id).join(', ')}` }
  if (!depsGreen(map, n)) return { ok: false, error: `"${nodeId}" foundations are not green: ${(n.dependsOn || []).map(d => `${d}=${byId(map, d)?.status ?? 'missing'}`).join(', ')} — heal one or take an open node` }
  const clash = fileConflict(map, n)
  if (clash) return { ok: false, error: `"${nodeId}" shares a file with "${clash.id}" which ${clash.claim?.by} is building — wait or take another. Files: ${(n.files || []).join(', ')}` }
  n.claim = { by: who, holder, at: held?.at ?? now(), ttl: now() + CLAIM_TTL }
  deriveAll(map)
  await write(spaceId, map)
  return { ok: true, situation: situation(map, n) }
}

/** JUMP — the next open node whose foundations are green ("no docked AI"). */
export async function jumpTarget(spaceId: string): Promise<{ ok: boolean; next?: { id: string; area: string } | null; done?: boolean; open?: Array<{ id: string; area: string }>; error?: string }> {
  const map = await readSwarmMap(spaceId)
  if (!map) return { ok: false, error: 'no swarm map yet — swarm_map {nodes:[…]} first' }
  const open = jumpList(map)
  const allGreen = allNodes(map).every(n => n.status === 'green' || n.status === 'gated')
  return { ok: true, next: open[0] ?? null, done: !open.length && allGreen, open }
}

/** RELEASE — clear your claim (optionally attach evidence in the same call). */
export async function releaseNode(
  spaceId: string, holder: string, nodeId: string, evidence?: Record<string, unknown>,
): Promise<{ ok: boolean; node?: SwarmNode; error?: string }> {
  const map = await readSwarmMap(spaceId)
  if (!map) return { ok: false, error: 'no swarm map' }
  const n = byId(map, nodeId)
  if (!n) return { ok: false, error: `no node "${nodeId}"` }
  if (evidence) for (const [k, v] of Object.entries(evidence)) {
    if (SERVER_VERIFIED.has(k)) continue   // only the server writes these (swarm_probe)
    n.evidence[k] = v
    if (v != null) n.needsHeal = false
  }
  const held = liveClaim(n.claim)
  if (held && held.holder === holder) n.claim = null
  deriveAll(map)
  await write(spaceId, map)
  return { ok: true, node: n }
}

/** attach SERVER-verified evidence (called by the bridge's swarm_probe after it
 *  runs render_probe — the un-fakeable eye). */
export async function attachServerEvidence(
  spaceId: string, nodeId: string, key: string, value: unknown,
): Promise<{ ok: boolean; node?: SwarmNode; error?: string }> {
  const map = await readSwarmMap(spaceId)
  if (!map) return { ok: false, error: 'no swarm map' }
  const n = byId(map, nodeId)
  if (!n) return { ok: false, error: `no node "${nodeId}"` }
  n.evidence[key] = value
  if (value != null && value !== false) n.needsHeal = false
  deriveAll(map)
  await write(spaceId, map)
  return { ok: true, node: n }
}

/** HEAL-WAVE — a node changed its exports; every dependent must re-verify. */
export async function healDependents(
  spaceId: string, nodeId: string,
): Promise<{ ok: boolean; healed?: string[]; error?: string }> {
  const map = await readSwarmMap(spaceId)
  if (!map) return { ok: false, error: 'no swarm map' }
  const healed: string[] = []
  for (const n of map.nodes) if ((n.dependsOn || []).includes(nodeId)) { n.needsHeal = true; healed.push(n.id) }
  deriveAll(map)
  await write(spaceId, map)
  return { ok: true, healed }
}

export function mapSummary(map: SwarmMap): { project: string; done: number; total: number; nodes: NodeView[] } {
  const flat = allNodes(map)
  return {
    project: map.project,
    done: flat.filter(n => n.status === 'green').length,   // counts leaves + groupings that rolled up green
    total: flat.length,
    nodes: map.nodes.map(nodeView),
  }
}
export interface NodeView {
  id: string; element: string; kind: string; status: NodeStatus; claim: string | null; note?: string
  pseudocode?: string; seed?: SwarmNode['seed']; connects?: SwarmNode['connects']; children?: NodeView[]
}
function nodeView(n: SwarmNode): NodeView {
  return {
    id: n.id, element: n.element || n.area, kind: n.kind, status: n.status,
    claim: liveClaim(n.claim)?.by ?? null, note: n.statusNote,
    pseudocode: n.pseudocode, seed: n.seed, connects: n.connects,
    children: n.children?.length ? n.children.map(nodeView) : undefined,
  }
}
