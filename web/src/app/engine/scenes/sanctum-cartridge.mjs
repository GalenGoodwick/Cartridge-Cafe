// SANCTUM — a player-space demo. No creatures: the room is the inhabitant.
// A stained-glass arch window lives through a 90-second day/night cycle,
// colored light shafts sweep the stone floor, and a reflecting pool mirrors
// the window procedurally (shared module functions ARE the scenery, so the
// reflection can re-render it mirrored + wobbled — no render target needed).
// The visitor's cursor is a presence: touch the pool → ripples, hover the
// brazier → the fire flares, push the drifting lanterns → they yield.
// This is the kind of living room a player (or their Claude) can author
// into a PlayerSpace: architecture, weather of light, and touch.

const MODULES = /* wgsl */`
// day palette: 0 dawn → .25 noon → .5 dusk → .75 night → 1 dawn
fn mod_skycol(t: f32) -> vec3f {
  let dawn = vec3f(1.0, 0.72, 0.45);
  let noon = vec3f(1.0, 0.97, 0.85);
  let dusk = vec3f(1.0, 0.45, 0.30);
  let night = vec3f(0.30, 0.42, 0.72);
  let x = fract(t) * 4.0;
  if (x < 1.0) { return mix(dawn, noon, smoothstep(0.0, 1.0, x)); }
  if (x < 2.0) { return mix(noon, dusk, smoothstep(0.0, 1.0, x - 1.0)); }
  if (x < 3.0) { return mix(dusk, night, smoothstep(0.0, 1.0, x - 2.0)); }
  return mix(night, dawn, smoothstep(0.0, 1.0, x - 3.0));
}
fn mod_bright(t: f32) -> f32 {
  return 0.30 + 0.70 * (0.5 + 0.5 * cos((fract(t) - 0.25) * 6.28318));
}
// arch window SDF in room uv space: rounded-top opening centered x=0
fn mod_arch(p: vec2f) -> f32 {
  let r = 0.26;
  if (p.y > -0.64) {
    let dx = abs(p.x) - r;
    let dy = max(-0.64 - p.y, p.y + 0.30);
    return max(dx, dy);
  }
  return length(vec2f(p.x, p.y + 0.64)) - r;
}
// stained glass: colored panes + leadwork, lit by the sky
fn mod_glass(p: vec2f, dayT: f32) -> vec4f {
  let d = mod_arch(p);
  if (d > 0.0) { return vec4f(0.0); }
  let sky = mod_skycol(dayT);
  let bright = mod_bright(dayT);
  let ci = vec2f(floor((p.x + 0.26) / 0.174), floor((p.y + 0.90) / 0.15));
  let h = hash21(ci * 7.3 + vec2f(2.0, 5.0));
  let tint = hsv2rgb(vec3f(fract(h * 5.7), 0.55, 1.0));
  var col = tint * sky * (0.7 + 1.7 * bright);
  col *= 0.86 + 0.28 * fbm(p * 18.0, 2);
  let night = 1.0 - smoothstep(0.30, 0.55, bright);
  let sh = hash21(floor(p * 90.0));
  let star = step(0.995, sh) * (0.5 + 0.5 * sin(dayT * 700.0 + sh * 40.0));
  col = mix(col, vec3f(0.05, 0.07, 0.13) + tint * 0.10 + vec3f(0.9) * star, night * 0.85);
  let lx = abs(fract((p.x + 0.26) / 0.174) - 0.5);
  let ly = abs(fract((p.y + 0.90) / 0.15) - 0.5);
  let lead = max(step(0.45, lx), step(0.45, ly));
  col = mix(col, vec3f(0.05, 0.05, 0.06), lead);
  col = mix(col, vec3f(0.10, 0.09, 0.08), smoothstep(-0.02, 0.0, d));
  return vec4f(col, 1.0);
}
// cheap glass for light-projection taps: tint + lead, no fbm/stars
fn mod_glass_lite(p: vec2f, dayT: f32) -> vec4f {
  let d = mod_arch(p);
  if (d > 0.0) { return vec4f(0.0); }
  let sky = mod_skycol(dayT);
  let bright = mod_bright(dayT);
  let ci = vec2f(floor((p.x + 0.26) / 0.174), floor((p.y + 0.90) / 0.15));
  let h = hash21(ci * 7.3 + vec2f(2.0, 5.0));
  var col = hsv2rgb(vec3f(fract(h * 5.7), 0.55, 1.0)) * sky * (0.7 + 1.7 * bright);
  let night = 1.0 - smoothstep(0.30, 0.55, bright);
  col = mix(col, vec3f(0.05, 0.07, 0.13), night * 0.85);
  let lx = abs(fract((p.x + 0.26) / 0.174) - 0.5);
  let ly = abs(fract((p.y + 0.90) / 0.15) - 0.5);
  col = mix(col, vec3f(0.05, 0.05, 0.06), max(step(0.45, lx), step(0.45, ly)));
  return vec4f(col, 1.0);
}
// projective window light: for any point, trace back along the sun direction
// to the window plane and sample the ACTUAL stained glass there. The beam is
// the window's own shape extruded along the sun angle; the floor receives the
// stretched pane pattern (leadwork shadows included); edges blur with travel
// (penumbra) and intensity attenuates. Light and window cannot disagree.
fn mod_beams(p: vec2f, dayT: f32) -> vec3f {
  let bright = mod_bright(dayT);
  let sunx = sin(fract(dayT) * 6.28318) * 0.55;
  var ys = array<f32, 3>(-0.82, -0.60, -0.38);
  var acc = vec3f(0.0);
  for (var i = 0; i < 3; i++) {
    let yw = ys[i];
    let travel = p.y - yw;
    if (travel < 0.0) { continue; }
    let xw = p.x - sunx * travel;
    let blur = 0.008 + travel * 0.045;
    let g1 = mod_glass_lite(vec2f(xw - blur, yw), dayT);
    let g2 = mod_glass_lite(vec2f(xw + blur, yw), dayT);
    acc += (g1.rgb * g1.a + g2.rgb * g2.a) * 0.5 * exp(-travel * 0.50);
  }
  return acc * 0.34 * (0.15 + 0.85 * bright);
}`

