// placeholder-nodes — THE BLANK SLOTS every world is born with (Galen's law,
// Aug 2026: "anything that needs a reload should be blank node placeholders
// that can be edited or built within").
//
// WHY: the live hot-swap can re-load hooks into an EXISTING sandbox but cannot
// CREATE one — so a world born hook-less needs a reload the moment its first
// hook lands. Worse, a blank world gives a builder no shape: where does input
// go? where do rules live? These placeholders fix both at once. The sandbox is
// alive from frame one (every later push is a pure hot-swap), and the world's
// anatomy is already named — a builder (human or AI) opens the ⬢ NODES panel
// and sees the slots, docks one, and builds WITHIN it.
//
// Each placeholder is a REAL node: it compiles (the code gate), auto-registers
// (a __nodes slot + history rev 1), holds nothing, and does nothing — a truly
// idle hook body is a few property reads per frame. The comment inside each is
// the slot's charter: what belongs there, what doesn't.

export interface PlaceholderNode {
  id: string
  description: string
  code: string
}

export const PLACEHOLDER_NODES: PlaceholderNode[] = [
  {
    id: 'player',
    description: 'input + the player avatar — reading keys/touch, moving the body',
    code: `// ── PLAYER — this node owns INPUT and the player's body.
// Read sim.input (keys, pointer, touch) and move the avatar here.
// Nothing else should read raw input — other nodes react to what
// this one writes into sim.worldData (position, facing, intent).
// Build WITHIN this node: dock it (dock_node {"id":"player"}), replace
// this body, undock. It hot-swaps live — no reload, ever.
// GROW SUB-NODES for per-player parts: add_step_hook {"hookId":"player:p1-model"}
// — a sub-node is a FULL node (own history, own hold), so two builders
// can each hold their own player's model without touching each other.
`,
  },
  {
    id: 'world',
    description: 'the stage — terrain, physics, weather, the rules of matter',
    code: `// ── WORLD — this node owns the STAGE: terrain, gravity, collisions,
// weather, time-of-day. If it is true everywhere for everyone, it
// belongs here. Entities and players READ the stage this node sets.
// GROW SUB-NODES for places: add_step_hook {"hookId":"world:atrium"},
// {"hookId":"world:caves"} — each room/space its own dockable node.
`,
  },
  {
    id: 'entities',
    description: 'everything that lives in the world — spawns, rosters, behavior',
    code: `// ── ENTITIES — this node owns every non-player thing that moves or
// lives: spawn tables, rosters, per-entity behavior ticks. Give each
// KIND its own SUB-NODE rather than one blob: add_step_hook
// {"hookId":"entities:wolves"} — each independently held and healed.
`,
  },
  {
    id: 'rules',
    description: 'the game of it — goals, scoring, win/lose, rounds',
    code: `// ── RULES — this node owns the GAME: objectives, scoring, win/lose,
// round flow. It reads what player/world/entities write and decides
// what it MEANS. HUD displays what this node concludes.
`,
  },
  {
    id: 'hud',
    description: 'what the player sees about the game — score, prompts, state',
    code: `// ── HUD — this node owns the display layer. Use THE UI SYSTEM:
// write sim.worldData.ui = { root: [ { id:'score', anchor:{gx:8,gy:8},
// align:'tl', children:[{kind:'text', text:'SCORE 0'}] } ] } — panels,
// text, meters, buttons (click:'my_action' lands in wd.__uiClick).
// The engine SOLVES the layout (worldData.__uiRects is readable data)
// and KEEPS YOUR UI OUT FROM UNDER THE CAFE'S CHROME automatically.
// Show conclusions, not internals. (Legacy wd.hud still works.)
`,
  },
  {
    id: 'net',
    description: 'shared state — what this world syncs when crews play together',
    code: `// ── NET — this node owns SHARED STATE: when this world goes
// multiplayer (arena), what state is authoritative-server truth vs
// local cosmetic? Declare the world's mpManifest here as it grows.
// Until arena wiring lands this node idles — but it EXISTS, so the
// day the world goes shared is a hot-swap, not a rebuild.
`,
  },
]

/** The add_step_hook commands that seed a newborn world's slots. */
export function placeholderSeedCommands(now: number): Array<Record<string, unknown>> {
  return PLACEHOLDER_NODES.map(p => ({
    type: 'add_step_hook',
    hookId: p.id,
    description: p.description,
    author: 'the-house',
    code: p.code,
    note: 'blank slot — born with the world',
    __holder: 'house-seed',
    __now: now,
  }))
}

// THE BASE BACKDROP (Galen, Aug 30: "program world create to set up visuals in
// context right off the bat — one less thing to build"). A newborn world is no
// longer an empty grey square: it opens with ONE skinned full-bleed field sized
// to the playable rect, so the canvas FILLS the viewport from frame one and the
// builder can SEE the frame they are building into. It is a quiet backdrop the
// builder paints over — a starting ground, not a finished look.
const BASE_BG_WGSL = `
fn visual_base_bg(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let g = uv.y * 0.5 + 0.5;
  var col = mix(vec3f(0.075, 0.085, 0.115), vec3f(0.028, 0.033, 0.05), g);
  col += vec3f(0.05, 0.06, 0.09) * (0.5 + 0.5 * sin(uv.x * 2.0 + uv.y * 3.0)) * 0.06;
  col += 0.010 * (vnoise(uv * 34.0) - 0.5);
  // a soft floor line so the canvas reads as a PLACE, not a void
  let horizon = smoothstep(0.02, 0.0, abs(uv.y - 0.35));
  col += vec3f(0.10, 0.13, 0.18) * horizon * 0.25;
  return vec4f(col, 1.0);
}`

/** Seeds a skinned full-bleed backdrop field sized to the world's rect — the
 *  world displays IN CONTEXT from birth (no grey square). `worldParams` carries
 *  gridSize/gridW/gridH; the field is centered on and sized to the playable rect. */
export function baseBackdropSeedCommands(worldParams: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const gs = typeof worldParams?.gridSize === 'number' ? worldParams.gridSize as number : 512
  const w = typeof worldParams?.gridW === 'number' ? worldParams.gridW as number : gs
  const h = typeof worldParams?.gridH === 'number' ? worldParams.gridH as number : gs
  return [
    { type: 'define_visual', name: 'base_bg', wgsl: BASE_BG_WGSL },
    { type: 'create_field', name: 'backdrop', shape: 'rect', x: w / 2, y: h / 2, width: w, height: h, visualType: 'base_bg', color: [0.06, 0.07, 0.1, 1] },
  ]
}
