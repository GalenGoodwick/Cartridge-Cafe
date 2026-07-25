// PIXELBURST — a cartridge.cafe port of the 5 Espers "PixelFX" effect.
//
// The original (5 Espers Autonomous War, src/render/PixelFX.ts) is a Canvas-2D
// system: it reads the rendered terrain with getImageData, launches each pixel
// on a parabolic arc, morphs it terrain → white-hot → ember, and putImageData's
// the result onto an overlay. "The terrain itself IS the source material."
//
// This port makes the pixels REAL: each launched terrain block is a live entity
// in the population buffer (worldData.gpuPopulation → pop(i)/popCount()), with
// its own arc + gravity. The step hook IS the particle simulation; the shader
// just draws pop(i) blocks. One truth, two callers: surfH() in the hook mirrors
// mod_pb_h() in the shader, so blocks launch from exactly the rendered ground.
//
//   WHITEBOARD: 0 t · 7 blockSize · 8 craterX · 9 craterY · 10 craterR
//   Run:  PB_TOKEN=uc_st_... node pixelburst-cartridge.mjs

const TOKEN = process.env.PB_TOKEN
if (!TOKEN) { console.error('PB_TOKEN required'); process.exit(1) }
const URL = process.env.PB_URL || 'https://cartridge.cafe/api/engine/bridge'

async function send(cmd, label) {
  const body = Array.isArray(cmd) ? { commands: cmd } : cmd
  const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
  const t = await r.text()
  console.log(label || (Array.isArray(cmd) ? 'batch' : cmd.type), r.status, t.slice(0, 160))
  if (!r.ok) throw new Error(`${label}: ${r.status} ${t.slice(0, 400)}`)
  return JSON.parse(t)
}

// ─────────────────────────────────────────── PARENT module: pb_lib ──
const LIB = /* wgsl */`
fn mod_pb_hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn mod_pb_vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mod_pb_hash(i), mod_pb_hash(i + vec2f(1.0, 0.0)), u.x),
             mix(mod_pb_hash(i + vec2f(0.0, 1.0)), mod_pb_hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn mod_pb_h(x: f32) -> f32 { return 300.0 + 42.0 * sin(x * 0.013 + 0.7) + 20.0 * sin(x * 0.031 + 2.1) + 9.0 * sin(x * 0.07 + 4.0); }
fn mod_pb_terrain(px: vec2f, t: f32) -> vec3f {
  let surf = mod_pb_h(px.x);
  var c = mix(vec3f(0.07, 0.10, 0.17), vec3f(0.15, 0.12, 0.19), clamp(px.y / 512.0, 0.0, 1.0));
  c += vec3f(0.7, 0.78, 0.95) * step(0.988, mod_pb_hash(floor(px / 7.0))) * step(px.y, surf) * 0.6;
  if (px.y >= surf) {
    let depth = clamp((px.y - surf) / 240.0, 0.0, 1.0);
    var g = mix(vec3f(0.24, 0.17, 0.12), vec3f(0.05, 0.05, 0.07), depth);
    g = g * (0.82 + 0.36 * mod_pb_vnoise(px * 0.05));
    g += vec3f(0.10, 0.15, 0.07) * step(0.72, mod_pb_hash(floor(px / 5.0))) * (1.0 - depth);
    c = g;
  }
  return c;
}
`

// base terrain — carves a dark crater where a burst is active so the blocks
// really look like they LEFT the ground (uni: 8 craterX · 9 craterY · 10 craterR)
const TERRAIN = /* wgsl */`
fn visual_pbterrain(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let bs = max(uni(7), 1.0);
  let px = (uv * 0.5 + 0.5) * 512.0;
  let q = (floor(px / bs) + vec2f(0.5)) * bs;
  var c = mod_pb_terrain(q, uni(0));
  let cr = uni(10);
  if (cr > 1.0) {
    let cc = vec2f(uni(8), uni(9));
    let surfC = mod_pb_h(q.x);
    let dome = cr * (1.0 - clamp(abs(q.x - cc.x) / max(cr, 1.0), 0.0, 1.0));
    if (q.y < surfC && q.y > surfC - dome) { c = c * 0.18; }
  }
  return vec4f(c, 1.0);
}
`

// the burst field — draws every flying block from the population buffer.
// pop(i) = (x, y, heat, halfSize); a block is a chebyshev square at (x,y).
const BURST = /* wgsl */`
fn visual_pixelburst(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let px = (uv * 0.5 + 0.5) * 512.0;
  let n = popCount();
  var col = vec3f(0.0);
  var a = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let e = pop(i);
    if (max(abs(px.x - e.x), abs(px.y - e.y)) <= e.w) {
      let heat = clamp(e.z, 0.0, 1.0);
      var cc = mix(vec3f(0.5, 0.36, 0.26), vec3f(1.0, 0.85, 0.5), clamp(heat * 1.8, 0.0, 1.0));
      cc = mix(cc, vec3f(0.96, 0.30, 0.09), clamp((heat - 0.45) * 1.9, 0.0, 1.0));
      col = cc;
      a = 1.0;
    }
  }
  return vec4f(col, a);
}
`

