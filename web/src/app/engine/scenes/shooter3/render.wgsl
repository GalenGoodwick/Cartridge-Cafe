// shooter3 MEGASHADER (node: renderer-mega). ONE visual raymarches the world
// (w3_map from veilfire/rooms) and depth-composites the whole population in a
// single dispatch — demons (vf_demon), projectiles/death-bits (emissive) — then
// atmosphere (vf_atmos), muzzle/hit flashes, and the HUD (s3_hud) on top.
//
// Occlusion is correct + cheap: each entity is first rejected by a ray-vs-
// bounding-sphere test and by `t > worldT` (behind a wall), so only entities the
// ray actually pierces IN FRONT of the world get a local march. Camera on
// uni4(60/61). w3_map + vf_demon + s3_* + vf_atmos come from sibling modules.

// ray → sphere near-t (negative if no hit; may be <0 if camera inside)
fn s3_sph(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> f32 {
  let oc = ro - c;
  let b = dot(oc, rd);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) { return -1.0; }
  return -b - sqrt(h);
}

fn visual_s3(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let ro = uni4(60).xyz;
  let fov = max(uni4(60).w, 0.6);
  let rd = mod_w3_ray(uv, ro, uni4(61).xyz, fov);
  let sky = vec3f(0.02, 0.025, 0.05);

  // ── the world ──
  let wh = mod_w3_march(ro, rd, 0.02, 60.0, 96);
  var worldT = select(60.0, wh.x, wh.x >= 0.0);
  var col = sky;
  if (wh.x >= 0.0) {
    let pos = ro + rd * wh.x;
    let n = mod_w3_nrm(pos, 0.02);
    let ao = mod_w3_ao(pos, n);
    var alb = vec3f(0.30, 0.29, 0.36);                              // walls
    if (wh.y > 1.5 && wh.y < 2.5) { alb = vec3f(0.15, 0.14, 0.13); } // floor/dais
    if (wh.y > 2.5 && wh.y < 3.5) { alb = vec3f(0.22, 0.20, 0.24); } // column
    if (wh.y > 3.5) { alb = vec3f(0.55, 0.34, 0.14); }              // doorway trim
    // lantern (headlamp at the camera — vf-lightdark will move it to the player)
    let ld = normalize(ro - pos);
    let dist = length(ro - pos);
    let sh = mod_w3_shadow(pos + n * 0.04, ld, dist, 14.0);
    let diff = max(dot(n, ld), 0.0);
    let atten = 4.5 / (1.0 + 0.09 * dist * dist);
    col = alb * (vec3f(0.05, 0.06, 0.09) + vec3f(1.0, 0.82, 0.55) * diff * atten * sh) * ao;
  }

  // ── the population, depth-composited in front of the world ──
  var nearT = worldT;
  let cnt = popCount() / 2;
  for (var i = 0; i < cnt; i = i + 1) {
    let a = pop(i * 2);            // x, y, z, kind
    let b = pop(i * 2 + 1);        // hp01, phase, yaw, flags
    let kind = a.w;
    if (kind < 0.5) { continue; }  // empty slot
    let ppos = a.xyz;
    let br = select(0.16, 1.4, kind < 2.5);  // demons big, projectiles small
    let sh = s3_sph(ro, rd, ppos, br);
    if (sh < 0.0 || sh > nearT) { continue; }        // ray misses, or behind the world

    if (kind < 2.5) {
      // DEMON — local sphere-march (rotate the ray into the demon's yaw frame)
      let yaw = b.z;
      let cy = cos(-yaw); let sy = sin(-yaw);
      let o0 = ro - ppos;
      let lro = vec3f(cy * o0.x + sy * o0.z, o0.y, -sy * o0.x + cy * o0.z);
      let lrd = vec3f(cy * rd.x + sy * rd.z, rd.y, -sy * rd.x + cy * rd.z);
      var t = max(sh, 0.02);
      var hitT = -1.0;
      for (var s = 0; s < 30; s = s + 1) {
        let d = vf_demon(lro + lrd * t, b.y);
        if (d < 0.004) { hitT = t; break; }
        t = t + max(d * 0.8, 0.004);
        if (t > nearT || t > sh + 2.0 * br) { break; }
      }
      if (hitT > 0.0 && hitT < nearT) {
        nearT = hitT;
        let lp = lro + lrd * hitT;
        let e = 0.012;
        let nn = normalize(vec3f(
          vf_demon(lp + vec3f(e, 0.0, 0.0), b.y) - vf_demon(lp - vec3f(e, 0.0, 0.0), b.y),
          vf_demon(lp + vec3f(0.0, e, 0.0), b.y) - vf_demon(lp - vec3f(0.0, e, 0.0), b.y),
          vf_demon(lp + vec3f(0.0, 0.0, e), b.y) - vf_demon(lp - vec3f(0.0, 0.0, e), b.y)));
        let ll = normalize(lro - lp);                 // headlamp, in local frame
        let dist = length(ro - (ro + rd * hitT));
        let diff = max(dot(nn, ll), 0.0);
        let atten = 4.0 / (1.0 + 0.10 * dist * dist);
        let base = vec3f(0.11, 0.05, 0.045);          // charred flesh
        let ember = vec3f(1.0, 0.32, 0.07) * pow(clamp(0.6 - nn.y, 0.0, 1.0), 2.0) * (0.7 + 0.5 * sin(time * 6.0 + ppos.x));
        col = base * (0.12 + diff * atten) + ember * 0.9;
      }
    } else {
      // PROJECTILE / DEATH-BIT — emissive blob at the sphere hit
      if (sh < nearT) {
        nearT = sh;
        let life = clamp(b.x, 0.0, 1.0);
        if (kind > 4.5) { col = vec3f(1.0, 0.42, 0.12) * (0.5 + life * 1.6); }  // death ember
        else { col = s3_tracerColor(kind, life) * 1.4; }
      }
    }
  }

  // ── atmosphere over whatever we hit, then flashes, then HUD ──
  col = vf_atmos(col, ro + rd * nearT, rd, nearT, time);
  col += vec3f(1.0, 0.82, 0.5) * max(uni(15), 0.0) * 0.6;   // muzzle flash
  col += vec3f(1.0, 0.22, 0.16) * max(uni(16), 0.0) * 0.5;  // hit flash
  let hud = s3_hud(uv, uni(6), uni(7), uni(8), uni(12));
  col = mix(col, hud.rgb, hud.a);
  return vec4f(col, 1.0);
}
