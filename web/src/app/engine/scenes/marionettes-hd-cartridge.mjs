// MARIONETTES HD — same rig and skin, 2.7x texel density (120/creature), — the skeleton rig becomes flesh, then character.
// Same FK skeletons and hook as v1; each creature is a smooth-union of capsules
// over its bones, shaded with SDF-gradient bevel lighting quantized into
// checker-dithered 4-band cel shading, plus: rim light, dithered contact
// shadows, blinking eyes, and per-creature patterning (serpent spine-bands,
// walker fur speckle + ears + tail wag, puppet vest + hair, crawler carapace
// rings + mandibles). Still pixel-perfect: heading rotates joints BEFORE
// texel quantization. Helper fns use the mod_*2 suffix (no v1 collisions).

const MODULES = /* wgsl */`
fn mod_px2(uv: vec2f, res: f32) -> vec2f {
  let t = (uv * 0.5 + vec2f(0.5)) * res;
  return floor(t) + vec2f(0.5) - vec2f(res * 0.5);
}
fn mod_seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(p - a - ab * h);
}
fn mod_cap2(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  return mod_seg2(p, a, b) - r;
}
fn mod_node2(p: vec2f, c: vec2f, r: f32) -> f32 {
  let d = abs(p - c);
  return step(d.x + d.y, r);
}
fn mod_chk2(c: vec2f) -> f32 {
  return f32((i32(c.x + 200.0) + i32(c.y + 200.0)) % 2);
}
fn mod_band2(lum: f32, c: vec2f, steps: f32) -> f32 {
  let lq = clamp(lum, 0.0, 1.0) * steps;
  let fl = floor(lq);
  let fr = lq - fl;
  let dith = step(0.75 - mod_chk2(c) * 0.5, fr);
  return clamp((fl + dith) / steps, 0.0, 1.0);
}
fn mod_ramp2(dark: vec3f, base: vec3f, lite: vec3f, t: f32) -> vec3f {
  let lo = clamp(t * 2.0, 0.0, 1.0);
  let hi = clamp(t * 2.0 - 1.0, 0.0, 1.0);
  return mix(mix(dark, base, lo), lite, hi);
}
fn mod_blink2(time: f32, seed: f32) -> f32 {
  return step(fract(time * 0.31 + seed), 0.06);
}`

const ARENA = /* wgsl */`
fn visual_mar3_arena(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let t = (uv * 0.5 + vec2f(0.5)) * 256.0;
  let q = floor(t);
  var c = vec3f(0.016, 0.019, 0.031);
  c += vec3f(0.010, 0.012, 0.020) * (q.y / 256.0);
  let f = fbm(q * 0.0225, 3);
  c += vec3f(0.008, 0.012, 0.010) * step(0.55, f);
  c += vec3f(0.004, 0.006, 0.005) * step(0.62, f);
  c += vec3f(0.003) * mod_chk2(q);
  let h = hash21(q);
  if (h > 0.9990) {
    let tq = floor(time * 1.5);
    let blink = step(0.25, hash21(q + vec2f(tq * 0.37, tq * 0.11)));
    c = mix(c, vec3f(0.26, 0.30, 0.40), blink);
  }
  return vec4f(c, 1.0);
}`

