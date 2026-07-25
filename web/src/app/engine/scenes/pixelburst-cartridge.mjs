// PIXELBURST — a cartridge.cafe port of the 5 Espers "PixelFX" effect.
//
// The original (5 Espers Autonomous War, src/render/PixelFX.ts) is a Canvas-2D
// system: it reads the rendered terrain with getImageData, launches each pixel
// on a parabolic arc, morphs it terrain → white-hot → ember, and putImageData's
// the result onto an overlay. "The terrain itself IS the source material."
//
// That idea is cartridge.cafe's thesis (pixels are the source of truth), so the
// port is GPU-native, not a copy: it becomes a superimposition visual.
//
// ARCHITECTURE — one truth, two callers:
//   · MODULE  pb_lib   — mod_pb_terrain(px): the ONE terrain color function.
//   · VISUAL  pbterrain — paints mod_pb_terrain (the base field).
//   · VISUAL  pixelburst (superimposed) — GATHERS from mod_pb_terrain at lifted
//       coordinates to build the launched plume, morphs it to ember, and reads
//       `behind` to scorch the crater the pixels rose from. behind can't be
//       sampled at an offset, so the shared module is how the burst "sees" the
//       terrain — the same move as CINDERFELL's mod_cf_h.
//   · WHITEBOARD (worldData.gpuUniforms): 0 t · 1 active · 2 cx · 3 cy ·
//       4 progress · 5 scale · 6 radius · 7 blockSize.
//   · STEP HOOK — tap starts a burst at the pointer; auto-pulses when idle;
//       advances progress each frame. The hook writes, the shader reads.
//
//   Run:  PB_TOKEN=uc_st_... node pixelburst-cartridge.mjs

const TOKEN = process.env.PB_TOKEN
if (!TOKEN) { console.error('PB_TOKEN required'); process.exit(1) }
const URL = process.env.PB_URL || 'https://cartridge.cafe/api/engine/bridge'

async function send(cmd, label) {
  const body = Array.isArray(cmd) ? { commands: cmd } : cmd
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
  const t = await r.text()
  console.log(label || (Array.isArray(cmd) ? 'batch' : cmd.type), r.status, t.slice(0, 160))
  if (!r.ok) throw new Error(`${label}: ${r.status} ${t.slice(0, 400)}`)
  return JSON.parse(t)
}

// ───────────────────────────────────────────── PARENT module: pb_lib ──
const LIB = /* wgsl */`
fn mod_pb_hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn mod_pb_vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mod_pb_hash(i), mod_pb_hash(i + vec2f(1.0, 0.0)), u.x),
             mix(mod_pb_hash(i + vec2f(0.0, 1.0)), mod_pb_hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
// terrain surface height in screen px (y-down: larger y = lower on screen)
fn mod_pb_h(x: f32) -> f32 {
  return 300.0 + 42.0 * sin(x * 0.013 + 0.7) + 20.0 * sin(x * 0.031 + 2.1) + 9.0 * sin(x * 0.07 + 4.0);
}
// terrain COLOR at a screen-space pixel (0..512). The single source of truth.
fn mod_pb_terrain(px: vec2f, t: f32) -> vec3f {
  let surf = mod_pb_h(px.x);
  var c = mix(vec3f(0.07, 0.10, 0.17), vec3f(0.15, 0.12, 0.19), clamp(px.y / 512.0, 0.0, 1.0));
  c += vec3f(0.7, 0.78, 0.95) * step(0.988, mod_pb_hash(floor(px / 7.0))) * step(px.y, surf) * 0.6;
  if (px.y >= surf) {
    let depth = clamp((px.y - surf) / 240.0, 0.0, 1.0);
    var g = mix(vec3f(0.24, 0.17, 0.12), vec3f(0.05, 0.05, 0.07), depth);
    let n = mod_pb_vnoise(px * 0.05);
    g = g * (0.82 + 0.36 * n);
    g += vec3f(0.10, 0.15, 0.07) * step(0.72, mod_pb_hash(floor(px / 5.0))) * (1.0 - depth);
    c = g;
  }
  return c;
}
`

// ─────────────────────────────────────────────── base field: terrain ──
const TERRAIN = /* wgsl */`
fn visual_pbterrain(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let bs = max(uni(7), 1.0);
  let px = (uv * 0.5 + 0.5) * 512.0;
  let q = (floor(px / bs) + vec2f(0.5)) * bs;
  return vec4f(mod_pb_terrain(q, uni(0)), 1.0);
}
`

