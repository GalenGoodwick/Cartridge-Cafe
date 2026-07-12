// CHORUS — gather sparks, raise the star. Unity Chant as an arcade loop.
// WASD = fly. Space = chime pulse (repels doubts, costs the full bar).
// Carry up to 5 sparks to the star; 5 sparks = a tier; 5 tiers = a champion bloom.
// Doubts steal what you carry — they never kill, they only scatter.

const ARENA = /* wgsl */`
fn visual_chorus_arena(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  var c = vec3f(0.010, 0.012, 0.028);
  for (var i = 0; i < 2; i++) {
    let fi = f32(i);
    let sc = 16.0 + fi * 28.0;
    let sp = uv * sc + vec2f(time * (0.008 + fi * 0.01), fi * 7.3);
    let cell = floor(sp);
    let h = hash21(cell + fi * 13.0);
    let fp = fract(sp) - 0.5;
    let star = step(0.986, h) * smoothstep(0.22, 0.02, length(fp));
    c += vec3f(0.55, 0.65, 0.85) * star * (0.3 + 0.4 * sin(time * (0.8 + h * 2.0) + h * 40.0));
  }
  let q = uv * vec2f(1.6, 3.2);
  let band1 = fbm(q + vec2f(time * 0.015, uv.x * 0.6), 3);
  let ribbon1 = exp(-pow((uv.y + 0.35 - band1 * 0.35) * 3.2, 2.0));
  c += vec3f(0.05, 0.22, 0.16) * ribbon1 * (0.55 + 0.45 * sin(time * 0.11));
  let band2 = fbm(q * 1.7 - vec2f(time * 0.01, 0.0), 3);
  let ribbon2 = exp(-pow((uv.y - 0.45 - band2 * 0.28) * 3.6, 2.0));
  c += vec3f(0.10, 0.06, 0.22) * ribbon2;
  c += vec3f(0.045, 0.02, 0.09) * fbm(uv * 2.2 + vec2f(0.0, time * 0.006), 3);
  c *= 1.0 - 0.45 * dot(uv * 0.85, uv * 0.85);
  return vec4f(c, 1.0);
}`

const STAR = /* wgsl */`
fn visual_chorus_star(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let tier = p.x;
  let prog = p.y;
  let flash = clamp(p.z, 0.0, 1.0);
  let bloom = clamp(p.w, 0.0, 1.0);
  let d = length(uv);
  let ang = atan2(uv.y, uv.x);
  var c = vec3f(0.0);
  let tt = clamp((tier - 1.0) / 4.0, 0.0, 1.0);
  let core = mix(vec3f(1.4, 0.95, 0.45), vec3f(0.8, 1.1, 1.5), tt);
  let r = 0.13 + tier * 0.032;
  c += core * exp(-d * d / (r * r) * 2.2) * (2.2 + flash * 3.5);
  c += core * 0.35 * exp(-d * 3.2);
  let ray = pow(0.5 + 0.5 * sin(ang * 6.0 + time * 0.3), 6.0);
  c += core * ray * exp(-d * 3.5) * 0.5;
  // progress arc — fills clockwise from the top
  var a2 = atan2(uv.x, -uv.y);
  if (a2 < 0.0) { a2 += 6.28318; }
  let arcOn = step(a2, prog * 6.28318);
  let arc = exp(-pow((d - 0.62) * 26.0, 2.0));
  c += mix(vec3f(0.12, 0.16, 0.24), vec3f(1.2, 0.9, 0.3) * 2.0, arcOn) * arc;
  // one dashed ring per tier climbed
  for (var i = 0; i < 5; i++) {
    let fi = f32(i);
    if (fi < tier - 0.5) {
      let rr = 0.28 + fi * 0.075;
      let dash = 0.6 + 0.4 * sin(ang * 10.0 - time * (0.4 + fi * 0.15));
      c += core * exp(-pow((d - rr) * 40.0, 2.0)) * 0.35 * dash;
    }
  }
  if (bloom > 0.001) {
    let br = (1.0 - bloom) * 1.05;
    c += vec3f(2.5, 2.2, 1.6) * exp(-pow((d - br) * 9.0, 2.0)) * bloom * 2.0;
    c += vec3f(3.0) * exp(-d * d * 3.0) * bloom;
  }
  let a = clamp(exp(-d * d * 1.8) * 1.3 + arc * 0.8 + bloom * 0.5, 0.0, 1.0) * smoothstep(1.05, 0.9, d);
  return vec4f(c, a);
}`

