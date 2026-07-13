// ORRERY — compose a solar system, then hand it to real gravity.
//
// BUILD:  A/D swing the placement angle · W/S change orbit radius · SHIFT cycle body type
//         SPACE place (auto-set to circular-orbit velocity; comets get an eccentric kick)
//         arrows tilt/orbit the camera · ENTER run
// RUN:    true n-body (leapfrog, softened). Planets perturb each other. Collisions MERGE
//         (momentum-conserving; pile up >=60 mass -> gas giant, >=300 -> IGNITES into a sun).
//         Wanderers past the boundary are ejected. Score = years your garden survives.
//         ENTER returns to build with your original design intact.
//
// Whiteboard: 0 count · 1 mode · 2 camYaw · 3 camPitch · 4 ghostR · 5 ghostA ·
//             6 ghostType(0=hidden) · 7 ignition flash · 8.. bodies, stride 6:
//             x, z, vx, vz, type(0 sun/1 rock/2 terra/3 giant/4 comet), radius
//
// Save+load: node orrery-cartridge.mjs

const WORLD = /* wgsl */`
fn orr_stars(rd: vec3f, t: f32) -> vec3f {
  var c = vec3f(0.003, 0.004, 0.010);
  let sp = rd.xy * 20.0 + vec2f(rd.z * 6.0, 0.0);
  for (var l = 0; l < 2; l++) {
    let fl = f32(l);
    let cell = floor(sp * (1.0 + fl * 0.8) + fl * 17.0);
    let h = hash21(cell);
    let fp = fract(sp * (1.0 + fl * 0.8)) - 0.5;
    c += vec3f(0.65, 0.7, 0.9) * step(0.988, h) * smoothstep(0.26, 0.05, length(fp)) *
         (0.35 + 0.4 * sin(t * (0.4 + h) + h * 40.0));
  }
  c += vec3f(0.045, 0.02, 0.075) * pow(max(0.0, 1.0 - abs(rd.y * 1.8 + 0.1)), 3.0) * (0.5 + 0.5 * vnoise(rd.xz * 2.5));
  return c;
}

fn orr_body(i: i32) -> vec3f {  // position
  return vec3f(uni(8 + i * 6), 0.0, uni(9 + i * 6));
}
fn orr_vel(i: i32) -> vec2f { return vec2f(uni(10 + i * 6), uni(11 + i * 6)); }
fn orr_type(i: i32) -> f32 { return uni(12 + i * 6); }
fn orr_rad(i: i32) -> f32 { return uni(13 + i * 6); }

fn visual_orr_world(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let scr = vec2f(uv.x, -uv.y);
  let n = i32(uni(0));
  let mode = uni(1);
  let yaw = uni(2);
  let pitch = uni(3);

  let R = 13.0;
  let ro = vec3f(R * cos(pitch) * cos(yaw), R * sin(pitch), R * cos(pitch) * sin(yaw));
  let fwd = normalize(-ro);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  let rd = normalize(fwd * 2.0 + right * scr.x + up * scr.y);

  var col = orr_stars(rd, time);

  let sunPos = orr_body(0);

  // ── orbit guide rings (build mode): ray ∩ ecliptic ──
  if (rd.y * sign(ro.y) < 0.0) {
    let tp = -ro.y / rd.y;
    if (tp > 0.0) {
      let hp = ro + rd * tp;
      let rr = length(hp.xz - sunPos.xz);
      if (mode < 0.5) {
        // each body's current radius, faint
        for (var i = 1; i < 9; i++) {
          if (i >= n) { break; }
          let br = length(orr_body(i).xz - sunPos.xz);
          col += vec3f(0.10, 0.13, 0.18) * exp(-pow((rr - br) * 22.0, 2.0)) * 0.7;
        }
        // ghost ring, brighter, pulsing
        let gT = uni(6);
        if (gT > 0.5) {
          let pulse = 0.6 + 0.4 * sin(time * 4.0);
          col += vec3f(0.15, 0.5, 0.6) * exp(-pow((rr - uni(4)) * 26.0, 2.0)) * pulse;
        }
      }
      // fine ecliptic dust disc
      col += vec3f(0.05, 0.055, 0.08) * exp(-rr * 0.35) * smoothstep(0.8, 2.0, rr) * 0.5;
    }
  }

  // ── bodies: exact ray-sphere, nearest wins ──
  var bestT = 1e5;
  var bestI = -1;
  for (var i = 0; i < 9; i++) {
    if (i >= n) { break; }
    let c = orr_body(i);
    let r = orr_rad(i);
    let oc = ro - c;
    let b = dot(oc, rd);
    let cc = dot(oc, oc) - r * r;
    let disc = b * b - cc;
    if (disc > 0.0) {
      let t = -b - sqrt(disc);
      if (t > 0.0 && t < bestT) { bestT = t; bestI = i; }
    }
  }
  // ghost body preview
  var ghostHit = false;
  if (mode < 0.5 && uni(6) > 0.5) {
    let gc = sunPos + vec3f(cos(uni(5)), 0.0, sin(uni(5))) * uni(4);
    let gr = select(0.14, select(0.22, select(0.38, 0.10, uni(6) > 3.5), uni(6) > 2.5), uni(6) > 1.5);
    let oc = ro - gc;
    let b = dot(oc, rd);
    let cc = dot(oc, oc) - gr * gr;
    let disc = b * b - cc;
    if (disc > 0.0) {
      let t = -b - sqrt(disc);
      if (t > 0.0 && t < bestT) { bestT = t; bestI = 99; ghostHit = true; }
    }
  }

  if (bestI >= 0) {
    let isGhost = bestI == 99;
    var c: vec3f;
    var r: f32;
    var ty: f32;
    if (isGhost) {
      c = sunPos + vec3f(cos(uni(5)), 0.0, sin(uni(5))) * uni(4);
      ty = uni(6);
      r = select(0.14, select(0.22, select(0.38, 0.10, ty > 3.5), ty > 2.5), ty > 1.5);
    } else {
      c = orr_body(bestI);
      r = orr_rad(bestI);
      ty = orr_type(bestI);
    }
    let p = ro + rd * bestT;
    let nr = normalize(p - c);
    let sunDir = normalize(sunPos - p + vec3f(0.0, 0.001, 0.0));
    let lam = clamp(dot(nr, sunDir), 0.0, 1.0);

    var cc = vec3f(0.0);
    if (ty < 0.5) {
      // SUN — boiling HDR surface
      let gr = fbm(vec2f(atan2(nr.z, nr.x + 1e-5) * 3.0, nr.y * 4.0) + vec2f(time * 0.25, 0.0), 4);
      cc = mix(vec3f(4.5, 2.6, 0.8), vec3f(6.0, 4.2, 1.6), gr);
      cc += vec3f(2.0, 0.8, 0.2) * pow(clamp(1.0 + dot(rd, nr), 0.0, 1.0), 2.0);
    } else if (ty < 1.5) {
      // ROCK — cratered grey
      let tex = vnoise(vec2f(atan2(nr.z, nr.x + 1e-5) * 4.0, nr.y * 6.0) * 2.0 + f32(bestI) * 7.0);
      let crat = smoothstep(0.62, 0.78, vnoise(vec2f(nr.x, nr.z) * 9.0 + f32(bestI) * 13.0));
      var alb = vec3f(0.32, 0.31, 0.30) * (0.75 + 0.35 * tex) * (1.0 - crat * 0.4);
      cc = alb * (0.03 + lam * 1.15);
    } else if (ty < 2.5) {
      // TERRA — oceans, continents, clouds, night lights
      let lon = atan2(nr.z, nr.x + 1e-5);
      let sea = fbm(vec2f(lon * 2.0, nr.y * 3.0) + f32(bestI) * 5.0, 4);
      let land = smoothstep(0.52, 0.60, sea);
      var alb = mix(vec3f(0.04, 0.12, 0.30), vec3f(0.10, 0.26, 0.08), land);
      let cloud = smoothstep(0.55, 0.75, fbm(vec2f(lon * 3.0 + time * 0.05, nr.y * 4.0), 3));
      alb = mix(alb, vec3f(0.85, 0.87, 0.90), cloud * 0.8);
      cc = alb * (0.02 + lam * 1.25);
      // ocean sun glint
      cc += vec3f(1.4, 1.2, 0.9) * pow(clamp(dot(reflect(-sunDir, nr), -rd), 0.0, 1.0), 60.0) * (1.0 - land) * (1.0 - cloud) * lam;
      // city lights on the night side
      let night = smoothstep(0.05, -0.15, dot(nr, sunDir));
      let city = step(0.86, vnoise(vec2f(lon * 14.0, nr.y * 18.0))) * land * (1.0 - cloud);
      cc += vec3f(1.1, 0.8, 0.35) * city * night * 0.8;
    } else if (ty < 3.5) {
      // GIANT — banded, storm-swirled
      let lat = nr.y;
      let band = sin(lat * 11.0 + fbm(vec2f(atan2(nr.z, nr.x + 1e-5) * 2.0, lat * 3.0) + time * 0.03, 3) * 2.5);
      var alb = mix(vec3f(0.55, 0.38, 0.22), vec3f(0.78, 0.62, 0.42), 0.5 + 0.5 * band);
      let storm = smoothstep(0.7, 0.85, vnoise(vec2f(atan2(nr.z, nr.x + 1e-5) * 3.0 + 2.0, lat * 8.0)));
      alb = mix(alb, vec3f(0.85, 0.45, 0.28), storm * 0.6);
      cc = alb * (0.03 + lam * 1.2);
    } else {
      // COMET — dirty ice
      let tex = vnoise(vec2f(nr.x, nr.z) * 10.0 + f32(bestI) * 3.0);
      cc = vec3f(0.55, 0.62, 0.70) * (0.8 + 0.3 * tex) * (0.08 + lam * 1.3);
    }
    if (isGhost) {
      let pulse = 0.5 + 0.4 * sin(time * 4.0);
      cc = cc * 0.35 + vec3f(0.2, 0.8, 1.0) * pulse * 0.5;
    }
    if (cc.x != cc.x || cc.y != cc.y || cc.z != cc.z) { cc = vec3f(4.0, 2.5, 0.8); }
    col = clamp(cc, vec3f(0.0), vec3f(60.0));
  }

  // ── sun corona + planet glints + comet tails (additive, ray-to-point glow) ──
  for (var i = 0; i < 9; i++) {
    if (i >= n) { break; }
    let c = orr_body(i);
    let ty = orr_type(i);
    let w = c - ro;
    let along = dot(w, rd);
    if (along < 0.0) { continue; }
    let dRay = length(w - rd * along);
    if (ty < 0.5) {
      let flick = 0.9 + 0.1 * sin(time * 3.0 + f32(i));
      if (along < bestT + 1.0) {
        col += vec3f(3.0, 1.7, 0.5) * exp(-dRay * dRay * 3.5) * flick;
        col += vec3f(1.2, 0.5, 0.12) * exp(-dRay * dRay * 0.55) * 0.5 * flick;
      }
    } else if (ty > 3.5) {
      // tail streams away from the sun, longer when close
      let sunPos2 = orr_body(0);
      let away = normalize(c - sunPos2 + vec3f(0.0, 1e-4, 0.0));
      let dist = length(c - sunPos2);
      let tl = clamp(5.0 / max(dist, 0.6), 0.6, 3.2);
      for (var s = 1; s <= 4; s++) {
        let fs = f32(s) / 4.0;
        let tp = c + away * tl * fs;
        let w2 = tp - ro;
        let along2 = dot(w2, rd);
        if (along2 < 0.0 || along2 > bestT + 0.5) { continue; }
        let d2 = length(w2 - rd * along2);
        col += vec3f(0.35, 0.65, 0.95) * exp(-d2 * d2 * (60.0 + fs * 120.0)) * (1.0 - fs * 0.8) * 0.8;
      }
    }
  }

  // ignition flash — a new star is born
  let ign = uni(7);
  if (ign > 0.01) {
    col += vec3f(3.5, 2.5, 1.4) * ign * exp(-length(scr) * 1.2);
  }

  return vec4f(col, 1.0);
}`

