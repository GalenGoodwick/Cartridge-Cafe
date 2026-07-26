// ============================================================
// AUREON — COMPOSED ENGINE MODULE (BIOLUMINESCENT ABYSS)
// Foundation + all technique fns, each present EXACTLY ONCE.
// No @fragment/@vertex/@compute. No builtin redeclarations.
// All helpers au_-prefixed. Output is LINEAR HDR.
// Dedup pass: no function was defined twice across the source
// nodes — every au_ helper below is unique, so all are kept as-is.
// ============================================================

const AU_UP: vec3f = vec3f(0.0, 0.99875, 0.049937);           // toward the distant surface / god-ray source
const AU_DEEP: vec3f = vec3f(0.004, 0.020, 0.028);            // deep teal-black abyss water

// ---------- small helpers ----------

fn au_hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 345.45));
  q += dot(q, q + 34.345);
  return fract(q.x * q.y);
}

fn au_vnoise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = au_hash21(i + vec2f(0.0, 0.0));
  let b = au_hash21(i + vec2f(1.0, 0.0));
  let c = au_hash21(i + vec2f(0.0, 1.0));
  let d = au_hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn au_fbm2(p: vec2f) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 5; i = i + 1) {
    s += a * au_vnoise2(q);
    q = q * 2.02 + vec2f(11.3, 7.1);
    a *= 0.5;
  }
  return s;
}

fn au_smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn au_time() -> f32 {
  return uni(0);
}

// ---------- environment SDF components ----------

fn au_terrain(xz: vec2f) -> f32 {
  let warp = vec2f(au_fbm2(xz * 0.12 + vec2f(3.7, 1.2)),
                   au_fbm2(xz * 0.12 + vec2f(9.1, 5.3)));
  var h = au_fbm2(xz * 0.14 + warp * 1.4) * 3.0;
  h += au_fbm2(xz * 0.55) * 0.7;
  h += au_fbm2(xz * 1.9) * 0.18;   // fine grit
  return -3.4 + h;
}

fn au_coral(p: vec3f) -> f32 {
  var d = 1e9;

  let b1 = vec2f(3.4, 2.2);
  let c1 = vec3f(b1.x, au_terrain(b1) + 0.55, b1.y);
  d = au_smin(d, length((p - c1) / vec3f(1.0, 0.85, 1.0)) * 0.85 - 1.15, 0.9);

  let b2 = vec2f(-2.6, 3.6);
  let c2 = vec3f(b2.x, au_terrain(b2) + 0.35, b2.y);
  d = au_smin(d, length((p - c2) / vec3f(1.2, 0.7, 1.1)) * 0.75 - 0.85, 0.8);

  let b3 = vec2f(-4.2, -2.0);
  let c3 = vec3f(b3.x, au_terrain(b3) + 0.7, b3.y);
  d = au_smin(d, length(p - c3) - 0.95, 0.7);

  let b4 = vec2f(1.2, -3.4);
  let c4 = vec3f(b4.x, au_terrain(b4) + 0.3, b4.y);
  d = au_smin(d, length((p - c4) / vec3f(0.8, 1.3, 0.8)) * 0.85 - 0.7, 0.6);

  d += 0.09 * sin(p.x * 5.5) * sin(p.y * 6.5 + 1.3) * sin(p.z * 5.5);
  d += 0.035 * sin(p.x * 17.0) * sin(p.z * 17.0);
  return d;
}

