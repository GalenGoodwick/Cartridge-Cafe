// MARIONETTES 3D — true volumetric creatures. The same 2D rig extrudes to 3D
// capsules (z-axis) and each body is orthographically raymarched: real 3D
// normals, marched self-shadows, normal-space AO, fresnel rims. The 2D SDFs
// remain for silhouette AA, contact shadows, and surface patterns.
// Same FK rig and capsule flesh as II/HD, rendered continuously: two-light
// shading (warm key, cool fill), specular, anti-aliased silhouettes, soft
// penumbra contact shadows, and per-creature materials (directional fur,
// smooth scale bands, cloth weave, glossy iridescent chitin). The ceiling demo:
// same skeleton core, realism-grade skin. Body space is uv*22 (44-unit rig).

const MODULES = /* wgsl */`
fn mod_seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(p - a - ab * h);
}
fn mod_cap2(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  return mod_seg2(p, a, b) - r;
}
fn mod_ramp2(dark: vec3f, base: vec3f, lite: vec3f, t: f32) -> vec3f {
  let lo = clamp(t * 2.0, 0.0, 1.0);
  let hi = clamp(t * 2.0 - 1.0, 0.0, 1.0);
  return mix(mix(dark, base, lo), lite, hi);
}
fn mod_blink2(time: f32, seed: f32) -> f32 {
  return step(fract(time * 0.31 + seed), 0.06);
}
fn mod_cap3(p: vec3f, a: vec2f, b: vec2f, r: f32) -> f32 {
  let a3 = vec3f(a, 0.0);
  let ab = vec3f(b - a, 0.0);
  let h = clamp(dot(p - a3, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(p - a3 - ab * h) - r;
}
fn mod_sph3(p: vec3f, c: vec2f, r: f32) -> f32 {
  return length(p - vec3f(c, 0.0)) - r;
}
// Planted gait: phase is in stride CYCLES (advanced by distance traveled).
// Stance (cyc < duty): foot drives linearly back at exactly body speed —
// world-velocity zero, the foot is planted. Swing: eased return with a lift arc.
fn mod_gait(phc: f32, duty: f32, len: f32, lift: f32) -> vec2f {
  let cyc = fract(phc);
  if (cyc < duty) {
    let t = cyc / duty;
    return vec2f(len - 2.0 * len * t, 0.0);
  }
  let t = (cyc - duty) / (1.0 - duty);
  let e = t * t * (3.0 - 2.0 * t);
  return vec2f(-len + 2.0 * len * e, -sin(t * 3.14159) * lift);
}`

const ARENA = /* wgsl */`
fn visual_mar6_arena(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  var c = vec3f(0.045, 0.052, 0.075);
  // rolling ground — lit fbm terrain
  let h = fbm(uv * 3.0 + vec2f(2.7, 1.3), 4);
  let h2 = fbm(uv * 3.0 + vec2f(2.76, 1.26), 4);
  let slope = (h2 - h) * 12.0;
  c += vec3f(0.030, 0.036, 0.030) * h;
  c += vec3f(0.020, 0.022, 0.018) * clamp(slope, 0.0, 1.0);
  // mossy patches
  let m = fbm(uv * 5.0 - vec2f(1.1, 3.3), 3);
  c = mix(c, vec3f(0.045, 0.075, 0.050), smoothstep(0.55, 0.75, m) * 0.6);
  // drifting cloud shadows
  let cl = fbm(uv * 1.8 + vec2f(time * 0.012, time * 0.004), 3);
  c *= 0.82 + 0.30 * smoothstep(0.35, 0.75, cl);
  // fireflies
  let g = uv * 40.0;
  let cell = floor(g);
  let hh = hash21(cell);
  if (hh > 0.9982) {
    let fp = fract(g) - 0.5;
    let tw = 0.5 + 0.5 * sin(time * (1.0 + hh * 3.0) + hh * 40.0);
    c += vec3f(0.5, 0.7, 0.4) * exp(-dot(fp, fp) * 30.0) * tw * 0.8;
  }
  c *= 1.0 - 0.30 * dot(uv * 0.8, uv * 0.8);
  return vec4f(c, 1.0);
}`

