// THE COMMAND REGISTRY — one source for every bridge verb's contract (item 4/#6
// of the reliability program). Before this, a command's params lived in FOUR
// places that drifted independently: space-store's KNOWN_PARAMS whitelist (the
// enforced truth), bridge-help's hand-written CONTRACTS cards, the MCP zod
// schemas, and the guide's examples. Real drift found at the seam: the
// create_field help card taught `position {x,y,z}` + `id` while the whitelist
// accepts `x, y, fieldId` (the card's own example silently dropped its position);
// the add_step_hook card taught a `(state, dt, worldData, api)` hook signature
// while the sandbox compiles `(sim, dt)`; the create_world card said `name` only
// after the door was widened to the full BuildSpec.
//
// Now: space-store derives its enforcement whitelist from here (knownParams()),
// bridge-help derives its groups and cards from here (verbGroups() /
// contractCard()), and CI conformance tests pin the MCP schemas and the guide's
// JSON examples against this file. Edit a contract HERE; the surfaces follow.

export type CommandScope =
  | 'space'   // needs a uc_st_ world token (build commands)
  | 'player'  // needs a uc_pt_ player key (create_world / use_world / wallet)
  | 'owner'   // space-scoped AND owner-key only
  | 'any'     // any authorized bridge caller (commons, help)

export interface CommandSpec {
  /** param name → terse description. 'type' is implicit on every command.
   *  Suffix '?' in the DESCRIPTION (not the key) marks optional. */
  params?: Record<string, string>
  /** params are the ENFORCED whitelist (space-store warns on unknown keys).
   *  Only the historically-enforced set carries this — extending enforcement
   *  to more verbs is a deliberate follow-up, not a side effect. */
  enforce?: boolean
  scope: CommandScope
  group: string
  desc: string
  example?: Record<string, unknown>
  law?: string
  /** guide section for read_guide */
  guide?: string
}

const G = {
  nodes: 'build (nodes law)',
  visuals: 'visuals & shaders',
  fields: 'fields',
  world: 'world doc',
  fx: 'effects & interactions',
  sprites: 'sprites',
  account: 'worlds & account',
  verify: 'verify (your eyes)',
  lifecycle: 'build lifecycle (evidence)',
  commons: 'the commons & swarm',
} as const

