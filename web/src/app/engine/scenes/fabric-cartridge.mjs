// FABRIC — the sky behind curved space. Real thin-lens gravitational optics:
// every mass bends the background by β = θ − θE²/θ, so Einstein rings, arcs and
// doubled stars happen because the math says so, not because they were painted.
//
//   move mouse — a lens rides your cursor, dragging curvature across the sky
//   W/S        — grow / shrink your lens
//   SPACE      — anchor a mass where you point (sends a gravitational ripple)
//   SHIFT      — remove the last anchor · ENTER — spacetime grid on/off
//   A/D        — chromatic dispersion (light splits at the well edges)
//
// Whiteboard: 0 anchors · 1/2 mouseXY · 3 mouseMass · 4 grid01 · 5 chroma ·
//             6 rippleT · 7/8 rippleXY · 9.. anchors, stride 3: x, y, mass
// Save+load: node fabric-cartridge.mjs

const WORLD = /* wgsl */`
fn fb_bg(p: vec2f, t: f32) -> vec3f {
  // the unlensed sky: nebula, dust, two starfield depths
  var c = vec3f(0.010, 0.008, 0.022);

  // nebula — indigo body, rose folds, gold filaments
  let q = p * 1.6 + vec2f(0.3, -0.2);
  let n1 = fbm(q + vec2f(t * 0.004, 0.0), 5);
  let n2 = fbm(q * 2.3 + vec2f(7.0, 3.0) - vec2f(0.0, t * 0.003), 4);
  c += vec3f(0.10, 0.05, 0.28) * smoothstep(0.35, 0.85, n1) * 1.1;
  c += vec3f(0.30, 0.08, 0.22) * smoothstep(0.55, 0.9, n1 * 0.6 + n2 * 0.6) * 0.9;
  c += vec3f(0.55, 0.38, 0.12) * pow(smoothstep(0.62, 0.95, n2), 2.0) * 0.8;
  // dark dust lane
  c *= 1.0 - 0.55 * smoothstep(0.55, 0.8, fbm(q * 1.3 + vec2f(21.0, 13.0), 4));

  // stars — two depths, hue-varied, twinkling
  for (var l = 0; l < 2; l++) {
    let fl = f32(l);
    let sp = p * (14.0 + fl * 26.0) + fl * 31.0;
    let cell = floor(sp);
    let h = hash21(cell);
    let h2 = hash21(cell + 91.0);
    let fp = fract(sp) - 0.5 + (vec2f(h, h2) - 0.5) * 0.6;
    let star = step(0.982 - fl * 0.006, h) * smoothstep(0.24, 0.02, length(fp));
    let tw = 0.55 + 0.45 * sin(t * (0.6 + h * 1.6) + h * 40.0);
    let hue = mix(vec3f(0.75, 0.82, 1.05), vec3f(1.05, 0.85, 0.6), h2);
    c += hue * star * tw * (1.4 - fl * 0.5);
  }
  return c;
}

fn fb_mass(i: i32) -> vec3f { return vec3f(uni(9 + i * 3), uni(10 + i * 3), uni(11 + i * 3)); }

// total lens deflection: sample the sky at beta = theta - sum(m_i * d_i / r_i^2)
fn fb_beta(uv: vec2f, mScale: f32, t: f32) -> vec2f {
  var beta = uv;
  let nA = i32(uni(0));
  for (var i = 0; i < 9; i++) {
    if (i >= nA) { break; }
    let m = fb_mass(i);
    let d = uv - m.xy;
    let r2 = max(dot(d, d), 0.0004);
    beta -= d * (m.z * mScale) / r2;
  }
  // the cursor lens
  let md = uv - vec2f(uni(1), uni(2));
  let mr2 = max(dot(md, md), 0.0004);
  beta -= md * (uni(3) * mScale) / mr2;
  // gravitational ripple from the last anchor drop
  let rt = uni(6);
  if (rt < 4.0) {
    let ro = uv - vec2f(uni(7), uni(8));
    let rr = length(ro);
    let wave = sin((rr - rt * 0.9) * 26.0) * exp(-pow((rr - rt * 0.9) * 3.2, 2.0)) * exp(-rt * 1.1);
    beta += (ro / max(rr, 0.01)) * wave * 0.02;
  }
  return beta;
}

fn visual_fb_world(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  let chroma = uni(5) * 0.08;

  // lensed sky, with dispersion: each color feels gravity slightly differently
  let bR = fb_beta(uv, 1.0 - chroma, t);
  let bG = fb_beta(uv, 1.0, t);
  let bB = fb_beta(uv, 1.0 + chroma, t);
  var col = vec3f(fb_bg(bR, t).r, fb_bg(bG, t).g, fb_bg(bB, t).b);

  // spacetime grid, drawn in SOURCE coordinates — lines funnel into the wells
  let g01 = uni(4);
  if (g01 > 0.01) {
    let gc = bG * 7.0;
    let gx = smoothstep(0.06, 0.0, abs(fract(gc.x) - 0.5) - 0.44);
    let gy = smoothstep(0.06, 0.0, abs(fract(gc.y) - 0.5) - 0.44);
    col += vec3f(0.10, 0.22, 0.28) * max(gx, gy) * g01 * 0.8;
  }

  // the masses themselves: dark cores wearing hot photon rings
  let nA = i32(uni(0));
  for (var i = 0; i < 10; i++) {
    var m: vec3f;
    var held = false;
    if (i < nA) { m = fb_mass(i); }
    else if (i == nA) { m = vec3f(uni(1), uni(2), uni(3)); held = true; }
    else { break; }
    if (m.z < 0.0005) { continue; }
    let r = length(uv - m.xy);
    let rs = sqrt(m.z) * 0.55;                 // event-horizon scale from the Einstein radius
    col = mix(col, vec3f(0.0), smoothstep(rs, rs * 0.55, r));
    var ringCol = vec3f(3.2, 2.1, 1.0);
    if (held) { ringCol = vec3f(1.2, 2.6, 3.2); }
    let flick = 0.85 + 0.15 * sin(t * 5.0 + f32(i) * 9.0 + r * 40.0);
    col += ringCol * exp(-pow((r - rs * 1.18) * (34.0 / max(rs, 0.02)) * rs, 2.0) * 3.0) * flick;
    // faint accretion shimmer just outside the ring
    let sh = exp(-pow((r - rs * 1.7) * 8.0 / max(rs, 0.05), 2.0));
    col += vec3f(0.5, 0.3, 0.15) * sh * (0.4 + 0.3 * sin(t * 1.3 + atan2(uv.y - m.y, uv.x - m.x + 1e-5) * 3.0 - t));
  }

  // NaN scrub — nothing poisoned may reach the bloom
  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.01, 0.01, 0.02); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(60.0)), 1.0);
}`