// ── Serpent ──
const SERPENT = /* wgsl */`

fn mar6_serpent_sd(q: vec2f, hd: f32, ph: f32, ra: f32, reach: f32) -> vec2f {
  let head = rotate(vec2f(15.0, sin(ph * 8.8) * 1.2), hd);
  var d = length(q - head) - 2.7;
  var bestSeg = 999.0;
  var tPar = 0.0;
  var prev = head;
  for (var i = 1; i < 10; i++) {
    let fi = f32(i);
    let cur = rotate(vec2f(15.0 - fi * 3.3, sin(ph * 8.8 - fi * 0.85) * (1.6 + fi * 0.35)), hd);
    let r = max(2.3 - fi * 0.20, 0.5);
    let ab = cur - prev;
    let h = clamp(dot(q - prev, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
    let segd = length(q - prev - ab * h);
    if (segd < bestSeg) { bestSeg = segd; tPar = fi - 1.0 + h; }
    d = opSmoothUnion(d, segd - r, 1.1);
    prev = cur;
  }
  let flick = max(step(fract(ph * 1.3), 0.22), step(0.15, reach));
  if (flick > 0.5) {
    let dir = vec2f(cos(ra), sin(ra));
    let tip = head + dir * (2.5 + 4.0 * reach);
    let side = vec2f(-dir.y, dir.x);
    d = min(d, mod_cap2(q, head + dir * 2.0, tip, 0.35));
    d = min(d, mod_cap2(q, tip, tip + dir * 1.6 + side * 1.0, 0.3));
    d = min(d, mod_cap2(q, tip, tip + dir * 1.6 - side * 1.0, 0.3));
  }
  return vec2f(d, tPar);
}
fn mar6_serpent_sd3(p: vec3f, hd: f32, ph: f32, ra: f32, reach: f32) -> f32 {
  let head = rotate(vec2f(15.0, sin(ph * 8.8) * 1.2), hd);
  var d = mod_sph3(p, head, 2.7);
  var prev = head;
  for (var i = 1; i < 10; i++) {
    let fi = f32(i);
    let cur = rotate(vec2f(15.0 - fi * 3.3, sin(ph * 8.8 - fi * 0.85) * (1.6 + fi * 0.35)), hd);
    let r = max(2.3 - fi * 0.20, 0.5);
    d = opSmoothUnion(d, mod_cap3(p, prev, cur, r), 1.1);
    prev = cur;
  }
  let flick = max(step(fract(ph * 1.3), 0.22), step(0.15, reach));
  if (flick > 0.5) {
    let dir = vec2f(cos(ra), sin(ra));
    let tip = head + dir * (2.5 + 4.0 * reach);
    let side = vec2f(-dir.y, dir.x);
    d = min(d, mod_cap3(p, head + dir * 2.0, tip, 0.35));
    d = min(d, mod_cap3(p, tip, tip + dir * 1.6 + side * 1.0, 0.3));
    d = min(d, mod_cap3(p, tip, tip + dir * 1.6 - side * 1.0, 0.3));
  }
  return d;
}
fn visual_mar6_serpent(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y; let ra = p.z; let reach = clamp(p.w, 0.0, 1.0);
  let d2 = mar6_serpent_sd(c, hd, ph, ra, reach).x;
  if (d2 > 3.0) {
    let ds = mar6_serpent_sd(c - vec2f(3.5, 4.5), hd, ph, ra, reach).x;
    let sh0 = smoothstep(2.2, -1.2, ds) * 0.42;
    return vec4f(vec3f(0.0), sh0);
  }
  // orthographic raymarch: camera at z = -9 looking +z
  var t = 0.0;
  var pos = vec3f(c, -9.0);
  var found = false;
  for (var i = 0; i < 40; i++) {
    pos = vec3f(c, -9.0 + t);
    let dd = mar6_serpent_sd3(pos, hd, ph, ra, reach);
    if (dd < 0.05) { found = true; break; }
    t += max(dd, 0.045);
    if (t > 18.0) { break; }
  }
  if (!found) {
    let a0 = smoothstep(0.15, -0.15, d2) * 0.7;
    return vec4f(vec3f(0.16, 0.55, 0.36) * 0.35, a0);
  }
  let e = 0.12;
  let d0 = mar6_serpent_sd3(pos, hd, ph, ra, reach);
  let nrm = normalize(vec3f(
    mar6_serpent_sd3(pos + vec3f(e, 0.0, 0.0), hd, ph, ra, reach) - d0,
    mar6_serpent_sd3(pos + vec3f(0.0, e, 0.0), hd, ph, ra, reach) - d0,
    mar6_serpent_sd3(pos + vec3f(0.0, 0.0, e), hd, ph, ra, reach) - d0
  ));
  let L = normalize(vec3f(-0.55, -0.75, -0.50));
  var sh = 1.0;
  var ts = 0.35;
  for (var si = 0; si < 7; si++) {
    let sd = mar6_serpent_sd3(pos + L * ts, hd, ph, ra, reach);
    sh = min(sh, clamp(sd / (ts * 0.22), 0.0, 1.0));
    ts += clamp(sd, 0.18, 1.6);
    if (ts > 9.0) { break; }
  }
  sh = clamp(sh, 0.0, 1.0);
  var ao = 0.0;
  for (var ki = 1; ki <= 3; ki++) {
    let ha = f32(ki) * 0.55;
    ao += clamp(mar6_serpent_sd3(pos + nrm * ha, hd, ph, ra, reach) / ha, 0.0, 1.0);
  }
  ao = clamp(ao / 3.0, 0.0, 1.0);
  let dif = clamp(dot(nrm, L), 0.0, 1.0);
  let V = vec3f(0.0, 0.0, -1.0);
  let Hh = normalize(L + V);
  let spe = pow(clamp(dot(nrm, Hh), 0.0, 1.0), 48.0);
  let fre = pow(1.0 - clamp(dot(nrm, V), 0.0, 1.0), 3.0);
  var lum = 0.14 + dif * (0.35 + 0.65 * sh) * 0.95;
  lum *= 0.45 + 0.55 * ao;
  let hq = pos.xy;
  var color = mod_ramp2(vec3f(0.04, 0.16, 0.10), vec3f(0.16, 0.55, 0.36), vec3f(0.66, 0.98, 0.74), clamp(lum, 0.0, 1.0));
  let tp = mar6_serpent_sd(hq, hd, ph, ra, reach).y;
  let bandv = smoothstep(0.15, 0.65, sin(tp * 4.7));
  color *= mix(1.0, 0.60, bandv);
  color *= 0.92 + 0.14 * vnoise(hq * 2.6 + vec2f(tp * 3.0, 0.0));
  let hood = rotate(vec2f(11.0, sin(ph * 8.8 - 0.85) * 1.9), hd);
  color *= 1.0 - 0.4 * smoothstep(2.8, 1.2, length(hq - hood));
  color += vec3f(1.4, 1.4, 1.3) * spe * (0.3 + 0.7 * sh) * 0.5;
  color += vec3f(0.12, 0.75, 0.40) * exp(d2 * 0.85) * 0.30;
  color += vec3f(0.10, 0.13, 0.20) * fre * 0.55;
  let headE = rotate(vec2f(15.0, sin(ph * 8.8) * 1.2), hd);
  let eyeP = headE + rotate(vec2f(1.1, -1.1), hd);
  if (mod_blink2(time, 0.13) < 0.5) {
    color = mix(color, vec3f(0.02, 0.05, 0.03), smoothstep(0.75, 0.45, length(hq - eyeP)));
    color += vec3f(1.4) * smoothstep(0.45, 0.15, length(hq - eyeP - vec2f(0.35, -0.35)));
  }
  let alpha = smoothstep(0.15, -0.15, d2);
  return vec4f(color, alpha);
}`

