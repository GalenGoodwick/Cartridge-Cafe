// ═══════════════════════════════════════════════════════════════
// FABLE VISTA — golden hour mountain lake
// Raymarched eroded-fractal terrain, animated water with true
// reflections, aerial perspective, sun-kissed clouds.
// Perf: LOD octaves by distance, ceiling-capped rays, lean shadows.
// ═══════════════════════════════════════════════════════════════

// Value noise with analytic derivatives (quintic interpolation).
// Returns (value in [-1,1], d/dx, d/dy).
fn tr_noised(x: vec2f) -> vec3f {
  let p = floor(x);
  let f = fract(x);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let a = hash21(p);
  let b = hash21(p + vec2f(1.0, 0.0));
  let c = hash21(p + vec2f(0.0, 1.0));
  let d = hash21(p + vec2f(1.0, 1.0));
  let k1 = b - a;
  let k2 = c - a;
  let k4 = a - b - c + d;
  let val = a + k1 * u.x + k2 * u.y + k4 * u.x * u.y;
  let der = du * vec2f(k1 + k4 * u.y, k2 + k4 * u.x);
  return vec3f(val * 2.0 - 1.0, der.x * 2.0, der.y * 2.0);
}

// Eroded fractal terrain — derivative-damped fbm. Steep slopes
// suppress high frequencies, which reads as water erosion.
fn tr_terrain(p_in: vec2f, octaves: i32) -> f32 {
  var p = p_in * 0.0016;
  var a = 0.0;
  var b = 1.0;
  var d = vec2f(0.0);
  for (var i = 0; i < octaves; i++) {
    let n = tr_noised(p);
    d += n.yz;
    // First octaves ridged — connected alpine spines instead of soft dunes
    var v = n.x;
    if (i < 2) { v = (0.62 - abs(n.x)) * 1.9 - 0.28; }
    a += b * v / (1.0 + dot(d, d));
    b *= 0.5;
    p = mat2x2f(0.8, -0.6, 0.6, 0.8) * p * 2.0;
  }
  var h = a * 240.0;
  // Carved lake basin in front of the camera; taller relief beyond it
  let dv = p_in - vec2f(0.0, 520.0);
  let dist = length(dv);
  h -= 130.0 * exp(-dot(dv, dv) / (480.0 * 480.0));
  h *= 1.0 + 0.34 * smoothstep(700.0, 1900.0, dist);
  return h;
}

const TR_CEIL: f32 = 330.0; // above the highest peak — rays past this never hit

// Heightfield raymarch with interpolated hit refinement and distance LOD.
fn tr_march(ro: vec3f, rd: vec3f, tmax_in: f32, octHi: i32) -> f32 {
  var tmax = tmax_in;
  // Upward rays can only hit until they clear the ceiling
  if (rd.y > 0.001) {
    tmax = min(tmax, (TR_CEIL - ro.y) / rd.y);
    if (tmax < 0.0) { return -1.0; }
  }
  var lh = 0.0;
  var lt = 0.0;
  var t = 1.0;
  for (var i = 0; i < 64; i++) {
    if (t > tmax) { break; }
    let p = ro + rd * t;
    // LOD: fewer octaves far away (detail is sub-pixel there anyway)
    var oct = octHi;
    if (t > 140.0) { oct = octHi - 1; }
    if (t > 650.0) { oct = octHi - 2; }
    let h = p.y - tr_terrain(p.xz, oct);
    if (h < 0.004 * t) {
      return lt + (t - lt) * lh / max(lh - h, 0.001);
    }
    lh = h;
    lt = t;
    t += 0.55 * h + 0.7;
  }
  return -1.0;
}

fn tr_normal(p: vec3f, t: f32) -> vec3f {
  let e = 0.0015 * t + 0.04;
  var oct = 5;
  if (t > 400.0) { oct = 4; }
  return normalize(vec3f(
    tr_terrain(p.xz - vec2f(e, 0.0), oct) - tr_terrain(p.xz + vec2f(e, 0.0), oct),
    2.0 * e,
    tr_terrain(p.xz - vec2f(0.0, e), oct) - tr_terrain(p.xz + vec2f(0.0, e), oct)
  ));
}

// Soft terrain shadow toward the sun — coarse and cheap.
fn tr_shadow(ro: vec3f, rd: vec3f) -> f32 {
  var res = 1.0;
  var t = 10.0;
  for (var i = 0; i < 8; i++) {
    let p = ro + rd * t;
    if (p.y > TR_CEIL) { break; }
    let h = p.y - tr_terrain(p.xz, 2);
    res = min(res, 7.0 * h / t);
    if (res < 0.01) { break; }
    t += clamp(h, 10.0, 90.0);
  }
  return clamp(res, 0.0, 1.0);
}

