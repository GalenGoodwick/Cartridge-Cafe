// PENTARCH ARENA v0 — the battle skeleton (multiplayer via the arena stack).
// Each seat: a scout ship (3-pentagon cluster) steering to its cursor. Three
// capture points; holding one uncontested ticks income. Scoreboard live.
// v1 adds combat (per-tile damage) · v2 adds the in-match shipyard phase.
const TOKEN = Deno.env.get('GW_TOKEN') || ''
const BRIDGE = 'https://cartridge.cafe/api/engine/bridge'
async function send(token, commands, label) {
  const r = await fetch(BRIDGE, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ commands }) })
  let j; try { j = await r.json() } catch { j = {} }
  console.log(label, r.status, JSON.stringify(j).slice(0, 140)); return j
}

const VIS = `
fn pa_rot(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(p.x * c + p.y * s, -p.x * s + p.y * c); }
fn pa_pent(p0: vec2f, rc: f32, th: f32) -> f32 {
  var p = pa_rot(p0, th); p = vec2f(p.x, -p.y);
  let kx = 0.809016994; let ky = 0.587785252; let kz = 0.726542528;
  let ra = rc * kx;
  p.x = abs(p.x);
  p = p - 2.0 * min(dot(vec2f(-kx, ky), p), 0.0) * vec2f(-kx, ky);
  p = p - 2.0 * min(dot(vec2f(kx, ky), p), 0.0) * vec2f(kx, ky);
  p = p - vec2f(clamp(p.x, -ra * kz, ra * kz), ra);
  return length(p) * sign(p.y);
}
fn pa_hue(s: f32) -> vec3f { return 0.55 + 0.45 * cos(6.2831853 * (s * 0.381966) + vec3f(0.0, 2.1, 4.2)); }
fn visual_parena(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = uni(0);
  var col = vec3f(0.016, 0.020, 0.036);
  let gr = abs(fract(uv.x * 5.0) - 0.5) * abs(fract(uv.y * 5.0) - 0.5);
  col += vec3f(0.008, 0.011, 0.018) * smoothstep(0.24, 0.25, gr);
  let n = popCount();
  for (var i = 0; i < n; i = i + 1) {
    let e = pop(i);
    let code = i32(e.w);
    if (code >= 200) {                                   // capture point: ring, owner-tinted
      let owner = code - 200;                             // 0 = neutral, 1..8 = seat+1
      let d = length(uv - e.xy);
      var oc = vec3f(0.5, 0.6, 0.75);
      if (owner > 0) { oc = pa_hue(f32(owner - 1)); }
      let R = e.z;
      col += oc * exp(-abs(d - R) * 90.0) * (0.7 + 0.2 * sin(t * 2.0 + e.x * 7.0));
      col += oc * exp(-d * d / (R * R)) * 0.10;
      continue;
    }
    // ship tile: pentagon, seat hue (code 1..8 = seat+1), th in z
    let hue = pa_hue(f32(code - 1));
    let d = pa_pent(uv - e.xy, 0.045, e.z);
    let body = smoothstep(0.003, -0.003, d);
    col = mix(col, hue * 0.35 + vec3f(0.03, 0.05, 0.08), body);
    col += hue * exp(-abs(d) * 300.0) * 0.9;
  }
  col *= 1.0 - 0.30 * dot(uv, uv);
  col = col / (col + vec3f(1.0));
  return vec4f(pow(col, vec3f(0.9)), 1.0);
}`