// params: [dayT, 0, 0, 0]
const ROOM = /* wgsl */`
fn visual_sanct_room(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let dayT = p.x;
  let flare = p.y;
  let sky = mod_skycol(dayT);
  let bright = mod_bright(dayT);
  var c: vec3f;
  if (uv.y > 0.42) {
    // flagstone floor — rows compress toward the wall (perspective)
    let v = uv.y - 0.42;
    let rc = log(1.0 + v * 5.0) * 6.5;
    let row = floor(rc);
    let cc = uv.x * (2.6 / (0.30 + v)) + hash11(row) * 2.0;
    let colI = floor(cc);
    let mY = smoothstep(0.38, 0.5, abs(fract(rc) - 0.5));
    let mX = smoothstep(0.42, 0.5, abs(fract(cc) - 0.5));
    let stoneH = hash21(vec2f(colI, row));
    c = vec3f(0.165, 0.140, 0.118) * (0.72 + 0.38 * stoneH) * (0.85 + 0.30 * fbm(uv * 9.0, 3));
    c *= 1.0 - 0.45 * max(mY, mX);
  } else {
    // running-bond masonry with weathering and damp streaks
    let by = floor((uv.y + 1.0) * 7.0);
    let bxc = (uv.x + 1.0) * 3.4 + fract(by * 0.5);
    let bh = hash21(vec2f(floor(bxc), by));
    let mY = smoothstep(0.44, 0.5, abs(fract((uv.y + 1.0) * 7.0) - 0.5));
    let mX = smoothstep(0.45, 0.5, abs(fract(bxc) - 0.5));
    c = vec3f(0.118, 0.108, 0.115) * (0.78 + 0.32 * bh) * (0.80 + 0.40 * fbm(uv * 7.0, 3));
    c *= 1.0 - 0.40 * max(mY, mX);
    c *= 1.0 - 0.16 * fbm(vec2f(uv.x * 3.0, uv.y * 1.2) + vec2f(7.0), 2);
  }
  // daylight + sky ambient
  c *= 0.55 + 0.60 * bright;
  c += sky * 0.05 * bright;
  // the window is an area light
  let wl = exp(-max(length(uv - vec2f(0.0, -0.55)) - 0.30, 0.0) * 2.0);
  c += sky * wl * 0.10 * bright;
  // the brazier is a flickering point light (room-space pos of the brazier)
  let bp = uv - vec2f(-0.63, 0.31);
  let flick = 0.85 + 0.15 * sin(time * 9.0) * sin(time * 6.3 + 1.7);
  c += vec3f(1.0, 0.45, 0.14) * exp(-dot(bp, bp) * 3.2) * (0.30 + flare * 0.85) * flick * 0.6;
  // corner occlusion
  c *= 1.0 - 0.35 * dot(uv * 0.78, uv * 0.78);
  // shafts + dust motes drifting in them
  let beams = mod_beams(uv, dayT);
  c += beams;
  let mcell = floor(uv * 60.0);
  let mh = hash21(mcell);
  let mphase = fract(time * 0.12 + mh);
  let mvis = smoothstep(0.0, 0.3, mphase) * smoothstep(1.0, 0.7, mphase);
  c += vec3f(1.0, 0.95, 0.8) * step(0.965, mh) * mvis * length(beams) * 1.4;
  // glass overdraws the wall
  let g = mod_glass(uv, dayT);
  c = mix(c, g.rgb, g.a);
  let ad = mod_arch(uv);
  c *= 1.0 - 0.22 * smoothstep(0.07, 0.0, abs(ad - 0.03));
  // stone sill under the window
  let sill = smoothstep(0.014, 0.005, abs(uv.y + 0.278)) * step(abs(uv.x), 0.315);
  c = mix(c, vec3f(0.17, 0.16, 0.15) * (0.5 + 0.9 * bright), sill * 0.9);
  // static grain
  c += (hash21(floor(uv * 420.0)) - 0.5) * 0.012;
  return vec4f(c, 1.0);
}`

