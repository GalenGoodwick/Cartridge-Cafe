// SOLSTICE — you are the sun. WASD carries it across the sky (A/D azimuth, W/S elevation),
// SPACE is a solar flare (burns the cloud away, spikes warmth — careful).
// Light a grove and it grows; too much and it scorches; too little and frost takes it.
// Each grove hides behind different hills — low sun reaches some, not others. A cloud hunts your light.
// All five groves in full bloom at once = a solstice. Night heals scorch but invites frost.
// Save+load: node solstice-cartridge.mjs

// ── shared helpers (uber-shader concatenates all visuals: define once, call anywhere) ──
const HELPERS = /* wgsl */`
fn sol_h(p: vec2f) -> f32 {
  var h = fbm(p * 0.10, 3) * 3.2;
  h = h + smoothstep(6.0, 15.0, abs(p.x)) * 3.2;
  h = h + smoothstep(18.0, 32.0, p.y) * 4.5;
  let lb = p - vec2f(2.5, 7.0);
  h = h - exp(-dot(lb, lb) * 0.020) * 1.9;
  return h;
}
fn sol_suncol(el: f32) -> vec3f {
  return mix(vec3f(1.30, 0.52, 0.20), vec3f(1.18, 1.06, 0.88), smoothstep(0.03, 0.75, el));
}
fn sol_sky(rd: vec3f, sd: vec3f, el: f32, t: f32) -> vec3f {
  let y = max(rd.y, 0.0);
  let day = smoothstep(-0.12, 0.45, el);
  let zen = mix(vec3f(0.030, 0.040, 0.095), vec3f(0.20, 0.42, 0.70), day);
  let horDay = mix(vec3f(0.80, 0.38, 0.16), vec3f(0.42, 0.50, 0.62), smoothstep(0.15, 0.8, el));
  let hor = mix(vec3f(0.055, 0.05, 0.105), horDay, smoothstep(-0.22, 0.08, el));
  var c = mix(hor, zen, pow(y, 0.55));
  let sdot = clamp(dot(rd, sd), 0.0, 1.0);
  c += sol_suncol(el) * pow(sdot, 5.0) * 0.30 * smoothstep(-0.25, 0.0, el);
  c += sol_suncol(el) * pow(sdot, 60.0) * 0.55;
  c += vec3f(5.5, 4.3, 2.9) * smoothstep(0.99968, 0.99987, sdot);
  let night = smoothstep(0.08, -0.16, el);
  if (night > 0.01 && rd.y > 0.02) {
    let sp = rd.xz / (rd.y + 0.5) * 24.0;
    let cell = floor(sp);
    let tw = 0.6 + 0.4 * sin(t * 1.3 + hash21(cell) * 40.0);
    c += vec3f(0.75, 0.8, 1.0) * step(0.991, hash21(cell)) * smoothstep(0.3, 0.06, length(fract(sp) - 0.5)) * night * tw;
    c += vec3f(0.10, 0.09, 0.16) * pow(max(1.0 - abs(rd.x + rd.y * 0.5), 0.0), 3.0) * night;  // faint milky band
  }
  return c;
}
fn sol_can(uv: vec2f, growth: f32, seed: f32) -> f32 {
  let cs = 0.26 + growth * 0.42;
  var can = length((uv - vec2f(0.0, 0.02 - 0.30 * growth)) / vec2f(1.12, 1.0)) - cs;
  can = min(can, length(uv - vec2f(-0.26 * (0.4 + growth), 0.16 - 0.22 * growth)) - cs * 0.64);
  can = min(can, length(uv - vec2f(0.27 * (0.4 + growth), 0.17 - 0.24 * growth)) - cs * 0.60);
  can = can + (vnoise(uv * 6.5 + vec2f(seed * 17.0, seed * 9.0)) - 0.5) * 0.16;
  return can;
}`

