// PHASE DOCKS (DESIGN-phase-docks.md) — the universal gate tree as code.
// Focus is geometry: dock a phase → only its verbs work + its packet serves;
// undock → its escape gate must be TRUE. Two PROCESSES share one tree:
//   CREATION: forward is earned phase by phase (P0→P8; TEND has no exit).
//   EDIT (world has shipped / been ready before): dock ANY phase directly —
//     a targeted re-entry — but leaving still requires that phase's gate,
//     and downstream evidence is stale by revision-pinning anyway.

export type PhaseId =
  | 'vision' | 'imagine' | 'frame' | 'space' | 'look' | 'ui'
  | 'behavior' | 'tune' | 'proof' | 'ship' | 'tend'

export const PHASE_ORDER: PhaseId[] = [
  'vision', 'imagine', 'frame', 'space', 'look', 'ui', 'behavior', 'tune', 'proof', 'ship', 'tend',
]

/** verbs usable in EVERY phase (reading, navigation, the dock verbs themselves) */
const ALWAYS = new Set([
  'help', 'describe', 'read_guide', 'build_status', 'validate_world', 'list_fields',
  'dock_phase', 'undock_phase', 'node_history', 'triage',
])

/** phase → verb families (names from the ONE command registry). A verb not in
 *  the docked phase's set (nor ALWAYS) is refused with the teaching line. */
export const PHASE_VERBS: Record<PhaseId, string[]> = {
  vision: ['set_world_data', 'build_spec_set'],
  // IMAGINE — the AI's dream phase (the 'imaginatively' pillar): raw dream →
  // checkable layered vision. Writing verbs only; no geometry exists yet.
  imagine: ['set_world_data'],
  frame: ['set_world_params', 'set_world_data', 'create_field', 'set_shape', 'move_field', 'delete_field'],
  space: ['create_field', 'set_shape', 'move_field', 'delete_field', 'clone_field', 'add_tag', 'remove_tag', 'set_world_data'],
  look: ['define_visual', 'set_visual', 'undo_visual', 'define_module', 'remove_module', 'define_sheet', 'define_track', 'set_world_data', 'set_card_shot'],
  ui: ['set_world_data'],
  behavior: ['add_step_hook', 'update_step_hook', 'remove_step_hook', 'claim_node', 'release_node', 'dock_node', 'undock_node', 'node_revert', 'register_node', 'remove_node', 'set_world_data'],
  tune: ['update_step_hook', 'claim_node', 'dock_node', 'undock_node', 'set_world_params', 'set_world_data'],
  proof: ['complete_build', 'set_world_data'],
  ship: ['publish_world', 'set_world_data', 'set_card_shot'],
  tend: ['update_step_hook', 'claim_node', 'dock_node', 'undock_node', 'define_visual', 'set_visual', 'set_world_data', 'complete_build'],
}

/** phase → the check names that must be TRUE (passed at current revision)
 *  to undock forward. Reuses the existing evidence machinery verbatim. */
export const PHASE_GATES: Record<PhaseId, string[]> = {
  vision: ['vision-declared'],
  imagine: ['imagine-declared'],
  frame: ['frame-declared'],
  space: ['shader-compile'],            // fields shaped + no non-defining visuals
  // LOOK exits on the LAYER truth (machine-checkable) — the MOTH lesson:
  // a backdrop cannot be human-judged until BEHAVIOR animates it, so the
  // human visual-gate stays REQUIRED for completion (evaluator) but no
  // longer deadlocks the walk here.
  look: ['render-frame', 'shader-compile'],
  ui: ['ui-health'],
  behavior: ['hook-syntax'],
  tune: ['input-response'],             // a real play happened + responded
  proof: ['performance', 'no-live-bugs?', 'triage-complete?'],   // ? = only when applicable
  ship: [],                              // ship's gate is the publish machinery + the human word
  tend: [],                              // no exit — only re-entry
}

export interface PhaseState {
  id: PhaseId
  mode: 'creation' | 'edit'
  dockedAt: number
  /** phases whose gates have been passed (creation walk) */
  passed: PhaseId[]
}

export interface Snapshotish {
  worldData?: Record<string, unknown> | null
}

export function phaseOf(snap: Snapshotish): PhaseState | null {
  const p = snap.worldData?.['__phase'] as PhaseState | undefined
  return p && PHASE_ORDER.includes(p.id) ? p : null
}

/** EDIT mode belongs to a world that has ever been ready/shipped — a fix
 *  docks straight into the phase it touches. A fresh world walks CREATION. */
export function processOf(snap: Snapshotish): 'creation' | 'edit' {
  const wd = snap.worldData ?? {}
  return (wd['brief_done'] === true || wd['__build'] && (wd['__build'] as { readyRevision?: string }).readyRevision)
    ? 'edit' : 'creation'
}

export function canDock(target: PhaseId, snap: Snapshotish): { ok: boolean; error?: string } {
  if (!PHASE_ORDER.includes(target)) return { ok: false, error: `unknown phase "${target}" — the tree: ${PHASE_ORDER.join(' → ')}` }
  const mode = processOf(snap)
  if (mode === 'edit') return { ok: true }   // targeted re-entry: any phase, directly
  const cur = phaseOf(snap)
  // earned progress survives undock: between docks the passed list parks in
  // __phasePassed (the Neo walk found canDock ignoring it — every undock
  // silently reset the creation to VISION)
  const parked = snap.worldData?.['__phasePassed'] as PhaseId[] | undefined
  const passed = cur?.passed ?? (Array.isArray(parked) ? parked : [])
  const idx = PHASE_ORDER.indexOf(target)
  // creation: may dock any phase already passed (backward is free) or the
  // NEXT unearned one — never skip ahead of an unpassed gate
  const nextUnearned = PHASE_ORDER.find(p => !passed.includes(p)) ?? 'tend'
  if (idx <= PHASE_ORDER.indexOf(nextUnearned)) return { ok: true }
  return { ok: false, error: `creation earns forward: "${nextUnearned}" is not passed yet — dock_phase {id:"${nextUnearned}"} and satisfy its gate first (${(PHASE_GATES[nextUnearned] ?? []).join(', ') || 'human word'})` }
}