// ── Walker ──
const WALKER = /* wgsl */`

fn mar6_walker_sd(q: vec2f, hd: f32, ph: f32) -> f32 {
  let bob = sin(ph * 12.566) * 0.55;
  let hip = rotate(vec2f(-7.0, bob * 0.5), hd);
  let chest = rotate(vec2f(6.0, bob), hd);
  let head = rotate(vec2f(13.0, -3.0 + bob), hd);
  let wag = sin(ph * 5.65) * 1.6;
  let tail = rotate(vec2f(-15.0, -2.0 - bob + wag), hd);
  let tailTip = rotate(vec2f(-18.5, -4.0 - bob + wag * 1.6), hd);
  var d = mod_cap2(q, hip, chest, 2.3);
  d = opSmoothUnion(d, mod_cap2(q, chest, head, 1.3), 1.3);
  d = opSmoothUnion(d, length(q - head) - 2.5, 1.0);
  d = opSmoothUnion(d, length(q - (head + rotate(vec2f(2.6, 0.4), hd))) - 1.2, 0.9);
  d = opSmoothUnion(d, mod_cap2(q, hip, tail, 0.9), 1.2);
  d = opSmoothUnion(d, mod_cap2(q, tail, tailTip, 0.55), 0.8);
  // ears join the flesh in ULTRA — small cones on the skull
  d = opSmoothUnion(d, mod_cap2(q, head + rotate(vec2f(-0.6, -2.0), hd), head + rotate(vec2f(-1.0, -3.6), hd), 0.55), 0.5);
  d = opSmoothUnion(d, mod_cap2(q, head + rotate(vec2f(1.2, -2.0), hd), head + rotate(vec2f(1.6, -3.4), hd), 0.5), 0.5);
  for (var i = 0; i < 4; i++) {
    let front = f32(i / 2);
    let baseL = mix(vec2f(-7.0, bob * 0.5), vec2f(6.0, bob), front);
    var offs = array<f32, 4>(0.0, 0.5, 0.25, 0.75);
    let g = mod_gait(ph + offs[i], 0.6, 4.5, 2.6);
    let fx = baseL.x + g.x;
    let footL = vec2f(fx, 10.0 + g.y);
    let kneeL = vec2f((baseL.x + fx) * 0.5 + 1.5, (baseL.y + footL.y) * 0.5 - 1.5);
    let base = rotate(baseL, hd);
    let knee = rotate(kneeL, hd);
    let foot = rotate(footL, hd);
    d = opSmoothUnion(d, mod_cap2(q, base, knee, 1.0), 0.9);
    d = opSmoothUnion(d, mod_cap2(q, knee, foot, 0.72), 0.7);
    d = opSmoothUnion(d, length(q - foot) - 0.95, 0.5);
  }
  return d;
}
fn mar6_walker_sd3(p: vec3f, hd: f32, ph: f32) -> f32 {
  let bob = sin(ph * 12.566) * 0.55;
  let hip = rotate(vec2f(-7.0, bob * 0.5), hd);
  let chest = rotate(vec2f(6.0, bob), hd);
  let head = rotate(vec2f(13.0, -3.0 + bob), hd);
  let wag = sin(ph * 5.65) * 1.6;
  let tail = rotate(vec2f(-15.0, -2.0 - bob + wag), hd);
  let tailTip = rotate(vec2f(-18.5, -4.0 - bob + wag * 1.6), hd);
  var d = mod_cap3(p, hip, chest, 2.3);
  d = opSmoothUnion(d, mod_cap3(p, chest, head, 1.3), 1.3);
  d = opSmoothUnion(d, mod_sph3(p, head, 2.5), 1.0);
  d = opSmoothUnion(d, mod_sph3(p, head + rotate(vec2f(2.6, 0.4), hd), 1.2), 0.9);
  d = opSmoothUnion(d, mod_cap3(p, hip, tail, 0.9), 1.2);
  d = opSmoothUnion(d, mod_cap3(p, tail, tailTip, 0.55), 0.8);
  // ears join the flesh in ULTRA — small cones on the skull
  d = opSmoothUnion(d, mod_cap3(p, head + rotate(vec2f(-0.6, -2.0), hd), head + rotate(vec2f(-1.0, -3.6), hd), 0.55), 0.5);
  d = opSmoothUnion(d, mod_cap3(p, head + rotate(vec2f(1.2, -2.0), hd), head + rotate(vec2f(1.6, -3.4), hd), 0.5), 0.5);
  for (var i = 0; i < 4; i++) {
    let front = f32(i / 2);
    let baseL = mix(vec2f(-7.0, bob * 0.5), vec2f(6.0, bob), front);
    var offs = array<f32, 4>(0.0, 0.5, 0.25, 0.75);
    let g = mod_gait(ph + offs[i], 0.6, 4.5, 2.6);
    let fx = baseL.x + g.x;
    let footL = vec2f(fx, 10.0 + g.y);
    let kneeL = vec2f((baseL.x + fx) * 0.5 + 1.5, (baseL.y + footL.y) * 0.5 - 1.5);
    let base = rotate(baseL, hd);
    let knee = rotate(kneeL, hd);
    let foot = rotate(footL, hd);
    d = opSmoothUnion(d, mod_cap3(p, base, knee, 1.0), 0.9);
    d = opSmoothUnion(d, mod_cap3(p, knee, foot, 0.72), 0.7);
    d = opSmoothUnion(d, mod_sph3(p, foot, 0.95), 0.5);
  }
  return d;
}
fn visual_mar6_walker(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y;
  let d2 = mar6_walker_sd(c, hd, ph);
  if (d2 > 3.0) {
    let ds = mar6_walker_sd(c - vec2f(3.5, 4.5), hd, ph);
    let sh0 = smoothstep(2.2, -1.2, ds) * 0.42;
    return vec4f(vec3f(0.0), sh0);
  }
  // orthographic raymarch: camera at z = -9 looking +z
  var t = 0.0;
  var pos = vec3f(c, -9.0);
  var found = false;
  for (var i = 0; i < 40; i++) {
    pos = vec3f(c, -9.0 + t);
    let dd = mar6_walker_sd3(pos, hd, ph);
    if (dd < 0.05) { found = true; break; }
    t += max(dd, 0.045);
    if (t > 18.0) { break; }
  }
  if (!found) {
    let a0 = smoothstep(0.15, -0.15, d2) * 0.7;
    return vec4f(vec3f(0.70, 0.45, 0.16) * 0.35, a0);
  }
  let e = 0.12;
  let d0 = mar6_walker_sd3(pos, hd, ph);
  let nrm = normalize(vec3f(
    mar6_walker_sd3(pos + vec3f(e, 0.0, 0.0), hd, ph) - d0,
    mar6_walker_sd3(pos + vec3f(0.0, e, 0.0), hd, ph) - d0,
    mar6_walker_sd3(pos + vec3f(0.0, 0.0, e), hd, ph) - d0
  ));
  let L = normalize(vec3f(-0.55, -0.75, -0.50));
  var sh = 1.0;
  var ts = 0.35;
  for (var si = 0; si < 7; si++) {
    let sd = mar6_walker_sd3(pos + L * ts, hd, ph);
    sh = min(sh, clamp(sd / (ts * 0.22), 0.0, 1.0));
    ts += clamp(sd, 0.18, 1.6);
    if (ts > 9.0) { break; }
  }
  sh = clamp(sh, 0.0, 1.0);
  var ao = 0.0;
  for (var ki = 1; ki <= 3; ki++) {
    let ha = f32(ki) * 0.55;
    ao += clamp(mar6_walker_sd3(pos + nrm * ha, hd, ph) / ha, 0.0, 1.0);
  }
  ao = clamp(ao / 3.0, 0.0, 1.0);
  let dif = clamp(dot(nrm, L), 0.0, 1.0);
  let V = vec3f(0.0, 0.0, -1.0);
  let Hh = normalize(L + V);
  let spe = pow(clamp(dot(nrm, Hh), 0.0, 1.0), 48.0);
  let fre = pow(1.0 - clamp(dot(nrm, V), 0.0, 1.0), 3.0);
  var lum = 0.14 + dif * (0.35 + 0.65 * sh) * 0.95;
  lum *= 0.45 + 0.55 * ao;
  let hq = pos.xy;
  var color = mod_ramp2(vec3f(0.22, 0.11, 0.04), vec3f(0.70, 0.45, 0.16), vec3f(1.0, 0.88, 0.60), clamp(lum, 0.0, 1.0));
  let bl = rotate(hq, -hd);
  let fur = fbm(bl * vec2f(0.9, 3.2) + vec2f(3.0, 7.0), 3);
  color *= 0.84 + 0.30 * fur;
  color = mix(color, vec3f(0.95, 0.88, 0.70), smoothstep(0.1, 0.7, nrm.y) * 0.40);
  color += vec3f(1.4, 1.4, 1.3) * spe * (0.3 + 0.7 * sh) * 0.35;
  color += vec3f(0.85, 0.42, 0.12) * exp(d2 * 0.85) * 0.30;
  color += vec3f(0.10, 0.13, 0.20) * fre * 0.55;
  let bobE = sin(ph * 12.566) * 0.55;
  let headE = rotate(vec2f(13.0, -3.0 + bobE), hd);
  let eyeP = headE + rotate(vec2f(1.0, -0.9), hd);
  if (mod_blink2(time, 0.47) < 0.5) {
    color = mix(color, vec3f(0.05, 0.03, 0.01), smoothstep(0.75, 0.45, length(hq - eyeP)));
    color += vec3f(1.4) * smoothstep(0.45, 0.15, length(hq - eyeP - vec2f(0.35, -0.35)));
  }
  color = mix(color, vec3f(0.06, 0.03, 0.02), smoothstep(0.75, 0.40, length(hq - (headE + rotate(vec2f(3.8, 0.4), hd)))));
  let alpha = smoothstep(0.15, -0.15, d2);
  return vec4f(color, alpha);
}`