const VALE = /* wgsl */`
fn visual_sol_vale(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [sunAz, sunEl, cloudAz, cloudBlock01]
  let az = p.x;
  let el = p.y;
  let sd = normalize(vec3f(cos(az) * cos(el), sin(el), sin(az) * cos(el)));
  let scr = vec2f(uv.x, -uv.y);
  let ro = vec3f(0.0, 3.4, -9.0);
  let rd = normalize(vec3f(scr.x, scr.y * 0.90 - 0.22, 1.75));
  let dayl = smoothstep(-0.05, 0.30, el);
  let sunc = sol_suncol(max(el, 0.0));
  let block = clamp(p.w, 0.0, 1.0);
  let sunPow = (1.0 - 0.55 * block) * dayl;

  // march the terrain
  var t = 0.0;
  var hit = false;
  var pt = ro;
  for (var i = 0; i < 56; i++) {
    pt = ro + rd * t;
    let d = pt.y - sol_h(pt.xz);
    if (d < 0.012 * (1.0 + t)) { hit = true; break; }
    t = t + clamp(d * 0.45, 0.03, 0.9);
    if (t > 52.0) { break; }
  }

  var c: vec3f;
  let skyc = sol_sky(rd, sd, el, time);

  // lake plane
  let wl = 0.62;
  var tw = -1.0;
  if (rd.y < -0.005) { tw = (wl - ro.y) / rd.y; }
  let ptw = ro + rd * max(tw, 0.0);
  let lb2 = ptw.xz - vec2f(2.5, 7.0);
  let inBasin = tw > 0.0 && dot(lb2, lb2) < 40.0 && sol_h(ptw.xz) < wl + 0.05 && (!hit || tw < t);

  if (inBasin) {
    // calm lake: perturbed mirror of the sky, sun glitter, shore fade
    let wn = (vnoise(ptw.xz * 3.0 + vec2f(time * 0.4, time * 0.25)) - 0.5) * 0.22;
    let rrd = normalize(vec3f(rd.x + wn, -rd.y * (1.0 + wn), rd.z + wn * 0.6));
    var wc = sol_sky(rrd, sd, el, time) * 0.8;
    let fresH = clamp(1.0 + rd.y * 2.2, 0.08, 1.0);
    wc = mix(vec3f(0.015, 0.045, 0.050), wc, 0.25 + 0.75 * (1.0 - fresH));
    let glit = pow(max(dot(rrd, sd), 0.0), 130.0);
    wc += sunc * glit * 4.2 * sunPow;
    let shore = smoothstep(wl + 0.06, wl - 0.10, sol_h(ptw.xz)) * smoothstep(40.0, 26.0, dot(lb2, lb2));
    c = mix(vec3f(0.10, 0.12, 0.08), wc, shore);
  } else if (hit && t <= 52.0) {
    let e = 0.06 + t * 0.005;
    let hC = sol_h(pt.xz);
    let n = normalize(vec3f(hC - sol_h(pt.xz + vec2f(e, 0.0)), e, hC - sol_h(pt.xz + vec2f(0.0, e))));
    // meadow → dry gold → rock by slope & noise
    let g1 = vnoise(pt.xz * 0.8);
    var alb = mix(vec3f(0.085, 0.150, 0.055), vec3f(0.215, 0.185, 0.075), g1);
    alb = mix(alb, vec3f(0.155, 0.125, 0.10), smoothstep(0.28, 0.55, 1.0 - n.y));
    alb = alb * (0.82 + 0.36 * vnoise(pt.xz * 6.5));
    // soft raymarched shadow toward your sun
    var sh = 1.0;
    if (el > 0.005) {
      var ts = 0.4;
      for (var j = 0; j < 5; j++) {
        let sp2 = pt + sd * ts + vec3f(0.0, 0.03, 0.0);
        sh = min(sh, clamp((sp2.y - sol_h(sp2.xz)) * 1.9 / ts, 0.0, 1.0));
        ts = ts * 2.0;
      }
    }
    let dif = max(dot(n, sd), 0.0) * sh * sunPow;
    let amb = mix(vec3f(0.045, 0.055, 0.105), vec3f(0.26, 0.34, 0.48), dayl) * (0.38 + 0.42 * max(n.y, 0.0));
    c = alb * (amb * 0.85 + sunc * dif * 2.1);
    let fog = 1.0 - exp(-t * 0.016);
    c = mix(c, skyc * 0.45 + vec3f(0.01), fog);
  } else {
    c = skyc;
  }

  // the cloud — a slow cumulus parked where the hook says, dimming your sun when it blocks
  if (block > 0.01 || p.z > -90.0) {
    let cd = normalize(vec3f(cos(p.z) * 0.92, 0.36, sin(p.z) * 0.92));
    let cdot = dot(rd, cd);
    if (cdot > 0.90) {
      let m = smoothstep(0.930, 0.978, cdot);
      let puff = fbm(vec2f(rd.x * 9.0 - rd.y * 4.0, rd.z * 9.0 + rd.y * 5.0) + vec2f(time * 0.02, 0.0), 4);
      let body = smoothstep(0.42, 0.72, puff) * m;
      let litEdge = clamp(dot(rd, sd) * 0.5 + 0.5, 0.0, 1.0);
      let ccol = mix(mix(vec3f(0.16, 0.16, 0.21), vec3f(0.5, 0.42, 0.40), dayl), sunc * 0.9, litEdge * 0.45 * dayl);
      c = mix(c, ccol, body * 0.9);
    }
  }
  return vec4f(c, 1.0);
}`

