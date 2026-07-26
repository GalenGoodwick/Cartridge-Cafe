// shooter3 / projectiles — thin glowing energy bolts (tracers)
// Cheap capsule SDF + emissive HDR color the renderer adds on hit-glow.
// Exports:
//   s3_tracer(p, a, b)            -> f32   thin bolt from a to b (radius ~0.06)
//   s3_tracerColor(kind, life01)  -> vec3f linear HDR emissive (3=player, 4=enemy)

// A thin glowing bolt: a capsule from a to b. Cheap — one clamp/dot/length.
fn s3_tracer(p: vec3f, a: vec3f, b: vec3f) -> f32 {
  return mod_w3_capsule(p, a, b, 0.06);
}

// Emissive HDR color the renderer adds. Brightest when freshly fired (life01~1),
// fading toward death (life01~0). kind 3 = player (hot cyan-white), 4 = enemy (sick green).
fn s3_tracerColor(kind: f32, life01: f32) -> vec3f {
  let l = clamp(life01, 0.0, 1.0);
  // hot core (near-white at spawn) blended toward the tinted tail as it ages
  let playerHot  = vec3f(0.55, 1.0, 1.0);   // cyan
  let playerCore = vec3f(1.0, 1.0, 1.0);    // white-hot
  let enemyHot   = vec3f(0.35, 1.0, 0.15);  // sick green
  let enemyCore  = vec3f(0.85, 1.0, 0.6);   // pale green-white
  let isEnemy = step(3.5, kind);            // 0 for kind<=3, 1 for kind>=4
  let hot  = mix(playerHot, enemyHot, isEnemy);
  let core = mix(playerCore, enemyCore, isEnemy);
  // core dominates when fresh; tint takes over as it fades
  let tint = mix(hot, core, l);
  // HDR emission: strong when fresh, glowing dim tail when old
  let energy = mix(1.2, 9.0, l * l);
  return tint * energy;
}