export function verbAllowed(verb: string, snap: Snapshotish): { ok: boolean; error?: string } {
  const cur = phaseOf(snap)
  if (!cur) return { ok: true }   // phase docks are OPT-IN: undocked worlds keep every existing flow
  if (ALWAYS.has(verb)) return { ok: true }
  if ((PHASE_VERBS[cur.id] ?? []).includes(verb)) return { ok: true }
  const home = PHASE_ORDER.find(p => (PHASE_VERBS[p] ?? []).includes(verb))
  return { ok: false, error: `wrong phase — you are docked in ${cur.id.toUpperCase()}; "${verb}" lives in ${home ? home.toUpperCase() : 'no phase (always-on or unknown)'}. undock_phase (gate must be true) or dock the right phase.` }
}

/** the escape gate: which of this phase's checks are UNTRUE right now.
 *  evidence = latest-per-check at the current revision (existing machinery);
 *  extra server facts passed in for the cheap structural gates. */
export function gateUntrue(
  phase: PhaseId,
  evidence: Map<string, { status: string }>,
  facts: { visionDeclared?: boolean; imagineDeclared?: boolean; frameDeclared?: boolean; rectNoDevice?: boolean; uiHealthy?: boolean; dockstar?: boolean; liveBugStamp?: boolean },
): string[] {
  const untrue: string[] = []
  for (const raw of PHASE_GATES[phase] ?? []) {
    const optional = raw.endsWith('?')
    const check = optional ? raw.slice(0, -1) : raw
    if (check === 'vision-declared') { if (!facts.visionDeclared) untrue.push('vision-declared: worldData.vision + spec must exist before any field'); continue }
    if (check === 'imagine-declared') { if (!facts.imagineDeclared) untrue.push('imagine-declared: worldData.imagine must carry the RAW dream + ≥3 named layers (palette/atmosphere/motion/audio/hero-moment) — specific, never generic'); continue }
    if (check === 'frame-declared') {
      if (!facts.frameDeclared) untrue.push('frame-declared: gridW/gridH must be set')
      // THE FRAMING GATE (Galen, Sep 16): a declared-RECT world (gridW≠gridH,
      // i.e. portrait/landscape, not a classic square) MUST carry deviceConfig
      // or the grid frames it as desktop and cover-crops it to a zoomed band —
      // the exact bug that reached a human because the square eye can't see
      // aspect-crop. Pure data, no render: catch it here, before completion.
      else if (facts.rectNoDevice) untrue.push('framing: this world declares a non-square grid (portrait/landscape) but has no deviceConfig — set_world_params {params:{deviceConfig:"mobile"|"desktop"}} or the grid cover-crops it to a zoomed band on the wrong aspect')
      continue
    }
    if (check === 'ui-health') { if (facts.uiHealthy === false) untrue.push('ui-health: solver warnings outstanding (empty boxes / off-band anchors)'); continue }
    if (optional && check === 'triage-complete' && !facts.dockstar) continue
    if (optional && check === 'no-live-bugs' && !facts.liveBugStamp) continue
    const e = evidence.get(check)
    if (e?.status !== 'passed') untrue.push(`${check}: ${e ? e.status : 'missing'}`)
  }
  return untrue
}

/** PULL BINDING (Neo stage 1) — node records in worldData.__nodes may declare
 *  { kind: 'room'|'profile'|'entity'|'event'|'fact'|'spine', uses: [ids] }.
 *  ROOMS CALL; PROFILES ANSWER. A profile pulled by nothing is INERT and
 *  surfaces as a leftover; a use naming a missing node is a broken call.
 *  Push has no grammar here — there is no appliesTo. */
export interface BindingVerdict {
  ok: boolean
  /** profiles no room/entity pulls — inert, visible, never silent */
  inert: string[]
  /** uses that name a node which does not exist */
  broken: string[]
  rooms: string[]
  profiles: string[]
}
export function checkBindings(snap: Snapshotish): BindingVerdict | null {
  const nodes = snap.worldData?.['__nodes'] as Record<string, { kind?: string; uses?: string[] }> | undefined
  if (!nodes || typeof nodes !== 'object') return null
  const ids = Object.keys(nodes)
  const kinds = new Map(ids.map(id => [id, String(nodes[id]?.kind ?? '')]))
  const rooms = ids.filter(id => kinds.get(id) === 'room')
  const profiles = ids.filter(id => kinds.get(id) === 'profile')
  if (!rooms.length && !profiles.length) return null   // grammar not in use — opt-in
  const pulled = new Set<string>()
  const broken: string[] = []
  for (const id of ids) {
    for (const u of nodes[id]?.uses ?? []) {
      if (!ids.includes(u)) broken.push(`${id} → ${u} (no such node)`)
      else pulled.add(u)
    }
  }
  const inert = profiles.filter(p2 => !pulled.has(p2))
  return { ok: inert.length === 0 && broken.length === 0, inert, broken, rooms, profiles }
}
