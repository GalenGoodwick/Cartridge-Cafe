// GOLDEN HOUR — a raymarched dusk sea, authored for the superimposed uber-shader.
// A heightfield ocean (exp-sine crests + fbm chop) marched by bisection, analytic
// wave normals, Fresnel sky reflection, HDR sun-glitter, subsurface glow on the
// crests that face the sun, aerial perspective into the horizon.
//
// The sun lives on the whiteboard so it can breathe: a step hook drifts its
// elevation and azimuth, so the light, the reflection, and the glitter all move
// together — golden hour that never quite ends.
//
//   Whiteboard: uni0 sunAz · uni1 sunEl
//   Output is linear HDR — the engine's ACES + bloom grade it. Do NOT tonemap here.
//   Save+load: node goldenhour-cartridge.mjs   (then open /engine, pick GOLDEN HOUR)

const WORLD = /* wgsl */`
// ── ocean height: directional swell with sharpened (exp-sine) crests + fbm chop ──
fn gh_h(pxz: vec2f, t: f32, octn: i32) -> f32 {
  var h = 0.0;
  var amp = 0.60;
  var freq = 0.16;
  var dir = normalize(vec2f(1.0, 0.35));
  let R = mat2x2f(0.80, 0.60, -0.60, 0.80);
  for (var i = 0; i < octn; i++) {
    let d = dot(pxz, dir);
    let w = exp(sin(d * freq + t * (1.0 + f32(i) * 0.28)) - 1.0);
    h += amp * w;
    dir = R * dir;
    freq = freq * 1.75;
    amp = amp * 0.56;
  }
  h += (fbm(pxz * 0.35 + vec2f(t * 0.09, t * 0.05), 4) - 0.5) * 0.5;
  return h;
}
fn gh_map(p: vec3f, t: f32, octn: i32) -> f32 { return p.y - gh_h(p.xz, t, octn); }
fn gh_nrm(p: vec3f, eps: f32, t: f32) -> vec3f {
  let hy = gh_map(p, t, 5);
  let hx = gh_map(p + vec3f(eps, 0.0, 0.0), t, 5);
  let hz = gh_map(p + vec3f(0.0, 0.0, eps), t, 5);
  return normalize(vec3f(hx - hy, eps, hz - hy));
}

// ── sky: warm horizon → cool zenith, sun glow + HDR disk, drifting cloud band ──
fn gh_sky(rd: vec3f, sd: vec3f, t: f32) -> vec3f {
  let y = max(rd.y, 0.0);
  var c = mix(vec3f(1.05, 0.60, 0.32), vec3f(0.10, 0.24, 0.52), pow(y, 0.42));
  c += vec3f(0.55, 0.27, 0.10) * exp(-max(rd.y, 0.0) * 8.0);        // horizon warmth
  let sdot = clamp(dot(rd, sd), 0.0, 1.0);
  c += vec3f(1.2, 0.72, 0.42) * pow(sdot, 6.0) * 0.7;               // glow
  c += vec3f(6.0, 4.4, 3.0) * smoothstep(0.9994, 0.9998, sdot);     // disk (HDR)
  if (rd.y > 0.015) {
    let cp = rd.xz / (rd.y + 0.14) * 1.5 + vec2f(t * 0.012, t * 0.004);
    var cl = fbm(cp * 0.6, 4);
    cl = smoothstep(0.46, 0.90, cl) * smoothstep(0.0, 0.28, rd.y);
    let cloudCol = mix(vec3f(0.90, 0.50, 0.40), vec3f(1.25, 0.95, 0.80), sdot);
    c = mix(c, cloudCol, cl * 0.55);
  }
  return c;
}

// ── water shading (linear HDR out) ──
fn gh_seacol(p: vec3f, n: vec3f, rd: vec3f, sd: vec3f, dist: vec3f, t: f32) -> vec3f {
  var refl = reflect(rd, n); refl.y = max(refl.y, 0.02);
  let reflCol = gh_sky(refl, sd, t);

  var fres = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  fres = mix(0.03, 1.0, fres);

  let deep    = vec3f(0.015, 0.075, 0.11);
  let shallow = vec3f(0.10, 0.30, 0.34);
  var base = mix(deep, shallow, pow(clamp(n.y, 0.0, 1.0), 3.0));

  // subsurface glow on crests turned toward the sun
  var sss = clamp(0.55 + p.y * 0.4, 0.0, 1.0) * pow(max(dot(rd, -sd), 0.0), 2.0);
  base += vec3f(0.16, 0.32, 0.24) * sss * 0.7;

  var col = mix(base, reflCol, fres);

  // sharp HDR sun glitter
  let hlf = normalize(sd - rd);
  let spec = pow(max(dot(n, hlf), 0.0), 240.0);
  col += vec3f(5.0, 3.9, 2.6) * spec;

  // foam on the highest crests
  let foamN = vnoise(p.xz * 2.2 + vec2f(t * 0.5, -t * 0.35));
  let crest = smoothstep(1.15, 1.70, p.y) * smoothstep(0.45, 0.85, foamN);
  col = mix(col, vec3f(0.92, 0.94, 0.95), crest * 0.40);
  return col;
}

fn visual_gh_sea(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let p = vec2f(uv.x, -uv.y);   // compute path has y inverted
  let t = time;

  // camera: eye above the water, a slow heave and a lazy sway
  let bob = sin(t * 0.5) * 0.06;
  let ro = vec3f(0.0, 2.40 + bob, 0.0);
  var rd = normalize(vec3f(p.x, p.y * 0.70 - 0.12, 1.60));
  let rxy = rotate(rd.xy, sin(t * 0.30) * 0.010);
  rd = normalize(vec3f(rxy.x, rxy.y, rd.z));

  // sun off the whiteboard, with a low golden-hour fallback before the hook runs
  var az = uni(0);
  var el = uni(1);
  if (el < 0.001) { el = 0.085; az = 1.15; }
  let sd = normalize(vec3f(cos(az) * cos(el), sin(el), sin(az) * cos(el)));

  var col = gh_sky(rd, sd, t);

  // ── ocean: bisection trace against the height field ──
  if (rd.y < 0.0) {
    var tm = 0.0;
    var tx = 800.0;
    var hx = gh_map(ro + rd * tx, t, 3);
    if (hx < 0.0) {
      var hm = gh_map(ro, t, 3);
      var tmid = 0.0;
      for (var i = 0; i < 8; i++) {
        tmid = mix(tm, tx, hm / (hm - hx));
        let hmid = gh_map(ro + rd * tmid, t, 3);
        if (hmid < 0.0) { tx = tmid; hx = hmid; } else { tm = tmid; hm = hmid; }
      }
      let pt = ro + rd * tmid;
      let dist = pt - ro;
      let dl = length(dist);
      let eps = max(dl * dl * 0.00015, 0.003);
      var n = gh_nrm(pt, eps, t);
      n = normalize(mix(n, vec3f(0.0, 1.0, 0.0), clamp(dl / 200.0, 0.0, 0.80)));  // calm the far shimmer
      let seaCol = gh_seacol(pt, n, rd, sd, dist, t);
      let fog = 1.0 - exp(-dl * 0.010);                       // aerial perspective
      let haze = gh_sky(vec3f(rd.x, 0.003, rd.z), sd, t);
      col = mix(seaCol, haze, fog);
    }
  }

  return vec4f(col, 1.0);   // linear HDR — engine grades it
}`

