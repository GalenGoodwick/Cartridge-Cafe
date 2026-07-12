// LUMEN v2 — wisp + light-blade space shooter, shipped as a scene cartridge.
// WASD = fly. Arrow left/right = sweep the blade around you.
// Blade kills shades, parries bolts back at the maw, and repels the maw itself.

const ARENA = /* wgsl */`
fn visual_lumen_arena(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  var c = vec3f(0.012, 0.014, 0.030);
  for (var i = 0; i < 2; i++) {
    let fi = f32(i);
    let sc = 18.0 + fi * 26.0;
    let sp = uv * sc + vec2f(time * (0.01 + fi * 0.012), 0.0);
    let cell = floor(sp);
    let h = hash21(cell + fi * 17.0);
    let fp = fract(sp) - 0.5;
    let star = step(0.985, h) * smoothstep(0.25, 0.03, length(fp));
    c += vec3f(0.5, 0.6, 0.8) * star * (0.35 + 0.4 * sin(time * (1.0 + h * 2.0) + h * 50.0));
  }
  c += vec3f(0.05, 0.02, 0.10) * fbm(uv * 2.0 + vec2f(time * 0.008, 0.0), 3);
  c *= 1.0 - 0.5 * dot(uv * 0.8, uv * 0.8);
  return vec4f(c, 1.0);
}`

const WISP = /* wgsl */`
fn visual_lumen_wisp(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let vel = vec2f(p.x, p.y);
  let sp = length(vel);
  var dir = vec2f(0.0);
  if (sp > 1.0) { dir = vel / sp; }
  var c = vec3f(0.0);
  let d = length(uv);
  c += vec3f(0.65, 0.9, 1.0) * exp(-d * d * 18.0) * 2.6;
  c += vec3f(0.2, 0.5, 1.0) * exp(-d * d * 4.0) * 0.9;
  let tl = clamp(sp / 110.0, 0.0, 1.0);
  for (var i = 1; i <= 4; i++) {
    let fi = f32(i);
    let q = uv + dir * fi * 0.28 * tl;
    c += vec3f(0.3, 0.7, 1.0) * exp(-dot(q, q) * (20.0 + fi * 10.0)) * tl * (1.0 - fi * 0.2);
  }
  c = mix(c, vec3f(1.6, 0.25, 0.2), clamp(p.z * 1.6, 0.0, 0.8));
  if (p.w > 0.5) { c *= 0.6 + 0.4 * sin(time * 20.0); }
  let a = clamp(exp(-d * d * 3.0) * 1.5, 0.0, 1.0) * smoothstep(1.05, 0.8, d);
  return vec4f(c, a);
}`

const BLADE = /* wgsl */`
fn visual_lumen_blade(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // Blade lies along local +y (hilt at center, tip outward). p.x = swinging.
  let d = sdSegment(uv, vec2f(0.0, 0.02), vec2f(0.0, 0.94));
  let swing = clamp(p.x, 0.0, 1.0);
  var c = vec3f(0.85, 0.97, 1.0) * exp(-d * d * 260.0) * 2.6;
  c += vec3f(0.4, 0.75, 1.0) * exp(-d * d * 38.0) * (0.65 + swing * 0.9);
  let tip = uv - vec2f(0.0, 0.94);
  c += vec3f(1.0) * exp(-dot(tip, tip) * 60.0) * 1.3;
  let a = clamp(exp(-d * d * 28.0) * 1.7, 0.0, 1.0);
  return vec4f(c, a);
}`

const EMBER = /* wgsl */`
fn visual_lumen_ember(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let d = length(uv);
  let pulse = 0.75 + 0.25 * sin(time * 3.0 + p.w * 20.0);
  var c = vec3f(1.2, 0.75, 0.25) * exp(-d * d * 10.0) * 2.2 * pulse;
  c += vec3f(1.3, 0.5, 0.1) * exp(-d * d * 3.0) * 0.6;
  let ang = atan2(uv.y, uv.x);
  c *= 0.85 + 0.3 * vnoise(vec2f(ang * 2.0 + p.w * 9.0, time * 2.5));
  let a = clamp(exp(-d * d * 4.0) * 1.5, 0.0, 1.0) * smoothstep(1.05, 0.75, d);
  return vec4f(c, a);
}`

