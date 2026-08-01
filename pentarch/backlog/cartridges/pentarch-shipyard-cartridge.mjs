// PENTARCH SHIPYARD — the designer (v1). Galen's UX on the proven math:
// hover a free edge → GHOST (only if the SAT oracle allows) · click ghost →
// BLANK tile, selected · click a tile → select it · click the palette → fill /
// replace the part · voids glow gold as frustration seals them · cost is live.
// Single-player world; the design persists in worldData (the cafe saves it).
const TOKEN = Deno.env.get('GW_TOKEN') || ''
const BRIDGE = 'https://cartridge.cafe/api/engine/bridge'
async function send(token, commands, label) {
  const r = await fetch(BRIDGE, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ commands }) })
  let j; try { j = await r.json() } catch { j = { parseError: true } }
  console.log(label, r.status, JSON.stringify(j).slice(0, 150)); return j
}

const VIS = `
fn py_rot(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(p.x * c + p.y * s, -p.x * s + p.y * c); }
fn py_pent(p0: vec2f, r: f32, th: f32) -> f32 {
  // regular pentagon SDF (circumradius r, rotation th) via 5-fold angular fold
  var p = py_rot(p0, th - 1.5707963);
  let an = 0.6283185;
  let a = atan2(p.y, p.x) + an * 0.5;
  let sector = floor(a / an);
  p = py_rot(p, -(sector * an + an * 0.5) + 1.5707963);
  return p.y - r * 0.809017;   // apothem = r·cos(36°)
}
fn py_col(part: i32) -> vec3f {
  if (part == 1) { return vec3f(0.36, 0.50, 0.65); }      // hull
  if (part == 2) { return vec3f(0.54, 0.58, 0.65); }      // armor
  if (part == 3) { return vec3f(1.00, 0.48, 0.42); }      // gun
  if (part == 4) { return vec3f(0.48, 0.86, 1.00); }      // engine
  if (part == 5) { return vec3f(0.62, 1.00, 0.54); }      // gen
  return vec3f(0.30, 0.36, 0.46);                          // blank
}
fn visual_shipyard(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = uni(0);
  let S = uni(7);                                          // world scale (units→uv)
  var col = vec3f(0.024, 0.030, 0.048);
  col += vec3f(0.006, 0.010, 0.016) * (0.5 + 0.5 * sin(uv.y * 3.0 + t * 0.1));
  // faint dock grid
  let gr = abs(fract(uv.x * 6.0) - 0.5) * abs(fract(uv.y * 6.0) - 0.5);
  col += vec3f(0.010, 0.014, 0.022) * smoothstep(0.24, 0.25, gr);
  let n = popCount();
  let R = S * 0.85065;                                     // tile circumradius in uv
  for (var i = 0; i < n; i = i + 1) {
    let e = pop(i);                                        // x, y (uv), th, code
    let code = i32(e.w);
    let kind = code % 100;                                 // 0..5 part · 60 ghost · 70 void
    let flags = code / 100;                                // 1 = selected
    let d = py_pent(uv - e.xy, R, e.z);
    if (kind == 70) {                                      // VOID — a gold diamond glint
      let vd = length(uv - e.xy);
      col += vec3f(1.0, 0.85, 0.45) * exp(-vd * vd * 2600.0) * (0.8 + 0.3 * sin(t * 2.4));
      col += vec3f(1.0, 0.82, 0.4) * exp(-abs(vd - 0.016) * 300.0) * 0.35;
      continue;
    }
    if (kind == 60) {                                      // GHOST — translucent breath
      let g = smoothstep(0.004, -0.004, d);
      col = mix(col, vec3f(0.55, 0.75, 1.0), g * (0.16 + 0.07 * sin(t * 3.0)));
      col += vec3f(0.55, 0.8, 1.0) * exp(-abs(d) * 220.0) * 0.35;
      continue;
    }
    let body = smoothstep(0.003, -0.003, d);
    let base = py_col(kind);
    col = mix(col, base * 0.34 + vec3f(0.03, 0.04, 0.07), body);
    col += base * exp(-abs(d) * 260.0) * 0.9;              // rim
    if (flags == 1) {                                      // selected: bright halo
      col += vec3f(1.0, 0.95, 0.7) * exp(-abs(d) * 130.0) * (0.5 + 0.2 * sin(t * 4.0));
    }
    if (kind == 0) {                                       // blank: hatched pulse
      col += vec3f(0.5, 0.6, 0.8) * body * (0.10 + 0.08 * sin(uv.x * 90.0 + uv.y * 90.0 + t * 2.0));
    }
  }
  // ── palette strip (5 part pentagons, bottom) ──
  for (var s = 0; s < 5; s = s + 1) {
    let cxp = -0.52 + f32(s) * 0.26;
    let d = py_pent(uv - vec2f(cxp, 0.86), 0.075, 0.0);
    let base = py_col(s + 1);
    let body = smoothstep(0.004, -0.004, d);
    col = mix(col, base * 0.4, body * 0.9);
    col += base * exp(-abs(d) * 240.0) * 0.8;
  }
  // pointer glint
  let gp = vec2f(uni(8), uni(9));
  if (uni(10) > 0.5) {
    let gd = length(uv - gp);
    col += vec3f(0.7, 0.88, 1.0) * (exp(-gd * gd * 1400.0) * 0.7 + exp(-abs(gd - 0.03) * 240.0) * 0.4);
  }
  col *= 1.0 - 0.30 * dot(uv, uv);
  col = col / (col + vec3f(1.0));
  return vec4f(pow(col, vec3f(0.9)), 1.0);
}`