// ── Puppet ──
const PUPPET = /* wgsl */`

fn mar6_puppet_sd(q: vec2f, hd: f32, ph: f32, ra: f32, reach: f32) -> f32 {
  let bob = sin(ph * 12.566) * 0.5;
  let pelvis = rotate(vec2f(0.0, 2.0 + bob), hd);
  let chest = rotate(vec2f(0.8, -5.0 + bob), hd);
  let head = rotate(vec2f(1.4, -11.0 + bob), hd);
  var d = mod_cap2(q, pelvis, chest, 2.0);
  d = opSmoothUnion(d, mod_cap2(q, chest, head, 1.0), 1.0);
  d = opSmoothUnion(d, length(q - head) - 2.6, 0.9);
  for (var i = 0; i < 2; i++) {
    let g = mod_gait(ph + f32(i) * 0.5, 0.62, 4.0, 2.4);
    let fx = g.x;
    let footL = vec2f(fx, 12.0 + g.y);
    let kneeL = vec2f(fx * 0.5 + 1.2, (2.0 + footL.y) * 0.5);
    let knee = rotate(kneeL + vec2f(0.0, bob * 0.5), hd);
    let foot = rotate(footL, hd);
    d = opSmoothUnion(d, mod_cap2(q, pelvis, knee, 0.95), 0.8);
    d = opSmoothUnion(d, mod_cap2(q, knee, foot, 0.72), 0.7);
    d = opSmoothUnion(d, length(q - foot) - 0.9, 0.5);
  }
  let swing = sin((ph + 0.5) * 6.28318) * 3.0;
  let handB = rotate(vec2f(0.8 + swing, 1.5 + bob), hd);
  let elbowB = rotate(vec2f(0.8 + swing * 0.5 - 1.0, -2.0 + bob), hd);
  d = opSmoothUnion(d, mod_cap2(q, chest, elbowB, 0.8), 0.7);
  d = opSmoothUnion(d, mod_cap2(q, elbowB, handB, 0.65), 0.7);
  d = opSmoothUnion(d, length(q - handB) - 0.85, 0.5);
  let dir = vec2f(cos(ra), sin(ra));
  let hand = chest + dir * (4.0 + 6.0 * reach);
  let elbow = mix(chest, hand, 0.5) + rotate(vec2f(0.0, -1.5), hd);
  d = opSmoothUnion(d, mod_cap2(q, chest, elbow, 0.8), 0.7);
  d = opSmoothUnion(d, mod_cap2(q, elbow, hand, 0.65), 0.7);
  d = opSmoothUnion(d, length(q - hand) - (0.9 + reach * 0.5), 0.6);
  return d;
}
fn mar6_puppet_sd3(p: vec3f, hd: f32, ph: f32, ra: f32, reach: f32) -> f32 {
  let bob = sin(ph * 12.566) * 0.5;
  let pelvis = rotate(vec2f(0.0, 2.0 + bob), hd);
  let chest = rotate(vec2f(0.8, -5.0 + bob), hd);
  let head = rotate(vec2f(1.4, -11.0 + bob), hd);
  var d = mod_cap3(p, pelvis, chest, 2.0);
  d = opSmoothUnion(d, mod_cap3(p, chest, head, 1.0), 1.0);
  d = opSmoothUnion(d, mod_sph3(p, head, 2.6), 0.9);
  for (var i = 0; i < 2; i++) {
    let g = mod_gait(ph + f32(i) * 0.5, 0.62, 4.0, 2.4);
    let fx = g.x;
    let footL = vec2f(fx, 12.0 + g.y);
    let kneeL = vec2f(fx * 0.5 + 1.2, (2.0 + footL.y) * 0.5);
    let knee = rotate(kneeL + vec2f(0.0, bob * 0.5), hd);
    let foot = rotate(footL, hd);
    d = opSmoothUnion(d, mod_cap3(p, pelvis, knee, 0.95), 0.8);
    d = opSmoothUnion(d, mod_cap3(p, knee, foot, 0.72), 0.7);
    d = opSmoothUnion(d, mod_sph3(p, foot, 0.9), 0.5);
  }
  let swing = sin((ph + 0.5) * 6.28318) * 3.0;
  let handB = rotate(vec2f(0.8 + swing, 1.5 + bob), hd);
  let elbowB = rotate(vec2f(0.8 + swing * 0.5 - 1.0, -2.0 + bob), hd);
  d = opSmoothUnion(d, mod_cap3(p, chest, elbowB, 0.8), 0.7);
  d = opSmoothUnion(d, mod_cap3(p, elbowB, handB, 0.65), 0.7);
  d = opSmoothUnion(d, mod_sph3(p, handB, 0.85), 0.5);
  let dir = vec2f(cos(ra), sin(ra));
  let hand = chest + dir * (4.0 + 6.0 * reach);
  let elbow = mix(chest, hand, 0.5) + rotate(vec2f(0.0, -1.5), hd);
  d = opSmoothUnion(d, mod_cap3(p, chest, elbow, 0.8), 0.7);
  d = opSmoothUnion(d, mod_cap3(p, elbow, hand, 0.65), 0.7);
  d = opSmoothUnion(d, mod_sph3(p, hand, 0.9 + reach * 0.5), 0.6);
  return d;
}
fn visual_mar6_puppet(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y; let ra = p.z; let reach = clamp(p.w, 0.0, 1.0);
  let d2 = mar6_puppet_sd(c, hd, ph, ra, reach);
  if (d2 > 3.0) {
    let ds = mar6_puppet_sd(c - vec2f(3.5, 4.5), hd, ph, ra, reach);
    let sh0 = smoothstep(2.2, -1.2, ds) * 0.42;
    return vec4f(vec3f(0.0), sh0);
  }
  // orthographic raymarch: camera at z = -9 looking +z
  var t = 0.0;
  var pos = vec3f(c, -9.0);
  var found = false;
  for (var i = 0; i < 40; i++) {
    pos = vec3f(c, -9.0 + t);
    let dd = mar6_puppet_sd3(pos, hd, ph, ra, reach);
    if (dd < 0.05) { found = true; break; }
    t += max(dd, 0.045);
    if (t > 18.0) { break; }
  }
  if (!found) {
    let a0 = smoothstep(0.15, -0.15, d2) * 0.7;
    return vec4f(vec3f(0.68, 0.28, 0.42) * 0.35, a0);
  }
  let e = 0.12;
  let d0 = mar6_puppet_sd3(pos, hd, ph, ra, reach);
  let nrm = normalize(vec3f(
    mar6_puppet_sd3(pos + vec3f(e, 0.0, 0.0), hd, ph, ra, reach) - d0,
    mar6_puppet_sd3(pos + vec3f(0.0, e, 0.0), hd, ph, ra, reach) - d0,
    mar6_puppet_sd3(pos + vec3f(0.0, 0.0, e), hd, ph, ra, reach) - d0
  ));
  let L = normalize(vec3f(-0.55, -0.75, -0.50));
  var sh = 1.0;
  var ts = 0.35;
  for (var si = 0; si < 7; si++) {
    let sd = mar6_puppet_sd3(pos + L * ts, hd, ph, ra, reach);
    sh = min(sh, clamp(sd / (ts * 0.22), 0.0, 1.0));
    ts += clamp(sd, 0.18, 1.6);
    if (ts > 9.0) { break; }
  }
  sh = clamp(sh, 0.0, 1.0);
  var ao = 0.0;
  for (var ki = 1; ki <= 3; ki++) {
    let ha = f32(ki) * 0.55;
    ao += clamp(mar6_puppet_sd3(pos + nrm * ha, hd, ph, ra, reach) / ha, 0.0, 1.0);
  }
  ao = clamp(ao / 3.0, 0.0, 1.0);
  let dif = clamp(dot(nrm, L), 0.0, 1.0);
  let V = vec3f(0.0, 0.0, -1.0);
  let Hh = normalize(L + V);
  let spe = pow(clamp(dot(nrm, Hh), 0.0, 1.0), 48.0);
  let fre = pow(1.0 - clamp(dot(nrm, V), 0.0, 1.0), 3.0);
  var lum = 0.14 + dif * (0.35 + 0.65 * sh) * 0.95;
  lum *= 0.45 + 0.55 * ao;
  let hq = pos.xy;
  var color = mod_ramp2(vec3f(0.24, 0.07, 0.13), vec3f(0.68, 0.28, 0.42), vec3f(1.0, 0.72, 0.80), clamp(lum, 0.0, 1.0));
  let bobV = sin(ph * 12.566) * 0.5;
  let pelvisV = rotate(vec2f(0.0, 2.0 + bobV), hd);
  let chestV = rotate(vec2f(0.8, -5.0 + bobV), hd);
  let vest = smoothstep(2.3, 1.7, mod_seg2(hq, pelvisV, chestV));
  let weave = (sin(hq.x * 7.0) + sin(hq.y * 7.0)) * 0.5;
  color = mix(color, vec3f(0.22, 0.10, 0.30) * (1.0 + 0.10 * weave), vest * 0.8);
  let headH = rotate(vec2f(1.4, -11.0 + bobV), hd);
  let hairP = headH + rotate(vec2f(-0.4, -1.4), hd);
  color = mix(color, vec3f(0.20, 0.06, 0.14), smoothstep(2.2, 1.0, length(hq - hairP)) * 0.85);
  color += vec3f(1.4, 1.4, 1.3) * spe * (0.3 + 0.7 * sh) * 0.35;
  color += vec3f(0.85, 0.28, 0.38) * exp(d2 * 0.85) * 0.30;
  color += vec3f(0.10, 0.13, 0.20) * fre * 0.55;
  let eyeP = headH + rotate(vec2f(1.0, -0.6), hd);
  if (mod_blink2(time, 0.71) < 0.5) {
    color = mix(color, vec3f(0.04, 0.01, 0.03), smoothstep(0.70, 0.42, length(hq - eyeP)));
    color += vec3f(1.4) * smoothstep(0.42, 0.14, length(hq - eyeP - vec2f(0.35, -0.35)));
  }
  let alpha = smoothstep(0.15, -0.15, d2);
  return vec4f(color, alpha);
}`

