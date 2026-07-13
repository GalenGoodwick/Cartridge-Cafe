// ONE DAY — the lighthouse seascape living through a full day/night cycle (~150s).
// A pure visual demo of the world-uniform whiteboard: a step hook writes sun, moon, wind,
// beam, and a passing sailboat into worldData.gpuUniforms; every shader reads uni(i).
// No controls. Just watch: dawn → noon → sunset → stars, moon-glitter, beam, fireflies.
// Save+load: node oneday-cartridge.mjs
//
// Whiteboard map:
//   uni(0) sunAz   uni(1) sunEl   uni(2) day01    uni(3) wind01
//   uni(4) beam01  uni(5) moonEl  uni(6) moonAz   uni(7) boatX (world)
//   uni(8) boatDir(+1/-1)

const WORLD = /* wgsl */`
fn od_ic() -> vec2f { return vec2f(-9.0, 32.0); }

fn od_suncol(el: f32) -> vec3f {
  return mix(vec3f(1.30, 0.45, 0.16), vec3f(1.15, 1.05, 0.90), smoothstep(0.02, 0.55, el));
}

fn od_sky(rd: vec3f, sd: vec3f, md: vec3f, t: f32) -> vec3f {
  let el = uni(1);
  let y = max(rd.y, 0.0);
  let day = smoothstep(-0.10, 0.35, el);
  let night = smoothstep(0.05, -0.18, el);

  // dome: night indigo → day blue, horizon warms at low sun
  let zen = mix(vec3f(0.012, 0.018, 0.045), vec3f(0.16, 0.36, 0.65), day);
  let horDay = mix(vec3f(1.00, 0.42, 0.16), vec3f(0.46, 0.58, 0.72), smoothstep(0.10, 0.55, el));
  let hor = mix(vec3f(0.035, 0.035, 0.075), horDay, smoothstep(-0.16, 0.06, el));
  var c = mix(hor, zen, pow(y, 0.6));

  // sun
  let sdot = clamp(dot(rd, sd), 0.0, 1.0);
  let sunUp = smoothstep(-0.14, 0.02, el);
  c += od_suncol(el) * pow(sdot, 5.0) * 0.32 * sunUp;
  c += od_suncol(el) * pow(sdot, 70.0) * 0.60 * sunUp;
  c += vec3f(5.2, 3.6, 2.0) * smoothstep(0.99972, 0.99990, sdot) * sunUp;

  // moon: cool disk + halo, out at night
  let mdot = clamp(dot(rd, md), 0.0, 1.0);
  let moonUp = night * smoothstep(-0.05, 0.10, md.y);
  c += vec3f(0.55, 0.62, 0.75) * pow(mdot, 90.0) * 0.5 * moonUp;
  c += vec3f(2.6, 2.8, 3.1) * smoothstep(0.99985, 0.99995, mdot) * moonUp;

  // stars + a faint galaxy band
  if (night > 0.02 && rd.y > 0.01) {
    let sp = rd.xz / (rd.y + 0.55) * 26.0;
    let cell = floor(sp);
    let h = hash21(cell);
    let tw = 0.55 + 0.45 * sin(t * (0.8 + h) + h * 50.0);
    c += vec3f(0.72, 0.78, 0.95) * step(0.990, h) * smoothstep(0.30, 0.05, length(fract(sp) - 0.5)) * night * tw;
    let band = pow(max(1.0 - abs(rd.x * 0.8 + rd.y * 0.5 - 0.15), 0.0), 3.5);
    c += vec3f(0.07, 0.07, 0.12) * band * night * (0.5 + 0.3 * vnoise(sp * 0.5));
  }

  // clouds: sparse, tinted by the hour
  if (rd.y > 0.015) {
    let cp = rd.xz / (rd.y + 0.14) * 1.4 + vec2f(t * 0.006, t * 0.002);
    var cl = fbm(cp * 0.55, 4);
    cl = smoothstep(0.46, 0.78, cl);
    let cloudLit = mix(vec3f(0.06, 0.06, 0.10), mix(vec3f(1.15, 0.50, 0.28), vec3f(0.85, 0.85, 0.90), smoothstep(0.12, 0.5, el)), max(day, night * 0.12));
    c = mix(c, cloudLit, cl * 0.7 * smoothstep(0.015, 0.10, rd.y));
  }
  return c;
}

fn od_oct(uv0: vec2f, choppy: f32) -> f32 {
  let n = gnoise(uv0);
  let uv = uv0 + vec2f(n, n);
  var wv = 1.0 - abs(sin(uv));
  let swv = abs(cos(uv));
  wv = mix(wv, swv, wv);
  return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);
}

fn od_surge(pxz: vec2f, st: f32) -> f32 {
  let dr = length(pxz - od_ic());
  return exp(-max(dr - 5.8, 0.0) * 0.35) * (sin(st * 1.4 - dr * 0.9) * 0.5 + 0.62) * 1.05;
}


fn od_wake(pxz: vec2f) -> f32 {
  let d = vec2f(pxz.x - uni(7), pxz.y - 52.0);
  let along = -d.x * uni(8);                 // positive = behind the boat
  if (along < -3.0 || along > 26.0 || abs(d.y) > 12.0) { return 0.0; }
  let a = max(along, 0.0);
  var w = exp(-dot(d, d) * 0.35) * 0.8;      // bow mound at the hull
  let arm = exp(-pow((abs(d.y) - 0.36 * a) * 1.1, 2.0)) * exp(-a * 0.10);  // Kelvin arms (~19.5deg)
  let inside = smoothstep(0.36 * a + 1.0, 0.36 * a - 1.0, abs(d.y));
  let ripple = sin(a * 2.4) * 0.5 * inside * exp(-a * 0.13);               // transverse train
  return w + arm * 0.9 + ripple;
}

fn od_amp() -> f32 { return 0.55 + 0.75 * uni(3); }   // wind raises the sea

fn od_map3(p: vec3f, st: f32) -> f32 {
  var freq = 0.16;
  var amp = 0.6 * od_amp();
  var choppy = 4.0;
  var uv = p.xz;
  uv.x = uv.x * 0.75;
  var h = 0.0;
  for (var i = 0; i < 3; i++) {
    var d = od_oct((uv + vec2f(st)) * freq, choppy);
    d = d + od_oct((uv - vec2f(st)) * freq, choppy);
    h = h + d * amp;
    uv = mat2x2f(1.6, 1.2, -1.2, 1.6) * uv;
    freq = freq * 1.9;
    amp = amp * 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  h = h + od_surge(p.xz, st);
  h = h + od_wake(p.xz) * 0.22;
  return p.y - h;
}

fn od_map5(p: vec3f, st: f32) -> f32 {
  var freq = 0.16;
  var amp = 0.6 * od_amp();
  var choppy = 4.0;
  var uv = p.xz;
  uv.x = uv.x * 0.75;
  var h = 0.0;
  for (var i = 0; i < 5; i++) {
    var d = od_oct((uv + vec2f(st)) * freq, choppy);
    d = d + od_oct((uv - vec2f(st)) * freq, choppy);
    h = h + d * amp;
    uv = mat2x2f(1.6, 1.2, -1.2, 1.6) * uv;
    freq = freq * 1.9;
    amp = amp * 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  h = h + od_surge(p.xz, st);
  h = h + od_wake(p.xz) * 0.22;
  return p.y - h;
}

fn od_nrm(p: vec3f, eps: f32, st: f32) -> vec3f {
  let hy = od_map5(p, st);
  let hx = od_map5(p + vec3f(eps, 0.0, 0.0), st);
  let hz = od_map5(p + vec3f(0.0, 0.0, eps), st);
  return normalize(vec3f(hx - hy, eps, hz - hy));
}

fn od_spec(n: vec3f, l: vec3f, e: vec3f, s: f32) -> f32 {
  let nrm = (s + 8.0) / (3.14159 * 8.0);
  return pow(max(dot(reflect(e, n), l), 0.0), s) * nrm;
}

fn od_seacol(p: vec3f, n: vec3f, sd: vec3f, md: vec3f, eye: vec3f, dist: vec3f, t: f32, st: f32) -> vec3f {
  let el = uni(1);
  let day = smoothstep(-0.10, 0.35, el);
  let night = smoothstep(0.05, -0.18, el);

  var fres = clamp(1.0 - dot(n, -eye), 0.0, 1.0);
  fres = pow(fres, 3.0) * 0.5;

  let reflected = od_sky(reflect(eye, n), sd, md, t);
  let base = mix(vec3f(0.004, 0.008, 0.016), vec3f(0.035, 0.06, 0.11), day);
  let waterCol = vec3f(0.17, 0.23, 0.22) * (0.25 + 0.75 * day);
  let refracted = base + pow(dot(n, sd) * 0.4 + 0.6, 80.0) * waterCol * 0.12 * day;

  var col = mix(refracted, reflected, fres);

  let atten = max(1.0 - dot(dist, dist) * 0.001, 0.0);
  col = col + waterCol * (p.y - 0.6) * 0.18 * atten;

  // sun glitter by day, moon glitter by night — same sea, different star
  col = col + od_suncol(el) * vec3f(2.4, 1.5, 0.8) * od_spec(n, sd, eye, 90.0) * smoothstep(-0.08, 0.05, el);
  col = col + vec3f(0.9, 1.05, 1.3) * od_spec(n, md, eye, 140.0) * night * smoothstep(0.0, 0.15, md.y) * 1.6;

  // crest foam
  let foamN = vnoise(p.xz * 2.2 + vec2f(t * 0.5, -t * 0.35));
  let crest = smoothstep(1.05, 1.55, p.y) * smoothstep(0.42, 0.85, foamN);
  col = mix(col, vec3f(0.90, 0.82, 0.72) * (0.25 + 0.75 * day), crest * atten * 0.4);

  // island surf ring
  let drf = length(p.xz - od_ic()) - 6.2;
  let ph = sin(st * 1.4 - (drf + 6.2) * 0.9) * 0.5 + 0.5;
  var rockFoam = smoothstep(3.2, 0.2, drf) * (0.35 + 0.65 * ph);
  rockFoam = rockFoam * (0.45 + 0.55 * vnoise(p.xz * 2.6 + vec2f(st * 0.8, -st * 0.55)));
  col = mix(col, vec3f(0.90, 0.88, 0.84) * (0.3 + 0.7 * day + 0.25 * night), clamp(rockFoam, 0.0, 1.0) * 0.85);

  // boat wake foam — the ocean reads the boat off the whiteboard
  let wk = od_wake(p.xz);
  col = mix(col, vec3f(0.82, 0.85, 0.84) * (0.35 + 0.65 * day + 0.2 * night), clamp(wk * 0.9 - 0.12, 0.0, 1.0) * 0.55);

  return col;
}

fn visual_od_world(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let p = vec2f(uv.x, -uv.y);
  let t = time;
  let st = 1.0 + t * 0.8;

  let bob = sin(t * 0.5) * 0.06;
  let ro = vec3f(0.0, 3.4 + bob, 0.0);
  // wide viewports crop the field vertically — widen the vertical FOV to keep
  // the whole lighthouse in frame at any aspect
  let visH = clamp(frame.resolution.y / max(frame.resolution.x, 1.0), 0.45, 1.0);
  var rd = normalize(vec3f(p.x, (p.y * 0.72) / visH - 0.14 * visH, 1.75));
  let rxy = rotate(rd.xy, sin(t * 0.35) * 0.012);
  rd = normalize(vec3f(rxy.x, rxy.y, rd.z));

  // the whiteboard drives the world
  let saz = uni(0);
  let sel = uni(1);
  let sd = normalize(vec3f(cos(saz) * cos(sel), sin(sel), sin(saz) * cos(sel)));
  let mel = uni(5);
  let maz = uni(6);
  let md = normalize(vec3f(cos(maz) * cos(mel), sin(mel), sin(maz) * cos(mel)));

  var col = od_sky(rd, sd, md, t);
  var tScene = 100000.0;

  // ---- ocean ----
  if (rd.y < 0.0) {
    var tm = 0.0;
    var tx = 1000.0;
    var hx = od_map3(ro + rd * tx, st);
    if (hx < 0.0) {
      var hm = od_map3(ro, st);
      var tmid = 0.0;
      for (var i = 0; i < 8; i++) {
        tmid = mix(tm, tx, hm / (hm - hx));
        let pm = ro + rd * tmid;
        let hmid = od_map3(pm, st);
        if (hmid < 0.0) { tx = tmid; hx = hmid; } else { tm = tmid; hm = hmid; }
      }
      let pt = ro + rd * tmid;
      let dist = pt - ro;
      let eps = max(dot(dist, dist) * 0.0002, 0.002);
      let n = od_nrm(pt, eps, st);
      let seaCol = od_seacol(pt, n, sd, md, rd, dist, t, st);
      let seaBlend = pow(1.0 - smoothstep(-0.02, 0.0, rd.y), 0.2);
      col = mix(col, seaCol, seaBlend);
      tScene = tmid;
    }
  }

  // ---- distant sailboat crossing (whiteboard position) ----
  let B = vec3f(uni(7), 0.9 + sin(t * 0.7) * 0.15, 52.0);
  let toB = B - ro;
  let bDist = length(toB);
  let bDir = toB / bDist;
  if (dot(rd, bDir) > 0.995 && tScene > bDist) {
    let right = normalize(cross(bDir, vec3f(0.0, 1.0, 0.0)));
    let upv = cross(right, bDir);
    let par = dot(rd, bDir);
    let lx = dot(rd, right) / par * bDist * uni(8);   // flip with travel direction
    let ly = dot(rd, upv) / par * bDist;
    // hull + mainsail silhouette, warm-rimmed at low sun
    let hull = max(abs(lx) - 1.9 * (1.0 - clamp(ly + 0.4, 0.0, 0.5)), abs(ly + 0.45) - 0.35);
    let sail = max(max(-(lx + 0.1), ly - 2.6), (lx * 0.62 + ly * 0.55) - 1.35);
    let el2 = uni(1);
    let silCol = mix(vec3f(0.015, 0.015, 0.025), vec3f(0.10, 0.05, 0.04), smoothstep(0.3, 0.02, abs(el2)) * 0.8);
    if (hull < 0.0 || sail < 0.0) {
      col = silCol + od_suncol(el2) * 0.25 * smoothstep(0.15, -0.05, lx * uni(8)) * smoothstep(-0.08, 0.05, el2);
    }
  }

  return vec4f(col, 1.0);
}`


