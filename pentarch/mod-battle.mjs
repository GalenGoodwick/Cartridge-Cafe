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

import { aliveTiles, reachableFrom, makeUnit } from './hull.mjs'
import { holes } from './penta-holes.mjs'
import { edgeNormalAngle, edgeMidpoint, contacts } from './penta-core.mjs'
import { partOf } from './parts.mjs'

// Ordered fragment registry — each mechanic node adds exactly its own key.
const B = {}

// ── tuning (bt-damage owns these combat constants) ───────────────────────────
export const BEAM_DMG = 12          // default per-shot damage a gun beam deals
export const STAR_CHARGE_RATE = 0.15 // charge/sec while the star is armed (~6.7s)
export const STAR_RADIUS = 0.35     // AoE radius of the lance (world units)
export const STAR_DMG = 40          // damage the lance deals to every tile in radius
export const DEFAULT_SCALE = 0.06   // hull-unit → world-unit (matches battle draw)

// ── bt-econ tuning (capture rings + income + spawn) ──────────────────────────
export const CAPTURE_RADIUS = 0.28  // world units: a unit within this of a ring holds it
export const RING_RATE = 2.0        // ⬡/sec a SOLE-held ring pays its holder
export const TRICKLE = 0.4          // ⬡/sec passive income every seat gets (never fully shut out)

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
export function ringHolder(ring, units, radius = CAPTURE_RADIUS) {
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
export function tickIncome(bt, dt, opts = {}) {
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
export function unitCost(design) { return makeUnit(design).cost }

/** trySpawn(bt, seat, design, opts) — if `seat` can afford `design`, deduct its
 *  cost from bt.income, makeUnit it at the seat's home dock (bt.docks[seat]), push
 *  it onto bt.units, and return the unit; else null (unaffordable / empty design). */
export function trySpawn(bt, seat, design, opts = {}) {
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
export function enemyKey(u) { return u.seat != null ? u.seat : u.owner }

/** tileWorldPos(unit, i, scale) — tile i's centre in WORLD space: rotate the
 *  hull-local pose by the unit heading and translate to the unit position.
 *  scale = world units per hull-unit (battle's draw scale). */
export function tileWorldPos(unit, i, scale = DEFAULT_SCALE) {
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
export function nearestEnemyTile(attacker, units, opts = {}) {
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
export function applyBeam(unit, tileIdx, dmg = BEAM_DMG) {
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
export function shedUnit(unit) {
  const alive = aliveTiles(unit)               // reachable-from-0, hp>0
  for (let i = 0; i < unit.tileHp.length; i++) {
    if (unit.tileHp[i] > 0 && !alive.has(i)) unit.tileHp[i] = 0   // orphan → shear
  }
  return alive
}

/** unitDead(unit) — no tile survives (tile-0 gone, or every tile at 0). */
export function unitDead(unit) { return aliveTiles(unit).size === 0 }

/** starArmed(unit) — the super-weapon is ready to charge iff the hull was built
 *  with a STAR hole (hull.hasStar) AND that pentagram is STILL SEALED in the
 *  currently-alive tiles. Any tile on the star boundary dying re-opens the hole
 *  → disarmed. Recomputes holes() over just the live tiles (geometry inlined in
 *  the hook; imported here for the test). */
export function starArmed(unit) {
  if (!unit || !unit.hasStar) return false
  const alive = aliveTiles(unit)
  if (!alive.size) return false
  const sub = [...alive].map((i) => unit.tiles[i])
  return holes(sub).some((h) => h.shape === 'star')
}

/** chargeStar(unit, dt, rate?) — advance the lance charge while armed (caps at
 *  1 = ready); a disarmed star bleeds its charge to 0. Returns the new charge. */
export function chargeStar(unit, dt, rate = STAR_CHARGE_RATE) {
  if (!starArmed(unit)) { unit.starCharge = 0; return 0 }
  unit.starCharge = Math.min(1, (unit.starCharge || 0) + Math.max(0, dt) * rate)
  return unit.starCharge
}

/** fireLance(attacker, units, opts?) — discharge a fully-charged, armed star as
 *  an AoE lance centred on opts.center (default the nearest enemy unit's centre).
 *  Every alive ENEMY tile within opts.radius takes opts.dmg, then each hit unit
 *  sheds. Resets the charge to 0. Returns the array of {unit, tileIdx} hits, or
 *  null when the star is not armed / not charged / has no target. */
export function fireLance(attacker, units, opts = {}) {
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

export const GUN_PART = 3          // parts.mjs code for a GUN tile
export const FIRE_PERIOD = 0.8     // seconds between a gun's shots at full power
export const GUN_DMG = 6           // damage a single gun beam deals (matches GUN dps)

/** angDiff(a,b) — the signed shortest angular delta from heading a to heading b,
 *  wrapped to (-π, π]. Positive = turn counter-clockwise. */
export function angDiff(a, b) {
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
export function steer(unit, tx, ty, dt, opts = {}) {
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
export function edgeUsage(tiles) {
  const used = new Set()
  for (const c of contacts(tiles)) { used.add(c.i + ':' + c.ei); used.add(c.j + ':' + c.ej) }
  return used
}

/** outwardEdge(unit, i) — the single OUTWARD free edge of tile i: the free (not
 *  contacted) edge whose normal points most away from the hull centre (tile 0).
 *  This is the firing arc a perimeter gun shoots along. Returns the edge index,
 *  or -1 if the tile has no free edge (fully enclosed — it cannot fire out). */
export function outwardEdge(unit, i) {
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
export function gunPorts(unit, scale = DEFAULT_SCALE) {
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
export function fireInterval(unit, period = FIRE_PERIOD) {
  const brown = unit && unit.stats ? !!unit.stats.brownout : false
  return brown ? period * 2 : period
}

/** gunBeams(unit, dt, opts?) — advance the unit's gun cooldown and, on the tick
 *  it elapses, return one beam per gun port ({seat, ox, oy, dmg, dir}) for
 *  bt-damage to resolve; most ticks it returns []. Mutates unit.__cool. A gunless
 *  or fully-dead unit never fires. Brownout stretches the interval (fireInterval).
 *  opts: {scale, period, dmg}. */
export function gunBeams(unit, dt, opts = {}) {
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
export const RING_HOLD_TIME = 30   // seconds one seat must hold ALL rings to win

/** seatsWithUnits(bt) — the set of seats that currently have at least one alive unit. */
export function seatsWithUnits(bt) {
  const s = new Set()
  for (const u of bt.units || []) if (!unitDead(u)) s.add(enemyKey(u))
  return s
}

/** allRingsHeldBy(bt, seat) — true iff there is ≥1 ring and every ring is owned by seat. */
export function allRingsHeldBy(bt, seat) {
  const R = bt.rings || []
  return R.length > 0 && R.every((r) => r.owner === seat)
}

/** checkWin(bt, dt, opts?) — advance the domination timer and test victory.
 *  DOMINATION: a seat holding ALL rings continuously for opts.holdTime wins.
 *  ELIMINATION: once ≥2 seats have fielded a unit (bt.combatStarted latches), the
 *  last seat with a living unit wins. Returns the winning seat or null; mutates
 *  bt.holdSeat/holdT/combatStarted. */
export function checkWin(bt, dt, opts = {}) {
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
export const SRC = ['econ', 'move', 'damage', 'win']
  .map((k) => B[k] || '')
  .join('\n')

// Also expose the raw fragment registry so a later assembler / integrate node
// (or a sibling battle slice) can compose or introspect individual fragments.
export const FRAGMENTS = B
