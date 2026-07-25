// ============================================================
// AUREON — VISUAL : drift through the bioluminescent abyss
// ============================================================
fn visual_aureon(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = uni(0);

  // ---- camera: slow weightless float + sway through the abyss ----
  let ro = vec3f(
    sin(t * 0.07) * 1.6,
    2.3 + sin(t * 0.11) * 0.55,
    -6.5 + sin(t * 0.05) * 1.3
  );
  let ta = vec3f(
    sin(t * 0.04) * 0.7,
    1.4 + sin(t * 0.09) * 0.35,
    0.6
  );

  let fwd = normalize(ta - ro);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  // gentle roll on the current
  let roll = sin(t * 0.06) * 0.06;
  let cr = cos(roll);
  let sr = sin(roll);
  let r2 = right * cr + up * sr;
  let u2 = up * cr - right * sr;

  let fov = 1.25;
  let rd = normalize(fwd + uv.x * r2 * fov + uv.y * u2 * fov);

  // ---- background: deep-water medium ----
  var col = au_medium(rd);

  // ---- environment march (seabed / coral / kelp) ----
  let tH = au_march(ro, rd);
  if (tH > 0.0) {
    let p = ro + rd * tH;
    let n = au_nrm(p);
    let ca = au_caustics(p, t);
    let bio = au_biolume(p, t);
    var surf = au_material(p, n, rd, ca, bio);

    // subsurface back-light through thin coral tips / membranes
    let sss = au_sss(p, n, rd, 0.5);
    surf += au_medium(AU_UP) * sss * 0.9 + vec3f(0.06, 0.20, 0.24) * sss * 0.6;

    // additive biolume glow on top
    surf += bio * 0.55;

    col = surf;
  }

  // ---- composite jellyfish (marched, translucent, among the environment) ----
  let maxJT = select(60.0, tH, tH > 0.0);
  var jt = 0.02;
  var jhit = -1.0;
  for (var i = 0; i < 96; i = i + 1) {
    let jp = ro + rd * jt;
    let d = au_jelly(jp, t);
    if (d < 0.001 * jt + 0.0006) {
      jhit = jt;
      break;
    }
    jt += d * 0.9;
    if (jt > maxJT || jt > 60.0) {
      break;
    }
  }
  if (jhit > 0.0) {
    let jp = ro + rd * jhit;
    let e = vec2f(0.0016, 0.0);
    let jn = normalize(vec3f(
      au_jelly(jp + e.xyy, t) - au_jelly(jp - e.xyy, t),
      au_jelly(jp + e.yxy, t) - au_jelly(jp - e.yxy, t),
      au_jelly(jp + e.yyx, t) - au_jelly(jp - e.yyx, t)
    ));
    let jm = au_jellyMat(jp, jn, rd, t);
    col = mix(col, jm.rgb, jm.a);
    // brightest pulse leaks a little extra emissive over the composite
    col += jm.rgb * jm.a * 0.25;
  }

  // ---- volumetrics over everything: god-rays + plankton + fog ----
  col += au_volume(ro, rd, tH);

  // ---- filmic finish ------------------------------------------------
  // physical-ish bloom feel: let emissives exceed 1.0 and bleed softly
  let over = max(col - vec3f(1.0), vec3f(0.0));
  col += over * 0.55;

  // ACES-ish filmic tonemap
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let dd = 0.59;
  let ee = 0.14;
  var mapped = clamp((col * (a * col + b)) / (col * (c * col + dd) + ee),
                     vec3f(0.0), vec3f(1.0));

  // subtle cool vignette
  let vd = length(uv);
  let vig = 1.0 - 0.38 * smoothstep(0.55, 1.7, vd);
  mapped *= vig;
  // cool tint sinking into the edges
  mapped = mix(mapped * vec3f(0.72, 0.84, 1.02), mapped, vig);

  // very slight blue grade + deep blacks
  mapped = mix(mapped, mapped * vec3f(0.90, 0.96, 1.06), 0.18);
  mapped = max(mapped - vec3f(0.004, 0.003, 0.0), vec3f(0.0));

  return vec4f(mapped, 1.0);
}