const HOOK = String.raw`
try {
  const wd = sim.worldData
  // ── penta math (inlined from the tested core) ──
  const AP = 1 / (2 * Math.tan(Math.PI / 5)), CR = 1 / (2 * Math.sin(Math.PI / 5)), ST = 2 * Math.PI / 5
  const ena = (t, e) => t.th + Math.PI / 2 + (e + 0.5) * ST
  const attach = (t, e) => { const n = ena(t, e); return { cx: t.cx + 2 * AP * Math.cos(n), cy: t.cy + 2 * AP * Math.sin(n), th: n + Math.PI / 2 - Math.PI / 5 } }
  const verts = (t) => { const o = []; for (let k = 0; k < 5; k++) { const a = t.th + Math.PI / 2 + k * ST; o.push({ x: t.cx + CR * Math.cos(a), y: t.cy + CR * Math.sin(a) }) } return o }
  const shrink = (t) => verts(t).map(v => ({ x: v.x + (t.cx - v.x) * 1e-4, y: v.y + (t.cy - v.y) * 1e-4 }))
  const axes = (vs) => { const o = []; for (let i = 0; i < 5; i++) { const a = vs[i], b = vs[(i + 1) % 5]; const nx = -(b.y - a.y), ny = b.x - a.x, L = Math.hypot(nx, ny); o.push({ x: nx / L, y: ny / L }) } return o }
  const overlaps = (t1, t2) => {
    if (Math.hypot(t1.cx - t2.cx, t1.cy - t2.cy) > 2 * CR) return false
    const v1 = shrink(t1), v2 = shrink(t2)
    for (const ax of axes(v1).concat(axes(v2))) {
      let a1 = Infinity, b1 = -Infinity, a2 = Infinity, b2 = -Infinity
      for (const v of v1) { const p = v.x * ax.x + v.y * ax.y; if (p < a1) a1 = p; if (p > b1) b1 = p }
      for (const v of v2) { const p = v.x * ax.x + v.y * ax.y; if (p < a2) a2 = p; if (p > b2) b2 = p }
      if (b1 < a2 || b2 < a1) return false
    }
    return true
  }
  const COST = { 0: 0, 1: 10, 2: 18, 3: 30, 4: 22, 5: 26 }
  const NAME = ['BLANK', 'HULL', 'ARMOR', 'GUN', 'ENGINE', 'GEN']

  if (!wd.__pd) wd.__pd = { tree: [{ parent: -1, edge: -1, part: 1 }], sel: 0, rev: 0, t: 0 }
  const D = wd.__pd
  D.t += Math.min(dt, 1 / 30)

  // layout (cached per rev)
  if (D.rev !== D.layoutRev) {
    const tiles = [{ cx: 0, cy: 0, th: 0 }]
    for (let i = 1; i < D.tree.length; i++) { const d = D.tree[i]; tiles.push(attach(tiles[d.parent], d.edge)) }
    // contacts → used edges
    const used = new Set()
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      if (Math.hypot(tiles[i].cx - tiles[j].cx, tiles[i].cy - tiles[j].cy) > 2 * AP + 0.01) continue
      for (let ei = 0; ei < 5; ei++) for (let ej = 0; ej < 5; ej++) {
        const na = ena(tiles[i], ei), nb = ena(tiles[j], ej)
        const ma = { x: tiles[i].cx + AP * Math.cos(na), y: tiles[i].cy + AP * Math.sin(na) }
        const mb = { x: tiles[j].cx + AP * Math.cos(nb), y: tiles[j].cy + AP * Math.sin(nb) }
        if (Math.hypot(ma.x - mb.x, ma.y - mb.y) < 1e-3) { used.add(i + ':' + ei); used.add(j + ':' + ej) }
      }
    }
    // legal ghosts
    const ghosts = []
    for (let i = 0; i < tiles.length; i++) for (let e = 0; e < 5; e++) {
      if (used.has(i + ':' + e)) continue
      const g = attach(tiles[i], e)
      let bad = false
      for (const t of tiles) if (overlaps(g, t)) { bad = true; break }
      if (!bad) ghosts.push({ i, e, g })
    }
    // voids: coincident vertices, 360 - n·108 in (1°,108°)
    const pts = []
    tiles.forEach((t, i) => verts(t).forEach(v => pts.push({ i, x: v.x, y: v.y })))
    const voids = []
    const seen = new Set()
    for (let a = 0; a < pts.length; a++) {
      if (seen.has(a)) continue
      const cl = [pts[a]]; seen.add(a)
      for (let b = a + 1; b < pts.length; b++) { if (!seen.has(b) && Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) < 1e-3) { cl.push(pts[b]); seen.add(b) } }
      const gap = 360 - 108 * cl.length
      if (cl.length >= 2 && gap > 1 && gap < 108) {
        let dx = 0, dy = 0
        for (const p of cl) { const t = tiles[p.i]; dx += t.cx - p.x; dy += t.cy - p.y }
        const L = Math.hypot(dx, dy) || 1
        voids.push({ x: pts[a].x - dx / L * 0.22, y: pts[a].y - dy / L * 0.22 })
      }
    }
    D.tilesL = tiles; D.ghostsL = ghosts; D.voidsL = voids; D.layoutRev = D.rev
  }
  const tiles = D.tilesL, ghosts = D.ghostsL, voids = D.voidsL

  // ── view transform: fit the hull ──
  let mx = 0, my = 0, ex = 1
  for (const t of tiles) { mx += t.cx; my += t.cy }
  mx /= tiles.length; my /= tiles.length
  for (const t of tiles) ex = Math.max(ex, Math.hypot(t.cx - mx, t.cy - my) + 1.2)
  const S = Math.min(0.17, 0.78 / ex)
  const toUV = (x, y) => ({ x: (x - mx) * S, y: (y - my) * S })

  // ── input ──
  const ptr = (wd.input && wd.input.pointer) || {}
  const mxp = (typeof ptr.x === 'number') ? ptr.x : wd.mouse_x
  const myp = (typeof ptr.y === 'number') ? ptr.y : wd.mouse_y
  const ux = (typeof mxp === 'number') ? mxp / 256 - 1 : null
  const uy = (typeof myp === 'number') ? myp / 256 - 1 : null
  const click = sim.edge('yard-click', !!ptr.down || wd.mouse_down === true)

  // hover: nearest legal ghost (in uv space)
  let hover = -1, hd = 0.10
  if (ux != null && uy < 0.74) for (let k = 0; k < ghosts.length; k++) {
    const p = toUV(ghosts[k].g.cx, ghosts[k].g.cy)
    const d = Math.hypot(p.x - ux, p.y - uy)
    if (d < hd) { hd = d; hover = k }
  }
  // nearest tile (for select)
  let tSel = -1, td = 0.09
  if (ux != null) for (let i = 0; i < tiles.length; i++) {
    const p = toUV(tiles[i].cx, tiles[i].cy)
    const d = Math.hypot(p.x - ux, p.y - uy)
    if (d < td) { td = d; tSel = i }
  }

  if (click && ux != null) {
    if (uy > 0.76) {                                        // palette strip
      const s = Math.round((ux + 0.52) / 0.26)
      if (s >= 0 && s <= 4 && D.sel >= 0) {
        D.tree[D.sel].part = s + 1
        wd.__play_sound = [{ frequency: 500 + s * 90, duration: 0.08, volume: 0.12, type: 'sine' }]
      }
    } else if (tSel >= 0) {                                 // select a tile
      D.sel = tSel
      wd.__play_sound = [{ frequency: 340, duration: 0.05, volume: 0.08, type: 'sine' }]
    } else if (hover >= 0) {                                // grow a BLANK at the ghost
      D.tree.push({ parent: ghosts[hover].i, edge: ghosts[hover].e, part: 0 })
      D.sel = D.tree.length - 1
      D.rev++
      wd.__play_sound = [{ frequency: 700, duration: 0.05, volume: 0.10, type: 'sine' }, { frequency: 980, duration: 0.06, volume: 0.07, type: 'sine' }]
    }
  }
  if (sim.edge('yard-reset', !!wd.key_r)) { wd.__pd = null; return }

  // ── publish ──
  const out = []
  for (let i = 0; i < tiles.length; i++) {
    const p = toUV(tiles[i].cx, tiles[i].cy)
    out.push(p.x, p.y, tiles[i].th, (D.tree[i].part) + (i === D.sel ? 100 : 0))
  }
  if (hover >= 0) { const p = toUV(ghosts[hover].g.cx, ghosts[hover].g.cy); out.push(p.x, p.y, ghosts[hover].g.th, 60) }
  for (const v of voids) { const p = toUV(v.x, v.y); out.push(p.x, p.y, 0, 70) }
  wd.gpuPopulation = out
  let cost = 0; for (const d of D.tree) cost += COST[d.part] || 0
  const u = []
  u[0] = D.t; u[7] = S
  if (ux != null) { u[8] = ux; u[9] = uy; u[10] = 1 } else { u[10] = 0 }
  for (let i = 0; i < 16; i++) if (u[i] == null) u[i] = 0
  wd.gpuUniforms = u
  const selName = NAME[D.tree[D.sel] ? D.tree[D.sel].part : 1]
  wd.hud = [
    { id: 'yt', type: 'text', x: '3%', y: '5%', text: 'PENTARCH SHIPYARD', fontSize: '14px', color: '#cfe0f5' },
    { id: 'yc', type: 'text', x: '3%', y: '9%', text: 'COST ' + cost + '  ·  TILES ' + tiles.length + '  ·  VOIDS ' + voids.length, fontSize: '12px', color: '#9fd8ff' },
    { id: 'ys', type: 'text', x: '3%', y: '13%', text: 'SELECTED: ' + selName + '  (click palette to set)', fontSize: '11px', color: '#ffd479' },
    { id: 'yh', type: 'text', x: '3%', y: '93%', text: 'hover an edge → ghost · click → grow · R restarts', fontSize: '11px', color: '#7b8daa' },
    { id: 'p1', type: 'text', x: '24%', y: '97%', text: 'HULL', fontSize: '10px', color: '#8fb0d8' },
    { id: 'p2', type: 'text', x: '37%', y: '97%', text: 'ARMOR', fontSize: '10px', color: '#a8b0bd' },
    { id: 'p3', type: 'text', x: '50%', y: '97%', text: 'GUN', fontSize: '10px', color: '#ff9d94' },
    { id: 'p4', type: 'text', x: '62%', y: '97%', text: 'ENGINE', fontSize: '10px', color: '#9fdfff' },
    { id: 'p5', type: 'text', x: '75%', y: '97%', text: 'GEN', fontSize: '10px', color: '#b5ffa8' },
  ]
} catch (e) { }
`

