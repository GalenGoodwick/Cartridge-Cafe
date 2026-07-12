// AURELION — serpent boss-duel cartridge. WASD = swim. SPACE = dash (i-frames, leaves a searing rift).
// Graze the serpent and its bolts to charge dashes. Bait the lunge, dodge, then DASH THROUGH THE HEAD
// while it recovers (white-hot) to wound it. Rifts sear and slow the serpent. Shatter it → NG+ level.
// Save+load: node aurelion-cartridge.mjs

const ARENA = /* wgsl */`
fn visual_aur_arena(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let up = -uv.y;                               // superimposed path: +y is down
  let r = length(uv);
  var c = mix(vec3f(0.012, 0.020, 0.042), vec3f(0.002, 0.004, 0.012), r);
  // god-rays sinking from the surface
  let ang = atan2(uv.x, 1.35 - up);
  var ray = pow(0.5 + 0.5 * sin(ang * 9.0 + time * 0.13), 3.0);
  ray = ray * (0.55 + 0.45 * sin(ang * 4.0 - time * 0.07));
  c += vec3f(0.09, 0.15, 0.21) * ray * smoothstep(-1.3, 1.15, up) * 0.9;
  // caustic shimmer
  c += vec3f(0.028, 0.05, 0.065) * fbm(uv * 3.0 + vec2f(time * 0.02, time * 0.013), 3);
  // two layers of drifting motes
  for (var i = 0; i < 2; i++) {
    let fi = f32(i);
    let sc = 16.0 + fi * 22.0;
    let sp = uv * sc + vec2f(time * 0.014 * (fi + 1.0), time * (0.05 + fi * 0.03));
    let cell = floor(sp);
    let h = hash21(cell + fi * 31.0);
    let fp = fract(sp) - 0.5;
    let mote = step(0.986, h) * smoothstep(0.22, 0.02, length(fp));
    c += vec3f(0.35, 0.5, 0.65) * mote * (0.25 + 0.35 * sin(time * (1.0 + h) + h * 40.0));
  }
  // arena ring
  c += vec3f(0.05, 0.09, 0.13) * exp(-pow((r - 0.93) * 20.0, 2.0));
  c *= 1.0 - 0.45 * r * r;
  return vec4f(c, 1.0);
}`

const KOI = /* wgsl */`
fn visual_aur_koi(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [vx, vy, grazeGlow, state(0 ok, 1 iframes, 2 hurt)]
  let vel = vec2f(p.x, p.y);
  let sp = length(vel);
  var dir = vec2f(0.0);
  if (sp > 1.0) { dir = vel / sp; }
  let d = length(uv);
  var c = vec3f(0.8, 0.95, 1.05) * exp(-d * d * 20.0) * 3.0;
  c += vec3f(0.35, 0.6, 1.0) * exp(-d * d * 5.0) * 0.9;
  // velocity trail
  let tl = clamp(sp / 160.0, 0.0, 1.0);
  for (var i = 1; i <= 5; i++) {
    let fi = f32(i);
    let q = uv + dir * fi * 0.24 * tl;
    c += vec3f(0.5, 0.8, 1.1) * exp(-dot(q, q) * (16.0 + fi * 9.0)) * tl * (1.0 - fi * 0.17);
  }
  // graze halo — gold shimmer when skimming danger
  let gz = clamp(p.z, 0.0, 1.0);
  let shim = 0.6 + 0.4 * sin(atan2(uv.y, uv.x) * 6.0 - time * 9.0);
  c += vec3f(1.3, 0.95, 0.4) * exp(-pow((d - 0.55) * 7.0, 2.0)) * gz * shim * 1.4;
  // states
  if (p.w > 1.5) { c = mix(c, vec3f(1.6, 0.25, 0.2), 0.55); }
  else if (p.w > 0.5) { c *= 0.55 + 0.45 * sin(time * 22.0); }
  let a = clamp(exp(-d * d * 3.2) * 1.6, 0.0, 1.0) * smoothstep(1.05, 0.8, d);
  return vec4f(c, a);
}`

