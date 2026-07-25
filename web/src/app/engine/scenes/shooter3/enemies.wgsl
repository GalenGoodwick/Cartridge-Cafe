// enemies (node: enemies) — shared enemy shading helper. The enemy BODY draw is
// routed through veilfire/demons.wgsl's vf_demon inside renderer-mega; this holds
// the damage-flash tint the renderer can blend by hp so hurt demons read hot.
fn s3_enemyTint(hp01: f32) -> vec3f {
  return mix(vec3f(1.0, 0.28, 0.16), vec3f(0.11, 0.05, 0.045), clamp(hp01, 0.0, 1.0));
}