fn au_stalk(p: vec3f, base: vec2f, ht: f32, rad: f32, ph: f32) -> f32 {
  let root = au_terrain(base);
  let y0 = root - 0.3;
  let y1 = root + ht;
  let fy = clamp((p.y - y0) / max(y1 - y0, 0.001), 0.0, 1.0);
  let t = au_time();
  let sway = fy * fy * 0.9;
  let ox = sin(t * 0.55 + ph + fy * 2.2) * sway
         + sin(t * 0.23 + ph * 1.7) * sway * 0.4;
  let oz = cos(t * 0.47 + ph * 1.3 + fy * 1.8) * sway * 0.8;
  let cx = base.x + ox;
  let cz = base.y + oz;
  let r = rad * (1.0 - 0.7 * fy);
  var d = length(vec2f(p.x - cx, p.z - cz)) - r;
  let below = max(y0 - p.y, 0.0);
  let above = max(p.y - y1, 0.0);
  d = max(d, max(below, above) - 0.05);
  d += 0.04 * sin(p.y * 7.0 + ph + t) * (0.4 + fy);
  return d;
}

fn au_kelp(p: vec3f) -> f32 {
  var d = au_stalk(p, vec2f(-1.0, 1.0), 7.5, 0.16, 0.0);
  d = min(d, au_stalk(p, vec2f(4.6, -1.6), 8.6, 0.20, 2.1));
  d = min(d, au_stalk(p, vec2f(-3.4, -3.8), 6.4, 0.14, 4.3));
  return d;
}

// ---------- CONTRACT: environment SDF ----------

fn au_map(p: vec3f) -> f32 {
  let ground = p.y - au_terrain(p.xz);
  var d = ground * 0.65;
  d = au_smin(d, au_coral(p), 0.5);
  d = min(d, au_kelp(p));
  return d;
}

fn au_nrm(p: vec3f) -> vec3f {
  let e = vec2f(0.0012, 0.0);
  return normalize(vec3f(
    au_map(p + e.xyy) - au_map(p - e.xyy),
    au_map(p + e.yxy) - au_map(p - e.yxy),
    au_map(p + e.yyx) - au_map(p - e.yyx)
  ));
}

fn au_march(ro: vec3f, rd: vec3f) -> f32 {
  var t = 0.02;
  for (var i = 0; i < 110; i = i + 1) {
    let p = ro + rd * t;
    let d = au_map(p);
    if (d < 0.001 * t + 0.0006) {
      return t;
    }
    t += d * 0.85;
    if (t > 120.0) {
      break;
    }
  }
  return -1.0;
}

fn au_medium(rd: vec3f) -> vec3f {
  let up = clamp(dot(normalize(rd), AU_UP) * 0.5 + 0.5, 0.0, 1.0);
  let surface = vec3f(0.02, 0.075, 0.10);
  var col = mix(AU_DEEP, surface, pow(up, 3.0));
  col += surface * 0.35 * pow(up, 8.0);
  let hz = au_vnoise2(rd.xy * 40.0 + rd.z * 13.0);
  col += vec3f(0.006, 0.018, 0.020) * smoothstep(0.85, 1.0, hz);
  return col;
}

// ============================================================
// TECHNIQUE: CREATURES — the hero jellyfish
// ============================================================

fn au_bell(q: vec3f, s: f32, t: f32, ph: f32) -> f32 {
  let pulse = 0.10 * sin(t * 1.6 + ph);
  let rx = s * (0.60 + pulse);
  let ry = s * (0.50 - pulse * 0.85);
  let rz = s * (0.60 + pulse);
  let r  = vec3f(rx, ry, rz);
  var d = (length(q / r) - 1.0) * min(rx, min(ry, rz));
  d = max(d, -(q.y + s * 0.14));
  let ang = atan2(q.z, q.x);
  d += 0.025 * s * sin(ang * 8.0) * smoothstep(0.05, -0.25, q.y);
  d += 0.012 * s * sin(q.x * 11.0 + t) * sin(q.z * 11.0 - t * 0.7);
  return d;
}