const GROVE = /* wgsl */`
fn visual_sol_grove(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [growth01, stress(-1 frost .. +1 scorch), packedSun, dim01] — a living tree, lit by YOUR sun
  let growth = clamp(p.x, 0.02, 1.0);
  let stress = clamp(p.y, -1.0, 1.0);
  let az = floor(p.z) / 100.0;
  let el = fract(p.z) / 0.9 * 1.6 - 0.3;
  let dim = clamp(p.w, 0.0, 1.0);
  let dayl = smoothstep(-0.05, 0.30, el);
  let sunc = sol_suncol(max(el, 0.0)) * (1.0 - 0.55 * dim);
  // screen-space light: sun az relative to camera forward (+z is up-screen for the valley)
  let l2 = normalize(vec2f(-cos(az), -(0.28 + max(el, 0.0) * 0.9)));
  let seed = p.z * 0.001;

  var c = vec3f(0.0);
  var a = 0.0;
  let base = vec2f(0.0, 0.60);

  // contact shadow + meadow patch that greens as the grove thrives
  let gq = (uv - base) / vec2f(0.85, 0.28);
  let gd = length(gq);
  if (gd < 1.0) {
    let lush = mix(vec3f(0.16, 0.13, 0.05), vec3f(0.07, 0.16, 0.05), growth) * (0.35 + 0.65 * dayl);
    c = lush * (0.6 + 0.4 * vnoise(uv * 14.0 + seed));
    a = smoothstep(1.0, 0.55, gd) * 0.85;
  }

  // trunk — leans with its own character
  let lean = (fract(seed * 57.0) - 0.5) * 0.22;
  let top = vec2f(lean, 0.60 - 0.62 * growth - 0.06);
  let trunkD = sdSegment(uv, base, top) - mix(0.028, 0.062, growth);
  if (trunkD < 0.0) {
    let bark = 0.75 + 0.25 * vnoise(uv * vec2f(9.0, 40.0) + seed);
    c = vec3f(0.14, 0.095, 0.06) * bark * (0.35 + 0.65 * dayl) * (1.0 + 0.6 * clamp(dot(vec2f(1.0, 0.0), -l2), 0.0, 1.0));
    a = 1.0;
  }

  // canopy — lambert-lit blobs, blossoms on the sunny side when thriving
  let cq = (uv - vec2f(lean, 0.60 - 0.62 * growth - 0.10)) / (0.55 + 0.45 * growth);
  let can = sol_can(cq, growth, seed);
  if (can < 0.0) {
    let e = 0.04;
    let n2 = normalize(vec2f(
      sol_can(cq + vec2f(e, 0.0), growth, seed) - can,
      sol_can(cq + vec2f(0.0, e), growth, seed) - can));
    let lam = clamp(dot(-n2, l2) * 0.6 + 0.5, 0.0, 1.2);
    // leaf base: young sage → deep summer green
    var leaf = mix(vec3f(0.14, 0.17, 0.06), vec3f(0.06, 0.14, 0.045), growth);
    leaf = leaf * (0.75 + 0.5 * vnoise(cq * 11.0 + seed * 40.0));
    // frost: pale, blue-dusted; scorch: browned, worst on the lit crown
    leaf = mix(leaf, vec3f(0.42, 0.50, 0.58), max(-stress, 0.0) * 0.75);
    leaf = mix(leaf, vec3f(0.19, 0.10, 0.03), max(stress, 0.0) * (0.4 + 0.5 * lam));
    let clump = 0.55 + 0.6 * smoothstep(0.35, 0.75, vnoise(cq * 5.5 + vec2f(seed * 31.0, 2.0)));
    var cc = (leaf * (0.16 + 0.30 * dayl) + leaf * sunc * lam * 1.7) * clump;
    // blossoms past 0.7 growth — catch the light, HDR at full bloom
    if (growth > 0.7) {
      let bl = smoothstep(0.62, 0.95, vnoise(cq * 16.0 + vec2f(seed * 90.0, 0.0)));
      let bloom = (growth - 0.7) / 0.3;
      let petal = mix(vec3f(0.9, 0.55, 0.60), vec3f(1.6, 1.15, 0.95), bloom);
      cc = mix(cc, petal * (0.4 + 0.8 * lam * dayl + 0.25), bl * bloom * (1.0 - max(stress, 0.0)));
    }
    c = cc;
    a = 1.0;
  }
  // night: settle into silhouette
  c = mix(c * vec3f(0.55, 0.6, 0.9), c, max(dayl, 0.25));
  a = a * smoothstep(1.0, 0.94, length(uv));
  return vec4f(c, a);
}`

