// MARIONETTES — pixel-perfect node-skeleton experiment.
// No primitives, no radial glows, no rect fills: every visual is joints + bones
// drawn on a quantized texel grid with hard step() edges (3 screen px per texel).
// Fields never rotate — heading arrives via visualParams and the skeleton rotates
// BEFORE quantization, so texels stay screen-aligned (true pixel grid).
// Interaction: creatures reach toward the nearest neighbor, close pairs sync
// gait phase, and a pixel-lightning Bridge field snaps between the two closest.

const MODULES = /* wgsl */`
fn mod_px(uv: vec2f, res: f32) -> vec2f {
  let t = (uv * 0.5 + vec2f(0.5)) * res;
  return floor(t) + vec2f(0.5) - vec2f(res * 0.5);
}
fn mod_seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(p - a - ab * h);
}
fn mod_bone(p: vec2f, a: vec2f, b: vec2f, w: f32) -> f32 {
  return step(mod_seg(p, a, b), w);
}
fn mod_node(p: vec2f, c: vec2f, r: f32) -> f32 {
  let d = abs(p - c);
  return step(d.x + d.y, r);
}`

const ARENA = /* wgsl */`
fn visual_mar_arena(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let t = (uv * 0.5 + vec2f(0.5)) * 128.0;
  let q = floor(t);
  var c = vec3f(0.020, 0.024, 0.038);
  let checker = f32((i32(q.x) + i32(q.y)) % 2);
  c += vec3f(0.0045) * checker;
  let h = hash21(q);
  if (h > 0.9965) {
    let tq = floor(time * 1.5);
    let blink = step(0.25, hash21(q + vec2f(tq * 0.37, tq * 0.11)));
    c = mix(c, vec3f(0.30, 0.34, 0.44), blink);
  }
  return vec4f(c, 1.0);
}`

// params for every creature: [heading, gaitPhase, reachAngleWorld, reach01]
const SERPENT = /* wgsl */`
fn visual_mar_serpent(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = mod_px(uv, 44.0);
  let hd = p.x; let ph = p.y; let ra = p.z; let reach = clamp(p.w, 0.0, 1.0);
  var bone = 0.0; var node = 0.0; var eye = 0.0;
  let head = rotate(vec2f(15.0, sin(ph * 1.4) * 1.2), hd);
  node = max(node, mod_node(c, head, 2.4));
  eye = mod_node(c, head + rotate(vec2f(1.2, -1.2), hd), 0.7);
  var prev = head;
  for (var i = 1; i < 10; i++) {
    let fi = f32(i);
    let cur = rotate(vec2f(15.0 - fi * 3.3, sin(ph * 1.4 - fi * 0.85) * (1.6 + fi * 0.35)), hd);
    bone = max(bone, mod_bone(c, prev, cur, 0.55));
    node = max(node, mod_node(c, cur, 1.1));
    prev = cur;
  }
  if (reach > 0.15) {
    let dir = vec2f(cos(ra), sin(ra));
    bone = max(bone, mod_bone(c, head, head + dir * (2.5 + 4.0 * reach), 0.55));
  }
  if (bone + node < 0.5) { return vec4f(0.0); }
  var color = mix(vec3f(0.30, 0.78, 0.58), vec3f(0.66, 1.0, 0.84), step(0.5, node));
  color = mix(color, vec3f(0.05, 0.10, 0.08), step(0.5, eye));
  color = mix(color, vec3f(0.95), reach * 0.30 * step(0.5, node));
  return vec4f(color, 1.0);
}`