// ── Serpent: tapered chain + spine-parameterized bands, hood, forked tongue ──
const SERPENT = /* wgsl */`
fn mar3_serpent_sd(q: vec2f, hd: f32, ph: f32, ra: f32, reach: f32) -> vec2f {
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
  // forked tongue — flicks on a timer, extends toward the neighbor when reaching
  let flick = max(step(fract(ph * 0.20), 0.22), step(0.15, reach));
  if (flick > 0.5) {
    let dir = vec2f(cos(ra), sin(ra));
    let len = 2.5 + 4.0 * reach;
    let tip = head + dir * len;
    let side = vec2f(-dir.y, dir.x);
    d = min(d, mod_cap2(q, head + dir * 2.0, tip, 0.4));
    d = min(d, mod_cap2(q, tip, tip + dir * 1.6 + side * 1.0, 0.35));
    d = min(d, mod_cap2(q, tip, tip + dir * 1.6 - side * 1.0, 0.35));
  }
  return vec2f(d, tPar);
}
fn visual_mar3_serpent(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let ct = mod_px2(uv, 120.0);
  let c = ct * (44.0 / 120.0);
  let hd = p.x; let ph = p.y; let ra = p.z; let reach = clamp(p.w, 0.0, 1.0);
  let res = mar3_serpent_sd(c, hd, ph, ra, reach);
  let d = res.x;
  if (d > 1.0) {
    // dithered contact shadow, cast down-right of the body
    let ds = mar3_serpent_sd(c - vec2f(4.0, 5.0), hd, ph, ra, reach).x;
    if (ds < 0.0 && mod_chk2(ct) > 0.5) { return vec4f(0.004, 0.005, 0.010, 0.6); }
    return vec4f(0.0);
  }
  if (d > 0.0) { return vec4f(0.02, 0.08, 0.05, 1.0); }
  let e = 0.4;
  let dx = mar3_serpent_sd(c + vec2f(e, 0.0), hd, ph, ra, reach).x - d;
  let dy = mar3_serpent_sd(c + vec2f(0.0, e), hd, ph, ra, reach).x - d;
  let n = normalize(vec3f(-dx, -dy, 1.1));
  let L = normalize(vec3f(-0.5, -0.85, 0.62));
  let lum = clamp(dot(n, L) * 0.75 + 0.35, 0.0, 1.0);
  let band = mod_band2(lum, ct, 5.0);
  var color = mod_ramp2(vec3f(0.05, 0.22, 0.14), vec3f(0.20, 0.62, 0.42), vec3f(0.62, 0.95, 0.72), band);
  // spine-following scale bands
  let stripe = step(0.60, fract(res.y * 0.75));
  color = mix(color, color * 0.58, stripe);
  // hood marking behind the head
  let hood = rotate(vec2f(11.0, sin(ph * 1.4 - 0.85) * 1.9), hd);
  color = mix(color, color * 0.55, mod_node2(c, hood, 2.6) * (1.0 - stripe));
  // rim light on the lit edge
  if (d > -1.5 && lum > 0.60) { color = vec3f(0.72, 1.0, 0.80); }
  color = mix(color, vec3f(1.0), reach * 0.10);
  let head = rotate(vec2f(15.0, sin(ph * 1.4) * 1.2), hd);
  let eyeP = head + rotate(vec2f(1.1, -1.1), hd);
  if (mod_blink2(time, 0.13) < 0.5) {
    color = mix(color, vec3f(0.02, 0.04, 0.03), mod_node2(c, eyeP, 0.55));
    color = mix(color, vec3f(0.95), mod_node2(c, eyeP + vec2f(0.8, -0.8), 0.35));
  }
  return vec4f(color, 1.0);
}`

// ── Walker: quadruped + fur speckle, ears, wagging tail, paws ──
const WALKER = /* wgsl */`
fn mar3_walker_sd(q: vec2f, hd: f32, ph: f32) -> f32 {
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
  // snout
  d = opSmoothUnion(d, length(q - (head + rotate(vec2f(2.6, 0.4), hd))) - 1.2, 0.9);
  d = opSmoothUnion(d, mod_cap2(q, hip, tail, 0.9), 1.2);
  d = opSmoothUnion(d, mod_cap2(q, tail, tailTip, 0.55), 0.8);
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
fn visual_mar3_walker(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let ct = mod_px2(uv, 120.0);
  let c = ct * (44.0 / 120.0);
  let hd = p.x; let ph = p.y; let reach = clamp(p.w, 0.0, 1.0);
  let d = mar3_walker_sd(c, hd, ph);
  let bob = sin(ph * 2.0) * 0.8;
  let head = rotate(vec2f(13.0, -3.0 + bob), hd);
  // ears — diamonds riding above the skull, outside the flesh SDF
  let earA = mod_node2(c, head + rotate(vec2f(-0.6, -3.2), hd), 1.2);
  let earB = mod_node2(c, head + rotate(vec2f(1.4, -3.0), hd), 1.0);
  if (d > 1.0 && earA + earB < 0.5) {
    let ds = mar3_walker_sd(c - vec2f(4.0, 5.0), hd, ph);
    if (ds < 0.0 && mod_chk2(ct) > 0.5) { return vec4f(0.004, 0.005, 0.010, 0.6); }
    return vec4f(0.0);
  }
  if (d > 0.0 && earA + earB < 0.5) { return vec4f(0.10, 0.05, 0.02, 1.0); }
  let e = 0.4;
  let dx = mar3_walker_sd(c + vec2f(e, 0.0), hd, ph) - d;
  let dy = mar3_walker_sd(c + vec2f(0.0, e), hd, ph) - d;
  let n = normalize(vec3f(-dx, -dy, 1.1));
  let L = normalize(vec3f(-0.5, -0.85, 0.62));
  let lum = clamp(dot(n, L) * 0.75 + 0.35, 0.0, 1.0);
  let band = mod_band2(lum, ct, 5.0);
  var color = mod_ramp2(vec3f(0.30, 0.16, 0.05), vec3f(0.78, 0.52, 0.18), vec3f(1.0, 0.85, 0.55), band);
  // fur — sparse dark speckle, denser in the mid bands
  let speck = step(0.84, hash21(ct + vec2f(37.0, 11.0)));
  color = mix(color, color * 0.55, speck * step(0.2, band) * step(band, 0.8));
  if (d > -1.5 && lum > 0.60) { color = vec3f(1.0, 0.92, 0.66); }
  if (earA + earB > 0.5) { color = vec3f(0.52, 0.32, 0.10); }
  color = mix(color, vec3f(1.0), reach * 0.10);
  let eyeP = head + rotate(vec2f(1.0, -0.9), hd);
  if (mod_blink2(time, 0.47) < 0.5) {
    color = mix(color, vec3f(0.06, 0.03, 0.01), mod_node2(c, eyeP, 0.55));
    color = mix(color, vec3f(0.95), mod_node2(c, eyeP + vec2f(0.8, -0.8), 0.35));
  }
  // nose pixel on the snout
  color = mix(color, vec3f(0.08, 0.04, 0.03), mod_node2(c, head + rotate(vec2f(3.8, 0.4), hd), 0.6));
  return vec4f(color, 1.0);
}`

