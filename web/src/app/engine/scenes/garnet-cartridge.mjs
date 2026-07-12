// GARNET SHIPYARD — assemble a starship from rhombic dodecahedra (the space-filling
// "garnet" cell) on the true FCC lattice, then launch your design and live with its physics.
//
// BUILD:  A/D cycle attachment site · W/S cycle component · SPACE place · SHIFT remove last
//         arrows orbit the camera · ENTER launch
// FLIGHT: thrust/mass, power budget, fuel burn, and torque all come FROM the build.
//         Off-axis thrusters = tumble. 18-second test flight, distance is your score.
//
// The whole ship travels the whiteboard: uni(0)=count · 1=mode · 2/3=cam yaw/pitch ·
// 4=ghost(packed) · 5=plume · 6=tumble · 7=speed01 · 8..=cells, one float each:
// type*1000 + (i+4) + (j+4)*9 + (k+4)*81   (FCC: i+j+k even; 12 neighbors at (±1,±1,0)-perms)
//
// Save+load: node garnet-cartridge.mjs

const WORLD = /* wgsl */`
fn ga_rd(q: vec3f, h: f32) -> f32 {
  // rhombic dodecahedron: max |dot(q, n)| over the six <110> normals, minus half-width
  let r2 = 0.70710678;
  var m = abs(dot(q, vec3f(r2, r2, 0.0)));
  m = max(m, abs(dot(q, vec3f(r2, -r2, 0.0))));
  m = max(m, abs(dot(q, vec3f(r2, 0.0, r2))));
  m = max(m, abs(dot(q, vec3f(r2, 0.0, -r2))));
  m = max(m, abs(dot(q, vec3f(0.0, r2, r2))));
  m = max(m, abs(dot(q, vec3f(0.0, r2, -r2))));
  return m - h;
}

fn ga_edge(q: vec3f) -> f32 {
  // crystal bevel: how close the two largest face distances are
  let r2 = 0.70710678;
  var a = abs(dot(q, vec3f(r2, r2, 0.0)));
  var b = abs(dot(q, vec3f(r2, -r2, 0.0)));
  if (b > a) { let t = a; a = b; b = t; }
  let c3 = abs(dot(q, vec3f(r2, 0.0, r2)));
  if (c3 > a) { b = a; a = c3; } else if (c3 > b) { b = c3; }
  let c4 = abs(dot(q, vec3f(r2, 0.0, -r2)));
  if (c4 > a) { b = a; a = c4; } else if (c4 > b) { b = c4; }
  let c5 = abs(dot(q, vec3f(0.0, r2, r2)));
  if (c5 > a) { b = a; a = c5; } else if (c5 > b) { b = c5; }
  let c6 = abs(dot(q, vec3f(0.0, r2, -r2)));
  if (c6 > a) { b = a; a = c6; } else if (c6 > b) { b = c6; }
  return smoothstep(0.045, 0.008, a - b);
}

fn ga_cellpos(packed: f32) -> vec3f {
  let ty = floor(packed / 1000.0);
  let idx = packed - ty * 1000.0;
  let kz = floor(idx / 81.0);
  let rem = idx - kz * 81.0;
  let jy = floor(rem / 9.0);
  let ix = rem - jy * 9.0;
  return (vec3f(ix, jy, kz) - vec3f(4.0)) * 0.62;
}
fn ga_celltype(packed: f32) -> f32 { return floor(packed / 1000.0); }

fn ga_rot(p: vec3f, yaw: f32, pitch: f32) -> vec3f {
  let cy = cos(yaw); let sy = sin(yaw);
  var q = vec3f(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  let cp = cos(pitch); let sp = sin(pitch);
  return vec3f(q.x, cp * q.y - sp * q.z, sp * q.y + cp * q.z);
}

// scene SDF over all cells: returns (distance, cellIndex)
fn ga_map(p: vec3f) -> vec2f {
  let n = i32(uni(0));
  let H = 0.438;   // 0.62 / sqrt(2): faces kiss exactly
  var best = 1e5;
  var mat = -1.0;
  for (var i = 0; i < 56; i++) {
    if (i >= n) { break; }
    let packed = uni(8 + i);
    let c = ga_cellpos(packed);
    // cheap sphere reject before the six planes
    let ds = length(p - c) - 0.78;
    if (ds > best) { continue; }
    let d = ga_rd(p - c, H);
    if (d < best) { best = d; mat = f32(i); }
  }
  return vec2f(best, mat);
}

fn ga_stars(rd: vec3f, streak: f32, t: f32) -> vec3f {
  // starfield; streaks along +x when flying
  var c = vec3f(0.004, 0.005, 0.012);
  let sp = rd.yz * 22.0 + vec2f(rd.x * 4.0, 0.0);
  for (var l = 0; l < 2; l++) {
    let fl = f32(l);
    let cell = floor(sp * (1.0 + fl * 0.7) + fl * 13.0);
    let h = hash21(cell);
    let fp = fract(sp * (1.0 + fl * 0.7)) - 0.5;
    var star = step(0.985, h) * smoothstep(0.28, 0.04, length(fp));
    // streaking: smear along x with speed
    let fps = vec2f(fp.x / (1.0 + streak * 6.0), fp.y);
    star = max(star, step(0.985, h) * smoothstep(0.28, 0.04, length(fps)) * streak);
    c += vec3f(0.7, 0.75, 0.9) * star * (0.4 + 0.4 * sin(t * (0.5 + h) + h * 30.0));
  }
  // faint nebula
  c += vec3f(0.05, 0.02, 0.08) * pow(max(0.0, 1.0 - abs(rd.y * 1.6 - 0.2)), 3.0) * (0.5 + 0.5 * vnoise(rd.xz * 3.0));
  return c;
}

fn visual_ga_world(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let scr = vec2f(uv.x, -uv.y);
  let mode = uni(1);
  let yaw = uni(2);
  let pitch = uni(3);
  let plume = uni(5);
  let tumble = uni(6);
  let speed01 = uni(7);

  // orbit camera
  let R = 7.6;
  let ro0 = vec3f(R * cos(pitch) * cos(yaw), R * sin(pitch), R * cos(pitch) * sin(yaw));
  let fwd = normalize(-ro0);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  var rd = normalize(fwd * 1.9 + right * scr.x + up * scr.y);
  let ro = ro0;

  var col = ga_stars(rd, speed01 * clamp(mode, 0.0, 1.0), time);

  // in flight the whole ship tumbles — rotate the RAY instead of every cell
  var rro = ro;
  var rrd = rd;
  if (mode > 0.5) {
    rro = ga_rot(ro, 0.0, tumble);
    rrd = ga_rot(rd, 0.0, tumble);
    rro = ga_rot(rro, tumble * 0.35, 0.0);
    rrd = ga_rot(rrd, tumble * 0.35, 0.0);
  }

  // march
  var t = 0.0;
  var hit = false;
  var mm = vec2f(0.0, -1.0);
  // whole-ship bounding sphere: pixels that can't hit anything never march
  let toC = -rro;
  let bClose = dot(toC, rrd);
  let bD2 = dot(toC, toC) - bClose * bClose;
  if (bD2 < 16.0 && bClose > 0.0) {
    t = max(0.0, bClose - 4.0);
    for (var i = 0; i < 44; i++) {
      let p = rro + rrd * t;
      mm = ga_map(p);
      if (mm.x < 0.0025) { hit = true; break; }
      t = t + mm.x * 1.08;
      if (t > bClose + 4.5) { break; }
    }
  }

  if (hit) {
    let p = rro + rrd * t;
    let e = 0.004;
    let d0 = mm.x;
    let nr = normalize(vec3f(
      ga_map(p + vec3f(e, 0.0, 0.0)).x - d0,
      ga_map(p + vec3f(0.0, e, 0.0)).x - d0,
      ga_map(p + vec3f(0.0, 0.0, e)).x - d0));
    let packed = uni(8 + i32(mm.y));
    let ty = ga_celltype(packed);
    let c = ga_cellpos(packed);
    let q = p - c;
    let edge = ga_edge(q);

    // materials by purpose — every component has a FEATURE, not just a color
    var alb = vec3f(0.5);
    var emis = vec3f(0.0);
    var gloss = 24.0;
    var ety = ty;
    var isGhost = false;
    if (ty > 5.5) { ety = ty - 6.0; isGhost = true; }   // ghost previews the real part

    let qn = normalize(q + vec3f(1e-5));
    if (ety < 0.5) {          // CORE — molten heart, pulsing veins
      alb = vec3f(0.55, 0.42, 0.20);
      let vein = smoothstep(0.55, 0.9, vnoise(q.xy * 9.0 + vec2f(time * 0.4, q.z * 9.0)));
      emis = vec3f(2.2, 1.3, 0.35) * (0.45 + 0.4 * sin(time * 2.2)) * (1.0 - edge) * (0.5 + vein);
      gloss = 60.0;
    } else if (ety < 1.5) {   // THRUSTER — gunmetal with a hot engine bell on the rear pole (-x)
      alb = vec3f(0.22, 0.24, 0.28);
      let bell = pow(max(0.0, dot(qn, vec3f(-1.0, 0.0, 0.0))), 6.0);
      alb = mix(alb, vec3f(0.10, 0.08, 0.07), bell * 0.7);
      let idle = 0.35 + 0.25 * sin(time * 3.0);
      emis = vec3f(2.0, 0.9, 0.25) * bell * max(idle, plume * 1.6);   // always glows: THIS is an engine
      gloss = 90.0;
    } else if (ety < 2.5) {   // TANK — steel drum with weld rings
      alb = vec3f(0.46, 0.52, 0.58) * (0.9 + 0.1 * vnoise(q.xy * 30.0));
      let ring = smoothstep(0.10, 0.04, abs(fract(q.x * 3.2 + 0.5) - 0.5));
      alb = mix(alb, vec3f(0.16, 0.18, 0.22), ring * 0.8);
      gloss = 120.0;
    } else if (ety < 3.5) {   // SOLAR — blue glass with a visible cell grid
      let irid = 0.5 + 0.5 * sin(dot(nr, vec3f(4.0, 7.0, 5.0)) + time * 0.3);
      alb = mix(vec3f(0.07, 0.12, 0.38), vec3f(0.15, 0.05, 0.38), irid);
      let gy = smoothstep(0.09, 0.03, abs(fract(q.y * 5.0) - 0.5));
      let gz = smoothstep(0.09, 0.03, abs(fract(q.z * 5.0) - 0.5));
      alb = mix(alb, vec3f(0.02, 0.03, 0.08), max(gy, gz) * 0.85);
      emis = vec3f(0.10, 0.16, 0.45) * irid * 0.5 * (1.0 - max(gy, gz));
      gloss = 200.0;
    } else if (ety < 4.5) {   // CARGO — strapped amber crate
      alb = vec3f(0.55, 0.38, 0.16) * (0.85 + 0.15 * vnoise(q.xz * 22.0));
      let strap = max(smoothstep(0.10, 0.04, abs(q.y)), smoothstep(0.10, 0.04, abs(q.z)));
      alb = mix(alb, vec3f(0.20, 0.13, 0.06), strap * 0.85);
      gloss = 30.0;
    } else {                  // SHIELD — humming crystal bubble
      alb = vec3f(0.50, 0.70, 0.78);
      let hum = 0.5 + 0.5 * sin(time * 1.6 + dot(qn, vec3f(3.0, 5.0, 4.0)));
      emis = vec3f(0.12, 0.35, 0.42) * (0.4 + 0.5 * hum);
      gloss = 160.0;
    }
    if (isGhost) {            // ghost: the part's own look, cyan-pulsed and hollow
      let pulse = 0.45 + 0.4 * sin(time * 5.0);
      emis = alb * pulse * 1.2 + emis * 0.6 + vec3f(0.2, 0.9, 1.1) * edge * 1.8 * pulse;
      alb = alb * 0.22;
    }

    // two-light studio + rim
    let L1 = normalize(vec3f(0.6, 0.75, -0.35));
    let L2 = normalize(vec3f(-0.55, -0.2, 0.6));
    let dif = clamp(dot(nr, L1), 0.0, 1.0) * 1.15 + clamp(dot(nr, L2), 0.0, 1.0) * 0.28;
    let hlf = normalize(L1 - rrd);
    let spec = pow(clamp(dot(nr, hlf), 0.0, 1.0), gloss) * 0.9;
    let fres = pow(clamp(1.0 + dot(rrd, nr), 0.0, 1.0), 3.0);
    var cc = alb * (vec3f(0.10, 0.11, 0.16) + vec3f(1.0, 0.95, 0.88) * dif);
    cc += vec3f(spec);
    cc += vec3f(0.35, 0.45, 0.7) * fres * 0.35;
    // crystal edges: darker bevel + a thread of light
    cc = mix(cc, cc * 0.35 + vec3f(0.5, 0.55, 0.65) * 0.35, edge * 0.85);
    cc += emis;
    col = cc;
  }

  // thruster plumes — additive glow, distance from the ray to points trailing each bell
  if (plume > 0.02) {
    let n = i32(uni(0));
    for (var i = 0; i < 56; i++) {
      if (i >= n) { break; }
      let packed = uni(8 + i);
      if (ga_celltype(packed) != 1.0) { continue; }
      let c = ga_cellpos(packed);
      for (var s = 1; s <= 3; s++) {
        let fs = f32(s);
        var pp = c - vec3f(fs * 0.5, 0.0, 0.0);   // exhaust streams -x (flight axis)
        if (mode > 0.5) {
          pp = ga_rot(pp, -tumble * 0.35, 0.0);
          pp = ga_rot(pp, 0.0, -tumble);
        }
        let w = pp - ro;
        let dRay = length(cross(rd, w));
        let flick = 0.8 + 0.25 * sin(time * 17.0 + fs * 2.0 + f32(i));
        col += vec3f(1.6, 0.75, 0.22) * exp(-dRay * dRay * (30.0 + fs * 22.0)) * plume * flick / fs;
      }
    }
  }

  return vec4f(col, 1.0);
}`