const HUD = /* wgsl */`
fn visual_orr_hud(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [selectedType 1..4, years01, bodies01, mode]
  var c = vec3f(0.0);
  var a = 0.0;
  // body-type legend: rock / terra / giant / comet — SHIFT moves the ring
  for (var i = 1; i <= 4; i++) {
    let fi = f32(i);
    var tint = vec3f(0.55, 0.53, 0.50);                     // rock
    if (i == 2) { tint = vec3f(0.25, 0.55, 1.1); }          // terra
    if (i == 3) { tint = vec3f(1.1, 0.62, 0.28); }          // giant
    if (i == 4) { tint = vec3f(0.45, 0.85, 1.2); }          // comet
    let ctr = vec2f(-0.60 + (fi - 1.0) * 0.40, 0.28);
    let q = (uv - ctr) * vec2f(6.5, 3.0);
    let d = length(q);
    let sel = select(0.0, 1.0, abs(p.x - fi) < 0.5 && p.w < 0.5);
    c += tint * exp(-d * d * (2.2 - sel * 0.8)) * (0.35 + 0.75 * sel);
    c += vec3f(0.9, 1.0, 1.1) * exp(-pow((d - 0.75) * 6.0, 2.0)) * sel * (0.7 + 0.3 * sin(time * 6.0));
    a = max(a, exp(-d * d * 1.4) * (0.5 + 0.4 * sel));
  }
  // years bar (run) / capacity bar (build)
  let y0 = -0.42;
  let v = select(p.z, p.y, p.w > 0.5);
  let tint = select(vec3f(0.5, 0.8, 1.1), vec3f(1.2, 0.9, 0.35), p.w > 0.5);
  let bx = (uv.x + 0.9) / 1.8;
  if (bx > 0.0 && bx < 1.0 && abs(uv.y - y0) < 0.11) {
    let on = step(bx, clamp(v, 0.0, 1.0));
    c += mix(vec3f(0.05, 0.05, 0.07), tint, on) * exp(-pow((uv.y - y0) * 13.0, 2.0));
    a = max(a, exp(-pow((uv.y - y0) * 11.0, 2.0)) * 0.75);
  }
  return vec4f(c, clamp(a, 0.0, 1.0) * 0.9);
}`