fn tr_sky(rd: vec3f, sun: vec3f, time: f32) -> vec3f {
  let sundot = clamp(dot(rd, sun), 0.0, 1.0);
  let up = max(rd.y, 0.0);
  // Base gradient: warm haze at horizon, cool blue overhead
  var col = vec3f(0.22, 0.38, 0.64) - up * vec3f(0.18, 0.16, 0.10);
  col = mix(col, vec3f(1.08, 0.60, 0.30), pow(1.0 - up, 6.0) * 0.9);
  // Sun glows (disc comes after clouds so it punches through)
  col += vec3f(1.0, 0.55, 0.25) * 0.42 * pow(sundot, 4.0);
  col += vec3f(1.0, 0.72, 0.42) * 0.45 * pow(sundot, 48.0);
  // Clouds — sparser layer, lit warm, translucent near the sun
  if (rd.y > 0.015) {
    let cuv = (rd.xz / rd.y) * 300.0 + vec2f(time * 2.2, time * 0.6);
    var cov = fbm(cuv * 0.0045, 4);
    cov = smoothstep(0.52, 0.80, cov);
    let shade = fbm(cuv * 0.009 + vec2f(17.3, 9.1), 3);
    var ccol = mix(vec3f(1.06, 0.82, 0.66), vec3f(0.46, 0.44, 0.52), shade * 0.8);
    ccol += vec3f(1.0, 0.55, 0.28) * pow(sundot, 3.0) * 0.5;
    let fade = smoothstep(0.015, 0.14, rd.y);
    let thin = 1.0 - 0.6 * pow(sundot, 8.0);
    col = mix(col, ccol, cov * 0.85 * fade * thin);
  }
  // Sun disc — over the clouds
  col += vec3f(1.2, 0.95, 0.7) * 1.6 * pow(sundot, 1600.0);
  col += vec3f(1.1, 0.8, 0.5) * 0.35 * pow(sundot, 180.0);
  return col;
}

fn tr_fog(col: vec3f, t: f32, rd: vec3f, sun: vec3f) -> vec3f {
  let amt = 1.0 - exp(-pow(t * 0.00022, 1.5));
  let sundot = clamp(dot(rd, sun), 0.0, 1.0);
  let fogc = mix(vec3f(0.50, 0.56, 0.66), vec3f(1.02, 0.70, 0.44), pow(sundot, 5.0));
  return mix(col, fogc, amt);
}

// Terrain surface shading (golden hour palette).
fn tr_shade(p: vec3f, t: f32, rd: vec3f, sun: vec3f, withShadow: bool) -> vec3f {
  let nor = tr_normal(p, t);
  // Materials
  let strata = fbm(p.xz * 0.05, 3);
  var rock = mix(vec3f(0.23, 0.20, 0.18), vec3f(0.38, 0.33, 0.28), strata);
  rock = mix(rock, vec3f(0.30, 0.24, 0.19), fbm(p.xz * 0.013, 2) * 0.7);
  var grass = mix(vec3f(0.10, 0.16, 0.06), vec3f(0.22, 0.26, 0.10), fbm(p.xz * 0.09, 2));
  // Golden-hour dry grass patches
  grass = mix(grass, vec3f(0.34, 0.27, 0.11), fbm(p.xz * 0.021 + vec2f(31.0, 7.0), 2) * 0.55);
  let snow = vec3f(0.86, 0.90, 0.98);
  let slope = nor.y;
  var mat = mix(rock, grass,
    smoothstep(0.62, 0.82, slope) * smoothstep(95.0, 25.0, p.y));
  let snowline = 120.0 + 45.0 * fbm(p.xz * 0.008, 2);
  mat = mix(mat, snow,
    smoothstep(snowline, snowline + 22.0, p.y) * smoothstep(0.42, 0.68, slope));
  // Wet dark band at the shoreline
  mat = mix(vec3f(0.11, 0.095, 0.085), mat, smoothstep(-12.0, -7.5, p.y));
  // Lighting
  var sh = 1.0;
  if (withShadow) { sh = tr_shadow(p + nor * 1.5, sun); }
  let dif = clamp(dot(nor, sun), 0.0, 1.0) * sh;
  let skyl = clamp(0.5 + 0.5 * nor.y, 0.0, 1.0);
  let bounce = clamp(dot(nor, normalize(vec3f(-sun.x, 0.0, -sun.z))), 0.0, 1.0);
  var lin = dif * vec3f(1.35, 0.92, 0.62) * 2.9;
  lin += skyl * vec3f(0.32, 0.42, 0.58) * 0.65;
  lin += bounce * vec3f(0.34, 0.26, 0.18) * 0.30;
  var col = mat * lin;
  // Specular kiss on wet-looking rock and snow
  let hal = normalize(sun - rd);
  let spe = pow(clamp(dot(nor, hal), 0.0, 1.0), 24.0) * dif;
  col += spe * vec3f(1.0, 0.8, 0.6) * 0.25 * smoothstep(0.3, 0.6, strata);
  return tr_fog(col, t, rd, sun);
}

