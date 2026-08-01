const ENG = (() => {
// penta-core — the pentagon-hull geometry PENTARCH stands on. Pure math, no IO.
//
// A ship is a tree of regular pentagons (side 1) attached edge-to-edge, but the
// GEOMETRY is not a tree: pentagons cannot tile the plane (interior angle 108°),
// so chains curve, curl back into RE-TOUCH contacts, and enclose 36° rhombic
// VOIDS — all three are gameplay (curved hulls, adjacency mods, diamond slots).
//
// Tile pose: {cx, cy, th}. Vertex k at angle th + 90° + k·72° (radius R);
// edge k spans vertices k..k+1, outward normal at th + 90° + (k+.5)·72°,
// midpoint at apothem a. Attaching to a parent's edge e puts the child at
// 2a along that normal, rotated so the CHILD'S EDGE 0 is the shared edge.

const SIDE = 1
const APOTHEM = 1 / (2 * Math.tan(Math.PI / 5))     // 0.68819…
const CIRCUM = 1 / (2 * Math.sin(Math.PI / 5))      // 0.85065…
const STEP = (2 * Math.PI) / 5

function edgeNormalAngle(tile, e) { return tile.th + Math.PI / 2 + (e + 0.5) * STEP }
function edgeMidpoint(tile, e) {
  const n = edgeNormalAngle(tile, e)
  return { x: tile.cx + APOTHEM * Math.cos(n), y: tile.cy + APOTHEM * Math.sin(n) }
}
function vertices(tile) {
  const out = []
  for (let k = 0; k < 5; k++) {
    const a = tile.th + Math.PI / 2 + k * STEP
    out.push({ x: tile.cx + CIRCUM * Math.cos(a), y: tile.cy + CIRCUM * Math.sin(a) })
  }
  return out
}

/** the pose a child takes when attached across the parent's edge e —
 *  the child's edge 0 becomes the shared edge (its normal faces the parent) */
function attachPose(parent, e, ce = 0) {
  const n = edgeNormalAngle(parent, e)
  return {
    cx: parent.cx + 2 * APOTHEM * Math.cos(n),
    cy: parent.cy + 2 * APOTHEM * Math.sin(n),
    th: n + Math.PI / 2 - Math.PI / 5 - ce * STEP,  // ce = child's mating edge (0 = canonical; matches the designer's generalized attach)
  }
}

/** SAT polygon overlap for two pentagons — the GHOST VALIDITY oracle.
 *  Flush edge-sharing (distance exactly 2a) is TOUCHING, not overlap: we shrink
 *  each pentagon a hair (EPS_SHRINK) so legal adjacency never reads as illegal. */
const EPS_SHRINK = 1e-4
function axes(vs) {
  const out = []
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length]
    const nx = -(b.y - a.y), ny = b.x - a.x
    const L = Math.hypot(nx, ny)
    out.push({ x: nx / L, y: ny / L })
  }
  return out
}
function shrunk(tile) {
  const vs = vertices(tile)
  return vs.map(v => ({ x: v.x + (tile.cx - v.x) * EPS_SHRINK, y: v.y + (tile.cy - v.y) * EPS_SHRINK }))
}
function overlaps(t1, t2) {
  if (Math.hypot(t1.cx - t2.cx, t1.cy - t2.cy) > 2 * CIRCUM) return false
  const v1 = shrunk(t1), v2 = shrunk(t2)
  for (const ax of [...axes(v1), ...axes(v2)]) {
    let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity
    for (const v of v1) { const p = v.x * ax.x + v.y * ax.y; if (p < min1) min1 = p; if (p > max1) max1 = p }
    for (const v of v2) { const p = v.x * ax.x + v.y * ax.y; if (p < min2) min2 = p; if (p > max2) max2 = p }
    if (max1 < min2 || max2 < min1) return false
  }
  return true
}

/** Build tile poses from a design tree. Design: [{parent, edge, part}] — tile 0
 *  is the base (pose 0,0,0); every later entry attaches to an EXISTING tile.
 *  Returns { tiles, rejected } — a placement whose ghost would overlap ANY
 *  existing tile is rejected (Galen: "if ghost would overlap … no ghost"). */
function layout(design) {
  const tiles = [{ cx: 0, cy: 0, th: 0, part: design[0]?.part ?? 'hull', parent: -1, edge: -1 }]
  const rejected = []
  for (let i = 1; i < design.length; i++) {
    const d = design[i]
    const parent = tiles[d.parent]
    if (!parent) { rejected.push({ i, why: 'no parent' }); continue }
    const pose = attachPose(parent, d.edge, d.ce || 0)
    let bad = false
    for (const t of tiles) { if (overlaps(pose, t)) { bad = true; break } }
    if (bad) { rejected.push({ i, why: 'overlap' }); continue }
    tiles.push({ ...pose, part: d.part ?? 'hull', parent: d.parent, edge: d.edge })
  }
  return { tiles, rejected }
}

/** All edge contacts — parent links AND re-touch (a chain curled back flush).
 *  Two edges are in contact when their midpoints coincide. */
function contacts(tiles, eps = 1e-6) {
  const out = []
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    if (Math.hypot(tiles[i].cx - tiles[j].cx, tiles[i].cy - tiles[j].cy) > 2 * APOTHEM + 0.01) continue
    for (let ei = 0; ei < 5; ei++) for (let ej = 0; ej < 5; ej++) {
      const mi = edgeMidpoint(tiles[i], ei), mj = edgeMidpoint(tiles[j], ej)
      if (Math.hypot(mi.x - mj.x, mi.y - mj.y) < Math.max(eps, 1e-3)) {
        out.push({ i, j, ei, ej, retouch: !(tiles[j].parent === i && tiles[j].edge === ei) && !(tiles[i].parent === j && tiles[i].edge === ej) })
      }
    }
  }
  return out
}

/** Free edges: not in any contact. Each carries its ghost pose + whether the
 *  ghost is LEGAL (the designer shows a ghost) or blocked (maybe a void). */
function freeEdges(tiles) {
  const used = new Set()
  for (const c of contacts(tiles)) { used.add(c.i + ':' + c.ei); used.add(c.j + ':' + c.ej) }
  const out = []
  for (let i = 0; i < tiles.length; i++) for (let e = 0; e < 5; e++) {
    if (used.has(i + ':' + e)) continue
    const ghost = attachPose(tiles[i], e)
    let legal = true
    for (const t of tiles) { if (overlaps(ghost, t)) { legal = false; break } }
    out.push({ i, e, ghost, legal })
  }
  return out
}

/** VOIDS — the diamonds. Pentagon frustration is ANGULAR: where tile corners
 *  meet at one point, each contributes its 108° interior angle. Three tiles
 *  cover 324°, leaving a 36° wedge NOTHING can ever fill (a pentagon needs
 *  108°). Those unfillable pockets are the special build slots. Returns
 *  [{x, y, gapDeg, tiles: [i…], dir}] — dir = unit vector into the gap. */
function voids(tiles, eps = 1e-3) {
  // cluster coincident vertices across tiles
  const pts = []
  tiles.forEach((t, i) => vertices(t).forEach((v, k) => pts.push({ i, k, x: v.x, y: v.y })))
  const used = new Set()
  const out = []
  for (let a = 0; a < pts.length; a++) {
    if (used.has(a)) continue
    const cluster = [pts[a]]; used.add(a)
    for (let b = a + 1; b < pts.length; b++) {
      if (used.has(b)) continue
      if (Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) < eps) { cluster.push(pts[b]); used.add(b) }
    }
    const distinct = [...new Set(cluster.map(p => p.i))]
    if (distinct.length < 2) continue
    const gapDeg = 360 - 108 * cluster.length
    if (gapDeg <= 1 || gapDeg >= 108) continue        // ≥108° could hold a pentagon — not a sealed void
    // the gap opens opposite the average direction of the covering tiles
    let dx = 0, dy = 0
    for (const p of cluster) { const t = tiles[p.i]; dx += t.cx - p.x; dy += t.cy - p.y }
    const L = Math.hypot(dx, dy) || 1
    const dir = { x: -dx / L, y: -dy / L }
    out.push({ x: pts[a].x + dir.x * 0.22, y: pts[a].y + dir.y * 0.22, gapDeg, tiles: distinct, dir })
  }
  return out
}

// penta-holes — the negative-space SHAPE GRAMMAR. Enclosed holes in a hull are
// extracted as boundary loops and classified: DIAMOND (small rhomb), MOON
// (two-horned crescent), STAR (5-spiked pentagram hole — the super-weapon
// shape), BAY (large open interior, ring hangars). The rarer the shape, the
// bigger the unlock — hardness is inherent in pentagon frustration.


const Q = (v) => Math.round(v * 2000) / 2000            // vertex quantization key
const key = (p) => Q(p.x) + ',' + Q(p.y)

/** All enclosed holes: walk the free-edge segments (material on the LEFT by
 *  tile winding); loops with NEGATIVE signed area enclose a hole. */
function holes(tiles) {
  const segs = []
  for (const f of freeEdges(tiles)) {
    const vs = vertices(tiles[f.i])
    const a = vs[f.e], b = vs[(f.e + 1) % 5]
    segs.push({ a, b, used: false })
  }
  const byStart = new Map()
  for (const s of segs) { const k = key(s.a); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(s) }
  const out = []
  for (const s0 of segs) {
    if (s0.used) continue
    const loop = []
    let cur = s0
    for (let guard = 0; guard < segs.length + 2; guard++) {
      cur.used = true
      loop.push(cur)
      const nexts = (byStart.get(key(cur.b)) || []).filter(s => !s.used)
      if (!nexts.length) break
      if (nexts.length === 1) { cur = nexts[0]; continue }
      // pinch vertex: take the sharpest right turn (keeps material on the left)
      const inD = Math.atan2(cur.b.y - cur.a.y, cur.b.x - cur.a.x)
      let best = null, bestTurn = Infinity
      for (const n of nexts) {
        const outD = Math.atan2(n.b.y - n.a.y, n.b.x - n.a.x)
        let turn = (inD - outD + Math.PI * 3) % (2 * Math.PI)   // right-turn magnitude
        if (turn < bestTurn) { bestTurn = turn; best = n }
      }
      cur = best
    }
    if (loop.length < 3) continue
    if (key(loop[loop.length - 1].b) !== key(loop[0].a)) continue   // open walk — outer notch, not a loop
    const poly = loop.map(s => s.a)
    let A2 = 0
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; A2 += p.x * q.y - q.x * p.y }
    if (A2 / 2 >= -1e-6) continue                                  // positive = the outer boundary
    out.push(classify(poly.slice().reverse()))                     // reverse → CCW hole polygon
  }
  return out
}

/** shape metrics + verdict for one hole polygon (CCW) */
function classify(poly) {
  const n = poly.length
  let A2 = 0, cx = 0, cy = 0
  for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; A2 += p.x * q.y - q.x * p.y; cx += p.x; cy += p.y }
  const area = Math.abs(A2 / 2); cx /= n; cy /= n
  // interior angles → spikes (sharp convex tips of the hole: star points, moon horns)
  let spikes = 0, reflex = 0
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i + n - 1) % n], p1 = poly[i], p2 = poly[(i + 1) % n]
    const a1 = Math.atan2(p0.y - p1.y, p0.x - p1.x), a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x)
    let int = (a1 - a2 + Math.PI * 4) % (2 * Math.PI)              // CCW interior angle
    const deg = int * 180 / Math.PI
    if (deg < 100) spikes++
    if (deg > 185) reflex++
  }
  // elongation via bounding radii
  let rMax = 0, rMin = Infinity
  for (const p of poly) { const r = Math.hypot(p.x - cx, p.y - cy); if (r > rMax) rMax = r; if (r < rMin) rMin = r }
  let shape = 'bay'
  if (spikes >= 4 && reflex >= 4) shape = 'star'
  else if (spikes === 2 && reflex >= 1) shape = 'moon'
  else if (area < 0.75 && n <= 6) shape = 'diamond'
  return { shape, area: +area.toFixed(3), verts: n, spikes, reflex, cx, cy, poly }
}

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