const HUD = /* wgsl */`
fn visual_ga_hud(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [selectedPart 1..5, fuel01, balance01 (1 = clean), mode]
  var c = vec3f(0.0);
  var a = 0.0;
  // component legend: thruster / tank / solar / cargo / shield — W/S moves the ring
  for (var i = 1; i <= 5; i++) {
    let fi = f32(i);
    var tint = vec3f(1.5, 0.55, 0.15);                       // thruster ember
    if (i == 2) { tint = vec3f(0.55, 0.62, 0.70); }          // tank steel
    if (i == 3) { tint = vec3f(0.25, 0.35, 1.2); }           // solar blue
    if (i == 4) { tint = vec3f(0.9, 0.55, 0.18); }           // cargo amber
    if (i == 5) { tint = vec3f(0.35, 0.95, 1.1); }           // shield cyan
    let ctr = vec2f(-0.72 + (fi - 1.0) * 0.36, 0.30);
    let q = (uv - ctr) * vec2f(7.0, 3.2);
    let d = length(q);
    let sel = select(0.0, 1.0, abs(p.x - fi) < 0.5);
    c += tint * exp(-d * d * (2.2 - sel * 0.8)) * (0.35 + 0.75 * sel);
    // selection ring
    c += vec3f(0.9, 1.0, 1.1) * exp(-pow((d - 0.75) * 6.0, 2.0)) * sel * (0.7 + 0.3 * sin(time * 6.0));
    a = max(a, exp(-d * d * 1.4) * (0.5 + 0.4 * sel));
  }
  // fuel + balance bars underneath
  for (var i = 0; i < 2; i++) {
    let y0 = -0.30 - f32(i) * 0.42;
    var v = p.y;
    var tint = vec3f(0.4, 0.9, 1.2);
    if (i == 1) { v = p.z; tint = mix(vec3f(1.3, 0.3, 0.2), vec3f(0.3, 1.2, 0.5), p.z); }
    let bx = (uv.x + 0.9) / 1.8;
    if (bx > 0.0 && bx < 1.0 && abs(uv.y - y0) < 0.10) {
      let on = step(bx, clamp(v, 0.0, 1.0));
      c += mix(vec3f(0.05, 0.05, 0.07), tint, on) * exp(-pow((uv.y - y0) * 14.0, 2.0));
      a = max(a, exp(-pow((uv.y - y0) * 12.0, 2.0)) * 0.75);
    }
  }
  return vec4f(c, clamp(a, 0.0, 1.0) * 0.9);
}`

