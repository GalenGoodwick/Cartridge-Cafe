// hull — the bridge between the DESIGNER and the BATTLE. A berth DESIGN is a
// tree of pentagon tiles (parent/edge/part); a HULL is that design turned into a
// live fighting UNIT: geometry laid out, per-part stats summed into ship stats
// (hp/mass/thrust/energy/dps + derived speed/turn), the contact-graph route from
// tile 0 precomputed (for combat SHED — dead tiles orphan the tiles beyond them),
// and the negative-space SHAPE PAYOUTS baked in (diamond +HP, moon +PWR, bay =
// hangar, intact star = super-weapon).
//
// Pure glue: it composes penta-core (layout/contacts/holes) + parts (statOf). No
// new geometry, no new part data. build.mjs inlines this into PRELUDE by stripping
// the `import`/`export` keywords — the names below (layout, contacts, holes,
// statOf) are already in PRELUDE scope there, so the strip leaves valid code.
import { layout, contacts } from './penta-core.mjs'
import { holes } from './penta-holes.mjs'
import { statOf } from './parts.mjs'

// Derived-motion constants: speed ∝ thrust/mass; turn ∝ thrust/(mass·radius)
// where a bigger hull (more tiles) has more rotational inertia, so it turns
// slower even at the same thrust/mass. Tuned for legible RTS handling, not physics.
export const SPEED_K = 0.6
export const TURN_K = 1.2

/** routeGraph(tiles) — the undirected contact graph: adj[i] = the tiles sharing
 *  an edge with tile i (parent links AND re-touch contacts, since a curled hull's
 *  loop is a real structural bond). This is what SHED walks: dead tiles are
 *  removed and anything no longer reachable from tile 0 shears off. */
export function routeGraph(tiles) {
  const adj = tiles.map(() => [])
  for (const c of contacts(tiles)) {
    if (!adj[c.i].includes(c.j)) adj[c.i].push(c.j)
    if (!adj[c.j].includes(c.i)) adj[c.j].push(c.i)
  }
  return adj
}

/** reachableFrom(adj, dead, root) — BFS over the contact graph skipping `dead`
 *  tiles. Returns the Set of tiles still structurally connected to `root`
 *  (tile 0). If the root itself is dead → empty Set (the unit is destroyed:
 *  tile-0 death kills the ship). A loop (curled hull) survives a single cut
 *  because the route reaches the far side the other way around. */
export function reachableFrom(adj, dead = new Set(), root = 0) {
  if (!adj.length || dead.has(root)) return new Set()
  const seen = new Set([root])
  const q = [root]
  while (q.length) {
    const u = q.shift()
    for (const v of adj[u] || []) if (!dead.has(v) && !seen.has(v)) { seen.add(v); q.push(v) }
  }
  return seen
}

/** aliveTiles(unit) — the current live set: tiles with hp > 0 AND still reachable
 *  from tile 0 over the contact graph. Tiles at hp≤0 are dead; tiles orphaned by
 *  those deaths shed (they are not in the returned set even if their own hp>0).
 *  Empty Set ⇒ the unit is dead. Battle calls this after applying beam damage. */
export function aliveTiles(unit) {
  const dead = new Set()
  unit.tileHp.forEach((h, i) => { if (h <= 0) dead.add(i) })
  return reachableFrom(unit.adj, dead, 0)
}

/** shapePayout(holeList, choices?) — the topology tech-tree. Sealing a hole of
 *  a given shape unlocks a bonus (the proven ladder from STRUCTURE.md):
 *    diamond → +15% HP (multiplicative, stacks per diamond) — or REFLECT
 *              (+8% HP, 20% less impact/collision damage) if picked
 *    moon    → +3 PWR — or CELL (+12 battery capacity) if picked
 *    bay     → a hangar (Phase-2 carries a sub-unit) — or MEND (slow passive
 *              hull regen) if picked
 *    star    → intact pentagram hole = the super-weapon is armed (one option)
 *  SPECIALS is the catalogue the designer's click-menu offers per shape kind;
 *  `choices` (hole key → chosen special id) lets the player pick, per sealed
 *  shape INSTANCE, which of that kind's specials to fill it with — omitting a
 *  choice keeps the original automatic behavior exactly.
 *  Pure over the list of holes; makeUnit derives that list from geometry. */