// ── Puppet: biped + dithered vest, hair tuft, reaching arm ──
const PUPPET = /* wgsl */`
fn mar3_puppet_sd(q: vec2f, hd: f32, ph: f32, ra: f32, reach: f32) -> f32 {
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
fn visual_mar3_puppet(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let ct = mod_px2(uv, 120.0);
  let c = ct * (44.0 / 120.0);
  let hd = p.x; let ph = p.y; let ra = p.z; let reach = clamp(p.w, 0.0, 1.0);
  let d = mar3_puppet_sd(c, hd, ph, ra, reach);
  let bob = sin(ph * 2.0) * 0.6;
  let head = rotate(vec2f(1.4, -11.0 + bob), hd);
  // hair tuft above the skull
  let hair = max(mod_node2(c, head + rotate(vec2f(-0.5, -3.0), hd), 1.1),
                 mod_node2(c, head + rotate(vec2f(1.2, -3.3), hd), 0.9));
  if (d > 1.0 && hair < 0.5) {
    let ds = mar3_puppet_sd(c - vec2f(4.0, 5.0), hd, ph, ra, reach);
    if (ds < 0.0 && mod_chk2(ct) > 0.5) { return vec4f(0.004, 0.005, 0.010, 0.6); }
    return vec4f(0.0);
  }
  if (d > 0.0 && hair < 0.5) { return vec4f(0.10, 0.02, 0.05, 1.0); }
  let e = 0.4;
  let dx = mar3_puppet_sd(c + vec2f(e, 0.0), hd, ph, ra, reach) - d;
  let dy = mar3_puppet_sd(c + vec2f(0.0, e), hd, ph, ra, reach) - d;
  let n = normalize(vec3f(-dx, -dy, 1.1));
  let L = normalize(vec3f(-0.5, -0.85, 0.62));
  let lum = clamp(dot(n, L) * 0.75 + 0.35, 0.0, 1.0);
  let band = mod_band2(lum, ct, 5.0);
  var color = mod_ramp2(vec3f(0.30, 0.08, 0.16), vec3f(0.75, 0.30, 0.46), vec3f(1.0, 0.68, 0.78), band);
  // dithered vest over the torso
  let pelvis = rotate(vec2f(0.0, 2.0 + bob), hd);
  let chest = rotate(vec2f(0.8, -5.0 + bob), hd);
  let vest = step(mod_seg2(c, pelvis, chest), 2.1) * mod_chk2(ct);
  color = mix(color, vec3f(0.24, 0.10, 0.30), vest * 0.85);
  if (d > -1.5 && lum > 0.60) { color = vec3f(1.0, 0.80, 0.88); }
  if (hair > 0.5) { color = vec3f(0.36, 0.10, 0.22); }
  color = mix(color, vec3f(1.0), reach * 0.10);
  let eyeP = head + rotate(vec2f(1.0, -0.6), hd);
  if (mod_blink2(time, 0.71) < 0.5) {
    color = mix(color, vec3f(0.05, 0.01, 0.03), mod_node2(c, eyeP, 0.55));
    color = mix(color, vec3f(0.95), mod_node2(c, eyeP + vec2f(0.8, -0.8), 0.35));
  }
  return vec4f(color, 1.0);
}`

