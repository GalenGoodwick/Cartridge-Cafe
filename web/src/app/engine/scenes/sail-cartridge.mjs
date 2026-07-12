// SAIL — boat and water, daylight, nothing else.
// The loop is closed both ways through the whiteboard:
//   water → boat: the hook runs the SAME wave function as the GPU (gnoise port),
//                 samples the sea under the hull, and the boat heaves + pitches with the real swell.
//   boat → water: the ocean height field reads the boat position and carves its bow wave,
//                 Kelvin arms, and foam trail.
// One shared clock (uni 7) keeps CPU water and GPU water in exact phase.
//
// Whiteboard: uni0 sunAz · uni1 sunEl · uni2 wind01 · uni3 boatX · uni4 dir(+1/-1)
//             uni5 boatY(heave) · uni6 pitch(rad) · uni7 seaTime
// Save+load: node sail-cartridge.mjs

const WORLD = /* wgsl */`
fn sl_suncol() -> vec3f { return vec3f(1.15, 1.05, 0.88); }

fn sl_sky(rd: vec3f, sd: vec3f, t: f32) -> vec3f {
  let y = max(rd.y, 0.0);
  var c = mix(vec3f(0.50, 0.62, 0.74), vec3f(0.16, 0.38, 0.68), pow(y, 0.62));
  let sdot = clamp(dot(rd, sd), 0.0, 1.0);
  c += sl_suncol() * pow(sdot, 5.0) * 0.28;
  c += sl_suncol() * pow(sdot, 70.0) * 0.55;
  c += vec3f(5.0, 4.2, 3.0) * smoothstep(0.99972, 0.99990, sdot);
  if (rd.y > 0.015) {
    let cp = rd.xz / (rd.y + 0.14) * 1.4 + vec2f(t * 0.006, t * 0.002);
    var cl = fbm(cp * 0.55, 4);
    cl = smoothstep(0.48, 0.80, cl);
    c = mix(c, vec3f(0.94, 0.94, 0.96), cl * 0.7 * smoothstep(0.015, 0.10, rd.y));
  }
  return c;
}

fn sl_oct(uv0: vec2f, choppy: f32) -> f32 {
  let n = gnoise(uv0);
  let uv = uv0 + vec2f(n, n);
  var wv = 1.0 - abs(sin(uv));
  let swv = abs(cos(uv));
  wv = mix(wv, swv, wv);
  return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);
}

// boat → water: wake geometry read off the whiteboard
fn sl_wake(pxz: vec2f) -> f32 {
  let d = vec2f(pxz.x - uni(3), pxz.y - 20.0);
  let along = -d.x * uni(4);
  if (along < -3.0 || along > 24.0 || abs(d.y) > 10.0) { return 0.0; }
  let a = max(along, 0.0);
  var w = exp(-dot(d, d) * 0.30) * 0.85;
  let arm = exp(-pow((abs(d.y) - 0.36 * a) * 1.1, 2.0)) * exp(-a * 0.11);
  let inside = smoothstep(0.36 * a + 1.0, 0.36 * a - 1.0, abs(d.y));
  let ripple = sin(a * 2.4) * 0.5 * inside * exp(-a * 0.14);
  return w + arm * 0.9 + ripple;
}

fn sl_amp() -> f32 { return 0.55 + 0.75 * uni(2); }

fn sl_map3(p: vec3f, st: f32) -> f32 {
  var freq = 0.16;
  var amp = 0.6 * sl_amp();
  var choppy = 4.0;
  var uv = p.xz;
  uv.x = uv.x * 0.75;
  var h = 0.0;
  for (var i = 0; i < 3; i++) {
    var d = sl_oct((uv + vec2f(st)) * freq, choppy);
    d = d + sl_oct((uv - vec2f(st)) * freq, choppy);
    h = h + d * amp;
    uv = mat2x2f(1.6, 1.2, -1.2, 1.6) * uv;
    freq = freq * 1.9;
    amp = amp * 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  h = h + sl_wake(p.xz) * 0.24;
  return p.y - h;
}

fn sl_map5(p: vec3f, st: f32) -> f32 {
  var freq = 0.16;
  var amp = 0.6 * sl_amp();
  var choppy = 4.0;
  var uv = p.xz;
  uv.x = uv.x * 0.75;
  var h = 0.0;
  for (var i = 0; i < 5; i++) {
    var d = sl_oct((uv + vec2f(st)) * freq, choppy);
    d = d + sl_oct((uv - vec2f(st)) * freq, choppy);
    h = h + d * amp;
    uv = mat2x2f(1.6, 1.2, -1.2, 1.6) * uv;
    freq = freq * 1.9;
    amp = amp * 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  h = h + sl_wake(p.xz) * 0.24;
  return p.y - h;
}

fn sl_nrm(p: vec3f, eps: f32, st: f32) -> vec3f {
  let hy = sl_map5(p, st);
  let hx = sl_map5(p + vec3f(eps, 0.0, 0.0), st);
  let hz = sl_map5(p + vec3f(0.0, 0.0, eps), st);
  return normalize(vec3f(hx - hy, eps, hz - hy));
}

fn sl_spec(n: vec3f, l: vec3f, e: vec3f, s: f32) -> f32 {
  let nrm = (s + 8.0) / (3.14159 * 8.0);
  return pow(max(dot(reflect(e, n), l), 0.0), s) * nrm;
}

fn sl_seacol(p: vec3f, n: vec3f, sd: vec3f, eye: vec3f, dist: vec3f, t: f32, st: f32) -> vec3f {
  var fres = clamp(1.0 - dot(n, -eye), 0.0, 1.0);
  fres = pow(fres, 3.0) * 0.5;
  let reflected = sl_sky(reflect(eye, n), sd, t);
  let base = vec3f(0.035, 0.075, 0.11);
  let waterCol = vec3f(0.16, 0.24, 0.22);
  let refracted = base + pow(dot(n, sd) * 0.4 + 0.6, 80.0) * waterCol * 0.12;
  var col = mix(refracted, reflected, fres);

  let atten = max(1.0 - dot(dist, dist) * 0.001, 0.0);
  col = col + waterCol * (p.y - 0.6) * 0.18 * atten;
  col = col + sl_suncol() * vec3f(2.2, 1.6, 1.0) * sl_spec(n, sd, eye, 90.0);

  let foamN = vnoise(p.xz * 2.2 + vec2f(t * 0.5, -t * 0.35));
  let crest = smoothstep(1.05, 1.55, p.y) * smoothstep(0.42, 0.85, foamN);
  col = mix(col, vec3f(0.92, 0.94, 0.95), crest * atten * 0.45);

  // churned white water along the wake
  let wk = sl_wake(p.xz);
  let wkN = 0.55 + 0.45 * vnoise(p.xz * 3.0 + vec2f(st * 1.2, -st * 0.8));
  col = mix(col, vec3f(0.88, 0.91, 0.92), clamp(wk * wkN - 0.10, 0.0, 1.0) * 0.6);
  return col;
}

fn sl_cr(u: vec2f, v: vec2f) -> f32 { return u.x * v.y - u.y * v.x; }
fn sl_tri(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> f32 {
  let w1 = min(min(sl_cr(b - a, p - a), sl_cr(c - b, p - b)), sl_cr(a - c, p - c));
  let w2 = min(min(sl_cr(c - a, p - a), sl_cr(b - c, p - c)), sl_cr(a - b, p - b));
  return max(w1, w2);   // positive inside for either winding — mirror-proof
}

fn visual_sl_world(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let p = vec2f(uv.x, -uv.y);
  let t = time;
  var st = uni(7);
  if (st < 0.5) { st = 1.0 + t * 0.8; }

  let bob = sin(t * 0.5) * 0.05;
  let ro = vec3f(0.0, 3.4 + bob, 0.0);
  var rd = normalize(vec3f(p.x, p.y * 0.72 - 0.14, 1.75));
  let rxy = rotate(rd.xy, sin(t * 0.35) * 0.010);
  rd = normalize(vec3f(rxy.x, rxy.y, rd.z));

  let saz = uni(0);
  let sel = uni(1);
  let sd = normalize(vec3f(cos(saz) * cos(sel), sin(sel), sin(saz) * cos(sel)));

  var col = sl_sky(rd, sd, t);
  var tScene = 100000.0;

  // ---- ocean ----
  if (rd.y < 0.0) {
    var tm = 0.0;
    var tx = 1000.0;
    var hx = sl_map3(ro + rd * tx, st);
    if (hx < 0.0) {
      var hm = sl_map3(ro, st);
      var tmid = 0.0;
      for (var i = 0; i < 8; i++) {
        tmid = mix(tm, tx, hm / (hm - hx));
        let pm = ro + rd * tmid;
        let hmid = sl_map3(pm, st);
        if (hmid < 0.0) { tx = tmid; hx = hmid; } else { tm = tmid; hm = hmid; }
      }
      let pt = ro + rd * tmid;
      let dist = pt - ro;
      let eps = max(dot(dist, dist) * 0.0002, 0.002);
      let n = sl_nrm(pt, eps, st);
      let seaCol = sl_seacol(pt, n, sd, rd, dist, t, st);
      let seaBlend = pow(1.0 - smoothstep(-0.02, 0.0, rd.y), 0.2);
      col = mix(col, seaCol, seaBlend);
      tScene = tmid;
    }
  }

  // ---- the sloop: heave + pitch come FROM the water, via the whiteboard ----
  let B = vec3f(uni(3), uni(5), 20.0);
  let toB = B - ro;
  let bDist = length(toB);
  let bDir = toB / bDist;
  if (dot(rd, bDir) > 0.90 && tScene > bDist - 2.0) {
    var right = normalize(cross(vec3f(0.0, 1.0, 0.0), bDir));
    if (right.x < 0.0) { right = -right; }        // +x is +x, no debate
    var upv = cross(bDir, right);
    if (upv.y < 0.0) { upv = -upv; }              // the sky is up, no debate
    let par = dot(rd, bDir);
    var lq = vec2f(dot(rd, right) / par * bDist, dot(rd, upv) / par * bDist);
    lq = rotate(lq, -uni(6) * uni(4));        // pitch with the swell
    let q = vec2f(lq.x * uni(4), lq.y);       // face the direction of travel

    var bc = vec3f(0.0);
    var hitB = false;

    // hull: side profile with curved keel and bow taper
    if (abs(q.x) < 2.3 && q.y > -0.62 && q.y < 0.40) {
      let xn = q.x / 2.3;
      let keel = -0.58 + 0.30 * xn * xn + 0.12 * max(xn, 0.0);
      let deck = 0.36 - 0.07 * xn * xn + 0.05 * max(xn, 0.0);
      if (q.y > keel && q.y < deck) {
        bc = vec3f(0.055, 0.065, 0.085) * (0.8 + 0.5 * clamp(sd.x * sign(q.x), 0.0, 1.0));
        if (q.y > 0.02 && q.y < 0.11) { bc = vec3f(0.80, 0.78, 0.72); }   // boot stripe
        hitB = true;
      }
    }
    // cabin
    if (q.x > -1.05 && q.x < 0.15 && q.y > 0.36 && q.y < 0.60) {
      bc = vec3f(0.72, 0.70, 0.64);
      hitB = true;
    }
    // mast
    if (abs(q.x - 0.42) < 0.05 && q.y > 0.36 && q.y < 5.35) {
      bc = vec3f(0.10, 0.09, 0.08);
      hitB = true;
    }
    // mainsail (aft of the mast)
    let dm = sl_tri(q, vec2f(0.38, 5.25), vec2f(-1.95, 0.92), vec2f(0.38, 0.80));
    if (dm > 0.0) {
      let lit = 0.72 + 0.45 * clamp(-sd.x * uni(4), 0.0, 1.0);
      bc = vec3f(0.94, 0.91, 0.83) * lit;
      hitB = true;
    }
    // jib (forestay to bow)
    let dj = sl_tri(q, vec2f(0.50, 4.95), vec2f(0.58, 0.75), vec2f(2.28, 0.55));
    if (dj > 0.0) {
      let lit = 0.66 + 0.45 * clamp(-sd.x * uni(4), 0.0, 1.0);
      bc = vec3f(0.90, 0.87, 0.79) * lit;
      hitB = true;
    }
    if (hitB) { col = bc; }
  }

  return vec4f(col, 1.0);
}`