const WALKER = /* wgsl */`
fn visual_mar_walker(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = mod_px(uv, 44.0);
  let hd = p.x; let ph = p.y; let reach = clamp(p.w, 0.0, 1.0);
  let bob = sin(ph * 2.0) * 0.8;
  let hip = rotate(vec2f(-7.0, bob * 0.5), hd);
  let chest = rotate(vec2f(6.0, bob), hd);
  let head = rotate(vec2f(13.0, -3.0 + bob), hd);
  let tail = rotate(vec2f(-15.0, -2.0 - bob), hd);
  var bone = max(mod_bone(c, hip, chest, 0.55), max(mod_bone(c, chest, head, 0.55), mod_bone(c, tail, hip, 0.55)));
  var node = max(mod_node(c, head, 2.0), max(mod_node(c, hip, 1.3), mod_node(c, chest, 1.3)));
  let eye = mod_node(c, head + rotate(vec2f(1.0, -0.8), hd), 0.7);
  for (var i = 0; i < 4; i++) {
    let fi = f32(i);
    let front = f32(i / 2);
    let baseL = mix(vec2f(-7.0, bob * 0.5), vec2f(6.0, bob), front);
    let off = ph + fi * 1.5708;
    let fx = baseL.x + sin(off) * 4.5;
    let lift = max(sin(off + 1.5708), 0.0) * 2.5;
    let footL = vec2f(fx, 10.0 - lift);
    let kneeL = vec2f((baseL.x + fx) * 0.5 + 1.5, (baseL.y + footL.y) * 0.5 - 1.5);
    let base = rotate(baseL, hd);
    let knee = rotate(kneeL, hd);
    let foot = rotate(footL, hd);
    bone = max(bone, max(mod_bone(c, base, knee, 0.55), mod_bone(c, knee, foot, 0.55)));
    node = max(node, max(mod_node(c, knee, 0.9), mod_node(c, foot, 0.9)));
  }
  if (bone + node < 0.5) { return vec4f(0.0); }
  var color = mix(vec3f(0.85, 0.60, 0.20), vec3f(1.0, 0.85, 0.48), step(0.5, node));
  color = mix(color, vec3f(0.10, 0.06, 0.02), step(0.5, eye));
  color = mix(color, vec3f(0.95), reach * 0.30 * step(0.5, node));
  return vec4f(color, 1.0);
}`

const PUPPET = /* wgsl */`
fn visual_mar_puppet(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = mod_px(uv, 44.0);
  let hd = p.x; let ph = p.y; let ra = p.z; let reach = clamp(p.w, 0.0, 1.0);
  let bob = sin(ph * 2.0) * 0.6;
  let pelvis = rotate(vec2f(0.0, 2.0 + bob), hd);
  let chest = rotate(vec2f(0.8, -5.0 + bob), hd);
  let head = rotate(vec2f(1.4, -11.0 + bob), hd);
  var bone = max(mod_bone(c, pelvis, chest, 0.55), mod_bone(c, chest, head, 0.55));
  var node = max(mod_node(c, head, 2.2), max(mod_node(c, pelvis, 1.2), mod_node(c, chest, 1.2)));
  for (var i = 0; i < 2; i++) {
    let off = ph + f32(i) * 3.14159;
    let fx = sin(off) * 4.0;
    let lift = max(sin(off + 1.5708), 0.0) * 2.2;
    let footL = vec2f(fx, 12.0 - lift);
    let kneeL = vec2f(fx * 0.5 + 1.2, (2.0 + footL.y) * 0.5);
    let knee = rotate(kneeL + vec2f(0.0, bob * 0.5), hd);
    let foot = rotate(footL, hd);
    bone = max(bone, max(mod_bone(c, pelvis, knee, 0.55), mod_bone(c, knee, foot, 0.55)));
    node = max(node, max(mod_node(c, knee, 0.9), mod_node(c, foot, 0.9)));
  }
  // back arm swings; front arm reaches for the neighbor
  let swing = sin(ph + 3.14159) * 3.0;
  let handB = rotate(vec2f(0.8 + swing, 1.5 + bob), hd);
  let elbowB = rotate(vec2f(0.8 + swing * 0.5 - 1.0, -2.0 + bob), hd);
  bone = max(bone, max(mod_bone(c, chest, elbowB, 0.55), mod_bone(c, elbowB, handB, 0.55)));
  node = max(node, mod_node(c, handB, 0.9));
  let dir = vec2f(cos(ra), sin(ra));
  let hand = chest + dir * (4.0 + 6.0 * reach);
  let elbow = mix(chest, hand, 0.5) + rotate(vec2f(0.0, -1.5), hd);
  bone = max(bone, max(mod_bone(c, chest, elbow, 0.55), mod_bone(c, elbow, hand, 0.55)));
  node = max(node, mod_node(c, hand, 0.9 + reach * 0.6));
  if (bone + node < 0.5) { return vec4f(0.0); }
  var color = mix(vec3f(0.80, 0.30, 0.50), vec3f(1.0, 0.62, 0.78), step(0.5, node));
  color = mix(color, vec3f(0.95), reach * 0.30 * step(0.5, node));
  return vec4f(color, 1.0);
}`