// ── Crawler: beetle + carapace rings, mandibles, leg-joint dots ──
const CRAWLER = /* wgsl */`
fn mar3_crawler_sd(q: vec2f, hd: f32, ph: f32) -> f32 {
  let bob = sin(ph * 3.0) * 0.5;
  let bodyA = rotate(vec2f(-5.0, bob), hd);
  let bodyB = rotate(vec2f(5.0, -bob), hd);
  let headP = rotate(vec2f(9.5, -bob - 1.0), hd);
  var d = length(q - bodyA) - 3.2;
  d = opSmoothUnion(d, length(q - bodyB) - 2.8, 1.6);
  d = opSmoothUnion(d, mod_cap2(q, bodyA, bodyB, 2.2), 1.4);
  d = opSmoothUnion(d, length(q - headP) - 1.9, 1.0);
  // antennae + mandibles
  d = min(d, mod_cap2(q, headP, headP + rotate(vec2f(3.0, -3.0 + sin(ph * 2.0)), hd), 0.4));
  d = min(d, mod_cap2(q, headP, headP + rotate(vec2f(3.5, 1.5 + cos(ph * 2.0)), hd), 0.4));
  let mnd = sin(ph * 3.0) * 0.5;
  d = min(d, mod_cap2(q, headP + rotate(vec2f(1.5, -0.8), hd), headP + rotate(vec2f(3.2, -1.4 + mnd), hd), 0.45));
  d = min(d, mod_cap2(q, headP + rotate(vec2f(1.5, 0.6), hd), headP + rotate(vec2f(3.2, 1.2 - mnd), hd), 0.45));
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
    d = min(d, mod_cap2(q, base, knee, 0.62));
    d = min(d, mod_cap2(q, knee, foot, 0.5));
  }
  return d;
}
fn visual_mar3_crawler(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let ct = mod_px2(uv, 120.0);
  let c = ct * (44.0 / 120.0);
  let hd = p.x; let ph = p.y; let reach = clamp(p.w, 0.0, 1.0);
  let d = mar3_crawler_sd(c, hd, ph);
  if (d > 1.0) {
    let ds = mar3_crawler_sd(c - vec2f(4.0, 5.0), hd, ph);
    if (ds < 0.0 && mod_chk2(ct) > 0.5) { return vec4f(0.004, 0.005, 0.010, 0.6); }
    return vec4f(0.0);
  }
  if (d > 0.0) { return vec4f(0.05, 0.05, 0.14, 1.0); }
  let e = 0.4;
  let dx = mar3_crawler_sd(c + vec2f(e, 0.0), hd, ph) - d;
  let dy = mar3_crawler_sd(c + vec2f(0.0, e), hd, ph) - d;
  let n = normalize(vec3f(-dx, -dy, 1.1));
  let L = normalize(vec3f(-0.5, -0.85, 0.62));
  let lum = clamp(dot(n, L) * 0.75 + 0.35, 0.0, 1.0);
  let band = mod_band2(lum, ct, 5.0);
  var color = mod_ramp2(vec3f(0.14, 0.14, 0.36), vec3f(0.42, 0.44, 0.85), vec3f(0.76, 0.80, 1.0), band);
  // carapace — concentric growth rings on each shell bulb
  let bob = sin(ph * 3.0) * 0.5;
  let bodyA = rotate(vec2f(-5.0, bob), hd);
  let bodyB = rotate(vec2f(5.0, -bob), hd);
  let ringA = step(0.72, fract(length(c - bodyA) * 0.33)) * step(length(c - bodyA), 4.5);
  let ringB = step(0.72, fract(length(c - bodyB) * 0.33)) * step(length(c - bodyB), 4.0);
  color = mix(color, color * 0.55, max(ringA, ringB));
  // pale spots along the shell seam
  let spot = step(0.90, hash21(ct + vec2f(53.0, 29.0)));
  color = mix(color, vec3f(0.80, 0.84, 1.0), spot * step(0.4, band) * 0.7);
  if (d > -1.5 && lum > 0.60) { color = vec3f(0.86, 0.90, 1.0); }
  color = mix(color, vec3f(1.0), reach * 0.10);
  let headP = rotate(vec2f(9.5, -bob - 1.0), hd);
  let eyeP = headP + rotate(vec2f(0.8, -0.8), hd);
  color = mix(color, vec3f(0.03, 0.03, 0.08), mod_node2(c, eyeP, 0.55));
  color = mix(color, vec3f(0.95), mod_node2(c, eyeP + vec2f(0.8, -0.8), 0.35));
  return vec4f(color, 1.0);
}`

