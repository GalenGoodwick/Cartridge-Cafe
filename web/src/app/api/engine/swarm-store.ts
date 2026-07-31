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
const byId = (map: SwarmMap, id: string) => map.nodes.find(n => n.id === id)
const liveClaim = (c: SwarmClaim | null): SwarmClaim | null => (c && c.ttl > now() ? c : null)

function keysOf(n: SwarmNode): string[] { return KEY_BY_KIND[n.kind] ?? ['unit-tested'] }

/** derive one node's status from its keys' evidence (deps handled separately). */
function deriveNode(n: SwarmNode): void {
  if (n.needsHeal) { n.status = 'red'; n.statusNote = 'needs-heal — a foundation changed its exports; re-verify'; return }
  const keys = keysOf(n)
  if (!keys.length) { n.status = 'green'; n.statusNote = 'no keys (contract/spec — verified by use)'; return }
  const states = keys.map(k => (n.evidence?.[k] === false ? 'fail' : n.evidence?.[k] != null ? 'pass' : 'pending'))
  const note = keys.map((k, i) => `${states[i] === 'pass' ? '✓' : states[i] === 'fail' ? '✗' : '·'}${k}`).join('  ')
  const started = !!liveClaim(n.claim) || Object.keys(n.evidence || {}).length > 0
  if (states.includes('fail')) n.status = 'red'
  else if (states.every(s => s === 'pass')) n.status = 'green'
  else if (liveClaim(n.claim)) n.status = 'claimed'
  else if (started) n.status = 'partial'
  else n.status = 'open'
  n.statusNote = note
}
export function deriveAll(map: SwarmMap): SwarmMap {
  for (const n of map.nodes) deriveNode(n)
  return map
}
export function depsGreen(map: SwarmMap, n: SwarmNode): boolean {
  return (n.dependsOn || []).every(d => byId(map, d)?.status === 'green')
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
  const prevById = new Map((prev?.nodes || []).map(n => [n.id, n]))
  const nodes: SwarmNode[] = []
  for (const raw of input.nodes as Array<Record<string, unknown>>) {
    const id = String(raw.id ?? '').trim().slice(0, 60)
    if (!id) return { ok: false, error: 'every node needs an `id`' }
    const keep = !input.reset ? prevById.get(id) : undefined
    nodes.push({
      id,
      area: String(raw.area ?? keep?.area ?? '').slice(0, 200),
      kind: String(raw.kind ?? keep?.kind ?? 'lib').slice(0, 24),
      files: Array.isArray(raw.files) ? raw.files.map(String).slice(0, 40) : keep?.files ?? [],
      exports: Array.isArray(raw.exports) ? raw.exports.map(String).slice(0, 40) : keep?.exports ?? [],
      dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String).slice(0, 40) : keep?.dependsOn ?? [],
      tests: Array.isArray(raw.tests) ? raw.tests.map(String).slice(0, 40) : keep?.tests ?? [],
      status: 'open',
      claim: keep?.claim ?? null,
      evidence: keep?.evidence ?? {},
      needsHeal: keep?.needsHeal,
    })
  }
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
  const dependents = map.nodes.filter(x => (x.dependsOn || []).includes(n.id)).map(d => ({ id: d.id, status: d.status, open: ['open', 'partial'].includes(d.status) && !liveClaim(d.claim) }))
  return { node: n, foundations, foundationsGreen: depsGreen(map, n), dependents, jumpTo: jumpList(map, n.id) }
}
function jumpList(map: SwarmMap, excludeId?: string): Array<{ id: string; area: string }> {
  return map.nodes
    .filter(n => n.id !== excludeId && !liveClaim(n.claim) && ['open', 'partial', 'red', 'unknown'].includes(n.status) && depsGreen(map, n))
    .map(n => ({ id: n.id, area: n.area }))
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
  if (!depsGreen(map, n)) return { ok: false, error: `"${nodeId}" foundations are not green: ${(n.dependsOn || []).map(d => `${d}=${byId(map, d)?.status ?? 'missing'}`).join(', ')} — heal one or take an open node` }
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
  const allGreen = map.nodes.every(n => n.status === 'green' || n.status === 'gated')
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

export function mapSummary(map: SwarmMap): { project: string; done: number; total: number; nodes: Array<{ id: string; status: NodeStatus; kind: string; claim: string | null; note?: string }> } {
  return {
    project: map.project,
    done: map.nodes.filter(n => n.status === 'green').length,
    total: map.nodes.length,
    nodes: map.nodes.map(n => ({ id: n.id, status: n.status, kind: n.kind, claim: liveClaim(n.claim)?.by ?? null, note: n.statusNote })),
  }
}