fn au_strand(q: vec3f, ang: f32, rad: f32, len: f32, t: f32, ph: f32) -> f32 {
  let depth = clamp(-q.y / len, 0.0, 1.0);
  let sway  = depth * 0.55;
  let cx = cos(ang) * rad + sin(t * 0.9 + ph + depth * 4.0) * sway;
  let cz = sin(ang) * rad + cos(t * 0.8 + ph * 1.3 + depth * 3.5) * sway;
  var d = length(vec2f(q.x - cx, q.z - cz)) - (0.020 + 0.035 * (1.0 - depth));
  let above = max(q.y, 0.0);
  let below = max(-q.y - len, 0.0);
  d = max(d, max(above, below) - 0.02);
  d += 0.010 * sin(q.y * 9.0 + ph + t * 1.4);
  return d;
}

fn au_tentacles(q: vec3f, s: f32, t: f32, ph: f32) -> f32 {
  let rad = 0.40 * s;
  let len = 2.6 * s;
  var d = au_strand(q, 0.0,        rad, len, t, ph + 0.0);
  d = min(d, au_strand(q, 1.2566,  rad, len * 0.9, t, ph + 1.1));
  d = min(d, au_strand(q, 2.5133,  rad, len * 1.1, t, ph + 2.3));
  d = min(d, au_strand(q, 3.7699,  rad, len * 0.95, t, ph + 3.4));
  d = min(d, au_strand(q, 5.0265,  rad, len * 1.05, t, ph + 4.6));
  return d;
}

fn au_jellyBody(p: vec3f, c: vec3f, s: f32, t: f32, ph: f32) -> f32 {
  let q = p - c;
  let bell = au_bell(q, s, t, ph);
  let tent = au_tentacles(q, s, t, ph);
  return au_smin(bell, tent, 0.18 * s);
}

fn au_jelly(p: vec3f, t: f32) -> f32 {
  var d = 1e9;

  let c1 = vec3f(1.1 + sin(t * 0.15) * 0.6,
                 1.7 + sin(t * 0.40) * 0.35,
                 0.4 + cos(t * 0.12) * 0.5);
  d = min(d, au_jellyBody(p, c1, 1.15, t, 0.0));

  let c2 = vec3f(-2.3 + sin(t * 0.11 + 1.7) * 0.5,
                  2.9 + sin(t * 0.33 + 0.8) * 0.4,
                 -1.6 + cos(t * 0.17 + 2.0) * 0.6);
  d = min(d, au_jellyBody(p, c2, 0.75, t, 2.1));

  let c3 = vec3f(3.2 + sin(t * 0.09 + 3.1) * 0.7,
                 0.9 + sin(t * 0.28 + 2.2) * 0.5,
                 2.6 + cos(t * 0.10 + 0.4) * 0.5);
  d = min(d, au_jellyBody(p, c3, 0.90, t, 4.3));

  return d;
}

fn au_jellyMat(p: vec3f, n: vec3f, rd: vec3f, t: f32) -> vec4f {
  let ndv  = clamp(dot(n, -rd), 0.0, 1.0);
  let fres = pow(1.0 - ndv, 3.0);

  let hue   = 0.5 + 0.5 * sin(t * 0.5 + p.x * 0.6 + p.z * 0.4);
  let inner = mix(vec3f(0.10, 0.62, 0.85),
                  vec3f(0.48, 0.22, 0.92),
                  hue);

  let pulse = 0.55 + 0.45 * sin(t * 1.6 + p.y * 2.2);

  var col = inner * (0.45 + 1.30 * pulse);
  col += vec3f(0.45, 0.95, 1.05) * fres * 2.4;

  let refr = au_medium(refract(rd, n, 0.86));
  col += refr * 0.55;

  let alpha = clamp(0.22 + fres * 0.70 + pulse * 0.14, 0.0, 0.94);
  return vec4f(col, alpha);
}

// ============================================================
// TECHNIQUE: SUBSURFACE SCATTERING
// ============================================================