const HUD = /* wgsl */`
fn visual_sol_hud(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [bloomCount, seasonT01, flareReady01, solstices] — quiet glass
  var c = vec3f(0.0);
  var a = 0.0;
  // season arc
  let q = (uv - vec2f(-0.86, 0.0)) * vec2f(7.0, 3.2);
  let r = length(q);
  if (r > 0.30 && r < 0.46) {
    let ang = atan2(q.y, q.x) + 3.14159;
    let f = ang / 6.28318;
    let on = select(0.10, 0.85, f < p.y);
    c += vec3f(0.85, 0.75, 0.45) * on;
    a = max(a, 0.55);
  }
  // five grove pips
  for (var i = 0; i < 5; i++) {
    let g = (uv - vec2f(-0.30 + f32(i) * 0.14, 0.0)) * vec2f(10.0, 4.5);
    let gl = exp(-dot(g, g) * 1.6);
    let on = select(0.14, 1.0, f32(i) < p.x);
    c += vec3f(1.35, 0.95, 0.75) * gl * on;
    a = max(a, gl * 0.7);
  }
  // flare pip
  let fq = (uv - vec2f(0.62, 0.0)) * vec2f(10.0, 4.5);
  let fd = abs(fq.x) + abs(fq.y);
  c += vec3f(1.5, 0.8, 0.3) * exp(-fd * fd * 1.8) * (0.15 + 0.85 * p.z);
  a = max(a, exp(-fd * fd * 1.8) * 0.6);
  // solstice stars
  for (var i = 0; i < 4; i++) {
    let sq = (uv - vec2f(0.78 + f32(i) * 0.075, 0.0)) * vec2f(13.0, 6.0);
    let on = select(0.0, 1.0, f32(i) < p.w);
    let gl = exp(-dot(sq, sq) * 1.8) * on;
    c += vec3f(1.6, 1.4, 0.9) * gl;
    a = max(a, gl * 0.8);
  }
  return vec4f(c * 1.2, clamp(a, 0.0, 1.0) * 0.8);
}`

