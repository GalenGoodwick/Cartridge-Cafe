// VEILFIRE · rooms.wgsl — the load-bearing scene SDF (vf-rooms node).
// EXPORT: fn w3_map(p: vec3f) -> vec2f  = (signed distance, material id).
//
// A WALKABLE Antichamber-style Gothic interior, carved SUBTRACTIVELY out of a
// solid rock block so rooms connect by construction (no coordinate seams):
//   d = solidBlock;  d = max(d, -naveAir);  d = max(d, -sideAir);  d = max(d, -door);
// then solids (columns, dais) are UNIONed back in with min(). Positive in open
// air, 0 at surfaces, negative inside rock — raymarchable from inside.
//
// ── ROOM EXTENTS (world units, y=0 is the floor) — movement/vf-* MIRROR THIS ──
//   NAVE (main hall):  x∈[-4, 4]   y∈[0, 9]   z∈[-9, 9]     (tall)
//   SIDE CHAMBER:      x∈[ 5,11]   y∈[0, 5]   z∈[-3.5, 3.5] (lower ceiling)
//   DIVIDING WALL:     x∈[ 4, 5]  (1 thick) — solid except the doorway
//   DOORWAY (lancet):  center x≈4.5, z=0, base y=0; opening z∈[-1.5,1.5],
//                      height y∈[0, 3.7] (straight to 2.5, point to 3.7),
//                      depth x∈[3.3, 5.7] (cuts the whole dividing wall)
//   COLONNADE:         two rows at x=±3.2, columns every 4 in z (z=0,±4,±8),
//                      r=0.4, floor→near ceiling (y∈[-0.5, 8.5])
//   DAIS (verticality, far +z end of nave):
//      step1: x∈[-3.5,3.5] y∈[0,1]   z∈[6,9]   (low platform)
//      step2: x∈[-3.5,3.5] y∈[0,2]   z∈[7.8,9.2] (upper ledge)
//   Suggested spawn: (0, 1.6, 0) facing +x toward the doorway, or -z down nave.
//
// MATERIAL IDS: 1 wall · 2 floor/dais · 3 column · 4 doorway/arch trim.
// Cheap: a handful of box/cyl/lancet evals, one z-repeat, no loops.

fn w3_map(p: vec3f) -> vec2f {
  // --- solid rock; carve the rooms out of it ---
  let d0 = mod_w3_box(p - vec3f(3.5, 4.5, 0.0), vec3f(8.5, 5.5, 10.0));
  let nave = mod_w3_box(p - vec3f(0.0, 4.5, 0.0), vec3f(4.0, 4.5, 9.0));
  let side = mod_w3_box(p - vec3f(8.0, 2.5, 0.0), vec3f(3.0, 2.5, 3.5));

  // doorway: lancet arch, profile in (z,y), depth along x through the wall
  let qd = vec3f(p.z, p.y, p.x - 4.5);
  let door = mod_w3_lancet(qd, 1.5, 2.5, 1.2, 1.2);

  var d = d0;
  d = max(d, -nave);
  d = max(d, -side);
  d = max(d, -door);

  // shell material: floor low, doorway trim near the arch cut, else wall
  var mat = 1.0;
  if (p.y < 0.3) { mat = 2.0; }
  if (door < 0.35 && p.y < 3.9) { mat = 4.0; }

  // --- solids unioned back in ---
  // colonnade: mirrored rows at x=±3.2, repeated every 4 units in z
  let cz = (fract(p.z / 4.0 + 0.5) - 0.5) * 4.0;
  let colp = vec3f(abs(p.x) - 3.2, p.y - 4.0, cz);
  let col = mod_w3_cyl(colp, 4.5, 0.4);
  if (col < d) { d = col; mat = 3.0; }

  // dais / altar steps at the far +z end (verticality)
  let step1 = mod_w3_box(p - vec3f(0.0, 0.5, 7.5), vec3f(3.5, 0.5, 1.5));
  if (step1 < d) { d = step1; mat = 2.0; }
  let step2 = mod_w3_box(p - vec3f(0.0, 1.0, 8.5), vec3f(3.5, 1.0, 0.7));
  if (step2 < d) { d = step2; mat = 2.0; }

  return vec2f(d, mat);
}