fn au_sss(p: vec3f, n: vec3f, rd: vec3f, thickness: f32) -> f32 {
  let ldir = normalize(AU_UP);
  let V = -normalize(rd);

  let distortion = 0.42;
  let sslv = normalize(ldir + n * distortion);

  let power = 3.2;
  let scale = 2.6;
  let back = pow(clamp(dot(V, -sslv), 0.0, 1.0), power) * scale;

  let wrap = 0.28 * clamp(dot(n, ldir) * 0.5 + 0.5, 0.0, 1.0);

  let atten = exp(-max(thickness, 0.0) * 1.7);

  var s = (back + wrap) * atten;

  let depth = clamp(p.y * 0.055 + 0.5, 0.0, 1.0);
  s *= 0.55 + 0.85 * depth;

  let flick = 0.9 + 0.1 * sin(au_time() * 1.9 + p.x * 3.1 + p.z * 2.3 + p.y * 1.4);
  s *= flick;

  return max(s, 0.0);
}

// ============================================================
// TECHNIQUE: BIOLUMINESCENCE
// ============================================================

fn au_glowColor(h: f32) -> vec3f {
  let cyan   = vec3f(0.15, 0.95, 1.10);
  let teal   = vec3f(0.05, 1.05, 0.70);
  let violet = vec3f(0.70, 0.35, 1.20);
  let m = mix(cyan, teal, smoothstep(0.0, 0.5, h));
  return mix(m, violet, smoothstep(0.5, 1.0, h));
}

fn au_biolume(p: vec3f, t: f32) -> vec3f {
  var glow = vec3f(0.0);

  let cell = 1.6;
  let gp = p.xz / cell;
  let ip = floor(gp);
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let o  = vec2f(f32(i), f32(j));
      let id = ip + o;
      let h1 = au_hash21(id);
      if (h1 > 0.45) {
        let h2  = au_hash21(id + vec2f(37.0, 11.0));
        let h3  = au_hash21(id + vec2f(7.0, 91.0));
        let jit = vec2f(au_hash21(id + 3.1), au_hash21(id + 8.7)) - 0.5;
        let cxz = (id + 0.5 + jit * 0.8) * cell;
        let ty  = au_terrain(cxz) + 0.4 + h2 * 1.1;
        let cpos = vec3f(cxz.x, ty, cxz.y);
        let dv  = p - cpos;
        let d2  = dot(dv, dv);
        let ph    = h3 * 6.28318;
        let pulse = 0.55 + 0.45 * sin(t * (0.5 + h2 * 0.7) + ph);
        let flick = 1.0 + 0.10 * sin(t * (3.1 + h1 * 2.0) + ph * 2.3);
        let intensity = pulse * flick / (1.0 + d2 * 9.0);
        glow += au_glowColor(h3) * intensity * 1.4;
      }
    }
  }

  let terrH   = au_terrain(p.xz);
  let nearBed = smoothstep(2.6, 0.0, abs(p.y - terrH - 0.6));
  let drift   = vec2f(t * 0.05, t * 0.03);
  let m1 = au_vnoise2(p.xz * 3.5 + drift + p.y * 0.7);
  let m2 = au_vnoise2(p.xz * 8.0 - drift * 1.7 + vec2f(4.0, 4.0));
  let spark = smoothstep(0.82, 0.99, m1) * smoothstep(0.70, 1.0, m2);
  let twinkle = 0.6 + 0.4 * sin(t * 1.3 + m1 * 20.0);
  glow += vec3f(0.18, 0.62, 0.72) * spark * nearBed * twinkle;

  return glow;
}

// ============================================================
// TECHNIQUE: VOLUMETRICS — god-rays + plankton + fog
// ============================================================

fn au_hash33(p: vec3f) -> vec3f {
  var q = vec3f(dot(p, vec3f(127.1, 311.7, 74.7)),
                dot(p, vec3f(269.5, 183.3, 246.1)),
                dot(p, vec3f(113.5, 271.9, 124.6)));
  return fract(sin(q) * 43758.5453);
}