// params: [dayT, tSeconds, 0, 0] — mirrors the window/beams via the shared module
const POOL = /* wgsl */`
fn visual_sanct_pool(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let dayT = p.x;
  let t = p.y;
  let flare = p.z;
  let sky = mod_skycol(dayT);
  let bright = mod_bright(dayT);
  let roomP = vec2f(uv.x, 0.707 + uv.y * 0.293);
  let wob = sin(roomP.y * 42.0 + t * 1.7) * 0.010 + sin(roomP.y * 23.0 - t * 1.1) * 0.006;
  let rp = vec2f(roomP.x + wob, 0.414 - (roomP.y - 0.414) * 1.9);
  var c = vec3f(0.028, 0.042, 0.058) + sky * 0.05 * bright;
  // fresnel: the far edge reflects hard, the near water shows its floor
  let reflAmp = mix(0.62, 0.20, smoothstep(-1.0, 1.0, uv.y));
  let g = mod_glass(rp, dayT);
  c += g.rgb * g.a * reflAmp;
  c += mod_beams(rp, dayT) * reflAmp;
  // submerged stones refracted near the viewer
  let fl = fbm(vec2f(uv.x * 6.0 + sin(uv.y * 14.0 + t) * 0.15, uv.y * 3.0) + vec2f(3.0), 3);
  c += vec3f(0.105, 0.092, 0.075) * fl * smoothstep(-0.2, 1.0, uv.y) * 0.55 * (0.3 + 0.7 * bright);
  // crossing wave shading
  c *= 1.0 + sin(uv.x * 30.0 + t * 1.3) * sin(uv.y * 18.0 - t * 0.9) * 0.05;
  // the brazier's warmth shimmers on the water
  let warm = exp(-pow((uv.x + 0.62) * 4.0, 2.0)) * (0.10 + flare * 0.30);
  c += vec3f(1.2, 0.50, 0.18) * warm * (0.75 + 0.25 * sin(uv.y * 40.0 + t * 3.5));
  c *= mix(1.0, 0.55, smoothstep(-1.0, 1.0, uv.y));
  let scell = floor(vec2f(uv.x * 90.0, uv.y * 26.0));
  let sh2 = hash21(scell);
  let sphase = fract(t * (0.5 + sh2 * 0.8) + sh2 * 9.0);
  let svis = smoothstep(0.0, 0.35, sphase) * smoothstep(1.0, 0.65, sphase);
  c += sky * step(0.992, sh2) * svis * 0.55 * bright;
  c += sky * smoothstep(0.05, 0.0, abs(uv.y + 0.97)) * 0.30;
  return vec4f(c, 1.0);
}`

