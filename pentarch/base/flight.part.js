  // ── BATTLE MODE (press B) — drive your designed hull. Reuses the tile codes the
  //    designer shader already draws; the drawn-from-stage ENG runs the sim. ──
  if (sim.edge("to-battle", !!wd.key_b)) { D.mode = (D.mode === "battle") ? "design" : "battle"; D.bt = null }
  if (D.mode === "battle") {
    // ── BATTLE V2 (DESIGN-ship-systems.md): the tested phys/energy/route stack
    //    flies YOUR hull. CLICK → a feasible route to the point. HOLD + drag →
    //    draw a route; the ship flies WHAT IS POSSIBLE (speed profile: slows
    //    into corners, arrives at rest). Power: thrusters drain the grid;
    //    sustained deficit browns the drives to 70%. ──
    const psig = D.tree.map(d2 => (d2.part || 0) + ':' + (d2.o || 0) + ':' + (d2.m || 0)).join(',')
    if (!D.bt || D.bt.rev !== D.rev || D.bt.psig !== psig) {
      const u0 = ENG.makeUnit(D.tree, { seat: 0, x: 0, y: 0, shapeChoices: D.shapeChoices })
      const pT2 = u0.tiles.map((t, i) => { const cd = D.tree[i] || {}; const sp = i === 0 ? {} : (V2SPEC[cd.part] || {})
        const st = (PARTS[cd.part] || PARTS[0]).stat
        const mnt = ['fixed', 'swivel', 'wide', 'ring'][cd.m || 0]
        return { cx: t.cx, cy: t.cy, th: t.th, o: cd.o || 0, mount: mnt, mass: (i === 0 ? 1.2 : st.mass) + ((ENG.MOUNTS[mnt] || {}).mass || 0),
          part: i === 0 ? { torque: 1.2, drain: 0 } : (sp.thrust || sp.torque) ? { thrust: sp.thrust || 0, torque: sp.torque || 0, drain: sp.drain || 0 } : null } })
      const grid = { gen: 1, batCap: 10 + (u0.battery || 0), batRate: 6 }   // CORE base + CELL specials
      for (let gi = 1; gi < D.tree.length; gi++) { const sp = V2SPEC[D.tree[gi].part] || {}; grid.gen += sp.gen || 0; grid.batCap += sp.batCap || 0; grid.batRate += sp.batRate || 0 }
      // WEAPON MOUNTS — the arc is what you BOUGHT, centered on the facing.
      // Hull blocking is a TRUE ray test at fire time (the old sector model
      // waffle-blocked whole 72° wedges that the ray actually cleared).
      const mounts = []
      for (let i = 0; i < D.tree.length; i++) {
        const cd = D.tree[i] || {}, sp = i === 0 ? {} : (V2SPEC[cd.part] || {})
        if (!sp.weapon || !u0.tiles[i]) continue
        const face = u0.tiles[i].th + Math.PI / 2 + ((cd.o || 0) + 0.5) * (2 * Math.PI / 5)
        const H = (ENG.MOUNTS[['fixed', 'swivel', 'wide', 'ring'][cd.m || 0]] || {}).half || 0
        const eff = [{ center: face, half: Math.max(0.07, H) }]
        mounts.push({ i, sectors: eff, aim: face, rate: 3.0, weapon: sp.weapon, cd: 0 })
      }
      const ev0 = ENG.envelope(pT2)
      // ── ARCADE FLIGHT STATS (Galen's model) — the PART TYPE sets the stat, not
      //    the mounting angle (a pentagon hull can't point an engine dead-aft, so
      //    directional thrust made W barely move). ENGINES = forward SPEED · JETS =
      //    strafe AND reverse · GYROS = turn. Orientation is cosmetic (the plume).
      //    The CORE grants the floor so a bare helm still crawls + turns. ──
      const mass0 = Math.max(0.5, ENG.massProps(pT2).M || 1)   // was .m (typo) — armor/mounts never weighed the ship
      // M (mount tier) on an ENGINE/JET buys it a wider GIMBAL — a swiveled
      // thruster is vectored for more effective thrust, not just a wider aim
      // cone (which is all M used to do for guns). fixed→1.0, swivel→1.15,
      // wide→1.35, ring→1.6 — matches the tier's arc, gives M real teeth here.
      const GIMBAL_BONUS = [1.0, 1.15, 1.35, 1.6]
      let engThrust = 0, jetThrust = 0, gyroTq = 0
      for (let gi = 1; gi < D.tree.length; gi++) {
        const cd2 = D.tree[gi], p = cd2.part, sp = V2SPEC[p] || {}
        const gb = GIMBAL_BONUS[cd2.m || 0] || 1
        if (p === 4) engThrust += (sp.thrust || 0) * gb      // ENGINE → forward
        else if (p === 6) jetThrust += (sp.thrust || 0) * gb // JET → strafe + reverse
        else if (p === 7) gyroTq += sp.torque || 0           // GYRO → turn
      }
      const twE = engThrust / mass0, twJ = jetThrust / mass0
      const ARC = {
        turn: 1.1 + 0.5 * ev0.alpha + gyroTq / mass0 * 0.6, // CORE base 1.1, gyros add
        acc: Math.max(0.8, twE * 3.2),                      // engines = forward accel (CORE crawl floor 0.8)
        vmax: Math.max(1.4, 1.2 + twE * 2.6),               // engines = top speed
        strafe: 0.9 + twJ * 3.0,                            // jets = strafe (CORE base 0.9)
        canReverse: jetThrust > 0.1,                        // ONLY jets can push the ship backwards
        revMax: Math.min(3.0, twJ * 2.2),                   // reverse speed cap (jet-limited)
      }
      ARC.brake = Math.max(ARC.acc * 1.1, 1.2)
      D.bt = { unit: u0, rev: D.rev, psig, pT: pT2, ev: ev0, ARC, grid, mounts,
        kills: (D.bt && D.bt.kills) || 0, seed: (D.bt && D.bt.seed) || 12345,
        ths: ENG.thrusters(pT2, ENG.massProps(pT2).com),
        // SPAWN FACING UP: fly.th is the FORWARD/velocity heading — simple, one
        // number, no offset threaded through navigation. The hull DRAW angle adds
        // a fixed BODY_OFFSET (below) so the ship still renders in its design pose;
        // that offset is applied in exactly one place (the draw loop), not here.
        bank: ENG.newBank(grid), fly: { x: 0, y: 0, vx: 0, vy: 0, th: -Math.PI / 2, om: 0 }, route: null, holding: null, lastDrain: 0 }
    }
    const B = D.bt, u = B.unit
    // FLIGHT ZOOM: much wider than the yard — testing routes needs sky.
    // [ and ] step the zoom; defaults far out.
    if (sim.edge('zoom-in', !!wd.key_bracketright)) D.bzoom = Math.min(0.20, (D.bzoom || 0.055) * 1.35)
    if (sim.edge('zoom-out', !!wd.key_bracketleft)) D.bzoom = Math.max(0.02, (D.bzoom || 0.055) / 1.35)
    const BS = D.bzoom || 0.055
    const ptrB = (wd.input && wd.input.pointer) || {}
    const mxB = (typeof ptrB.x === "number") ? ptrB.x : wd.mouse_x, myB = (typeof ptrB.y === "number") ? ptrB.y : wd.mouse_y
    const cuxB = (typeof mxB === "number") ? mxB / 256 - 1 : 0, cuyB = (typeof myB === "number") ? myB / 256 - 1 : 0
    const wxP = cuxB / BS, wyP = cuyB / BS                    // pointer, battle-world units
    const down = !!ptrB.down || wd.mouse_down === true
    // ── RIGHT-CLICK: STRAFE to a point, holding CURRENT facing — the ship
    //    keeps its nose (and guns) trained where it already points while it
    //    repositions, instead of turning to face travel direction like the
    //    left-click route does. A simple press/release (no drag-to-face; a
    //    strafe run has nothing to face). Cancels any active route. ──
    const downR = wd.mouse_down_right === true
    if (downR && !B.holdingR) B.holdingR = true
    else if (!downR && B.holdingR) {
      B.holdingR = false
      B.route = null; B.queue = []; B.arriveFace = null
      B.strafeTarget = { x: wxP, y: wyP }
      wd.__play_sound = [{ frequency: 500, duration: 0.06, volume: 0.09, type: 'triangle' }]
    }
    // ── route input: tap = fly there (real CURVE, drawn) · tap+drag = set the
    //    ARRIVAL FACING · SHIFT-click = queue waypoints · big drag = draw route ──
    if (down && !B.holding) { B.holding = { t0: D.t, pts: [{ x: wxP, y: wyP }], shift: !!wd.key_shift }; B.strafeTarget = null }
    else if (down && B.holding) { const hp = B.holding.pts, lp = hp[hp.length - 1]; if (Math.hypot(wxP - lp.x, wyP - lp.y) > 0.35) hp.push({ x: wxP, y: wyP }) }
    else if (!down && B.holding) {
      const h = B.holding; B.holding = null
      const p0 = h.pts[0], pn = h.pts[h.pts.length - 1]
      let span = 0; for (const q of h.pts) span = Math.max(span, Math.hypot(q.x - p0.x, q.y - p0.y))
      if (h.pts.length >= 3 && span > 3.0) {
        // DRAWN route (the wish, fitted to what is possible)
        B.queue = []
        B.route = ENG.speedProfile(ENG.resample([{ x: B.fly.x, y: B.fly.y }, ...h.pts], 0.5), B.ev, Math.hypot(B.fly.vx, B.fly.vy))
        B.arriveFace = null
      } else {
        // waypoint: click point + (optional) drag direction = arrival facing
        const wp = { x: p0.x, y: p0.y, face: span > 0.6 ? Math.atan2(pn.y - p0.y, pn.x - p0.x) : null }
        if (h.shift) { B.queue = B.queue || []; B.queue.push(wp) } else B.queue = [wp]
        // IDEAL PATH (Galen): the ship can't pivot on a dime — it leaves along its
        // CURRENT nose heading and BENDS at the arc-to-point curvature the hull's
        // envelope can actually hold (route.arcPath). The drawn curve is the real
        // route, not a teleport-line. A facing waypoint gets a short straight
        // approach leg so the ship arrives ALONG the chosen heading.
        // arcPath's curvature cap must reflect what THIS ship can actually turn —
        // B.ev is the OLD physics envelope, a DIFFERENT model from the arcade ARC
        // that actually flies it. Planning a curve B.ev allows but ARC can't hold
        // made the ship endlessly overshoot + orbit a sideways (~90° bearing)
        // target instead of arriving (Galen: destination-click verification).
        const arcadeEnv = { aLat: B.ARC.turn * B.ARC.vmax, alpha: B.ARC.turn, vMax: B.ARC.vmax }
        let pts = [{ x: B.fly.x, y: B.fly.y }], pos = pts[0], head = B.fly.th
        for (let qi = 0; qi < B.queue.length; qi++) {
          const q = B.queue[qi]
          const isLast = qi === B.queue.length - 1
          const tgt2 = (isLast && q.face != null) ? { x: q.x - Math.cos(q.face) * 1.6, y: q.y - Math.sin(q.face) * 1.6 } : q
          const leg = ENG.arcPath(pos, head, tgt2, arcadeEnv)   // the curve the hull can hold
          pts = pts.concat(leg.slice(1))
          if (leg.length >= 2) { const a = leg[leg.length - 2], b = leg[leg.length - 1]; head = Math.atan2(b.y - a.y, b.x - a.x) }
          pos = tgt2
          if (isLast && q.face != null) { pts = pts.concat(ENG.resample([pos, { x: q.x, y: q.y }], 0.4).slice(1)) }
        }
        B.route = ENG.speedProfile(pts, arcadeEnv, Math.hypot(B.fly.vx, B.fly.vy))
        B.arriveFace = (B.queue.length && B.queue[B.queue.length - 1].face != null) ? B.queue[B.queue.length - 1].face : null
      }
      wd.__play_sound = [{ frequency: 620, duration: 0.07, volume: 0.1, type: 'sine' }]
    }
    // ── fly: WASD hand-flying overrides the autopilot. W/S = ahead/astern,
    //    A/D = STRAFE left/right, Q/E = ROTATE (Galen's convention). Manual is a
    //    VELOCITY SERVO, not raw thrust — W holds a dead-straight track down the
    //    nose even with tilted pentagon engines (the servo cancels the wobble). ──
    // ═══ ARCADE FLIGHT CORE (radical simplification, Galen's call) ═══
    // One rate-limited heading + one speed servo + direct strafe. Deterministic,
    // crisp, nothing to oscillate. The BUILD still rules — via ARC stats.
    const dtB = Math.min(dt, 1 / 30)
    const A2 = B.ARC
    const wrapA2 = (a) => Math.atan2(Math.sin(a), Math.cos(a))
    let thDes = B.fly.th, vDes = 0, strafeCmd = 0, rotCmd = 0
    // W/S ahead-astern · A/D strafe (A=LEFT of the nose) · Q/E rotate (Q=turn LEFT,
    // CCW on screen). All relative to the CORE's nose. Screen +y is DOWN, so the
    // strafe axis (−s9,c9) points RIGHT of the nose → A must be −1 to go left, and
    // a positive rotCmd swings the nose right (CW) → Q must be −1 to turn left.
    const mf = (wd.key_w ? 1 : 0) - (wd.key_s ? 1 : 0)
    const ml = (wd.key_d ? 1 : 0) - (wd.key_a ? 1 : 0)   // +1 = strafe RIGHT (D)
    const mr = (wd.key_e ? 1 : 0) - (wd.key_q ? 1 : 0)   // +1 = turn right (E)
    // FORWARD-ONLY by default (Galen): W drives along the nose. S REVERSES only if
    // the ship carries JETS (the only thrusters that can push it backwards) —
    // otherwise S is a BRAKE, not reverse.
    if (mf || ml || mr) {                                   // hand-flying
      B.route = null; B.queue = []; B.arriveFace = null; B.strafeTarget = null
      vDes = mf > 0 ? A2.vmax
        : mf < 0 ? (A2.canReverse ? -A2.revMax : 0)         // no jets → S brakes to 0
          : 0
      strafeCmd = ml
      rotCmd = mr
    } else if (B.strafeTarget) {                             // RIGHT-CLICK STRAFE RUN
      // hold the CURRENT heading (thDes already defaults to B.fly.th above —
      // never reassigned here, so no turning) and decompose the vector to the
      // target into this fixed frame's forward/lateral axes, driving BOTH at
      // once (a real strafe run, not a turn-then-burn).
      const dxT = B.strafeTarget.x - B.fly.x, dyT = B.strafeTarget.y - B.fly.y
      const distT = Math.hypot(dxT, dyT)
      if (distT < 0.85) {
        B.strafeTarget = null
        B.fly.v = 0; B.fly.vx = 0; B.fly.vy = 0                // hard stop, same arrival law as route
        wd.__play_sound = [{ frequency: 520, duration: 0.1, volume: 0.1, type: 'sine' }]
      } else {
        const fcx = Math.cos(B.fly.th), fcy = Math.sin(B.fly.th)          // fixed forward axis
        const rcxT = Math.cos(B.fly.th + Math.PI / 2), rcyT = Math.sin(B.fly.th + Math.PI / 2)  // fixed strafe-right axis
        const alongT = (dxT * fcx + dyT * fcy) / distT                     // unit-vector components
        const lateralT = (dxT * rcxT + dyT * rcyT) / distT
        const brakeDistT = (A2.vmax * A2.vmax) / Math.max(2 * A2.brake, 0.1)
        const speedCmd = distT > brakeDistT ? A2.vmax : Math.max(0.5, Math.sqrt(2 * A2.brake * distT))
        vDes = alongT * speedCmd
        strafeCmd = Math.max(-1, Math.min(1, lateralT * speedCmd / Math.max(A2.strafe, 0.1)))
      }
    } else if (B.route) {                                   // waypoint walk
      const pts9 = B.route.pts || (B.route.points || []).map(q => ({ x: q.x, y: q.y }))
      B.route.pts = pts9
      const dEnd9 = Math.hypot(pts9[pts9.length - 1].x - B.fly.x, pts9[pts9.length - 1].y - B.fly.y)
      // ARRIVAL (Galen: "destination overlap with core and proper facing is
      // enough" — don't require a slow coast-to-zero). Overlap with the CORE
      // is a generous radius (~0.85, the tile's own circumradius, matching the
      // pixel-true convention used elsewhere) combined with a loose facing
      // check; once both hold, STOP HARD (zero velocity now) instead of only
      // clearing the route and letting momentum carry the ship past the point
      // while it slowly brakes (that residual coast IS the "not stopping" bug).
      const endHead9 = pts9.length >= 2 ? Math.atan2(pts9[pts9.length - 1].y - pts9[pts9.length - 2].y, pts9[pts9.length - 1].x - pts9[pts9.length - 2].x) : B.fly.th
      const faceOk9 = Math.abs(wrapA2(endHead9 - B.fly.th)) < 0.6
      if (dEnd9 < 0.85 && faceOk9) {
        B.route = null; B.queue = []
        B.fly.v = 0; B.fly.vx = 0; B.fly.vy = 0                // hard stop — no coasting past the point
        if (B.arriveFace == null) wd.__play_sound = [{ frequency: 520, duration: 0.1, volume: 0.1, type: 'sine' }]
      } else {
        // TRUE NEAREST POINT, re-found EVERY tick (not a monotonic stored index):
        // a stored "consumed up to here" index can get stuck if the ship swings
        // wide of the path (overshoots a turn) — it never re-anchors, so the
        // lookahead search (which only walks FORWARD from that stale index) kept
        // aiming at a point behind the ship's actual position, and the ship
        // orbited it forever instead of converging (Galen: destination-click
        // verification — a sideways/~90° target never arrived). Re-scanning is
        // cheap (route arrays are small) and self-corrects from ANY position.
        let ni = 0, nd = Infinity
        for (let k = 0; k < pts9.length; k++) { const dd = Math.hypot(pts9[k].x - B.fly.x, pts9[k].y - B.fly.y); if (dd < nd) { nd = dd; ni = k } }
        // LOOKAHEAD (Galen: node-snapping made the ship jiggle): resample nodes
        // sit only 0.4-0.5 apart, so aiming at the immediate next one re-targets
        // in small jumps as each is consumed. Aim further down the path instead —
        // a fixed lookahead distance gives a smoothly-changing heading (pure-
        // pursuit), a "constant vector" rather than a snap between close nodes.
        const LOOK = 1.3
        let li = ni
        while (li < pts9.length - 1 && Math.hypot(pts9[li].x - B.fly.x, pts9[li].y - B.fly.y) < LOOK) li++
        const wp9 = pts9[li]
        thDes = Math.atan2(wp9.y - B.fly.y, wp9.x - B.fly.x)
        // FULL vmax until actually inside braking distance, THEN decelerate
        // (v=√(2·brake·d)) — the old `dEnd*1.1` formula capped speed by remaining
        // distance for the WHOLE trip, so short/close-up hops never left a crawl
        // (Galen: "pathfinding close up is broken"). Braking distance comes from
        // the ship's own real brake rate, so heavier/weaker ships brake sooner.
        const faceErr9 = Math.abs(wrapA2(thDes - B.fly.th))
        const brakeDist9 = (A2.vmax * A2.vmax) / Math.max(2 * A2.brake, 0.1)
        // SPEED MUST RESPECT THE IMMEDIATE TURN, not just distance-to-endpoint —
        // a smooth cosine falloff on facing error slows the ship BEFORE a sharp
        // turn, instead of staying near vmax and swinging wide of it.
        const turnSpeedCap = Math.max(0.4, Math.cos(faceErr9)) * A2.vmax
        vDes = Math.min(turnSpeedCap, dEnd9 > brakeDist9 ? A2.vmax : Math.max(0.5, Math.sqrt(2 * A2.brake * dEnd9)))
      }
    } else if (B.arriveFace != null) {                      // hold the promised facing
      thDes = B.arriveFace; vDes = 0
      if (Math.abs(wrapA2(B.arriveFace - B.fly.th)) < 0.1) { B.arriveFace = null; wd.__play_sound = [{ frequency: 520, duration: 0.1, volume: 0.1, type: 'sine' }] }
    }
    // power gate, then integrate
    const pw = ENG.powerTick(B.grid, B.bank, B.lastDrain, dtB)
    const bf = pw.brownout ? ENG.BROWN_THRUST : 1
    const dTh = rotCmd !== 0 ? rotCmd * A2.turn * dtB : Math.max(-A2.turn * dtB, Math.min(A2.turn * dtB, wrapA2(thDes - B.fly.th)))
    B.fly.th = wrapA2(B.fly.th + dTh * bf)
    const dv = vDes * bf - (B.fly.v || 0)
    const rate = (Math.abs(vDes) < Math.abs(B.fly.v || 0) || (vDes * (B.fly.v || 0) < 0)) ? A2.brake : A2.acc
    B.fly.v = (B.fly.v || 0) + Math.max(-rate * dtB, Math.min(rate * dtB, dv)) * bf
    // SIMPLE: fly.th IS forward (the velocity axis) — one number, no offset here.
    // BODY_OFFSET (applied only in the draw loop, below) keeps the hull rendered
    // in its design pose without touching any of this navigation math.
    const c9 = Math.cos(B.fly.th), s9 = Math.sin(B.fly.th)
    B.fly.x += c9 * B.fly.v * dtB - s9 * (strafeCmd * A2.strafe * bf) * dtB
    B.fly.y += s9 * B.fly.v * dtB + c9 * (strafeCmd * A2.strafe * bf) * dtB
    B.fly.vx = c9 * B.fly.v; B.fly.vy = s9 * B.fly.v       // derived (beams/HUD read these)
    B.fly.om = dTh / Math.max(dtB, 1e-4)
    // engine effort for plumes + power drain: how hard are we pushing?
    const effort = Math.max(0, Math.min(1, Math.abs(dv) > 0.02 ? 1 : Math.abs(B.fly.v) / Math.max(A2.vmax, 0.1) * 0.35))
    const engDrain = B.pT.reduce((a9, t9) => a9 + ((t9.part && t9.part.drain) || 0), 0)
    const st2 = { us: [], drain: engDrain * effort }
    B.__effort = effort; B.__turning = Math.abs(dTh) > 0.002 ? Math.sign(dTh) : 0; B.__strafe = strafeCmd
    // ── THE TARGETS: a small drone squadron to shoot at — a BATTLEFIELD, not a
    //    lone respawning dummy (Galen's multi-ship ask, lighter slice: several
    //    hostiles live at once rather than the fleet-buy/select system, which
    //    is its own larger feature). Deterministic LCG placement (no
    //    Math.random — replayable). Each dies tile by tile (applyBeam +
    //    route-shed); a fresh one spawns further out to keep TARGET_N alive. ──
    const TARGET_N = 3
    const rnd = () => { B.seed = (B.seed * 1664525 + 1013904223) >>> 0; return B.seed / 4294967296 }
    if (!B.targets) B.targets = B.target ? [B.target] : []   // carry over a battle-state saved before this change
    for (let ti = B.targets.length - 1; ti >= 0; ti--) if (ENG.unitDead(B.targets[ti])) {
      B.kills++; wd.__play_sound = [{ frequency: 240, duration: 0.25, volume: 0.16, type: 'sawtooth' }, { frequency: 160, duration: 0.3, volume: 0.12, type: 'triangle' }]
      B.targets.splice(ti, 1)
    }
    while (B.targets.length < TARGET_N) {
      const seq = [2, 2, 1, 3, 2]
      const tt = [{ parent: -1, edge: -1, part: 2 }]
      for (const e2 of seq) tt.push({ parent: tt.length - 1, edge: e2, part: tt.length % 3 === 0 ? 2 : 1 })
      const ang = rnd() * 6.2831853, dd = 9 + rnd() * 6
      const un = ENG.makeUnit(tt, { seat: 1 })
      un.x = B.fly.x + Math.cos(ang) * dd; un.y = B.fly.y + Math.sin(ang) * dd; un.a = rnd() * 6.2831853
      B.targets.push(un)
    }
    B.target = B.targets[0]   // legacy single-target readers (HUD fallback) still see A target
    // BODY — the hull's DRAWN/targeting rotation. fly.th is the pure velocity
    // heading (spawns at −90°=up); BODY adds the fixed +90° so the hull renders
    // in its EXACT design pose at spawn (BODY=0) and turns rigidly with flight
    // thereafter. One constant, used everywhere a TILE position/aim is rotated —
    // never in navigation (velocity/route/arrow stay in the simple fly.th frame).
    const BODY = B.fly.th + Math.PI / 2
    const cw = Math.cos(BODY), sw = Math.sin(BODY)
    const tgtTrig = B.targets.map(tg => ({ ca: Math.cos(tg.a || 0), sa: Math.sin(tg.a || 0) }))
    // ── AUTO-FIRE: each mount traverses inside its arc and shoots what it can —
    //    searching across EVERY live target, not just one, and firing on
    //    whichever tile (on whichever target) is nearest in range. ──
    let shotE = 0
    for (const mt of B.mounts) {
      ENG.mountCool(mt, dtB)
      const tl = B.pT[mt.i]
      const mx = B.fly.x + (tl.cx * cw - tl.cy * sw), my = B.fly.y + (tl.cx * sw + tl.cy * cw)
      // PIXEL-TRUE targeting: a tile is a DISK (r≈0.85), not a point — an edge
      // poking into range/arc is shootable; range measures to the NEAR edge
      const RT = 0.851
      let best = -1, bd = 1e9, ix = 0, iy = 0, bestTgt = -1
      for (let tgi = 0; tgi < B.targets.length; tgi++) {
        const tg = B.targets[tgi], trig = tgtTrig[tgi]
        for (const i3 of ENG.aliveTiles(tg)) {
          const t3 = tg.tiles[i3]
          const wx3 = tg.x + (t3.cx * trig.ca - t3.cy * trig.sa), wy3 = tg.y + (t3.cx * trig.sa + t3.cy * trig.ca)
          const d3 = Math.hypot(wx3 - mx, wy3 - my)
          if (d3 - RT > mt.weapon.range) continue            // near EDGE out of range
          if (d3 < bd) { bd = d3; best = i3; ix = wx3; iy = wy3; bestTgt = tgi }
        }
      }
      if (best < 0) continue
      const tu = B.targets[bestTgt]
      const spanB = Math.asin(Math.min(1, RT / Math.max(bd, RT)))
      const aimShip = Math.atan2(iy - my, ix - mx) - BODY
      ENG.traverse(mt, aimShip, dtB)
      // LINE OF SIGHT: the shot is blocked only if an OWN tile actually sits on
      // the ray (segment mount→impact vs tile circles, r≈0.62)
      let los = true
      {
        // thin beam from the BARREL TIP (0.7 past the mount along the aim), and a
        // slim 0.45 clearance — blocks true through-hull shots, allows corner skims
        const bx = mx + Math.cos(mt.aim + BODY) * 0.7, by = my + Math.sin(mt.aim + BODY) * 0.7
        const ddx = ix - bx, ddy = iy - by, LL = Math.hypot(ddx, ddy) || 1
        for (const i5 of ENG.aliveTiles(u)) {
          if (i5 === mt.i) continue
          const t5 = u.tiles[i5]
          const wx5 = B.fly.x + (t5.cx * cw - t5.cy * sw), wy5 = B.fly.y + (t5.cx * sw + t5.cy * cw)
          const tproj = Math.max(0, Math.min(LL, ((wx5 - bx) * ddx + (wy5 - by) * ddy) / LL))
          const px5 = bx + ddx / LL * tproj, py5 = by + ddy / LL * tproj
          if (Math.hypot(wx5 - px5, wy5 - py5) < 0.45) { los = false; break }
        }
      }
      const aimErr = Math.abs(Math.atan2(Math.sin(aimShip - mt.aim), Math.cos(aimShip - mt.aim)))
      if (los && mt.weapon && mt.cd <= 0 && bd - RT <= mt.weapon.range && ENG.inArc(mt.sectors, aimShip) && aimErr <= 0.06 + spanB) {
        shotE += ENG.mountFire(mt)
        if (pw.brownout) mt.cd = mt.cd / ENG.BROWN_GUN     // starving guns fire at half rate
        const died = ENG.applyBeam(tu, best, mt.weapon.damage)
        ENG.shedUnit(tu)
        mt.__bx = mx; mt.__by = my; mt.__ix = ix; mt.__iy = iy; mt.__beamT = 0.1
        wd.__play_sound = [{ frequency: died ? 300 : 760, duration: 0.05, volume: 0.09, type: 'square' }]
      }
      if (mt.__beamT > 0) mt.__beamT -= dtB
    }
    B.lastDrain = st2.drain + shotE / Math.max(dtB, 1e-3)
    // ── COLLISION: ship↔target physical contact — bounce + impact damage +
    //    shear. Tile-vs-tile circle test (r≈0.85 each, the same pixel-true
    //    convention the weapon-range math above already uses). On contact:
    //    push the ships apart along the contact normal (position correction —
    //    this model has no free 2D velocity to impulse, just a heading+speed),
    //    kill most of the player's speed, damage the NEAREST tile on both
    //    hulls by how hard they were closing, and shed whatever breaks off
    //    (the same route-BFS law weapon damage already uses). ──
    {
      const RTc = 0.85, sepR = RTc * 2
      let bestPd = Infinity, bestPi = -1, bestTi = -1, bestTgi = -1, bestNx = 0, bestNy = 0
      for (const i6 of ENG.aliveTiles(u)) {
        const t6 = u.tiles[i6]
        const wx6 = B.fly.x + (t6.cx * cw - t6.cy * sw), wy6 = B.fly.y + (t6.cx * sw + t6.cy * cw)   // cw/sw = cos/sin(BODY), already in scope
        for (let tgi = 0; tgi < B.targets.length; tgi++) {
          const tg = B.targets[tgi], trig = tgtTrig[tgi]
          for (const j6 of ENG.aliveTiles(tg)) {
            const tj = tg.tiles[j6]
            const wxj = tg.x + (tj.cx * trig.ca - tj.cy * trig.sa), wyj = tg.y + (tj.cx * trig.sa + tj.cy * trig.ca)
            const ddx = wxj - wx6, ddy = wyj - wy6, dd6 = Math.hypot(ddx, ddy)
            if (dd6 < sepR && dd6 < bestPd) { bestPd = dd6; bestPi = i6; bestTi = j6; bestTgi = tgi; bestNx = ddx / Math.max(dd6, 1e-6); bestNy = ddy / Math.max(dd6, 1e-6) }
          }
        }
      }
      if (bestPi >= 0) {
        const tu = B.targets[bestTgi]
        const overlap = sepR - bestPd
        const closing = Math.abs(B.fly.v) + 0.5
        B.fly.x -= bestNx * overlap; B.fly.y -= bestNy * overlap   // push apart, out of the target
        B.fly.v *= 0.15                                            // a hit kills most of your speed
        const dmg = Math.max(2, closing * 1.8)
        ENG.applyBeam(u, bestPi, u.reflective ? dmg * 0.8 : dmg); ENG.shedUnit(u)   // REFLECT special: 20% less impact damage taken
        ENG.applyBeam(tu, bestTi, dmg); ENG.shedUnit(tu)
        wd.__play_sound = [{ frequency: 140, duration: 0.12, volume: 0.18, type: 'sawtooth' }, { frequency: 90, duration: 0.18, volume: 0.14, type: 'triangle' }]
        B.__hitFlash = 0.25                                        // degradation feedback: a brief HUD flash
        if (ENG.unitDead(u)) {                                     // the player's own hull broke — respawn
          B.fly.x = 0; B.fly.y = 0; B.fly.v = 0; B.fly.vx = 0; B.fly.vy = 0
          for (let k = 0; k < u.tileHp.length; k++) u.tileHp[k] = u.tileMaxHp[k]
        }
      }
    }
    B.__hitFlash = Math.max(0, (B.__hitFlash || 0) - dtB)
    // MEND special: slow passive regen on the most-damaged alive tile
    if (u.regenRate > 0) {
      let worst = -1, worstFrac = 1
      for (const i7 of ENG.aliveTiles(u)) {
        const frac = u.tileHp[i7] / u.tileMaxHp[i7]
        if (frac < 1 && frac < worstFrac) { worstFrac = frac; worst = i7 }
      }
      if (worst >= 0) u.tileHp[worst] = Math.min(u.tileMaxHp[worst], u.tileHp[worst] + u.regenRate * dtB)
    }
    // ── draw: hull at flight pose + the route + the live draw ──
    const outB = []
    // CHROME (harvested from pentarch-stage/chrome.mjs) — a drawn panel backing
    // the flight status readout, instead of bare text floating on black. Packs
    // both half-sizes into one float exactly as chrome.mjs's chPackWH does;
    // visual.wgsl's ch_unpackW/H invert it (code 320 = PANEL).
    const chPanel = (cx, cy, hw, hh) => {
      const w = Math.max(0, Math.min(1, hw)), h = Math.max(0, Math.min(0.9999, hh))
      outB.push(cx, cy, Math.round(w * 4096) + h, 320)
    }
    chPanel(-0.62, -0.855, 0.35, 0.135)                       // "server view": the flight HUD's backing card
    const caB = Math.cos(BODY), saB = Math.sin(BODY)
    const aimDigit = {}
    for (const mt of B.mounts) {
      const t4 = u.tiles[mt.i]
      if (t4) aimDigit[mt.i] = ((Math.round((mt.aim - t4.th - Math.PI / 2) / (2 * Math.PI / 5) - 0.5) % 5) + 5) % 5
    }
    const actT = {}                                            // gyros VISIBLY firing (+400)
    if (B.__turning) for (const th6 of B.ths) { if (!th6.rcs && th6.T) actT[th6.i] = 1 }
    for (const i of ENG.aliveTiles(u)) {
      const t = u.tiles[i]
      const wx = B.fly.x + (t.cx * caB - t.cy * saB), wy = B.fly.y + (t.cx * saB + t.cy * caB)
      const oD = aimDigit[i] != null ? aimDigit[i] : ((D.tree[i] || {}).o || 0)
      outB.push(wx * BS, wy * BS, (t.th || 0) + BODY, (i === 0 ? 200 : u.tiles[i].part + 10 * oD) + (actT[i] ? 400 : 0))
    }
    // NO velocity-vector arrow (Galen: "isn't necessary") — the hull itself
    // (drawn in its design pose, BODY-locked to heading) already reads facing.
    // ── ENGINES/JETS FIRING: the arcade model drives by PART TYPE, not each
    //    tile's own design rotation ("orientation is cosmetic") — so a plume
    //    drawn from each tile's own o-facing could shoot sideways/backward while
    //    the ship visibly drives straight ("thrusters shoot the wrong way").
    //    Instead: one WORLD exhaust vector — opposite whatever is actually
    //    pushing the ship this tick (forward drive + strafe/reverse combined) —
    //    applied at every live engine/jet tile's position. ──
    if ((B.__effort || 0) > 0.08) {
      const fwdSign = vDes > 0.01 ? 1 : (vDes < -0.01 ? -1 : 0)
      const rcx2 = Math.cos(B.fly.th + Math.PI / 2), rcy2 = Math.sin(B.fly.th + Math.PI / 2)
      const pushX = c9 * fwdSign + rcx2 * strafeCmd, pushY = s9 * fwdSign + rcy2 * strafeCmd
      const pushLen = Math.hypot(pushX, pushY)
      const exX = pushLen > 1e-4 ? -pushX / pushLen : -c9, exY = pushLen > 1e-4 ? -pushY / pushLen : -s9
      const exAng = Math.atan2(exY, exX)
      for (const th2 of B.ths) {
        if (!th2.F || th2.rcs) continue
        const tl = B.pT[th2.i]
        const cxw = B.fly.x + (tl.cx * caB - tl.cy * saB), cyw = B.fly.y + (tl.cx * saB + tl.cy * caB)
        outB.push((cxw + exX * 0.72) * BS, (cyw + exY * 0.72) * BS, exAng, 56 + Math.min(0.99, B.__effort))
      }
    }
    // every target's hull (what remains of each) — the battlefield, not one dummy
    for (let tgi = 0; tgi < B.targets.length; tgi++) {
      const tg = B.targets[tgi], trig = tgtTrig[tgi]
      for (const i3 of ENG.aliveTiles(tg)) {
        const t3 = tg.tiles[i3]
        outB.push((tg.x + (t3.cx * trig.ca - t3.cy * trig.sa)) * BS, (tg.y + (t3.cx * trig.sa + t3.cy * trig.ca)) * BS, (t3.th || 0) + (tg.a || 0), t3.part)
      }
    }
    // WEAPON CONES — the attack zone made visible: boundary rays (bought arc)
    // + dashed range arc at the weapon's true range. Rotates with the ship.
    for (const mt of B.mounts) {
      const tl6 = B.pT[mt.i]; if (!tl6) continue
      const mx6 = B.fly.x + (tl6.cx * cw - tl6.cy * sw), my6 = B.fly.y + (tl6.cx * sw + tl6.cy * cw)
      const rng = mt.weapon.range * BS
      for (const sc6 of mt.sectors) {                          // FULL cone: every sector
        const cen = sc6.center + BODY, half6 = sc6.half
        const full = half6 >= Math.PI - 0.01
        if (!full) for (const bnd of [cen - half6, cen + half6]) {   // boundary rays, TRUE length
          const hl6 = Math.min(0.49, rng / 2)
          outB.push(mx6 * BS + Math.cos(bnd) * hl6, my6 * BS + Math.sin(bnd) * hl6, bnd, 58 + Math.min(0.99, hl6 * 2))
        }
        const nD = full ? 26 : Math.max(6, Math.ceil(half6 * 2 / 0.18))            // range dashes, denser
        for (let di = 0; di < nD; di++) {
          const a6 = full ? (di / nD) * 2 * Math.PI : cen - half6 + (di + 0.5) * (half6 * 2 / nD)
          outB.push(mx6 * BS, my6 * BS, a6, 59 + Math.min(0.99, rng / 2))
        }
      }
    }
    // weapon beams + impact sparks
    for (const mt of B.mounts) {
      if (!(mt.__beamT > 0)) continue
      const mxu = mt.__bx * BS, myu = mt.__by * BS, ixu = mt.__ix * BS, iyu = mt.__iy * BS
      const hl = Math.min(0.49, Math.hypot(ixu - mxu, iyu - myu) / 2)
      outB.push((mxu + ixu) / 2, (myu + iyu) / 2, Math.atan2(iyu - myu, ixu - mxu), 58 + hl / 0.5 * 0.99)
      outB.push(ixu, iyu, 0, 70)
    }
    if (B.route) { const n2 = B.route.points.length, st3 = Math.max(1, Math.floor(n2 / 64)); for (let i = 0; i < n2; i += st3) { const q = B.route.points[i]; outB.push(q.x * BS, q.y * BS, 0, 70) } }
    for (const q of (B.queue || [])) {
      outB.push(q.x * BS, q.y * BS, 0, 70); outB.push(q.x * BS, q.y * BS, 0, 70)   // waypoints glow double
      if (q.face != null) {   // FACING waypoint: an arrow ray along the arrival heading
        const rl = 0.10
        outB.push(q.x * BS + Math.cos(q.face) * rl / 2, q.y * BS + Math.sin(q.face) * rl / 2, q.face, 58 + Math.min(0.99, rl))
      }
    }
    if (B.holding) {                                       // live gesture: ember LINE, never the route icon
      const hp8 = B.holding.pts
      for (let i8 = 1; i8 < hp8.length; i8++) {
        const a8 = hp8[i8 - 1], b8 = hp8[i8]
        outB.push((a8.x + b8.x) / 2 * BS, (a8.y + b8.y) / 2 * BS, Math.atan2(b8.y - a8.y, b8.x - a8.x), 58 + Math.min(0.49, Math.hypot(b8.x - a8.x, b8.y - a8.y) * BS / 2) * 2)
      }
      if (hp8.length === 1) outB.push(hp8[0].x * BS, hp8[0].y * BS, 0, 70)
    }
    wd.gpuPopulation = outB
    const uuB = []; uuB[0] = D.t; uuB[7] = BS; uuB[14] = B.fly.om; for (let k = 0; k < 16; k++) if (uuB[k] == null) uuB[k] = 0; wd.gpuUniforms = uuB
    const spdB = Math.hypot(B.fly.vx, B.fly.vy)
    wd.hud = [
      { id: "btt", type: "text", x: "3%", y: "5%", text: "PENTARCH — FLIGHT  ·  W fwd · " + (B.ARC.canReverse ? "S reverse" : "S brake") + " · A/D strafe · Q/E turn  ·  tap→fly · drag→face · shift→queue · [ ] zoom · B→yard", fontSize: "13px", color: "#cfe0f5" },
      { id: "btv", type: "text", x: "3%", y: "9%", text: "SPD " + spdB.toFixed(1) + " / " + B.ARC.vmax.toFixed(1) + "  ·  " + (B.ARC.canReverse ? "reverse (jets)" : "NO reverse — add JETS") + "  ·  strafe " + B.ARC.strafe.toFixed(1) + "  ·  turn " + B.ARC.turn.toFixed(1) + (B.route ? "  ·  ETA " + B.route.eta.toFixed(0) + "s" : ""), fontSize: "12px", color: "#9fd8ff" },
      { id: "btp", type: "text", x: "3%", y: "13%", text: "PWR bank " + B.bank.charge.toFixed(0) + "/" + B.grid.batCap + (pw.brownout ? "  ⚠ BROWNOUT — drives + guns degraded" : ""), fontSize: "12px", color: pw.brownout ? "#ffb08a" : "#8fb0d8" },
      { id: "btk", type: "text", x: "3%", y: "17%", text: "KILLS " + (B.kills || 0) + "  ·  HOSTILES " + B.targets.length + " (" + B.targets.map(tg => ENG.aliveTiles(tg).size + "/" + tg.tiles.length).join(" · ") + ")" + (B.mounts.length ? "" : "  ·  (no weapons fitted — add a GUN in the yard)"), fontSize: "12px", color: "#ffd479" },
      { id: "bthp", type: "text", x: "3%", y: "21%", text: "HULL " + ENG.aliveTiles(u).size + "/" + u.tiles.length + ((B.__hitFlash || 0) > 0 ? "  ⚠ IMPACT" : ""), fontSize: "12px", color: (B.__hitFlash || 0) > 0 ? "#ff8a7a" : "#8fd8a8" },
    ]
    return
  }