// Animated water height (three scales of drift).
fn tr_waterH(p: vec2f, time: f32) -> f32 {
  var h = vnoise(p * 0.055 + vec2f(time * 0.30, time * 0.16)) * 0.58;
  h += vnoise(p * 0.170 - vec2f(time * 0.24, time * 0.33)) * 0.29;
  h += vnoise(p * 0.520 + vec2f(time * 0.45, -time * 0.27)) * 0.13;
  return h;
}

fn tr_waterNor(p: vec2f, time: f32, dist: f32) -> vec3f {
  // Wave detail flattens with distance to avoid shimmer
  let amp = 1.35 / (1.0 + dist * 0.016);
  let e = 0.9;
  let hC = tr_waterH(p, time);
  let hX = tr_waterH(p + vec2f(e, 0.0), time);
  let hZ = tr_waterH(p + vec2f(0.0, e), time);
  return normalize(vec3f((hC - hX) * amp, e, (hC - hZ) * amp));
}

fn visual_fable_vista(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // ── Camera: slow drift across the lake, gentle yaw ──
  let yaw = sin(time * 0.021) * 0.07;
  let waterY = -14.0;
  var ro = vec3f(0.0, waterY + 15.5 + sin(time * 0.12) * 0.35, -130.0);

  var rd = normalize(vec3f(uv.x * 1.30, -uv.y * 1.30 - 0.045, 1.55));
  let cy = cos(yaw);
  let sy = sin(yaw);
  rd = vec3f(cy * rd.x + sy * rd.z, rd.y, -sy * rd.x + cy * rd.z);

  let sun = normalize(vec3f(0.10, 0.145, 0.92));

  // ── Primary ray ──
  var color: vec3f;

  // Water plane intersection first — terrain beyond the water hit can never
  // be visible, so cap the march there (big win for the lower half of frame)
  var tWat = -1.0;
  if (rd.y < -0.001) { tWat = (waterY - ro.y) / rd.y; }
  var tCap = 4200.0;
  if (tWat > 0.0) { tCap = tWat + 1.0; }
  let tTer = tr_march(ro, rd, tCap, 5);

  let hitWater = tWat > 0.0 && (tTer < 0.0 || tWat < tTer);

  if (hitWater) {
    // ── Water: waves, Fresnel, true reflected terrain ──
    let wp = ro + rd * tWat;
    let wn = tr_waterNor(wp.xz, time, tWat);
    var rrd = reflect(rd, wn);
    rrd.y = max(rrd.y, 0.015); // keep reflections above the surface
    rrd = normalize(rrd);

    let fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(-rd, wn), 0.0, 1.0), 5.0);

    // Reflected world (no shadows in reflections — the eye can't tell)
    let rro = vec3f(wp.x, wp.y + 0.15, wp.z);
    var refl: vec3f;
    let tRef = tr_march(rro, rrd, 750.0, 4);
    if (tRef > 0.0) {
      refl = tr_shade(rro + rrd * tRef, tRef + tWat, rrd, sun, false);
    } else {
      refl = tr_sky(rrd, sun, time);
    }

    // Water body: deep teal, slightly lighter in the shallows
    let deep = vec3f(0.015, 0.058, 0.062);
    let body = mix(deep, vec3f(0.03, 0.10, 0.10), vnoise(wp.xz * 0.01) * 0.5);
    color = mix(body, refl, fres);

    // Sun glint — sharp specular off the wave normals
    let glint = pow(clamp(dot(rrd, sun), 0.0, 1.0), 420.0);
    color += vec3f(1.2, 0.9, 0.6) * glint * fres * 4.0;

    color = tr_fog(color, tWat, rd, sun);
  } else if (tTer > 0.0) {
    color = tr_shade(ro + rd * tTer, tTer, rd, sun, true);
  } else {
    color = tr_sky(rd, sun, time);
  }

  // Output linear HDR — the engine post pass applies ACES + bloom itself.
  // Slight exposure lift so post-ACES mids sit right on screen.
  color *= 1.55;

  return vec4f(color, 1.0);
}