// ─────────────────────────────────────────────────────────────────────────────
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__fb) wd.__fb = {
    anchors: [], mx: 0, my: 0, ms: 0.012,
    grid: 0, gridT: 0, chroma: 0.35, rippleT: 99, rx: 0, ry: 0, prev: {},
  }
  const F = wd.__fb
  const dt2 = Math.min(dt, 0.05)
  const pressed = k => { const now = !!wd['key_' + k]; const was = !!F.prev[k]; F.prev[k] = now; return now && !was }

  // cursor -> lens (normalized field coords, smooth pursuit)
  const tx = ((wd.mouse_x ?? 256) - 256) / 256
  const ty = ((wd.mouse_y ?? 256) - 256) / 256
  F.mx += (tx - F.mx) * Math.min(1, dt2 * 10)
  F.my += (ty - F.my) * Math.min(1, dt2 * 10)

  // W/S: lens mass (exponential feel)
  if (wd.key_w) F.ms = Math.min(0.12, F.ms * (1 + 1.6 * dt2))
  if (wd.key_s) F.ms = Math.max(0.001, F.ms * (1 - 1.6 * dt2))
  // A/D: dispersion
  if (wd.key_d) F.chroma = Math.min(1, F.chroma + 0.8 * dt2)
  if (wd.key_a) F.chroma = Math.max(0, F.chroma - 0.8 * dt2)

  // SPACE: anchor the current lens; the fabric rings like a bell
  if (pressed('space') && F.anchors.length < 9) {
    F.anchors.push({ x: F.mx, y: F.my, m: F.ms })
    F.rippleT = 0; F.rx = F.mx; F.ry = F.my
  }
  if (pressed('shift') && F.anchors.length > 0) F.anchors.pop()
  if (pressed('enter')) F.grid = 1 - F.grid
  F.gridT += ((F.grid ? 1 : 0) - F.gridT) * Math.min(1, dt2 * 4)
  F.rippleT += dt2

  // anchored masses waltz slowly about the center — the bending never sleeps
  const spin = 0.05 * dt2
  for (const a of F.anchors) {
    const c = Math.cos(spin), s = Math.sin(spin)
    const x = a.x * c - a.y * s, y = a.x * s + a.y * c
    a.x = x; a.y = y
  }

  const u = [F.anchors.length, F.mx, F.my, F.ms, F.gridT, F.chroma, F.rippleT, F.rx, F.ry]
  for (const a of F.anchors) u.push(a.x, a.y, a.m)
  wd.gpuUniforms = u

  let world = null
  for (const f of sim.fields.values()) if ((f.name || '').startsWith('FABRIC')) world = f
  if (world) {
    world.name = 'FABRIC \\u00b7 ' + F.anchors.length + ' masses \\u00b7 lens ' + F.ms.toFixed(3) +
      ' \\u00b7 move mouse \\u00b7 SPACE anchor \\u00b7 W/S mass \\u00b7 A/D chroma \\u00b7 ENTER grid \\u00b7 SHIFT undo'
  }
} catch (e) { /* keep the sim alive */ }
`

const scene = {
  name: 'FABRIC',
  fields: [
    {
      id: 'fb_world_f', name: 'FABRIC · move mouse · SPACE anchor · W/S mass · A/D chroma · ENTER grid',
      color: [0.02, 0.02, 0.05, 1],
      effects: [], memory: [], proximity: [], properties: {},
      transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
      shapeType: 'rect', w: 512, h: 512,
      visualTypeName: 'fb_world',
    },
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: { noPixelSampling: true },
  stepHooks: [{ id: 'fabric_core', author: 'fable', description: 'FABRIC: cursor-driven gravitational lens, anchored masses, ripples', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'fb_world', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'FABRIC', scene }),
})
console.log('FABRIC saved:', res.status, await res.text())