// ─────────────────────────────────────────────────────────────────────────────
// THE LIGHTHOUSE — its own field, selectable, portable to any scene.
// Reads the same whiteboard (sun uni(0,1), beam uni(4)); composites over
// whatever is behind it, so it can be lifted into a different world whole.
const LIGHTHOUSE = /* wgsl */`
fn od2_ic() -> vec2f { return vec2f(-9.0, 32.0); }
fn od2_suncol(el: f32) -> vec3f {
  return mix(vec3f(1.30, 0.45, 0.16), vec3f(1.15, 1.05, 0.90), smoothstep(0.02, 0.55, el));
}
fn od2_box(p: vec3f, b: vec3f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// materials: 0 rock · 1 whitewash tower · 2 ironwork · 3 lantern glass
//            4 copper cupola · 5 cottage wall · 6 cottage roof · 7 chimney · 8 door
fn od2_sdf(p: vec3f) -> vec2f {
  let ic = od2_ic();
  let q = p - vec3f(ic.x, 0.0, ic.y);

  // the rock
  var d = length(q * vec3f(1.0, 1.25, 1.08)) - 6.4;
  d = d - (vnoise3(q * 0.55) - 0.5) * 2.6 - (vnoise3(q * 1.9) - 0.5) * 0.9;
  var m = 0.0;

  // tapered masonry tower with a wider plinth — colonial whitewash
  let ty = clamp((p.y - 4.0) / 7.5, 0.0, 1.0);
  let taper = mix(1.42, 0.88, pow(ty, 0.85));
  let plinth = 1.0 + 0.35 * smoothstep(5.2, 4.0, p.y);
  let dTower = max(length(q.xz) - taper * plinth, abs(p.y - 7.75) - 3.75);
  if (dTower < d) { d = dTower; m = 1.0; }

  // gallery deck + railing: handrail ring and a circle of balusters
  let dDeck = max(length(q.xz) - 1.52, abs(p.y - 11.62) - 0.14);
  if (dDeck < d) { d = dDeck; m = 2.0; }
  let dRail = max(abs(length(q.xz) - 1.44) - 0.035, abs(p.y - 12.42) - 0.045);
  if (dRail < d) { d = dRail; m = 2.0; }
  let phi = atan2(q.z, q.x);
  let seg = 6.28318 / 20.0;
  let aphi = (glsl_mod(phi + seg * 0.5, seg) - seg * 0.5) * 1.44;
  let dBal = max(length(vec2f(length(q.xz) - 1.44, aphi)) - 0.035, abs(p.y - 12.02) - 0.42);
  if (dBal < d) { d = dBal; m = 2.0; }

  // octagonal lantern room
  var oct = abs(q.x);
  oct = max(oct, abs(q.z));
  oct = max(oct, abs(q.x * 0.7071 + q.z * 0.7071));
  oct = max(oct, abs(q.x * 0.7071 - q.z * 0.7071));
  let dLan = max(oct - 0.82, abs(p.y - 12.55) - 0.72);
  if (dLan < d) { d = dLan; m = 3.0; }

  // copper cupola with finial
  let ry = clamp((p.y - 13.27) / 1.15, 0.0, 1.0);
  let dRoof = max(length(q.xz) - mix(1.06, 0.06, pow(ry, 0.72)), abs(p.y - 13.84) - 0.58);
  if (dRoof < d) { d = dRoof; m = 4.0; }
  let dFin = length(vec3f(q.x, (p.y - 14.72) * 0.8, q.z)) - 0.14;
  if (dFin < d) { d = dFin; m = 2.0; }

  // the keeper's cottage: clapboard saltbox, gable roof, brick chimney
  let qc = q - vec3f(3.1, 4.45, 0.6);
  let dHouse = od2_box(qc, vec3f(1.55, 0.95, 1.15));
  if (dHouse < d) { d = dHouse; m = 5.0; }
  let dRoofH = max(max(abs(qc.z) * 0.92 + (qc.y - 1.72), -(qc.y - 0.75)), max(abs(qc.x) - 1.72, abs(qc.z) - 1.32));
  if (dRoofH < d) { d = dRoofH; m = 6.0; }
  let dChim = od2_box(qc - vec3f(0.55, 1.85, 0.0), vec3f(0.22, 0.65, 0.22));
  if (dChim < d) { d = dChim; m = 7.0; }

  return vec2f(d, m);
}

fn od2_trace(ro: vec3f, rd: vec3f) -> vec3f {
  let ic = od2_ic();
  let oc = ro - vec3f(ic.x, 6.5, ic.y);
  let b = dot(oc, rd);
  let c = dot(oc, oc) - 182.25;
  let disc = b * b - c;
  if (disc < 0.0) { return vec3f(0.0, 0.0, -1.0); }
  let sq = sqrt(disc);
  let t1 = -b + sq;
  var tt = max(-b - sq, 0.0);
  for (var i = 0; i < 60; i++) {
    let dm = od2_sdf(ro + rd * tt);
    if (dm.x < 0.02) { return vec3f(tt, dm.y, 1.0); }
    tt = tt + dm.x * 0.7;
    if (tt > t1) { break; }
  }
  return vec3f(0.0, 0.0, -1.0);
}

// arched-window mask on the tower shaft, facing the sea (toward the viewer)
fn od2_window(phi: f32, y: f32, yc: f32) -> f32 {
  let PHIC = -1.296;   // bearing from island to the home shore
  var ang = phi - PHIC;
  ang = glsl_mod(ang + 3.14159, 6.28318) - 3.14159;
  let aw = ang * 1.15;
  let wy = y - yc;
  let rect = step(abs(aw), 0.145) * step(-0.26, wy) * step(wy, 0.13);
  let arch = step(length(vec2f(aw, wy - 0.13)), 0.145);
  return max(rect, arch);
}

fn od2_shade(p: vec3f, n: vec3f, rd: vec3f, m: f32, sd: vec3f, t: f32, st: f32) -> vec3f {
  let el = uni(1);
  let day = smoothstep(-0.10, 0.35, el);
  let night = smoothstep(0.05, -0.18, el);
  let ic = od2_ic();
  let q = p - vec3f(ic.x, 0.0, ic.y);
  let phi = atan2(q.z, q.x);
  var alb = vec3f(0.0);
  var emis = vec3f(0.0);
  var spec = 0.0;

  if (m < 0.5) {
    // rock: strata, wet dark base, lichen where it faces the sky
    let strat = sin(p.y * 2.1 + (vnoise3(p * 0.4) - 0.5) * 5.0);
    alb = mix(vec3f(0.055, 0.052, 0.058), vec3f(0.125, 0.115, 0.10), 0.5 + 0.5 * strat);
    alb = mix(alb, vec3f(0.14, 0.13, 0.10), vnoise3(p * 1.7) * 0.4);
    let wet = smoothstep(2.6, 0.5, p.y);
    alb = alb * (1.0 - wet * 0.6);
    spec = wet * 0.5;
    let lich = smoothstep(0.45, 0.75, vnoise3(p * 2.3)) * smoothstep(0.35, 0.7, n.y) * smoothstep(3.2, 4.4, p.y);
    alb = mix(alb, vec3f(0.16, 0.17, 0.08), lich * 0.7);
  } else if (m < 1.5) {
    // whitewashed masonry: courses, joints, weather streaks
    alb = vec3f(0.86, 0.85, 0.81);
    let course = smoothstep(0.055, 0.02, abs(fract(p.y / 0.58) - 0.5) * 0.58);
    let joint = smoothstep(0.05, 0.02, abs(fract(phi * 1.15 / 0.85 + floor(p.y / 0.58) * 0.5) - 0.5) * 0.85);
    alb = alb * (1.0 - course * 0.10 - joint * course * 0.05);
    let streak = smoothstep(0.55, 0.9, vnoise(vec2f(phi * 6.0, p.y * 0.22)));
    alb = alb * (1.0 - streak * 0.16 * smoothstep(4.5, 10.5, p.y));
    alb = alb * (1.0 - smoothstep(5.4, 4.2, p.y) * 0.18);   // grime at the plinth
    // three arched windows climbing the shaft + the door
    var win = 0.0;
    win = max(win, od2_window(phi, p.y, 6.3));
    win = max(win, od2_window(phi, p.y, 8.5));
    win = max(win, od2_window(phi, p.y, 10.5));
    let doorM = od2_window(phi, p.y * 0.72, 3.42);
    alb = mix(alb, vec3f(0.05, 0.05, 0.06), win);
    alb = mix(alb, vec3f(0.06, 0.13, 0.09), doorM);        // colonial green door
    let lit = 0.35 + 0.65 * smoothstep(0.4, 0.9, hash11(floor(p.y / 2.0)));
    emis = emis + vec3f(2.0, 1.25, 0.45) * win * night * lit;
  } else if (m < 2.5) {
    alb = vec3f(0.055, 0.058, 0.068);   // wrought iron
    spec = 0.35;
  } else if (m < 3.5) {
    // lantern glazing: mullions read dark, panes catch sky and hold the lamp
    let mseg = 6.28318 / 8.0;
    let mphi = abs(glsl_mod(phi + mseg * 0.5, mseg) - mseg * 0.5);
    let mull = step(mphi, 0.09);
    let bands = step(abs(p.y - 12.55), 0.06) + step(0.60, abs(p.y - 12.55));
    if (mull + bands > 0.5) {
      alb = vec3f(0.055, 0.058, 0.068);
      spec = 0.35;
    } else {
      alb = vec3f(0.02, 0.025, 0.035);
      spec = 1.2;
      let lampP = vec3f(ic.x, 12.55, ic.y);
      let lampD = length(p - lampP);
      emis = vec3f(6.5, 4.9, 2.6) * exp(-lampD * lampD * 0.9) * (0.15 + 0.85 * uni(4)) * 2.2;
      emis = emis + vec3f(1.4, 1.05, 0.55) * (0.10 + 0.90 * uni(4)) * 0.35;
    }
  } else if (m < 4.5) {
    // copper gone to patina
    let pat = vnoise3(p * 3.1);
    alb = mix(vec3f(0.30, 0.20, 0.12), vec3f(0.24, 0.40, 0.33), smoothstep(0.35, 0.7, pat));
    spec = 0.6;
  } else if (m < 5.5) {
    // clapboard: fine horizontal shadow lines
    alb = vec3f(0.82, 0.80, 0.74);
    let lap = smoothstep(0.10, 0.02, abs(fract(p.y / 0.16) - 0.5) * 0.16);
    alb = alb * (1.0 - lap * 0.13);
    // two warm windows on the seaward face
    let qc = q - vec3f(3.1, 4.45, 0.6);
    let front = step(qc.z, -1.05);
    let wmask = front * step(abs(abs(qc.x) - 0.62), 0.26) * step(abs(qc.y + 0.05), 0.30);
    alb = mix(alb, vec3f(0.05, 0.05, 0.06), wmask);
    emis = emis + vec3f(2.2, 1.35, 0.5) * wmask * night;
  } else if (m < 6.5) {
    alb = vec3f(0.16, 0.15, 0.15) * (0.8 + 0.4 * vnoise(vec2f(p.x * 6.0, p.z * 6.0)));  // shingles
  } else if (m < 7.5) {
    let brick = smoothstep(0.06, 0.02, abs(fract(p.y / 0.14) - 0.5) * 0.14);
    alb = vec3f(0.38, 0.16, 0.11) * (1.0 - brick * 0.35);   // brick chimney
  } else {
    alb = vec3f(0.06, 0.13, 0.09);
  }

  let dif = max(dot(n, sd), 0.0) * smoothstep(-0.05, 0.05, el);
  let ambSky = mix(vec3f(0.05, 0.06, 0.10), vec3f(0.30, 0.34, 0.48), day) * (0.35 + 0.25 * max(n.y, 0.0));
  let sunCol = od2_suncol(el) * 1.4;
  var col = alb * (ambSky + sunCol * dif);
  col = col + alb * vec3f(0.10, 0.12, 0.17) * max(dot(n, vec3f(0.3, 0.8, -0.5)), 0.0) * night;
  let rim = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 3.0);
  col = col + sunCol * rim * 0.15 * day;
  col = col + sunCol * pow(max(dot(reflect(rd, n), sd), 0.0), 24.0) * spec * day;

  if (m < 0.5) {
    let surgePh = max(sin(st * 1.4), 0.0);
    let sprayN = vnoise(vec2f(p.x * 1.3 + p.z * 1.1, p.y * 1.8) + vec2f(st * 0.9, -st * 0.6));
    let spray = smoothstep(2.1, 0.9, p.y) * smoothstep(0.35, 0.9, sprayN) * (0.4 + 0.6 * surgePh);
    col = mix(col, vec3f(0.88, 0.90, 0.92) * (0.3 + 0.7 * day + 0.3 * night), clamp(spray, 0.0, 1.0) * 0.45);
  }
  return col + emis;
}

fn visual_od_lh(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let p = vec2f(uv.x, -uv.y);
  let t = time;
  let st = 1.0 + t * 0.8;

  // the same eye as the world field — the two compose pixel-perfectly
  let bob = sin(t * 0.5) * 0.06;
  let ro = vec3f(0.0, 3.4 + bob, 0.0);
  // wide viewports crop the field vertically — widen the vertical FOV to keep
  // the whole lighthouse in frame at any aspect
  let visH = clamp(frame.resolution.y / max(frame.resolution.x, 1.0), 0.45, 1.0);
  var rd = normalize(vec3f(p.x, (p.y * 0.72) / visH - 0.14 * visH, 1.75));
  let rxy = rotate(rd.xy, sin(t * 0.35) * 0.012);
  rd = normalize(vec3f(rxy.x, rxy.y, rd.z));

  let saz = uni(0);
  let sel = uni(1);
  let sd = normalize(vec3f(cos(saz) * cos(sel), sin(sel), sin(saz) * cos(sel)));

  var col = behind.rgb;

  // the sea is not ours, but it still hides our feet: approximate the water
  // plane so rock below a swell yields to the world behind
  var tSea = 100000.0;
  if (rd.y < -0.001) { tSea = (0.85 - ro.y) / rd.y; }

  let lh = od2_trace(ro, rd);
  var tScene = 100000.0;
  if (lh.z > 0.0) {
    let pr = ro + rd * lh.x;
    let e = 0.03;
    let d0 = od2_sdf(pr).x;
    let nr = normalize(vec3f(
      od2_sdf(pr + vec3f(e, 0.0, 0.0)).x - d0,
      od2_sdf(pr + vec3f(0.0, e, 0.0)).x - d0,
      od2_sdf(pr + vec3f(0.0, 0.0, e)).x - d0));
    var sc = od2_shade(pr, nr, rd, lh.y, sd, t, st);
    sc = mix(sc, vec3f(0.45, 0.33, 0.30) * (0.2 + 0.8 * smoothstep(-0.1, 0.3, uni(1))), clamp(lh.x * 0.004, 0.0, 0.4));
    // let the sea's own surf/foam (already in behind) claim the waterline
    let waterVeil = smoothstep(1.15, 0.45, pr.y);
    col = mix(sc, behind.rgb, waterVeil);
    tScene = lh.x;
  }

  // ── the beam as a force field: hard-edged cone, diagonal energy hatch ──
  let beamI = uni(4);
  if (beamI > 0.01) {
    let ic = od2_ic();
    let lamp = vec3f(ic.x, 12.55, ic.y);
    for (var k = 0; k < 2; k++) {
      let ba = t * 0.55 + f32(k) * 3.14159;
      let Ld = normalize(vec3f(cos(ba), -0.02, sin(ba)));
      let w0 = ro - lamp;
      let a1 = dot(rd, Ld);
      let b1 = dot(rd, w0);
      let c1 = dot(Ld, w0);
      let den = 1.0 - a1 * a1;
      if (den > 0.0001) {
        let sRay = (a1 * c1 - b1) / den;
        let sBeam = (c1 - a1 * b1) / den;
        if (sRay > 0.0 && sRay < min(tScene, tSea) && sBeam > 1.2) {
          let dd = length((ro + rd * sRay) - (lamp + Ld * sBeam));
          let w = 0.32 + sBeam * 0.035;            // the cone opens with distance
          let shell = smoothstep(w, w * 0.78, dd); // hard wall, not a gaussian
          let edge = exp(-pow((dd - w * 0.92) * 5.5, 2.0)) * 0.8;   // bright skin
          // one family of diagonal interference — a field, not a net
          let hatch = pow(0.5 + 0.5 * sin(sBeam * 2.2 - dd * 7.0 - t * 6.0), 3.0);
          let breathe = 0.93 + 0.07 * sin(t * 22.0 + sBeam * 0.7);
          let body = shell * (0.34 + 0.66 * hatch);
          let fall = exp(-sBeam * 0.042);
          // when the beam points at the eye its cross-section is half the sky — dim it
          let headOn = 1.0 - pow(abs(a1), 10.0);
          col = col + mix(vec3f(2.5, 1.95, 1.15), vec3f(3.1, 2.95, 2.45), shell * hatch)
                      * (body + edge) * fall * 1.5 * beamI * breathe * headOn;
        }
      }
    }
    // lamp flare when the beam sweeps you
    let toLamp = lamp - ro;
    let lampDist = length(toLamp);
    let ba0 = t * 0.55;
    let alignK = pow(abs(dot(vec2f(cos(ba0), sin(ba0)), normalize(ro.xz - lamp.xz))), 24.0);
    let flare = pow(max(dot(rd, toLamp / lampDist), 0.0), 700.0);
    col = col + vec3f(4.5, 3.4, 2.0) * flare * (0.5 + 4.5 * alignK) * beamI;
  }

  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = behind.rgb; }
  return vec4f(clamp(col, vec3f(0.0), vec3f(60.0)), 1.0);
}`