const HEAD = /* wgsl */`
fn visual_aur_head(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [heading, mode(0 roam,1 telegraph,2 lunge,3 recover/vent,5 shatter), hp01, dissolve]
  let d = length(uv);
  let hp = clamp(p.z, 0.0, 1.0);
  var c = mix(vec3f(1.5, 0.8, 0.22), vec3f(0.45, 0.10, 0.03), smoothstep(0.0, 0.95, d));
  // crown crest
  let a0 = atan2(uv.y, uv.x) - p.x;
  c += vec3f(1.2, 0.55, 0.12) * pow(abs(sin(a0 * 3.5)), 8.0) * smoothstep(0.5, 0.95, d) * 0.9;
  // fury undertone when wounded deep
  if (hp < 0.34) { c += vec3f(0.9, 0.2, 0.05) * (0.4 + 0.4 * sin(time * 8.0)); }
  c *= 0.4 + 0.6 * hp;
  // eyes along heading
  let fwd = vec2f(cos(p.x), sin(p.x));
  let sid = vec2f(-fwd.y, fwd.x);
  let e1 = uv - (fwd * 0.30 + sid * 0.26);
  let e2 = uv - (fwd * 0.30 - sid * 0.26);
  var eye = vec3f(2.2, 1.9, 1.3);
  if (p.y > 0.5 && p.y < 1.5) { eye = vec3f(4.5, 3.6, 2.2) * (0.7 + 0.3 * sin(time * 26.0)); }  // telegraph blaze
  c += eye * (exp(-dot(e1, e1) * 90.0) + exp(-dot(e2, e2) * 90.0));
  // recover/vent: white-hot wound window — THIS is when to dash through
  if (p.y > 2.5 && p.y < 3.5) {
    c = mix(c, vec3f(2.4, 2.1, 1.5), 0.45 + 0.25 * sin(time * 10.0));
  }
  // lunge: motion fire
  if (p.y > 1.5 && p.y < 2.5) {
    let q = uv + fwd * 0.5;
    c += vec3f(1.8, 0.9, 0.3) * exp(-dot(q, q) * 3.0) * 0.8;
  }
  // shatter dissolve
  var a = smoothstep(1.0, 0.72, d);
  if (p.y > 4.5) {
    let n = vnoise(uv * 6.0 + vec2f(time * 2.0));
    a *= smoothstep(p.w, p.w + 0.25, n + 0.35);
    c += vec3f(2.0, 1.1, 0.3) * p.w;
  }
  return vec4f(c * 1.35, a);
}`

const SEG = /* wgsl */`
fn visual_aur_seg(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [bodyPhase 0..1, hp01, mode, dissolve]
  let d = length(uv);
  let hp = clamp(p.y, 0.0, 1.0);
  var c = mix(vec3f(1.25, 0.62, 0.16), vec3f(0.35, 0.08, 0.02), smoothstep(0.0, 0.95, d));
  // molten pattern flowing down the body
  let ang = atan2(uv.y, uv.x);
  let flow = sin(d * 11.0 - time * 3.0 - p.x * 12.6) * sin(ang * 5.0 + p.x * 9.0);
  c *= 0.82 + 0.26 * flow;
  // scale glints
  let glint = pow(0.5 + 0.5 * sin(ang * 9.0 + p.x * 30.0 + time * 0.7), 12.0);
  c += vec3f(1.6, 1.0, 0.4) * glint * smoothstep(0.85, 0.4, d) * 0.5;
  // ember rim
  c += vec3f(1.1, 0.42, 0.08) * exp(-pow((d - 0.7) * 8.0, 2.0)) * 0.75;
  c *= 0.35 + 0.65 * hp;
  if (hp < 0.34) { c += vec3f(0.7, 0.16, 0.04) * (0.35 + 0.35 * sin(time * 8.0 + p.x * 20.0)); }
  var a = smoothstep(1.0, 0.7, d);
  if (p.z > 4.5) {
    let n = vnoise(uv * 6.0 + vec2f(time * 2.0, p.x * 8.0));
    a *= smoothstep(p.w, p.w + 0.25, n + 0.35);
    c += vec3f(1.8, 0.9, 0.25) * p.w;
  }
  return vec4f(c * 1.25, a);
}`

