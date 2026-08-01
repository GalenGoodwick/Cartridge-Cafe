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
export const MOUNTS = {
  fixed:  { half: 0,                cost: 0,  mass: 0   },
  swivel: { half: Math.PI / 5,      cost: 8,  mass: 0.3 },   // ±36°
  wide:   { half: Math.PI / 2,      cost: 18, mass: 0.6 },   // ±90°
  ring:   { half: Math.PI,          cost: 34, mass: 1.0 },   // 360°
}

/** shipMass(tiles) — THE WEIGHT ALGORITHM, explicit: every tile weighs its part
 *  mass + its mount's machinery + its module. One place, one truth; massProps
 *  consumes its output. tiles may carry { mass, mount, moduleMass }. */
export function shipMass(tiles) {
  return tiles.map(t => ({
    ...t,
    mass: (t.mass ?? 1) + (MOUNTS[t.mount] ? MOUNTS[t.mount].mass : 0) + (t.moduleMass || 0),
  }))
}

/** the world-frame direction of tile t's edge-o normal (same ena as penta-core) */
export function edgeNormal(t, o) {
  const a = t.th + Math.PI / 2 + (o + 0.5) * ST
  return { x: Math.cos(a), y: Math.sin(a) }
}

/** massProps(tiles) — tiles: [{cx,cy,mass}] → { M, com:{x,y}, I }
 *  I about the COM, point-mass model (tile size ~1: adequate, tested). */
export function massProps(tiles) {
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
export function thrusters(tiles, com) {
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
export function aimGimbal(th, gx, gy) {
  if (!th.F || !(th.half > 0)) return th.dir
  const wantA = Math.atan2(gy, gx)
  const d = wrapA(wantA - th.ang)
  const a = th.ang + Math.max(-th.half, Math.min(th.half, d))
  return { x: Math.cos(a), y: Math.sin(a) }
}

/** wrench of one thruster at throttle u: { fx, fy, tq } (tq includes lever torque) */
export function wrench(th, u) {
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
export function allocate(ths, want) {
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
    const STEP = 0.6 * Math.pow(0.78, it)   // DAMPED — a fixed step oscillates and can land on 0
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
  us.dirs = dirs                                            // live aims ride along (plumes + step)
  return us
}

/** net wrench for a throttle vector */
export function netWrench(ths, us) {
  let fx = 0, fy = 0, tq = 0
  for (let i = 0; i < ths.length; i++) { const w = wrench(ths[i], us[i]); fx += w.fx; fy += w.fy; tq += w.tq }
  return { fx, fy, tq }
}

/** envelope(tiles) — THE designer readout. What this hull can actually do:
 *  { aFwd, aBack, aLat, alpha, vMax } accelerations (per unit mass) + a top
 *  speed proxy. Rotating one part changes these numbers — that's the feature. */
export function envelope(tiles) {
  const { M, com, I } = massProps(tiles)
  const ths = thrusters(tiles, com)
  if (!ths.length || M <= 0) return { aFwd: 0, aBack: 0, aLat: 0, alpha: 0, vMax: 0 }
  const probe = (want) => {
    const us = allocate(ths, want)
    // honor the LIVE gimbal aims (same as step) — probing with the resting dirs
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

export const BRAKE_FRAC = 0.45   // thrust-dump braking: fraction of total thrust usable as pure decel
export const DRAG = 0.35         // FORWARD drag (kept name: route's brake math reads it)
export const DRAG_LAT = 2.8      // KEEL: sideways drag — the hull refuses to skate. This is
                                 // Istrolid's "wings": turn the nose and the keel converts
                                 // drift into the new heading. The single biggest feel fix.
export const ANG_DRAG = 1.4

/** step(state, tiles, want, dt) — integrate one tick of arcade flight.
 *  state: { x, y, vx, vy, th, om }  (om = angular velocity). Mutates + returns. */
export function step(state, tiles, want, dt) {
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