const FLIES = /* wgsl */`
fn visual_od_flies(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // fireflies over the island after dark — existence itself read off the whiteboard
  let night = smoothstep(0.02, -0.14, uni(1));
  if (night < 0.02) { return vec4f(behind.rgb, 1.0); }
  let wind = uni(3);
  var c = vec3f(0.0);
  var a = 0.0;
  for (var i = 0; i < 18; i++) {
    let fi = f32(i);
    let h1 = hash11(fi * 13.7);
    let h2 = hash11(fi * 29.3);
    // hover around the island (screen left), drift on the wind
    var pos = vec2f(-0.55 + (h1 - 0.5) * 0.55, -0.10 + (h2 - 0.5) * 0.38);
    pos.x += sin(time * (0.20 + h1 * 0.25) + fi * 2.4) * 0.06 + wind * 0.02;
    pos.y += cos(time * (0.16 + h2 * 0.22) + fi * 1.7) * 0.045;
    let d2 = dot(uv - pos, uv - pos);
    let blink = smoothstep(0.25, 0.9, 0.5 + 0.5 * sin(time * (0.7 + h1 * 1.3) + fi * 5.0));
    let g = exp(-d2 * 26000.0) * blink;
    c += vec3f(2.2, 1.55, 0.45) * g;
    c += vec3f(0.9, 0.6, 0.15) * exp(-d2 * 2600.0) * blink * 0.35;
    a = max(a, clamp(g * 1.6 + exp(-d2 * 2600.0) * 0.3, 0.0, 1.0));
  }
  return vec4f(behind.rgb + c * night, 1.0);
}`