// the step hook IS the particle simulation
const HOOK = `
try {
  const wd = sim.worldData
  const surfH = (x) => 300 + 42*Math.sin(x*0.013+0.7) + 20*Math.sin(x*0.031+2.1) + 9*Math.sin(x*0.07+4.0)
  if (!wd.__pb) wd.__pb = { t:0, parts:[], bs:8, idle:0, seeded:0, crT:0, crX:256, crR:0 }
  const G = wd.__pb
  const step = Math.min(dt, 1/30)
  G.t += step
  const bs = G.bs
  const burst = (cx) => {
    const R = 90
    G.crX = cx; G.crR = R; G.crT = 0.5
    for (let x = cx - R; x <= cx + R; x += bs) {
      if (x < 4 || x > 508) continue
      const prox = 1 - Math.min(1, Math.abs(x - cx)/R)
      if (prox <= 0.05) continue
      const surf = surfH(x)
      const layers = 1 + (Math.random() < prox ? 1 : 0)
      for (let k = 0; k < layers; k++) {
        const jx = x + (Math.random()-0.5)*bs
        const speed = (2.4 + Math.random()*2.8) * (0.45 + prox)
        const ang = -Math.PI/2 + ((jx - cx)/R) * 0.85 + (Math.random()-0.5)*0.4
        G.parts.push({ x: jx, y: surf + k*bs, vx: Math.cos(ang)*speed, vy: Math.sin(ang)*speed*1.25, age: 0, life: 0.75 + Math.random()*0.6 })
      }
    }
    if (G.parts.length > 500) G.parts = G.parts.slice(-500)
  }
  if (!G.seeded) { G.seeded = 1; burst(210); burst(330) }
  const ptr = (wd.input && wd.input.pointer) || {}
  if (ptr.pressed) burst(ptr.x)
  G.idle += step
  if (G.idle > 1.6) { G.idle = 0; burst(110 + 300*Math.abs(Math.sin(G.t*0.7))) }
  G.crT = Math.max(0, G.crT - step)
  const out = []
  const alive = []
  for (const p of G.parts) {
    p.age += step
    if (p.age >= p.life) continue
    p.vy += 9.5 * step
    p.x += p.vx * step * 60
    p.y += p.vy * step * 60
    const heat = Math.min(1, (p.age / p.life) * 1.4)
    alive.push(p)
    out.push(p.x, p.y, heat, bs * 0.5)
  }
  G.parts = alive
  wd.gpuPopulation = out
  const uni = []; uni[0] = G.t; uni[7] = bs; uni[8] = G.crX; uni[9] = surfH(G.crX); uni[10] = (G.crT > 0 ? G.crR : 0)
  for (let i = 0; i < 11; i++) if (uni[i] == null) uni[i] = 0
  wd.gpuUniforms = uni
} catch (e) {}
`

const INSTRUCTIONS = 'PIXELBURST — tap the ground: terrain pixels DETACH off the grid, arc up, morph ember, and fall. Real particles (the population buffer). Port of 5 Espers PixelFX.'

async function main() {
  await send([
    { type: 'set_world_data', data: { built_by: 'Claude Opus 4.8', singlePlayer: true, instructions: INSTRUCTIONS } },
    { type: 'set_world_params', params: { gravity: 0, friction: 1, collisionForce: 0, boundaryMode: 'open', gravitationalConstant: 0 } },
    { type: 'define_module', name: 'pb_lib', wgsl: LIB },
    { type: 'define_visual', name: 'pbterrain', wgsl: TERRAIN },
    { type: 'define_visual', name: 'pixelburst', wgsl: BURST },
  ], 'atomic world batch')

  const ensureField = async (name, visualType) => {
    const st = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
    if ((st.fields || []).some(f => f.name === name)) return
    await send({ type: 'create_field', name, shape: 'rect', x: 256, y: 256, width: 512, height: 512, visualType, color: [0.02, 0.03, 0.06, 1], noHit: true }, 'field ' + name)
  }
  await ensureField('Terrain', 'pbterrain')   // field 0 — the ground
  await ensureField('Burst', 'pixelburst')     // field 1 — flying blocks, alpha over terrain

  await send({ type: 'add_step_hook', hookId: 'pixelburst', author: 'Claude Opus 4.8', description: 'PIXELBURST: real particle sim — blocks detach off the grid, arc, gravity, ember; tap or auto-pulse', code: HOOK }, 'hook')
  await send({ type: 'set_world_data', data: { postProcess: { bloomIntensity: 0.5, bloomThreshold: 0.6, exposure: 1.05, vignetteStrength: 0.3, vignetteRadius: 0.85 } } }, 'post')

  const v = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  console.log('VERIFY fields:', (v.fields || []).map(f => f.name), '| hooks:', (v.stepHooks || []).map(h => h.id), '| visuals:', (v.visualTypes || []).map(x => x.name))
}
main().catch(e => { console.error(e); process.exit(1) })
