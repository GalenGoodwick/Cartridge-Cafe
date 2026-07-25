// shooter3 render spine (node: world3-base). Defines the load-bearing w3_map
// (a test room + pillar) and visual_s3, which reads the camera from the
// whiteboard (uni4(60)=ro.xyz,fov · uni4(61)=target) and raymarches world3.
// renderer-mega grows this: after the world march it will loop pop(i) to draw
// enemies/projectiles/death-bits, and add HUD + flashes. Keep march ≤96 steps.

// ── the load-bearing contract: the scene's signed-distance field ──
fn w3_map(p: vec3f) -> vec2f {
  // hollow room: inside a big box → positive interior distance, 0 at the shell
  var d = -mod_w3_box(p - vec3f(0.0, 3.0, 0.0), vec3f(8.0, 3.0, 8.0));
  var m = 1.0;                                    // 1 = walls/ceiling
  // a pillar so the space reads three-dimensional
  let pillar = mod_w3_box(p - vec3f(2.6, 3.0, -1.5), vec3f(0.5, 3.0, 0.5));
  if (pillar < d) { d = pillar; m = 3.0; }        // 3 = pillar
  if (p.y < 0.12) { m = 2.0; }                    // 2 = floor
  return vec2f(d, m);
}

fn visual_s3(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let ro = uni4(60).xyz;
  let fov = max(uni4(60).w, 0.6);
  let ta = uni4(61).xyz;
  let rd = mod_w3_ray(uv, ro, ta, fov);
  let hit = mod_w3_march(ro, rd, 0.02, 60.0, 96);
  let sky = vec3f(0.02, 0.025, 0.05);
  if (hit.x < 0.0) { return vec4f(sky, 1.0); }     // miss → sky
  let pos = ro + rd * hit.x;
  let n = mod_w3_nrm(pos, 0.02);
  let ao = mod_w3_ao(pos, n);
  var alb = vec3f(0.34, 0.32, 0.40);               // walls
  if (hit.y > 1.5 && hit.y < 2.5) { alb = vec3f(0.16, 0.15, 0.14); }   // floor
  if (hit.y > 2.5) { alb = vec3f(0.50, 0.22, 0.12); }                  // pillar
  // a CLOSED interior gets no sun — light it with a headlamp at the camera
  // (this is also the lantern the vf-lightdark mechanic will drive). warm point
  // light + a soft self-shadow toward the lamp + tiny ambient.
  let lp = ro + vec3f(0.0, 0.4, 0.0);
  let ld = normalize(lp - pos);
  let dist = length(lp - pos);
  let sh = mod_w3_shadow(pos + n * 0.04, ld, dist, 16.0);
  let diff = max(dot(n, ld), 0.0);
  let atten = 4.0 / (1.0 + 0.10 * dist * dist);
  let lampCol = vec3f(1.0, 0.82, 0.55);
  var c = alb * (vec3f(0.05, 0.06, 0.09) + lampCol * diff * atten * sh) * ao;
  c = mod_w3_fog(c, sky, hit.x, 0.015);
  return vec4f(c, 1.0);                              // linear HDR — post does the tonemap
}
