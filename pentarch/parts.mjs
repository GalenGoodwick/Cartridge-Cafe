// parts — the PENTARCH part table (the single source of truth for what a tile
// IS: cost in ⬡, battle durability, design-stat contribution, render colour and
// palette placement). Ported verbatim from the v9 shipyard (backlog/parts/
// v9-parts.json): COST/NAME/STAT from the hook, HPB from the battle stub, py_col
// from the visual. NO imports — build.mjs inlines this whole file into PRELUDE by
// stripping `export`, so `PARTS`/`statOf`/`PALETTE`/`CATEGORIES` land in scope.
//
// Part codes (0..5) are the on-wire tile ids used everywhere (design trees,
// entity codes, palette slots). 0 is the BLANK/unassigned tile.
//
//   design-STAT vector = [mass, hp, dps, thrust, energy]   (energy: + gen / − use)
//   hp  (top level)     = battle durability (a tile's combat hit points, v9 HPB)
//   cost                = ⬡ paid to spawn a unit carrying this tile
//   color               = [r,g,b] hull tint, matches shader py_col

export const PARTS = [
  // 0 — BLANK (unassigned slot; free, weak, no role)
  { code: 0, name: 'BLANK', category: 'BLANK', cost: 0, hp: 6,
    color: [0.30, 0.36, 0.46], stat: { mass: 0.5, hp: 4, dps: 0, thrust: 0, energy: 0 } },
  // 1 — HULL (the connective structure; cheap, light)
  { code: 1, name: 'HULL', category: 'HULL', cost: 10, hp: 14,
    color: [0.36, 0.50, 0.65], stat: { mass: 1, hp: 10, dps: 0, thrust: 0, energy: 0 } },
  // 2 — ARMOR (heavy, high HP, no output — a wall)
  { code: 2, name: 'ARMOR', category: 'ARMOR', cost: 18, hp: 40,
    color: [0.54, 0.58, 0.65], stat: { mass: 2, hp: 30, dps: 0, thrust: 0, energy: 0 } },
  // 3 — GUN (fires along its edge-normal arc; draws power)
  { code: 3, name: 'GUN', category: 'GUNS', cost: 30, hp: 12,
    color: [1.00, 0.48, 0.42], stat: { mass: 1.5, hp: 8, dps: 6, thrust: 0, energy: -2 } },
  // 4 — ENGINE (thrust; draws power)
  { code: 4, name: 'ENGINE', category: 'DRIVE', cost: 22, hp: 12,
    color: [0.48, 0.86, 1.00], stat: { mass: 1, hp: 8, dps: 0, thrust: 4, energy: -1 } },
  // 5 — GEN (power plant; sustains guns/engines)
  { code: 5, name: 'GEN', category: 'POWER', cost: 26, hp: 10,
    color: [0.62, 1.00, 0.54], stat: { mass: 1, hp: 6, dps: 0, thrust: 0, energy: 4 } },
]

// Palette placement: designer slots 0..4 assign part codes 1..5 (slot s → part
// s+1, exactly as the v9 palette strip). BLANK never sits in the palette.
export const PALETTE = [1, 2, 3, 4, 5]

// Category tab order, aligned to PALETTE (what each palette slot's tab reads).
export const CATEGORIES = ['HULL', 'ARMOR', 'GUNS', 'DRIVE', 'POWER']

/** Resolve a part (code 0..5, a name like 'GUN'/'gun', or a design entry
 *  {part}) to its PARTS row. Unknown → BLANK (code 0), never throws. */
export function partOf(part) {
  if (part && typeof part === 'object') part = part.part
  if (typeof part === 'string') {
    const up = part.toUpperCase()
    const byName = PARTS.find(p => p.name === up)
    if (byName) return byName
    part = Number(part)
  }
  const code = part | 0
  return PARTS[code] || PARTS[0]
}

/** The design-stat contribution of a part, plus its cost and battle durability.
 *  → {mass, hp, dps, thrust, energy, durability, cost, name, category, code}.
 *  `hp` is the DESIGN stat (what the shipyard sums); `durability` is the BATTLE
 *  hit points of the tile. Accepts a code, a name, or a design entry. */
export function statOf(part) {
  const p = partOf(part)
  return {
    mass: p.stat.mass, hp: p.stat.hp, dps: p.stat.dps,
    thrust: p.stat.thrust, energy: p.stat.energy,
    durability: p.hp, cost: p.cost,
    name: p.name, category: p.category, code: p.code,
  }
}
