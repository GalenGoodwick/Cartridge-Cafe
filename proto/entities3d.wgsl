// PROTOTYPE — the universal entity model, 3D half. Geometry is DATA (the
// population buffer), not code: each entity is 2 vec4 rows —
//   row0 = (pos.x, pos.y, pos.z, kind)
//   row1 = (yaw,   scale,  id,    spare)
// The raymarch reads them, unions their SDFs in ONE shared perspective camera,
// and carries the hit entity's ID out of the march — that id is what a hit-map
// would write, and what inspect/collision/AI read. Kinds are a small library
// (sphere/box/tree); a real system swaps a kind for a baked impostor texture to
// skip the march. Nothing here is hardcoded per-object — add a row, get an object.
fn e3_sdSphere(p: vec3f, r: f32) -> f32 { return length(p) - r; }
fn e3_sdBox(p: vec3f, b: vec3f) -> f32 { let q = abs(p) - b; return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0); }
fn e3_rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }

// SDF for a kind, in the entity's own local (un-posed, unit-scaled) frame.
fn e3_kindSDF(kind: i32, p: vec3f) -> f32 {
  if (kind == 1) { return e3_sdBox(p, vec3f(0.5, 0.5, 0.5)); }
  if (kind == 2) {                                  // a "tree": trunk + canopy
    let trunk = e3_sdBox(p - vec3f(0.0, -0.35, 0.0), vec3f(0.12, 0.5, 0.12));
    let canopy = e3_sdSphere(p - vec3f(0.0, 0.45, 0.0), 0.6);
    return min(trunk, canopy);
  }
  return e3_sdSphere(p, 0.5);                        // kind 0 = sphere (default)
}

// world SDF: nearest surface over ALL entities → (distance, hit id).
// id = -2 for the ground plane, -1 for nothing.
fn e3_map(p: vec3f) -> vec2f {
  var best = 1e9;
  var id = -1.0;
  let n = popCount() / 2;                            // 2 rows per entity
  for (var k = 0; k < n; k = k + 1) {
    let r0 = pop(k * 2);
    let r1 = pop(k * 2 + 1);
    let pos = r0.xyz;
    let kind = i32(r0.w);
    let yaw = r1.x;
    let scale = max(r1.y, 0.01);
    let lp = e3_rotY(p - pos, -yaw) / scale;
    let d = e3_kindSDF(kind, lp) * scale;
    if (d < best) { best = d; id = r1.z; }
  }
  let g = p.y + 1.0;                                 // ground
  if (g < best) { best = g; id = -2.0; }
  return vec2f(best, id);
}

fn e3_normal(p: vec3f) -> vec3f {
  let e = vec2f(0.0015, 0.0);
  return normalize(vec3f(
    e3_map(p + e.xyy).x - e3_map(p - e.xyy).x,
    e3_map(p + e.yxy).x - e3_map(p - e.yxy).x,
    e3_map(p + e.yyx).x - e3_map(p - e.yyx).x));
}

fn visual_e3(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // shared perspective camera (the whole scene, one march — objects occlude
  // correctly). Orbits by uni(0) so the scene reads as genuine 3D.
  let ang = uni(0);
  let rad = 6.2;
  let ro = vec3f(sin(ang) * rad, 1.7, -cos(ang) * rad);
  let ta = vec3f(0.0, 0.2, 0.0);
  let fwd = normalize(ta - ro);
  let rgt = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, rgt);
  let rd = normalize(fwd + uv.x * 1.15 * rgt + uv.y * 1.15 * up);

  var t = 0.02;
  var hitId = -1.0;
  var hit = false;
  for (var i = 0; i < 110; i = i + 1) {
    let p = ro + rd * t;
    let m = e3_map(p);
    if (m.x < 0.001) { hitId = m.y; hit = true; break; }
    t = t + m.x;
    if (t > 40.0) { break; }
  }
  if (!hit) { return vec4f(0.03, 0.045, 0.07, 1.0); }   // sky

  let p = ro + rd * t;
  let nrm = e3_normal(p);
  let ld = normalize(vec3f(0.5, 0.85, -0.35));
  let diff = max(dot(nrm, ld), 0.0);

  // ground: neutral; entities: a distinct per-ID hue — proving each row is a
  // DISTINCT, addressable object (the pick payoff, made visible).
  var base = vec3f(0.16, 0.18, 0.22);
  if (hitId >= 0.0) {
    let h = hitId * 1.7;
    base = 0.55 + 0.4 * vec3f(sin(h), sin(h + 2.1), sin(h + 4.2));
  }
  var col = base * (0.22 + 0.85 * diff);

  // SELECTION by ID: uni(1) names the selected entity — it glows gold. This is
  // exactly what inspect/click does: read the hit id, address THAT object. No
  // geometry knowledge needed, works identically in 2D.
  let sel = uni(1);
  if (hitId >= 0.0 && abs(hitId - sel) < 0.5) {
    col = mix(col, vec3f(1.0, 0.85, 0.3), 0.55);
    col += vec3f(0.25, 0.2, 0.05) * pow(1.0 - max(dot(nrm, -rd), 0.0), 2.0);  // rim
  }
  return vec4f(col, 1.0);
}