// ─────────────────────────────────────────────────────────────────────────────
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__sol) wd.__sol = {
    az: 1.90, el: 0.45, t: 0,
    cloudAz: 5.0, cloudBlock: 0, cloudAlive: 1, cloudRespawn: 0,
    flareCd: 0, pSpace: false,
    season: 150, solstices: 0, level: 1,
    g: [
      { phi: 0.6,  amp: 0.42, base: 0.10, warm: 0.6, growth: 0.25, scorch: 0, frost: 0 },
      { phi: 1.9,  amp: 0.38, base: 0.14, warm: 0.6, growth: 0.25, scorch: 0, frost: 0 },
      { phi: 3.1,  amp: 0.50, base: 0.10, warm: 0.6, growth: 0.25, scorch: 0, frost: 0 },
      { phi: 4.4,  amp: 0.36, base: 0.16, warm: 0.6, growth: 0.25, scorch: 0, frost: 0 },
      { phi: 5.6,  amp: 0.46, base: 0.12, warm: 0.6, growth: 0.25, scorch: 0, frost: 0 },
    ]
  }
  const S = wd.__sol
  S.t += dt
  let vale = null, hud = null
  const groves = []
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Vale')) vale = f
    else if (n.startsWith('Grove')) groves.push(f)
    else if (n.startsWith('SOLSTICE')) hud = f
  }
  if (vale && groves.length === 5) {
    groves.sort((a, b) => (a.name < b.name ? -1 : 1))

    // ── carry the sun ──
    const AZ = 0.85 * dt, EL = 0.55 * dt
    if (wd.key_a) S.az -= AZ
    if (wd.key_d) S.az += AZ
    if (wd.key_w) S.el = Math.min(1.30, S.el + EL)
    if (wd.key_s) S.el = Math.max(-0.28, S.el - EL)
    S.az += 0.012 * dt                       // the day turns on its own, slowly
    while (S.az < 0) S.az += 6.28318
    while (S.az >= 6.28318) S.az -= 6.28318
    const day = S.el > 0.02

    // ── the cloud hunts your light ──
    S.flareCd = Math.max(0, S.flareCd - dt)
    if (S.cloudAlive > 0.5) {
      let dAz = S.az - S.cloudAz
      while (dAz > Math.PI) dAz -= 2 * Math.PI
      while (dAz < -Math.PI) dAz += 2 * Math.PI
      S.cloudAz += Math.sign(dAz) * Math.min(Math.abs(dAz), 0.055 * dt * (1 + 0.35 * S.level))
      const blocking = Math.abs(dAz) < 0.30 && day ? 1 : 0
      S.cloudBlock += (blocking - S.cloudBlock) * Math.min(1, dt * 2.5)
    } else {
      S.cloudBlock += (0 - S.cloudBlock) * Math.min(1, dt * 3)
      S.cloudRespawn -= dt
      if (S.cloudRespawn <= 0) { S.cloudAlive = 1; S.cloudAz = S.az + Math.PI }
    }
    const sp = !!wd.key_space
    if (sp && !S.pSpace && S.flareCd <= 0) {
      S.flareCd = 15
      S.cloudAlive = 0; S.cloudRespawn = 22
      for (const g of S.g) if (g.lit) g.warm = Math.min(2.2, g.warm + 0.55)   // flares burn
    }
    S.pSpace = sp

    // ── light does the gardening ──
    const dim = 1 - 0.55 * S.cloudBlock
    let fullCount = 0
    S.g.forEach((g, i) => {
      // each grove's horizon: hills carve a different shadow sector per grove
      const horizon = g.base + g.amp * Math.max(0, Math.cos(S.az - g.phi)) + 0.10 * Math.cos(2 * (S.az - g.phi) + 1.1)
      g.lit = day && S.el > horizon
      const gain = g.lit ? (0.30 + 0.75 * Math.sin(Math.min(S.el, 1.4))) * dim : 0
      g.warm += (gain * 0.55 - 0.16) * dt
      g.warm = Math.max(0, Math.min(2.2, g.warm))
      // sweet band grows; extremes wound
      if (g.warm > 0.45 && g.warm < 1.45) g.growth += dt * 0.030 * (1 - g.frost * 0.5)
      if (g.warm > 1.75) g.scorch = Math.min(1, g.scorch + dt * 0.09)
      if (g.warm < 0.10 && g.growth > 0.05) g.frost = Math.min(1, g.frost + dt * (day ? 0.02 : 0.045))
      // wounds bleed growth; night heals scorch, light melts frost
      g.growth -= dt * (g.scorch * 0.035 + g.frost * 0.028)
      if (!day) g.scorch = Math.max(0, g.scorch - dt * 0.035)
      if (g.lit) g.frost = Math.max(0, g.frost - dt * 0.06)
      g.growth = Math.max(0.02, Math.min(1, g.growth))
      if (g.growth >= 0.95) fullCount++
      const packedSun = Math.floor(S.az * 100) + Math.max(0, Math.min(0.99, (S.el + 0.3) / 1.6 * 0.9))
      groves[i].visualParams = [g.growth, g.scorch - g.frost, packedSun, S.cloudBlock]
    })

    // ── the season wheel ──
    S.season -= dt
    if (fullCount === 5) {
      S.solstices++
      S.level++
      S.season = Math.max(100, 160 - S.level * 10)
      for (const g of S.g) { g.growth = 0.30; g.scorch = 0; g.frost = 0; g.warm = 0.6 }
    } else if (S.season <= 0) {
      // winter takes the unfinished season
      S.season = 150
      for (const g of S.g) { g.growth = Math.max(0.05, g.growth * 0.45); g.frost = Math.min(1, g.frost + 0.3) }
    }

    vale.visualParams = [S.az, S.el, S.cloudAlive > 0.5 ? S.cloudAz : -99, S.cloudBlock]
    if (hud) {
      hud.visualParams = [fullCount, Math.max(0, S.season) / 160, S.flareCd <= 0 ? 1 : 0, Math.min(4, S.solstices)]
      hud.name = 'SOLSTICE \\u00b7 ' + S.solstices + ' \\u00b7 blooming ' + fullCount + '/5'
    }
  }
} catch (e) { /* keep the sim alive */ }
`

// ─────────────────────────────────────────────────────────────────────────────
// project grove world anchors through the Vale camera to place their fields on screen
const ro = { x: 0, y: 3.4, z: -9 }
const project = (x, y, z) => {
  const rz = z - ro.z
  const sx = (1.75 * x) / rz
  const sy = ((1.75 * (y - ro.y)) / rz + 0.22) / 0.90
  return { fx: 256 + sx * 256, fy: 256 - sy * 256, rz }
}
// world spots (x, groundY-est, z) spread through the valley, clear of the lake at (2.5, 7)
const SPOTS = [
  { x: -4.6, y: 1.7, z: 3.2 },
  { x: 4.4, y: 1.5, z: 4.4 },
  { x: -2.2, y: 1.6, z: 8.0 },
  { x: 6.4, y: 1.9, z: 10.5 },
  { x: 0.6, y: 2.1, z: 14.0 },
]

const field = (id, name, color, x, y, shape, visualTypeName, vp) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
  ...(vp ? { visualParams: vp } : {}),
})

const fields = [
  field('sol_vale_f', 'Vale', [0.05, 0.08, 0.12, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'sol_vale', [1.90, 0.45, 5.0, 0]),
]
SPOTS.forEach((s, i) => {
  const pr = project(s.x, s.y, s.z)
  const treeH = (1.75 * 2.4) / pr.rz * 256           // apparent size falls with distance
  const half = Math.max(28, Math.min(95, treeH))
  // tree base sits at uv.y=+0.60 → center rides above the ground point
  fields.push(field(`sol_grove_${i}`, `Grove ${String.fromCharCode(65 + i)}`, [0.2, 0.5, 0.2, 1],
    Math.round(pr.fx), Math.round(pr.fy - half * 0.60),
    { shapeType: 'circle', radius: Math.round(half) }, 'sol_grove',
    [0.25, 0, 471.5, 0]))
})
fields.push(field('sol_hud_f', 'SOLSTICE · WASD carry the sun · SPACE flare', [0.9, 0.85, 0.7, 1], 256, 24, { shapeType: 'rect', w: 360, h: 30 }, 'sol_hud', [0, 1, 1, 0]))

const scene = {
  name: 'SOLSTICE',
  fields,
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: { noPixelSampling: true },
  stepHooks: [{ id: 'solstice_core', author: 'fable', description: 'SOLSTICE: the player is the sun — light-scheduling ecology with scorch/frost, hunting cloud, seasons', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'sol_vale', wgsl: HELPERS + '\n' + VALE },
    { name: 'sol_grove', wgsl: GROVE },
    { name: 'sol_hud', wgsl: HUD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'SOLSTICE', scene }),
})
console.log('SOLSTICE saved:', res.status, await res.text())
