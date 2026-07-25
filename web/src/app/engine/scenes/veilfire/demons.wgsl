// VEILFIRE — DEMONS. A gaunt, hunched, horned humanoid that WALKS.
// Built entirely from anim3-lib tapered-capsule bones + world3 struts so it reads
// as a silhouette at the edge of lantern light. Legs are driven by the planted-foot
// gait (mod_a3_gait(phase, 0.55)); arms counter-swing; head carries swept horns and
// a jutting snarl. Distance only — the integrator paints material / ember-crust.
//
//   { "type": "define_module", "name": "veilfire_demons", "wgsl": <this file> }
//
// EXPORT:  fn vf_demon(p: vec3f, phase: f32) -> f32
//   p     : local body space (heading +z, feet near y=0, center at origin)
//   phase : stride-cycle phase (fract cycles). Same phase feeds the population's
//           animPhase slot (pop(2i+1).y).
// Depends on world3-lib (mod_w3_taperStrut) + anim3-lib (bone/joint/gait/ik2/legs).

// fleshy smooth-union — organic joints without gaps; k small = tight seam
fn vf_smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn vf_demon(p: vec3f, phase: f32) -> f32 {
  let hipY = 0.88;      // hip height — feet reach y≈0
  let L = 0.5;          // stride length
  let legLen = 0.95;    // thigh+shin reach

  // ── legs: planted-foot gait, gaunt shins ─────────────────────────────────
  var d = mod_a3_legs(p, vec3f(0.0, hipY, 0.0), phase, L, legLen, 0.075);

  // subtle breathing / menace sway of the upper body
  let breathe = sin(phase * 6.2831853) * 0.02;

  // ── spine (hunched forward) + head + snarling jaw ────────────────────────
  let pelvis = vec3f(0.0, hipY, 0.0);
  let chest  = vec3f(0.0, hipY + 0.42, 0.10);
  let neck   = vec3f(0.0, hipY + 0.60, 0.16);
  let headC  = vec3f(0.0, hipY + 0.76, 0.20 + breathe);

  var body = mod_a3_bone(p, pelvis, chest, 0.11, 0.15);                 // gaunt ribcage
  body = vf_smin(body, mod_a3_bone(p, chest, neck, 0.13, 0.06), 0.08);  // taper to neck
  body = vf_smin(body, mod_a3_joint(p, headC, 0.14), 0.06);            // skull
  body = vf_smin(body,                                                  // jutting snarl
    mod_a3_bone(p, headC + vec3f(0.0, -0.02, 0.05), headC + vec3f(0.0, -0.06, 0.16), 0.09, 0.03), 0.05);
  d = min(d, body);

  // ── horns: swept up and back, crisp edges ────────────────────────────────
  for (var s = 0; s < 2; s++) {
    let sx = select(-1.0, 1.0, s == 1);
    let hb = headC + vec3f(sx * 0.08, 0.08, -0.02);
    let ht = headC + vec3f(sx * 0.16, 0.30, -0.18);
    d = min(d, mod_w3_taperStrut(p, hb, ht, 0.035, 0.004));
  }

  // ── arms: long, clawed, counter-swinging to the legs ─────────────────────
  for (var s = 0; s < 2; s++) {
    let sx = select(-1.0, 1.0, s == 1);
    // opposite phase offset to the same-side leg → natural counter-swing
    let g = mod_a3_gait(phase + select(0.5, 0.0, s == 1), 0.55);
    let shoulder = vec3f(sx * 0.20, hipY + 0.48, 0.06);
    let hand = vec3f(sx * 0.17, hipY - 0.32, 0.16 - g.x * 0.55);        // reach to mid-thigh
    let pole = shoulder + vec3f(sx * 0.35, -0.1, -0.35);               // elbow back/out
    let elbow = mod_a3_ik2(shoulder, hand, 0.44, 0.46, pole);
    var arm = mod_a3_bone(p, shoulder, elbow, 0.06, 0.045);
    arm = min(arm, mod_a3_bone(p, elbow, hand, 0.045, 0.028));
    arm = min(arm, mod_a3_joint(p, elbow, 0.05));
    // three splayed talons
    for (var c = 0; c < 3; c++) {
      let ca = (f32(c) - 1.0) * 0.12;
      let tip = hand + vec3f(sx * 0.03 + ca * 0.05, -0.14, 0.06 + ca * 0.02);
      arm = min(arm, mod_w3_taperStrut(p, hand, tip, 0.022, 0.002));
    }
    d = vf_smin(d, arm, 0.04);
  }

  return d;
}