// ─────────────────────────────────────────────────────────────────────────────
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__orr) wd.__orr = {
    mode: 0, yaw: 0.9, pitch: 0.55,
    gR: 3.0, gA: 0.0, gT: 1,
    bodies: [{ x: 0, z: 0, vx: 0, vz: 0, t: 0, r: 0.7, m: 400 }],
    saved: null, years: 0, best: 0, ign: 0, prev: {},
  }
  const O = wd.__orr
  let hud = null
  for (const f of sim.fields.values()) {
    if ((f.name || '').startsWith('ORRERY')) hud = f
  }

  const G = 1.0
  const TYPES = { 1: { r: 0.14, m: 1, n: 'rock' }, 2: { r: 0.22, m: 3, n: 'terra' }, 3: { r: 0.38, m: 12, n: 'giant' }, 4: { r: 0.10, m: 0.2, n: 'comet' } }
  const YEAR = 2 * Math.PI * Math.sqrt(27 / 400)   // orbital period at r=3
  const dt2 = Math.min(dt, 0.05)
  const pressed = k => { const now = !!wd['key_' + k]; const was = !!O.prev[k]; O.prev[k] = now; return now && !was }

  // camera
  if (wd.key_left) O.yaw -= 1.5 * dt2
  if (wd.key_right) O.yaw += 1.5 * dt2
  if (wd.key_up) O.pitch = Math.min(1.35, O.pitch + 1.1 * dt2)
  if (wd.key_down) O.pitch = Math.max(0.12, O.pitch - 1.1 * dt2)

  O.ign = Math.max(0, O.ign - dt2 * 1.5)

  if (pressed('r')) {
    // reset: back to a bare sun and the drawing board (the record survives)
    O.mode = 0
    O.bodies = [{ x: 0, z: 0, vx: 0, vz: 0, t: 0, r: 0.7, m: 400 }]
    O.years = 0; O.saved = null; O.ign = 1
    wd.__play_sound = { frequency: 240, duration: 0.25, volume: 0.3, type: 'sine' }
  }

  if (O.mode === 0) {
    // ── BUILD ──
    if (wd.key_a) O.gA -= 1.6 * dt2
    if (wd.key_d) O.gA += 1.6 * dt2
    if (wd.key_w) O.gR = Math.min(9.5, O.gR + 2.2 * dt2)
    if (wd.key_s) O.gR = Math.max(1.4, O.gR - 2.2 * dt2)
    if (pressed('shift')) O.gT = O.gT % 4 + 1

    if (pressed('space') && O.bodies.length < 9) {
      const spec = TYPES[O.gT]
      const sun = O.bodies[0]
      const px = sun.x + Math.cos(O.gA) * O.gR
      const pz = sun.z + Math.sin(O.gA) * O.gR
      let v = Math.sqrt(G * sun.m / O.gR)
      if (O.gT === 4) v *= 0.55          // comets are born falling
      O.bodies.push({ x: px, z: pz, vx: -Math.sin(O.gA) * v, vz: Math.cos(O.gA) * v, t: O.gT, r: spec.r, m: spec.m })
    }
    if (pressed('enter') && O.bodies.length > 1) {
      O.saved = JSON.parse(JSON.stringify(O.bodies))
      O.years = 0
      O.mode = 1
    }
  } else {
    // ── RUN: leapfrog n-body, softened ──
    const SUB = 6, EPS2 = 0.02, K = 1.4
    const h = (dt2 * K) / SUB
    for (let s = 0; s < SUB; s++) {
      const B = O.bodies
      const ax = new Array(B.length).fill(0), az = new Array(B.length).fill(0)
      for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
        const dx = B[j].x - B[i].x, dz = B[j].z - B[i].z
        const d2 = dx * dx + dz * dz + EPS2
        const inv = 1 / (d2 * Math.sqrt(d2))
        ax[i] += G * B[j].m * dx * inv; az[i] += G * B[j].m * dz * inv
        ax[j] -= G * B[i].m * dx * inv; az[j] -= G * B[i].m * dz * inv
      }
      for (let i = 0; i < B.length; i++) {
        B[i].vx += ax[i] * h; B[i].vz += az[i] * h
        B[i].x += B[i].vx * h; B[i].z += B[i].vz * h
      }
      // collisions merge — momentum conserved, volume adds; big piles change nature
      for (let i = 0; i < B.length; i++) for (let j = B.length - 1; j > i; j--) {
        const dx = B[j].x - B[i].x, dz = B[j].z - B[i].z
        if (dx * dx + dz * dz < Math.pow(B[i].r + B[j].r, 2) * 0.7) {
          const a = B[i], b = B[j], m = a.m + b.m
          a.vx = (a.vx * a.m + b.vx * b.m) / m; a.vz = (a.vz * a.m + b.vz * b.m) / m
          a.x = (a.x * a.m + b.x * b.m) / m; a.z = (a.z * a.m + b.z * b.m) / m
          a.r = Math.cbrt(a.r ** 3 + b.r ** 3); a.m = m
          if (a.t !== 0) {
            if (m >= 300) { a.t = 0; a.r = Math.max(a.r, 0.55); O.ign = 1 }   // ignition!
            else if (m >= 30) a.t = 3
            else if (m >= 3) a.t = Math.max(a.t, 2)
          }
          B.splice(j, 1)
        }
      }
      // ejections
      for (let j = O.bodies.length - 1; j >= 1; j--) {
        const b = O.bodies[j]
        if (!isFinite(b.x) || !isFinite(b.z) || (b.x * b.x + b.z * b.z) > 196) O.bodies.splice(j, 1)
      }
    }
    O.years += (dt2 * K) / YEAR
    const score = Math.round(O.years * Math.max(0, O.bodies.length - 1))
    if (score > O.best) O.best = score

    // return to the drawing board (or auto-return when the garden is gone)
    if (pressed('enter') || O.bodies.length <= 1) {
      O.mode = 0
      if (O.saved) O.bodies = O.saved
      O.saved = null
    }
  }

  // ── whiteboard ──
  const u = [O.bodies.length, O.mode, O.yaw, O.pitch, O.gR, O.gA, O.mode === 0 ? O.gT : 0, O.ign]
  for (const b of O.bodies) u.push(b.x, b.z, b.vx, b.vz, b.t, b.r)
  wd.gpuUniforms = u

  if (hud) {
    const names = { 1: 'ROCK', 2: 'TERRA', 3: 'GIANT', 4: 'COMET' }
    hud.visualParams = [O.gT, Math.min(1, O.years / 60), (O.bodies.length - 1) / 8, O.mode]
    hud.name = O.mode === 0
      ? 'ORRERY \\u00b7 placing: ' + names[O.gT] + ' \\u00b7 r ' + O.gR.toFixed(1) + ' \\u00b7 ' + (O.bodies.length - 1) + '/8 worlds \\u00b7 best ' + O.best
      : 'ORRERY \\u00b7 year ' + Math.floor(O.years) + ' \\u00b7 ' + (O.bodies.length - 1) + ' worlds alive \\u00b7 score ' + Math.round(O.years * Math.max(0, O.bodies.length - 1)) + ' \\u00b7 best ' + O.best
  }
} catch (e) { /* keep the sim alive */ }
`

const field = (id, name, color, x, y, shape, visualTypeName, vp) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
  ...(vp ? { visualParams: vp } : {}),
})

const scene = {
  name: 'ORRERY',
  fields: [
    field('orr_world_f', 'Heavens', [0.01, 0.01, 0.03, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'orr_world'),
    field('orr_hud_f', 'ORRERY · A/D angle · W/S radius · SHIFT type · SPACE place · ENTER run', [0.9, 0.85, 0.6, 1], 256, 492, { shapeType: 'rect', w: 300, h: 26 }, 'orr_hud', [1, 0, 0, 0]),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: { noPixelSampling: true },
  stepHooks: [{ id: 'orrery_core', author: 'fable', description: 'ORRERY: n-body gravity garden — leapfrog integrator, momentum-conserving mergers, ignition at 300 mass', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'orr_world', wgsl: WORLD },
    { name: 'orr_hud', wgsl: HUD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'ORRERY', scene }),
})
console.log('ORRERY saved:', res.status, await res.text())
