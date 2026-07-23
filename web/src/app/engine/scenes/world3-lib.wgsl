// WORLD3 — the cafe's shared 3D raymarching kit (canonical copy).
// Everything ONE DAY, TIDEGLASS, and MARIONETTES 3D each hand-rolled, extracted
// once: camera, SDF primitives, domain ops, marcher, normals, soft shadows,
// AO, and a standard light rig. Ship it in your scene as a module:
//
//   { "type": "define_module", "name": "world3", "wgsl": <this file> }
//
// THE ONE CONTRACT — your scene defines the world map in its OWN module:
//
//   fn w3_map(p: vec3f) -> vec2f   // returns (signed distance, material id)
//
// WGSL resolves module-scope functions in any order, so the kit's marchers can
// call w3_map before your module defines it. A scene that ships world3 without
// defining w3_map will not compile — the contract is load-bearing.
//
// CAMERA CONVENTION (whiteboard rows 60–62, so hooks can drive the eye):
//   uni4(60) = ro.xyz, fov     ·  uni4(61) = target.xyz, roll(unused)
//   A hook that writes these makes any world3 scene orbit/walk for free.
//
// Typical visual:
//   let ro = uni4(60).xyz;  let fov = max(uni4(60).w, 0.6);
//   let rd = mod_w3_ray(uv, ro, uni4(61).xyz, fov);
//   let hit = mod_w3_march(ro, rd, 0.1, 60.0, 96);
//   if (hit.x > 0.0) {
//     let pos = ro + rd * hit.x;
//     let n = mod_w3_nrm(pos, 0.02);
//     let sh = mod_w3_shadow(pos + n * 0.05, sunDir, 30.0, 8.0);
//     let ao = mod_w3_ao(pos, n);
//     col = mod_w3_light(albedoFor(i32(hit.y)), n, rd, sunDir, sunCol, skyCol, sh, ao);
//   }
// Output linear HDR — the engine's ACES + bloom do the grading.

// ── camera ─────────────────────────────────────────────────────────────────
// Ray through a screen point for a look-at camera. uv is the visual's -1..1
// (y down — the flip is handled here, pass it raw).
fn mod_w3_ray(uv: vec2f, ro: vec3f, ta: vec3f, fov: f32) -> vec3f {
  let fw = normalize(ta - ro);
  let rt = normalize(cross(fw, vec3f(0.0, 1.0, 0.0)));
  let up = cross(rt, fw);
  return normalize(uv.x * rt * fov - uv.y * up * fov + fw);
}

// ── SDF primitives (3D) ────────────────────────────────────────────────────
fn mod_w3_sphere(p: vec3f, r: f32) -> f32 { return length(p) - r; }