export const COMMAND_REGISTRY: Record<string, CommandSpec> = {
  // ── build (nodes law) ──
  add_step_hook: {
    scope: 'space', group: G.nodes,
    desc: 'add/replace a step hook (a NODE) — one small job per hook',
    params: { hookId: 'NEW id, yours (same id replaces)', code: 'JS body — runs as (sim, dt); state lives in sim.worldData', author: 'attribution?', description: 'what this node does?', order: 'lower runs first?' },
    example: { type: 'add_step_hook', hookId: 'my-enemies', code: 'const wd = sim.worldData; /* one small job */', order: 50 },
    law: 'one small hook per job, NEVER a monolith; the engine stamps the node to YOU and rejects writes to nodes you do not hold',
    guide: 'build-in-nodes',
  },
  update_step_hook: {
    scope: 'space', group: G.nodes,
    desc: 'replace the body of a hook you hold',
    params: { hookId: 'one you hold', code: 'full replacement body — runs as (sim, dt)' },
    example: { type: 'update_step_hook', hookId: 'my-enemies', code: '/* new body */' },
    law: 'claim_node {id} first if your claim lapsed; foreign nodes are refused',
  },
  remove_step_hook: { scope: 'space', group: G.nodes, desc: 'remove a hook node (holder/owner)' },
  claim_node: {
    scope: 'space', group: G.nodes, desc: 'take or refresh the hold on a node',
    params: { id: 'hookId — auto-creates the node record if absent' },
    example: { type: 'claim_node', id: 'my-enemies' },
    law: 'holds are PER-NODE and go stale after 15 idle minutes; a push refreshes yours. Done? release_node. Hopping? release_node A + claim_node B (or dock_node B).',
  },
  release_node: {
    scope: 'space', group: G.nodes, desc: 'give up your hold so another builder may take the node (holder-only)',
    params: { id: 'the node' }, example: { type: 'release_node', id: 'my-enemies' },
  },
  dock_node: {
    scope: 'space', group: G.nodes, desc: 'the co-build unit of work: hold + record + version history + current code in one call',
    params: { id: 'the node' }, example: { type: 'dock_node', id: 'my-enemies' },
    law: 'work it, then undock_node {id, code, note} to SUBMIT (new version, hold released) or undock_node {id} to abandon',
  },
  undock_node: {
    scope: 'space', group: G.nodes, desc: 'submit (with code) or abandon (without) a docked node; releases the hold',
    params: { id: 'the node', code: 'final body — submits through the push gate?', note: 'version note?' },
    example: { type: 'undock_node', id: 'my-enemies', code: '/* final body */', note: 'volcano parallax' },
  },
  node_revert: {
    scope: 'space', group: G.nodes, desc: 'roll a node back down its version history',
    params: { id: 'the node', rev: 'target revision? (default: previous)' },
    example: { type: 'node_revert', id: 'my-enemies' },
  },
  node_history: { scope: 'space', group: G.nodes, desc: "a node's version chain" },
  register_node: {
    scope: 'space', group: G.nodes, enforce: true,
    desc: 'declare a non-hook node + its owned uniform lanes',
    params: { id: 'node id', node: 'record — owns? {uni: [[start,end]…]} = your gpuUniforms lanes' },
    example: { type: 'register_node', id: 'my-fx', node: { owns: { uni: [[40, 47]] } } },
    law: 'overlapping a declared lane is rejected — declare BEFORE writing packed uniforms',
  },
  remove_node: { scope: 'space', group: G.nodes, enforce: true, desc: 'remove a node record', params: { id: 'the node' } },

  // ── visuals & shaders ──
  define_visual: {
    scope: 'space', group: G.visuals, enforce: true,
    desc: 'register a WGSL visual a field can wear — for a CUSTOM look (built-ins need no define)',
    params: { name: 'visual name', wgsl: 'fn visual_<name>(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f' },
    example: { type: 'define_visual', name: 'ember-glow', wgsl: 'fn visual_ember_glow(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f { return col; }' },
    law: 'each layer its OWN superimposed field, not one mega-shader; verify with render_probe after EVERY change. Common looks are BUILT-IN (solid/glow/circle/ring/pulse/…) — no define needed.',
    guide: 'visuals',
  },
  set_visual: {
    scope: 'space', group: G.visuals, enforce: true,
    desc: "bind a visual (built-in or defined) to a field",
    params: { fieldId: 'the field', visualType: 'built-in name (solid/glow/…) or your define_visual name', visualParams: '[p.x,p.y,p.z,p.w] shader params?', renderTarget: 'draw into a named target?', sampleTargets: 'targets this visual samples?', renderOrder: 'paint order — higher paints above?' },
    example: { type: 'set_visual', fieldId: 'ember', visualType: 'glow' },
  },
  undo_visual: { scope: 'space', group: G.visuals, desc: "revert a visual to its previous landed version" },
  define_module: {
    scope: 'space', group: G.visuals, enforce: true,
    desc: 'shared WGSL helper fns — persists with the world; use for bodies too big for one visual',
    params: { name: 'module name', wgsl: 'helper fns' },
    example: { type: 'define_module', name: 'noise-lib', wgsl: 'fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9, 78.2))) * 43758.5); }' },
  },
  remove_module: { scope: 'space', group: G.visuals, enforce: true, desc: 'remove a module', params: { name: 'module name' } },
  register_glsl_mod: { scope: 'space', group: G.visuals, desc: 'LEGACY global-store only — use define_module instead (persists with your world)' },
  register_wgsl_mod: { scope: 'space', group: G.visuals, desc: 'LEGACY global-store only — use define_module instead (persists with your world)' },
  remove_glsl_mod: { scope: 'space', group: G.visuals, desc: 'remove a legacy global mod' },
  create_render_target: {
    scope: 'space', group: G.visuals, enforce: true,
    desc: 'allocate a named offscreen buffer visuals can draw into / sample',
    params: { name: 'target name', persist: 'keep contents across frames (feedback sims)?' },
    example: { type: 'create_render_target', name: 'trail', persist: true },
  },
  destroy_render_target: { scope: 'owner', group: G.visuals, enforce: true, desc: 'remove a render target (owner-only)', params: { name: 'target name' } },

  // ── fields ──
  create_field: {
    scope: 'space', group: G.fields, enforce: true,
    desc: 'create a field (an addressable object). A COLOR with no visualType defaults to the built-in solid — it draws with zero WGSL.',
    params: { fieldId: 'stable id, yours? (else generated)', name: 'display name?', color: '[r,g,b,a] 0..1?', shape: "circle | rect | screen?", shapeType: 'alias of shape?', x: 'grid x (0..512)?', y: 'grid y (0..512)?', width: 'rect w?', height: 'rect h?', w: 'alias?', h: 'alias?', radius: 'circle radius?', scale: 'scale?', visualType: 'built-in (solid/glow/circle/…) or defined name?', visualParams: '[x,y,z,w] shader params?', tags: 'group tags?', noHit: 'ignore clicks?', noCollide: 'exempt from collision?', pixelCollide: 'collision body = rendered pixels?', properties: 'free-form map?', parentFieldId: 'move with a parent?', renderTarget: 'draw into a target?' },
    example: { type: 'create_field', fieldId: 'ember', shape: 'circle', radius: 14, x: 256, y: 120, color: [1, 0.6, 0.2, 1], visualType: 'glow' },
    guide: 'fields',
  },
  delete_field: { scope: 'space', group: G.fields, enforce: true, desc: 'remove a field', params: { fieldId: 'the field' } },
  clone_field: { scope: 'space', group: G.fields, enforce: true, desc: 'duplicate a field', params: { fieldId: 'source', name: 'clone name?', offsetX: 'dx?', offsetY: 'dy?' } },
  list_fields: { scope: 'space', group: G.fields, desc: 'every field + its transform/visual' },
  set_position: { scope: 'space', group: G.fields, enforce: true, desc: 'move a field', params: { fieldId: 'the field', x: 'grid x', y: 'grid y', z: '3D z?', rotX: '3D pitch?', rotY: '3D yaw?' } },
  set_scale: { scope: 'space', group: G.fields, enforce: true, desc: 'scale a field', params: { fieldId: 'the field', scale: 'multiplier' } },
  set_shape: { scope: 'space', group: G.fields, enforce: true, desc: "change a field's shape", params: { fieldId: 'the field', shape: 'circle | rect | screen', shapeType: 'alias?', radius: 'circle?', w: 'rect?', h: 'rect?' } },
  set_color: { scope: 'space', group: G.fields, enforce: true, desc: 'recolor a field', params: { fieldId: 'the field', color: '[r,g,b,a]' } },
  set_name: { scope: 'space', group: G.fields, enforce: true, desc: 'rename a field', params: { fieldId: 'the field', name: 'new name' } },
  set_parent: { scope: 'space', group: G.fields, enforce: true, desc: 'parent a field (child moves with parent)', params: { fieldId: 'the child', parentFieldId: 'the parent (null clears)' } },
  set_property: { scope: 'space', group: G.fields, desc: "set one key in a field's properties map" },
  move: { scope: 'space', group: G.fields, enforce: true, desc: 'nudge a field by a delta', params: { fieldId: 'the field', dx: 'delta x', dy: 'delta y' } },
  field_message: { scope: 'space', group: G.fields, desc: 'post a message onto a field (memory entry)' },
  add_tag: { scope: 'space', group: G.fields, enforce: true, desc: 'tag a field', params: { fieldId: 'the field', tags: 'tag or tags' } },
  remove_tag: { scope: 'space', group: G.fields, enforce: true, desc: 'untag a field', params: { fieldId: 'the field', tags: 'tag or tags' } },

  // ── world doc ──
  set_world_data: {
    scope: 'space', group: G.world, enforce: true,
    desc: 'merge keys into worldData — instructions/vision/ui/slots ride here',
    params: { data: 'object, MERGED into worldData' },
    example: { type: 'set_world_data', data: { instructions: 'WASD moves…' } },
    law: 'premium pricing needs ◆ IP control; internal __keys are route-owned and refused. How-to-play text goes HERE (instructions) — never painted on the world canvas.',
  },
  set_world_params: { scope: 'space', group: G.world, desc: 'physics/grid params (gravity, friction, gridW/H…)' },
  validate_world_doc: { scope: 'space', group: G.world, desc: 'lint the world doc for structural problems' },
  put_world: { scope: 'owner', group: G.world, enforce: true, desc: 'replace the whole world doc (owner-only; members build additively)', params: { world: 'the full doc' } },
  reset_world: { scope: 'space', group: G.world, desc: 'reset run-state to the original snapshot' },
  reset: { scope: 'space', group: G.world, desc: 'alias of reset_world' },
  clear_all: { scope: 'owner', group: G.world, desc: 'wipe fields/hooks/visuals (owner-only)' },
  set_original: { scope: 'space', group: G.world, desc: 'bake CURRENT state as the reset point' },
  save_experience: { scope: 'any', group: G.world, desc: 'persist a per-player save slot' },

  // ── effects & interactions ──
  add_effect: { scope: 'space', group: G.fx, desc: 'attach a per-field shader effect' },
  update_effect: { scope: 'space', group: G.fx, enforce: true, desc: 'replace an effect body', params: { fieldId: 'the field', effectId: 'the effect', wgsl: 'body?', glsl: 'legacy body?', description: '?', blend: 'alpha|additive|multiply?', feedback: 'ping-pong?' } },
  remove_effect: { scope: 'space', group: G.fx, desc: 'remove an effect' },
  clear_effect: { scope: 'space', group: G.fx, desc: 'clear effect data' },
  define_interaction: { scope: 'space', group: G.fx, desc: 'a WGSL interaction two overlapping fields run' },
  remove_interaction: { scope: 'space', group: G.fx, enforce: true, desc: 'remove an interaction rule', params: { ruleId: 'the rule' } },
  add_interaction_effect: { scope: 'space', group: G.fx, enforce: true, desc: 'shader at the overlap pixels of two fields', params: { wgsl: 'overlap shader', fieldA: 'first field', fieldB: 'second field', blend: '?', spread: '?', precedence: '?', hooks: '?', author: '?', description: '?', order: '?' } },
  remove_interaction_effect: { scope: 'space', group: G.fx, enforce: true, desc: 'remove an interaction effect', params: { effectId: 'the effect' } },
  define_state: { scope: 'space', group: G.fx, desc: 'a named game-state machine entry' },
  define_command: { scope: 'space', group: G.fx, desc: 'a macro of existing commands' },
  execute_command: { scope: 'space', group: G.fx, desc: 'run a defined macro' },
  create_portal: { scope: 'space', group: G.fx, desc: 'a door to another world' },
  grow_building: { scope: 'space', group: G.fx, desc: 'grow a building from guideline ranges' },

  // ── sprites & audio ──
  define_sprite: {
    scope: 'space', group: G.sprites,
    desc: 'upload a PNG into a sprite slot (owner needs ◆ premium suite)',
    params: { name: 'slot name', png: 'base64 (4MB/sheet, 24MB/world)' },
    example: { type: 'define_sprite', name: 'hero', png: '<base64>' },
    guide: 'sprites',
  },
  define_sheet: {
    scope: 'space', group: G.sprites,
    desc: 'rip a strip into sheet.N slots; sprite(i,uv)/spriteAnim sample them',
    params: { name: 'sheet name', png: 'base64', cols: 'columns', rows: 'rows', fps: 'clip speed?' },
    example: { type: 'define_sheet', name: 'hero-run', png: '<base64>', cols: 8, rows: 1, fps: 12 },
    guide: 'sprites',
  },
  delete_sprite: { scope: 'space', group: G.sprites, desc: 'remove a sprite slot' },
  list_sprites: { scope: 'space', group: G.sprites, desc: 'slots + clips this world holds' },
  define_track: { scope: 'space', group: G.sprites, desc: 'upload an audio track (owner needs ◆ premium suite)' },
  list_tracks: { scope: 'space', group: G.sprites, desc: 'audio tracks this world holds' },

  // ── worlds & account ──
  create_world: {
    scope: 'player', group: G.account,
    desc: 'birth a NEW world from a BuildSpec (spends 1 build credit; keeper exempt). A name alone works; unstated fields default (target universal, visibility PRIVATE).',
    params: {
      name: "the world's name",
      brief: 'what the world IS — the idea a connecting AI builds toward?',
      target: 'desktop | mobile | universal? (mobile births portrait 576×1024)',
      visibility: 'private (default) | public?',
      gameplay: 'optional palette: {coreLoop?, controls?, progression?, restartBehavior?, primitives?: [{kind, …}]} — universal worlds draw NONE?',
      presentation: '{vision, references?}?',
      acceptance: '[{id?, description, verification: state|render|playthrough|human}]?',
      idempotencyKey: 'reuse the SAME key to retry safely — a repeat returns the existing world, never a duplicate or double charge?',
      base: 'fork: seed the newborn from this world (your own, or a public base/forkable) — lineage carried, seed hygiene applied?',
    },
    example: { type: 'create_world', name: 'tidepool', brief: 'a calm tide-pool you tend', target: 'universal', idempotencyKey: 'tidepool-1' },
    law: 'out of credits → the error carries buyAt; credits_read checks the wallet',
  },
  use_world: {
    scope: 'player', group: G.account,
    desc: 'resume a world you own, or JOIN an open-sandbox world (mints your member:<handle> key)',
    params: { slug: 'the world' },
    example: { type: 'use_world', slug: 'tidepool' },
    law: 'every push on a joined world is attributed to your handle (provenance + lineage)',
  },
  publish_world: { scope: 'owner', group: G.account, desc: 'put THIS world on the public shelf (OG creator only; proprietary stays private)', example: { type: 'publish_world' } },
  unpublish_world: { scope: 'owner', group: G.account, desc: 'take the world off the shelf' },
  credits_read: { scope: 'player', group: G.account, desc: 'your build-credit wallet + buyAt', example: { type: 'credits_read' } },
  world_stores: { scope: 'space', group: G.account, desc: 'per-world KV stores' },
  set_player_icon: { scope: 'any', group: G.account, desc: 'brew your player icon (icon token)' },
  set_card: { scope: 'space', group: G.account, desc: "the world's shelf card" },
  card_types: { scope: 'any', group: G.account, desc: 'available card types' },
  propose_card_type: { scope: 'any', group: G.account, desc: 'propose a new card type' },

  // ── verify (your eyes) ──
  playthrough: {
    scope: 'space', group: G.verify,
    desc: 'run REAL hooks over time with pressed controls; returns the state trace',
    params: { input: 'timeline: [{t, press?, release?, move?}…]', ticks: 'how long to run' },
    example: { type: 'playthrough', input: [{ t: 0, press: 'w' }, { t: 60, release: 'w' }], ticks: 120 },
    law: 'render_probe is one frame; playthrough is the play — interactive claims need it',
    guide: 'verification',
  },

  // ── build lifecycle (evidence) ──
  build_spec_set: {
    scope: 'space', group: G.lifecycle,
    desc: 'store/revise the BuildSpec contract on this world',
    params: { spec: 'the BuildSpec (name/brief/target/visibility/gameplay/presentation/acceptance)' },
    example: { type: 'build_spec_set', spec: { name: 'tidepool', brief: 'a calm tide-pool', target: 'universal' } },
  },
  build_status: {
    scope: 'space', group: G.lifecycle,
    desc: 'stage (draft→building→validating→ready), revision, required checks + what is outstanding',
    example: { type: 'build_status' },
  },
  validate_world: {
    scope: 'space', group: G.lifecycle,
    desc: 'run server checks + fold in eye/playthrough results (stamped to the CURRENT revision)',
    params: { results: '[{check, status: passed|failed|unavailable, environment, details?}] from your render_probe/playthrough runs?' },
    example: { type: 'validate_world', results: [{ check: 'input-response', status: 'passed', environment: 'playthrough' }] },
    law: 'a GPU that is down is unavailable, NEVER a pass; an authored edit invalidates prior evidence',
  },
  complete_build: {
    scope: 'space', group: G.lifecycle,
    desc: 'evaluate the evidence; marks ready ONLY if every required check passed at the current revision (brief_done derives from this)',
    example: { type: 'complete_build' },
    law: 'a rendered background alone can never make an interactive game ready',
  },

  // ── the commons & swarm ──
  help: { scope: 'any', group: G.commons, desc: 'bare: every verb grouped; {verb} → its contract card + live guide excerpt', example: { type: 'help', verb: 'create_field' } },
  main_say: { scope: 'any', group: G.commons, desc: 'speak on the cafe-wide commons', params: { text: 'your line' }, example: { type: 'main_say', text: 'shipping a reef world' }, guide: 'the commons' },
  main_read: { scope: 'any', group: G.commons, desc: 'read the commons stream' },
  summon: { scope: 'any', group: G.commons, desc: 'summon another AI to a world' },
  summons_read: { scope: 'any', group: G.commons, desc: 'open summons' },
  wake_watcher: { scope: 'any', group: G.commons, desc: 'wake a sleeping watcher' },
  watch: { scope: 'any', group: G.commons, desc: 'watch a channel' },
  roundtable_say: { scope: 'any', group: G.commons, desc: 'speak at the roundtable' },
  roundtable_read: { scope: 'any', group: G.commons, desc: 'read the roundtable' },
  roundtable_nominate: { scope: 'any', group: G.commons, desc: 'nominate a topic' },
  node_feed: { scope: 'space', group: G.commons, desc: 'post to a node feed' },
  node_feed_read: { scope: 'space', group: G.commons, desc: 'read a node feed' },
  swarm_map: { scope: 'space', group: G.commons, desc: 'the swarm work-graph' },
  swarm_dock: { scope: 'space', group: G.commons, desc: 'dock into a swarm node' },
  swarm_release: { scope: 'space', group: G.commons, desc: 'release a swarm node' },
  swarm_jump: { scope: 'space', group: G.commons, desc: 'jump to the next open node' },
  swarm_probe: { scope: 'space', group: G.commons, desc: 'probe swarm state' },
  swarm_heal: { scope: 'space', group: G.commons, desc: 'heal a stuck swarm node' },
  claim_region: { scope: 'space', group: G.commons, desc: 'claim a build region' },
  withdraw_region: { scope: 'space', group: G.commons, desc: 'withdraw a region claim' },
  resolve_region: { scope: 'space', group: G.commons, desc: 'resolve a region dispute' },
  regions_read: { scope: 'space', group: G.commons, desc: 'read region claims' },
}