const BOLT = /* wgsl */`
fn visual_aur_bolt(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [vx, vy, kind(0 aimed, 1 spiral), hidden]
  if (p.w > 0.5) { return vec4f(0.0); }
  let vel = vec2f(p.x, p.y);
  let sp = length(vel);
  var dir = vec2f(0.0);
  if (sp > 1.0) { dir = vel / sp; }
  let d = length(uv);
  var hot = vec3f(1.5, 0.7, 0.15);
  if (p.z > 0.5) { hot = vec3f(1.1, 0.45, 1.5); }
  var c = hot * exp(-d * d * 15.0) * 2.6;
  for (var i = 1; i <= 3; i++) {
    let q = uv + dir * f32(i) * 0.3;
    c += hot * exp(-dot(q, q) * 22.0) * (1.0 - f32(i) * 0.24) * 0.85;
  }
  let a = clamp(exp(-d * d * 6.0) * 1.5, 0.0, 1.0);
  return vec4f(c, a);
}`

const SHARD = /* wgsl */`
fn visual_aur_shard(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [seed, ttl01, 0, hidden]
  if (p.w > 0.5) { return vec4f(0.0); }
  let q = rotate(uv, time * 1.2 + p.x * 6.0);
  let s = sdStar(q, 0.5, 4, 2.6);
  let hue = fract(0.55 + 0.25 * sin(p.x * 9.0 + time * 0.4));
  var c = hsv2rgb(vec3f(hue, 0.45, 1.0)) * exp(-max(s, 0.0) * 9.0) * 2.2;
  c += vec3f(1.2) * exp(-dot(uv, uv) * 26.0) * 1.4;
  let tw = 0.7 + 0.3 * sin(time * 7.0 + p.x * 20.0);
  let a = clamp(exp(-max(s, 0.0) * 7.0) * 1.4, 0.0, 1.0) * tw * clamp(p.y * 4.0, 0.0, 1.0);
  return vec4f(c * tw, a);
}`

const RIFT = /* wgsl */`
fn visual_aur_rift(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [age01, dirAngle, 0, 0]
  let age = clamp(p.x, 0.0, 1.0);
  if (age >= 1.0) { return vec4f(0.0); }
  let q = rotate(uv, -p.y);
  let d = sdSegment(q, vec2f(-0.75, 0.0), vec2f(0.75, 0.0));
  let fade = pow(1.0 - age, 1.6);
  var c = vec3f(1.5, 1.25, 0.7) * exp(-d * d * 220.0) * 2.4 * fade;
  c += vec3f(0.7, 0.5, 1.2) * exp(-d * d * 30.0) * 0.9 * fade;
  let shim = 0.7 + 0.3 * sin(q.x * 30.0 - time * 12.0);
  let a = clamp(exp(-d * d * 40.0) * 1.6 * fade * shim, 0.0, 1.0);
  return vec4f(c * shim, a);
}`