// ───────────────────────────────────── superimposed effect: pixelburst ──
const BURST = /* wgsl */`
// whiteboard: 0 t · 1 active · 2 cx · 3 cy · 4 progress · 5 scale · 6 radius · 7 blockSize
fn visual_pixelburst(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  if (uni(1) < 0.5) { return vec4f(0.0); }
  let bs = max(uni(7), 1.0);
  let px = (uv * 0.5 + 0.5) * 512.0;
  let q = (floor(px / bs) + vec2f(0.5)) * bs;
  let C = vec2f(uni(2), uni(3));
  let R = max(uni(6), 1.0);
  let P = clamp(uni(4), 0.0, 1.0);
  let scale = uni(5);
  let t = uni(0);

  let surfQ = mod_pb_h(q.x);
  let d = distance(vec2f(q.x, surfQ), C);
  let ring = 1.0 - smoothstep(0.0, R, d);
  if (ring <= 0.001) { return vec4f(0.0); }

  let rnd = mod_pb_hash(vec2f(floor(q.x / bs), 3.0));
  let phase = rnd * 0.15;
  let tn = clamp((P - phase) / max(1.0 - phase, 0.001), 0.0, 1.0);
  let maxH = (16.0 + rnd * 58.0) * scale * ring;
  let lift = 4.0 * maxH * tn * (1.0 - tn);         // parabolic arc: up then down
  let above = surfQ - q.y;

  // PLUME — lifted terrain pixels form a dome above the crater
  if (above > 0.0 && above <= lift && tn < 1.0) {
    let frac = above / max(lift, 1.0);
    let wob = sin(tn * 12.0 + q.x * 0.04) * 3.0 * (1.0 - tn);
    let terr = mod_pb_terrain((floor(vec2f(q.x - wob, surfQ + 4.0) / bs) + vec2f(0.5)) * bs, t);
    let heat = clamp(tn * 0.6 + frac * 0.6, 0.0, 1.0);
    var cc: vec3f;
    if (heat < 0.5) { cc = mix(terr, vec3f(1.0, 0.85, 0.5), heat * 2.0); }
    else { cc = mix(vec3f(1.0, 0.85, 0.5), vec3f(0.95, 0.28, 0.08), (heat - 0.5) * 2.0); }
    let a = 1.0 - smoothstep(0.75, 1.0, tn);
    return vec4f(cc, a);
  }

  // SCORCH — darken the crater the plume rose from (reads behind = the terrain)
  if (above <= 0.0 && above > -R * 0.5) {
    let scorch = ring * (1.0 - smoothstep(0.82, 1.0, P));
    if (scorch > 0.01) {
      return vec4f(behind.rgb * (1.0 - 0.6 * scorch) + vec3f(0.12, 0.02, 0.0) * scorch, behind.a);
    }
  }
  return vec4f(0.0);
}
`

// ─────────────────────────────────────────────────────── step hook ──
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__pb) wd.__pb = { t: 0, active: 0, cx: 256, cy: 300, prog: 0, scale: 1, R: 105, bs: 6, idle: 0 }
  const G = wd.__pb
  const step = Math.min(dt, 1 / 30)
  G.t += step
  const ptr = (wd.input && wd.input.pointer) || {}
  if (ptr.pressed && G.active < 0.5) { G.active = 1; G.prog = 0; G.cx = ptr.x; G.cy = ptr.y; G.idle = 0 }
  if (G.active < 0.5) {
    G.idle += step
    if (G.idle > 2.0) { G.active = 1; G.prog = 0; G.idle = 0; G.cx = 150 + 210 * Math.abs(Math.sin(G.t * 0.6)); G.cy = 300 }
  }
  if (G.active > 0.5) { G.prog += step * 0.85; if (G.prog >= 1) { G.active = 0; G.prog = 0 } }
  wd.gpuUniforms = [G.t, G.active, G.cx, G.cy, G.prog, G.scale, G.R, G.bs]
} catch (e) {}
`

const INSTRUCTIONS = 'PIXELBURST — tap the ground: terrain pixels launch, morph ember, and fall. A GPU-native port of the 5 Espers PixelFX effect (pixels are the source of truth).'

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
    await send({
      type: 'create_field', name, shape: 'rect', x: 256, y: 256, width: 512, height: 512,
      visualType, color: [0.02, 0.03, 0.06, 1], noHit: true,
    }, 'field ' + name)
  }
  // order matters: terrain first, so the burst sees it as `behind`
  await ensureField('Terrain', 'pbterrain')
  await ensureField('Burst', 'pixelburst')

  const st = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  const burst = (st.fields || []).find(f => f.name === 'Burst')
  if (burst) await send({ type: 'set_property', fieldId: burst.id, key: 'superimpose', value: true }, 'superimpose')

  await send({ type: 'add_step_hook', hookId: 'pixelburst', author: 'Claude Opus 4.8', description: 'PIXELBURST: tap → terrain pixels launch/morph/fall; auto-pulse when idle', code: HOOK }, 'hook')
  await send({ type: 'set_world_data', data: { postProcess: { bloomIntensity: 0.5, bloomThreshold: 0.6, exposure: 1.05, vignetteStrength: 0.3, vignetteRadius: 0.85 } } }, 'post')

  const v = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  console.log('VERIFY fields:', (v.fields || []).map(f => f.name),
    '| hooks:', (v.stepHooks || []).map(h => h.id),
    '| visuals:', (v.visualTypes || []).map(x => x.name),
    '| modules:', (v.modules || []).map(x => x.name))
}
main().catch(e => { console.error(e); process.exit(1) })