// ─────────────────────────────────────────────────────────────────────────────
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__sail) wd.__sail = { t: 20, by: 0.9, vy: 0, pit: 0, vp: 0 }
  const S = wd.__sail
  S.t += dt
  const st = 1 + S.t * 0.8
  const WIND = 0.45

  // === the same wave function the GPU runs (gnoise port, matched constants) ===
  const fract = x => x - Math.floor(x)
  function hash22(px, py) {
    let x = fract(px * 0.1031), y = fract(py * 0.1030), z = fract(px * 0.0973)
    const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33)
    x += d; y += d; z += d
    return [fract((x + y) * z), fract((x + z) * y)]
  }
  function gnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y)
    const fx = x - ix, fy = y - iy
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
    const g = (cx, cy) => {
      const h = hash22(ix + cx, iy + cy)
      return (h[0] * 2 - 1) * (fx - cx) + (h[1] * 2 - 1) * (fy - cy)
    }
    const a = g(0, 0), b = g(1, 0), c = g(0, 1), d = g(1, 1)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
  }
  function oct(x, y, choppy) {
    const n = gnoise(x, y)
    const vx = x + n, vy = y + n
    let wx = 1 - Math.abs(Math.sin(vx)), wy = 1 - Math.abs(Math.sin(vy))
    const sx = Math.abs(Math.cos(vx)), sy = Math.abs(Math.cos(vy))
    wx = wx + (sx - wx) * wx; wy = wy + (sy - wy) * wy
    return Math.pow(1 - Math.pow(wx * wy, 0.65), choppy)
  }
  function seaH(x, z) {
    let freq = 0.16, amp = 0.6 * (0.55 + 0.75 * WIND), choppy = 4.0
    let ux = x * 0.75, uy = z, h = 0
    for (let i = 0; i < 3; i++) {
      let d = oct((ux + st) * freq, (uy + st) * freq, choppy)
      d += oct((ux - st) * freq, (uy - st) * freq, choppy)
      h += d * amp
      const nx = 1.6 * ux - 1.2 * uy, ny = 1.2 * ux + 1.6 * uy
      ux = nx; uy = ny
      freq *= 1.9; amp *= 0.22; choppy += (1 - choppy) * 0.2
    }
    return h
  }

  // the crossing
  const PERIOD = 46
  const leg = Math.floor(S.t / PERIOD)
  const dir = (leg % 2 === 0) ? 1 : -1
  const u = (S.t % PERIOD) / PERIOD
  const bx = dir > 0 ? (-26 + u * 52) : (26 - u * 52)

  // water → boat: real dynamics, not surface-gluing.
  // Buoyancy = linearized displaced volume: the deeper the hull rides vs the local
  // surface, the harder it is pushed up. Underway squat pulls it slightly under.
  const hHere = seaH(bx, 20)
  const slope = (seaH(bx + 1.1, 20) - seaH(bx - 1.1, 20)) / 2.2
  const DRAFT = 0.6, G = 9.8, SQUAT = 0.09
  const pdt = Math.min(dt, 0.05)                             // hidden-tab dt spikes must not detonate the spring
  const buoy = G * ((hHere - SQUAT - S.by) / DRAFT) * 0.9
  S.vy = (S.vy + buoy * pdt) * Math.max(0, 1 - 2.2 * pdt)    // hydrodynamic damping
  S.by += S.vy * pdt
  // pitch: righting moment toward the wave slope, angular damping (underdamped — it noses)
  const targetP = Math.atan(slope)
  S.vp = (S.vp + (targetP - S.pit) * 7.5 * pdt) * Math.max(0, 1 - 3.0 * pdt)
  S.pit += S.vp * pdt
  // if anything ever diverges, come back to the surface and start bobbing again
  if (!isFinite(S.by) || Math.abs(S.by) > 4) { S.by = hHere; S.vy = 0 }
  if (!isFinite(S.pit) || Math.abs(S.pit) > 1.2) { S.pit = 0; S.vp = 0 }

  wd.gpuUniforms = [1.25, 0.55, WIND, bx, dir, S.by, S.pit, st]
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
  name: 'SAIL',
  fields: [
    field('sl_world_f', 'Sail', [0.1, 0.2, 0.3, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'sl_world'),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    postProcess: { bloomIntensity: 0.38, bloomThreshold: 0.75, exposure: 1.02, vignetteStrength: 0.3, vignetteRadius: 0.75 },
  },
  stepHooks: [{ id: 'sail_core', author: 'fable', description: 'SAIL: CPU wave function (gnoise port) → boat heave/pitch; boat position → GPU wake. One clock on the whiteboard.', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'sl_world', wgsl: WORLD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'SAIL', scene }),
})
console.log('SAIL saved:', res.status, await res.text())