const VOICE = /* wgsl */`
fn visual_chorus_voice(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let vel = vec2f(p.x, p.y);
  let sp = length(vel);
  var dir = vec2f(0.0);
  if (sp > 1.0) { dir = vel / sp; }
  let d = length(uv);
  var c = vec3f(0.0);
  c += vec3f(1.1, 1.0, 0.75) * exp(-d * d * 20.0) * 2.8;
  c += vec3f(0.35, 0.8, 1.0) * exp(-d * d * 5.0) * 0.9;
  let tl = clamp(sp / 120.0, 0.0, 1.0);
  for (var i = 1; i <= 4; i++) {
    let fi = f32(i);
    let q = uv + dir * fi * 0.26 * tl;
    c += vec3f(0.5, 0.8, 1.0) * exp(-dot(q, q) * (18.0 + fi * 10.0)) * tl * (1.0 - fi * 0.2);
  }
  c = mix(c, vec3f(1.8, 0.3, 0.25), clamp(p.z * 1.5, 0.0, 0.8));
  if (p.w > 0.5) { c *= 0.65 + 0.35 * sin(time * 18.0); }
  let a = clamp(exp(-d * d * 3.5) * 1.5, 0.0, 1.0) * smoothstep(1.05, 0.8, d);
  return vec4f(c, a);
}`

const MOTE = /* wgsl */`
fn visual_chorus_mote(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let carried = clamp(p.x, 0.0, 1.0);
  let d = length(uv);
  let tw = 0.7 + 0.3 * sin(time * (2.5 + p.y * 3.0) + p.y * 40.0);
  var c = vec3f(1.3, 0.85, 0.3) * exp(-d * d * 11.0) * 2.0 * tw;
  c += vec3f(1.2, 0.6, 0.15) * exp(-d * d * 3.5) * 0.55;
  c = mix(c, c * vec3f(0.8, 1.05, 1.3), carried * 0.5);
  let a = clamp(exp(-d * d * 4.5) * 1.4, 0.0, 1.0) * smoothstep(1.05, 0.75, d);
  return vec4f(c, a);
}`

const DOUBT = /* wgsl */`
fn visual_chorus_doubt(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  if (p.w > 0.5) { return vec4f(0.0); }
  let d = length(uv);
  let ang = atan2(uv.y, uv.x);
  let wob = 0.75 + 0.4 * vnoise(vec2f(ang * 2.0 + p.z * 12.0, time * 2.6));
  var c = vec3f(0.28, 0.05, 0.4) * exp(-d * d * 5.0) * wob * 1.6;
  c += vec3f(0.7, 0.1, 0.35) * exp(-pow((d - 0.55 * wob) * 5.0, 2.0)) * 0.8;
  c = max(c - vec3f(0.3) * exp(-d * d * 26.0), vec3f(0.0));
  if (p.x > 0.5) { c = mix(c, vec3f(0.25, 0.75, 0.95), 0.4 + 0.3 * sin(time * 15.0)); }
  let a = clamp(exp(-d * d * 4.5) * 1.4, 0.0, 1.0) * smoothstep(1.05, 0.8, d);
  return vec4f(c, a);
}`