const HUD = /* wgsl */`
fn visual_aur_hud(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [hearts, dashCharges(+fraction), bossHp01, level]
  var c = vec3f(0.0);
  var a = 0.0;
  // hearts, left
  for (var i = 0; i < 3; i++) {
    let q = (uv - vec2f(-0.82 + f32(i) * 0.10, 0.25)) * vec2f(11.0, 5.0);
    let on = select(0.10, 1.0, f32(i) < p.x);
    let g = exp(-dot(q, q) * 1.3);
    c += vec3f(1.2, 0.25, 0.35) * g * on;
    a = max(a, g * 0.9);
  }
  // dash pips (diamonds), left-under
  for (var i = 0; i < 3; i++) {
    let q = (uv - vec2f(-0.82 + f32(i) * 0.10, -0.45)) * vec2f(11.0, 5.0);
    let dd = abs(q.x) + abs(q.y);
    let fill = clamp(p.y - f32(i), 0.0, 1.0);
    let g = exp(-dd * dd * 1.6);
    c += vec3f(0.35, 0.95, 1.2) * g * (0.10 + 0.9 * fill);
    a = max(a, g * 0.85);
  }
  // boss bar, center-right
  let bx = (uv.x - 0.18) / 0.72;
  if (bx > 0.0 && bx < 1.0 && abs(uv.y - 0.15) < 0.22) {
    let fill = step(bx, p.z);
    let edge = exp(-pow((uv.y - 0.15) * 9.0, 2.0));
    c += mix(vec3f(0.10, 0.03, 0.02), vec3f(1.5, 0.75, 0.2), fill) * edge;
    a = max(a, edge * 0.85);
  }
  // level pips under boss bar
  for (var i = 0; i < 5; i++) {
    let q = (uv - vec2f(0.22 + f32(i) * 0.08, -0.55)) * vec2f(14.0, 7.0);
    let on = select(0.08, 1.0, f32(i) < p.w);
    let g = exp(-dot(q, q) * 1.5);
    c += vec3f(1.3, 0.95, 0.35) * g * on;
    a = max(a, g * 0.8 * on);
  }
  return vec4f(c * 1.4, clamp(a, 0.0, 1.0));
}`

