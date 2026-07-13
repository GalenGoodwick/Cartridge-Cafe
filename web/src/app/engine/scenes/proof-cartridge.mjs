// PROOF — a world that accumulates law while it runs.
//
// The matter is given: eighteen motes adrift in a dark pool. The LAWS are not:
// they arrive over plain HTTP as named rule fragments (grafts), superimpose —
// forces literally SUM — and can be removed by name. The world never reloads.
//
//   Graft:   {"type":"set_world_data","data":{"__graft":{"name":"gravity-well","law":{"type":"attract","x":180,"y":220,"g":60,"desc":"motes fall toward the well"}}}}
//   Ungraft: {"type":"set_world_data","data":{"__ungraft":{"name":"gravity-well"}}}
//
// Law types the interpreter knows: attract · wind · vortex · predator.
// Each graft appends itself to the world's INSTRUCTIONS — the law book is public.
//   Save+load: node proof-cartridge.mjs   (then reload /engine, pick PROOF)

const WORLD = /* wgsl */`
fn visual_proof_pool(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let p = (uv + vec2f(1.0)) * 256.0;
  let t = time;

  // still dark water, faint caustics
  var col = vec3f(0.012, 0.020, 0.026);
  let ca = vnoise(p * 0.03 + vec2f(t * 0.05, t * 0.03)) * vnoise(p * 0.05 - vec2f(t * 0.04, 0.0));
  col += vec3f(0.010, 0.030, 0.036) * smoothstep(0.18, 0.45, ca);

  // ── LAW: the well (uni0 on, 1,2 pos) ──
  if (uni(0) > 0.5) {
    let wp = p - vec2f(uni(1), uni(2));
    let d = length(wp);
    col += vec3f(1.4, 1.0, 0.35) * exp(-d * 0.035) * (0.55 + 0.25 * sin(t * 2.2));
    let ring = abs(fract(d * 0.02 - t * 0.22) - 0.5);
    col += vec3f(0.5, 0.38, 0.12) * smoothstep(0.10, 0.0, ring) * exp(-d * 0.012);
  }

  // ── LAW: the wind (uni4 on, 5,6 dir) ──
  if (uni(4) > 0.5) {
    let wdir = normalize(vec2f(uni(5), uni(6)) + vec2f(1.0e-4));
    let along = dot(p, wdir);
    let across = dot(p, vec2f(-wdir.y, wdir.x));
    let streak = smoothstep(0.75, 1.0, vnoise(vec2f(along * 0.05 - t * 3.0, across * 0.35)));
    col += vec3f(0.10, 0.16, 0.18) * streak;
  }

  // ── LAW: the vortex (uni10 on, 11,12 pos) ──
  if (uni(10) > 0.5) {
    let vp = p - vec2f(uni(11), uni(12));
    let d = length(vp);
    let ang = atan2(vp.y, vp.x);
    let arm = abs(fract((ang * 0.955 + d * 0.02 - t * 0.5)) - 0.5);
    col += vec3f(0.15, 0.35, 0.45) * smoothstep(0.12, 0.0, arm) * exp(-d * 0.015);
  }

  // ── LAW: the predator (uni7 on, 8,9 pos) ──
  if (uni(7) > 0.5) {
    let pp = p - vec2f(uni(8), uni(9));
    let d = length(pp);
    col += vec3f(1.6, 0.12, 0.10) * exp(-d * 0.09) * (0.7 + 0.3 * sin(t * 9.0));
    if (d < 5.0) { col = vec3f(2.0, 0.3, 0.2); }
  }

  col *= 1.0 - 0.5 * pow(length(uv), 3.0);   // pool edge falls to dark
  return vec4f(col, 1.0);
}

fn visual_mote(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let d = length(uv);
  let glow = exp(-d * 2.6);
  if (glow < 0.03) { return vec4f(0.0); }
  return vec4f(color.rgb * glow * 1.8, glow);
}`

