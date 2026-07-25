// PIXELBURST — a cartridge.cafe port of the 5 Espers "PixelFX" effect.
//
// The original (5 Espers, src/render/PixelFX.ts) is Canvas-2D: it reads the
// rendered terrain with getImageData, launches each pixel on an arc, morphs it
// terrain → white-hot → ember, and putImageData's an overlay. "The terrain
// itself IS the source material."
//
// This port makes the pixels REAL and REVERSIBLE: the terrain's own blocks lift
// off their home cells as live entities in the population buffer, glow ember at
// the apex, then fall back to EXACTLY their home and dissolve into the terrain.
// Not a fountain of replacements — a reversible eruption that heals. The step
// hook IS the sim; the shader draws pop(i) blocks. surfH() mirrors mod_pb_h() so
// blocks leave exactly the rendered ground line (one truth, two callers).
//
//   WHITEBOARD: 0 t · 7 blockSize · 8 craterX · 9 craterY · 10 craterR*openness
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
      a = clamp(heat * 4.0, 0.0, 1.0);   // fade IN off the ground, OUT as it lands
    }
  }
  return vec4f(col, a);
}
`

const HOOK = `
try {
  const wd = sim.worldData
  const surfH = (x) => 300 + 42*Math.sin(x*0.013+0.7) + 20*Math.sin(x*0.031+2.1) + 9*Math.sin(x*0.07+4.0)
  if (!wd.__pb || wd.__pb.ver !== 3) wd.__pb = { ver:3, t:0, parts:[], bs:8, idle:0, seeded:0, bx:256, ba:99, bdur:1, bR:90 }
  const G = wd.__pb
  const step = Math.min(dt, 1/30)
  G.t += step
  const bs = G.bs
  const burst = (cx) => {
    const R = 90
    G.bx = cx; G.ba = 0; G.bdur = 1.15; G.bR = R
    for (let x = cx - R; x <= cx + R; x += bs) {
      if (x < 4 || x > 508) continue
      const prox = 1 - Math.min(1, Math.abs(x - cx)/R)
      if (prox <= 0.05) continue
      const home = surfH(x)
      const layers = 1 + (Math.random() < prox ? 1 : 0)
      for (let k = 0; k < layers; k++) {
        G.parts.push({ hx: x + (Math.random()-0.5)*bs, hy: home + k*bs, a: 0, dur: 0.8 + Math.random()*0.5, peak: (26 + Math.random()*90)*(0.4+prox), wob: (Math.random()-0.5)*34 })
      }
    }
    if (G.parts.length > 600) G.parts = G.parts.slice(-600)
  }
  if (!G.seeded) { G.seeded = 1; burst(230) }
  const ptr = (wd.input && wd.input.pointer) || {}
  if (ptr.pressed) burst(ptr.x)
  G.idle += step
  if (G.idle > 2.4) { G.idle = 0; burst(110 + 300*Math.abs(Math.sin(G.t*0.7))) }
  G.ba += step
  const bn = Math.min(1, G.ba / G.bdur)
  const openness = (G.ba < G.bdur) ? 4*bn*(1-bn) : 0
  const out = []
  const alive = []
  for (const p of G.parts) {
    p.a += step
    if (p.a >= p.dur) continue           // arrived home → terrain again, drop it
    const n = p.a / p.dur
    const arc = 4*n*(1-n)                // 0 → 1 → 0: up, then exactly back home
    const x = p.hx + p.wob * Math.sin(n*Math.PI)
    const y = p.hy - p.peak * arc
    alive.push(p)
    out.push(x, y, arc, bs*0.5)          // heat = arc (cool at ends, ember at apex)
  }
  G.parts = alive
  wd.gpuPopulation = out
  const uni = []; uni[0]=G.t; uni[7]=bs; uni[8]=G.bx; uni[9]=surfH(G.bx); uni[10]=G.bR*openness
  for (let i=0;i<11;i++) if (uni[i]==null) uni[i]=0
  wd.gpuUniforms = uni
} catch (e) {}
`

const INSTRUCTIONS = 'PIXELBURST — tap the ground: terrain pixels lift off, glow ember at the top, and settle back into place. Port of 5 Espers PixelFX.'

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
  await ensureField('Terrain', 'pbterrain')
  await ensureField('Burst', 'pixelburst')

  await send({ type: 'add_step_hook', hookId: 'pixelburst', author: 'Claude Opus 4.8', description: 'PIXELBURST: reversible particle sim — terrain blocks lift off and settle back home; tap or auto-pulse', code: HOOK }, 'hook')
  await send({ type: 'set_world_data', data: { postProcess: { bloomIntensity: 0.5, bloomThreshold: 0.6, exposure: 1.05, vignetteStrength: 0.3, vignetteRadius: 0.85 } } }, 'post')

  const v = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  console.log('VERIFY fields:', (v.fields || []).map(f => f.name), '| hooks:', (v.stepHooks || []).map(h => h.id), '| visuals:', (v.visualTypes || []).map(x => x.name))
}
main().catch(e => { console.error(e); process.exit(1) })