const MAW = /* wgsl */`
fn visual_lumen_maw(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let d = length(uv);
  let ang = atan2(uv.y, uv.x);
  let spin = ang + time * 1.4 - d * 5.0;
  let arms = 0.5 + 0.5 * sin(spin * 3.0);
  var c = vec3f(0.16, 0.03, 0.24) * arms * smoothstep(1.0, 0.25, d);
  c *= smoothstep(0.16, 0.4, d);
  let prox = clamp(p.x, 0.0, 1.5);
  c += vec3f(0.9, 0.08, 0.12) * exp(-pow((d - 0.72) * 6.0, 2.0)) * (0.25 + prox);
  c += vec3f(0.35, 0.1, 0.5) * exp(-pow((d - 0.95) * 10.0, 2.0)) * (0.4 + 0.3 * sin(time * 3.0));
  // Stunned: flicker cyan
  if (p.y > 0.5) { c = mix(c, vec3f(0.2, 0.7, 0.9), 0.35 + 0.3 * sin(time * 16.0)); }
  let a = smoothstep(1.05, 0.85, d);
  return vec4f(c * 1.5, a);
}`

const SHADE = /* wgsl */`
fn visual_lumen_shade(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  if (p.w > 0.5) { return vec4f(0.0); }
  let d = length(uv);
  let ang = atan2(uv.y, uv.x);
  let wob = 0.8 + 0.35 * vnoise(vec2f(ang * 2.0 + p.z * 10.0, time * 3.0));
  var c = vec3f(0.55, 0.06, 0.16) * exp(-d * d * 6.0) * wob * 1.7;
  c += vec3f(0.95, 0.15, 0.3) * exp(-pow((d - 0.55 * wob) * 5.0, 2.0)) * 0.9;
  c = max(c - vec3f(0.35) * exp(-d * d * 30.0), vec3f(0.0));
  let a = clamp(exp(-d * d * 5.0) * 1.4, 0.0, 1.0) * smoothstep(1.05, 0.8, d);
  return vec4f(c, a);
}`

const BOLT = /* wgsl */`
fn visual_lumen_bolt(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  if (p.w > 0.5) { return vec4f(0.0); }
  let vel = vec2f(p.x, p.y);
  let sp = length(vel);
  var dir = vec2f(0.0);
  if (sp > 1.0) { dir = vel / sp; }
  let d = length(uv);
  // Hostile = ember-red. Parried = your blue.
  var hot = vec3f(1.3, 0.45, 0.12);
  if (p.z > 0.5) { hot = vec3f(0.3, 0.9, 1.25); }
  var c = hot * exp(-d * d * 16.0) * 2.5;
  for (var i = 1; i <= 3; i++) {
    let q = uv + dir * f32(i) * 0.3;
    c += hot * exp(-dot(q, q) * 24.0) * (1.0 - f32(i) * 0.25) * 0.8;
  }
  let a = clamp(exp(-d * d * 6.0) * 1.5, 0.0, 1.0);
  return vec4f(c, a);
}`