// ── Crawler ──
const CRAWLER = /* wgsl */`

fn mar6_crawler_sd(q: vec2f, hd: f32, ph: f32) -> f32 {
  let bob = sin(ph * 18.85) * 0.4;
  let bodyA = rotate(vec2f(-5.0, bob), hd);
  let bodyB = rotate(vec2f(5.0, -bob), hd);
  let headP = rotate(vec2f(9.5, -bob - 1.0), hd);
  var d = length(q - bodyA) - 3.2;
  d = opSmoothUnion(d, length(q - bodyB) - 2.8, 1.6);
  d = opSmoothUnion(d, mod_cap2(q, bodyA, bodyB, 2.2), 1.4);
  d = opSmoothUnion(d, length(q - headP) - 1.9, 1.0);
  d = min(d, mod_cap2(q, headP, headP + rotate(vec2f(3.0, -3.0 + sin(ph * 12.566)), hd), 0.35));
  d = min(d, mod_cap2(q, headP, headP + rotate(vec2f(3.5, 1.5 + cos(ph * 12.566)), hd), 0.35));
  let mnd = sin(ph * 18.85) * 0.4;
  d = min(d, mod_cap2(q, headP + rotate(vec2f(1.5, -0.8), hd), headP + rotate(vec2f(3.2, -1.4 + mnd), hd), 0.4));
  d = min(d, mod_cap2(q, headP + rotate(vec2f(1.5, 0.6), hd), headP + rotate(vec2f(3.2, 1.2 - mnd), hd), 0.4));
  for (var i = 0; i < 6; i++) {
    let xi = f32(i % 3);
    let side = f32(i / 3) * 2.0 - 1.0;
    let tri = f32((i + i / 3) % 2);
    let baseL = vec2f(-6.0 + xi * 6.0, side * 1.5);
    let g = mod_gait(ph + tri * 0.5 + xi * 0.06, 0.55, 3.0, 2.0);
    let fx = baseL.x + g.x;
    let footL = vec2f(fx, side * 8.5 + g.y * side);
    let kneeL = vec2f((baseL.x + fx) * 0.5, side * 5.0 + baseL.y);
    let base = rotate(baseL, hd);
    let knee = rotate(kneeL, hd);
    let foot = rotate(footL, hd);
    d = min(d, mod_cap2(q, base, knee, 0.55));
    d = min(d, mod_cap2(q, knee, foot, 0.45));
  }
  return d;
}
fn mar6_crawler_sd3(p: vec3f, hd: f32, ph: f32) -> f32 {
  let bob = sin(ph * 18.85) * 0.4;
  let bodyA = rotate(vec2f(-5.0, bob), hd);
  let bodyB = rotate(vec2f(5.0, -bob), hd);
  let headP = rotate(vec2f(9.5, -bob - 1.0), hd);
  var d = mod_sph3(p, bodyA, 3.2);
  d = opSmoothUnion(d, mod_sph3(p, bodyB, 2.8), 1.6);
  d = opSmoothUnion(d, mod_cap3(p, bodyA, bodyB, 2.2), 1.4);
  d = opSmoothUnion(d, mod_sph3(p, headP, 1.9), 1.0);
  d = min(d, mod_cap3(p, headP, headP + rotate(vec2f(3.0, -3.0 + sin(ph * 12.566)), hd), 0.35));
  d = min(d, mod_cap3(p, headP, headP + rotate(vec2f(3.5, 1.5 + cos(ph * 12.566)), hd), 0.35));
  let mnd = sin(ph * 18.85) * 0.4;
  d = min(d, mod_cap3(p, headP + rotate(vec2f(1.5, -0.8), hd), headP + rotate(vec2f(3.2, -1.4 + mnd), hd), 0.4));
  d = min(d, mod_cap3(p, headP + rotate(vec2f(1.5, 0.6), hd), headP + rotate(vec2f(3.2, 1.2 - mnd), hd), 0.4));
  for (var i = 0; i < 6; i++) {
    let xi = f32(i % 3);
    let side = f32(i / 3) * 2.0 - 1.0;
    let tri = f32((i + i / 3) % 2);
    let baseL = vec2f(-6.0 + xi * 6.0, side * 1.5);
    let g = mod_gait(ph + tri * 0.5 + xi * 0.06, 0.55, 3.0, 2.0);
    let fx = baseL.x + g.x;
    let footL = vec2f(fx, side * 8.5 + g.y * side);
    let kneeL = vec2f((baseL.x + fx) * 0.5, side * 5.0 + baseL.y);
    let base = rotate(baseL, hd);
    let knee = rotate(kneeL, hd);
    let foot = rotate(footL, hd);
    d = min(d, mod_cap3(p, base, knee, 0.55));
    d = min(d, mod_cap3(p, knee, foot, 0.45));
  }
  return d;
}
fn visual_mar6_crawler(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y;
  let d2 = mar6_crawler_sd(c, hd, ph);
  if (d2 > 3.0) {
    let ds = mar6_crawler_sd(c - vec2f(3.5, 4.5), hd, ph);
    let sh0 = smoothstep(2.2, -1.2, ds) * 0.42;
    return vec4f(vec3f(0.0), sh0);
  }
  // orthographic raymarch: camera at z = -9 looking +z
  var t = 0.0;
  var pos = vec3f(c, -9.0);
  var found = false;
  for (var i = 0; i < 40; i++) {
    pos = vec3f(c, -9.0 + t);
    let dd = mar6_crawler_sd3(pos, hd, ph);
    if (dd < 0.05) { found = true; break; }
    t += max(dd, 0.045);
    if (t > 18.0) { break; }
  }
  if (!found) {
    let a0 = smoothstep(0.15, -0.15, d2) * 0.7;
    return vec4f(vec3f(0.34, 0.36, 0.75) * 0.35, a0);
  }
  let e = 0.12;
  let d0 = mar6_crawler_sd3(pos, hd, ph);
  let nrm = normalize(vec3f(
    mar6_crawler_sd3(pos + vec3f(e, 0.0, 0.0), hd, ph) - d0,
    mar6_crawler_sd3(pos + vec3f(0.0, e, 0.0), hd, ph) - d0,
    mar6_crawler_sd3(pos + vec3f(0.0, 0.0, e), hd, ph) - d0
  ));
  let L = normalize(vec3f(-0.55, -0.75, -0.50));
  var sh = 1.0;
  var ts = 0.35;
  for (var si = 0; si < 7; si++) {
    let sd = mar6_crawler_sd3(pos + L * ts, hd, ph);
    sh = min(sh, clamp(sd / (ts * 0.22), 0.0, 1.0));
    ts += clamp(sd, 0.18, 1.6);
    if (ts > 9.0) { break; }
  }
  sh = clamp(sh, 0.0, 1.0);
  var ao = 0.0;
  for (var ki = 1; ki <= 3; ki++) {
    let ha = f32(ki) * 0.55;
    ao += clamp(mar6_crawler_sd3(pos + nrm * ha, hd, ph) / ha, 0.0, 1.0);
  }
  ao = clamp(ao / 3.0, 0.0, 1.0);
  let dif = clamp(dot(nrm, L), 0.0, 1.0);
  let V = vec3f(0.0, 0.0, -1.0);
  let Hh = normalize(L + V);
  let spe = pow(clamp(dot(nrm, Hh), 0.0, 1.0), 48.0);
  let fre = pow(1.0 - clamp(dot(nrm, V), 0.0, 1.0), 3.0);
  var lum = 0.14 + dif * (0.35 + 0.65 * sh) * 0.95;
  lum *= 0.45 + 0.55 * ao;
  let hq = pos.xy;
  var color = mod_ramp2(vec3f(0.10, 0.10, 0.28), vec3f(0.34, 0.36, 0.75), vec3f(0.78, 0.82, 1.0), clamp(lum, 0.0, 1.0));
  let bobC = sin(ph * 18.85) * 0.4;
  let bodyAC = rotate(vec2f(-5.0, bobC), hd);
  let bodyBC = rotate(vec2f(5.0, -bobC), hd);
  let ringv = smoothstep(0.35, 0.15, abs(fract(length(hq - bodyAC) * 0.33) - 0.5)) * smoothstep(5.0, 3.5, length(hq - bodyAC))
            + smoothstep(0.35, 0.15, abs(fract(length(hq - bodyBC) * 0.33) - 0.5)) * smoothstep(4.5, 3.0, length(hq - bodyBC));
  color *= 1.0 - 0.30 * clamp(ringv, 0.0, 1.0);
  color += vec3f(0.18, 0.10, 0.30) * fre;
  color += vec3f(1.4, 1.4, 1.3) * spe * (0.3 + 0.7 * sh) * 0.9;
  color += vec3f(0.28, 0.30, 0.90) * exp(d2 * 0.85) * 0.30;
  color += vec3f(0.10, 0.13, 0.20) * fre * 0.55;
  let headE = rotate(vec2f(9.5, -bobC - 1.0), hd);
  let eyeP = headE + rotate(vec2f(0.8, -0.8), hd);
  color = mix(color, vec3f(0.02, 0.02, 0.06), smoothstep(0.70, 0.42, length(hq - eyeP)));
  color += vec3f(1.5) * smoothstep(0.42, 0.14, length(hq - eyeP - vec2f(0.35, -0.35)));
  let alpha = smoothstep(0.15, -0.15, d2);
  return vec4f(color, alpha);
}`