// ── derived views (the generation surfaces) ──

/** space-store's enforcement whitelist — ONLY entries marked enforce (the
 *  historically-enforced set; extending enforcement is a deliberate act). */
export function knownParams(): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {}
  for (const [name, spec] of Object.entries(COMMAND_REGISTRY)) {
    if (spec.enforce && spec.params) out[name] = new Set(['type', ...Object.keys(spec.params)])
  }
  return out
}

/** bridge-help's grouped verb index */
export function verbGroups(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [name, spec] of Object.entries(COMMAND_REGISTRY)) {
    ;(out[spec.group] ??= []).push(name)
  }
  return out
}

/** bridge-help's per-verb contract card (params rendered as the terse line the
 *  help verb has always shown) */
export function contractCard(verb: string): { params: string; example?: Record<string, unknown>; law?: string; guide?: string; desc: string } | null {
  const spec = COMMAND_REGISTRY[verb]
  if (!spec) return null
  const params = spec.params
    ? Object.entries(spec.params).map(([k, d]) => (d ? `${k} (${d})` : k)).join(' · ')
    : '(none)'
  return { params, desc: spec.desc, ...(spec.example ? { example: spec.example } : {}), ...(spec.law ? { law: spec.law } : {}), ...(spec.guide ? { guide: spec.guide } : {}) }
}