// ─────────────────────────────────────────────────────────────────────────────
// The interpreter: the world's ONE fixed hook. It executes whatever laws the
// book currently holds. Grafting adds law; ungrafting removes it; forces sum.
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__book || wd.__book.v !== 1) wd.__book = { v: 1, laws: {}, order: [] }
  const B = wd.__book
  const pdt = Math.min(dt, 0.05)

  const DESC = {
    attract: 'matter falls toward a point',
    wind: 'a current carries everything',
    vortex: 'space turns around a center',
    predator: 'something hunts the motes',
  }
  const rebuildInstructions = () => {
    let s = 'No controls — this world is watched, not driven.\\n'
    s += 'Its laws arrive over HTTP as grafted rule fragments; forces superpose.\\n\\nLAWS IN FORCE:\\n'
    s += B.order.length
      ? B.order.map(n => '\\u00b7 ' + n + ' \\u2014 ' + ((B.laws[n] && (B.laws[n].desc || DESC[B.laws[n].type])) || '')).join('\\n')
      : '\\u00b7 none \\u2014 matter drifts free'
    wd.instructions = s
  }

  // ── graft / ungraft: the world accepts new law while running ──
  const g = wd.__graft
  if (g && g.name && g.law) {
    B.laws[g.name] = g.law
    if (!B.order.includes(g.name)) B.order.push(g.name)
    delete wd.__graft
    rebuildInstructions()
    wd.__play_sound = [
      { frequency: 520, duration: 0.10, volume: 0.3, type: 'sine' },
      { frequency: 780, duration: 0.16, volume: 0.25, type: 'sine' },
    ]
  }
  const ug = wd.__ungraft
  if (ug && ug.name) {
    delete B.laws[ug.name]
    B.order = B.order.filter(n => n !== ug.name)
    delete wd.__ungraft
    rebuildInstructions()
    wd.__play_sound = { frequency: 240, duration: 0.2, volume: 0.3, type: 'triangle' }
  }
  if (wd.instructions === undefined) rebuildInstructions()

  // ── the matter: motes, moved by the SUM of the laws ──
  const laws = B.order.map(n => B.laws[n]).filter(Boolean)
  let pred = null
  for (const f of sim.fields.values()) {
    const P = f.properties
    const isMote = P && (P.get ? P.get('mote') : P.mote)
    if (!isMote) { f.transform.x = 256; f.transform.y = 256; f.transform.vx = 0; f.transform.vy = 0; continue }
    const T = f.transform
    let fx = (Math.random() - 0.5) * 14, fy = (Math.random() - 0.5) * 14   // base drift
    for (const L of laws) {
      if (L.type === 'attract') {
        const dx = L.x - T.x, dy = L.y - T.y
        const d = Math.hypot(dx, dy) || 1
        fx += dx / d * (L.g || 50); fy += dy / d * (L.g || 50)
      } else if (L.type === 'wind') {
        fx += L.ax || 0; fy += L.ay || 0
      } else if (L.type === 'vortex') {
        const dx = L.x - T.x, dy = L.y - T.y
        const d = Math.hypot(dx, dy) || 1
        fx += (-dy / d) * (L.w || 60) + dx / d * 8
        fy += (dx / d) * (L.w || 60) + dy / d * 8
      }
    }
    T.vx = (T.vx + fx * pdt) * (1 - 0.8 * pdt)
    T.vy = (T.vy + fy * pdt) * (1 - 0.8 * pdt)
    T.x += T.vx * pdt; T.y += T.vy * pdt
    if (T.x < 12) { T.x = 12; T.vx = Math.abs(T.vx) }
    if (T.x > 500) { T.x = 500; T.vx = -Math.abs(T.vx) }
    if (T.y < 12) { T.y = 12; T.vy = Math.abs(T.vy) }
    if (T.y > 500) { T.y = 500; T.vy = -Math.abs(T.vy) }
  }

  // ── the predator law: a hunter that exists only while its law does ──
  const predLaw = laws.find(L => L.type === 'predator')
  if (predLaw) {
    if (!wd.__pred) wd.__pred = { x: 40, y: 40 }
    const Pr = wd.__pred
    let best = null, bd = 1e9
    for (const f of sim.fields.values()) {
      const P = f.properties
      if (!(P && (P.get ? P.get('mote') : P.mote))) continue
      const d = (f.transform.x - Pr.x) ** 2 + (f.transform.y - Pr.y) ** 2
      if (d < bd) { bd = d; best = f }
    }
    if (best) {
      const dx = best.transform.x - Pr.x, dy = best.transform.y - Pr.y
      const d = Math.sqrt(bd) || 1
      Pr.x += dx / d * (predLaw.speed || 70) * pdt
      Pr.y += dy / d * (predLaw.speed || 70) * pdt
      if (d < 10) {   // caught: the mote is reborn at the rim
        best.transform.x = Math.random() < 0.5 ? 16 : 496
        best.transform.y = 16 + Math.random() * 480
        wd.__play_sound = { frequency: 140, duration: 0.08, volume: 0.2, type: 'square' }
      }
    }
  } else { delete wd.__pred }

  // publish law state for the pool to draw
  const A = laws.find(L => L.type === 'attract')
  const W = laws.find(L => L.type === 'wind')
  const V = laws.find(L => L.type === 'vortex')
  wd.gpuUniforms = [
    A ? 1 : 0, A ? A.x : 0, A ? A.y : 0, 0,
    W ? 1 : 0, W ? W.ax : 0, W ? W.ay : 0,
    predLaw ? 1 : 0, wd.__pred ? wd.__pred.x : 0, wd.__pred ? wd.__pred.y : 0,
    V ? 1 : 0, V ? V.x : 0, V ? V.y : 0,
  ]
  wd.hud = [
    { id: 'pf_t', type: 'text', x: '14px', y: '12px', text: 'PROOF \\u2014 laws in force: ' + (B.order.join(', ') || 'none'), color: '#c9b370', fontSize: '13px' },
  ]
} catch (e) { /* keep the sim alive */ }
`

const fields = [{
  id: 'pf_pool', name: 'The Pool', color: [0.05, 0.08, 0.09, 1],
  effects: [], memory: [], proximity: [], properties: { hx: 256, hy: 256 },
  transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  shapeType: 'rect', w: 512, h: 512, visualTypeName: 'proof_pool', noHit: true, noCollide: true,
}]
const palette = [[0.3, 0.8, 0.8, 1], [0.9, 0.75, 0.35, 1], [0.55, 0.65, 0.95, 1]]
for (let i = 0; i < 18; i++) {
  fields.push({
    id: `pf_mote_${i}`, name: `Mote ${i}`, color: palette[i % 3],
    effects: [], memory: [], proximity: [], properties: { mote: 1 },
    transform: { x: 40 + (i % 6) * 86, y: 60 + Math.floor(i / 6) * 140, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'circle', radius: 6, visualTypeName: 'mote', noHit: true, noCollide: true,
  })
}

const scene = {
  name: 'PROOF',
  fields,
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'No controls — this world is watched, not driven.\nIts laws arrive over HTTP as grafted rule fragments; forces superpose.\n\nLAWS IN FORCE:\n· none — matter drifts free',
    postProcess: { bloomIntensity: 0.5, bloomThreshold: 0.6, exposure: 1.0, vignetteStrength: 0.35, vignetteRadius: 0.75 },
  },
  stepHooks: [{ id: 'pf_law', author: 'fable', description: 'PROOF: the law interpreter — executes whatever rule fragments the book holds; grafts arrive via worldData.', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'proof_pool', wgsl: WORLD.split('fn visual_mote')[0] }, { name: 'mote', wgsl: 'fn visual_mote' + WORLD.split('fn visual_mote')[1] }],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'PROOF', scene }),
})
console.log('PROOF saved:', res.status, await res.text(), `(${fields.length} fields)`)