const PARTS = [
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
const PALETTE = [1, 2, 3, 4, 5]

// Category tab order, aligned to PALETTE (what each palette slot's tab reads).
const CATEGORIES = ['HULL', 'ARMOR', 'GUNS', 'DRIVE', 'POWER']

/** Resolve a part (code 0..5, a name like 'GUN'/'gun', or a design entry
 *  {part}) to its PARTS row. Unknown → BLANK (code 0), never throws. */
function partOf(part) {
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
function statOf(part) {
  const p = partOf(part)
  return {
    mass: p.stat.mass, hp: p.stat.hp, dps: p.stat.dps,
    thrust: p.stat.thrust, energy: p.stat.energy,
    durability: p.hp, cost: p.cost,
    name: p.name, category: p.category, code: p.code,
  }
}

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




// Derived-motion constants: speed ∝ thrust/mass; turn ∝ thrust/(mass·radius)
// where a bigger hull (more tiles) has more rotational inertia, so it turns
// slower even at the same thrust/mass. Tuned for legible RTS handling, not physics.
const SPEED_K = 0.6
const TURN_K = 1.2

/** routeGraph(tiles) — the undirected contact graph: adj[i] = the tiles sharing
 *  an edge with tile i (parent links AND re-touch contacts, since a curled hull's
 *  loop is a real structural bond). This is what SHED walks: dead tiles are
 *  removed and anything no longer reachable from tile 0 shears off. */
function routeGraph(tiles) {
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
function reachableFrom(adj, dead = new Set(), root = 0) {
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
function aliveTiles(unit) {
  const dead = new Set()
  unit.tileHp.forEach((h, i) => { if (h <= 0) dead.add(i) })
  return reachableFrom(unit.adj, dead, 0)
}

/** shapePayout(shapeNames) — the topology tech-tree. Sealing a hole of a given
 *  shape unlocks a bonus (the proven ladder from STRUCTURE.md):
 *    diamond → +15% HP (multiplicative, stacks per diamond) — or REFLECT (+8%
 *              HP, 20% less impact/collision damage) if the player picked it
 *    moon    → +3 PWR — or CELL (+12 battery capacity) if picked
 *    bay     → a hangar (Phase-2 carries a sub-unit) — or MEND (slow passive
 *              hull regen) if picked
 *    star    → intact pentagram hole = the super-weapon is armed (one option)
 *  SPECIALS is the catalogue the designer's click-menu offers per shape kind;
 *  `choices` (hole key → chosen special id) lets the player pick, per sealed
 *  shape instance, which of that kind's specials to fill it with — default
 *  (no choice made) keeps the original automatic behavior exactly.
 *  Pure over the list of holes; makeUnit derives that list from geometry. */
const SPECIALS = {
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
function holeKey(h) { return Math.round(h.cx * 1000) + ',' + Math.round(h.cy * 1000) }
function shapePayout(holeList, choices) {
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
function makeUnit(design, opts = {}) {
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

// mod-battle — the WAR SCENE, assembled from its mechanic slices. Four mechanic
// nodes co-own this one module (the clobber-serialized file, mirroring the
// mod-designer pattern): each declares its own `B.<name>` hook-fragment (a
// String.raw block, wrapped in its own `{ }` so locals never collide) and its
// own pure helpers for the unit test. `build.mjs` reads only `SRC` (the
// concatenated fragments, in Istrolid order) into the DISPATCH; the exported
// pure helpers are test-only (build never inlines them).
//
//   B.econ    bt-econ    capture rings + income + spawn-from-berths
//   B.move    bt-move    steer to cursor; GUN edge-normal arcs; brownout
//   B.damage  bt-damage  beam→nearest enemy TILE; shed orphans; STAR lance   ← THIS SLICE
//   B.win     bt-win     hold all rings 30s / eliminate → PW.scene='debrief'
//
// SHARED BATTLE STATE (the contract these four agree on, on PW.bt or wd.__bt):
//   bt.units  : [ makeUnit()-shaped unit, … ]   — the live fleet (econ spawns)
//   bt.beams  : [ {seat, ox, oy, dmg}, … ]      — gun shots to resolve (move fires)
//   bt.scale  : world units per hull-unit (default 0.06) — tile→world mapping
// A unit is exactly what hull.makeUnit returns: {tiles, adj, tileHp, hasStar,
// x, y, a, seat, owner, …}. bt-damage NEVER re-lays-out geometry; it walks the
// precomputed contact graph (unit.adj) for shed and recomputes holes() only to
// test whether the STAR hole survives. Geometry (layout/holes/…) is inlined into
// PRELUDE by build.mjs, so the fragment calls `holes` by name; the pure helpers
// below import it (test-only).






// Ordered fragment registry — each mechanic node adds exactly its own key.
const B = {}

// ── tuning (bt-damage owns these combat constants) ───────────────────────────
const BEAM_DMG = 12          // default per-shot damage a gun beam deals
const STAR_CHARGE_RATE = 0.15 // charge/sec while the star is armed (~6.7s)
const STAR_RADIUS = 0.35     // AoE radius of the lance (world units)
const STAR_DMG = 40          // damage the lance deals to every tile in radius
const DEFAULT_SCALE = 0.06   // hull-unit → world-unit (matches battle draw)

// ── bt-econ tuning (capture rings + income + spawn) ──────────────────────────
const CAPTURE_RADIUS = 0.28  // world units: a unit within this of a ring holds it
const RING_RATE = 2.0        // ⬡/sec a SOLE-held ring pays its holder
const TRICKLE = 0.4          // ⬡/sec passive income every seat gets (never fully shut out)

// ─────────────────────────────────────────────────────────────────────────────
// bt-econ PURE HELPERS — the unit-tested brain of B.econ (capture rings drive
// income; income buys berth units, spawned at the seat's home dock). The hook
// fragment mirrors these with the inlined geometry (layout/contacts/holes/statOf
// land in PRELUDE); makeUnit lives in hull.mjs (NOT inlined) so the fragment
// re-implements it inline, exactly like B.move/B.damage mirror their helpers.
// ─────────────────────────────────────────────────────────────────────────────

/** ringHolder(ring, units, radius) — the seat SOLELY holding a ring: the one side
 *  with an alive unit inside `radius` and no enemy alive unit inside it. Zero seats
 *  or ≥2 seats present → null (empty / contested = neutral, no income). */
function ringHolder(ring, units, radius = CAPTURE_RADIUS) {
  const seats = new Set()
  for (const u of units) {
    if (unitDead(u)) continue
    if (Math.hypot((u.x || 0) - ring.x, (u.y || 0) - ring.y) <= radius) seats.add(enemyKey(u))
  }
  return seats.size === 1 ? [...seats][0] : null
}

/** tickIncome(bt, dt, opts) — advance the ⬡ ledger for one tick: refresh each
 *  ring's owner, pay every SOLE-held ring's holder RING_RATE·dt, and give every
 *  fielded seat (bt.seats) a TRICKLE·dt so a shut-out player can still field
 *  scouts. Mutates ring.owner + bt.income; returns bt.income. */
function tickIncome(bt, dt, opts = {}) {
  const rate = opts.ringRate ?? RING_RATE, trickle = opts.trickle ?? TRICKLE, radius = opts.radius ?? CAPTURE_RADIUS
  const inc = bt.income || (bt.income = {})
  const step = Math.max(0, dt)
  for (const s of bt.seats || []) inc[s] = (inc[s] || 0) + trickle * step
  for (const ring of bt.rings || []) {
    const h = ringHolder(ring, bt.units || [], radius)
    ring.owner = h
    if (h != null) inc[h] = (inc[h] || 0) + rate * step
  }
  return inc
}

/** unitCost(design) — the ⬡ to spawn a berth design (sum of its parts' costs). */
function unitCost(design) { return makeUnit(design).cost }

/** trySpawn(bt, seat, design, opts) — if `seat` can afford `design`, deduct its
 *  cost from bt.income, makeUnit it at the seat's home dock (bt.docks[seat]), push
 *  it onto bt.units, and return the unit; else null (unaffordable / empty design). */
function trySpawn(bt, seat, design, opts = {}) {
  if (!design || !design.length) return null
  const cost = makeUnit(design).cost
  const inc = bt.income || (bt.income = {})
  if ((inc[seat] || 0) < cost) return null
  const dock = (bt.docks && bt.docks[seat]) || { x: 0, y: 0 }
  const u = makeUnit(design, { seat, x: dock.x, y: dock.y, a: opts.a ?? 0 })
  inc[seat] -= cost
  ;(bt.units || (bt.units = [])).push(u)
  return u
}

// ─────────────────────────────────────────────────────────────────────────────
// B.econ — the HOOK FRAGMENT (runs FIRST each battle tick). Refreshes ring
// ownership + income, draws the rings (code 200+owner, a=hold pulse) and the
// income HUD, and turns a seat's latched spawn input into a new unit from its
// selected berth at its home dock. Reads/creates the shared battle state
// (PW.bt / wd.__bt). makeUnit is re-implemented inline (hull.mjs is not inlined).
// ─────────────────────────────────────────────────────────────────────────────
B.econ = String.raw`{
  const bt = (typeof PW === 'object' && PW && PW.bt) || wd.__bt;
  if (bt && Array.isArray(bt.rings)) {
    const _dt = (typeof dt === 'number' && dt > 0) ? Math.min(dt, 1 / 30) : 1 / 30;
    const _key = (u) => (u.seat != null ? u.seat : u.owner);
    const _dead = (u) => {
      const dead = new Set();
      for (let i = 0; i < u.tileHp.length; i++) if (u.tileHp[i] <= 0) dead.add(i);
      if (dead.has(0) || !u.adj || !u.adj.length) return true;
      const seen = new Set([0]); const q = [0];
      while (q.length) { const a = q.shift(); const nb = u.adj[a] || []; for (let k = 0; k < nb.length; k++) { const b = nb[k]; if (!dead.has(b) && !seen.has(b)) { seen.add(b); q.push(b); } } }
      return seen.size === 0;
    };
    const US = Array.isArray(bt.units) ? bt.units : (bt.units = []);
    const inc = bt.income || (bt.income = {});
    // 1) ring ownership + income
    const R = ${CAPTURE_RADIUS};
    for (const s of (bt.seats || [])) inc[s] = (inc[s] || 0) + ${TRICKLE} * _dt;
    for (let ri = 0; ri < bt.rings.length; ri++) {
      const ring = bt.rings[ri];
      const near = new Set();
      for (let ui = 0; ui < US.length; ui++) { const u = US[ui]; if (_dead(u)) continue; if (Math.hypot((u.x || 0) - ring.x, (u.y || 0) - ring.y) <= R) near.add(_key(u)); }
      ring.owner = (near.size === 1) ? [...near][0] : null;
      ring.hold = (ring.owner != null) ? Math.min(1, (ring.hold || 0) + _dt) : 0;
      if (ring.owner != null) inc[ring.owner] = (inc[ring.owner] || 0) + ${RING_RATE} * _dt;
      pushEnt(ring.x, ring.y, ring.hold || 0, 200 + ((ring.owner == null ? 9 : (ring.owner | 0))));
    }
    // 2) spawn from a berth on the acting seat's latched spawn input
    let SP = 0, BERTH = 0;
    if (IN_ROOM) { const _pl = wd.players[MY_SEAT] || {}; SP = latch('spawn_' + MY_SEAT + '#' + (_pl.spawn_n | 0)); BERTH = (_pl.berth | 0); }
    else { SP = latch('spawn#' + ((wd.spawn_n | 0))); BERTH = (wd.berth | 0); }
    if (SP > 0) {
      const seat = IN_ROOM ? MY_SEAT : 0;
      const fleet = Array.isArray(wd.__fleet) ? wd.__fleet : [];
      const design = fleet[BERTH] || fleet[0];
      if (design && design.length && (inc[seat] || 0) >= 0) {
        // inline makeUnit: layout → tiles, contacts → adj, holes → payout, statOf → hp/stats/cost
        const lo = layout(design); const tiles = lo.tiles;
        const adj = tiles.map(() => []);
        for (const c of contacts(tiles)) { if (!adj[c.i].includes(c.j)) adj[c.i].push(c.j); if (!adj[c.j].includes(c.i)) adj[c.j].push(c.i); }
        let hpMul = 1, powerBonus = 0, star = false;
        const shs = holes(tiles); for (let h = 0; h < shs.length; h++) { const sp = shs[h].shape; if (sp === 'diamond') hpMul *= 1.15; else if (sp === 'moon') powerBonus += 3; else if (sp === 'star') star = true; }
        const tileHp = []; let mass = 0, thrust = 0, dps = 0, eg = 0, eu = 0, cost = 0;
        for (let i = 0; i < tiles.length; i++) { const s = statOf(tiles[i].part); const dur = Math.max(1, Math.round(s.durability * hpMul)); tileHp.push(dur); mass += s.mass; thrust += s.thrust; dps += s.dps; cost += s.cost; if (s.energy > 0) eg += s.energy; else eu += -s.energy; }
        if ((inc[seat] || 0) >= cost) {
          const power = eg - eu + powerBonus; const radius = Math.sqrt(tiles.length) || 1;
          const dock = (bt.docks && bt.docks[seat]) || { x: 0, y: 0 };
          US.push({ tiles, adj, tileHp, tileMaxHp: tileHp.slice(), hasStar: star, hpMul, stats: { hp: tileHp.reduce((a, b) => a + b, 0), mass, thrust, dps, energyGen: eg, energyUse: eu, power, brownout: power < 0, speed: mass > 0 ? 0.6 * thrust / mass : 0, turn: mass > 0 ? 1.2 * thrust / (mass * radius) : 0, radius, cost }, cost, seat, owner: null, x: dock.x, y: dock.y, a: 0 });
          inc[seat] -= cost; sound('spawn');
        }
      }
    }
    // 3) income readout (chrome HUD, top strip) — one number per fielded seat
    if (typeof hud === 'function') { const me = IN_ROOM ? MY_SEAT : 0; hud('⬡ ' + Math.floor(inc[me] || 0), 0.02, 0.9); }
  }
}`

// ─────────────────────────────────────────────────────────────────────────────
// bt-damage PURE HELPERS — the unit-tested brain of B.damage. Same logic the
// hook fragment runs, callable off hull.makeUnit() units so the mechanic is
// proven without a render. The fragment mirrors these using the inlined geometry
// (it re-implements the tiny BFS inline because aliveTiles/reachableFrom live in
// hull.mjs, which build does NOT inline — only penta-core/penta-holes/parts).
// ─────────────────────────────────────────────────────────────────────────────

/** enemyKey(u) — the side a unit belongs to (seat first, else owner). Two units
 *  are enemies iff their keys differ. */
function enemyKey(u) { return u.seat != null ? u.seat : u.owner }

/** tileWorldPos(unit, i, scale) — tile i's centre in WORLD space: rotate the
 *  hull-local pose by the unit heading and translate to the unit position.
 *  scale = world units per hull-unit (battle's draw scale). */
function tileWorldPos(unit, i, scale = DEFAULT_SCALE) {
  const t = unit.tiles[i]
  const ca = Math.cos(unit.a || 0), sa = Math.sin(unit.a || 0)
  return {
    x: (unit.x || 0) + (t.cx * ca - t.cy * sa) * scale,
    y: (unit.y || 0) + (t.cx * sa + t.cy * ca) * scale,
  }
}

/** nearestEnemyTile(attacker, units, opts?) — the single nearest ALIVE tile on
 *  any ENEMY unit to the firing origin (default the attacker's own centre).
 *  opts: {origin:{x,y}, range, scale}. Returns {unit, tileIdx, x, y, dist} or
 *  null (no enemy tile in range). Friendly units and dead/orphaned tiles are
 *  never targeted — this is the "beam hits nearest enemy TILE" rule. */
function nearestEnemyTile(attacker, units, opts = {}) {
  const scale = opts.scale ?? DEFAULT_SCALE
  const range = opts.range ?? Infinity
  const ox = opts.origin ? opts.origin.x : (attacker.x || 0)
  const oy = opts.origin ? opts.origin.y : (attacker.y || 0)
  const myKey = enemyKey(attacker)
  let best = null, bestD = range
  for (const u of units) {
    if (u === attacker || enemyKey(u) === myKey) continue
    const alive = aliveTiles(u)
    for (const i of alive) {
      const p = tileWorldPos(u, i, scale)
      const d = Math.hypot(p.x - ox, p.y - oy)
      if (d < bestD) { bestD = d; best = { unit: u, tileIdx: i, x: p.x, y: p.y, dist: d } }
    }
  }
  return best
}

/** applyBeam(unit, tileIdx, dmg) — deal `dmg` to one tile's hp (clamped at 0).
 *  Returns true iff the tile was alive and is now dead (crossed to ≤0). Invalid
 *  index or an already-dead tile → false, never throws. */
function applyBeam(unit, tileIdx, dmg = BEAM_DMG) {
  const hp = unit.tileHp
  if (tileIdx < 0 || tileIdx >= hp.length || hp[tileIdx] <= 0) return false
  hp[tileIdx] = Math.max(0, hp[tileIdx] - dmg)
  return hp[tileIdx] <= 0
}

/** shedUnit(unit) — after damage, route-BFS from tile 0 over the contact graph
 *  and SHEAR the orphans: any tile still hp>0 but no longer reachable from tile 0
 *  is set to 0 (it has physically broken off). Returns the surviving alive Set.
 *  A ring reroutes around a single cut (survives); an open chain sheds everything
 *  downstream of the cut; tile-0 death empties the set (the unit is destroyed). */
function shedUnit(unit) {
  const alive = aliveTiles(unit)               // reachable-from-0, hp>0
  for (let i = 0; i < unit.tileHp.length; i++) {
    if (unit.tileHp[i] > 0 && !alive.has(i)) unit.tileHp[i] = 0   // orphan → shear
  }
  return alive
}

/** unitDead(unit) — no tile survives (tile-0 gone, or every tile at 0). */
function unitDead(unit) { return aliveTiles(unit).size === 0 }

/** starArmed(unit) — the super-weapon is ready to charge iff the hull was built
 *  with a STAR hole (hull.hasStar) AND that pentagram is STILL SEALED in the
 *  currently-alive tiles. Any tile on the star boundary dying re-opens the hole
 *  → disarmed. Recomputes holes() over just the live tiles (geometry inlined in
 *  the hook; imported here for the test). */
function starArmed(unit) {
  if (!unit || !unit.hasStar) return false
  const alive = aliveTiles(unit)
  if (!alive.size) return false
  const sub = [...alive].map((i) => unit.tiles[i])
  return holes(sub).some((h) => h.shape === 'star')
}

/** chargeStar(unit, dt, rate?) — advance the lance charge while armed (caps at
 *  1 = ready); a disarmed star bleeds its charge to 0. Returns the new charge. */
function chargeStar(unit, dt, rate = STAR_CHARGE_RATE) {
  if (!starArmed(unit)) { unit.starCharge = 0; return 0 }
  unit.starCharge = Math.min(1, (unit.starCharge || 0) + Math.max(0, dt) * rate)
  return unit.starCharge
}

/** fireLance(attacker, units, opts?) — discharge a fully-charged, armed star as
 *  an AoE lance centred on opts.center (default the nearest enemy unit's centre).
 *  Every alive ENEMY tile within opts.radius takes opts.dmg, then each hit unit
 *  sheds. Resets the charge to 0. Returns the array of {unit, tileIdx} hits, or
 *  null when the star is not armed / not charged / has no target. */
function fireLance(attacker, units, opts = {}) {
  if (!starArmed(attacker) || (attacker.starCharge || 0) < 1) return null
  const scale = opts.scale ?? DEFAULT_SCALE
  const radius = opts.radius ?? STAR_RADIUS
  const dmg = opts.dmg ?? STAR_DMG
  let cx, cy
  if (opts.center) { cx = opts.center.x; cy = opts.center.y }
  else {
    let td = Infinity, tgt = null
    for (const u of units) {
      if (u === attacker || enemyKey(u) === enemyKey(attacker) || unitDead(u)) continue
      const d = Math.hypot((u.x || 0) - (attacker.x || 0), (u.y || 0) - (attacker.y || 0))
      if (d < td) { td = d; tgt = u }
    }
    if (!tgt) return null
    cx = tgt.x || 0; cy = tgt.y || 0
  }
  const hits = []
  const touched = new Set()
  for (const u of units) {
    if (u === attacker || enemyKey(u) === enemyKey(attacker)) continue
    for (const i of aliveTiles(u)) {
      const p = tileWorldPos(u, i, scale)
      if (Math.hypot(p.x - cx, p.y - cy) <= radius) {
        applyBeam(u, i, dmg); hits.push({ unit: u, tileIdx: i }); touched.add(u)
      }
    }
  }
  for (const u of touched) shedUnit(u)
  attacker.starCharge = 0
  return hits
}

// ─────────────────────────────────────────────────────────────────────────────
// B.damage — the HOOK FRAGMENT. Resolves queued gun beams into per-tile damage,
// sheds orphaned tiles, charges + fires the star lance, and culls destroyed
// units. Reads the shared battle state (PW.bt / wd.__bt) econ+move populate;
// degrades to nothing if no battle is live. Self-contained: it re-implements the
// tiny reach-BFS inline (aliveTiles lives in hull.mjs, which build does not
// inline) and calls `holes` (inlined) to test the star seal.
// ─────────────────────────────────────────────────────────────────────────────
B.damage = String.raw`{
  const bt = (typeof PW === 'object' && PW && PW.bt) || wd.__bt;
  if (bt && Array.isArray(bt.units)) {
    const US = bt.units;
    const WS = (typeof bt.scale === 'number') ? bt.scale : ${DEFAULT_SCALE};
    // alive-set BFS from tile 0, shearing orphans (mutates tileHp) — mirrors shedUnit
    const _alive = (u) => {
      const dead = new Set();
      for (let i = 0; i < u.tileHp.length; i++) if (u.tileHp[i] <= 0) dead.add(i);
      if (dead.has(0) || !u.adj || !u.adj.length) return new Set();
      const seen = new Set([0]); const q = [0];
      while (q.length) { const a = q.shift(); const nb = u.adj[a] || []; for (let k = 0; k < nb.length; k++) { const b = nb[k]; if (!dead.has(b) && !seen.has(b)) { seen.add(b); q.push(b); } } }
      for (let i = 0; i < u.tileHp.length; i++) if (u.tileHp[i] > 0 && !seen.has(i)) u.tileHp[i] = 0;
      return seen;
    };
    const _twp = (u, i) => { const t = u.tiles[i]; const ca = Math.cos(u.a || 0), sa = Math.sin(u.a || 0); return { x: (u.x || 0) + (t.cx * ca - t.cy * sa) * WS, y: (u.y || 0) + (t.cx * sa + t.cy * ca) * WS }; };
    const _key = (u) => (u.seat != null ? u.seat : u.owner);
    // 1) resolve gun beams → nearest enemy tile takes damage; draw the beam
    const beams = Array.isArray(bt.beams) ? bt.beams : [];
    for (let bi = 0; bi < beams.length; bi++) {
      const bm = beams[bi];
      let best = null, bd = Infinity;
      for (let ui = 0; ui < US.length; ui++) { const u = US[ui]; if (_key(u) === bm.seat) continue; const al = _alive(u); if (!al.size) continue; for (const i of al) { const p = _twp(u, i); const d = Math.hypot(p.x - bm.ox, p.y - bm.oy); if (d < bd) { bd = d; best = { u: u, i: i, x: p.x, y: p.y }; } } }
      if (best) {
        best.u.tileHp[best.i] = Math.max(0, best.u.tileHp[best.i] - (bm.dmg || ${BEAM_DMG}));
        _alive(best.u);
        const hl = Math.min(0.49, bd / 2);
        pushEnt((bm.ox + best.x) / 2, (bm.oy + best.y) / 2, Math.atan2(best.y - bm.oy, best.x - bm.ox) + hl / 1000, 100 + ((bm.seat | 0)));
      }
    }
    if (bt.beams) bt.beams.length = 0;   // consume this tick's shots
    // 2) STAR super-weapon: charge armed stars; fire an AoE lance at full charge
    const _dt = (typeof dt === 'number' && dt > 0) ? Math.min(dt, 1 / 30) : 1 / 30;
    for (let ui = 0; ui < US.length; ui++) {
      const u = US[ui]; const al = _alive(u);
      let armed = false;
      if (u.hasStar && al.size) { const sub = []; for (const i of al) sub.push(u.tiles[i]); const hs = holes(sub); for (let h = 0; h < hs.length; h++) if (hs[h].shape === 'star') { armed = true; break; } }
      if (armed) {
        u.starCharge = Math.min(1, (u.starCharge || 0) + _dt * ${STAR_CHARGE_RATE});
        if (u.starCharge >= 1) {
          u.starCharge = 0;
          let tx = null, ty = null, td = Infinity;
          for (let oi = 0; oi < US.length; oi++) { const o = US[oi]; if (_key(o) === _key(u)) continue; const oa = _alive(o); if (!oa.size) continue; const d = Math.hypot((o.x || 0) - (u.x || 0), (o.y || 0) - (u.y || 0)); if (d < td) { td = d; tx = o.x || 0; ty = o.y || 0; } }
          if (tx != null) {
            for (let oi = 0; oi < US.length; oi++) { const o = US[oi]; if (_key(o) === _key(u)) continue; for (const i of _alive(o)) { const p = _twp(o, i); if (Math.hypot(p.x - tx, p.y - ty) <= ${STAR_RADIUS}) o.tileHp[i] = Math.max(0, o.tileHp[i] - ${STAR_DMG}); } _alive(o); }
            pushEnt(tx, ty, 1, 290);   // lance burst marker (shader may decode; degrades otherwise)
            sound('lance');
          }
        }
      } else u.starCharge = 0;
    }
    // 3) cull destroyed units (tile-0 death / fully sheared) — win node reads survivors
    bt.units = US.filter((u) => _alive(u).size > 0);
  }
}`

// ─────────────────────────────────────────────────────────────────────────────
// bt-move  — STEERING + GUNS + ENERGY (this slice).
//   • steer: MY units turn toward the seat cursor and drive forward while it is
//     held (BLOOP steering — turn-then-thrust), speed/turn from hull.stats
//     (thrust/mass). Discrete-input safe: it reads the held pointer each tick.
//   • guns: every alive GUN tile fires along its OUTWARD EDGE-NORMAL (hull
//     curvature = firing arc) on a per-unit cooldown; each shot is a beam queued
//     on bt.beams for bt-damage to resolve to the nearest enemy tile.
//   • energy: a hull whose GEN cannot sustain its guns/engines is in BROWNOUT
//     (hull.stats.brownout, power<0) — that HALVES the fire rate (doubles the
//     gun interval). GEN sustaining keeps the full cadence.
// The pure helpers below are the unit-tested brain; the B.move fragment mirrors
// them with the inlined geometry (edgeNormalAngle/edgeMidpoint/contacts/partOf all
// land in PRELUDE), re-implementing the reach-BFS inline like B.damage does.
// ─────────────────────────────────────────────────────────────────────────────

const GUN_PART = 3          // parts.mjs code for a GUN tile
const FIRE_PERIOD = 0.8     // seconds between a gun's shots at full power
const GUN_DMG = 6           // damage a single gun beam deals (matches GUN dps)

/** angDiff(a,b) — the signed shortest angular delta from heading a to heading b,
 *  wrapped to (-π, π]. Positive = turn counter-clockwise. */
function angDiff(a, b) {
  let d = (b - a) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** steer(unit, tx, ty, dt, opts?) — BLOOP steering toward world point (tx,ty):
 *  rotate the heading toward the target clamped by turn·dt, then drive FORWARD
 *  along the (new) heading by speed·dt, scaled by how well the nose already points
 *  at the target (cos of the residual angle, floored at 0 — never reverse). Never
 *  overshoots the target. speed/turn default to hull.stats (thrust/mass derived);
 *  opts.speed/opts.turn override for isolated tests. Mutates + returns unit. */
function steer(unit, tx, ty, dt, opts = {}) {
  const speed = opts.speed ?? (unit.stats ? unit.stats.speed : 0)
  const turn = opts.turn ?? (unit.stats ? unit.stats.turn : 0)
  const dx = tx - (unit.x || 0), dy = ty - (unit.y || 0)
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-9) return unit
  const desired = Math.atan2(dy, dx)
  const da = angDiff(unit.a || 0, desired)
  const maxTurn = Math.max(0, turn) * Math.max(0, dt)
  unit.a = (unit.a || 0) + Math.max(-maxTurn, Math.min(maxTurn, da))
  const facing = Math.max(0, Math.cos(angDiff(unit.a, desired)))   // 1 aligned … 0 sideways
  const step = Math.min(dist, Math.max(0, speed) * Math.max(0, dt) * facing)
  unit.x = (unit.x || 0) + Math.cos(unit.a) * step
  unit.y = (unit.y || 0) + Math.sin(unit.a) * step
  return unit
}

/** edgeUsage(tiles) — the set of `i:e` edge ids that are in contact with a
 *  neighbour (parent link or re-touch). A gun's FREE edges are the complement. */
function edgeUsage(tiles) {
  const used = new Set()
  for (const c of contacts(tiles)) { used.add(c.i + ':' + c.ei); used.add(c.j + ':' + c.ej) }
  return used
}

/** outwardEdge(unit, i) — the single OUTWARD free edge of tile i: the free (not
 *  contacted) edge whose normal points most away from the hull centre (tile 0).
 *  This is the firing arc a perimeter gun shoots along. Returns the edge index,
 *  or -1 if the tile has no free edge (fully enclosed — it cannot fire out). */
function outwardEdge(unit, i) {
  const t = unit.tiles[i]
  const used = edgeUsage(unit.tiles)
  const ox = t.cx, oy = t.cy                       // outward from hull centre (tile 0 at 0,0)
  const rlen = Math.hypot(ox, oy)
  let best = -1, bestDot = -Infinity
  for (let e = 0; e < 5; e++) {
    if (used.has(i + ':' + e)) continue
    const n = edgeNormalAngle(t, e)
    const dot = rlen > 1e-9 ? (Math.cos(n) * ox + Math.sin(n) * oy) / rlen : 0
    if (best < 0 || dot > bestDot) { best = e; bestDot = dot }
  }
  return best
}

/** gunPorts(unit, scale?) — every alive GUN tile's firing port in WORLD space:
 *  {tileIdx, edge, ox, oy, dir}. ox/oy = the outward edge midpoint rotated by the
 *  unit heading and translated to its position; dir = that edge normal in world
 *  angle (the beam's arc). Dead / orphaned guns and non-gun tiles are excluded. */
function gunPorts(unit, scale = DEFAULT_SCALE) {
  const alive = aliveTiles(unit)
  const ca = Math.cos(unit.a || 0), sa = Math.sin(unit.a || 0)
  const out = []
  for (const i of alive) {
    if (partOf(unit.tiles[i].part).code !== GUN_PART) continue
    const e = outwardEdge(unit, i)
    if (e < 0) continue
    const t = unit.tiles[i]
    const m = edgeMidpoint(t, e)
    out.push({
      tileIdx: i, edge: e,
      ox: (unit.x || 0) + (m.x * ca - m.y * sa) * scale,
      oy: (unit.y || 0) + (m.x * sa + m.y * ca) * scale,
      dir: edgeNormalAngle(t, e) + (unit.a || 0),
    })
  }
  return out
}

/** fireInterval(unit, period?) — seconds between a gun's shots. BROWNOUT (the
 *  hull's GEN cannot sustain its draw, hull.stats.brownout / power<0) HALVES the
 *  fire rate → DOUBLES the interval. A sustained hull fires at the base period. */
function fireInterval(unit, period = FIRE_PERIOD) {
  const brown = unit && unit.stats ? !!unit.stats.brownout : false
  return brown ? period * 2 : period
}

/** gunBeams(unit, dt, opts?) — advance the unit's gun cooldown and, on the tick
 *  it elapses, return one beam per gun port ({seat, ox, oy, dmg, dir}) for
 *  bt-damage to resolve; most ticks it returns []. Mutates unit.__cool. A gunless
 *  or fully-dead unit never fires. Brownout stretches the interval (fireInterval).
 *  opts: {scale, period, dmg}. */
function gunBeams(unit, dt, opts = {}) {
  const ports = gunPorts(unit, opts.scale)
  if (!ports.length) { unit.__cool = 0; return [] }
  unit.__cool = (unit.__cool || 0) - Math.max(0, dt)
  if (unit.__cool > 0) return []
  unit.__cool += fireInterval(unit, opts.period)
  const seat = enemyKey(unit)
  const dmg = opts.dmg ?? GUN_DMG
  return ports.map((p) => ({ seat, ox: p.ox, oy: p.oy, dmg, dir: p.dir }))
}

// ─────────────────────────────────────────────────────────────────────────────
// B.move — the HOOK FRAGMENT. Steers MY units toward the held seat cursor and
// queues gun beams onto bt.beams (bt-damage, which runs after, resolves them).
// Reads the shared battle state (PW.bt / wd.__bt); degrades to nothing off-battle.
// ─────────────────────────────────────────────────────────────────────────────
B.move = String.raw`{
  const bt = (typeof PW === 'object' && PW && PW.bt) || wd.__bt;
  if (bt && Array.isArray(bt.units)) {
    const US = bt.units;
    const WS = (typeof bt.scale === 'number') ? bt.scale : ${DEFAULT_SCALE};
    const _dt = (typeof dt === 'number' && dt > 0) ? Math.min(dt, 1 / 30) : 1 / 30;
    if (!Array.isArray(bt.beams)) bt.beams = [];
    // cursor target + held: the acting seat's frame in a room, else the local pointer
    let TX, TY, HELD;
    if (IN_ROOM) { const _pl = wd.players[MY_SEAT] || {}; TX = _pl.mx; TY = _pl.my; HELD = !!_pl.down; }
    else { TX = PX; TY = PY; HELD = DOWN; }
    // alive-set BFS from tile 0 (aliveTiles lives in hull.mjs — not inlined; mirror it)
    const _alive = (u) => {
      const dead = new Set();
      for (let i = 0; i < u.tileHp.length; i++) if (u.tileHp[i] <= 0) dead.add(i);
      if (dead.has(0) || !u.adj || !u.adj.length) return new Set();
      const seen = new Set([0]); const q = [0];
      while (q.length) { const a = q.shift(); const nb = u.adj[a] || []; for (let k = 0; k < nb.length; k++) { const b = nb[k]; if (!dead.has(b) && !seen.has(b)) { seen.add(b); q.push(b); } } }
      return seen;
    };
    const _key = (u) => (u.seat != null ? u.seat : u.owner);
    for (let ui = 0; ui < US.length; ui++) {
      const u = US[ui];
      const al = _alive(u);
      if (!al.size) continue;
      const mine = (u.seat === MY_SEAT) || (u.seat == null && !IN_ROOM);
      // 1) STEER my units toward the held cursor (BLOOP: turn-then-thrust)
      if (mine && HELD && typeof TX === 'number' && typeof TY === 'number') {
        const dx = TX - (u.x || 0), dy = TY - (u.y || 0), dist = Math.hypot(dx, dy);
        if (dist > 1e-9) {
          const st = u.stats || {}; const spd = +st.speed || 0, trn = +st.turn || 0;
          const desired = Math.atan2(dy, dx);
          let da = (desired - (u.a || 0)) % (2 * Math.PI); if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
          const mt = trn * _dt; u.a = (u.a || 0) + Math.max(-mt, Math.min(mt, da));
          let ra = (desired - u.a) % (2 * Math.PI); if (ra > Math.PI) ra -= 2 * Math.PI; if (ra < -Math.PI) ra += 2 * Math.PI;
          const step = Math.min(dist, spd * _dt * Math.max(0, Math.cos(ra)));
          u.x = (u.x || 0) + Math.cos(u.a) * step; u.y = (u.y || 0) + Math.sin(u.a) * step;
        }
      }
      // 2) GUNS: fire from each alive gun's outward free edge on the unit cooldown
      const brown = u.stats ? !!u.stats.brownout : false;
      const period = ${FIRE_PERIOD} * (brown ? 2 : 1);
      const used = new Set();
      const cs = contacts(u.tiles);
      for (let ci = 0; ci < cs.length; ci++) { used.add(cs[ci].i + ':' + cs[ci].ei); used.add(cs[ci].j + ':' + cs[ci].ej); }
      const ca = Math.cos(u.a || 0), sa = Math.sin(u.a || 0);
      const ports = [];
      for (const ti of al) {
        if (partOf(u.tiles[ti].part).code !== ${GUN_PART}) continue;
        const t = u.tiles[ti];
        let be = -1, bd = -Infinity; const rl = Math.hypot(t.cx, t.cy);
        for (let e = 0; e < 5; e++) { if (used.has(ti + ':' + e)) continue; const n = edgeNormalAngle(t, e); const dot = rl > 1e-9 ? (Math.cos(n) * t.cx + Math.sin(n) * t.cy) / rl : 0; if (be < 0 || dot > bd) { be = e; bd = dot; } }
        if (be < 0) continue;
        const m = edgeMidpoint(t, be);
        ports.push({ ox: (u.x || 0) + (m.x * ca - m.y * sa) * WS, oy: (u.y || 0) + (m.x * sa + m.y * ca) * WS, dir: edgeNormalAngle(t, be) + (u.a || 0) });
      }
      if (!ports.length) { u.__cool = 0; continue; }
      u.__cool = (u.__cool || 0) - _dt;
      if (u.__cool > 0) continue;
      u.__cool += period;
      const seat = _key(u);
      for (let pi = 0; pi < ports.length; pi++) bt.beams.push({ seat: seat, ox: ports[pi].ox, oy: ports[pi].oy, dmg: ${GUN_DMG}, dir: ports[pi].dir });
    }
  }
}`

// ─────────────────────────────────────────────────────────────────────────────
// bt-win — the VICTORY check (pure helpers + B.win fragment). Two ways to win:
// DOMINATION (hold every capture ring continuously for RING_HOLD_TIME) or
// ELIMINATION (once combat has been joined by ≥2 seats, be the last seat with a
// living unit). On a win the room flips to the debrief scene.
// ─────────────────────────────────────────────────────────────────────────────
const RING_HOLD_TIME = 30   // seconds one seat must hold ALL rings to win

/** seatsWithUnits(bt) — the set of seats that currently have at least one alive unit. */
function seatsWithUnits(bt) {
  const s = new Set()
  for (const u of bt.units || []) if (!unitDead(u)) s.add(enemyKey(u))
  return s
}

/** allRingsHeldBy(bt, seat) — true iff there is ≥1 ring and every ring is owned by seat. */
function allRingsHeldBy(bt, seat) {
  const R = bt.rings || []
  return R.length > 0 && R.every((r) => r.owner === seat)
}

/** checkWin(bt, dt, opts?) — advance the domination timer and test victory.
 *  DOMINATION: a seat holding ALL rings continuously for opts.holdTime wins.
 *  ELIMINATION: once ≥2 seats have fielded a unit (bt.combatStarted latches), the
 *  last seat with a living unit wins. Returns the winning seat or null; mutates
 *  bt.holdSeat/holdT/combatStarted. */
function checkWin(bt, dt, opts = {}) {
  const need = opts.holdTime ?? RING_HOLD_TIME
  const R = bt.rings || []
  let dom = null
  if (R.length) { const o = R[0].owner; if (o != null && R.every((r) => r.owner === o)) dom = o }
  if (dom != null && dom === bt.holdSeat) bt.holdT = (bt.holdT || 0) + Math.max(0, dt)
  else { bt.holdSeat = dom; bt.holdT = 0 }
  if (dom != null && (bt.holdT || 0) >= need) return dom
  const live = seatsWithUnits(bt)
  if (live.size >= 2) bt.combatStarted = true
  if (bt.combatStarted && live.size === 1) return [...live][0]
  return null
}

// B.win — the HOOK FRAGMENT (runs LAST). Mirrors checkWin inline; on victory sets
// PW.scene='debrief' + PW.result, un-starts the room. Idempotent once in debrief.
B.win = String.raw`{
  const bt = (typeof PW === 'object' && PW && PW.bt) || wd.__bt;
  const _inDebrief = (typeof PW === 'object' && PW && PW.scene === 'debrief');
  if (bt && Array.isArray(bt.rings) && !_inDebrief) {
    const _dt = (typeof dt === 'number' && dt > 0) ? Math.min(dt, 1 / 30) : 1 / 30;
    const _key = (u) => (u.seat != null ? u.seat : u.owner);
    const _dead = (u) => {
      const dead = new Set();
      for (let i = 0; i < u.tileHp.length; i++) if (u.tileHp[i] <= 0) dead.add(i);
      if (dead.has(0) || !u.adj || !u.adj.length) return true;
      const seen = new Set([0]); const q = [0];
      while (q.length) { const a = q.shift(); const nb = u.adj[a] || []; for (let k = 0; k < nb.length; k++) { const b = nb[k]; if (!dead.has(b) && !seen.has(b)) { seen.add(b); q.push(b); } } }
      return seen.size === 0;
    };
    let dom = null; const R = bt.rings;
    if (R.length) { const o = R[0].owner; if (o != null) { let all = true; for (let i = 0; i < R.length; i++) if (R[i].owner !== o) { all = false; break; } if (all) dom = o; } }
    if (dom != null && dom === bt.holdSeat) bt.holdT = (bt.holdT || 0) + _dt; else { bt.holdSeat = dom; bt.holdT = 0; }
    let win = null;
    if (dom != null && (bt.holdT || 0) >= ${RING_HOLD_TIME}) win = dom;
    if (win == null) { const US = bt.units || []; const live = new Set(); for (let i = 0; i < US.length; i++) if (!_dead(US[i])) live.add(_key(US[i])); if (live.size >= 2) bt.combatStarted = true; if (bt.combatStarted && live.size === 1) win = [...live][0]; }
    if (win != null && typeof PW === 'object' && PW) { PW.scene = 'debrief'; PW.result = { winner: win }; wd.__started = false; sound('win'); }
  }
}`

// The composed scene hook: fragments run in Istrolid order — spawn/econ, then
// steer/fire, then resolve damage, then check win. Missing slices (nodes not yet
// built) contribute nothing — the scene degrades, never throws. build.mjs wraps
// this whole string in its own `{ }` in the DISPATCH.
const SRC = ['econ', 'move', 'damage', 'win']
  .map((k) => B[k] || '')
  .join('\n')

// Also expose the raw fragment registry so a later assembler / integrate node
// (or a sibling battle slice) can compose or introspect individual fragments.
const FRAGMENTS = B









// ═══════════════ V2 SHIP SYSTEMS (generated — see build-engine-v2.mjs) ═══════════════
// freeEdges derived from ENG's own contacts() (turret arcs are EARNED BY PLACEMENT)
function freeEdgesV2(tiles) {
  const used = new Set()
  for (const c of contacts(tiles)) { used.add(c.i + ':' + c.ei); used.add(c.j + ':' + c.ej) }
  const out = []
  for (let i = 0; i < tiles.length; i++) for (let e = 0; e < 5; e++) if (!used.has(i + ':' + e)) out.push({ i, e })
  return out
}
// ── V2/phys (generated from phys.mjs — edit THAT file + rerun build-engine-v2) ──
const { massProps, edgeNormal, thrusters, wrench, allocate, netWrench, envelope, flyStep, DRAG, ANG_DRAG, MOUNTS, shipMass, aimGimbal } = (() => {
// phys.mjs — PENTARCH ship physics: mass/COM/inertia, thruster wrenches,
// throttle allocation, and the MOBILITY ENVELOPE (fwd/strafe/turn) that part
// ROTATION creates. Render-free; consumed by the designer (stats) and battle
// (steering). See DESIGN-ship-systems.md §5.
//
// Conventions: ship frame, +x = ship forward (heading 0), angles CCW radians.
// A part's orientation o ∈ 0..4 selects one of its tile's 5 edge normals as its
// action direction (thrust EXHAUSTS opposite: force is along -normal? NO —
// convention here: `dir` IS the direction of the force applied to the ship).

const ST = (2 * Math.PI) / 5

/** MOUNT TIERS — the arc of rotation you BUY for a mounted module (weapon or
 *  thruster). Machinery has mass: a full gimbal ring is heavy. Effective arc in
 *  battle = bought arc ∩ hull exposure (you can't thrust/shoot through hull). */
const MOUNTS = {
  fixed:  { half: 0,                cost: 0,  mass: 0   },
  swivel: { half: Math.PI / 5,      cost: 8,  mass: 0.3 },   // ±36°
  wide:   { half: Math.PI / 2,      cost: 18, mass: 0.6 },   // ±90°
  ring:   { half: Math.PI,          cost: 34, mass: 1.0 },   // 360°
}

/** shipMass(tiles) — THE WEIGHT ALGORITHM, explicit: every tile weighs its part
 *  mass + its mount's machinery + its module. One place, one truth; massProps
 *  consumes its output. tiles may carry { mass, mount, moduleMass }. */
function shipMass(tiles) {
  return tiles.map(t => ({
    ...t,
    mass: (t.mass ?? 1) + (MOUNTS[t.mount] ? MOUNTS[t.mount].mass : 0) + (t.moduleMass || 0),
  }))
}

/** the world-frame direction of tile t's edge-o normal (same ena as penta-core) */
function edgeNormal(t, o) {
  const a = t.th + Math.PI / 2 + (o + 0.5) * ST
  return { x: Math.cos(a), y: Math.sin(a) }
}

/** massProps(tiles) — tiles: [{cx,cy,mass}] → { M, com:{x,y}, I }
 *  I about the COM, point-mass model (tile size ~1: adequate, tested). */
function massProps(tiles) {
  let M = 0, sx = 0, sy = 0
  for (const t of tiles) { const m = t.mass ?? 1; M += m; sx += m * t.cx; sy += m * t.cy }
  if (M <= 0) return { M: 0, com: { x: 0, y: 0 }, I: 0 }
  const com = { x: sx / M, y: sy / M }
  let I = 0
  for (const t of tiles) { const m = t.mass ?? 1; const dx = t.cx - com.x, dy = t.cy - com.y; I += m * (dx * dx + dy * dy) }
  I = Math.max(I, 0.2)   // a 1-tile ship still turns finitely
  return { M, com, I }
}

/** thrusters(tiles) — pull the actuator list out of a laid-out ship.
 *  tiles: [{cx,cy,th,part:{kind,thrust?,torque?,drain?},o}]
 *  → [{ i, pos:{x,y} (rel COM), dir:{x,y}, F, T (pure torque), drain }] */
function thrusters(tiles, com) {
  const out = []
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i], p = t.part
    if (!p) continue
    const F = p.thrust || 0, T = p.torque || 0
    if (!F && !T) continue
    // ROCKET CONVENTION (Galen: "engines don't push from the edge they appear
    // on"): o marks the NOZZLE/EXHAUST edge — plume exits THERE, and the force
    // on the ship is the opposite: dir = −normal(o). Aim the nozzle backward.
    const nrm = edgeNormal(t, t.o ?? 0)
    const dir = F ? { x: -nrm.x, y: -nrm.y } : { x: 0, y: 0 }
    // GIMBAL: the mount's arc, centered on the part's facing. A fixed mount has
    // half=0 (today's behavior, exactly). allocate() may aim anywhere inside.
    const half = MOUNTS[t.mount] ? MOUNTS[t.mount].half : 0
    if (T) {
      // GYROS TORQUE BOTH WAYS — one entry per spin sense (E-rotation had no
      // gyro at all before this: the allocator only ever saw +T)
      out.push({ i, pos: { x: t.cx - com.x, y: t.cy - com.y }, dir: { x: 0, y: 0 }, ang: 0, half: 0, F: 0, T, drain: p.drain || 0 })
      out.push({ i, pos: { x: t.cx - com.x, y: t.cy - com.y }, dir: { x: 0, y: 0 }, ang: 0, half: 0, F: 0, T: -T, drain: p.drain || 0 })
    }
    if (F) out.push({ i, pos: { x: t.cx - com.x, y: t.cy - com.y }, dir, ang: Math.atan2(dir.y, dir.x), half, F, T: 0, drain: p.drain || 0 })
  }
  // RCS FLOOR — hull-integrated reaction jets: a whisper of omni thrust + both-
  // way torque at the COM, scaling gently with hull size. Every ship answers
  // the stick; a real engine is ~20× the floor. rcs:true → no plume, no drain.
  const nT = tiles.length
  const rcsF = 0.35 + 0.1 * nT, rcsT = 0.25 + 0.08 * nT
  out.push({ i: -1, rcs: true, pos: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, ang: 0, half: Math.PI, F: rcsF, T: 0, drain: 0 })
  out.push({ i: -1, rcs: true, pos: { x: 0, y: 0 }, dir: { x: 0, y: 0 }, ang: 0, half: 0, F: 0, T: rcsT, drain: 0 })
  out.push({ i: -1, rcs: true, pos: { x: 0, y: 0 }, dir: { x: 0, y: 0 }, ang: 0, half: 0, F: 0, T: -rcsT, drain: 0 })
  return out
}

const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a))

/** aimGimbal(th, gx, gy) — point a gimballed thruster as close to the desired
 *  force direction (gx,gy) as its arc allows; returns the CLAMPED dir. */
function aimGimbal(th, gx, gy) {
  if (!th.F || !(th.half > 0)) return th.dir
  const wantA = Math.atan2(gy, gx)
  const d = wrapA(wantA - th.ang)
  const a = th.ang + Math.max(-th.half, Math.min(th.half, d))
  return { x: Math.cos(a), y: Math.sin(a) }
}

/** wrench of one thruster at throttle u: { fx, fy, tq } (tq includes lever torque) */
function wrench(th, u) {
  const fx = u * th.F * th.dir.x, fy = u * th.F * th.dir.y
  const tq = u * (th.T + th.F * (th.pos.x * th.dir.y - th.pos.y * th.dir.x))
  return { fx, fy, tq }
}

/** allocate(ths, want) — THE CONTROL SYSTEM (Galen's law: "going straight
 *  fires engines AS MUCH AS POSSIBLE in that direction, even if angled engines
 *  counter-balance"). want: { fwd:-1..1, lat:-1..1, turn:-1..1 }, ship frame.
 *
 *  Solved as a tiny constrained optimization, not a cosine guess: maximize
 *  thrust ALONG the command while PENALIZING side-drift and unwanted torque —
 *  projected gradient ascent on u ∈ [0,1]ⁿ. Mirrored 45° engines both saturate
 *  to FULL (their lateral bleeds cancel — the old cosine allocator shyly gave
 *  them ~0.7); a lone skewed engine gets throttled back or countered by a gyro,
 *  because its side-effects have nothing to cancel against. Deterministic,
 *  ~ITER·n multiplies per tick, n is small. */
function allocate(ths, want) {
  const n = ths.length
  if (!n) return []
  const wx = want.fwd, wy = want.lat, wt = want.turn
  const wmag = Math.hypot(wx, wy)
  // unit wrenches, force part normalized so big/small engines optimize fairly
  const W = ths.map(th => wrench(th, 1))
  const fscale = Math.max(...W.map(w => Math.hypot(w.fx, w.fy)), 1e-9)
  const tscale = Math.max(...W.map(w => Math.abs(w.tq)), 1e-9)
  // command axes: along = the wanted direction; perp = the drift to cancel
  const ax = wmag > 1e-9 ? wx / wmag : 0, ay = wmag > 1e-9 ? wy / wmag : 0
  const PEN = 2.2          // side-drift / stray-torque penalty weight
  const ITER = 16
  const us = new Array(n).fill(0)
  const dirs = ths.map(th => th.dir)                        // live gimbal aims
  for (let it = 0; it < ITER; it++) {
    const STEP = 0.6 * Math.pow(0.78, it)   // DAMPED — a fixed flyStep oscillates and can land on 0
    // ── GIMBAL PASS: each mounted thruster swings toward its best use — the
    //    commanded direction, or (for pure turn) the tangent that spins the
    //    right way. Arc-clamped; a fixed mount never moves. Two RING engines
    //    on a turn command aim opposite tangents and spin the ship. ──
    for (let i = 0; i < n; i++) {
      const th = ths[i]
      if (!th.F || !(th.half > 0)) continue
      let gx = ax, gy = ay
      if (wmag < 1e-9 && Math.abs(wt) > 1e-9) {
        const r = Math.hypot(th.pos.x, th.pos.y)
        if (r > 1e-6) { const sgn = Math.sign(wt); gx = -th.pos.y / r * sgn; gy = th.pos.x / r * sgn }
      }
      if (Math.abs(gx) + Math.abs(gy) > 1e-9) {
        dirs[i] = aimGimbal(th, gx, gy)
        W[i] = wrench({ ...th, dir: dirs[i] }, 1)
      }
    }
    // current net (normalized)
    let Fx = 0, Fy = 0, T = 0
    for (let i = 0; i < n; i++) { Fx += us[i] * W[i].fx / fscale; Fy += us[i] * W[i].fy / fscale; T += us[i] * W[i].tq / tscale }
    const along = Fx * ax + Fy * ay
    const px = Fx - along * ax, py = Fy - along * ay          // drift component
    const tErr = T - wt * (Math.abs(wt) > 1e-9 ? Math.abs(T) + 1 : 0)  // wanted torque handled below
    for (let i = 0; i < n; i++) {
      const fx = W[i].fx / fscale, fy = W[i].fy / fscale, tq = W[i].tq / tscale
      // gradient of ( along − PEN·(|drift|² + torque-err²) )
      let g = (fx * ax + fy * ay) * (wmag > 1e-9 ? 1 : 0)
        - PEN * 2 * (px * fx + py * fy)
      if (Math.abs(wt) > 1e-9) g += tq * Math.sign(wt) * Math.abs(wt)   // torque wanted: reward agreeing spin
      else g -= PEN * 2 * T * tq                                        // torque unwanted: cancel it
      us[i] = Math.max(0, Math.min(1, us[i] + STEP * g))
    }
    void tErr
  }
  us.dirs = dirs                                            // live aims ride along (plumes + flyStep)
  return us
}

/** net wrench for a throttle vector */
function netWrench(ths, us) {
  let fx = 0, fy = 0, tq = 0
  for (let i = 0; i < ths.length; i++) { const w = wrench(ths[i], us[i]); fx += w.fx; fy += w.fy; tq += w.tq }
  return { fx, fy, tq }
}

/** envelope(tiles) — THE designer readout. What this hull can actually do:
 *  { aFwd, aBack, aLat, alpha, vMax } accelerations (per unit mass) + a top
 *  speed proxy. Rotating one part changes these numbers — that's the feature. */
function envelope(tiles) {
  const { M, com, I } = massProps(tiles)
  const ths = thrusters(tiles, com)
  if (!ths.length || M <= 0) return { aFwd: 0, aBack: 0, aLat: 0, alpha: 0, vMax: 0 }
  const probe = (want) => {
    const us = allocate(ths, want)
    // honor the LIVE gimbal aims (same as flyStep) — probing with the resting dirs
    // made a ring-mounted engine look like it could only push backwards
    const aimed = us.dirs ? ths.map((th, i) => ({ ...th, dir: us.dirs[i] })) : ths
    const w = netWrench(aimed, us)
    return { a: Math.hypot(w.fx, w.fy) / M, al: Math.abs(w.tq) / I, fx: w.fx, fy: w.fy }
  }
  const f = probe({ fwd: 1, lat: 0, turn: 0 })
  const b = probe({ fwd: -1, lat: 0, turn: 0 })
  const l = probe({ fwd: 0, lat: 1, turn: 0 })
  const r = probe({ fwd: 0, lat: -1, turn: 0 })
  const tP = probe({ fwd: 0, lat: 0, turn: 1 })
  const tN = probe({ fwd: 0, lat: 0, turn: -1 })
  const t = tP.al >= tN.al ? tP : tN   // turn capability is direction-dependent (asymmetric ships): report the better side
  // direction-honest: forward accel counts only the +x component of the forward
  // probe, strafe only the ±y of the lateral probes — a diagonal thruster can't
  // fake a clean number.
  const aFwd = Math.max(0, f.fx) / M
  const totF = ths.reduce((a2, t2) => a2 + (t2.rcs ? 0 : t2.F), 0)
  const aBack = Math.max(Math.max(0, -b.fx) / M, BRAKE_FRAC * totF / M)   // thrust-dump counts as braking
  const aLat = Math.max(Math.max(0, l.fy), Math.max(0, -r.fy)) / M
  const alpha = t.al
  // top speed proxy: linear drag model v_max = a / DRAG
  const vMax = aFwd / DRAG
  return { aFwd, aBack, aLat, alpha, vMax }
}

const BRAKE_FRAC = 0.45   // thrust-dump braking: fraction of total thrust usable as pure decel
const DRAG = 0.35         // FORWARD drag (kept name: route's brake math reads it)
const DRAG_LAT = 2.8      // KEEL: sideways drag — the hull refuses to skate. This is
                                 // Istrolid's "wings": turn the nose and the keel converts
                                 // drift into the new heading. The single biggest feel fix.
const ANG_DRAG = 1.4

/** flyStep(state, tiles, want, dt) — integrate one tick of arcade flight.
 *  state: { x, y, vx, vy, th, om }  (om = angular velocity). Mutates + returns. */
function flyStep(state, tiles, want, dt) {
  const { M, com, I } = massProps(tiles)
  const ths = thrusters(tiles, com)
  const us = allocate(ths, want)
  // thruster dirs are in SHIP frame (tile poses are ship-frame): rotate wrench to world
  const aimed = us.dirs ? ths.map((th, i) => ({ ...th, dir: us.dirs[i] })) : ths
  const w = netWrench(aimed, us)

  const c = Math.cos(state.th), s = Math.sin(state.th)
  let fx = w.fx * c - w.fy * s, fy = w.fx * s + w.fy * c
  // ARCADE BRAKE (thrust-dump): a commanded decel vents main-engine power
  // straight against the velocity vector (world frame) — up to BRAKE_FRAC of
  // total thrust, no flip needed. A no-retro hull can now actually stop.
  if ((want.fwd || 0) < -0.05) {
    const sp = Math.hypot(state.vx, state.vy)
    if (sp > 1e-4) {
      const totF = ths.reduce((a, t2) => a + (t2.rcs ? 0 : t2.F), 0)
      const bF = Math.min(sp * M / Math.max(dt, 1e-4), -want.fwd * BRAKE_FRAC * totF)
      fx += -state.vx / sp * bF; fy += -state.vy / sp * bF
    }
  }
  state.vx += (fx / M) * dt; state.vy += (fy / M) * dt
  state.om += (w.tq / I) * dt
  // keel drag: damp velocity in the SHIP frame — soft along the nose, hard sideways
  {
    const vf = c * state.vx + s * state.vy, vl = -s * state.vx + c * state.vy
    const vf2 = vf - vf * DRAG * dt, vl2 = vl - vl * DRAG_LAT * dt
    state.vx = c * vf2 - s * vl2; state.vy = s * vf2 + c * vl2
  }
  state.om -= state.om * ANG_DRAG * dt
  state.x += state.vx * dt; state.y += state.vy * dt
  state.th += state.om * dt
  return { state, us, drain: ths.reduce((a, th, i) => a + th.drain * us[i], 0) }
}

  return { massProps, edgeNormal, thrusters, wrench, allocate, netWrench, envelope, flyStep, DRAG, ANG_DRAG, MOUNTS, shipMass, aimGimbal }
})()

// ── V2/energy2 (generated from energy2.mjs — edit THAT file + rerun build-engine-v2) ──
const { gridOf, newBank, powerTick, powerBudget, BROWN_GUN, BROWN_THRUST, BROWNOUT_ENTER, BROWNOUT_EXIT } = (() => {
// energy2.mjs — PENTARCH power grid: generation → batteries → consumers, with
// the brownout rule. Render-free; consumed by battle (per-powerTick) and the
// designer (power-powerBudget readout). DESIGN-ship-systems.md §3.
//
// The design axis this creates: batteries buffer BURSTS (alpha strikes beyond
// generation), but sustained deficit browns the ship out — weapons at half
// rate, thrusters at 70%. Glass cannon = big weapons + small gen + big banks.

/** gridOf(tiles) — pull the power grid from a laid-out ship.
 *  Part fields: gen (P/s), batCap, batRate (max charge/discharge P/s). */
function gridOf(tiles) {
  let gen = 0, batCap = 0, batRate = 0
  for (const t of tiles) {
    const p = t.part
    if (!p) continue
    gen += p.gen || 0
    batCap += p.batCap || 0
    batRate += p.batRate || 0
  }
  return { gen, batCap, batRate }
}

/** newBank(grid) — battery state, boots full (ships launch charged). */
const newBank = (grid) => ({ charge: grid.batCap })

const BROWNOUT_ENTER = 0.02   // bank fraction below which brownout latches
const BROWNOUT_EXIT = 0.25    // …and the recovery fraction that clears it
// hysteresis: without it the ship strobes in/out of brownout every powerTick at the
// boundary (the classic flicker); enter low, exit only after real recovery.

/** powerTick(grid, bank, demand, dt) — one power powerTick.
 *  demand: P/s requested by consumers this powerTick (weapons + thrusters).
 *  Returns { supplied (0..1 fraction of demand met), brownout } and mutates bank.
 *  Order: gen covers demand first; shortfall draws the bank (≤ batRate);
 *  surplus charges the bank (≤ batRate). */
function powerTick(grid, bank, demand, dt) {
  const genE = grid.gen * dt
  const needE = Math.max(0, demand) * dt
  let supplied = 0
  if (needE <= genE) {
    supplied = 1
    // surplus charges the bank, rate-limited
    const room = grid.batCap - bank.charge
    bank.charge += Math.min(room, Math.min(genE - needE, grid.batRate * dt))
  } else {
    const short = needE - genE
    const draw = Math.min(short, grid.batRate * dt, bank.charge)
    bank.charge -= draw
    supplied = needE > 0 ? (genE + draw) / needE : 1
  }
  // brownout latch with hysteresis on bank fraction (or no storage at all)
  const frac = grid.batCap > 0 ? bank.charge / grid.batCap : 0
  if (bank.brown) { if (frac >= BROWNOUT_EXIT) bank.brown = false }
  else if (supplied < 1 - 1e-9 && frac <= BROWNOUT_ENTER) bank.brown = true
  return { supplied, brownout: !!bank.brown }
}

/** brownout multipliers — the whole rule in one place */
const BROWN_GUN = 0.5     // weapons fire at half rate
const BROWN_THRUST = 0.7  // thrusters at 70%

/** powerBudget(tiles, consumers) — the DESIGNER readout: can this ship sustain its
 *  own appetite? consumers: [{name, drain}] steady-state P/s.
 *  → { gen, drain, margin, burstSeconds } — burstSeconds = how long full
 *  appetite runs on batteries alone once gen is exceeded (Infinity if gen covers). */
function powerBudget(tiles, consumers) {
  const grid = gridOf(tiles)
  const drain = consumers.reduce((a, c) => a + (c.drain || 0), 0)
  const margin = grid.gen - drain
  // time until the bank empties at the actual draw rate (rate-capped); if the
  // rate can't even cover the shortfall the ship browns out DURING the burst —
  // fullBurst says whether the burst runs at full power
  const short = Math.max(0, -margin)
  const draw = Math.min(short, grid.batRate)
  const burstSeconds = short === 0 ? Infinity : (draw > 0 ? grid.batCap / draw : 0)
  return { gen: grid.gen, drain, margin, burstSeconds, fullBurst: short === 0 || grid.batRate >= short }
}

  return { gridOf, newBank, powerTick, powerBudget, BROWN_GUN, BROWN_THRUST, BROWNOUT_ENTER, BROWNOUT_EXIT }
})()

// ── V2/turret (generated from turret.mjs — edit THAT file + rerun build-engine-v2) ──
const { arcOf, arcWidth, inArc, clampToArc, newMount, traverse, canFire, mountFire, mountCool, wrapAng, SECTOR_HALF, AIM_TOL } = (() => {
// turret.mjs — PENTARCH turrets: ARC EARNED BY PLACEMENT. Each FREE edge of the
// turret's tile grants a 72° firing sector centered on that edge's outward
// normal; adjacent free edges tile into one contiguous arc (36° half-widths meet
// exactly). An interior tile grants nothing — bury a turret and it is blind.
// Weapons SLOT ONTO turrets (two-layer mounts); the turret owns traverse.
// Render-free; DESIGN-ship-systems.md §2.

const ST = (2 * Math.PI) / 5
const SECTOR_HALF = Math.PI / 5   // 36° — one pentagon edge's share

const wrapAng = (a) => { let x = a % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; if (x < -Math.PI) x += 2 * Math.PI; return x }

/** arcOf(tiles, i) — the firing sectors tile i has EARNED: [{center, half}]
 *  (ship-frame angles). Empty array = blind mount (interior tile). */
function arcOf(tiles, i) {
  const free = freeEdgesV2(tiles).filter(f => f.i === i)
  return free.map(f => {
    const t = tiles[i]
    const center = t.th + Math.PI / 2 + (f.e + 0.5) * ST
    return { center: wrapAng(center), half: SECTOR_HALF }
  })
}

/** total sweep in radians (the designer's one-number readout for a mount) */
const arcWidth = (sectors) => sectors.length * 2 * SECTOR_HALF

/** inArc(sectors, ang) — may the turret aim at ship-frame angle `ang`? */
function inArc(sectors, ang) {
  return sectors.some(s => Math.abs(wrapAng(ang - s.center)) <= s.half + 1e-9)
}

/** clampToArc(sectors, ang) — the nearest permitted aim to `ang` */
function clampToArc(sectors, ang) {
  if (!sectors.length) return null
  if (inArc(sectors, ang)) return wrapAng(ang)
  let best = null, bd = Infinity
  for (const s of sectors) {
    for (const edge of [s.center - s.half, s.center + s.half]) {
      const d = Math.abs(wrapAng(ang - edge))
      if (d < bd) { bd = d; best = wrapAng(edge) }
    }
  }
  return best
}

/** newMount(tiles, i, spec) — turret state on tile i.
 *  spec: { rate (rad/s traverse), weapon: {range, damage, energyPerShot, cooldown} | null } */
function newMount(tiles, i, spec = {}) {
  const sectors = arcOf(tiles, i)
  const aim = sectors.length ? sectors[0].center : 0
  return { i, sectors, aim, rate: spec.rate ?? 2.5, weapon: spec.weapon ?? null, cd: 0 }
}

/** traverse(mount, targetAng, dt) — rate-limited swing toward the nearest
 *  permitted aim. (v1 simplification, documented: the aim may pass through a
 *  blocked zone mid-swing — the CLAMP guarantees it never RESTS or FIRES there.) */
function traverse(mount, targetAng, dt) {
  const goal = clampToArc(mount.sectors, targetAng)
  if (goal == null) return mount.aim
  const d = wrapAng(goal - mount.aim)
  const step = Math.max(-mount.rate * dt, Math.min(mount.rate * dt, d))
  mount.aim = wrapAng(mount.aim + step)
  return mount.aim
}

const AIM_TOL = 0.06   // ~3.4° — close enough to loose a shot

/** canFire(mount, targetAng, dist) — aimed on target, target in arc, in range,
 *  off cooldown. Energy is the power grid's business (energy2), not ours. */
function canFire(mount, targetAng, dist) {
  if (!mount.weapon || mount.cd > 0) return false
  if (dist > mount.weapon.range) return false
  if (!inArc(mount.sectors, targetAng)) return false
  return Math.abs(wrapAng(targetAng - mount.aim)) <= AIM_TOL
}

/** mountFire(mount) — commit a shot: returns its energy price, starts cooldown */
function mountFire(mount) {
  mount.cd = mount.weapon.cooldown
  return mount.weapon.energyPerShot
}

const mountCool = (mount, dt) => { mount.cd = Math.max(0, mount.cd - dt) }

  return { arcOf, arcWidth, inArc, clampToArc, newMount, traverse, canFire, mountFire, mountCool, wrapAng, SECTOR_HALF, AIM_TOL }
})()

// ── V2/route (generated from route.mjs — edit THAT file + rerun build-engine-v2) ──
const { arcToPoint, maxSpeedForKappa, clickCommand, resample, curvatures, speedProfile, follow, arcPath } = (() => {
// route.mjs — PENTARCH route command: click → a feasible arc to the point;
// click-HOLD → a drawn polyline fitted to WHAT IS POSSIBLE. The honest core:
// any path is traversable *slowly* (a ship can crawl a hairpin), so "possible"
// is a SPEED PROFILE — where the hull's envelope forces it to slow, and what
// the route will actually cost in time. The drawn wish renders as ghost, the
// feasible fit as solid; the gap teaches the hull. DESIGN-ship-systems.md §6.
// Render-free; consumes phys.envelope().

/** curvature demanded to arc from (pos, heading) onto target — the classic
 *  arc-to-point: κ = 2·sin(bearing)/distance (bearing = angle target sits off
 *  the nose). Sign = turn direction. */
function arcToPoint(pos, heading, target) {
  const dx = target.x - pos.x, dy = target.y - pos.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-9) return { kappa: 0, dist: 0 }
  const bearing = Math.atan2(dy, dx) - heading
  return { kappa: 2 * Math.sin(bearing) / d, dist: d }
}

/** the fastest speed at which curvature κ is holdable:
 *  lateral limit  v ≤ √(aLat/|κ|)   (centripetal budget)
 *  yaw limit      v ≤ ω_max/|κ|     (the nose must keep up; ω_max ≈ √(α)·damp) */
function maxSpeedForKappa(env, kappa) {
  const k = Math.abs(kappa)
  if (k < 1e-9) return env.vMax
  const wMax = Math.sqrt(Math.max(env.alpha, 1e-9))   // drag-limited yaw-rate proxy
  return Math.min(env.vMax, Math.sqrt(Math.max(env.aLat, 1e-9) / k), wMax / k)
}

/** arcPath(pos, heading, target, env, ds) — the actual CURVE a click plans:
 *  leaves along the CURRENT heading, bends at the arc-to-point curvature
 *  (capped to what the envelope can hold), marches to the target. This is what
 *  gets DRAWN, so the player sees the real path, not a teleport-line. */
function arcPath(pos, heading, target, env, ds = 0.45) {
  const pts = [{ x: pos.x, y: pos.y }]
  let p = { x: pos.x, y: pos.y }, h = heading
  const maxSteps = Math.ceil((arcToPoint(pos, heading, target).dist * 3 + 8) / ds)
  for (let i = 0; i < maxSteps; i++) {
    const { kappa, dist } = arcToPoint(p, h, target)
    if (dist < ds) break
    const kCap = Math.max(env && env.aLat ? env.aLat : 1, 0.4) * 1.2   // generous geometric cap
    const k = Math.max(-kCap, Math.min(kCap, kappa))
    h += k * ds
    p = { x: p.x + Math.cos(h) * ds, y: p.y + Math.sin(h) * ds }
    pts.push({ x: p.x, y: p.y })
  }
  pts.push({ x: target.x, y: target.y })
  return pts
}

/** click command → { kappa, dist, vAdvise } — steer this arc at this speed */
function clickCommand(pos, heading, target, env) {
  const { kappa, dist } = arcToPoint(pos, heading, target)
  return { kappa, dist, vAdvise: maxSpeedForKappa(env, kappa) }
}

/** resample(points, ds) — even spacing along a drawn polyline (input is raw
 *  mouse samples: jittery, uneven). */
function resample(points, ds = 0.25) {
  if (points.length < 2) return points.map(p => ({ x: p.x, y: p.y }))
  const out = [{ x: points[0].x, y: points[0].y }]
  let prev = { x: points[0].x, y: points[0].y }
  let need = ds
  for (let i = 1; i < points.length; i++) {
    const cur = { x: points[i].x, y: points[i].y }
    let seg = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    while (seg >= need && seg > 1e-12) {
      const t = need / seg
      prev = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t }
      out.push({ ...prev })
      seg = Math.hypot(cur.x - prev.x, cur.y - prev.y)
      need = ds
    }
    need -= seg
    prev = cur
  }
  const last = points[points.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 1e-9) out.push({ x: last.x, y: last.y })
  return out
}

/** curvature at each sample of a polyline (circumcircle of consecutive triplets;
 *  endpoints inherit their neighbor's). */
function curvatures(pts) {
  const n = pts.length
  const ks = new Array(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1]
    const abx = b.x - a.x, aby = b.y - a.y
    const bcx = c.x - b.x, bcy = c.y - b.y
    const cross = abx * bcy - aby * bcx
    const la = Math.hypot(abx, aby), lb = Math.hypot(bcx, bcy), lc = Math.hypot(c.x - a.x, c.y - a.y)
    const denom = la * lb * lc
    ks[i] = denom > 1e-12 ? (2 * cross) / denom : 0
  }
  if (n > 2) { ks[0] = ks[1]; ks[n - 1] = ks[n - 2] }
  return ks
}

/** speedProfile(pts, env, v0) — THE "what is possible" calculation.
 *  Three passes: curvature cap per point → forward accel ramp from v0 →
 *  backward brake ramp (arrive at rest). Returns [{x, y, v, kappa}] + eta. */
function speedProfile(pts, env, v0 = 0) {
  const n = pts.length
  if (n === 0) return { points: [], eta: 0 }
  if (n === 1) return { points: [{ ...pts[0], v: 0, kappa: 0 }], eta: 0 }
  const ks = curvatures(pts)
  const v = ks.map(k => maxSpeedForKappa(env, k))
  const ds = []
  for (let i = 0; i < n - 1; i++) ds.push(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y))
  const acc = Math.max(env.aFwd, 1e-6)
  v[0] = Math.min(v[0], Math.max(v0, 0))
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * acc * ds[i - 1]))
  v[n - 1] = 0                                        // routes END — arrive, don't fly through
  // BRAKE HONESTY: a hull with no retro thrust cannot "flip mains to brake" —
  // it decelerates on aBack + DRAG only. (The old plan promised stops the ship
  // couldn't perform → overshoot → limp-around. Buy retro JETS to go fast.)
  const DRAG_R = 0.6                                   // mirror of phys.DRAG
  for (let i = n - 2; i >= 0; i--) {
    const brakeI = Math.max(env.aBack, 1e-6) + DRAG_R * v[i + 1]
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * brakeI * ds[i]))
  }
  let eta = 0
  for (let i = 0; i < n - 1; i++) { const vm = Math.max((v[i] + v[i + 1]) / 2, 0.05); eta += ds[i] / vm }
  return { points: pts.map((p, i) => ({ x: p.x, y: p.y, v: v[i], kappa: ks[i] })), eta }
}

