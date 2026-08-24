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
`,
  },
  {
    id: 'world',
    description: 'the stage — terrain, physics, weather, the rules of matter',
    code: `// ── WORLD — this node owns the STAGE: terrain, gravity, collisions,
// weather, time-of-day. If it is true everywhere for everyone, it
// belongs here. Entities and players READ the stage this node sets.
`,
  },
  {
    id: 'entities',
    description: 'everything that lives in the world — spawns, rosters, behavior',
    code: `// ── ENTITIES — this node owns every non-player thing that moves or
// lives: spawn tables, rosters, per-entity behavior ticks. Give each
// KIND its own section (or grow child nodes) rather than one blob.
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
    code: `// ── HUD — this node owns the display layer: write sim.worldData.hud
// entries (score, prompts, timers). Show conclusions, not internals.
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