const HUD = /* wgsl */`
fn visual_lumen_hud(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  var c = vec3f(0.0);
  var a = 0.0;
  let score = p.x;
  let hp = p.y;
  for (var i = 0; i < 3; i++) {
    let q = (uv - vec2f(-0.8 + f32(i) * 0.15, 0.0)) * vec2f(6.0, 2.8);
    let on = select(0.12, 1.0, f32(i) < hp);
    let g = exp(-dot(q, q) * 1.2);
    c += vec3f(1.1, 0.2, 0.3) * g * on;
    a = max(a, g * 0.9);
  }
  for (var i = 0; i < 20; i++) {
    let row = f32(i / 10);
    let colm = f32(i % 10);
    let q = (uv - vec2f(-0.2 + colm * 0.11, (row - 0.5) * 0.5)) * vec2f(9.0, 4.0);
    let on = select(0.08, 1.0, f32(i) < score);
    let g = exp(-dot(q, q) * 1.4);
    c += vec3f(1.1, 0.8, 0.3) * g * on;
    a = max(a, g * 0.8 * on);
  }
  return vec4f(c * 1.4, clamp(a, 0.0, 1.0));
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__lm2) wd.__lm2 = { score: 0, best: 0, hp: 3, inv: 2.0, hurt: 0, ang: -1.5708, shadeT: 4, boltT: 5, stun: 0 }
  const G = wd.__lm2
  let wisp = null, maw = null, blade = null, hud = null
  const embers = [], shades = [], bolts = []
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Wisp')) wisp = f
    else if (n.startsWith('Maw')) maw = f
    else if (n.startsWith('Blade')) blade = f
    else if (n.startsWith('Ember')) embers.push(f)
    else if (n.startsWith('Shade')) shades.push(f)
    else if (n.startsWith('Bolt')) bolts.push(f)
    else if (n.startsWith('LUMEN')) hud = f
  }
  if (wisp && maw && blade) {
    const T = f => f.transform
    const park = (f, px, py) => { f.visualParams = [0, 0, 0, 1]; T(f).x = px; T(f).y = py; T(f).vx = 0; T(f).vy = 0 }
    G.inv = Math.max(0, G.inv - dt)
    G.hurt = Math.max(0, G.hurt - dt)
    G.stun = Math.max(0, G.stun - dt)
    const doHit = (nx, ny, nd) => {
      G.hp--; G.inv = 1.6; G.hurt = 0.6
      T(wisp).vx += nx / nd * 220; T(wisp).vy += ny / nd * 220
      if (G.hp <= 0) {
        G.hp = 3; G.score = Math.floor(G.score / 2)
        T(wisp).x = 256; T(wisp).y = 256; T(wisp).vx = 0; T(wisp).vy = 0
        T(maw).x = 80; T(maw).y = 80; T(maw).vx = 0; T(maw).vy = 0
        for (const s of shades) park(s, 12, 12)
        for (const b of bolts) park(b, 12, 24)
        G.inv = 2.5; G.shadeT = 4; G.boltT = 5
      }
    }
    // ── WASD: fly ──
    const ACC = 340 * dt
    if (wd.key_a) T(wisp).vx -= ACC
    if (wd.key_d) T(wisp).vx += ACC
    if (wd.key_w) T(wisp).vy -= ACC
    if (wd.key_s) T(wisp).vy += ACC
    const wv = Math.hypot(T(wisp).vx, T(wisp).vy)
    if (wv > 150) { T(wisp).vx *= 150 / wv; T(wisp).vy *= 150 / wv }
    // ── Arrows: sweep the blade ──
    const SW = 5.4 * dt
    let swinging = 0
    if (wd.key_left) { G.ang -= SW; swinging = 1 }
    if (wd.key_right) { G.ang += SW; swinging = 1 }
    const bR = 30
    T(blade).x = T(wisp).x + Math.cos(G.ang) * bR
    T(blade).y = T(wisp).y + Math.sin(G.ang) * bR
    T(blade).vx = T(wisp).vx; T(blade).vy = T(wisp).vy
    T(blade).rotation = G.ang - Math.PI / 2
    blade.visualParams = [swinging, 0, 0, 0]
    // ── Maw: hunt (unless stunned), repelled by the blade ──
    const dx = T(wisp).x - T(maw).x, dy = T(wisp).y - T(maw).y
    const d = Math.hypot(dx, dy) || 1
    if (G.stun <= 0) {
      const chase = (36 + Math.min(G.score * 3, 70)) * dt
      T(maw).vx += dx / d * chase; T(maw).vy += dy / d * chase
    }
    const mv = Math.hypot(T(maw).vx, T(maw).vy)
    const mcap = 55 + Math.min(G.score * 2.5, 55)
    if (mv > mcap) { T(maw).vx *= mcap / mv; T(maw).vy *= mcap / mv }
    const bmx = T(maw).x - T(blade).x, bmy = T(maw).y - T(blade).y
    const bmd = Math.hypot(bmx, bmy) || 1
    if (bmd < 34) { T(maw).vx += bmx / bmd * 260; T(maw).vy += bmy / bmd * 260; G.stun = Math.max(G.stun, 0.8) }
    // ── Embers ──
    for (const e of embers) {
      const ex = T(e).x - T(wisp).x, ey = T(e).y - T(wisp).y
      if (Math.hypot(ex, ey) < 20) {
        G.score++; if (G.score > G.best) G.best = G.score
        T(e).x = 50 + Math.random() * 412; T(e).y = 50 + Math.random() * 412
        T(e).vx = (Math.random() - 0.5) * 10; T(e).vy = (Math.random() - 0.5) * 10
      }
    }
    // ── Shades: spawn at edges, seek, die to the blade ──
    G.shadeT -= dt
    if (G.shadeT <= 0) {
      const s = shades.find(x => x.visualParams && x.visualParams[3] > 0.5)
      if (s) {
        const side = Math.floor(Math.random() * 4)
        T(s).x = side === 0 ? 15 : side === 1 ? 497 : 50 + Math.random() * 412
        T(s).y = side === 2 ? 15 : side === 3 ? 497 : 50 + Math.random() * 412
        T(s).vx = 0; T(s).vy = 0
        s.visualParams = [0, 0, Math.random(), 0]
      }
      G.shadeT = Math.max(2.2, 5.5 - G.score * 0.12)
    }
    for (const s of shades) {
      if (!s.visualParams || s.visualParams[3] > 0.5) continue
      const sx = T(wisp).x - T(s).x, sy = T(wisp).y - T(s).y
      const sd = Math.hypot(sx, sy) || 1
      T(s).vx += sx / sd * 70 * dt; T(s).vy += sy / sd * 70 * dt
      const sv = Math.hypot(T(s).vx, T(s).vy)
      const scap = 52 + Math.min(G.score * 2, 40)
      if (sv > scap) { T(s).vx *= scap / sv; T(s).vy *= scap / sv }
      const kx = T(s).x - T(blade).x, ky = T(s).y - T(blade).y
      if (Math.hypot(kx, ky) < 20) {
        park(s, 12, 12)
        G.score++; if (G.score > G.best) G.best = G.score
        continue
      }
      if (sd < 16 && G.inv <= 0) { doHit(sx, sy, sd); park(s, 12, 12) }
    }
    // ── Bolts: the maw spits fire; the blade sends it back ──
    G.boltT -= dt
    if (G.boltT <= 0 && G.stun <= 0) {
      const b = bolts.find(x => x.visualParams && x.visualParams[3] > 0.5)
      if (b) {
        T(b).x = T(maw).x; T(b).y = T(maw).y
        const spd = 120 + Math.min(G.score * 2, 60)
        T(b).vx = dx / d * spd; T(b).vy = dy / d * spd
        b.visualParams = [T(b).vx, T(b).vy, 0, 0]
        b.properties.set('ttl', 6)
      }
      G.boltT = Math.max(2.0, 4.5 - G.score * 0.07)
    }
    for (const b of bolts) {
      if (!b.visualParams || b.visualParams[3] > 0.5) continue
      const ttl = (b.properties.get('ttl') || 0) - dt
      b.properties.set('ttl', ttl)
      if (ttl <= 0) { park(b, 12, 24); continue }
      const parried = b.visualParams[2] > 0.5
      const px = T(b).x - T(blade).x, py = T(b).y - T(blade).y
      if (!parried && Math.hypot(px, py) < 18) {
        const mx = T(maw).x - T(b).x, my = T(maw).y - T(b).y
        const md = Math.hypot(mx, my) || 1
        T(b).vx = mx / md * 175; T(b).vy = my / md * 175
        b.visualParams = [T(b).vx, T(b).vy, 1, 0]
        b.properties.set('ttl', 5)
      } else if (parried) {
        const hx = T(b).x - T(maw).x, hy = T(b).y - T(maw).y
        if (Math.hypot(hx, hy) < 24) {
          G.score += 2; if (G.score > G.best) G.best = G.score
          T(maw).vx += T(b).vx * 0.7; T(maw).vy += T(b).vy * 0.7
          G.stun = Math.max(G.stun, 1.2)
          park(b, 12, 24)
          continue
        }
        b.visualParams = [T(b).vx, T(b).vy, 1, 0]
      } else {
        const ux = T(b).x - T(wisp).x, uy = T(b).y - T(wisp).y
        const ud = Math.hypot(ux, uy) || 1
        if (ud < 14 && G.inv <= 0) { doHit(ux, uy, ud); park(b, 12, 24); continue }
        b.visualParams = [T(b).vx, T(b).vy, 0, 0]
      }
    }
    // ── Maw body contact ──
    if (d < 28 && G.inv <= 0) doHit(dx, dy, d)
    // ── Feed the visuals ──
    wisp.visualParams = [T(wisp).vx, T(wisp).vy, G.hurt, G.inv > 0 ? 1 : 0]
    maw.visualParams = [Math.min(1.5, 70 / Math.max(d, 24)), G.stun > 0 ? 1 : 0, 0, 0]
    if (hud) {
      hud.visualParams = [Math.min(20, G.score), G.hp, 0, 0]
      hud.name = 'LUMEN \\u00b7 ' + G.score + ' \\u00b7 best ' + G.best
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
  name: 'LUMEN',
  fields: [
    field('lumen_arena_f', 'Arena', [0.05, 0.06, 0.12, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'lumen_arena'),
    field('lumen_ember_1', 'Ember 1', [1, 0.7, 0.2, 1], 140, 300, { shapeType: 'circle', radius: 9 }, 'lumen_ember', [0, 0, 0, 0.2]),
    field('lumen_ember_2', 'Ember 2', [1, 0.7, 0.2, 1], 380, 160, { shapeType: 'circle', radius: 9 }, 'lumen_ember', [0, 0, 0, 0.5]),
    field('lumen_ember_3', 'Ember 3', [1, 0.7, 0.2, 1], 320, 400, { shapeType: 'circle', radius: 9 }, 'lumen_ember', [0, 0, 0, 0.8]),
    field('lumen_maw_f', 'Maw', [0.3, 0.05, 0.4, 1], 80, 80, { shapeType: 'circle', radius: 18 }, 'lumen_maw'),
    field('lumen_shade_1', 'Shade 1', [0.6, 0.1, 0.2, 1], 12, 12, { shapeType: 'circle', radius: 10 }, 'lumen_shade', HIDDEN),
    field('lumen_shade_2', 'Shade 2', [0.6, 0.1, 0.2, 1], 12, 12, { shapeType: 'circle', radius: 10 }, 'lumen_shade', HIDDEN),
    field('lumen_shade_3', 'Shade 3', [0.6, 0.1, 0.2, 1], 12, 12, { shapeType: 'circle', radius: 10 }, 'lumen_shade', HIDDEN),
    field('lumen_shade_4', 'Shade 4', [0.6, 0.1, 0.2, 1], 12, 12, { shapeType: 'circle', radius: 10 }, 'lumen_shade', HIDDEN),
    field('lumen_bolt_1', 'Bolt 1', [1, 0.4, 0.1, 1], 12, 24, { shapeType: 'circle', radius: 6 }, 'lumen_bolt', HIDDEN),
    field('lumen_bolt_2', 'Bolt 2', [1, 0.4, 0.1, 1], 12, 24, { shapeType: 'circle', radius: 6 }, 'lumen_bolt', HIDDEN),
    field('lumen_bolt_3', 'Bolt 3', [1, 0.4, 0.1, 1], 12, 24, { shapeType: 'circle', radius: 6 }, 'lumen_bolt', HIDDEN),
    field('lumen_wisp_f', 'Wisp', [0.6, 0.9, 1, 1], 256, 256, { shapeType: 'circle', radius: 11 }, 'lumen_wisp'),
    field('lumen_blade_f', 'Blade', [0.7, 0.95, 1, 1], 256, 226, { shapeType: 'circle', radius: 14 }, 'lumen_blade', [0, 0, 0, 0]),
    field('lumen_hud_f', 'LUMEN · WASD fly · arrows sword', [1, 0.9, 0.5, 1], 256, 24, { shapeType: 'rect', w: 260, h: 30 }, 'lumen_hud', [0, 3, 0, 0]),
  ],
  worldParams: { gravity: 0, friction: 0.985, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.6, gravitationalConstant: 0 },
  worldData: {},
  stepHooks: [{ id: 'lumen_core', author: 'fable', description: 'LUMEN v2: WASD flight, arrow-key blade, shades, bolt parry', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'lumen_arena', wgsl: ARENA },
    { name: 'lumen_ember', wgsl: EMBER },
    { name: 'lumen_maw', wgsl: MAW },
    { name: 'lumen_shade', wgsl: SHADE },
    { name: 'lumen_bolt', wgsl: BOLT },
    { name: 'lumen_wisp', wgsl: WISP },
    { name: 'lumen_blade', wgsl: BLADE },
    { name: 'lumen_hud', wgsl: HUD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'LUMEN', scene }),
})
console.log('LUMEN v2 saved:', res.status, await res.text())