// params: [age01, active, 0, 0]
const RIPPLE = /* wgsl */`
fn visual_sanct_ripple(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  if (p.y < 0.5) { return vec4f(0.0); }
  let age = clamp(p.x, 0.0, 1.0);
  let d = length(uv);
  let r = 0.08 + age * 0.85;
  let ring = exp(-pow((d - r) * 26.0, 2.0));
  let ring2 = exp(-pow((d - r * 0.55) * 30.0, 2.0)) * 0.6;
  let a = (ring + ring2) * (1.0 - age);
  return vec4f(vec3f(0.75, 0.92, 1.0) * 1.2 * a, clamp(a, 0.0, 1.0));
}`

// params: [flare01, 0, 0, 0]
const BRAZIER = /* wgsl */`
fn visual_sanct_brazier(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let flare = clamp(p.x, 0.0, 1.0);
  let q = uv;
  var c = vec3f(0.0);
  var a = 0.0;
  // iron bowl
  let bowl = abs(length(vec2f(q.x, max(q.y - 0.30, 0.0) * 1.4)) - 0.42) - 0.09;
  if (bowl < 0.0 && q.y > 0.18) {
    c = vec3f(0.10, 0.08, 0.07) * (0.9 + q.y * 0.6);
    a = 1.0;
  }
  // flame
  let n = fbm(vec2f(q.x * 3.0, q.y * 2.5 - time * 2.4), 3);
  let fy = q.y - 0.12;
  let fd = length(vec2f(q.x * 1.7, fy + 0.1)) - (0.30 + flare * 0.16) + fy * 0.55 + n * 0.22;
  if (fd < 0.0) {
    let heat = clamp(-fd * 3.0, 0.0, 1.0);
    c = mix(vec3f(1.4, 0.45, 0.08), vec3f(1.9, 1.55, 0.70), heat) * (1.1 + flare * 0.9);
    a = max(a, 0.95);
  }
  // sparks
  let scell = floor(vec2f(q.x * 14.0, q.y * 14.0 + time * (3.0 + flare * 3.0)));
  if (hash21(scell) > 0.986 && q.y < 0.2) {
    c += vec3f(1.6, 0.8, 0.3);
    a = max(a, 0.8);
  }
  // warm halo
  let halo = exp(-dot(q, q) * 2.2) * (0.25 + flare * 0.55);
  c += vec3f(1.2, 0.5, 0.15) * halo;
  a = max(a, clamp(halo, 0.0, 1.0) * 0.8);
  return vec4f(c, a);
}`

// params: [phase, push01, 0, 0]
const LANTERN = /* wgsl */`
fn visual_sanct_lantern(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let q = uv * vec2f(1.0, 0.85);
  var c = vec3f(0.0);
  var a = 0.0;
  let body = length(q * vec2f(1.25, 1.0)) - 0.52;
  if (body < 0.0) {
    let flick = 0.85 + 0.15 * sin(time * 6.0 + p.x * 9.0);
    let core = exp(-dot(q, q) * 2.6);
    c = mix(vec3f(0.90, 0.45, 0.15), vec3f(1.5, 1.05, 0.55), core) * flick;
    c *= 1.0 - 0.18 * step(0.42, abs(fract(q.y * 5.0) - 0.5));
    c = mix(c, vec3f(0.35, 0.15, 0.05), smoothstep(-0.06, 0.0, body));
    a = 1.0;
  }
  if (abs(uv.x) < 0.15 && uv.y < -0.50 && uv.y > -0.64) {
    c = vec3f(0.10, 0.08, 0.06);
    a = 1.0;
  }
  let halo = exp(-dot(uv, uv) * 3.5);
  c += vec3f(1.1, 0.7, 0.3) * halo * (0.35 + p.y * 0.3);
  a = max(a, halo * 0.5);
  return vec4f(c, a);
}`