const HOOK = String.raw`
try {
  const wd = sim.worldData
  const players = wd.players
  if (!Array.isArray(players)) return                     // arena-room only
  if (!wd.__pa) wd.__pa = { ships: {}, inc: {}, t: 0, pts: [{ x: 0, y: -0.62 }, { x: -0.58, y: 0.42 }, { x: 0.58, y: 0.42 }], own: [0, 0, 0] }
  const A = wd.__pa
  A.t += dt
  const cl = (v, a, b) => Math.max(a, Math.min(b, v))
  // ships: one scout per seat — a 3-tile wedge steering to the cursor
  const seated = new Set()
  for (const p of players) {
    const s = p.seat
    if (s == null || s > 7) continue
    seated.add(s)
    if (!A.ships[s]) A.ships[s] = { x: (s % 2 ? 0.7 : -0.7), y: (s < 2 ? -0.1 : 0.5), vx: 0, vy: 0, a: 0 }
    const sh = A.ships[s]
    const tx = (typeof p.mouse_x === 'number' ? p.mouse_x : 256) / 256 - 1
    const ty = (typeof p.mouse_y === 'number' ? p.mouse_y : 256) / 256 - 1
    const dx = tx - sh.x, dy = ty - sh.y, d = Math.hypot(dx, dy) + 1e-4
    sh.vx = sh.vx * 0.88 + (dx / d) * Math.min(1, d * 5) * 0.09
    sh.vy = sh.vy * 0.88 + (dy / d) * Math.min(1, d * 5) * 0.09
    sh.x = cl(sh.x + sh.vx * dt * 6, -0.95, 0.95)
    sh.y = cl(sh.y + sh.vy * dt * 6, -0.95, 0.95)
    if (Math.hypot(sh.vx, sh.vy) > 0.01) sh.a = Math.atan2(sh.vy, sh.vx) - Math.PI / 2
    if (A.inc[s] == null) A.inc[s] = 0
  }
  for (const s of Object.keys(A.ships)) if (!seated.has(+s)) delete A.ships[s]
  // capture: nearest sole occupant within radius owns the point; owners tick income
  const R = 0.16
  for (let i = 0; i < 3; i++) {
    const pt = A.pts[i]
    let inRange = []
    for (const s of Object.keys(A.ships)) { const sh = A.ships[s]; if (Math.hypot(sh.x - pt.x, sh.y - pt.y) < R) inRange.push(+s) }
    if (inRange.length === 1) {
      const s = inRange[0]
      if (A.own[i] !== s + 1) { A.own[i] = s + 1; wd.__play_sound = [{ frequency: 520 + i * 80, duration: 0.2, volume: 0.16, type: 'sine' }] }
    } else if (inRange.length > 1) { A.own[i] = 0 }        // contested: neutral
    if (A.own[i] > 0) A.inc[A.own[i] - 1] = (A.inc[A.own[i] - 1] || 0) + dt * 2
  }
  // publish
  const out = []
  for (let i = 0; i < 3; i++) out.push(A.pts[i].x, A.pts[i].y, 0.16, 200 + A.own[i])
  for (const s of Object.keys(A.ships)) {
    const sh = A.ships[s], code = (+s) + 1
    out.push(sh.x, sh.y, sh.a, code)                                                    // nose
    const b = sh.a + Math.PI / 2
    out.push(sh.x - Math.cos(b) * 0.075 - Math.sin(b) * 0.045, sh.y - Math.sin(b) * 0.075 + Math.cos(b) * 0.045, sh.a, code)
    out.push(sh.x - Math.cos(b) * 0.075 + Math.sin(b) * 0.045, sh.y - Math.sin(b) * 0.075 - Math.cos(b) * 0.045, sh.a, code)
  }
  wd.gpuPopulation = out
  const u = []; u[0] = A.t; for (let i = 0; i < 16; i++) if (u[i] == null) u[i] = 0
  wd.gpuUniforms = u
  const board = Object.keys(A.inc).map(s => ({ s: +s, v: Math.floor(A.inc[s]) })).sort((a, b) => b.v - a.v).slice(0, 4)
  wd.hud = [
    { id: 'pt', type: 'text', x: '3%', y: '5%', text: 'PENTARCH ARENA — hold the rings', fontSize: '13px', color: '#cfe0f5' },
    ...board.map((b, i) => ({ id: 'sc' + i, type: 'text', x: '3%', y: (9 + i * 4) + '%', text: 'CMDR ' + (b.s + 1) + ' — ' + b.v + '⬡', fontSize: '12px', color: '#9fd8ff' })),
  ]
} catch (e) {}
`

const c = await send(TOKEN, [{ type: 'create_world', name: 'PENTARCH ARENA' }], 'create')
const res = c.results && c.results[0]
const KEY = res.token || (JSON.stringify(res).match(/uc_st_[a-f0-9]+/) || [])[0]
const SLUG = res.created
console.log('world:', SLUG, 'key:', KEY)
if (!KEY) Deno.exit(1)
await send(KEY, [{ type: 'set_world_data', data: { mpManifest: { type: 'rts', capacity: 6 }, built_by: 'Claude (Fable · P)', vision: 'A dark tactical field under a faint grid: three luminous capture rings in a triangle, each tinted by its holder. Pentagon scout-wedges in commander colors sweep between them.', instructions: 'PENTARCH ARENA (v0 skeleton) — everyone here is really here.\n\nSteer your scout with the mouse. Hold a ring ALONE to capture it; captured rings tick income (⬡). Contested rings go neutral.\n\nCombat and the shipyard phase are coming: the fleets you design at /space/pentarch will fight here.' } }], 'meta')
await send(KEY, [{ type: 'define_visual', name: 'parena', wgsl: VIS }], 'visual')
await send(KEY, [{ type: 'create_field', name: 'Field', shape: 'rect', x: 256, y: 256, width: 512, height: 512, visualType: 'parena', color: [0.015, 0.02, 0.035, 1], noHit: true }], 'field')
await send(KEY, [{ type: 'add_step_hook', hookId: 'battle', author: 'Claude (Fable · P)', description: 'battle skeleton: scouts to cursor, 3 capture rings, sole-holder income, scoreboard', code: HOOK }], 'hook')
console.log('SLUG=' + SLUG)