/** follow(state, profile, env) — the steering command for the current tick:
 *  chase the nearest-ahead profile point with the arc command at its planned
 *  speed. Returns { want:{fwd,lat,turn}, done } for phys.step/allocate.
 *  v1: bang-bang on speed error, proportional on heading — game-grade. */
function follow(state, profile, env, lookahead = 0.9) {
  const pts = profile.points
  if (!pts.length) return { want: { fwd: 0, lat: 0, turn: 0 }, done: true }
  const end = pts[pts.length - 1]
  const dEnd = Math.hypot(end.x - state.x, end.y - state.y)
  const speed = Math.hypot(state.vx, state.vy)
  if (dEnd < 0.9 && speed < 0.9) return { want: { fwd: 0, lat: 0, turn: 0 }, done: true }
  // nearest path point, then a lookahead point AHEAD of it along the path
  let ni = 0, nd = Infinity
  for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i].x - state.x, pts[i].y - state.y); if (d < nd) { nd = d; ni = i } }
  let ti = ni
  while (ti < pts.length - 1 && Math.hypot(pts[ti].x - state.x, pts[ti].y - state.y) < lookahead) ti++
  const tgt = pts[ti]
  // DESIRED VELOCITY: toward the lookahead point at the plan's speed — with a
  // floor when far off-path/route so recovery actually closes the gap (the old
  // controller crept at zero forever when the only near point was the vʼ=0 end)
  const gx = tgt.x - state.x, gy = tgt.y - state.y
  const gd = Math.hypot(gx, gy) || 1
  // floors: recovery floor when far off-path, and a DOCKING floor so the
  // v→0 endpoint never becomes an asymptote (zeno-crawl: 60s to cross 1 unit)
  let vGoal = Math.max(tgt.v, Math.min(0.7, dEnd * 0.6),
    Math.min(dEnd, nd) > 1.2 ? Math.min(2.2, (env.vMax || 2) * 0.5) : 0)
  // TURN-RADIUS CAP: near the end, speed must shrink until the nose can swing
  // inside the arrival zone (v/ω ≤ dEnd) — else the ship ORBITS the point
  // forever at its minimum turn radius (the spiral the traces kept showing)
  const omMax = Math.max(0.3, (env.alpha || 1) / 1.4)
  vGoal = Math.min(vGoal, Math.max(0.45, dEnd * omMax * 0.5))
  const vdx = gx / gd * vGoal, vdy = gy / gd * vGoal
  // PURE PURSUIT (keel-era): point the nose at the pursuit point, throttle to
  // the plan speed, let the keel turn drift into track. Reads like a ship.
  const c = Math.cos(state.th), sn = Math.sin(state.th)
  const hb = Math.atan2(vdy, vdx) - state.th
  const b = Math.atan2(Math.sin(hb), Math.cos(hb))
  const speedAlong = c * state.vx + sn * state.vy
  const fwd = Math.max(-1, Math.min(1, (vGoal - speedAlong) * 1.3)) * (Math.abs(b) < 1.9 ? 1 : 0.25)
  const lat = Math.max(-1, Math.min(1, b * 0.35))            // gentle side assist; the keel carves
  const turn = Math.max(-1, Math.min(1, b * 2.0 - state.om * 0.45))
  return { want: { fwd, lat, turn }, done: false }
}

  return { arcToPoint, maxSpeedForKappa, clickCommand, resample, curvatures, speedProfile, follow, arcPath }
})()

// ═══════════════ end V2 ═══════════════
return { makeUnit, statOf, partOf, routeGraph, aliveTiles, ringHolder, tickIncome, trySpawn, unitCost, steer, gunBeams, gunPorts, nearestEnemyTile, applyBeam, shedUnit, unitDead, starArmed, chargeStar, fireLance, enemyKey, checkWin, seatsWithUnits, allRingsHeldBy, DEFAULT_SCALE, CAPTURE_RADIUS, massProps, edgeNormal, thrusters, allocate, netWrench, envelope, flyStep, DRAG, MOUNTS, shipMass, aimGimbal, gridOf, newBank, powerTick, powerBudget, BROWN_GUN, BROWN_THRUST, arcOf, arcWidth, inArc, clampToArc, newMount, traverse, canFire, mountFire, mountCool, wrapAng, SECTOR_HALF, arcToPoint, maxSpeedForKappa, clickCommand, resample, curvatures, speedProfile, follow, arcPath, freeEdgesV2, SPECIALS, holeKey, shapePayout };
})();