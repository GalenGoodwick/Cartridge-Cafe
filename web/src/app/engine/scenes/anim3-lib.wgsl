// ANIM3 — articulated-chain animation kit (canonical copy).
// The layer between skel-lib (creature rigs) and world3 (raymarched space):
// two-bone IK, tapered limb SDFs, gait oscillators with planted feet, pose
// paths, and aim frames — everything needed to make a marched body MOVE well.
//
//   { "type": "define_module", "name": "anim3", "wgsl": <this file> }
//
// Design: everything is STATELESS — pure functions of time and parameters, so
// they run per-pixel in a visual with no CPU sync. Drive the inputs (targets,
// phases, headings) from a step hook via the whiteboard or the population
// buffer; the shader poses the body.
//
// The crowd pattern: hook publishes gpuPopulation entries [x, y, heading, phase]
// → the visual loops pop(i), builds each body in its local frame with
// mod_a3_gait(phase …) driving the legs. 4095 walkers, one dispatch.

// ── two-bone IK ────────────────────────────────────────────────────────────
// Classic solver: a chain root→mid→tip with segment lengths l1, l2 reaching
// for `target`. Returns the MID joint (elbow/knee). `pole` bends the joint
// toward it (knee forward, elbow back) — give it a point, not a direction.
// Unreachable targets clamp to full extension; degenerate poles self-heal.
fn mod_a3_ik2(root: vec3f, target: vec3f, l1: f32, l2: f32, pole: vec3f) -> vec3f {
  var to = target - root;
  var d = length(to);
  let maxR = l1 + l2 - 0.0001;
  d = clamp(d, abs(l1 - l2) + 0.0001, maxR);
  let dir = to / max(length(to), 0.0001);
  // law of cosines: distance from root to the mid joint's projection
  let a = (l1 * l1 - l2 * l2 + d * d) / (2.0 * d);
  let h = sqrt(max(l1 * l1 - a * a, 0.0));
  // bend plane: contains the chain axis, leans toward the pole
  var side = pole - root - dir * dot(pole - root, dir);
  let sl = length(side);
  if (sl < 0.001) { side = vec3f(0.0, 0.0, 1.0) - dir * dir.z; } else { side = side / sl; }
  return root + dir * a + normalize(side) * h;
}

// ── limb geometry ──────────────────────────────────────────────────────────
// tapered capsule: radius r0 at `a` → r1 at `b` (thigh→ankle, arm→wrist)
fn mod_a3_bone(p: vec3f, a: vec3f, b: vec3f, r0: f32, r1: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(r0, r1, h);
}
// joint ball — drop one at every hinge to keep silhouettes smooth
fn mod_a3_joint(p: vec3f, at: vec3f, r: f32) -> f32 { return length(p - at) - r; }

// ── gait ───────────────────────────────────────────────────────────────────
// The planted-foot law (lifted from skel-lib's ladder): phase advances in
// STRIDE CYCLES (hook: ph += speed / strideLen * dt). Within one cycle a foot
// is planted for `duty` (moving backward at exactly body speed → zero world
// velocity) and swings forward for the rest, lifted on a sine arc.
// Returns (alongOffset, lift): foot position relative to its rest point,
// in units of strideLen.
fn mod_a3_gait(phase: f32, duty: f32) -> vec2f {
  let c = fract(phase);
  if (c < duty) {
    // stance: linear back-travel, no lift — the foot OWNS the ground
    let s = c / duty;
    return vec2f(0.5 - s, 0.0);
  }
  // swing: forward and up
  let s = (c - duty) / (1.0 - duty);
  return vec2f(-0.5 + s, sin(s * 3.14159) * 1.0);
}
// eased oscillator for secondary motion (tails, breathing, sway):
// sin with adjustable sharpness — sharp > 1 dwells at the extremes
fn mod_a3_sway(t: f32, freq: f32, sharp: f32) -> f32 {
  let s = sin(t * freq);
  return sign(s) * pow(abs(s), 1.0 / max(sharp, 0.001));
}

// ── pose paths ─────────────────────────────────────────────────────────────
// blend two joint positions (a pose is just a set of points — lerp each)
fn mod_a3_mix(a: vec3f, b: vec3f, t: f32) -> vec3f { return mix(a, b, smoothstep(0.0, 1.0, t)); }
// quadratic bezier through a lifted midpoint — a reach, a leap, a nod
fn mod_a3_arc(a: vec3f, peak: vec3f, b: vec3f, t: f32) -> vec3f {
  let u = 1.0 - t;
  return a * u * u + peak * 2.0 * u * t + b * t * t;
}

// ── aim frames ─────────────────────────────────────────────────────────────
// build a basis aimed along `fw` (head look-at, torso facing); transform a
// local point into it. worldUp guards collinearity.
fn mod_a3_aim(local: vec3f, origin: vec3f, fw0: vec3f) -> vec3f {
  let fw = normalize(fw0);
  var up = vec3f(0.0, 1.0, 0.0);
  if (abs(dot(fw, up)) > 0.99) { up = vec3f(0.0, 0.0, 1.0); }
  let rt = normalize(cross(up, fw));
  let u2 = cross(fw, rt);
  return origin + rt * local.x + u2 * local.y + fw * local.z;
}

// ── a whole walker, as the pattern to copy ─────────────────────────────────
// Biped legs in one call: body at `hips` heading +z in its local frame,
// phase in stride cycles, stride length L. Returns the SDF of both legs.
// (Offset the two feet half a cycle; IK bends knees toward the pole.)
fn mod_a3_legs(p: vec3f, hips: vec3f, phase: f32, L: f32, legLen: f32, r: f32) -> f32 {
  var d = 1e9;
  for (var s = 0; s < 2; s++) {
    let side = select(-1.0, 1.0, s == 1);
    let g = mod_a3_gait(phase + select(0.0, 0.5, s == 1), 0.55);
    let hip = hips + vec3f(side * legLen * 0.22, 0.0, 0.0);
    let foot = vec3f(hip.x, g.y * legLen * 0.22, g.x * L);
    let knee = mod_a3_ik2(hip, foot, legLen * 0.52, legLen * 0.52, hip + vec3f(0.0, 0.0, legLen));
    d = min(d, mod_a3_bone(p, hip, knee, r, r * 0.75));
    d = min(d, mod_a3_bone(p, knee, foot, r * 0.75, r * 0.5));
    d = min(d, mod_a3_joint(p, knee, r * 0.85));
  }
  return d;
}