// ─────────────────────────────────────────────────────────────────────────────
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__ga) wd.__ga = {
    cells: [{ i: 0, j: 0, k: 0, t: 0 }],
    cursor: 0, part: 1, yaw: 0.7, pitch: 0.35,
    mode: 0, prev: {}, score: 0, best: 0,
    fl: null, msgT: 0,
  }
  const G = wd.__ga
  let world = null, hud = null
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Yard')) world = f
    else if (n.startsWith('GARNET')) hud = f
  }
  if (!world) return

  const PARTS = ['core', 'thruster', 'tank', 'solar', 'cargo', 'shield']
  const MASS = [3, 2, 1.5, 1, 2.5, 2]
  const NBRS = [[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],[0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1]]
  const key = c => c.i + ',' + c.j + ',' + c.k
  const pressed = k => { const now = !!wd['key_' + k]; const was = !!G.prev[k]; G.prev[k] = now; return now && !was }

  // camera always steerable
  const dt2 = Math.min(dt, 0.05)
  if (wd.key_left) G.yaw -= 1.6 * dt2
  if (wd.key_right) G.yaw += 1.6 * dt2
  if (wd.key_up) G.pitch = Math.min(1.25, G.pitch + 1.2 * dt2)
  if (wd.key_down) G.pitch = Math.max(-1.25, G.pitch - 1.2 * dt2)

  // ship stats (shared by both modes)
  const occ = new Set(G.cells.map(key))
  let mass = 0, thrust = 0, tanks = 0, solar = 0, cargo = 0, shield = 0
  let comX = 0, comY = 0, comZ = 0, thX = 0, thY = 0, thZ = 0, nth = 0
  for (const c of G.cells) {
    mass += MASS[c.t]
    comX += c.i * MASS[c.t]; comY += c.j * MASS[c.t]; comZ += c.k * MASS[c.t]
    if (c.t === 1) { thrust += 4; nth++; thX += c.i; thY += c.j; thZ += c.k }
    if (c.t === 2) tanks++
    if (c.t === 3) solar++
    if (c.t === 4) cargo++
    if (c.t === 5) shield++
  }
  comX /= mass; comY /= mass; comZ /= mass
  const power = 5 + 2 * solar
  const need = 1.5 * nth + 0.5 * shield
  const powerOK = power >= need
  // torque: lateral offset of thrust centroid from the center of mass (flight axis = x)
  let offY = 0, offZ = 0
  if (nth > 0) { offY = thY / nth - comY; offZ = thZ / nth - comZ }
  const imbalance = Math.hypot(offY, offZ)
  const balance01 = Math.max(0, 1 - imbalance / 1.6)

  if (G.mode === 0) {
    // ── BUILD ──
    // enumerate open attachment sites, sorted by screen angle so A/D cycles visually
    const sites = []
    const seen = new Set()
    for (const c of G.cells) for (const o of NBRS) {
      const s = { i: c.i + o[0], j: c.j + o[1], k: c.k + o[2] }
      if (Math.abs(s.i) > 4 || Math.abs(s.j) > 4 || Math.abs(s.k) > 4) continue
      const kk = key(s)
      if (occ.has(kk) || seen.has(kk)) continue
      seen.add(kk); sites.push(s)
    }
    const cy = Math.cos(G.yaw), sy = Math.sin(G.yaw)
    sites.sort((a, b) => {
      const aa = Math.atan2(a.j, -sy * a.i + cy * a.k)
      const bb = Math.atan2(b.j, -sy * b.i + cy * b.k)
      return aa - bb || a.i - b.i || a.j - b.j || a.k - b.k
    })
    if (sites.length === 0) return
    G.cursor = ((G.cursor % sites.length) + sites.length) % sites.length
    if (pressed('a')) G.cursor = (G.cursor + sites.length - 1) % sites.length
    if (pressed('d')) G.cursor = (G.cursor + 1) % sites.length
    if (pressed('w')) G.part = G.part % 5 + 1
    if (pressed('s')) G.part = (G.part + 3) % 5 + 1
    const site = sites[G.cursor]
    if (pressed('space') && G.cells.length < 48) {
      G.cells.push({ i: site.i, j: site.j, k: site.k, t: G.part })
    }
    if (pressed('shift') && G.cells.length > 1) G.cells.pop()
    if (pressed('enter')) {
      if (nth > 0 && powerOK) {
        G.mode = 1
        G.fl = { t: 0, v: 0, dist: 0, tumble: 0, spin: 0, fuel: 6 + 4 * tanks }
      } else {
        G.msgT = 4  // can't fly yet — say why, loudly, in the title
      }
    }
    G.msgT = Math.max(0, G.msgT - dt2)

    // pack whiteboard: cells + pulsing ghost (type 9)
    const packed = G.cells.map(c => c.t * 1000 + (c.i + 4) + (c.j + 4) * 9 + (c.k + 4) * 81)
    packed.push((6 + G.part) * 1000 + (site.i + 4) + (site.j + 4) * 9 + (site.k + 4) * 81)
    wd.gpuUniforms = [packed.length, 0, G.yaw, G.pitch, 0, 0, 0, 0, ...packed]
    if (hud) {
      hud.visualParams = [G.part, 1, balance01, 0]
      let warn = ''
      if (nth === 0) warn = ' \\u26a0 no thruster \\u2014 W/S to the orange dot, place one'
      else if (!powerOK) warn = ' \\u26a0 power ' + power + '/' + Math.ceil(need) + ' \\u2014 add ' + Math.ceil((need - power) / 2) + ' solar'
      else warn = ' \\u00b7 READY \\u2014 ENTER to launch'
      hud.name = 'GARNET \\u00b7 placing: ' + PARTS[G.part].toUpperCase() + ' \\u00b7 ' + G.cells.length + ' cells \\u00b7 T/W ' +
        (thrust / mass).toFixed(2) + warn + ' \\u00b7 best ' + G.best
    }
  } else {
    // ── FLIGHT ──
    const F = G.fl
    F.t += dt2
    const burning = F.fuel > 0
    if (burning) {
      F.fuel -= nth * 0.35 * dt2
      // tumble torque from off-axis thrust; spin kills effective acceleration
      F.spin += imbalance * (thrust / mass) * 0.55 * dt2
      F.tumble += F.spin * dt2
      const eff = Math.max(0.05, Math.cos(Math.min(Math.abs(F.tumble), 1.4)))
      F.v += (thrust / mass) * eff * 2.2 * dt2
    }
    F.v = Math.max(0, F.v - 0.15 * dt2 * F.v)
    F.dist += F.v * dt2
    if (F.t > 18 || (!burning && F.v < 0.4)) {
      G.score = Math.round(F.dist * (1 + 0.15 * cargo))
      if (G.score > G.best) G.best = G.score
      G.mode = 0
      G.fl = null
    } else {
      const packed = G.cells.map(c => c.t * 1000 + (c.i + 4) + (c.j + 4) * 9 + (c.k + 4) * 81)
      wd.gpuUniforms = [packed.length, 1, G.yaw, G.pitch, 0,
        burning ? 1 : 0, F.tumble, Math.min(1, F.v / 8), ...packed]
      if (hud) {
        hud.visualParams = [0, Math.max(0, F.fuel / (6 + 4 * tanks)), balance01, 1]
        hud.name = 'GARNET \\u00b7 FLIGHT ' + Math.ceil(18 - F.t) + 's \\u00b7 dist ' +
          Math.round(F.dist) + (Math.abs(F.tumble) > 0.8 ? ' \\u00b7 TUMBLING' : '') + ' \\u00b7 best ' + G.best
      }
    }
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
  name: 'GARNET',
  fields: [
    field('ga_world_f', 'Yard', [0.02, 0.02, 0.05, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'ga_world'),
    field('ga_hud_f', 'GARNET · A/D site · W/S part · SPACE place · SHIFT undo · ENTER launch', [0.9, 0.8, 0.5, 1], 256, 492, { shapeType: 'rect', w: 300, h: 26 }, 'ga_hud', [0, 1, 1, 0]),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: { noPixelSampling: true },
  stepHooks: [{ id: 'garnet_core', author: 'fable', description: 'GARNET: FCC lattice assembly, component stats, launch physics (torque from build asymmetry)', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'ga_world', wgsl: WORLD },
    { name: 'ga_hud', wgsl: HUD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'GARNET', scene }),
})
console.log('GARNET saved:', res.status, await res.text())