// params: [halfLen01, active, seed, angleWorld] — white core, cyan halo, both crisp
const BRIDGE = /* wgsl */`
fn visual_mar3_bridge(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  if (p.y < 0.5) { return vec4f(0.0); }
  let c = mod_px2(uv, 64.0);
  let L = p.x * 30.0;
  let tq = floor(time * 12.0);
  var dmin = 999.0;
  var prev = rotate(vec2f(-L, 0.0), p.w);
  for (var i = 1; i <= 8; i++) {
    let fi = f32(i);
    var y = (hash21(vec2f(fi + p.z * 7.0, tq)) - 0.5) * 7.0;
    if (i == 8) { y = 0.0; }
    let cur = rotate(vec2f(-L + fi * (L * 2.0 / 8.0), y), p.w);
    dmin = min(dmin, mod_seg2(c, prev, cur));
    prev = cur;
  }
  if (dmin < 0.55) { return vec4f(vec3f(1.5, 1.6, 1.6), 1.0); }
  if (dmin < 1.4) { return vec4f(0.25, 0.55, 0.65, 1.0); }
  return vec4f(0.0);
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
    if (T(f).x < 75 || T(f).x > 437 || T(f).y < 75 || T(f).y > 437) {
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
    const want = bd < 130 ? 1 : 0
    S.reach += (want - S.reach) * Math.min(1, dt * 3)
    if (best && bd < 55) {
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
      if (d < 120) pairs.push({ a, b, d })
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
  name: 'MARIONETTES HD',
  fields: [
    field('mar3_arena_f', 'Arena', [0.02, 0.02, 0.04, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'mar3_arena'),
    field('mar3_bridge_1', 'Bridge 1', [0.7, 1, 1, 1], 30, 30, { shapeType: 'circle', radius: 96 }, 'mar3_bridge', [0, 0, 0, 0]),
    field('mar3_bridge_2', 'Bridge 2', [0.7, 1, 1, 1], 30, 60, { shapeType: 'circle', radius: 96 }, 'mar3_bridge', [0, 0, 0, 0]),
    field('mar3_serpent_f', 'Serpent', [0.2, 0.6, 0.4, 1], 150, 150, { shapeType: 'circle', radius: 92 }, 'mar3_serpent', [0, 0, 0, 0]),
    field('mar3_walker_f', 'Walker', [0.78, 0.52, 0.18, 1], 370, 150, { shapeType: 'circle', radius: 92 }, 'mar3_walker', [0, 0, 0, 0]),
    field('mar3_puppet_f', 'Puppet', [0.75, 0.3, 0.46, 1], 150, 370, { shapeType: 'circle', radius: 92 }, 'mar3_puppet', [0, 0, 0, 0]),
    field('mar3_crawler_f', 'Crawler', [0.42, 0.44, 0.85, 1], 370, 370, { shapeType: 'circle', radius: 92 }, 'mar3_crawler', [0, 0, 0, 0]),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.5, gravitationalConstant: 0 },
  worldData: {
    postProcess: { bloomIntensity: 0.06, bloomThreshold: 1.2, exposure: 1.0, vignetteStrength: 0, vignetteRadius: 0.8 },
  },
  stepHooks: [{ id: 'mar_core', author: 'fable', description: 'MARIONETTES II: skinned skeletons, neighbor reach, gait sync, lightning bridges', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'mar3_arena', wgsl: ARENA },
    { name: 'mar3_bridge', wgsl: BRIDGE },
    { name: 'mar3_serpent', wgsl: SERPENT },
    { name: 'mar3_walker', wgsl: WALKER },
    { name: 'mar3_puppet', wgsl: PUPPET },
    { name: 'mar3_crawler', wgsl: CRAWLER },
  ],
  modules: [{ name: 'skel2', wgsl: MODULES }],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'MARIONETTES HD', scene }),
})
console.log('MARIONETTES HD saved:', res.status, await res.text())
