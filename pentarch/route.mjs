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
export function arcToPoint(pos, heading, target) {
  const dx = target.x - pos.x, dy = target.y - pos.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-9) return { kappa: 0, dist: 0 }
  const bearing = Math.atan2(dy, dx) - heading
  return { kappa: 2 * Math.sin(bearing) / d, dist: d }
}

/** the fastest speed at which curvature κ is holdable:
 *  lateral limit  v ≤ √(aLat/|κ|)   (centripetal budget)
 *  yaw limit      v ≤ ω_max/|κ|     (the nose must keep up; ω_max ≈ √(α)·damp) */
export function maxSpeedForKappa(env, kappa) {
  const k = Math.abs(kappa)
  if (k < 1e-9) return env.vMax
  const wMax = Math.sqrt(Math.max(env.alpha, 1e-9))   // drag-limited yaw-rate proxy
  return Math.min(env.vMax, Math.sqrt(Math.max(env.aLat, 1e-9) / k), wMax / k)
}

/** arcPath(pos, heading, target, env, ds) — the actual CURVE a click plans:
 *  leaves along the CURRENT heading, bends at the arc-to-point curvature
 *  (capped to what the envelope can hold), marches to the target. This is what
 *  gets DRAWN, so the player sees the real path, not a teleport-line. */
export function arcPath(pos, heading, target, env, ds = 0.45) {
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
export function clickCommand(pos, heading, target, env) {
  const { kappa, dist } = arcToPoint(pos, heading, target)
  return { kappa, dist, vAdvise: maxSpeedForKappa(env, kappa) }
}

/** resample(points, ds) — even spacing along a drawn polyline (input is raw
 *  mouse samples: jittery, uneven). */
export function resample(points, ds = 0.25) {
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
export function curvatures(pts) {
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
export function speedProfile(pts, env, v0 = 0) {
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
export function follow(state, profile, env, lookahead = 0.9) {
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
