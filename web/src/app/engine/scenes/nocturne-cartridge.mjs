// NOCTURNE — a night drive down a neon avenue, for the superimposed uber-shader.
// A raymarched box-grid city with a guaranteed central street the camera glides
// down. Emissive window grids (HDR, so bloom catches them), a hazy moon, distant
// towers dissolving into light-pollution haze, and a rain-wet road that reflects
// the whole city back with a second bounce and puddle ripples.
//
//   Output is linear HDR — the engine's ACES + bloom grade it. Do NOT tonemap here.
//   Save+load: node nocturne-cartridge.mjs   (then open /engine, pick NOCTURNE)

const WORLD = /* wgsl */`
const NC_CELL: f32 = 9.0;

fn nc_box3(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn nc_isStreet(cell: vec2f) -> bool {
  if (abs(cell.x) < 0.5) { return true; }                          // central avenue
  if (abs(cell.y - 5.0 * round(cell.y / 5.0)) < 0.5) { return true; } // cross streets
  return false;
}

fn nc_dims(cell: vec2f) -> vec3f {             // (height, halfWidth, halfDepth) per block
  let r = hash22(cell);
  let h  = 5.0 + r.x * 42.0;
  let bw = NC_CELL * 0.5 * (0.70 + r.y * 0.22);
  let bd = NC_CELL * 0.5 * (0.70 + fract(r.y * 7.31 + r.x) * 0.22);
  return vec3f(h, bw, bd);
}

fn nc_building(cell: vec2f, p: vec3f) -> f32 {
  if (nc_isStreet(cell)) { return 1.0e9; }
  let dm = nc_dims(cell);
  let center = cell * NC_CELL;
  let lp = vec3f(p.x - center.x, p.y - dm.x * 0.5, p.z - center.y);
  return nc_box3(lp, vec3f(dm.y, dm.x * 0.5, dm.z));
}

// true distance bound: the nearest building may live in an adjacent block,
// so union the 3x3 neighborhood. This is what kills the overstep "slice".
fn nc_map(p: vec3f) -> f32 {
  var d = p.y;                                                     // ground plane
  let base = floor(p.xz / NC_CELL + 0.5);
  for (var i = -1; i <= 1; i = i + 1) {
    for (var j = -1; j <= 1; j = j + 1) {
      d = min(d, nc_building(base + vec2f(f32(i), f32(j)), p));
    }
  }
  return d;
}

fn nc_nrm(p: vec3f) -> vec3f {
  let e = 0.02;
  let d0 = nc_map(p);
  return normalize(vec3f(
    nc_map(p + vec3f(e, 0.0, 0.0)) - d0,
    nc_map(p + vec3f(0.0, e, 0.0)) - d0,
    nc_map(p + vec3f(0.0, 0.0, e)) - d0));
}

// emissive window grid on the vertical faces
fn nc_facade(p: vec3f, n: vec3f) -> vec3f {
  let cell = floor(p.xz / NC_CELL + 0.5);
  let baseCol = vec3f(0.018, 0.022, 0.035);
  if (abs(n.y) > 0.55) { return vec3f(0.012, 0.016, 0.026); }      // roof
  var u = p.z;
  if (abs(n.z) > abs(n.x)) { u = p.x; }                            // pick the wall axis
  let WU = 1.05;
  let WV = 1.35;
  let cu = floor(u / WU);
  let cv = floor((p.y - 0.6) / WV);
  let fu = fract(u / WU);
  let fv = fract((p.y - 0.6) / WV);
  let inWin = step(0.18, fu) * step(fu, 0.82) * step(0.20, fv) * step(fv, 0.86) * step(0.6, p.y);
  let r = hash21(cell * 7.0 + vec2f(cu * 1.3, cv * 2.1));
  let flick = 0.85 + 0.15 * sin(r * 40.0);
  let lit = step(0.48, r) * flick;
  let cyan = step(0.86, hash21(cell + vec2f(cu, cv) * 0.7));
  let wc = mix(vec3f(1.70, 1.20, 0.62), vec3f(0.45, 1.50, 1.80), cyan);
  return baseCol + wc * lit * inWin * 2.4;
}

fn nc_sky(rd: vec3f) -> vec3f {
  let y = max(rd.y, 0.0);
  var c = mix(vec3f(0.050, 0.060, 0.110), vec3f(0.008, 0.012, 0.035), pow(y, 0.5));
  c += vec3f(0.28, 0.13, 0.05) * exp(-max(rd.y, 0.0) * 5.5);       // light pollution
  let md = normalize(vec3f(-0.45, 0.42, 1.0));
  let m = max(dot(rd, md), 0.0);
  c += vec3f(0.90, 0.92, 0.98) * pow(m, 3000.0) * 3.0;            // moon disk (HDR)
  c += vec3f(0.30, 0.34, 0.44) * pow(m, 30.0) * 0.35;            // moon halo
  if (rd.y > 0.05) {
    let sp = rd.xz / (rd.y + 0.2);
    let stars = hash21(floor(sp * 40.0));
    c += vec3f(step(0.995, stars)) * 0.8 * smoothstep(0.05, 0.30, rd.y);
  }
  return c;
}

// surface color WITHOUT the ground reflection (so the reflection bounce can reuse it)
fn nc_matColor(p: vec3f, n: vec3f) -> vec3f {
  if (p.y < 0.06) { return vec3f(0.020, 0.022, 0.030); }          // asphalt base
  var col = nc_facade(p, n);
  col += nc_sky(n) * 0.04;                                        // faint sky fill
  return col;
}

fn nc_march(ro: vec3f, rd: vec3f, steps: i32, maxd: f32) -> f32 {
  var t = 0.05;
  for (var i = 0; i < steps; i++) {
    let d = nc_map(ro + rd * t);
    if (d < 0.003 * t) { return t; }
    t += d * 0.85;                                               // SDF is exact now
    if (t > maxd) { break; }
  }
  return -1.0;
}

fn visual_nc_city(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let p = vec2f(uv.x, -uv.y);
  let t = time;

  // fly down the avenue, a slow sway and heave
  let ro = vec3f(sin(t * 0.08) * 1.5, 5.2 + sin(t * 0.20) * 0.30, t * 5.0);
  let look = normalize(vec3f(sin(t * 0.05) * 0.15, -0.12, 1.0));
  let rt = normalize(cross(vec3f(0.0, 1.0, 0.0), look));
  let up = cross(look, rt);
  let rd = normalize(rt * p.x + up * (p.y * 0.72) + look * 1.5);

  var col = nc_sky(rd);

  let tt = nc_march(ro, rd, 64, 220.0);
  if (tt > 0.0) {
    let pt = ro + rd * tt;
    let n = nc_nrm(pt);
    var mcol = nc_matColor(pt, n);

    if (pt.y < 0.06) {
      // rain-wet road: reflect the city with puddle ripples
      let rip = vnoise(pt.xz * 0.8 + vec2f(0.0, t * 0.3)) - 0.5;
      let rn = normalize(n + vec3f(rip * 0.08, 0.0, rip * 0.08));
      let rrd = reflect(rd, rn);
      var rc = nc_sky(rrd);
      let rtt = nc_march(pt + rn * 0.05, rrd, 24, 90.0);
      if (rtt > 0.0) {
        let rp = pt + rrd * rtt;
        rc = nc_matColor(rp, nc_nrm(rp));
        rc = mix(rc, nc_sky(rrd), 1.0 - exp(-rtt * 0.02));
      }
      let fres = pow(1.0 - max(-rd.y, 0.0), 4.0);
      mcol = mix(vec3f(0.015, 0.017, 0.024), rc, clamp(fres * 0.7 + 0.15, 0.0, 1.0));
    }

    let fog = 1.0 - exp(-tt * 0.012);                             // haze into distance
    col = mix(mcol, nc_sky(vec3f(rd.x, max(rd.y, 0.02), rd.z)), fog);
  }

  return vec4f(col, 1.0);   // linear HDR — engine grades it
}`

const field = (id, name, color, x, y, shape, visualTypeName) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
})

const scene = {
  name: 'NOCTURNE',
  fields: [
    field('nc_city_f', 'Nocturne', [0.1, 0.12, 0.2, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'nc_city'),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: name === 'NOCTURNE'
      ? 'A night drive down a neon avenue — rain-wet road, HDR windows, a hazy moon.\nThe glowing ball is a real physics field: it caroms between the towers and reflects in the wet street.\nNo goals. Ride.'
      : 'The neon city as a still pinball table, seen from above the avenue.\nThe ball is leashed to the stage — watch it bounce off the tower fields and drop its light into the puddles.',
    postProcess: { bloomIntensity: 0.50, bloomThreshold: 0.60, exposure: 1.05, vignetteStrength: 0.36, vignetteRadius: 0.70 },
  },
  stepHooks: [],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'nc_city', wgsl: WORLD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'NOCTURNE', scene }),
})
console.log('NOCTURNE saved:', res.status, await res.text())
