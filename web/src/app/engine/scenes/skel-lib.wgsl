// skel-lib — the canonical procedural-creature module for the Field Engine.
// Ship it in a scene via  modules: [{ name: 'skel', wgsl: <this file> }]
// (drop the fns you don't use; scenes should stay self-contained).
// Proven across the MARIONETTES ladder: bones → pixel skin → HD → smooth →
// APEX lighting → raymarched 3D volumes. See scenes/README.md for the tour.
//
// Conventions:
// - Body space is 44 units across (uv * 22). Joints are vec2f in body units.
// - Fields never rotate: heading arrives via visualParams[0] and joints are
//   rotated in-shader BEFORE any pixel quantization (keeps texels screen-
//   aligned for pixel-art skins; irrelevant but harmless for smooth skins).
// - Standard creature params contract: [heading, gaitPhaseCycles,
//   reachAngleWorld, reach01].
// - Gait phase is in CYCLES and must be advanced by DISTANCE in the step
//   hook:  S.ph += (speed / stridePx) * dt   with
//   stridePx = 2 * strideLen * pxPerBodyUnit / duty  — this is what makes
//   stance feet planted (zero world velocity) instead of skating.

// ── pixel-art quantization ──
// Snap uv to texel centers; res = texels across the field. 3 screen px per
// texel reads as classic pixel art; 1.5-2 px as "hi-bit".
fn mod_px(uv: vec2f, res: f32) -> vec2f {
  let t = (uv * 0.5 + vec2f(0.5)) * res;
  return floor(t) + vec2f(0.5) - vec2f(res * 0.5);
}

// ── 2D skeleton primitives ──
fn mod_seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(p - a - ab * h);
}
// 1-texel bone line (pixel skins): step threshold ~0.55
fn mod_bone(p: vec2f, a: vec2f, b: vec2f, w: f32) -> f32 {
  return step(mod_seg(p, a, b), w);
}
// diamond joint marker (pixel skins)
fn mod_node(p: vec2f, c: vec2f, r: f32) -> f32 {
  let d = abs(p - c);
  return step(d.x + d.y, r);
}
// capsule flesh (smooth skins): combine with opSmoothUnion(d, mod_cap(...), k)
fn mod_cap(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  return mod_seg(p, a, b) - r;
}

// ── 3D lift: same joints, capsules gain a z-axis (segments in the z=0 plane).
// Mechanical sd→sd3 transform: mod_cap(q, → mod_cap3(p,  and
// length(q - X) - r → mod_sph3(p, X, r). Then orthographic raymarch
// (camera z=-9, ray +z) gives real normals / marched shadows / AO.
fn mod_cap3(p: vec3f, a: vec2f, b: vec2f, r: f32) -> f32 {
  let a3 = vec3f(a, 0.0);
  let ab = vec3f(b - a, 0.0);
  let h = clamp(dot(p - a3, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(p - a3 - ab * h) - r;
}
fn mod_sph3(p: vec3f, c: vec2f, r: f32) -> f32 {
  return length(p - vec3f(c, 0.0)) - r;
}

// ── planted gait ──
// phc in stride cycles (distance-advanced, see header). Returns
// (x offset along local forward, y lift — negative is off the ground).
// Stance (cyc < duty): foot drives linearly back at exactly body speed.
// Swing: smooth eased return with a sine lift arc.
// Leg phase offsets: biped 0/0.5 · quadruped walk 0/0.5/0.25/0.75 ·
// hexapod tripod 0/0.5 by alternating group.
fn mod_gait(phc: f32, duty: f32, len: f32, lift: f32) -> vec2f {
  let cyc = fract(phc);
  if (cyc < duty) {
    let t = cyc / duty;
    return vec2f(len - 2.0 * len * t, 0.0);
  }
  let t = (cyc - duty) / (1.0 - duty);
  let e = t * t * (3.0 - 2.0 * t);
  return vec2f(-len + 2.0 * len * e, -sin(t * 3.14159) * lift);
}

// ── shading helpers ──
// per-texel checker (dither carrier for pixel skins)
fn mod_chk(c: vec2f) -> f32 {
  return f32((i32(c.x + 200.0) + i32(c.y + 200.0)) % 2);
}
// checker-dithered band quantization: hi-bit cel shading
fn mod_band(lum: f32, c: vec2f, steps: f32) -> f32 {
  let lq = clamp(lum, 0.0, 1.0) * steps;
  let fl = floor(lq);
  let fr = lq - fl;
  let dith = step(0.75 - mod_chk(c) * 0.5, fr);
  return clamp((fl + dith) / steps, 0.0, 1.0);
}
// 3-stop color ramp (works banded or continuous)
fn mod_ramp(dark: vec3f, base: vec3f, lite: vec3f, t: f32) -> vec3f {
  let lo = clamp(t * 2.0, 0.0, 1.0);
  let hi = clamp(t * 2.0 - 1.0, 0.0, 1.0);
  return mix(mix(dark, base, lo), lite, hi);
}
// periodic eye blink; give each creature a distinct seed
fn mod_blink(time: f32, seed: f32) -> f32 {
  return step(fract(time * 0.31 + seed), 0.06);
}