fn mod_w3_box(p: vec3f, b: vec3f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

fn mod_w3_rbox(p: vec3f, b: vec3f, r: f32) -> f32 {
  return mod_w3_box(p, b - vec3f(r)) - r;
}

fn mod_w3_capsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// vertical capped cylinder: half-height h, radius r
fn mod_w3_cyl(p: vec3f, h: f32, r: f32) -> f32 {
  let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

// tapered vertical cylinder: radius r0 at -h → r1 at +h (towers, spires)
fn mod_w3_cone(p: vec3f, h: f32, r0: f32, r1: f32) -> f32 {
  let t = clamp((p.y + h) / (2.0 * h), 0.0, 1.0);
  let d = abs(vec2f(length(p.xz), p.y)) - vec2f(mix(r0, r1, t), h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn mod_w3_torus(p: vec3f, R: f32, r: f32) -> f32 {
  return length(vec2f(length(p.xz) - R, p.y)) - r;
}

fn mod_w3_octa(p: vec3f, s: f32) -> f32 {
  let q = abs(p);
  return (q.x + q.y + q.z - s) * 0.57735027;
}

fn mod_w3_plane(p: vec3f, n: vec3f, d: f32) -> f32 { return dot(p, n) + d; }

// round (Roman) arch opening — subtract from a wall. Origin at base center:
// straight sides height h, half-width w (semicircle top radius w), half-depth d in z
fn mod_w3_arch(p: vec3f, w: f32, h: f32, d: f32) -> f32 {
  let dxy = abs(p.xy - vec2f(0.0, h * 0.5)) - vec2f(w, h * 0.5);
  let rect2 = length(max(dxy, vec2f(0.0))) + min(max(dxy.x, dxy.y), 0.0);
  let top2 = length(p.xy - vec2f(0.0, h)) - w;
  let d2 = min(rect2, top2);
  let wz = vec2f(d2, abs(p.z) - d);
  return min(max(wz.x, wz.y), 0.0) + length(max(wz, vec2f(0.0)));
}

// Gothic lancet (ogival/pointed) arch profile: straight sides |x|<=w up to h,
// two-arc point peaking ph above h. 2D — extrude with mod_w3_lancet.
fn mod_w3_lancet2(q: vec2f, w: f32, h: f32, ph: f32) -> f32 {
  let R = (w * w + ph * ph) / (2.0 * w);
  let c = R - w;
  let dxy = abs(q - vec2f(0.0, h * 0.5)) - vec2f(w, h * 0.5);
  let rect = length(max(dxy, vec2f(0.0))) + min(max(dxy.x, dxy.y), 0.0);
  let arcs = max(length(q - vec2f(-c, h)) - R, length(q - vec2f(c, h)) - R);
  let top = max(arcs, h - q.y);
  return min(rect, top);
}

// Gothic lancet arch opening in 3D — subtract from a wall. Base center origin,
// half-width w, straight height h, point rises ph above h, half-depth d in z
fn mod_w3_lancet(p: vec3f, w: f32, h: f32, ph: f32, d: f32) -> f32 {
  let d2 = mod_w3_lancet2(p.xy, w, h, ph);
  let wz = vec2f(d2, abs(p.z) - d);
  return min(max(wz.x, wz.y), 0.0) + length(max(wz, vec2f(0.0)));
}

// ── domain ops ─────────────────────────────────────────────────────────────
fn mod_w3_rotX(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}
fn mod_w3_rotY(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn mod_w3_rotZ(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}
// infinite repetition on chosen axes (c = cell size per axis; 0 = no repeat)
fn mod_w3_repeat(p: vec3f, c: vec3f) -> vec3f {
  var q = p;
  if (c.x > 0.0) { q.x = (fract(p.x / c.x + 0.5) - 0.5) * c.x; }
  if (c.y > 0.0) { q.y = (fract(p.y / c.y + 0.5) - 0.5) * c.y; }
  if (c.z > 0.0) { q.z = (fract(p.z / c.z + 0.5) - 0.5) * c.z; }
  return q;
}
// polar repetition around Y: n copies; returns p in the first wedge
fn mod_w3_polar(p: vec3f, n: f32) -> vec3f {
  let ang = 6.2831853 / n;
  let a = atan2(p.z, p.x);
  let r = length(p.xz);
  let a2 = (fract(a / ang + 0.5) - 0.5) * ang;
  return vec3f(cos(a2) * r, p.y, sin(a2) * r);
}

// ── the marcher family (all call YOUR w3_map) ──────────────────────────────
// sphere-trace: returns (t, material) on hit, (-1, -1) on miss
fn mod_w3_march(ro: vec3f, rd: vec3f, tmin: f32, tmax: f32, steps: i32) -> vec2f {
  var t = tmin;
  for (var i = 0; i < 256; i++) {
    if (i >= steps) { break; }
    let dm = w3_map(ro + rd * t);
    if (dm.x < 0.001 * t + 0.003) { return vec2f(t, dm.y); }
    t = t + max(dm.x * 0.9, 0.004);
    if (t > tmax) { break; }
  }
  return vec2f(-1.0, -1.0);
}

// tetrahedral 4-tap normal
fn mod_w3_nrm(p: vec3f, eps: f32) -> vec3f {
  let k = vec2f(1.0, -1.0);
  return normalize(
    k.xyy * w3_map(p + k.xyy * eps).x +
    k.yyx * w3_map(p + k.yyx * eps).x +
    k.yxy * w3_map(p + k.yxy * eps).x +
    k.xxx * w3_map(p + k.xxx * eps).x);
}

// soft shadow toward a light: k = penumbra hardness (8 soft … 32 crisp)
fn mod_w3_shadow(p: vec3f, ld: vec3f, tmax: f32, k: f32) -> f32 {
  var t = 0.03;
  var sh = 1.0;
  for (var i = 0; i < 24; i++) {
    let d = w3_map(p + ld * t).x;
    sh = min(sh, k * d / t);
    t = t + clamp(d, 0.02, 0.8);
    if (sh < 0.02 || t > tmax) { break; }
  }
  return clamp(sh, 0.0, 1.0);
}

// 4-tap ambient occlusion along the normal
fn mod_w3_ao(p: vec3f, n: vec3f) -> f32 {
  var occ = 0.0;
  var w = 1.0;
  for (var i = 1; i <= 4; i++) {
    let h = 0.04 * f32(i * i);
    occ = occ + w * (h - w3_map(p + n * h).x);
    w = w * 0.65;
  }
  return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

// ── shading ────────────────────────────────────────────────────────────────
fn mod_w3_fresnel(n: vec3f, rd: vec3f, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 5.0);
}

// the standard rig: sun key + sky fill + bounce, shadow and AO applied where
// each belongs (shadow kills the key, AO dims the fill), plus a spec lobe
fn mod_w3_light(alb: vec3f, n: vec3f, rd: vec3f, sunDir: vec3f, sunCol: vec3f, skyCol: vec3f, sh: f32, ao: f32) -> vec3f {
  let dif = clamp(dot(n, sunDir), 0.0, 1.0);
  let sky = 0.5 + 0.5 * n.y;
  let bou = clamp(-n.y, 0.0, 1.0) * 0.3;
  var c = alb * (sunCol * dif * sh + skyCol * sky * ao + skyCol * bou * ao);
  let hal = normalize(sunDir - rd);
  let spe = pow(clamp(dot(n, hal), 0.0, 1.0), 32.0) * dif * sh;
  c = c + sunCol * spe * 0.5 * mod_w3_fresnel(n, rd, 0.04);
  return c;
}

// aerial perspective: fold a hit color into the sky with distance
fn mod_w3_fog(c: vec3f, skyC: vec3f, t: f32, density: f32) -> vec3f {
  return mix(c, skyC, 1.0 - exp(-t * t * density));
}