// smooth energy beam bridge
const BRIDGE = /* wgsl */`
fn visual_mar6_bridge(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  if (p.y < 0.5) { return vec4f(0.0); }
  let c = uv * 32.0;
  let L = p.x * 30.0;
  var dmin = 999.0;
  var prev = rotate(vec2f(-L, 0.0), p.w);
  for (var i = 1; i <= 8; i++) {
    let fi = f32(i);
    var y = sin(fi * 2.3 + p.z * 7.0 + time * 9.0) * (2.2 + sin(time * 3.1 + fi) * 1.2);
    if (i == 8) { y = 0.0; }
    let cur = rotate(vec2f(-L + fi * (L * 2.0 / 8.0), y), p.w);
    dmin = min(dmin, mod_seg2(c, prev, cur));
    prev = cur;
  }
  var cc = vec3f(1.4, 1.6, 1.7) * exp(-dmin * dmin * 2.5);
  cc += vec3f(0.25, 0.55, 0.70) * exp(-dmin * 0.8) * 0.7;
  let a = clamp(exp(-dmin * 0.9) * 1.2, 0.0, 1.0);
  return vec4f(cc, a);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__mar) wd.__mar = { t: 0, cs: {} }
  const G = wd.__mar
  G.t += dt
  const creatures = [], bridges = []
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Serpent') || n.startsWith('Walker') || n.startsWith('Puppet') || n.startsWith('Crawler')) creatures.push(f)
    else if (n.startsWith('Bridge')) bridges.push(f)
  }
  const T = f => f.transform
  // stride = world px per gait cycle; derived from 2*L*pxPerUnit/duty so\n  // stance feet move backward at exactly body speed (planted, no skating)\n  const SPEC = { Serpent: { v: 34, stride: 46, turn: 0.9 }, Walker: { v: 26, stride: 68, turn: 0.7 }, Puppet: { v: 20, stride: 60, turn: 0.8 }, Crawler: { v: 30, stride: 50, turn: 1.1 } }
  for (let i = 0; i < creatures.length; i++) {
    const f = creatures[i]
    if (!G.cs[f.name]) G.cs[f.name] = { h: i * 1.7, ph: i * 2.3, reach: 0 }
    const S = G.cs[f.name]
    const spec = SPEC[f.name.split(' ')[0]] || SPEC.Serpent
    S.h += Math.sin(G.t * 0.5 + i * 2.7) * spec.turn * dt
    if (T(f).x < 85 || T(f).x > 427 || T(f).y < 85 || T(f).y > 427) {
      const ca = Math.atan2(256 - T(f).y, 256 - T(f).x)
      let dh = ca - S.h
      while (dh > Math.PI) dh -= 6.28318
      while (dh < -Math.PI) dh += 6.28318
      S.h += dh * Math.min(1, dt * 2.5)
    }
    T(f).vx = Math.cos(S.h) * spec.v
    T(f).vy = Math.sin(S.h) * spec.v
    S.ph += (Math.hypot(T(f).vx, T(f).vy) / spec.stride) * dt
    let best = null, bd = 1e9
    for (const o of creatures) {
      if (o === f) continue
      const d = Math.hypot(T(o).x - T(f).x, T(o).y - T(f).y)
      if (d < bd) { bd = d; best = o }
    }
    let ra = 0
    if (best) ra = Math.atan2(T(best).y - T(f).y, T(best).x - T(f).x)
    const want = bd < 140 ? 1 : 0
    S.reach += (want - S.reach) * Math.min(1, dt * 3)
    if (best && bd < 60) {
      const rx = T(f).x - T(best).x, ry = T(f).y - T(best).y
      T(f).vx += rx / bd * 45; T(f).vy += ry / bd * 45
    }
    f.visualParams = [S.h, S.ph, ra, S.reach]
  }
  const pairs = []
  for (let i = 0; i < creatures.length; i++) {
    for (let j = i + 1; j < creatures.length; j++) {
      const a = creatures[i], b = creatures[j]
      const d = Math.hypot(T(a).x - T(b).x, T(a).y - T(b).y)
      if (d < 130) pairs.push({ a, b, d })
    }
  }
  pairs.sort((x, y) => x.d - y.d)
  for (let k = 0; k < bridges.length; k++) {
    const br = bridges[k]
    if (k < pairs.length) {
      const pr = pairs[k]
      T(br).x = (T(pr.a).x + T(pr.b).x) / 2
      T(br).y = (T(pr.a).y + T(pr.b).y) / 2
      const ang = Math.atan2(T(pr.b).y - T(pr.a).y, T(pr.b).x - T(pr.a).x)
      br.visualParams = [Math.min(30, pr.d / 6) / 30, 1, (k + 1) * 3.3, ang]
      const Sa = G.cs[pr.a.name], Sb = G.cs[pr.b.name]
      if (Sa && Sb) {
        const m = (Sa.ph + Sb.ph) / 2
        Sa.ph += (m - Sa.ph) * dt * 1.5
        Sb.ph += (m - Sb.ph) * dt * 1.5
      }
    } else {
      br.visualParams = [0, 0, 0, 0]
    }
  }
} catch (e) { /* keep the sim alive */ }
`