// ─────────────────────────────────────────────────────────────────────────────
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__day) wd.__day = { t: 38 }        // start mid-morning
  const D = wd.__day
  D.t += dt
  const CYC = 150
  const ph = (D.t % CYC) / CYC               // 0 = dawn
  const az = 1.35 + ph * 6.28318             // the sun walks its full circle
  const el = Math.sin(ph * 6.28318) * 0.72   // rises, peaks, sets, sinks below

  // wind freshens through the afternoon, calms at night
  const wind = Math.max(0, Math.min(1, 0.35 + 0.30 * Math.sin(ph * 6.28318 - 1.2) + 0.08 * Math.sin(D.t * 0.13)))

  // lighthouse keeper lights the lamp as the sun touches the horizon
  const beam = Math.max(0, Math.min(1, (0.06 - el) * 9))

  // the moon keeps the opposite watch
  const mel = -el * 0.85
  const maz = az + Math.PI

  // a sailboat crosses, turns around beyond the frame, crosses back
  const leg = Math.floor(D.t / 55)
  const dir = (leg % 2 === 0) ? 1 : -1
  const u = (D.t % 55) / 55
  const bx = dir > 0 ? (-70 + u * 140) : (70 - u * 140)

  wd.gpuUniforms = [az, el, ph, wind, beam, mel, maz, bx, dir]
} catch (e) { /* keep the sim alive */ }
`

const field = (id, name, color, x, y, shape, visualTypeName, vp, props) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: props || {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
  ...(vp ? { visualParams: vp } : {}),
})

const scene = {
  name: 'ONE DAY',
  fields: [
    field('od_world_f', 'One Day', [0.05, 0.08, 0.14, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'od_world'),
    field('od_lh_f', 'The Lighthouse', [0.9, 0.85, 0.7, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'od_lh', null, { superimpose: 1 }),
    field('od_flies_f', 'Fireflies', [1, 0.8, 0.3, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'od_flies', null, { superimpose: 1 }),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: { noPixelSampling: true, instructions:
    'ONE DAY — a colonial lighthouse island living through a real day (~150s): dawn, noon, sunset, stars, moonrise. The keeper lights the lamp at dusk; its beam is a force field over the fog. Nothing to press. Watch.\n\nThe lighthouse and its rock are their own field (The Lighthouse) — select it, or carry it into another world.' },
  stepHooks: [{ id: 'oneday_clock', author: 'fable', description: 'ONE DAY: writes sun/moon/wind/beam/sailboat onto the world-uniform whiteboard', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'od_world', wgsl: WORLD },
    { name: 'od_lh', wgsl: LIGHTHOUSE },
    { name: 'od_flies', wgsl: FLIES },
  ],
  modules: [],
  timestamp: Date.now(),
}

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/ONE DAY.json'), JSON.stringify(scene, null, 1))
console.log('ONE DAY bundled')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'ONE DAY', scene }),
})
console.log('ONE DAY saved:', res.status, await res.text())