fn au_plankton_field(p: vec3f, scale: f32, t: f32) -> vec3f {
  let g = p * scale;
  let id = floor(g);
  var acc = vec3f(0.0);
  for (var ix = -1; ix <= 1; ix = ix + 1) {
    for (var iy = -1; iy <= 1; iy = iy + 1) {
      let cell = id + vec3f(f32(ix), f32(iy), 0.0);
      let rnd = au_hash33(cell);
      let drift = vec3f(
        sin(t * (0.25 + rnd.x * 0.4) + rnd.z * 6.28),
        sin(t * (0.18 + rnd.y * 0.3) + rnd.x * 6.28) * 0.6,
        cos(t * (0.22 + rnd.z * 0.35) + rnd.y * 6.28)
      );
      let center = cell + vec3f(0.5) + 0.42 * drift;
      let d = length(g - center);
      let core = smoothstep(0.30, 0.0, d);
      let tw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * (1.4 + rnd.z * 2.2) + rnd.x * 12.56), 3.0);
      let warm = step(0.92, rnd.y);
      let hue = mix(vec3f(0.18, 0.85, 0.95), vec3f(0.95, 0.65, 0.25), warm);
      acc += hue * (core * tw);
    }
  }
  return acc;
}

fn au_volume(ro: vec3f, rd: vec3f, sceneT: f32) -> vec3f {
  let t0 = au_time();

  let far = select(42.0, min(sceneT, 42.0), sceneT > 0.0);
  let steps = 48;
  let dt = far / f32(steps);

  let j = fract(sin(dot(rd.xy, vec2f(12.9, 78.2))) * 43758.0);

  let upAlign = clamp(dot(normalize(rd), AU_UP), 0.0, 1.0);
  let shaftGate = pow(upAlign, 1.5);

  let drift = vec2f(t0 * 0.06, t0 * 0.035);

  var col = vec3f(0.0);
  var t = dt * (0.5 + j);

  for (var i = 0; i < steps; i = i + 1) {
    let p = ro + rd * t;

    let distFog = exp(-t * 0.055);
    let depthFade = smoothstep(-5.0, 14.0, p.y);

    let s0 = au_fbm2(p.xz * 0.45 + drift);
    let s1 = au_fbm2(p.xz * 1.7 - drift * 1.9 + vec2f(5.1, 2.3));
    var shaft = pow(clamp(s0 * 0.7 + s1 * 0.5, 0.0, 1.0), 3.5);
    shaft *= shaftGate * depthFade;
    let rayCol = vec3f(0.10, 0.42, 0.52) * shaft * 1.6;

    var plank = au_plankton_field(p, 0.55, t0) * 0.9;
    plank += au_plankton_field(p * 1.0, 1.35, t0 * 1.3) * 0.35;

    let bodyGlow = mix(AU_DEEP, vec3f(0.02, 0.09, 0.11), depthFade) * 0.25;

    col += (rayCol + plank + bodyGlow) * distFog * dt;

    t += dt;
    if (t > far) { break; }
  }

  return col;
}

// ============================================================
// TECHNIQUE: CAUSTICS
// ============================================================

fn au_caus_voro(p: vec2f) -> f32 {
  let n = floor(p);
  let f = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let g = vec2f(f32(i), f32(j));
      let rnd = au_hash21(n + g);
      let rnd2 = au_hash21(n + g + vec2f(19.7, 4.1));
      let o = vec2f(rnd, rnd2);
      let d = length(g + o - f);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return f2 - f1;
}

fn au_caus_layer(q: vec2f, t: f32, scale: f32, speed: f32) -> f32 {
  let w = vec2f(
    au_fbm2(q * 0.6 + vec2f(0.0, t * speed * 0.35)),
    au_fbm2(q * 0.6 + vec2f(5.2, -t * speed * 0.27))
  );
  let sp = q * scale + (w - 0.5) * 2.2 + vec2f(t * speed, t * speed * 0.6);
  let edge = au_caus_voro(sp);
  let ridge = smoothstep(0.55, 0.0, edge);
  return ridge * ridge;
}