// params: [dayT, seed, 0, 0]
const VINE = /* wgsl */`
fn visual_sanct_vine(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  var c = vec3f(0.0);
  var a = 0.0;
  let bright = mod_bright(p.x);
  for (var s = 0; s < 5; s++) {
    let fs = f32(s) + p.y * 4.0;
    let x0 = -0.75 + f32(s) * 0.375;
    let hang = (uv.y + 1.0) * 0.5;
    let sway = sin(time * 0.55 + fs * 1.9) * 0.16 * hang * hang;
    let dx = abs(uv.x - x0 - sway);
    let lenS = 0.55 + hash11(fs + 3.0) * 0.40;
    let on = step(hang, lenS);
    let strand = smoothstep(0.020, 0.007, dx) * on;
    c = max(c, vec3f(0.10, 0.30, 0.14) * strand);
    a = max(a, strand * 0.9);
    let seg = fract(hang * 6.0 + fs * 0.7);
    let bulge = smoothstep(0.055, 0.012, dx) * step(0.40, seg) * step(seg, 0.60) * on;
    c = max(c, vec3f(0.13, 0.40, 0.17) * bulge);
    a = max(a, bulge);
  }
  c *= 0.55 + 0.65 * bright;
  return vec4f(c, a);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__sanct || wd.__sanct.v !== 1) wd.__sanct = { v: 1, t: 0, flare: 0, cool: 0, lant: {} }
  const G = wd.__sanct
  G.t += dt
  const dayT = (G.t / 90) % 1
  let room = null, pool = null, brazier = null
  const ripples = [], lanterns = [], vines = []
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Room')) room = f
    else if (n.startsWith('Pool')) pool = f
    else if (n.startsWith('Brazier')) brazier = f
    else if (n.startsWith('Ripple')) ripples.push(f)
    else if (n.startsWith('Lantern')) lanterns.push(f)
    else if (n.startsWith('Vine')) vines.push(f)
  }
  const T = f => f.transform
  // pin the architecture — boundary physics must never nudge the room
  if (room) { T(room).x = 256; T(room).y = 256; T(room).vx = 0; T(room).vy = 0 }
  if (pool) { T(pool).x = 256; T(pool).y = 437; T(pool).vx = 0; T(pool).vy = 0 }
  if (room) room.visualParams = [dayT, G.flare, 0, 0]
  if (pool) pool.visualParams = [dayT, G.t, G.flare, 0]
  for (let i = 0; i < vines.length; i++) vines[i].visualParams = [dayT, i * 0.37, 0, 0]

  const mx = wd.mouse_x
  const my = wd.mouse_y
  const hasMouse = typeof mx === 'number' && typeof my === 'number'

  // ── pool ripples on touch ──
  G.cool = Math.max(0, G.cool - dt)
  if (hasMouse && wd.mouse_down && my > 366 && G.cool <= 0) {
    const slot = ripples.find(r => (r.properties.get('age') ?? 1) >= 1)
    if (slot) {
      T(slot).x = mx
      T(slot).y = Math.max(372, my)
      slot.properties.set('age', 0)
      G.cool = 0.22
    }
  }
  for (const r of ripples) {
    let age = r.properties.get('age')
    if (age === undefined) age = 1
    age = Math.min(1, age + dt / 1.4)
    r.properties.set('age', age)
    r.visualParams = [age, age < 1 ? 1 : 0, 0, 0]
  }

  // ── brazier flares when the cursor warms it ──
  if (brazier) {
    let want = 0
    if (hasMouse) {
      const bd = Math.hypot(mx - T(brazier).x, my - T(brazier).y)
      if (bd < 75) want = 1
    }
    G.flare += (want - G.flare) * Math.min(1, dt * 3)
    brazier.visualParams = [G.flare, 0, 0, 0]
  }

  // ── lanterns drift, and yield to the cursor ──
  for (let i = 0; i < lanterns.length; i++) {
    const f = lanterns[i]
    if (!G.lant[f.name]) G.lant[f.name] = { px: 0, py: 0 }
    const S = G.lant[f.name]
    S.px *= Math.pow(0.25, dt)
    S.py *= Math.pow(0.25, dt)
    if (hasMouse) {
      const dxm = T(f).x - mx, dym = T(f).y - my
      const dm = Math.hypot(dxm, dym)
      if (dm < 60 && dm > 0.01) {
        S.px += (dxm / dm) * 140 * dt
        S.py += (dym / dm) * 140 * dt
      }
    }
    let vx = Math.sin(G.t * 0.31 + i * 2.3) * 4 + S.px
    let vy = Math.sin(G.t * 0.50 + i * 1.7) * 5 + S.py
    if (T(f).x < 130) vx += 8
    if (T(f).x > 430) vx -= 8
    if (T(f).y < 80) vy += 8
    if (T(f).y > 300) vy -= 8
    T(f).vx = vx
    T(f).vy = vy
    f.visualParams = [i * 1.3, Math.min(1, Math.hypot(S.px, S.py) / 40), 0, 0]
  }
} catch (e) { /* keep the room alive */ }
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
  name: 'SANCTUM',
  fields: [
    field('sanct_room', 'Room', [0.1, 0.1, 0.11, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'sanct_room', [0, 0, 0, 0]),
    field('sanct_vine_1', 'Vine 1', [0.1, 0.3, 0.15, 1], 78, 108, { shapeType: 'rect', w: 150, h: 230 }, 'sanct_vine', [0, 0, 0, 0]),
    field('sanct_vine_2', 'Vine 2', [0.1, 0.3, 0.15, 1], 434, 108, { shapeType: 'rect', w: 150, h: 230 }, 'sanct_vine', [0, 0.5, 0, 0]),
    field('sanct_brazier', 'Brazier', [1, 0.5, 0.1, 1], 95, 335, { shapeType: 'circle', radius: 55 }, 'sanct_brazier', [0, 0, 0, 0]),
    field('sanct_lantern_1', 'Lantern 1', [1, 0.7, 0.3, 1], 210, 150, { shapeType: 'circle', radius: 34 }, 'sanct_lantern', [0, 0, 0, 0]),
    field('sanct_lantern_2', 'Lantern 2', [1, 0.7, 0.3, 1], 300, 115, { shapeType: 'circle', radius: 34 }, 'sanct_lantern', [1.3, 0, 0, 0]),
    field('sanct_lantern_3', 'Lantern 3', [1, 0.7, 0.3, 1], 385, 185, { shapeType: 'circle', radius: 34 }, 'sanct_lantern', [2.6, 0, 0, 0]),
    field('sanct_pool', 'Pool', [0.05, 0.08, 0.1, 1], 256, 437, { shapeType: 'rect', w: 512, h: 150 }, 'sanct_pool', [0, 0, 0, 0]),
    field('sanct_ripple_1', 'Ripple 1', [0.8, 0.95, 1, 1], 30, 470, { shapeType: 'circle', radius: 42 }, 'sanct_ripple', [1, 0, 0, 0]),
    field('sanct_ripple_2', 'Ripple 2', [0.8, 0.95, 1, 1], 60, 470, { shapeType: 'circle', radius: 42 }, 'sanct_ripple', [1, 0, 0, 0]),
    field('sanct_ripple_3', 'Ripple 3', [0.8, 0.95, 1, 1], 90, 470, { shapeType: 'circle', radius: 42 }, 'sanct_ripple', [1, 0, 0, 0]),
    field('sanct_ripple_4', 'Ripple 4', [0.8, 0.95, 1, 1], 120, 470, { shapeType: 'circle', radius: 42 }, 'sanct_ripple', [1, 0, 0, 0]),
  ],
  worldParams: { gravity: 0, friction: 0.92, collisionForce: 0, boundaryMode: 'open', bounciness: 0.4, gravitationalConstant: 0 },
  worldData: {
    postProcess: { bloomIntensity: 0.30, bloomThreshold: 0.70, exposure: 1.05, vignetteStrength: 0.35, vignetteRadius: 0.8 },
  },
  stepHooks: [{ id: 'sanct_core', author: 'fable', description: 'SANCTUM: day cycle, cursor ripples, brazier flare, pushable lanterns', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'sanct_room', wgsl: ROOM },
    { name: 'sanct_vine', wgsl: VINE },
    { name: 'sanct_brazier', wgsl: BRAZIER },
    { name: 'sanct_lantern', wgsl: LANTERN },
    { name: 'sanct_pool', wgsl: POOL },
    { name: 'sanct_ripple', wgsl: RIPPLE },
  ],
  modules: [{ name: 'sanct_lib', wgsl: MODULES }],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'SANCTUM', scene }),
})
console.log('SANCTUM saved:', res.status, await res.text())