const CRAWLER = /* wgsl */`
fn visual_mar_crawler(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = mod_px(uv, 44.0);
  let hd = p.x; let ph = p.y; let reach = clamp(p.w, 0.0, 1.0);
  let bob = sin(ph * 3.0) * 0.5;
  let bodyA = rotate(vec2f(-5.0, bob), hd);
  let bodyB = rotate(vec2f(5.0, -bob), hd);
  let headP = rotate(vec2f(9.5, -bob - 1.0), hd);
  var bone = max(mod_bone(c, bodyA, bodyB, 0.55), mod_bone(c, bodyB, headP, 0.55));
  var node = max(mod_node(c, bodyA, 1.4), max(mod_node(c, bodyB, 1.4), mod_node(c, headP, 1.8)));
  // antennae
  bone = max(bone, mod_bone(c, headP, headP + rotate(vec2f(3.0, -3.0 + sin(ph * 2.0)), hd), 0.55));
  bone = max(bone, mod_bone(c, headP, headP + rotate(vec2f(3.5, 1.5 + cos(ph * 2.0)), hd), 0.55));
  for (var i = 0; i < 6; i++) {
    let xi = f32(i % 3);
    let side = f32(i / 3) * 2.0 - 1.0;   // -1 upper row, +1 lower row
    let tri = f32((i + i / 3) % 2);      // tripod gait: alternate legs
    let baseL = vec2f(-6.0 + xi * 6.0, side * 1.5);
    let off = ph * 1.6 + tri * 3.14159 + xi * 0.4;
    let fx = baseL.x + sin(off) * 3.0;
    let lift = max(sin(off + 1.5708), 0.0) * 2.0;
    let footL = vec2f(fx, side * (8.5 - lift));
    let kneeL = vec2f((baseL.x + fx) * 0.5, side * 5.0 + baseL.y);
    let base = rotate(baseL, hd);
    let knee = rotate(kneeL, hd);
    let foot = rotate(footL, hd);
    bone = max(bone, max(mod_bone(c, base, knee, 0.55), mod_bone(c, knee, foot, 0.55)));
    node = max(node, mod_node(c, foot, 0.8));
  }
  if (bone + node < 0.5) { return vec4f(0.0); }
  var color = mix(vec3f(0.45, 0.46, 0.88), vec3f(0.72, 0.75, 1.0), step(0.5, node));
  color = mix(color, vec3f(0.95), reach * 0.30 * step(0.5, node));
  return vec4f(color, 1.0);
}`