const field = (id, name, color, x, y, shape, visualTypeName, vp) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
  ...(vp ? { visualParams: vp } : {}),
})

const scene = {
  name: 'MARIONETTES 3D',
  fields: [
    field('mar6_arena_f', 'Arena', [0.04, 0.05, 0.08, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'mar6_arena'),
    field('mar6_bridge_1', 'Bridge 1', [0.7, 1, 1, 1], 30, 30, { shapeType: 'circle', radius: 96 }, 'mar6_bridge', [0, 0, 0, 0]),
    field('mar6_bridge_2', 'Bridge 2', [0.7, 1, 1, 1], 30, 60, { shapeType: 'circle', radius: 96 }, 'mar6_bridge', [0, 0, 0, 0]),
    field('mar6_serpent_f', 'Serpent', [0.2, 0.6, 0.4, 1], 150, 150, { shapeType: 'circle', radius: 100 }, 'mar6_serpent', [0, 0, 0, 0]),
    field('mar6_walker_f', 'Walker', [0.78, 0.52, 0.18, 1], 370, 150, { shapeType: 'circle', radius: 100 }, 'mar6_walker', [0, 0, 0, 0]),
    field('mar6_puppet_f', 'Puppet', [0.75, 0.3, 0.46, 1], 150, 370, { shapeType: 'circle', radius: 100 }, 'mar6_puppet', [0, 0, 0, 0]),
    field('mar6_crawler_f', 'Crawler', [0.42, 0.44, 0.85, 1], 370, 370, { shapeType: 'circle', radius: 100 }, 'mar6_crawler', [0, 0, 0, 0]),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.5, gravitationalConstant: 0 },
  worldData: {
    postProcess: { bloomIntensity: 0.22, bloomThreshold: 0.80, exposure: 1.08, vignetteStrength: 0.30, vignetteRadius: 0.8 },
  },
  stepHooks: [{ id: 'mar_core', author: 'fable', description: 'MARIONETTES ULTRA: smooth skinned skeletons, neighbor reach, gait sync, energy bridges', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'mar6_arena', wgsl: ARENA },
    { name: 'mar6_bridge', wgsl: BRIDGE },
    { name: 'mar6_serpent', wgsl: SERPENT },
    { name: 'mar6_walker', wgsl: WALKER },
    { name: 'mar6_puppet', wgsl: PUPPET },
    { name: 'mar6_crawler', wgsl: CRAWLER },
  ],
  modules: [{ name: 'skel6', wgsl: MODULES }],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'MARIONETTES 3D', scene }),
})
console.log('MARIONETTES 3D saved:', res.status, await res.text())