const acq = await send(TOKEN, [{ type: 'use_world', slug: 'pentarch' }], 'use_world')
let res = acq.results && acq.results[0]
if (!res || res.ok === false) { const c = await send(TOKEN, [{ type: 'create_world', name: 'PENTARCH' }], 'create'); res = c.results && c.results[0] }
const KEY = res.token || (JSON.stringify(res).match(/uc_st_[a-f0-9]+/) || [])[0]
const SLUG = res.created || res.world || 'pentarch'
console.log('world:', SLUG, 'key:', KEY)
await send(KEY, [{ type: 'set_world_data', data: { built_by: 'Claude (Fable · P)', singlePlayer: true, vision: 'A quiet orbital dock: one luminous pentagon under a faint grid, ghosts breathing at its edges. Hulls grow tile by tile, curving as pentagon frustration demands; sealed frustration glints gold (voids). Palette of five part-pentagons along the dock rail.', instructions: 'PENTARCH SHIPYARD — design a hull from pentagon tiles.\n\nHover near a free edge: a ghost appears (only where a tile can legally sit). Click the ghost to grow a BLANK tile. Click any tile to select it; click a palette pentagon (bottom) to set its part: HULL, ARMOR, GUN, ENGINE, GEN.\n\nPentagons cannot tile flat — your hull WILL curve. Seal the frustration and the gaps glint gold: voids, the special slots. R restarts.\n\nThe design persists. Fleets built here will fight in PENTARCH (coming).' } }], 'meta')
await send(KEY, [{ type: 'define_visual', name: 'shipyard', wgsl: VIS }], 'visual')
await send(KEY, [{ type: 'create_field', name: 'Dock', shape: 'rect', x: 256, y: 256, width: 512, height: 512, visualType: 'shipyard', color: [0.02, 0.03, 0.05, 1], noHit: true }], 'field')
await send(KEY, [{ type: 'add_step_hook', hookId: 'yard', author: 'Claude (Fable · P)', description: 'the designer: ghost/blank/palette/select on the tested penta math; voids glow live', code: HOOK }], 'hook')
console.log('SLUG=' + SLUG)