export const SPECIALS = {
  diamond: [
    { id: 'plate', name: 'PLATE', desc: '+15% hull HP' },
    { id: 'reflect', name: 'REFLECT', desc: '+8% HP, 20% less impact damage' },
  ],
  moon: [
    { id: 'gen', name: 'GEN', desc: '+3 power' },
    { id: 'cell', name: 'CELL', desc: '+12 battery capacity' },
  ],
  bay: [
    { id: 'hangar', name: 'HANGAR', desc: 'a hangar berth (future: carries a sub-unit)' },
    { id: 'mend', name: 'MEND', desc: 'slow passive hull regen' },
  ],
  star: [
    { id: 'lance', name: 'LANCE', desc: 'arms the super-weapon' },
  ],
}
export function holeKey(h) { return Math.round(h.cx * 1000) + ',' + Math.round(h.cy * 1000) }
export function shapePayout(holeList, choices) {
  choices = choices || {}
  let hpMul = 1, powerBonus = 0, hangars = 0, star = false, battery = 0, regenRate = 0, reflective = false
  for (const h of holeList) {
    const s = h.shape, picked = choices[holeKey(h)]
    if (s === 'diamond') { if (picked === 'reflect') { hpMul *= 1.08; reflective = true } else hpMul *= 1.15 }
    else if (s === 'moon') { if (picked === 'cell') battery += 12; else powerBonus += 3 }
    else if (s === 'bay') { if (picked === 'mend') regenRate += 0.4; else hangars++ }
    else if (s === 'star') star = true
  }
  return { hpMul, powerBonus, hangars, star, battery, regenRate, reflective }
}

/** makeUnit(design, opts?) — a berth DESIGN → a spawnable fighting UNIT.
 *  design: [{parent, edge, part}] (tile 0 is the base). opts: {seat, owner, x, y,
 *  a} initial placement/ownership carried by battle.
 *
 *  Returns:
 *    tiles      — laid-out poses [{cx,cy,th,part,parent,edge}] (rejected drops)
 *    adj        — the contact route graph (routeGraph)
 *    tileHp     — per-tile current combat hit points (starts = tileMaxHp)
 *    tileMaxHp  — per-tile max (durability × diamond hpMul)
 *    shapes     — the sealed hole shapes ['bay','diamond',…]
 *    hangars    — bay count · hasStar — super-weapon armed
 *    stats      — {hp, mass, thrust, dps, energyGen, energyUse, power, brownout,
 *                  speed, turn, radius, cost}
 *    cost       — ⬡ to spawn · seat/owner/x/y/a — battle placement state */
export function makeUnit(design, opts = {}) {
  const { tiles, rejected } = layout(design || [])
  const adj = routeGraph(tiles)
  const holeList = holes(tiles)
  const shapes = holeList.map((h) => h.shape)
  const pay = shapePayout(holeList, opts.shapeChoices)

  const tileHp = [], tileMaxHp = []
  let mass = 0, thrust = 0, dps = 0, energyGen = 0, energyUse = 0, cost = 0
  for (const t of tiles) {
    const s = statOf(t.part)
    const dur = Math.max(1, Math.round(s.durability * pay.hpMul))
    tileMaxHp.push(dur); tileHp.push(dur)
    mass += s.mass; thrust += s.thrust; dps += s.dps; cost += s.cost
    if (s.energy > 0) energyGen += s.energy; else energyUse += -s.energy
  }

  const hp = tileMaxHp.reduce((a, b) => a + b, 0)
  const power = energyGen - energyUse + pay.powerBonus
  const radius = Math.sqrt(tiles.length) || 1
  const speed = mass > 0 ? SPEED_K * thrust / mass : 0
  const turn = mass > 0 ? TURN_K * thrust / (mass * radius) : 0

  return {
    tiles, adj, rejected,
    tileHp, tileMaxHp,
    shapes, hangars: pay.hangars, hasStar: pay.star, hpMul: pay.hpMul,
    battery: pay.battery, regenRate: pay.regenRate, reflective: pay.reflective,
    stats: {
      hp, mass, thrust, dps, energyGen, energyUse, power,
      brownout: power < 0, speed, turn, radius, cost,
    },
    cost,
    seat: opts.seat ?? null,
    owner: opts.owner ?? null,
    x: opts.x ?? 0, y: opts.y ?? 0, a: opts.a ?? 0,
  }
}
