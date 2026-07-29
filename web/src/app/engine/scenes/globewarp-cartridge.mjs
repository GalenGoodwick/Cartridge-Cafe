// GLOBEWARP — the lawform primitive at full power. A raymarched cosmos (an
// infinite glowing orb-lattice, flown through) with a PORTAL-LENS lawform: a
// field that warps space AND time together. Inside the lens you see a larger,
// time-shifted slice of the same world bulging through — "enter a field, and a
// bigger interior globe opens." Space-transform + time-transform in one field,
// composed per-pixel. The lens drifts on its own (alive) and follows the mouse.
const TOKEN = process.env.TOKEN || 'uc_pt_53708babfd4ae7938c4fb270d3031d66a25e9969'
const BRIDGE = process.env.BRIDGE || 'http://localhost:3010/api/engine/bridge'
async function send(token, commands, label) {
  const r = await fetch(BRIDGE, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ commands }) })
  const j = await r.json(); console.log(label, r.status, JSON.stringify(j).slice(0, 170)); return { r, j }
}

const VIS = `
fn gw_map(p: vec3f) -> f32 {
  var q = p - round(p / 2.4) * 2.4;              // domain-repeat: an infinite lattice
  let s = length(q) - 0.34;
  let b = length(max(abs(q) - vec3f(0.11), vec3f(0.0))) - 0.02;   // little struts
  return min(s, b);
}
fn gw_scene(uvv: vec2f, t: f32) -> vec3f {
  let ro = vec3f(sin(t * 0.15) * 0.4, cos(t * 0.11) * 0.3, t * 0.7);
  var rd = normalize(vec3f(uvv, 1.45));
  let a = t * 0.08; let c = cos(a); let sn = sin(a);
  rd = vec3f(rd.x * c - rd.z * sn, rd.y, rd.x * sn + rd.z * c);   // slow yaw
  var tt = 0.0; var glow = vec3f(0.0); var trans = 1.0;
  for (var i = 0; i < 72; i = i + 1) {
    let p = ro + rd * tt;
    let d = gw_map(p);
    let g = 0.0105 / (0.006 + d * d);
    let pal = 0.55 + 0.45 * cos(vec3f(0.0, 0.65, 1.15) + p.z * 0.28 + t * 0.25 + length(p.xy) * 0.4);
    glow += pal * g * trans;
    trans *= 0.988;
    tt += max(d * 0.72, 0.02);
    if (tt > 22.0) { break; }
  }
  glow *= 0.26;
  glow += vec3f(0.010, 0.014, 0.032);            // deep-space floor
  return glow;
}
fn visual_globewarp(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = uni(0);
  var col = gw_scene(uv, t);
  // ── the PORTAL-LENS lawform: warp space (zoom-out) + time (offset) inside a circle ──
  let Lc = vec2f(uni(4), uni(5));
  let R = uni(6);
  let tw = uni(7);
  let d = length(uv - Lc);
  if (d < R) {
    let f = smoothstep(R, 0.0, d);                 // 0 at rim → 1 at center
    let z = mix(1.0, 3.4, f);                       // space-law: see a LARGER world toward the center
    let refr = 1.0 + 0.06 * sin(d * 34.0 - t * 1.5); // subtle glassy refraction near the rim
    let warpUV = (uv - Lc) * z * refr + Lc;
    let inside = gw_scene(warpUV, t + 9.0 + tw * f); // time-law: a different moment inside
    col = mix(col, inside, smoothstep(R, R - 0.02, d));
    col += vec3f(0.30, 0.60, 1.0) * exp(-abs(d - R) * 60.0) * (0.6 + 0.3 * sin(t * 2.0));   // rim glow
    col += vec3f(0.55, 0.8, 1.0) * exp(-abs(d - R) * 240.0) * 0.8;                          // bright edge
  }
  col *= 1.0 - 0.4 * length(uv) * length(uv);      // vignette
  // filmic-ish tonemap
  col = col / (col + vec3f(1.05));
  col = pow(col, vec3f(0.9));
  return vec4f(col, 1.0);
}
`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__gw || wd.__gw.ver !== 1) wd.__gw = { ver: 1, t: 0, lx: 0.0, ly: 0.0, R: 0.44, tw: 7.0 }
  const G = wd.__gw
  G.t += Math.min(dt, 1 / 30)
  const ptr = (wd.input && wd.input.pointer) || {}
  const mxp = (typeof ptr.x === 'number') ? ptr.x : (typeof wd.mouse_x === 'number' ? wd.mouse_x : null)
  const myp = (typeof ptr.y === 'number') ? ptr.y : (typeof wd.mouse_y === 'number' ? wd.mouse_y : null)
  const pressed = !!ptr.pressed || wd.mouse_down === true
  if (pressed && mxp != null && myp != null) {          // grab the lens
    G.lx = mxp / 256 - 1; G.ly = myp / 256 - 1
  } else {                                                // alive: drift on a Lissajous
    G.lx = 0.52 * Math.sin(G.t * 0.31); G.ly = 0.36 * Math.sin(G.t * 0.23 + 1.0)
  }
  // audio: a slow cosmic pad; it brightens as the lens swings through the field
  wd.music_mod = { brightness: 0.28 + 0.42 * (0.5 + 0.5 * Math.sin(G.t * 0.19)) + 0.12 * Math.abs(G.lx), gain: 0.85 }
  const u = []
  u[0] = G.t; u[4] = G.lx; u[5] = G.ly; u[6] = G.R; u[7] = G.tw
  for (let i = 0; i < 8; i++) if (u[i] == null) u[i] = 0
  wd.gpuUniforms = u
} catch (e) {}
`

// reuse the world if it exists, else create it (works local + prod)
let acq = await send(TOKEN, [{ type: 'use_world', slug: 'globewarp' }], 'use_world')
let res = acq.j.results && acq.j.results[0]
if (!res || !res.ok) { acq = await send(TOKEN, [{ type: 'create_world', name: 'Globewarp' }], 'create'); res = acq.j.results && acq.j.results[0] }
const KEY = res && (res.token || (JSON.stringify(res).match(/uc_st_[a-f0-9]+/) || [])[0])
const SLUG = (res && (res.created || res.world)) || 'globewarp'
console.log('world:', SLUG, 'key:', KEY)
await send(KEY, [{ type: 'set_world_data', data: { built_by: 'Claude Opus 4.8', instructions: 'A raymarched cosmos with a portal-lens lawform. The lens warps space and time together; move the mouse to steer it, or watch it drift.' } }], 'meta')
await send(KEY, [{ type: 'define_visual', name: 'globewarp', wgsl: VIS }], 'visual')
await send(KEY, [{ type: 'create_field', name: 'Cosmos', shape: 'rect', x: 256, y: 256, width: 512, height: 512, visualType: 'globewarp', color: [0.02, 0.03, 0.06, 1], noHit: true }], 'field')
await send(KEY, [{ type: 'add_step_hook', hookId: 'globewarp', author: 'Claude Opus 4.8', description: 'Portal-lens lawform: space+time coordinate warp, drifting/steerable', code: HOOK }], 'hook')
console.log('SLUG=' + SLUG)
