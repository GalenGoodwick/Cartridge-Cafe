// MARIONETTES APEX — ULTRA plus: soft self-shadows, crease AO, subsurface
// scattering at thin edges, dual specular lobes, sky bounce, and god rays.
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
fn mod_lum5(n: vec3f, occ: f32, gl: f32) -> vec2f {
  let key = normalize(vec3f(-0.5, -0.85, 0.55));
  let fill = normalize(vec3f(0.6, 0.7, 0.45));
  var lum = clamp((dot(n, key) + 0.35) / 1.35, 0.0, 1.0) * 0.95;
  lum += max(dot(n, fill), 0.0) * 0.22 + 0.10;
  lum *= 0.45 + 0.55 * occ;
  lum *= 0.55 + 0.45 * gl;
  let spec = pow(max(dot(n, normalize(key + vec3f(0.0, 0.0, 1.0))), 0.0), 48.0) * (0.4 + 0.6 * occ)
           + pow(max(dot(n, normalize(fill + vec3f(0.0, 0.0, 1.0))), 0.0), 12.0) * 0.22;
  return vec2f(lum, spec);
}`

const ARENA = /* wgsl */`
fn visual_mar5_arena(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
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
  // god rays — soft beams falling from the upper-left key light
  let rdir = normalize(vec2f(0.55, 0.83));
  let across = uv.x * rdir.y - uv.y * rdir.x;
  let along = dot(uv, rdir);
  let ray = pow(max(fbm(vec2f(across * 7.0, along * 1.1 - time * 0.04), 3), 0.0), 3.0);
  c += vec3f(0.30, 0.33, 0.27) * ray * smoothstep(1.2, -0.9, along) * 0.55;
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
fn mar5_serpent_sd(q: vec2f, hd: f32, ph: f32, ra: f32, reach: f32) -> vec2f {
  let head = rotate(vec2f(15.0, sin(ph * 1.4) * 1.2), hd);
  var d = length(q - head) - 2.7;
  var bestSeg = 999.0;
  var tPar = 0.0;
  var prev = head;
  for (var i = 1; i < 10; i++) {
    let fi = f32(i);
    let cur = rotate(vec2f(15.0 - fi * 3.3, sin(ph * 1.4 - fi * 0.85) * (1.6 + fi * 0.35)), hd);
    let r = max(2.3 - fi * 0.20, 0.5);
    let ab = cur - prev;
    let h = clamp(dot(q - prev, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
    let segd = length(q - prev - ab * h);
    if (segd < bestSeg) { bestSeg = segd; tPar = fi - 1.0 + h; }
    d = opSmoothUnion(d, segd - r, 1.1);
    prev = cur;
  }
  let flick = max(step(fract(ph * 0.20), 0.22), step(0.15, reach));
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
fn visual_mar5_serpent(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y; let ra = p.z; let reach = clamp(p.w, 0.0, 1.0);
  let res = mar5_serpent_sd(c, hd, ph, ra, reach);
  let d = res.x;
  let alpha = smoothstep(0.18, -0.18, d);
  if (alpha <= 0.004) {
    let ds = mar5_serpent_sd(c - vec2f(3.5, 4.5), hd, ph, ra, reach).x;
    let sh = smoothstep(2.2, -1.2, ds) * 0.40;
    return vec4f(vec3f(0.0), sh);
  }
  let e = 0.25;
  let dx = mar5_serpent_sd(c + vec2f(e, 0.0), hd, ph, ra, reach).x - d;
  let dy = mar5_serpent_sd(c + vec2f(0.0, e), hd, ph, ra, reach).x - d;
  let gl = clamp(length(vec2f(dx, dy)) / e, 0.0, 1.0);
  let n = normalize(vec3f(-dx / e, -dy / e, 1.30));
  let ldir = normalize(vec2f(-0.5, -0.85));
  var occ = 1.0;
  for (var st = 1; st <= 6; st++) {
    let tt = f32(st) * 1.1;
    occ = min(occ, clamp(0.55 + mar5_serpent_sd(c + ldir * tt, hd, ph, ra, reach).x / (tt * 0.35), 0.0, 1.0));
  }
  let ls = mod_lum5(n, occ, gl);
  var color = mod_ramp2(vec3f(0.04, 0.16, 0.10), vec3f(0.16, 0.55, 0.36), vec3f(0.66, 0.98, 0.74), clamp(ls.x, 0.0, 1.0));
  // subsurface: thin, light-averted edges transmit
  let thin = exp(d * 0.9);
  let back = clamp(-(n.x * ldir.x + n.y * ldir.y), 0.0, 1.0);
  color += vec3f(0.12, 0.75, 0.40) * thin * (0.28 + 0.45 * back);
  // sky bounce on upward-facing surfaces
  color += vec3f(0.10, 0.13, 0.20) * clamp(-n.y, 0.0, 1.0) * 0.5;
  // smooth scale bands along the spine + fine scale shimmer
  let band = smoothstep(0.15, 0.65, sin(res.y * 4.7));
  color *= mix(1.0, 0.58, band);
  color *= 0.92 + 0.14 * vnoise(c * 2.6 + vec2f(res.y * 3.0, 0.0));
  // hood
  let hood = rotate(vec2f(11.0, sin(ph * 1.4 - 0.85) * 1.9), hd);
  color *= 1.0 - 0.4 * smoothstep(2.8, 1.2, length(c - hood));
  color += vec3f(1.2, 1.4, 1.1) * ls.y * 0.5;
  color *= 1.0 - 0.28 * smoothstep(-1.0, 0.0, d);
  color = mix(color, vec3f(1.0), reach * 0.08);
  let head = rotate(vec2f(15.0, sin(ph * 1.4) * 1.2), hd);
  let eyeP = head + rotate(vec2f(1.1, -1.1), hd);
  if (mod_blink2(time, 0.13) < 0.5) {
    color = mix(color, vec3f(0.02, 0.05, 0.03), smoothstep(0.75, 0.45, length(c - eyeP)));
    color += vec3f(1.4) * smoothstep(0.45, 0.15, length(c - eyeP - vec2f(0.35, -0.35)));
  }
  return vec4f(color, alpha);
}`

// ── Walker ──
const WALKER = /* wgsl */`
fn mar5_walker_sd(q: vec2f, hd: f32, ph: f32) -> f32 {
  let bob = sin(ph * 2.0) * 0.8;
  let hip = rotate(vec2f(-7.0, bob * 0.5), hd);
  let chest = rotate(vec2f(6.0, bob), hd);
  let head = rotate(vec2f(13.0, -3.0 + bob), hd);
  let wag = sin(ph * 0.9) * 1.6;
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
    let fi = f32(i);
    let front = f32(i / 2);
    let baseL = mix(vec2f(-7.0, bob * 0.5), vec2f(6.0, bob), front);
    let off = ph + fi * 1.5708;
    let fx = baseL.x + sin(off) * 4.5;
    let lift = max(sin(off + 1.5708), 0.0) * 2.5;
    let footL = vec2f(fx, 10.0 - lift);
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
fn visual_mar5_walker(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y; let reach = clamp(p.w, 0.0, 1.0);
  let d = mar5_walker_sd(c, hd, ph);
  let alpha = smoothstep(0.18, -0.18, d);
  if (alpha <= 0.004) {
    let ds = mar5_walker_sd(c - vec2f(3.5, 4.5), hd, ph);
    let sh = smoothstep(2.2, -1.2, ds) * 0.40;
    return vec4f(vec3f(0.0), sh);
  }
  let e = 0.25;
  let dx = mar5_walker_sd(c + vec2f(e, 0.0), hd, ph) - d;
  let dy = mar5_walker_sd(c + vec2f(0.0, e), hd, ph) - d;
  let gl = clamp(length(vec2f(dx, dy)) / e, 0.0, 1.0);
  let n = normalize(vec3f(-dx / e, -dy / e, 1.30));
  let ldir = normalize(vec2f(-0.5, -0.85));
  var occ = 1.0;
  for (var st = 1; st <= 6; st++) {
    let tt = f32(st) * 1.1;
    occ = min(occ, clamp(0.55 + mar5_walker_sd(c + ldir * tt, hd, ph) / (tt * 0.35), 0.0, 1.0));
  }
  let ls = mod_lum5(n, occ, gl);
  var color = mod_ramp2(vec3f(0.22, 0.11, 0.04), vec3f(0.70, 0.45, 0.16), vec3f(1.0, 0.88, 0.60), clamp(ls.x, 0.0, 1.0));
  // subsurface: thin, light-averted edges transmit
  let thin = exp(d * 0.9);
  let back = clamp(-(n.x * ldir.x + n.y * ldir.y), 0.0, 1.0);
  color += vec3f(0.85, 0.42, 0.12) * thin * (0.28 + 0.45 * back);
  // sky bounce on upward-facing surfaces
  color += vec3f(0.10, 0.13, 0.20) * clamp(-n.y, 0.0, 1.0) * 0.5;
  // directional fur — streaks along the body axis
  let bl = rotate(c, -hd);
  let fur = fbm(bl * vec2f(0.9, 3.2) + vec2f(3.0, 7.0), 3);
  color *= 0.84 + 0.30 * fur;
  // creamy underside
  color = mix(color, vec3f(0.95, 0.88, 0.70), smoothstep(0.1, 0.7, n.y) * 0.45);
  color += vec3f(1.3, 1.2, 1.0) * ls.y * 0.35;
  color *= 1.0 - 0.28 * smoothstep(-1.0, 0.0, d);
  color = mix(color, vec3f(1.0), reach * 0.08);
  let bob = sin(ph * 2.0) * 0.8;
  let head = rotate(vec2f(13.0, -3.0 + bob), hd);
  let eyeP = head + rotate(vec2f(1.0, -0.9), hd);
  if (mod_blink2(time, 0.47) < 0.5) {
    color = mix(color, vec3f(0.05, 0.03, 0.01), smoothstep(0.75, 0.45, length(c - eyeP)));
    color += vec3f(1.4) * smoothstep(0.45, 0.15, length(c - eyeP - vec2f(0.35, -0.35)));
  }
  color = mix(color, vec3f(0.06, 0.03, 0.02), smoothstep(0.75, 0.40, length(c - (head + rotate(vec2f(3.8, 0.4), hd)))));
  return vec4f(color, alpha);
}`

// ── Puppet ──
const PUPPET = /* wgsl */`
fn mar5_puppet_sd(q: vec2f, hd: f32, ph: f32, ra: f32, reach: f32) -> f32 {
  let bob = sin(ph * 2.0) * 0.6;
  let pelvis = rotate(vec2f(0.0, 2.0 + bob), hd);
  let chest = rotate(vec2f(0.8, -5.0 + bob), hd);
  let head = rotate(vec2f(1.4, -11.0 + bob), hd);
  var d = mod_cap2(q, pelvis, chest, 2.0);
  d = opSmoothUnion(d, mod_cap2(q, chest, head, 1.0), 1.0);
  d = opSmoothUnion(d, length(q - head) - 2.6, 0.9);
  for (var i = 0; i < 2; i++) {
    let off = ph + f32(i) * 3.14159;
    let fx = sin(off) * 4.0;
    let lift = max(sin(off + 1.5708), 0.0) * 2.2;
    let footL = vec2f(fx, 12.0 - lift);
    let kneeL = vec2f(fx * 0.5 + 1.2, (2.0 + footL.y) * 0.5);
    let knee = rotate(kneeL + vec2f(0.0, bob * 0.5), hd);
    let foot = rotate(footL, hd);
    d = opSmoothUnion(d, mod_cap2(q, pelvis, knee, 0.95), 0.8);
    d = opSmoothUnion(d, mod_cap2(q, knee, foot, 0.72), 0.7);
    d = opSmoothUnion(d, length(q - foot) - 0.9, 0.5);
  }
  let swing = sin(ph + 3.14159) * 3.0;
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
fn visual_mar5_puppet(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y; let ra = p.z; let reach = clamp(p.w, 0.0, 1.0);
  let d = mar5_puppet_sd(c, hd, ph, ra, reach);
  let alpha = smoothstep(0.18, -0.18, d);
  if (alpha <= 0.004) {
    let ds = mar5_puppet_sd(c - vec2f(3.5, 4.5), hd, ph, ra, reach);
    let sh = smoothstep(2.2, -1.2, ds) * 0.40;
    return vec4f(vec3f(0.0), sh);
  }
  let e = 0.25;
  let dx = mar5_puppet_sd(c + vec2f(e, 0.0), hd, ph, ra, reach) - d;
  let dy = mar5_puppet_sd(c + vec2f(0.0, e), hd, ph, ra, reach) - d;
  let gl = clamp(length(vec2f(dx, dy)) / e, 0.0, 1.0);
  let n = normalize(vec3f(-dx / e, -dy / e, 1.30));
  let ldir = normalize(vec2f(-0.5, -0.85));
  var occ = 1.0;
  for (var st = 1; st <= 6; st++) {
    let tt = f32(st) * 1.1;
    occ = min(occ, clamp(0.55 + mar5_puppet_sd(c + ldir * tt, hd, ph, ra, reach) / (tt * 0.35), 0.0, 1.0));
  }
  let ls = mod_lum5(n, occ, gl);
  var color = mod_ramp2(vec3f(0.24, 0.07, 0.13), vec3f(0.68, 0.28, 0.42), vec3f(1.0, 0.72, 0.80), clamp(ls.x, 0.0, 1.0));
  // subsurface: thin, light-averted edges transmit
  let thin = exp(d * 0.9);
  let back = clamp(-(n.x * ldir.x + n.y * ldir.y), 0.0, 1.0);
  color += vec3f(0.85, 0.28, 0.38) * thin * (0.28 + 0.45 * back);
  // sky bounce on upward-facing surfaces
  color += vec3f(0.10, 0.13, 0.20) * clamp(-n.y, 0.0, 1.0) * 0.5;
  // woven vest over the torso
  let bob = sin(ph * 2.0) * 0.6;
  let pelvis = rotate(vec2f(0.0, 2.0 + bob), hd);
  let chest = rotate(vec2f(0.8, -5.0 + bob), hd);
  let vest = smoothstep(2.3, 1.7, mod_seg2(c, pelvis, chest));
  let weave = (sin(c.x * 7.0) + sin(c.y * 7.0)) * 0.5;
  color = mix(color, vec3f(0.22, 0.10, 0.30) * (1.0 + 0.10 * weave), vest * 0.8);
  color += vec3f(1.2, 1.1, 1.1) * ls.y * 0.35;
  color *= 1.0 - 0.28 * smoothstep(-1.0, 0.0, d);
  // hair — dark cap on the top-back of the skull
  let head = rotate(vec2f(1.4, -11.0 + bob), hd);
  let hairP = head + rotate(vec2f(-0.4, -1.4), hd);
  color = mix(color, vec3f(0.20, 0.06, 0.14), smoothstep(2.2, 1.0, length(c - hairP)) * 0.85);
  color = mix(color, vec3f(1.0), reach * 0.08);
  let eyeP = head + rotate(vec2f(1.0, -0.6), hd);
  if (mod_blink2(time, 0.71) < 0.5) {
    color = mix(color, vec3f(0.04, 0.01, 0.03), smoothstep(0.70, 0.42, length(c - eyeP)));
    color += vec3f(1.4) * smoothstep(0.42, 0.14, length(c - eyeP - vec2f(0.35, -0.35)));
  }
  return vec4f(color, alpha);
}`

// ── Crawler ──
const CRAWLER = /* wgsl */`
fn mar5_crawler_sd(q: vec2f, hd: f32, ph: f32) -> f32 {
  let bob = sin(ph * 3.0) * 0.5;
  let bodyA = rotate(vec2f(-5.0, bob), hd);
  let bodyB = rotate(vec2f(5.0, -bob), hd);
  let headP = rotate(vec2f(9.5, -bob - 1.0), hd);
  var d = length(q - bodyA) - 3.2;
  d = opSmoothUnion(d, length(q - bodyB) - 2.8, 1.6);
  d = opSmoothUnion(d, mod_cap2(q, bodyA, bodyB, 2.2), 1.4);
  d = opSmoothUnion(d, length(q - headP) - 1.9, 1.0);
  d = min(d, mod_cap2(q, headP, headP + rotate(vec2f(3.0, -3.0 + sin(ph * 2.0)), hd), 0.35));
  d = min(d, mod_cap2(q, headP, headP + rotate(vec2f(3.5, 1.5 + cos(ph * 2.0)), hd), 0.35));
  let mnd = sin(ph * 3.0) * 0.5;
  d = min(d, mod_cap2(q, headP + rotate(vec2f(1.5, -0.8), hd), headP + rotate(vec2f(3.2, -1.4 + mnd), hd), 0.4));
  d = min(d, mod_cap2(q, headP + rotate(vec2f(1.5, 0.6), hd), headP + rotate(vec2f(3.2, 1.2 - mnd), hd), 0.4));
  for (var i = 0; i < 6; i++) {
    let xi = f32(i % 3);
    let side = f32(i / 3) * 2.0 - 1.0;
    let tri = f32((i + i / 3) % 2);
    let baseL = vec2f(-6.0 + xi * 6.0, side * 1.5);
    let off = ph * 1.6 + tri * 3.14159 + xi * 0.4;
    let fx = baseL.x + sin(off) * 3.0;
    let lift = max(sin(off + 1.5708), 0.0) * 2.0;
    let footL = vec2f(fx, side * (8.5 - lift));
    let kneeL = vec2f((baseL.x + fx) * 0.5, side * 5.0 + baseL.y);
    let base = rotate(baseL, hd);
    let knee = rotate(kneeL, hd);
    let foot = rotate(footL, hd);
    d = min(d, mod_cap2(q, base, knee, 0.55));
    d = min(d, mod_cap2(q, knee, foot, 0.45));
  }
  return d;
}
fn visual_mar5_crawler(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y; let reach = clamp(p.w, 0.0, 1.0);
  let d = mar5_crawler_sd(c, hd, ph);
  let alpha = smoothstep(0.18, -0.18, d);
  if (alpha <= 0.004) {
    let ds = mar5_crawler_sd(c - vec2f(3.5, 4.5), hd, ph);
    let sh = smoothstep(2.2, -1.2, ds) * 0.40;
    return vec4f(vec3f(0.0), sh);
  }
  let e = 0.25;
  let dx = mar5_crawler_sd(c + vec2f(e, 0.0), hd, ph) - d;
  let dy = mar5_crawler_sd(c + vec2f(0.0, e), hd, ph) - d;
  let gl = clamp(length(vec2f(dx, dy)) / e, 0.0, 1.0);
  let n = normalize(vec3f(-dx / e, -dy / e, 1.30));
  let ldir = normalize(vec2f(-0.5, -0.85));
  var occ = 1.0;
  for (var st = 1; st <= 6; st++) {
    let tt = f32(st) * 1.1;
    occ = min(occ, clamp(0.55 + mar5_crawler_sd(c + ldir * tt, hd, ph) / (tt * 0.35), 0.0, 1.0));
  }
  let ls = mod_lum5(n, occ, gl);
  var color = mod_ramp2(vec3f(0.10, 0.10, 0.28), vec3f(0.34, 0.36, 0.75), vec3f(0.78, 0.82, 1.0), clamp(ls.x, 0.0, 1.0));
  // subsurface: thin, light-averted edges transmit
  let thin = exp(d * 0.9);
  let back = clamp(-(n.x * ldir.x + n.y * ldir.y), 0.0, 1.0);
  color += vec3f(0.28, 0.30, 0.90) * thin * (0.28 + 0.45 * back);
  // sky bounce on upward-facing surfaces
  color += vec3f(0.10, 0.13, 0.20) * clamp(-n.y, 0.0, 1.0) * 0.5;
  // chitin: growth rings, gloss, edge iridescence
  let bob = sin(ph * 3.0) * 0.5;
  let bodyA = rotate(vec2f(-5.0, bob), hd);
  let bodyB = rotate(vec2f(5.0, -bob), hd);
  let ring = smoothstep(0.35, 0.15, abs(fract(length(c - bodyA) * 0.33) - 0.5)) * smoothstep(5.0, 3.5, length(c - bodyA))
           + smoothstep(0.35, 0.15, abs(fract(length(c - bodyB) * 0.33) - 0.5)) * smoothstep(4.5, 3.0, length(c - bodyB));
  color *= 1.0 - 0.30 * clamp(ring, 0.0, 1.0);
  let fres = pow(1.0 - abs(n.z), 1.6);
  color += vec3f(0.18, 0.10, 0.30) * fres;
  color += vec3f(1.5, 1.5, 1.8) * ls.y * 0.8;
  color *= 1.0 - 0.28 * smoothstep(-1.0, 0.0, d);
  color = mix(color, vec3f(1.0), reach * 0.08);
  let headP = rotate(vec2f(9.5, -bob - 1.0), hd);
  let eyeP = headP + rotate(vec2f(0.8, -0.8), hd);
  color = mix(color, vec3f(0.02, 0.02, 0.06), smoothstep(0.70, 0.42, length(c - eyeP)));
  color += vec3f(1.5) * smoothstep(0.42, 0.14, length(c - eyeP - vec2f(0.35, -0.35)));
  return vec4f(color, alpha);
}`

// smooth energy beam bridge
const BRIDGE = /* wgsl */`
fn visual_mar5_bridge(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
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
  const SPEC = { Serpent: { v: 34, gait: 2.6, turn: 0.9 }, Walker: { v: 26, gait: 3.2, turn: 0.7 }, Puppet: { v: 20, gait: 3.0, turn: 0.8 }, Crawler: { v: 30, gait: 4.4, turn: 1.1 } }
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
    S.ph += spec.gait * dt
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
  name: 'MARIONETTES APEX',
  fields: [
    field('mar5_arena_f', 'Arena', [0.04, 0.05, 0.08, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'mar5_arena'),
    field('mar5_bridge_1', 'Bridge 1', [0.7, 1, 1, 1], 30, 30, { shapeType: 'circle', radius: 96 }, 'mar5_bridge', [0, 0, 0, 0]),
    field('mar5_bridge_2', 'Bridge 2', [0.7, 1, 1, 1], 30, 60, { shapeType: 'circle', radius: 96 }, 'mar5_bridge', [0, 0, 0, 0]),
    field('mar5_serpent_f', 'Serpent', [0.2, 0.6, 0.4, 1], 150, 150, { shapeType: 'circle', radius: 100 }, 'mar5_serpent', [0, 0, 0, 0]),
    field('mar5_walker_f', 'Walker', [0.78, 0.52, 0.18, 1], 370, 150, { shapeType: 'circle', radius: 100 }, 'mar5_walker', [0, 0, 0, 0]),
    field('mar5_puppet_f', 'Puppet', [0.75, 0.3, 0.46, 1], 150, 370, { shapeType: 'circle', radius: 100 }, 'mar5_puppet', [0, 0, 0, 0]),
    field('mar5_crawler_f', 'Crawler', [0.42, 0.44, 0.85, 1], 370, 370, { shapeType: 'circle', radius: 100 }, 'mar5_crawler', [0, 0, 0, 0]),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.5, gravitationalConstant: 0 },
  worldData: {
    postProcess: { bloomIntensity: 0.24, bloomThreshold: 0.75, exposure: 1.08, vignetteStrength: 0.32, vignetteRadius: 0.8 },
  },
  stepHooks: [{ id: 'mar_core', author: 'fable', description: 'MARIONETTES ULTRA: smooth skinned skeletons, neighbor reach, gait sync, energy bridges', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'mar5_arena', wgsl: ARENA },
    { name: 'mar5_bridge', wgsl: BRIDGE },
    { name: 'mar5_serpent', wgsl: SERPENT },
    { name: 'mar5_walker', wgsl: WALKER },
    { name: 'mar5_puppet', wgsl: PUPPET },
    { name: 'mar5_crawler', wgsl: CRAWLER },
  ],
  modules: [{ name: 'skel5', wgsl: MODULES }],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'MARIONETTES APEX', scene }),
})
console.log('MARIONETTES APEX saved:', res.status, await res.text())