// params: [halfLen01, active, seed, angleWorld]
const BRIDGE = /* wgsl */`
fn visual_mar_bridge(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  if (p.y < 0.5) { return vec4f(0.0); }
  let c = mod_px(uv, 64.0);
  let L = p.x * 30.0;
  let tq = floor(time * 12.0);
  var on = 0.0;
  var prev = rotate(vec2f(-L, 0.0), p.w);
  for (var i = 1; i <= 8; i++) {
    let fi = f32(i);
    var y = (hash21(vec2f(fi + p.z * 7.0, tq)) - 0.5) * 7.0;
    if (i == 8) { y = 0.0; }
    let cur = rotate(vec2f(-L + fi * (L * 2.0 / 8.0), y), p.w);
    on = max(on, mod_bone(c, prev, cur, 0.55));
    prev = cur;
  }
  if (on < 0.5) { return vec4f(0.0); }
  return vec4f(vec3f(0.75, 1.0, 1.0) * 1.5, 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__mar) wd.__mar = { t: 0, cs: {} }
  const G = wd.__mar
  G.t += dt
  const creatures = [], bridges = []
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Serpent') || n.startsWith('Walker') || n.startsWith('Puppet') || n.startsWith('Crawler')) creatures.push(f)
    else if (n.startsWith('Bridge')) bridges.push(f)
  }
  const T = f => f.transform
  const SPEC = { Serpent: { v: 34, gait: 2.6, turn: 0.9 }, Walker: { v: 26, gait: 3.2, turn: 0.7 }, Puppet: { v: 20, gait: 3.0, turn: 0.8 }, Crawler: { v: 30, gait: 4.4, turn: 1.1 } }
  for (let i = 0; i < creatures.length; i++) {
    const f = creatures[i]
    if (!G.cs[f.name]) G.cs[f.name] = { h: i * 1.7, ph: i * 2.3, reach: 0 }
    const S = G.cs[f.name]
    const spec = SPEC[f.name.split(' ')[0]] || SPEC.Serpent
    S.h += Math.sin(G.t * 0.5 + i * 2.7) * spec.turn * dt
    if (T(f).x < 75 || T(f).x > 437 || T(f).y < 75 || T(f).y > 437) {
      const ca = Math.atan2(256 - T(f).y, 256 - T(f).x)
      let dh = ca - S.h
      while (dh > Math.PI) dh -= 6.28318
      while (dh < -Math.PI) dh += 6.28318
      S.h += dh * Math.min(1, dt * 2.5)
    }
    T(f).vx = Math.cos(S.h) * spec.v
    T(f).vy = Math.sin(S.h) * spec.v
    S.ph += spec.gait * dt
    let best = null, bd = 1e9
    for (const o of creatures) {
      if (o === f) continue
      const d = Math.hypot(T(o).x - T(f).x, T(o).y - T(f).y)
      if (d < bd) { bd = d; best = o }
    }
    let ra = 0
    if (best) ra = Math.atan2(T(best).y - T(f).y, T(best).x - T(f).x)
    const want = bd < 130 ? 1 : 0
    S.reach += (want - S.reach) * Math.min(1, dt * 3)
    if (best && bd < 55) {
      const rx = T(f).x - T(best).x, ry = T(f).y - T(best).y
      T(f).vx += rx / bd * 45; T(f).vy += ry / bd * 45
    }
    f.visualParams = [S.h, S.ph, ra, S.reach]
  }
  const pairs = []
  for (let i = 0; i < creatures.length; i++) {
    for (let j = i + 1; j < creatures.length; j++) {
      const a = creatures[i], b = creatures[j]
      const d = Math.hypot(T(a).x - T(b).x, T(a).y - T(b).y)
      if (d < 120) pairs.push({ a, b, d })
    }
  }
  pairs.sort((x, y) => x.d - y.d)
  for (let k = 0; k < bridges.length; k++) {
    const br = bridges[k]
    if (k < pairs.length) {
      const pr = pairs[k]
      T(br).x = (T(pr.a).x + T(pr.b).x) / 2
      T(br).y = (T(pr.a).y + T(pr.b).y) / 2
      const ang = Math.atan2(T(pr.b).y - T(pr.a).y, T(pr.b).x - T(pr.a).x)
      br.visualParams = [Math.min(30, pr.d / 6) / 30, 1, (k + 1) * 3.3, ang]
      const Sa = G.cs[pr.a.name], Sb = G.cs[pr.b.name]
      if (Sa && Sb) {
        const m = (Sa.ph + Sb.ph) / 2
        Sa.ph += (m - Sa.ph) * dt * 1.5
        Sb.ph += (m - Sb.ph) * dt * 1.5
      }
    } else {
      br.visualParams = [0, 0, 0, 0]
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
  name: 'MARIONETTES',
  fields: [
    field('mar_arena_f', 'Arena', [0.02, 0.02, 0.04, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'mar_arena'),
    field('mar_bridge_1', 'Bridge 1', [0.7, 1, 1, 1], 30, 30, { shapeType: 'circle', radius: 96 }, 'mar_bridge', [0, 0, 0, 0]),
    field('mar_bridge_2', 'Bridge 2', [0.7, 1, 1, 1], 30, 60, { shapeType: 'circle', radius: 96 }, 'mar_bridge', [0, 0, 0, 0]),
    field('mar_serpent_f', 'Serpent', [0.3, 0.8, 0.6, 1], 150, 150, { shapeType: 'circle', radius: 66 }, 'mar_serpent', [0, 0, 0, 0]),
    field('mar_walker_f', 'Walker', [0.85, 0.6, 0.2, 1], 370, 150, { shapeType: 'circle', radius: 66 }, 'mar_walker', [0, 0, 0, 0]),
    field('mar_puppet_f', 'Puppet', [0.8, 0.3, 0.5, 1], 150, 370, { shapeType: 'circle', radius: 66 }, 'mar_puppet', [0, 0, 0, 0]),
    field('mar_crawler_f', 'Crawler', [0.45, 0.46, 0.88, 1], 370, 370, { shapeType: 'circle', radius: 66 }, 'mar_crawler', [0, 0, 0, 0]),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.5, gravitationalConstant: 0 },
  worldData: {
    postProcess: { bloomIntensity: 0.06, bloomThreshold: 1.2, exposure: 1.0, vignetteStrength: 0, vignetteRadius: 0.8 },
  },
  stepHooks: [{ id: 'mar_core', author: 'fable', description: 'MARIONETTES: wandering node skeletons, neighbor reach, gait sync, lightning bridges', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'mar_arena', wgsl: ARENA },
    { name: 'mar_bridge', wgsl: BRIDGE },
    { name: 'mar_serpent', wgsl: SERPENT },
    { name: 'mar_walker', wgsl: WALKER },
    { name: 'mar_puppet', wgsl: PUPPET },
    { name: 'mar_crawler', wgsl: CRAWLER },
  ],
  modules: [{ name: 'skel', wgsl: MODULES }],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'MARIONETTES', scene }),
})
console.log('MARIONETTES saved:', res.status, await res.text())