fn au_caustics(p: vec3f, t: f32) -> f32 {
  let uv = p.xz;

  var c = au_caus_layer(uv, t, 1.35, 0.20) * 0.65;
  c += au_caus_layer(uv * 1.9 + vec2f(11.0, 3.0), -t, 2.4, 0.30) * 0.45;
  let pool = au_fbm2(uv * 0.4 + vec2f(t * 0.05, -t * 0.04));
  c *= 0.35 + 0.9 * pool;

  let depthGrad = smoothstep(-4.0, 3.5, p.y);
  c *= 0.15 + 0.85 * depthGrad;

  c *= 0.5;
  return max(c, 0.0);
}

// ============================================================
// TECHNIQUE: MATERIALS — bioluminescent abyss seabed / coral
// ============================================================

fn au_triplanar_fbm(p: vec3f, n: vec3f, scale: f32) -> f32 {
  let an = abs(n);
  let w = an / max(an.x + an.y + an.z, 0.0001);
  let fx = au_fbm2(p.yz * scale);
  let fy = au_fbm2(p.zx * scale);
  let fz = au_fbm2(p.xy * scale);
  return fx * w.x + fy * w.y + fz * w.z;
}

fn au_coralness(p: vec3f) -> f32 {
  let seabed = p.y - au_terrain(p.xz);
  let cm = au_coral(p);
  return clamp(1.0 - smoothstep(-0.15, 0.9, cm) - clamp(seabed * 0.3, 0.0, 1.0) * 0.0, 0.0, 1.0);
}

fn au_material(p: vec3f, n: vec3f, rd: vec3f, ca: f32, bio: vec3f) -> vec3f {
  let t = au_time();

  let grain  = au_triplanar_fbm(p, n, 1.7);
  let mottle = au_triplanar_fbm(p, n, 0.45);
  let fine   = au_triplanar_fbm(p, n, 6.5);

  var rock = vec3f(0.016, 0.030, 0.036);
  rock = mix(rock, vec3f(0.030, 0.055, 0.060), mottle);
  rock *= (0.55 + 0.55 * grain);
  rock *= (0.80 + 0.30 * fine);
  let upface = clamp(dot(n, AU_UP), 0.0, 1.0);
  rock = mix(rock, rock * vec3f(1.05, 1.25, 1.15) + vec3f(0.004, 0.010, 0.008),
             upface * 0.5 * (0.4 + 0.6 * mottle));

  let cness = au_coralness(p);
  let pulse = 0.5 + 0.5 * sin(t * 0.7 + p.x * 3.0 + p.z * 2.4);
  var coral = vec3f(0.10, 0.055, 0.075);
  coral = mix(coral, vec3f(0.14, 0.10, 0.055), fine);
  coral *= (0.6 + 0.6 * grain);
  let fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
  let sss  = vec3f(0.22, 0.08, 0.12) * fres * (0.5 + 0.5 * pulse);
  coral += sss;

  var albedo = mix(rock, coral, cness);

  let amb_up  = au_medium(AU_UP);
  let amb_n   = au_medium(n);
  var col = albedo * (amb_n * 0.6 + amb_up * (0.35 + 0.55 * upface));

  let caus = ca * (0.35 + 0.65 * upface);
  col += albedo * vec3f(0.35, 0.85, 0.95) * caus * 1.4;
  col += vec3f(0.15, 0.45, 0.55) * caus * fres * (1.0 - cness) * 0.8;

  col += bio * albedo * 2.2;
  col += bio * 0.25;
  let emit = cness * (0.10 + 0.10 * pulse);
  col += vec3f(0.06, 0.16, 0.22) * emit;

  let dist = length(p - vec3f(uni(1), uni(2), uni(3)));
  let fog = 1.0 - exp(-dist * 0.045);
  col = mix(col, AU_DEEP, clamp(fog, 0.0, 0.92));

  return max(col, vec3f(0.0));
}