// ─────────────────────────────────────────────────────────────────────────────
// The living sun: breathe elevation + azimuth onto the whiteboard.
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__gh) wd.__gh = { t: 0 }
  const S = wd.__gh
  S.t += Math.min(dt, 0.05)                        // hidden-tab dt spikes can't jolt the sun
  const el = 0.10 + Math.sin(S.t * 0.030) * 0.055  // 0.045 .. 0.155 — always low, always golden
  const az = 1.15 + Math.sin(S.t * 0.012) * 0.20
  wd.gpuUniforms = [az, el]
} catch (e) { /* keep the sim alive */ }
`

const field = (id, name, color, x, y, shape, visualTypeName) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
})

const scene = {
  name: 'GOLDEN HOUR',
  fields: [
    field('gh_sea_f', 'Golden Hour', [0.9, 0.55, 0.3, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'gh_sea'),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    postProcess: { bloomIntensity: 0.42, bloomThreshold: 0.70, exposure: 1.0, vignetteStrength: 0.32, vignetteRadius: 0.72 },
  },
  stepHooks: [{ id: 'gh_sun', author: 'claude', description: 'GOLDEN HOUR: breathe the sun az/el onto the whiteboard.', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'gh_sea', wgsl: WORLD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'GOLDEN HOUR', scene }),
})
console.log('GOLDEN HOUR saved:', res.status, await res.text())