const PULSE = /* wgsl */`
fn visual_chorus_pulse(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  if (p.y < 0.5) { return vec4f(0.0); }
  let t = clamp(p.x, 0.0, 1.0);
  let d = length(uv);
  let rr = t * 0.92;
  let fade = 1.0 - t;
  var c = vec3f(0.5, 1.0, 1.2) * exp(-pow((d - rr) * (26.0 - t * 14.0), 2.0)) * 3.0 * fade;
  c += vec3f(0.3, 0.7, 1.0) * exp(-pow((d - rr * 0.8) * 30.0, 2.0)) * fade * 0.8;
  let a = clamp(exp(-pow((d - rr) * 14.0, 2.0)) * 1.5 * fade, 0.0, 1.0);
  return vec4f(c, a);
}`

const HUD = /* wgsl */`
fn visual_chorus_hud(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  var c = vec3f(0.0);
  var a = 0.0;
  let prog = p.x;
  let carried = p.y;
  let champs = p.z;
  let energy = clamp(p.w, 0.0, 1.0);
  for (var i = 0; i < 5; i++) {
    let q = (uv - vec2f(-0.28 + f32(i) * 0.14, -0.25)) * vec2f(8.0, 3.2);
    let on = select(0.10, 1.0, f32(i) < prog);
    let g = exp(-dot(q, q) * 1.3);
    c += vec3f(1.2, 0.9, 0.35) * g * on;
    a = max(a, g * 0.85);
  }
  for (var i = 0; i < 5; i++) {
    let q = (uv - vec2f(-0.28 + f32(i) * 0.14, 0.45)) * vec2f(10.0, 4.5);
    let on = select(0.08, 1.0, f32(i) < carried);
    let g = exp(-dot(q, q) * 1.5);
    c += vec3f(0.4, 0.9, 1.1) * g * on;
    a = max(a, g * 0.8 * on);
  }
  for (var i = 0; i < 6; i++) {
    let q = (uv - vec2f(-0.86 + f32(i) * 0.09, 0.0)) * vec2f(12.0, 5.0);
    let on = select(0.0, 1.0, f32(i) < champs);
    let g = exp(-dot(q, q) * 1.6);
    c += vec3f(1.4, 1.1, 0.5) * g * on;
    a = max(a, g * 0.9 * on);
  }
  let qb = uv - vec2f(0.62, 0.0);
  let inBar = step(abs(qb.y), 0.16) * step(0.0, qb.x) * step(qb.x, 0.28);
  let fill = step(qb.x, 0.28 * energy);
  c += mix(vec3f(0.08, 0.12, 0.18), vec3f(0.45, 1.0, 1.2), fill) * inBar;
  a = max(a, inBar * 0.75);
  return vec4f(c * 1.3, clamp(a, 0.0, 1.0));
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__ch) wd.__ch = { t: 0, tier: 1, prog: 0, champs: 0, score: 0, best: 0, inv: 2, hurt: 0, flash: 0, bloom: 0, pulseE: 1, pulseT: 0, px: 0, py: 0, doubtT: 6, spaceHeld: false }
  const G = wd.__ch
  G.t += dt
  let voice = null, star = null, ring = null, hud = null
  const motes = [], doubts = []
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Voice')) voice = f
    else if (n.startsWith('Star')) star = f
    else if (n.startsWith('Mote')) motes.push(f)
    else if (n.startsWith('Doubt')) doubts.push(f)
    else if (n.startsWith('Ring')) ring = f
    else if (n.startsWith('CHORUS')) hud = f
  }
  if (voice && star) {
    const T = f => f.transform
    const dist = (a, b) => Math.hypot(T(a).x - T(b).x, T(a).y - T(b).y)
    G.inv = Math.max(0, G.inv - dt)
    G.hurt = Math.max(0, G.hurt - dt)
    G.flash = Math.max(0, G.flash - dt * 1.6)
    G.bloom = Math.max(0, G.bloom - dt * 0.5)
    G.pulseE = Math.min(1, G.pulseE + dt / 6)
    // ── WASD flight ──
    const ACC = 360 * dt
    if (wd.key_a) T(voice).vx -= ACC
    if (wd.key_d) T(voice).vx += ACC
    if (wd.key_w) T(voice).vy -= ACC
    if (wd.key_s) T(voice).vy += ACC
    const vv = Math.hypot(T(voice).vx, T(voice).vy)
    if (vv > 165) { T(voice).vx *= 165 / vv; T(voice).vy *= 165 / vv }
    // ── Chime pulse (space) ──
    if (wd.key_space && !G.spaceHeld && G.pulseE >= 1) {
      G.pulseT = 0.55; G.pulseE = 0
      G.px = T(voice).x; G.py = T(voice).y
      for (const d of doubts) {
        if (d.visualParams && d.visualParams[3] > 0.5) continue
        const dx = T(d).x - G.px, dy = T(d).y - G.py
        const dd = Math.hypot(dx, dy) || 1
        if (dd < 130) {
          T(d).vx += dx / dd * 320; T(d).vy += dy / dd * 320
          d.properties.set('stun', 1.4)
        }
      }
    }
    G.spaceHeld = !!wd.key_space
    if (ring) {
      if (G.pulseT > 0) {
        G.pulseT = Math.max(0, G.pulseT - dt)
        T(ring).x = G.px; T(ring).y = G.py
        ring.visualParams = [1 - G.pulseT / 0.55, 1, 0, 0]
      } else {
        ring.visualParams = [0, 0, 0, 0]
      }
    }
    // ── Motes: wander free, orbit when carried ──
    let carriedCount = 0
    for (const m of motes) { if ((m.properties.get('carried') || 0) > 0) carriedCount++ }
    for (let mi = 0; mi < motes.length; mi++) {
      const m = motes[mi]
      if (m.properties.get('seed') === undefined) m.properties.set('seed', mi + 1)
      const seed = m.properties.get('seed')
      const carried = m.properties.get('carried') || 0
      if (!carried) {
        T(m).vx += Math.sin(G.t * 0.7 + seed * 2.1) * 16 * dt
        T(m).vy += Math.cos(G.t * 0.6 + seed * 3.7) * 16 * dt
        const mv = Math.hypot(T(m).vx, T(m).vy)
        if (mv > 24) { T(m).vx *= 24 / mv; T(m).vy *= 24 / mv }
        if (carriedCount < 5 && dist(m, voice) < 20) {
          m.properties.set('carried', 1)
          m.properties.set('slot', carriedCount)
          carriedCount++
        }
      } else {
        const slot = m.properties.get('slot') || 0
        const ang = G.t * 2.2 + slot * 1.2566
        const tx = T(voice).x + Math.cos(ang) * 26
        const ty = T(voice).y + Math.sin(ang) * 26
        const k = Math.min(1, dt * 10)
        T(m).x += (tx - T(m).x) * k
        T(m).y += (ty - T(m).y) * k
        T(m).vx = T(voice).vx; T(m).vy = T(voice).vy
      }
      m.visualParams = [carried, seed * 0.13, 0, 0]
    }
    // ── Deposit at the star ──
    if (dist(voice, star) < 52 && carriedCount > 0) {
      for (const m of motes) {
        if ((m.properties.get('carried') || 0) > 0) {
          m.properties.set('carried', 0)
          T(m).x = 40 + Math.random() * 432
          T(m).y = 40 + Math.random() * 432
          T(m).vx = (Math.random() - 0.5) * 20
          T(m).vy = (Math.random() - 0.5) * 20
        }
      }
      G.prog += carriedCount; G.score += carriedCount
      G.flash = 1
      carriedCount = 0
      while (G.prog >= 5) {
        G.prog -= 5; G.tier++; G.flash = 1
        for (const d of doubts) {
          const dx = T(d).x - T(star).x, dy = T(d).y - T(star).y
          const dd = Math.hypot(dx, dy) || 1
          T(d).vx += dx / dd * 260; T(d).vy += dy / dd * 260
          d.properties.set('stun', 1.0)
        }
        if (G.tier > 5) { G.champs++; G.score += 25; G.bloom = 1; G.tier = 1 }
      }
      if (G.score > G.best) G.best = G.score
    }
    // ── Doubts: spawn at edges, hunt, steal — never kill ──
    G.doubtT -= dt
    if (G.doubtT <= 0) {
      const d = doubts.find(x => x.visualParams && x.visualParams[3] > 0.5)
      if (d) {
        const side = Math.floor(Math.random() * 4)
        T(d).x = side === 0 ? 15 : side === 1 ? 497 : 50 + Math.random() * 412
        T(d).y = side === 2 ? 15 : side === 3 ? 497 : 50 + Math.random() * 412
        T(d).vx = 0; T(d).vy = 0
        d.visualParams = [0, 0, Math.random(), 0]
        d.properties.set('stun', 0)
      }
      G.doubtT = Math.max(3.0, 7.5 - G.tier * 0.7 - G.champs * 0.8)
    }
    for (const d of doubts) {
      if (!d.visualParams || d.visualParams[3] > 0.5) continue
      const stun = Math.max(0, (d.properties.get('stun') || 0) - dt)
      d.properties.set('stun', stun)
      if (stun <= 0) {
        const dx = T(voice).x - T(d).x, dy = T(voice).y - T(d).y
        const dd = Math.hypot(dx, dy) || 1
        const chase = (42 + G.tier * 6 + G.champs * 8) * dt
        T(d).vx += dx / dd * chase; T(d).vy += dy / dd * chase
        const dv = Math.hypot(T(d).vx, T(d).vy)
        const cap = 46 + G.tier * 5 + G.champs * 6
        if (dv > cap) { T(d).vx *= cap / dv; T(d).vy *= cap / dv }
      }
      // the star's aura holds doubts off
      const sx = T(d).x - T(star).x, sy = T(d).y - T(star).y
      const sd = Math.hypot(sx, sy) || 1
      if (sd < 80) { T(d).vx += sx / sd * 130 * dt; T(d).vy += sy / sd * 130 * dt }
      // contact: scatter the carried sparks
      if (dist(d, voice) < 17 && G.inv <= 0) {
        G.inv = 1.6; G.hurt = 0.6
        const kx = T(voice).x - T(d).x, ky = T(voice).y - T(d).y
        const kd = Math.hypot(kx, ky) || 1
        T(voice).vx += kx / kd * 200; T(voice).vy += ky / kd * 200
        for (const m of motes) {
          if ((m.properties.get('carried') || 0) > 0) {
            m.properties.set('carried', 0)
            const a = Math.random() * 6.283
            T(m).vx = Math.cos(a) * 60; T(m).vy = Math.sin(a) * 60
          }
        }
        carriedCount = 0
        G.score = Math.max(0, G.score - 2)
      }
      d.visualParams = [stun > 0 ? 1 : 0, 0, d.visualParams[2], 0]
    }
    // ── Feed the visuals ──
    voice.visualParams = [T(voice).vx, T(voice).vy, G.hurt, G.inv > 0 ? 1 : 0]
    star.visualParams = [G.tier, G.prog / 5, G.flash, G.bloom]
    if (hud) {
      hud.visualParams = [G.prog, carriedCount, Math.min(6, G.champs), G.pulseE]
      hud.name = 'CHORUS \\u00b7 tier ' + G.tier + ' \\u00b7 score ' + G.score + ' \\u00b7 best ' + G.best
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

const HIDDEN = [0, 0, 0, 1]
const scene = {
  name: 'CHORUS',
  fields: [
    field('chorus_arena_f', 'Arena', [0.04, 0.05, 0.11, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'chorus_arena'),
    field('chorus_star_f', 'Star', [1, 0.85, 0.4, 1], 256, 256, { shapeType: 'circle', radius: 100 }, 'chorus_star', [1, 0, 0, 0]),
    field('chorus_mote_1', 'Mote 1', [1, 0.75, 0.25, 1], 90, 120, { shapeType: 'circle', radius: 8 }, 'chorus_mote', [0, 0.13, 0, 0]),
    field('chorus_mote_2', 'Mote 2', [1, 0.75, 0.25, 1], 420, 90, { shapeType: 'circle', radius: 8 }, 'chorus_mote', [0, 0.26, 0, 0]),
    field('chorus_mote_3', 'Mote 3', [1, 0.75, 0.25, 1], 440, 380, { shapeType: 'circle', radius: 8 }, 'chorus_mote', [0, 0.39, 0, 0]),
    field('chorus_mote_4', 'Mote 4', [1, 0.75, 0.25, 1], 110, 420, { shapeType: 'circle', radius: 8 }, 'chorus_mote', [0, 0.52, 0, 0]),
    field('chorus_mote_5', 'Mote 5', [1, 0.75, 0.25, 1], 250, 70, { shapeType: 'circle', radius: 8 }, 'chorus_mote', [0, 0.65, 0, 0]),
    field('chorus_mote_6', 'Mote 6', [1, 0.75, 0.25, 1], 70, 260, { shapeType: 'circle', radius: 8 }, 'chorus_mote', [0, 0.78, 0, 0]),
    field('chorus_mote_7', 'Mote 7', [1, 0.75, 0.25, 1], 250, 450, { shapeType: 'circle', radius: 8 }, 'chorus_mote', [0, 0.91, 0, 0]),
    field('chorus_mote_8', 'Mote 8', [1, 0.75, 0.25, 1], 445, 250, { shapeType: 'circle', radius: 8 }, 'chorus_mote', [0, 1.04, 0, 0]),
    field('chorus_doubt_1', 'Doubt 1', [0.4, 0.08, 0.5, 1], 12, 12, { shapeType: 'circle', radius: 11 }, 'chorus_doubt', HIDDEN),
    field('chorus_doubt_2', 'Doubt 2', [0.4, 0.08, 0.5, 1], 12, 12, { shapeType: 'circle', radius: 11 }, 'chorus_doubt', HIDDEN),
    field('chorus_doubt_3', 'Doubt 3', [0.4, 0.08, 0.5, 1], 12, 12, { shapeType: 'circle', radius: 11 }, 'chorus_doubt', HIDDEN),
    field('chorus_doubt_4', 'Doubt 4', [0.4, 0.08, 0.5, 1], 12, 12, { shapeType: 'circle', radius: 11 }, 'chorus_doubt', HIDDEN),
    field('chorus_ring_f', 'Ring', [0.5, 1, 1.2, 1], 12, 40, { shapeType: 'circle', radius: 120 }, 'chorus_pulse', [0, 0, 0, 0]),
    field('chorus_voice_f', 'Voice', [1, 0.95, 0.7, 1], 256, 360, { shapeType: 'circle', radius: 13 }, 'chorus_voice'),
    field('chorus_hud_f', 'CHORUS · WASD fly · space chime', [1, 0.9, 0.5, 1], 256, 24, { shapeType: 'rect', w: 300, h: 34 }, 'chorus_hud', [0, 0, 0, 1]),
  ],
  worldParams: { gravity: 0, friction: 0.985, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.7, gravitationalConstant: 0 },
  worldData: {
    postProcess: { bloomIntensity: 0.5, bloomThreshold: 0.45, exposure: 1.05, vignetteStrength: 0.35, vignetteRadius: 0.75 },
  },
  stepHooks: [{ id: 'chorus_core', author: 'fable', description: 'CHORUS: gather sparks, raise the star through 5 tiers; doubts scatter, the chime repels', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'chorus_arena', wgsl: ARENA },
    { name: 'chorus_star', wgsl: STAR },
    { name: 'chorus_mote', wgsl: MOTE },
    { name: 'chorus_doubt', wgsl: DOUBT },
    { name: 'chorus_pulse', wgsl: PULSE },
    { name: 'chorus_voice', wgsl: VOICE },
    { name: 'chorus_hud', wgsl: HUD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'CHORUS', scene }),
})
console.log('CHORUS saved:', res.status, await res.text())