// ─────────────────────────────────────────────────────────────────────────────
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__aur) wd.__aur = {
    score: 0, best: 0, hearts: 3, inv: 2.0, hurt: 0,
    charges: 3, meter: 0, dashT: 0, pSpace: false, lastDir: [1, 0],
    riftAge: 9, riftDir: 0, level: 1, graze: 0,
    B: { hp: 100, max: 100, st: 'hunt', t: 0, ang: 0, orb: 1, volT: 3, spiT: 0.5, lx: 0, ly: 0, sx: 0, sy: 1 }
  }
  const G = wd.__aur, B = G.B
  let koi = null, head = null, hud = null, rift = null
  const segs = [], bolts = [], shards = []
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Koi')) koi = f
    else if (n.startsWith('Serpent Head')) head = f
    else if (n.startsWith('Serpent ')) segs.push(f)
    else if (n.startsWith('Bolt')) bolts.push(f)
    else if (n.startsWith('Shard')) shards.push(f)
    else if (n.startsWith('Rift')) rift = f
    else if (n.startsWith('AURELION')) hud = f
  }
  if (koi && head && segs.length) {
    segs.sort((a, b) => (a.name < b.name ? -1 : 1))
    const T = f => f.transform
    const lvl = G.level - 1
    const hp01 = Math.max(0, B.hp / B.max)
    const phase = hp01 > 0.66 ? 1 : hp01 > 0.33 ? 2 : 3
    G.inv = Math.max(0, G.inv - dt); G.hurt = Math.max(0, G.hurt - dt)
    G.dashT = Math.max(0, G.dashT - dt); G.graze = Math.max(0, G.graze - dt * 3)
    G.riftAge += dt / 1.7

    // ── player: WASD swim ──
    const ACC = 400 * dt
    let ix = 0, iy = 0
    if (wd.key_a) { T(koi).vx -= ACC; ix -= 1 }
    if (wd.key_d) { T(koi).vx += ACC; ix += 1 }
    if (wd.key_w) { T(koi).vy -= ACC; iy -= 1 }
    if (wd.key_s) { T(koi).vy += ACC; iy += 1 }
    if (ix || iy) { const m = Math.hypot(ix, iy); G.lastDir = [ix / m, iy / m] }
    const cap = G.dashT > 0 ? 560 : 175
    const kv = Math.hypot(T(koi).vx, T(koi).vy)
    if (kv > cap) { T(koi).vx *= cap / kv; T(koi).vy *= cap / kv }

    // ── dash: SPACE (edge-triggered) — i-frames + searing rift ──
    const sp = !!wd.key_space
    if (sp && !G.pSpace && G.charges >= 1 && G.dashT <= 0) {
      G.charges--
      G.dashT = 0.38
      G.inv = Math.max(G.inv, 0.5)
      T(koi).vx = G.lastDir[0] * 560; T(koi).vy = G.lastDir[1] * 560
      if (rift) {
        T(rift).x = T(koi).x + G.lastDir[0] * 20; T(rift).y = T(koi).y + G.lastDir[1] * 20
        G.riftAge = 0; G.riftDir = Math.atan2(G.lastDir[1], G.lastDir[0])
      }
    }
    G.pSpace = sp

    // ── serpent brain ──
    const hx = T(head).x, hy = T(head).y
    const dxp = T(koi).x - hx, dyp = T(koi).y - hy
    const dp = Math.hypot(dxp, dyp) || 1
    let speed = 0, tx = T(koi).x, ty = T(koi).y
    const spd1 = 95 + lvl * 12, spdLunge = (phase === 3 ? 520 : 430) + lvl * 25
    B.t -= dt
    let mode = 0
    if (B.st === 'hunt') {
      speed = spd1
      B.volT -= dt
      if (B.volT <= 0) {
        for (let k = -1; k <= 1; k++) fireBolt(hx, hy, Math.atan2(dyp, dxp) + k * 0.22, 130 + lvl * 10, 0)
        B.st = 'vent'; B.t = 1.4; B.volT = 3.2 - lvl * 0.15
      }
      if (phase >= 2) { B.st = 'coil'; B.t = phase === 3 ? 2.2 : 3.2 }
    } else if (B.st === 'vent') {
      speed = 26; mode = 3
      if (B.t <= 0) B.st = phase >= 2 ? 'coil' : 'hunt'
    } else if (B.st === 'coil') {
      mode = 0
      B.ang += B.orb * (phase === 3 ? 1.5 : 1.1) * dt
      const R = 115
      tx = T(koi).x + Math.cos(B.ang) * R; ty = T(koi).y + Math.sin(B.ang) * R
      speed = 270 + lvl * 15
      B.spiT -= dt
      if (B.spiT <= 0) {
        const tang = B.ang + Math.PI / 2 * B.orb
        fireBolt(hx, hy, tang, 72 + lvl * 6, 1)
        B.spiT = phase === 3 ? 0.38 : 0.55
      }
      if (B.t <= 0) { B.st = 'telegraph'; B.t = phase === 3 ? 0.45 : 0.68; mode = 1 }
      if (phase === 1) { B.st = 'hunt' }
    } else if (B.st === 'telegraph') {
      speed = 0; mode = 1
      if (B.t <= 0) {
        const px = T(koi).x + T(koi).vx * 0.35, py = T(koi).y + T(koi).vy * 0.35
        const lm = Math.hypot(px - hx, py - hy) || 1
        B.lx = (px - hx) / lm; B.ly = (py - hy) / lm
        B.st = 'lunge'; B.t = 0.5
        if (phase === 3) for (let k = 0; k < 8; k++) fireBolt(hx, hy, k * Math.PI / 4, 95 + lvl * 8, 1)
      }
    } else if (B.st === 'lunge') {
      mode = 2; speed = spdLunge
      tx = hx + B.lx * 100; ty = hy + B.ly * 100
      if (B.t <= 0) { B.st = 'recover'; B.t = phase === 3 ? 0.95 : 1.35 }
    } else if (B.st === 'recover') {
      speed = 20; mode = 3
      if (B.t <= 0) { B.st = phase >= 2 ? 'coil' : 'hunt'; B.t = phase === 3 ? 2.2 : 3.2; B.orb = -B.orb }
    } else if (B.st === 'shatter') {
      speed = 0; mode = 5
      const dis = 1 - Math.max(0, B.t / 2.6)
      head.visualParams = [Math.atan2(B.sy, B.sx), 5, hp01, dis]
      segs.forEach((s, i) => { s.visualParams = [(i + 1) / (segs.length + 1), hp01, 5, dis] })
      if (B.t <= 0) {
        G.level = Math.min(6, G.level + 1); G.score += 25; G.hearts = 3
        B.max = 100 + (G.level - 1) * 15; B.hp = B.max; B.st = 'hunt'; B.volT = 3
        T(head).x = 80; T(head).y = 80
        segs.forEach((s, i) => { T(s).x = 80 - (i + 1) * 21; T(s).y = 80 })
      }
    }

    // rift sears: serpent slowed while head near an active rift
    if (rift && G.riftAge < 1) {
      const rd = Math.hypot(T(head).x - T(rift).x, T(head).y - T(rift).y)
      if (rd < 48) speed *= 0.5
    }

    // head kinematics (except shatter)
    if (B.st !== 'shatter') {
      const mx = tx - hx, my = ty - hy
      const md = Math.hypot(mx, my) || 1
      const wob = B.st === 'hunt' ? Math.sin((wd.__aurClock || 0) * 3.1) * 0.45 : 0
      const dirx = mx / md, diry = my / md
      const wx = dirx * Math.cos(wob) - diry * Math.sin(wob)
      const wy = dirx * Math.sin(wob) + diry * Math.cos(wob)
      T(head).x += wx * speed * dt; T(head).y += wy * speed * dt
      T(head).x = Math.max(20, Math.min(492, T(head).x))
      T(head).y = Math.max(20, Math.min(492, T(head).y))
      if (speed > 1) { B.sx = wx; B.sy = wy }
      T(head).vx = 0; T(head).vy = 0
      head.visualParams = [Math.atan2(B.sy, B.sx), mode, hp01, 0]
      // chain: each segment hangs 21px behind the previous
      let px2 = T(head).x, py2 = T(head).y
      segs.forEach((s, i) => {
        const sx2 = T(s).x - px2, sy2 = T(s).y - py2
        const sd2 = Math.hypot(sx2, sy2) || 1
        T(s).x = px2 + sx2 / sd2 * 21; T(s).y = py2 + sy2 / sd2 * 21
        T(s).vx = 0; T(s).vy = 0
        s.visualParams = [(i + 1) / (segs.length + 1), hp01, mode, 0]
        px2 = T(s).x; py2 = T(s).y
      })
    }
    wd.__aurClock = (wd.__aurClock || 0) + dt

    // ── bolts ──
    function fireBolt(x, y, ang, spd, kind) {
      const b = bolts.find(q => q.visualParams && q.visualParams[3] > 0.5)
      if (!b) return
      b.transform.x = x; b.transform.y = y
      b.transform.vx = Math.cos(ang) * spd; b.transform.vy = Math.sin(ang) * spd
      b.visualParams = [b.transform.vx, b.transform.vy, kind, 0]
      b.properties.set('ttl', kind === 1 ? 4.2 : 7)
    }
    for (const b of bolts) {
      if (!b.visualParams || b.visualParams[3] > 0.5) continue
      const ttl = (b.properties.get('ttl') || 0) - dt
      b.properties.set('ttl', ttl)
      if (ttl <= 0 || B.st === 'shatter') {
        b.visualParams = [0, 0, 0, 1]; T(b).x = 10; T(b).y = 10; T(b).vx = 0; T(b).vy = 0
        continue
      }
      // friction compensation: hold speed constant
      const bs = Math.hypot(T(b).vx, T(b).vy)
      const want = Math.hypot(b.visualParams[0], b.visualParams[1])
      if (bs > 1 && want > 1) { T(b).vx *= want / bs; T(b).vy *= want / bs }
      const ux = T(b).x - T(koi).x, uy = T(b).y - T(koi).y
      const ud = Math.hypot(ux, uy)
      if (ud < 14 && G.inv <= 0) { doHit(ux, uy, ud); b.visualParams = [0, 0, 0, 1]; T(b).x = 10; T(b).y = 10 }
    }

    // ── shards ──
    function dropShard(x, y) {
      const s = shards.find(q => q.visualParams && q.visualParams[3] > 0.5)
      if (!s) return
      T(s).x = x + (Math.random() - 0.5) * 30; T(s).y = y + (Math.random() - 0.5) * 30
      T(s).vx = (Math.random() - 0.5) * 40; T(s).vy = (Math.random() - 0.5) * 40
      s.visualParams = [Math.random(), 1, 0, 0]
      s.properties.set('ttl', 9)
    }
    for (const s of shards) {
      if (!s.visualParams || s.visualParams[3] > 0.5) continue
      const ttl = (s.properties.get('ttl') || 0) - dt
      s.properties.set('ttl', ttl)
      if (ttl <= 0) { s.visualParams = [0, 0, 0, 1]; T(s).x = 10; T(s).y = 22; continue }
      const ex = T(koi).x - T(s).x, ey = T(koi).y - T(s).y
      const ed = Math.hypot(ex, ey) || 1
      if (ed < 80) { T(s).vx += ex / ed * 120 * dt; T(s).vy += ey / ed * 120 * dt }
      if (ed < 20) {
        if (G.charges < 3) G.charges++
        else { G.score += 2; if (G.score > G.best) G.best = G.score }
        s.visualParams = [0, 0, 0, 1]; T(s).x = 10; T(s).y = 22
        continue
      }
      s.visualParams = [s.visualParams[0], Math.min(1, ttl / 2), 0, 0]
    }

    // ── contact: wound windows vs damage ──
    function doHit(nx, ny, nd) {
      G.hearts--; G.inv = 1.6; G.hurt = 0.55
      T(koi).vx += nx / nd * 260; T(koi).vy += ny / nd * 260
      if (G.hearts <= 0) {
        G.hearts = 3; G.score = Math.floor(G.score / 2)
        T(koi).x = 256; T(koi).y = 256; T(koi).vx = 0; T(koi).vy = 0
        T(head).x = 80; T(head).y = 80
        segs.forEach((s, i) => { T(s).x = 80 - (i + 1) * 21; T(s).y = 80 })
        B.st = 'hunt'; B.volT = 3.5; G.inv = 2.5
      }
    }
    if (B.st !== 'shatter') {
      const wound = (B.st === 'recover' || B.st === 'vent') && G.dashT > 0 && dp < 30
      if (wound) {
        B.hp -= 12
        G.score += 3; if (G.score > G.best) G.best = G.score
        dropShard(T(head).x, T(head).y); dropShard(T(head).x, T(head).y)
        T(head).x -= (dxp / dp) * 16; T(head).y -= (dyp / dp) * 16
        B.st = phase >= 2 ? 'coil' : 'hunt'; B.t = 2.8; G.dashT = 0
        if (B.hp <= 0) { B.st = 'shatter'; B.t = 2.6 }
      } else if (dp < 22 && G.inv <= 0 && B.st !== 'recover' && B.st !== 'vent') {
        doHit(dxp, dyp, dp)
      }
      for (const s of segs) {
        const sx3 = T(koi).x - T(s).x, sy3 = T(koi).y - T(s).y
        const sd3 = Math.hypot(sx3, sy3)
        if (sd3 < 19 && G.inv <= 0) { doHit(sx3, sy3, sd3); break }
      }
    }

    // ── graze: skim danger to charge the dash ──
    let nearest = dp
    for (const s of segs) nearest = Math.min(nearest, Math.hypot(T(koi).x - T(s).x, T(koi).y - T(s).y))
    for (const b of bolts) {
      if (!b.visualParams || b.visualParams[3] > 0.5) continue
      nearest = Math.min(nearest, Math.hypot(T(koi).x - T(b).x, T(koi).y - T(b).y))
    }
    if (nearest > 23 && nearest < 48 && G.inv <= 0 && B.st !== 'shatter') {
      G.graze = 1
      G.meter += dt * (phase === 3 ? 0.85 : 0.45)
      if (G.meter >= 1) {
        G.meter = 0
        if (G.charges < 3) G.charges++
        G.score++; if (G.score > G.best) G.best = G.score
      }
    }

    // ── feed the visuals ──
    koi.visualParams = [T(koi).vx, T(koi).vy, G.graze, G.hurt > 0 ? 2 : (G.inv > 0 ? 1 : 0)]
    if (rift) rift.visualParams = [Math.min(1, G.riftAge), G.riftDir, 0, 0]
    if (hud) {
      hud.visualParams = [G.hearts, G.charges + G.meter, hp01, G.level]
      hud.name = 'AURELION \\u00b7 ' + G.score + ' \\u00b7 best ' + G.best + ' \\u00b7 lv ' + G.level
    }
  }
} catch (e) { /* keep the sim alive */ }
`

// ─────────────────────────────────────────────────────────────────────────────
const field = (id, name, color, x, y, shape, visualTypeName, vp) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
  ...(vp ? { visualParams: vp } : {}),
})

const HIDDEN = [0, 0, 0, 1]
const fields = [
  field('aur_arena_f', 'Abyss', [0.02, 0.03, 0.08, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'aur_arena'),
  field('aur_rift_f', 'Rift', [1, 0.9, 0.5, 1], 10, 40, { shapeType: 'circle', radius: 30 }, 'aur_rift', [9, 0, 0, 0]),
]
for (let i = 10; i >= 1; i--) {
  fields.push(field(`aur_seg_${String(i).padStart(2, '0')}`, `Serpent ${String(i).padStart(2, '0')}`,
    [1, 0.55, 0.12, 1], 80 - i * 21, 80, { shapeType: 'circle', radius: 14 }, 'aur_seg', [i / 11, 1, 0, 0]))
}
fields.push(field('aur_head_f', 'Serpent Head', [1, 0.7, 0.2, 1], 80, 80, { shapeType: 'circle', radius: 17 }, 'aur_head', [0, 0, 1, 0]))
for (let i = 1; i <= 10; i++) {
  fields.push(field(`aur_bolt_${i}`, `Bolt ${i}`, [1, 0.5, 0.1, 1], 10, 10, { shapeType: 'circle', radius: 7 }, 'aur_bolt', HIDDEN))
}
for (let i = 1; i <= 6; i++) {
  fields.push(field(`aur_shard_${i}`, `Shard ${i}`, [0.6, 0.9, 1, 1], 10, 22, { shapeType: 'circle', radius: 9 }, 'aur_shard', HIDDEN))
}
fields.push(field('aur_koi_f', 'Koi', [0.7, 0.95, 1, 1], 256, 256, { shapeType: 'circle', radius: 12 }, 'aur_koi'))
fields.push(field('aur_hud_f', 'AURELION · WASD swim · SPACE dash', [1, 0.9, 0.5, 1], 256, 26, { shapeType: 'rect', w: 320, h: 36 }, 'aur_hud', [3, 3, 1, 1]))

const scene = {
  name: 'AURELION',
  fields,
  worldParams: { gravity: 0, friction: 0.985, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.55, gravitationalConstant: 0 },
  worldData: {},
  stepHooks: [{ id: 'aurelion_core', author: 'fable', description: 'AURELION: serpent boss AI, dash/graze/wound loop, phases, NG+', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'aur_arena', wgsl: ARENA },
    { name: 'aur_rift', wgsl: RIFT },
    { name: 'aur_seg', wgsl: SEG },
    { name: 'aur_head', wgsl: HEAD },
    { name: 'aur_bolt', wgsl: BOLT },
    { name: 'aur_shard', wgsl: SHARD },
    { name: 'aur_koi', wgsl: KOI },
    { name: 'aur_hud', wgsl: HUD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'AURELION', scene }),
})
console.log('AURELION saved:', res.status, await res.text())
