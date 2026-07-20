// TIDEGLASS — a Riven-style observational puzzle island (space: /space/tideglass).
// A brass-and-glass tide observatory on a lone rock at dusk. Four linked views,
// edge-chevron travel, no text, no tutorial — the island explains itself.
//
//   SHORE  four bell-buoys toll a color-and-tone sequence; a carved stele
//          holds five tick-columns (the organ answer, two views away)
//   GATE   four brass glyph dials — set them to the ORDER the bells tolled
//   HALL   five water-organ pipes; click to raise the liquid; match the stele
//          → the oculus ignites and reveals the star-glyph
//   LENS   night sky, four constellations each tagged with a glyph; DRAG to
//          aim the great lens at the one matching the star-glyph, hold —
//          the vault rises from the sea and the island turns to night forever
//
// One fullscreen field, one uber-visual branching per view, all cross-view
// state on the whiteboard (gpuUniforms). Hook owns clicks, puzzles, chapters,
// synthesized bells/tones/music. singlePlayer. Built by Claude Fable 5.
//
//   Run:  TG_TOKEN=uc_st_... node tideglass-cartridge.mjs
//
// ── whiteboard layout ──
//   0 view          1 prevView      2 fade01        3 tGlobal
//   4-7 dial glyphs (0..3)          8 doorOpen01
//   9-13 pipe levels /4             14 organSolved01
//   15 lensAngle    16 lensHold01   17 finale01
//   18 gateSolved01 19-22 bellFlash[4]
//   23 nightness01  24 act          25 clickPulse
//   26 vaultRise01  27 mouseX       28 mouseY
//   29 starGlyph01  30 mouseDown    31 hallLight01

const TOKEN = process.env.TG_TOKEN
if (!TOKEN) { console.error('TG_TOKEN required'); process.exit(1) }
const URL = process.env.TG_URL || 'https://cartridge.cafe/api/engine/bridge'

async function send(cmd, label) {
  const body = Array.isArray(cmd) ? { commands: cmd } : cmd
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
  const t = await r.text()
  console.log(label || (Array.isArray(cmd) ? 'batch' : cmd.type), r.status, t.slice(0, 220))
  if (!r.ok) throw new Error(`${label}: ${r.status} ${t.slice(0, 400)}`)
  return JSON.parse(t)
}

// ─────────────────────────────────────────────────────────────── modules ──
const MODULES = /* wgsl */`
// ── the four tide-glyphs: crescent, triad, star, ringed bar ──
// unit cell p in [-1,1], returns coverage 0..1
fn mod_tg_glyph(idx: i32, p: vec2f) -> f32 {
  var d = 1.0;
  if (idx == 0) {                    // crescent — the hooked tide
    let a = length(p) - 0.62;
    let b = length(p - vec2f(0.30, -0.12)) - 0.55;
    d = max(a, -b);
  } else if (idx == 1) {             // triad — three drops
    let d1 = length(p - vec2f(0.0, -0.38)) - 0.20;
    let d2 = length(p - vec2f(-0.38, 0.30)) - 0.20;
    let d3 = length(p - vec2f(0.38, 0.30)) - 0.20;
    d = min(d1, min(d2, d3));
  } else if (idx == 2) {             // four-point star — the vault
    d = sdStar(p, 0.72, 4, 2.6);
  } else {                           // ringed bar — the mooring
    let ring = abs(length(p) - 0.52) - 0.10;
    let bar = sdBox(p, vec2f(0.10, 0.72));
    d = min(ring, bar);
  }
  return smoothstep(0.05, -0.05, d);
}
fn mod_tg_gcol(idx: i32) -> vec3f {
  if (idx == 0) { return vec3f(1.00, 0.62, 0.22); }   // amber
  if (idx == 1) { return vec3f(0.25, 0.85, 0.75); }   // teal
  if (idx == 2) { return vec3f(0.66, 0.48, 1.00); }   // violet
  return vec3f(1.00, 0.38, 0.48);                     // rose
}
// ═══ ONE-DAY-grade 3D sky + ocean for the shore (ported technique) ═══
fn mod_tgo_suncol(el: f32) -> vec3f {
  return mix(vec3f(1.30, 0.45, 0.16), vec3f(1.15, 1.05, 0.90), smoothstep(0.02, 0.55, el));
}
fn mod_tgo_sky(rd: vec3f, sd: vec3f, md: vec3f, t: f32, vault: f32) -> vec3f {
  let el = sd.y;
  let y = max(rd.y, 0.0);
  let day = smoothstep(-0.10, 0.35, el);
  let night = smoothstep(0.05, -0.18, el);
  let zen = mix(vec3f(0.012, 0.018, 0.045), vec3f(0.15, 0.30, 0.58), day);
  let horDay = mix(vec3f(1.00, 0.42, 0.16), vec3f(0.46, 0.58, 0.72), smoothstep(0.10, 0.55, el));
  let hor = mix(vec3f(0.030, 0.032, 0.070), horDay, smoothstep(-0.16, 0.06, el));
  var c = mix(hor, zen, pow(y, 0.6));
  // the sun: wide bloom, tight halo, HDR core
  let sdot = clamp(dot(rd, sd), 0.0, 1.0);
  let sunUp = smoothstep(-0.14, 0.02, el);
  c += mod_tgo_suncol(el) * pow(sdot, 6.0) * 0.24 * sunUp;
  c += mod_tgo_suncol(el) * pow(sdot, 190.0) * 0.85 * sunUp;
  c += vec3f(6.0, 4.1, 2.2) * smoothstep(0.99988, 0.99997, sdot) * sunUp;
  // the vault-lamp moon of the finale night
  let mdot = clamp(dot(rd, md), 0.0, 1.0);
  let moonUp = night * smoothstep(-0.05, 0.10, md.y);
  c += vec3f(0.45, 0.72, 0.80) * pow(mdot, 90.0) * 0.5 * moonUp;
  c += vec3f(2.2, 3.0, 3.1) * smoothstep(0.99985, 0.99995, mdot) * moonUp;
  // stars + a faint galaxy band
  if (night > 0.02 && rd.y > 0.01) {
    let sp = rd.xz / (rd.y + 0.55) * 26.0;
    let cell = floor(sp);
    let h = hash21(cell);
    let tw = 0.55 + 0.45 * sin(t * (0.8 + h) + h * 50.0);
    c += vec3f(0.72, 0.78, 0.95) * step(0.990, h) * smoothstep(0.30, 0.05, length(fract(sp) - 0.5)) * night * tw;
    let band = pow(max(1.0 - abs(rd.x * 0.8 + rd.y * 0.5 - 0.15), 0.0), 3.5);
    c += vec3f(0.07, 0.07, 0.12) * band * night * (0.5 + 0.3 * vnoise(sp * 0.5));
  }
  // aurora curtains once the vault has risen
  if (vault > 0.01 && rd.y > 0.04) {
    let ax = rd.x / (rd.y + 0.35);
    let wave = sin(ax * 2.2 + t * 0.22) * 0.5 + sin(ax * 5.1 - t * 0.13) * 0.22;
    let curt = exp(-pow((rd.y - 0.34 - wave * 0.10) * 4.5, 2.0));
    let flick = 0.65 + 0.35 * vnoise(vec2f(ax * 3.0, t * 0.35));
    c += vec3f(0.10, 0.85, 0.45) * curt * flick * vault * night * 0.35;
    c += vec3f(0.35, 0.20, 0.75) * exp(-pow((rd.y - 0.52 - wave * 0.13) * 5.0, 2.0)) * flick * vault * night * 0.16;
  }
  // sparse dusk clouds, tinted by the hour
  if (rd.y > 0.015 && night < 0.9) {
    let cp = rd.xz / (rd.y + 0.14) * 1.4 + vec2f(t * 0.006, t * 0.002);
    var cl = fbm(cp * 0.55, 4);
    cl = smoothstep(0.46, 0.78, cl);
    let cloudLit = mix(vec3f(0.06, 0.06, 0.10), mix(vec3f(1.15, 0.50, 0.28), vec3f(0.85, 0.85, 0.90), smoothstep(0.12, 0.5, el)), max(day, night * 0.12));
    c = mix(c, cloudLit, cl * 0.7 * smoothstep(0.015, 0.10, rd.y) * (1.0 - night));
  }
  return c;
}
fn mod_tgo_ic() -> vec2f { return vec2f(6.5, 16.0); }   // the island's rock in sea space
fn mod_tgo_oct(uv0: vec2f, choppy: f32) -> f32 {
  let n = gnoise(uv0);
  let uv = uv0 + vec2f(n, n);
  var wv = 1.0 - abs(sin(uv));
  let swv = abs(cos(uv));
  wv = mix(wv, swv, wv);
  return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);
}
fn mod_tgo_surge(pxz: vec2f, st: f32) -> f32 {
  let dr = length(pxz - mod_tgo_ic());
  return exp(-max(dr - 4.6, 0.0) * 0.4) * (sin(st * 1.3 - dr * 0.9) * 0.5 + 0.62) * 0.9;
}
fn mod_tgo_map3(p: vec3f, st: f32) -> f32 {
  var freq = 0.16;
  var amp = 0.62;
  var choppy = 4.0;
  var uv = p.xz;
  uv.x = uv.x * 0.75;
  var h = 0.0;
  for (var i = 0; i < 3; i++) {
    var d = mod_tgo_oct((uv + vec2f(st)) * freq, choppy);
    d = d + mod_tgo_oct((uv - vec2f(st)) * freq, choppy);
    h = h + d * amp;
    uv = mat2x2f(1.6, 1.2, -1.2, 1.6) * uv;
    freq = freq * 1.9;
    amp = amp * 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  return p.y - h - mod_tgo_surge(p.xz, st);
}
fn mod_tgo_map5(p: vec3f, st: f32) -> f32 {
  var freq = 0.16;
  var amp = 0.62;
  var choppy = 4.0;
  var uv = p.xz;
  uv.x = uv.x * 0.75;
  var h = 0.0;
  for (var i = 0; i < 5; i++) {
    var d = mod_tgo_oct((uv + vec2f(st)) * freq, choppy);
    d = d + mod_tgo_oct((uv - vec2f(st)) * freq, choppy);
    h = h + d * amp;
    uv = mat2x2f(1.6, 1.2, -1.2, 1.6) * uv;
    freq = freq * 1.9;
    amp = amp * 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  return p.y - h - mod_tgo_surge(p.xz, st);
}
// cheap height at a point — the buoys ride the SAME sea (2 octaves + surge)
fn mod_tgo_h2(uv0: vec2f, st: f32) -> f32 {
  var uv = uv0;
  uv.x = uv.x * 0.75;
  var freq = 0.16;
  var amp = 0.62;
  var choppy = 4.0;
  var h = 0.0;
  for (var i = 0; i < 2; i++) {
    var d = mod_tgo_oct((uv + vec2f(st)) * freq, choppy);
    d = d + mod_tgo_oct((uv - vec2f(st)) * freq, choppy);
    h = h + d * amp;
    uv = mat2x2f(1.6, 1.2, -1.2, 1.6) * uv;
    freq = freq * 1.9;
    amp = amp * 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  return h + mod_tgo_surge(uv0, st);
}
// ═══ the bell-buoys: true marched bodies riding the swell ═══
// local frame: origin at the waterline, +y up. mats: 0 iron hull · 1 cage ·
// 2 the bell · 3 lantern head (emissive, glyph-colored)
fn mod_tgb_sdf(q0: vec3f, lean: f32) -> vec2f {
  let cl = cos(lean); let sl = sin(lean);
  let q = vec3f(cl * q0.x - sl * q0.y, sl * q0.x + cl * q0.y, q0.z);
  // squat cone float with a waterline skirt
  let ft = clamp((q.y + 0.40) / 0.60, 0.0, 1.0);
  let fd = vec2f(length(q.xz) - mix(0.34, 0.52, ft) * step(q.y, 0.20) - mix(0.52, 0.10, clamp((q.y - 0.20) / 0.25, 0.0, 1.0)) * step(0.20, q.y), 0.0);
  var d = max(length(q.xz) - mix(0.34, 0.52, ft), max(q.y - 0.42, -0.40 - q.y));
  d = min(d, length(vec2f(length(q.xz) - 0.50, q.y - 0.02)) - 0.055);        // skirt torus
  var m = 0.0;
  // tripod cage: three struts leaning to a collar
  let pr = mod_tg_polar3(q);
  let strut = mod_tg_seg3(pr, vec3f(0.34, 0.30, 0.0), vec3f(0.05, 1.30, 0.0)) - 0.030;
  if (strut < d) { d = strut; m = 1.0; }
  let collar = length(vec2f(length(q.xz) - 0.09, q.y - 1.30)) - 0.032;
  if (collar < d) { d = collar; m = 1.0; }
  // the bell hangs in the cage
  let bell = max(length((q - vec3f(0.0, 0.88, 0.0)) * vec3f(1.0, 0.80, 1.0)) - 0.17, 0.62 - q.y);
  if (bell < d) { d = bell; m = 2.0; }
  // lantern head above the collar
  let lant = mod_w3ish_box(q - vec3f(0.0, 1.46, 0.0), vec3f(0.062, 0.080, 0.062)) - 0.015;
  if (lant < d) { d = lant; m = 3.0; }
  return vec2f(d, m);
}
fn mod_tg_polar3(p: vec3f) -> vec3f {
  let ang = 2.0943951;
  let a = atan2(p.z, p.x);
  let r = length(p.xz);
  let a2 = (fract(a / ang + 0.5) - 0.5) * ang;
  return vec3f(cos(a2) * r, p.y, sin(a2) * r);
}
fn mod_tg_seg3(p: vec3f, a: vec3f, b: vec3f) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
fn mod_w3ish_box(p: vec3f, b: vec3f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}
// ═══ the island observatory: a real building, raymarched (ONE DAY treatment) ═══
// materials: 0 rock · 1 masonry · 2 iron · 3 glass dome · 4 roof · 5 cottage · 6 chimney · 7 beacon
fn mod_tgi_sdf(pw: vec3f) -> vec2f {
  let q = pw - vec3f(6.5, 0.0, 16.0);
  // the rock: noised mass with a leveled court
  var d = length(q * vec3f(0.85, 1.45, 1.30)) - 2.85;
  d = d + (vnoise3(q * 1.1) - 0.5) * 0.85 + (vnoise3(q * 3.1) - 0.5) * 0.28;
  d = max(d, q.y - 2.08);                                   // the court
  var m = 0.0;
  // tapered masonry tower on the court's east rise
  let ty = clamp((q.y - 1.9) / 3.0, 0.0, 1.0);
  let tr = mix(0.60, 0.40, pow(ty, 0.8)) * (1.0 + 0.45 * smoothstep(2.7, 1.9, q.y));
  let dt = max(length(q.xz - vec2f(0.6, 0.0)) - tr, abs(q.y - 3.42) - 1.55);
  if (dt < d) { d = dt; m = 1.0; }
  // gallery deck + handrail ring + balusters
  let rxz = length(q.xz - vec2f(0.6, 0.0));
  let dDeck = max(rxz - 0.74, abs(q.y - 4.99) - 0.07);
  if (dDeck < d) { d = dDeck; m = 2.0; }
  let dRail = max(abs(rxz - 0.64) - 0.032, abs(q.y - 5.34) - 0.035);
  if (dRail < d) { d = dRail; m = 2.0; }
  let ph = atan2(q.z, q.x - 0.6);
  let seg = 0.3927;                                          // 2π/16
  let aph = (glsl_mod(ph + seg * 0.5, seg) - seg * 0.5) * 0.64;
  let dBal = max(length(vec2f(rxz - 0.64, aph)) - 0.028, abs(q.y - 5.16) - 0.17);
  if (dBal < d) { d = dBal; m = 2.0; }
  // the tide-glass itself: the great dome over the gallery
  let dGl = max(length(q - vec3f(0.6, 5.02, 0.0)) - 0.56, 5.04 - q.y);
  if (dGl < d) { d = dGl; m = 3.0; }
  // finial beacon
  let dFin = length(q - vec3f(0.6, 5.72, 0.0)) - 0.11;
  if (dFin < d) { d = dFin; m = 7.0; }
  // keeper's cottage on the west court: walls, gable roof, chimney
  let qc = q - vec3f(-1.35, 2.36, 0.25);
  let dW = sdBox(qc.xz, vec2f(0.78, 0.58));
  let dWall = max(dW, abs(qc.y + 0.1) - 0.52);
  if (dWall < d) { d = dWall; m = 5.0; }
  let dRoof = max(max(abs(qc.z) * 0.85 + (qc.y - 0.85), -(qc.y - 0.32)), max(abs(qc.x) - 0.92, abs(qc.z) - 0.70));
  if (dRoof < d) { d = dRoof; m = 4.0; }
  let dCh = max(sdBox(qc.xz - vec2f(0.38, 0.0), vec2f(0.13, 0.13)), abs(qc.y - 1.02) - 0.38);
  if (dCh < d) { d = dCh; m = 6.0; }
  return vec2f(d, m);
}
// soft shadow: march from a surface point toward the sun through the island
fn mod_tgi_shadow(ro2: vec3f, ld: vec3f) -> f32 {
  var t2 = 0.30;
  var sh = 1.0;
  for (var i = 0; i < 10; i++) {
    let d = mod_tgi_sdf(ro2 + ld * t2).x;
    sh = min(sh, 7.0 * d / t2);
    t2 = t2 + clamp(d, 0.18, 1.4);
    if (sh < 0.02 || t2 > 15.0) { break; }
  }
  return clamp(sh, 0.0, 1.0);
}
// bounded march for reflections: (t, material) or (-1,-1)
fn mod_tgi_march(ro2: vec3f, rd2: vec3f, tmax: f32) -> vec2f {
  var t2 = 0.4;
  for (var i = 0; i < 22; i++) {
    let dm = mod_tgi_sdf(ro2 + rd2 * t2);
    if (dm.x < 0.06) { return vec2f(t2, dm.y); }
    t2 = t2 + max(dm.x * 0.9, 0.05);
    if (t2 > tmax) { break; }
  }
  return vec2f(-1.0, -1.0);
}
fn mod_tgi_nrm(pw: vec3f) -> vec3f {
  let e = 0.025;
  let c = mod_tgi_sdf(pw).x;
  return normalize(vec3f(
    mod_tgi_sdf(pw + vec3f(e, 0.0, 0.0)).x - c,
    mod_tgi_sdf(pw + vec3f(0.0, e, 0.0)).x - c,
    mod_tgi_sdf(pw + vec3f(0.0, 0.0, e)).x - c));
}
fn mod_tgo_nrm(p: vec3f, eps: f32, st: f32) -> vec3f {
  let hy = mod_tgo_map5(p, st);
  let hx = mod_tgo_map5(p + vec3f(eps, 0.0, 0.0), st);
  let hz = mod_tgo_map5(p + vec3f(0.0, 0.0, eps), st);
  return normalize(vec3f(hx - hy, eps, hz - hy));
}
fn mod_tgo_spec(n: vec3f, l: vec3f, e: vec3f, s: f32) -> f32 {
  let nrm = (s + 8.0) / (3.14159 * 8.0);
  return pow(max(dot(reflect(e, n), l), 0.0), s) * nrm;
}
fn mod_tgo_seacol(p: vec3f, n: vec3f, sd: vec3f, md: vec3f, eye: vec3f, dist: vec3f, t: f32, st: f32, vault: f32) -> vec3f {
  let el = sd.y;
  let day = smoothstep(-0.10, 0.35, el);
  let night = smoothstep(0.05, -0.18, el);
  var fres = clamp(1.0 - dot(n, -eye), 0.0, 1.0);
  fres = pow(fres, 3.0) * 0.5;
  let reflected = mod_tgo_sky(reflect(eye, n), sd, md, t, vault);
  let base = mix(vec3f(0.004, 0.008, 0.016), vec3f(0.030, 0.050, 0.085), day);
  let waterCol = vec3f(0.16, 0.21, 0.20) * (0.25 + 0.75 * day);
  let refracted = base + pow(dot(n, sd) * 0.4 + 0.6, 80.0) * waterCol * 0.12 * day;
  var refl2 = reflected;
  // ── the island stands in the mirror: march the reflected ray. The dome and
  //    beacon burn in the waves at night; the dark mass breaks the sky by day.
  let rdir = reflect(eye, n);
  if (p.x > 0.5 && p.z < 15.0 && rdir.z > 0.04) {
    let hit = mod_tgi_march(p + vec3f(0.0, 0.03, 0.0), rdir, 17.0);
    if (hit.x > 0.0) {
      let hp2 = p + rdir * hit.x;
      let mi2 = i32(hit.y + 0.5);
      var rc = vec3f(0.016, 0.014, 0.018);
      if (mi2 == 3) { rc = vec3f(0.08, 0.42, 0.46) * (0.6 + night * 1.4); }
      else if (mi2 == 7) { rc = vec3f(0.30, 0.90, 0.95) * (1.3 + night * 2.0); }
      else {
        rc = rc * (0.8 + 0.4 * fbm(hp2.xy * 2.0, 2));
        rc += mod_tgo_suncol(el) * clamp(hp2.y * 0.25, 0.0, 0.8) * (1.0 - night) * 0.35;   // dusk-lit faces
        // the tower's lit windows smear in the swell
        let wy = smoothstep(0.25, 0.10, abs(hp2.y - 2.95)) + smoothstep(0.22, 0.09, abs(hp2.y - 3.95));
        rc += vec3f(1.3, 0.85, 0.35) * wy * smoothstep(0.9, 0.2, abs(hp2.x - 7.1)) * (0.35 + night * 0.5);
      }
      refl2 = mix(refl2, rc, 0.85);
    }
  }
  var col = mix(refracted, refl2, fres);
  // the island's long dusk shadow lies across the water
  if (p.x > 0.8 && p.z < 20.0 && sd.y > 0.01) {
    let sh2 = mod_tgi_shadow(vec3f(p.x, 0.25, p.z), sd);
    col *= 0.50 + 0.50 * sh2;
  }
  let atten = max(1.0 - dot(dist, dist) * 0.001, 0.0);
  col = col + waterCol * (p.y - 0.6) * 0.18 * atten;
  // sun glitter at dusk; at finale-night the vault-lamp takes the water
  col = col + mod_tgo_suncol(el) * vec3f(1.7, 1.05, 0.55) * mod_tgo_spec(n, sd, eye, 150.0) * smoothstep(-0.08, 0.05, el);
  col = col + vec3f(0.55, 1.05, 1.25) * mod_tgo_spec(n, md, eye, 140.0) * night * smoothstep(0.0, 0.15, md.y) * 1.7;
  // crest foam
  let foamN = vnoise(p.xz * 2.2 + vec2f(t * 0.5, -t * 0.35));
  let crest = smoothstep(1.00, 1.50, p.y) * smoothstep(0.42, 0.85, foamN);
  col = mix(col, vec3f(0.90, 0.82, 0.72) * (0.25 + 0.75 * day), crest * atten * 0.4);
  // ── the rock's waterline: foam that follows the actual SDF, lapping with the swell ──
  if (p.x > 2.2) {
    let islD = mod_tgi_sdf(vec3f(p.x, p.y * 0.4, p.z)).x;
    let lap = sin(st * 1.5 - islD * 5.5) * 0.5 + 0.5;
    var lapFoam = smoothstep(0.85, 0.06, islD) * (0.30 + 0.70 * lap);
    lapFoam *= 0.40 + 0.60 * vnoise(p.xz * 5.5 + vec2f(st * 0.9, -st * 0.6));
    // fine bubble speckle right at the contact
    let bub = step(0.965, hash21(floor(p.xz * 14.0 + vec2f(st * 1.2, 0.0))));
    lapFoam += smoothstep(0.30, 0.03, islD) * bub * 0.6;
    col = mix(col, vec3f(0.90, 0.89, 0.85) * (0.35 + 0.65 * day + 0.25 * night), clamp(lapFoam, 0.0, 1.0) * 0.85);
    // wet reflection band hugging the rock
    col += vec3f(0.25, 0.18, 0.10) * smoothstep(1.6, 0.2, islD) * (0.4 + 0.6 * day) * 0.25;
  }
  // ── buoy wakes: bob rings + worked collar, in the sea itself ──
  for (var bk = 0; bk < 4; bk++) {
    var bwx2 = -4.4;
    if (bk == 1) { bwx2 = -2.45; } else if (bk == 2) { bwx2 = -0.6; } else if (bk == 3) { bwx2 = 1.45; }
    let bd = length(p.xz - vec2f(bwx2, 11.0));
    if (bd > 3.2) { continue; }
    // expanding bob rings, born of the buoy's rhythm
    let ring = sin(bd * 7.5 - st * 2.6 - f32(bk) * 1.9);
    let rings = smoothstep(0.62, 0.97, ring) * exp(-bd * 1.35) * smoothstep(0.12, 0.35, bd) * 0.55;
    // churned collar at the hull
    let collar = smoothstep(0.34, 0.10, bd) * (0.45 + 0.55 * vnoise(p.xz * 9.0 + vec2f(st * 1.5, f32(bk) * 7.0)));
    let bfoam = clamp(rings * 0.7 + collar, 0.0, 1.0);
    col = mix(col, vec3f(0.88, 0.88, 0.86) * (0.35 + 0.65 * day + 0.22 * night), bfoam * 0.75);
    // the hull's shadow in its own water
    col *= 1.0 - smoothstep(0.30, 0.08, bd) * 0.14;
  }
  return col;
}

// ═══ ancient machine-walls: height-field relief, engraved and fossiled ═══
// a toothed ring pressed into stone — the gear fossils of the tide-race
fn mod_tg_gearh(q: vec2f, r: f32, teeth: f32) -> f32 {
  let a = atan2(q.y, q.x);
  let tooth = smoothstep(0.30, 0.62, abs(fract(a * teeth * 0.15915) - 0.5) * 2.0);
  let rr2 = r * (1.0 + tooth * 0.09);
  let L = length(q);
  let ring = smoothstep(0.022, 0.007, abs(L - rr2));
  let spoke = smoothstep(0.030, 0.010, abs(fract(a * 0.9549 + 0.5) - 0.5) * max(L, 0.05)) * step(L, rr2 * 0.94) * step(rr2 * 0.30, L);
  let hub = smoothstep(0.045, 0.018, abs(L - rr2 * 0.22));
  return max(max(ring, spoke * 0.7), hub * 0.8);
}
// wall height by STYLE — every chamber speaks its own carved language:
//   0 GEARWORKS (the gate): fossil gear trains + conduit grooves
//   1 TIDE-SCRIPTORIUM (the record): engraved wave-charts + tally rows + strata
//   2 FLUTED WATERCOURSE (the hall): organ-rib fluting + band clamps + drip stains
fn mod_tg_wallh(p: vec2f, seed: f32, style: i32) -> f32 {
  var h = fbm(p * 3.0 + vec2f(seed), 3) * 0.35;
  h += fbm(p * 11.0 + vec2f(seed * 2.0), 2) * 0.15;
  if (style == 0) {
    h -= smoothstep(0.42, 0.5, abs(fract(p.y * 2.6 + fbm(p * 1.5, 2) * 0.25) - 0.5)) * 0.18;
    let cell = floor(p * 1.15 + vec2f(seed));
    let ch = hash21(cell);
    if (ch > 0.48) {
      let cq = (fract(p * 1.15 + vec2f(seed)) - 0.5) + (hash22(cell) - 0.5) * 0.26;
      h += mod_tg_gearh(cq, 0.15 + ch * 0.16, floor(6.0 + ch * 9.0)) * 0.5;
    }
    let colId = floor(p.x * 0.9 + seed * 0.7);
    let gx = abs(fract(p.x * 0.9 + seed * 0.7) - 0.5);
    h -= smoothstep(0.055, 0.030, gx) * 0.22 * step(0.55, hash11(colId));
  } else if (style == 1) {
    // sediment strata, close-set
    h -= smoothstep(0.40, 0.5, abs(fract(p.y * 4.2 + fbm(p * 1.2, 2) * 0.15) - 0.5)) * 0.14;
    // engraved wave-chart lines: rows of carved sines, each row its own sea
    let row = floor(p.y * 1.4 + seed);
    let rh = hash11(row);
    let wave = sin(p.x * (5.0 + rh * 7.0) + rh * 20.0) * (0.05 + rh * 0.05);
    let chart = smoothstep(0.030, 0.010, abs(fract(p.y * 1.4 + seed) - 0.5 - wave));
    h += chart * 0.42 * step(0.30, rh);
    // tally strokes beneath some charts — the counted tides
    let tq = vec2f(fract(p.x * 6.5 + rh * 5.0), fract(p.y * 1.4 + seed) - 0.72);
    let tally = smoothstep(0.10, 0.04, abs(tq.x - 0.5)) * smoothstep(0.10, 0.05, abs(tq.y));
    h -= tally * 0.30 * step(0.62, rh);
  } else {
    // vertical organ-rib fluting
    h += smoothstep(0.5, 0.0, abs(fract(p.x * 3.4 + seed) - 0.5)) * 0.34;
    // iron band clamps every few courses
    h += smoothstep(0.045, 0.015, abs(fract(p.y * 1.1 + seed * 0.3) - 0.5)) * 0.30;
    // drip stains running down from the bands
    let dcol = floor(p.x * 5.0 + seed);
    let dh2 = hash11(dcol);
    h -= smoothstep(0.06, 0.02, abs(fract(p.x * 5.0 + seed) - 0.5)) * 0.12 * step(0.6, dh2) * fract(p.y * 0.7 + dh2);
  }
  return h;
}
// relief: (height, directional slope toward the key light, ridge01)
fn mod_tg_relief(p: vec2f, seed: f32, lite: vec2f, style: i32) -> vec3f {
  let h0 = mod_tg_wallh(p, seed, style);
  let h1 = mod_tg_wallh(p + lite * 0.012, seed, style);
  return vec3f(h0, (h0 - h1) * 9.0, smoothstep(0.12, 0.55, h0));
}
// the full ancient-wall material: stone base, relief light, verdigris in the
// recesses, gold dust on the ridges — one call per wall pixel
fn mod_tg_ancient(p: vec2f, seed: f32, lite: vec2f, warm: f32, style: i32) -> vec3f {
  let rel = mod_tg_relief(p, seed, lite, style);
  var c = mix(vec3f(0.028, 0.025, 0.028), vec3f(0.080, 0.070, 0.062), rel.z);
  c *= clamp(1.0 + rel.y * 0.6, 0.35, 1.8);
  c = mix(c, vec3f(0.050, 0.082, 0.066), (1.0 - rel.z) * 0.40 * smoothstep(0.45, 0.15, rel.x));   // verdigris pools
  c += vec3f(0.55, 0.42, 0.16) * smoothstep(0.60, 0.80, rel.x) * 0.20 * warm;                     // gilt ridges
  c += vec3f(0.85, 0.55, 0.25) * max(rel.y, 0.0) * 0.10 * warm;                                   // warm catch-light
  return c;
}
// ── dusk→night sky, shared by shore + lens ──
fn mod_tg_sky(p: vec2f, t: f32, night: f32) -> vec3f {
  let h = clamp(-p.y * 0.5 + 0.5, 0.0, 1.0);          // 0 horizon → 1 zenith
  let duskLo = vec3f(1.05, 0.52, 0.24);
  let duskHi = vec3f(0.10, 0.14, 0.32);
  let nightLo = vec3f(0.05, 0.08, 0.17);
  let nightHi = vec3f(0.010, 0.016, 0.045);
  var c = mix(mix(duskLo, duskHi, pow(h, 0.65)), mix(nightLo, nightHi, pow(h, 0.8)), night);
  // banded clouds, advected slowly
  let cl = fbm(vec2f(p.x * 1.6 - t * 0.008, p.y * 4.2), 3);
  let band = smoothstep(0.45, 0.75, cl) * smoothstep(0.9, 0.2, h) * (1.0 - night * 0.75);
  c = mix(c, vec3f(0.55, 0.26, 0.24) * (1.4 - h), band * 0.55);
  // stars grow with night
  let sc = floor(p * 190.0);
  let sh = hash21(sc);
  let tw = 0.6 + 0.4 * sin(t * (1.5 + sh * 3.0) + sh * 40.0);
  c += vec3f(0.9, 0.95, 1.1) * step(0.9955, sh) * tw * (0.25 + night) * smoothstep(0.12, 0.5, h);
  return c;
}
// ── the sea band, shared by shore views ──
fn mod_tg_sea(p: vec2f, t: f32, night: f32) -> vec3f {
  let depth = clamp((p.y - 0.17) / 0.83, 0.0, 1.0);   // 0 horizon → 1 near
  var c = mix(mix(vec3f(0.35, 0.20, 0.20), vec3f(0.05, 0.09, 0.14), night),
              mix(vec3f(0.05, 0.06, 0.10), vec3f(0.010, 0.022, 0.040), night), depth);
  // swell lines compress toward the horizon
  let sw = sin(p.x * 14.0 + t * 0.5 + sin(depth * 30.0) * 2.0) * sin(depth * 46.0 - t * 0.9);
  c *= 1.0 + sw * 0.05 * (0.3 + depth);
  // glitter path under the light (sun at dusk, risen vault at night)
  let gx = p.x - mix(0.22, -0.15, night);   // under the dusk sun; under the risen vault at night
  let cell = floor(vec2f(p.x * 90.0, depth * 160.0 - t * 2.2));
  let gh = hash21(cell);
  let path = exp(-gx * gx * mix(22.0, 26.0, night)) * smoothstep(0.85, 0.25, depth);
  let glit = step(0.976, gh) * path * max(0.3 + 0.7 * sin(t * 3.0 + gh * 50.0), 0.0);
  c += mix(vec3f(1.3, 0.65, 0.25), vec3f(0.45, 0.85, 1.15), night) * glit * 0.7;
  return c;
}
// ── carved rock body ──
fn mod_tg_rock(p: vec2f, tint: vec3f) -> vec3f {
  var c = tint * (0.75 + 0.5 * fbm(p * 5.0, 3));
  c *= 0.80 + 0.35 * fbm(p * 17.0 + vec2f(4.0), 2);
  // damp streaks
  c *= 1.0 - 0.22 * smoothstep(0.4, 0.9, fbm(vec2f(p.x * 9.0, p.y * 1.8), 2));
  return c;
}
// ── nav chevron: dir 0 right, 1 left, 2 up, 3 down; hover glows ──
fn mod_tg_chev(px: vec2f, at: vec2f, dir: i32, hover: f32, t: f32) -> vec4f {
  var q = (px - at) / 26.0;
  if (dir == 0) { q = vec2f(-q.x, q.y); }
  if (dir == 2) { q = vec2f(q.y, q.x); }
  if (dir == 3) { q = vec2f(-q.y, q.x); }
  // two nested arrows pointing -x after remap
  let a1 = abs(abs(q.y) * 0.8 - q.x - 0.35) - 0.11;
  let a2 = abs(abs(q.y) * 0.8 - q.x + 0.25) - 0.11;
  let lim = step(abs(q.y), 0.75);
  let m = max(smoothstep(0.06, -0.02, a1), smoothstep(0.06, -0.02, a2)) * lim;
  let pulse = 0.55 + 0.25 * sin(t * 2.2) + hover * 0.9;
  let col = mix(vec3f(0.85, 0.80, 0.62), vec3f(1.3, 1.15, 0.7), hover);
  let halo = exp(-dot(q, q) * 1.4) * (0.10 + hover * 0.30);
  return vec4f(col * (m * pulse + halo), max(m * 0.85, halo));
}
`

// ─────────────────────────────────────────────────────── the four views ──
const VIEWS = /* wgsl */`
// px = pixel in 0..512 grid coords (y down), p = uv (-1..1, y down)
fn mod_tg_shore(p: vec2f, px: vec2f, t: f32) -> vec3f {
  let night = uni(23);
  let vault = uni(26);
  let horizon = 0.17;                 // uv.y of the sea line (matches rd.y = 0)
  // ── a real camera over a real sea ──
  let pv = vec2f(p.x, -p.y);
  let st = 1.0 + t * 0.55;
  let ro = vec3f(0.0, 3.2 + sin(t * 0.4) * 0.05, 0.0);
  let rd = normalize(vec3f(pv.x, pv.y * 0.72 + 0.122, 1.75));
  let sel = mix(0.055, -0.22, night);
  let saz = 1.446;                    // sun hangs left of the island
  let sunv = normalize(vec3f(cos(saz) * cos(sel), sin(sel), sin(saz) * cos(sel)));
  let mel = mix(-0.25, 0.50, night);
  let maz = 1.917;                    // the vault-lamp rises where the vault breaches
  let mdv = normalize(vec3f(cos(maz) * cos(mel), sin(mel), sin(maz) * cos(mel)));
  var c = mod_tgo_sky(rd, sunv, mdv, t, vault);
  var seaT = 100000.0;
  var seaHit = 0.0;
  // ── the ocean: bisection-marched heightfield, analytic normals ──
  if (rd.y < -0.003) {
    var tm = 0.0;
    var tx = 1000.0;
    var hx = mod_tgo_map3(ro + rd * tx, st);
    if (hx < 0.0) {
      var hm = mod_tgo_map3(ro, st);
      var tmid = 0.0;
      for (var i = 0; i < 8; i++) {
        tmid = mix(tm, tx, hm / (hm - hx));
        let pm = ro + rd * tmid;
        let hmid = mod_tgo_map3(pm, st);
        if (hmid < 0.0) { tx = tmid; hx = hmid; } else { tm = tmid; hm = hmid; }
      }
      let pt = ro + rd * tmid;
      let dist = pt - ro;
      let eps = max(dot(dist, dist) * 0.0002, 0.002);
      let n = mod_tgo_nrm(pt, eps, st);
      let seaCol = mod_tgo_seacol(pt, n, sunv, mdv, rd, dist, t, st, vault);
      c = mix(c, seaCol, pow(1.0 - smoothstep(-0.02, 0.0, rd.y), 0.2));
      seaT = tmid;
      seaHit = 1.0;
    }
  }
  // ── THE RISEN VAULT (finale): a glass dome breaching the sea ──
  if (vault > 0.001) {
    let vy = horizon + 0.02 - vault * 0.16;         // rises out of the water
    let vp = (p - vec2f(-0.15, vy + 0.16)) / 0.20;
    let dome = length(vp * vec2f(1.0, 1.6)) - 1.0;
    let waterY = vy + 0.115;                          // where the sea cuts across the dome
    // ── SUBMERGED FOUNDATION: a widening base + caustics seen down through water ──
    // (drawn first, so the emerged shell overlaps it at the breach line)
    let subDepth = p.y - waterY;                      // >0 = below the surface
    if (subDepth > 0.0 && subDepth < 0.30) {
      let fx = abs(p.x - (-0.15));
      let w = mix(0.075, 0.20, subDepth / 0.30);      // the foundation flares as it descends
      let inside = smoothstep(w, w * 0.55, fx);
      let fade = smoothstep(0.30, 0.0, subDepth);     // murkier the deeper it sinks
      let caust = 0.55 + 0.45 * sin(p.x * 44.0 + t * 2.1) * sin(p.y * 30.0 - t * 1.6);
      var bc = vec3f(0.05, 0.17, 0.21) * (0.4 + 0.7 * caust);
      bc += vec3f(0.16, 0.46, 0.52) * exp(-fx * fx * 130.0) * (0.4 + 0.6 * fade);   // lit central shaft
      bc += vec3f(0.30, 0.72, 0.80) * pow(inside, 3.0) * fade * 0.5;                // rim of the base
      c = mix(c, bc, vault * inside * (0.55 + 0.35 * fade));
    }
    // ── the emerged glass shell — full dome, murked below the waterline ──
    if (dome < 0.0) {
      let nrm = clamp(-dome * 2.0, 0.0, 1.0);
      var vc = mix(vec3f(0.045, 0.10, 0.14), vec3f(0.16, 0.34, 0.42), nrm);
      vc += vec3f(0.55, 0.95, 1.05) * pow(1.0 - nrm, 2.5) * 1.3;               // rim light
      vc += vec3f(0.30, 0.75, 0.85) * exp(-dot(vp, vp) * 1.6) * (0.5 + 0.3 * sin(t * 0.9)); // inner lamp
      vc += vec3f(1.15, 1.0, 0.62) * mod_tg_glyph(2, vp * 2.4) * (0.8 + 0.5 * sin(t * 1.7));
      vc *= 1.0 - 0.22 * step(0.42, abs(fract(vp.y * 3.0) - 0.5));             // latitude ribs
      // below the waterline the shell dims, tints deep-teal, and its light wobbles
      let below = smoothstep(waterY - 0.004, waterY + 0.03, p.y);
      let caust2 = 0.5 + 0.5 * sin(vp.x * 8.0 + t * 2.0) * sin(vp.y * 6.0 - t * 1.5);
      vc = mix(vc, mix(vc, vec3f(0.04, 0.15, 0.19), 0.62) * (0.42 + 0.4 * caust2), below);
      c = mix(c, vc * (0.4 + vault), vault * smoothstep(0.03, -0.05, dome));
    }
    // near halo where it breaches
    let lx = p.x + 0.15;
    c += vec3f(0.30, 0.70, 0.90) * exp(-lx * lx * 22.0) * smoothstep(horizon, horizon + 0.22, p.y) * smoothstep(horizon + 0.45, horizon + 0.1, p.y) * vault * 0.32;
    // water DISPLACED by the rising dome — stronger rings, a real push
    let seaMask = smoothstep(horizon, horizon + 0.30, p.y) * smoothstep(horizon + 0.52, horizon + 0.06, p.y);
    let db = length((p - vec2f(-0.15, waterY + 0.02)) * vec2f(1.0, 2.0));
    let ring = sin(db * 13.0 - t * 3.4 - vault * 7.0) * exp(-db * 2.5);
    let disp = ring * (vault * (1.0 - vault) * 5.0 + vault * 0.5);
    c += vec3f(0.46, 0.86, 0.96) * max(disp, 0.0) * seaMask;              // lifted crest
    c -= vec3f(0.13, 0.21, 0.23) * max(-disp, 0.0) * seaMask;             // trough behind it
  }
  // ── the island observatory: raymarched against the same sky and sun ──
  if (p.x > 0.20 && p.y < 0.90 && rd.z > 0.0) {
    var tI = 9.5;
    var hitM = -1.0;
    var hitP = vec3f(0.0);
    for (var st2 = 0; st2 < 56; st2++) {
      let pos = ro + rd * tI;
      let dm = mod_tgi_sdf(pos);
      if (dm.x < 0.02) { hitM = dm.y; hitP = pos; break; }
      tI = tI + max(dm.x * 0.85, 0.015);
      if (tI > 22.5) { break; }
    }
    if (hitM > -0.5 && (seaHit < 0.5 || tI < seaT)) {
      let n = mod_tgi_nrm(hitP);
      let q = hitP - vec3f(6.5, 0.0, 16.0);
      let sunD = clamp(dot(n, sunv), 0.0, 1.0);
      let skyA = 0.22 + 0.30 * clamp(n.y, 0.0, 1.0);              // sky ambient
      let suncol = mod_tgo_suncol(sel);
      var alb = vec3f(0.05);
      var emis = vec3f(0.0);
      let mi = i32(hitM + 0.5);
      if (mi == 0) {                                              // rock
        alb = vec3f(0.062, 0.055, 0.058) * (0.7 + 0.6 * fbm(hitP.xy * 2.2 + hitP.zz * 1.3, 3));
        alb *= 1.0 - 0.3 * smoothstep(0.4, 0.0, hitP.y);          // tide-dark base
      } else if (mi == 1) {                                       // masonry: weathered courses
        alb = vec3f(0.135, 0.120, 0.105) * (0.75 + 0.4 * fbm(vec2f(atan2(q.z, q.x - 0.6) * 4.0, hitP.y * 7.0), 2));
        alb *= 1.0 - 0.22 * smoothstep(0.35, 0.5, abs(fract(hitP.y * 3.6) - 0.5));
        alb *= 1.0 - 0.25 * smoothstep(2.4, 1.9, hitP.y);         // damp foot
      } else if (mi == 2) { alb = vec3f(0.045, 0.040, 0.042);     // ironwork
      } else if (mi == 3) {                                       // the tide-glass dome
        let fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.0);
        alb = vec3f(0.035, 0.075, 0.085);
        emis = vec3f(0.10, 0.55, 0.60) * (0.30 + night * 0.9 + fres * 0.5);
        emis *= 1.0 - 0.35 * step(0.42, abs(fract(atan2(q.z, q.x - 0.6) * 1.273) - 0.5));  // ribs
        emis += vec3f(0.9, 0.95, 1.0) * fres * 0.25;
      } else if (mi == 4) { alb = vec3f(0.055, 0.085, 0.075) * (0.8 + 0.3 * fbm(hitP.xz * 6.0, 2));  // verdigris roof
      } else if (mi == 5) {                                       // cottage clapboard
        alb = vec3f(0.140, 0.115, 0.090) * (0.8 + 0.3 * fbm(vec2f(hitP.x * 3.0, hitP.y * 14.0), 2));
        alb *= 1.0 - 0.18 * smoothstep(0.35, 0.5, abs(fract(hitP.y * 7.0) - 0.5));
      } else if (mi == 6) { alb = vec3f(0.110, 0.062, 0.048) * (0.8 + 0.35 * fbm(hitP.xy * 9.0, 2)); // brick
      } else if (mi == 7) {                                       // the beacon
        alb = vec3f(0.03);
        emis = vec3f(0.30, 0.90, 0.95) * (1.2 + night * 1.8) * (0.85 + 0.15 * sin(t * 2.1));
      }
      let selfSh = mod_tgi_shadow(hitP + n * 0.12, sunv);
      var ic = alb * (skyA * mix(vec3f(0.55, 0.45, 0.55), vec3f(0.25, 0.30, 0.50), night) * 2.0 + suncol * sunD * selfSh * (1.15 - night * 0.75));
      // dusk rim from the sunward edge
      let rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0) * clamp(dot(n, sunv) + 0.4, 0.0, 1.0);
      ic += suncol * rim * (0.5 - night * 0.3);
      // lit windows: tower (two) + cottage (one), camera face
      if (mi == 1 && q.z < 0.0) {
        let wa = abs(atan2(q.z, q.x - 0.6) + 1.5708);
        let wy1 = smoothstep(0.16, 0.10, abs(hitP.y - 2.95)) * smoothstep(0.30, 0.18, wa);
        let wy2 = smoothstep(0.14, 0.09, abs(hitP.y - 3.95)) * smoothstep(0.30, 0.18, wa);
        emis += vec3f(1.5, 0.95, 0.40) * (wy1 + wy2) * (0.5 + night * 0.9);
      }
      if (mi == 5 && q.z < 0.25) {
        let wc = smoothstep(0.14, 0.08, abs(q.x + 1.05)) * smoothstep(0.16, 0.09, abs(hitP.y - 2.38));
        emis += vec3f(1.5, 0.9, 0.35) * wc * (0.5 + night * 0.9);
      }
      ic += emis;
      // aerial perspective into the dusk
      let fogF = clamp((tI - 11.0) / 24.0, 0.0, 1.0);
      ic = mix(ic, mod_tgo_sky(rd, sunv, mdv, t, vault) * 0.9, fogF * 0.35);
      c = ic;
    }
  }
  // ── a low mist bank drifts before the island, breathing with the hour ──
  if (rd.z > 0.05) {
    let mistT = 11.2 / rd.z;
    let mp = ro + rd * mistT;
    let seaBlocks = seaHit > 0.5 && seaT < mistT;
    if (!seaBlocks && mp.y > -0.3 && mp.y < 3.4 && mp.x > -6.0 && mp.x < 12.0) {
      var md = fbm(vec2f(mp.x * 0.30 - t * 0.035, mp.y * 0.75 + t * 0.008), 3);
      md = md * (0.75 + 0.25 * vnoise(vec2f(mp.x * 1.3 + t * 0.05, mp.y * 2.0)));
      let band = smoothstep(3.2, 0.5, mp.y) * smoothstep(0.40, 0.72, md);
      let mistCol = mix(vec3f(0.80, 0.50, 0.34), vec3f(0.16, 0.24, 0.34), night)
                  + mod_tgo_suncol(sel) * exp(-abs(mp.x - 4.0) * 0.25) * (1.0 - night) * 0.22;
      c = mix(c, mistCol, band * 0.34);
    }
  }
  // beacon halo + its wobbling light on the water (screen-space, projected)
  {
    let bs = vec2f(1.75 * 7.1 / 16.0, -((1.75 * 2.52 / 16.0) - 0.122) / 0.72);
    let bd2 = p - bs;
    c += vec3f(0.30, 0.85, 0.90) * exp(-dot(bd2, bd2) * 240.0) * (0.35 + night * 0.9);
    if (p.y > horizon + 0.01) {
      let sx2 = p.x - bs.x;
      let wob = 0.72 + 0.28 * sin(p.y * 52.0 + t * 1.35);
      c += vec3f(0.22, 0.60, 0.62) * exp(-sx2 * sx2 * 1600.0) * smoothstep(horizon + 0.42, horizon, p.y) * 0.20 * wob * (0.4 + night);
      c += vec3f(0.85, 0.55, 0.22) * exp(-pow(p.x - 0.71, 2.0) * 900.0) * smoothstep(horizon + 0.30, horizon, p.y) * 0.14 * wob * (1.0 - night * 0.4);
    }
  }
  // ── four bell-buoys: real bodies riding the marched sea ──
  for (var k = 0; k < 4; k++) {
    let fk = f32(k);
    var bwx = -4.4;
    if (k == 1) { bwx = -2.45; } else if (k == 2) { bwx = -0.6; } else if (k == 3) { bwx = 1.45; }
    let axk = 1.75 * bwx / 11.0;
    if (abs(p.x - axk) > 0.34) { continue; }
    // anchor on the actual wave field
    let bh = mod_tgo_h2(vec2f(bwx, 11.0), st);
    let base = vec3f(bwx, bh, 11.0);
    let dirB = base - ro;
    let bDist = length(dirB);
    let occl = step(0.5, seaHit) * step(seaT, bDist - 0.45);   // a crest stands in front
    if (occl > 0.5) { continue; }
    let su = 1.75 / dirB.z;
    let sx = 1.75 * dirB.x / dirB.z;
    let sy = -((1.75 * dirB.y / dirB.z - 0.122) / 0.72);
    let lean = sin(t * 0.6 + fk * 1.9) * 0.10 + sin(t * 1.1 + fk * 3.1) * 0.03;
    let gcol = mod_tg_gcol(k);
    let flash = uni(19 + k);
    // ── the buoy as it was: slim keeper of its lamp — hull, post, and light ──
    {
      var q0 = p - vec2f(sx, sy);
      q0.x = q0.x + q0.y * lean;
      // hull: half-sunk iron, a touch of dusk rim, seated in the swell
      let hd = length((q0 - vec2f(0.0, -0.10 * su)) * vec2f(1.0, 2.2)) - 0.50 * su;
      if (hd < 0.0 && q0.y < 0.06 * su) {
        var bc = vec3f(0.034, 0.030, 0.032) * (0.85 + 0.4 * fbm(q0 * 30.0 + vec2f(fk * 7.0), 2));
        bc += mix(vec3f(0.75, 0.34, 0.12), vec3f(0.10, 0.13, 0.22), night) * smoothstep(0.02 * su, -0.06 * su, hd) * clamp(0.5 - q0.x * 6.0, 0.0, 1.0) * 0.5;
        bc += gcol * exp(-q0.y * q0.y * 300.0) * flash * 0.3;
        // wet sheen at the waterline
        bc += vec3f(0.4, 0.45, 0.5) * exp(-pow((q0.y - 0.02 * su) / (0.03 * su), 2.0)) * 0.25;
        c = mix(c, bc, smoothstep(0.004, -0.004, hd));
      }
      // post: slender, warm-rimmed toward the sun
      let pd2 = max(abs(q0.x) - 0.045 * su, max(q0.y - (-0.12 * su), -1.62 * su - q0.y));
      if (pd2 < 0.0) {
        var pc2 = vec3f(0.036, 0.032, 0.032) * (0.9 + 0.3 * fbm(vec2f(q0.x * 60.0, q0.y * 8.0), 2));
        pc2 += mix(vec3f(0.7, 0.32, 0.12), vec3f(0.12, 0.15, 0.24), night) * smoothstep(0.0, -0.03 * su, abs(q0.x) - 0.02 * su) * 0.35;
        // cross-brace collar where the lamp mounts
        pc2 += vec3f(0.30, 0.24, 0.14) * smoothstep(0.016 * su, 0.006 * su, abs(q0.y + 1.52 * su)) * 0.8;
        c = mix(c, pc2, smoothstep(0.003, -0.003, pd2));
      }
      // waterline seat shadow
      let fq2 = q0 - vec2f(0.0, 0.035 * su);
      c *= 1.0 - exp(-pow(fq2.y / (0.030 * su), 2.0)) * smoothstep(0.55 * su, 0.20 * su, abs(fq2.x)) * 0.30;
    }
    // the lantern-glyph, alive when its bell speaks (billboard over the head)
    var q = p - vec2f(sx, sy);
    q.x = q.x + q.y * lean;
    let lp2 = (q - vec2f(0.0, -1.80 * su)) / (0.44 * su);
    if (abs(lp2.x) < 1.6 && abs(lp2.y) < 1.6) {
      // a dark lamp-glass backing makes the glyph legible against bright sky
      let back = smoothstep(1.35, 0.95, length(lp2));
      c = mix(c, vec3f(0.015, 0.014, 0.018), back * 0.72);
      let g = mod_tg_glyph(k, lp2);
      c = mix(c, gcol * (1.15 + flash * 2.6), g);
      c += gcol * g * 0.4;                                 // let bloom catch it
    }
    c += gcol * exp(-dot(q - vec2f(0.0, -1.78 * su), q - vec2f(0.0, -1.78 * su)) * (170.0 / (su * su))) * (0.10 + flash * 1.9) * su * 4.0;
    // waterline seat: the hull settles INTO the sea (foam now lives in the sea shader)
    let fq2 = q - vec2f(0.0, 0.035 * su);
    c *= 1.0 - exp(-pow(fq2.y / (0.030 * su), 2.0)) * smoothstep(0.55 * su, 0.20 * su, abs(fq2.x)) * 0.30;
    // its light wobbling down the water
    if (q.y > 0.05 * su) {
      let wob4 = 0.6 + 0.4 * sin(p.y * 46.0 + t * 1.6 + fk);
      c += gcol * exp(-pow(q.x / (0.10 * su), 2.0)) * exp(-q.y * 2.2) * (0.12 + flash * 0.55) * wob4;
    }
  }
  return c;
}

// ═══ THE TIDE RECORD — the stele's own chamber, right of the gate disc ═══
fn mod_tg_stele(p: vec2f, px: vec2f, t: f32) -> vec3f {
  // carved alcove: candle-lit ancient wall — gear fossils and tide-strata
  let vign2 = 0.26 + 0.62 * exp(-dot(p * vec2f(0.9, 0.75), p * vec2f(0.9, 0.75)) * 0.9);
  var c = mod_tg_ancient(p * 1.7 + vec2f(31.0), 7.0, vec2f(0.6, -0.7), vign2, 1) * vign2;
  // archive pigeonholes flank the chamber: rows of scroll-filled recesses
  if (abs(p.x) > 0.70 && p.y > -0.55 && p.y < 0.60) {
    let hq = vec2f(fract(abs(p.x) * 7.0), fract((p.y + 0.55) * 5.2));
    let hole = step(0.16, hq.x) * step(hq.x, 0.86) * step(0.14, hq.y) * step(hq.y, 0.84);
    if (hole > 0.5) {
      let hid = floor(vec2f(abs(p.x) * 7.0, (p.y + 0.55) * 5.2)) + vec2f(sign(p.x) * 9.0, 0.0);
      let hh = hash21(hid);
      var hc = vec3f(0.012, 0.010, 0.010);                          // deep recess
      if (hh > 0.35) {
        // a rolled scroll catches the candlelight — round end, wax seal fleck
        let sq = (hq - vec2f(0.51, 0.49)) * vec2f(1.35, 1.8);
        let scroll = smoothstep(0.30, 0.26, length(sq));
        let paper = mix(vec3f(0.28, 0.22, 0.14), vec3f(0.42, 0.34, 0.22), hash21(hid + 4.0));
        hc = mix(hc, paper * (0.35 + 0.65 * vign2) * (0.7 + 0.6 * smoothstep(0.3, -0.3, sq.x)), scroll);
        hc += vec3f(0.55, 0.12, 0.08) * step(0.82, hh) * smoothstep(0.10, 0.05, length(sq - vec2f(0.12, 0.0))) * 0.8;
      }
      c = mix(c, hc, 0.92);
      // worn sill light under each hole
      c += vec3f(0.55, 0.34, 0.14) * smoothstep(0.14, 0.10, hq.y) * hole * vign2 * 0.15;
    }
  }
  // floor line + flags
  if (p.y > 0.66) {
    let fv = p.y - 0.66;
    let rc2 = log(1.0 + fv * 5.0) * 7.0;
    let cc2 = p.x * (2.4 / (0.30 + fv)) + hash11(floor(rc2)) * 2.0;
    var fc = vec3f(0.075, 0.066, 0.062) * (0.75 + 0.4 * hash21(vec2f(floor(cc2), floor(rc2))));
    fc *= 1.0 - 0.4 * max(smoothstep(0.38, 0.5, abs(fract(rc2) - 0.5)), smoothstep(0.42, 0.5, abs(fract(cc2) - 0.5)));
    c = fc * (0.5 + 0.6 * exp(-p.x * p.x * 2.0));
  }
  // two sconce lamps flanking the slab: iron, glass, a true flame
  for (var sN = 0; sN < 2; sN++) {
    let sxx = select(-0.62, 0.62, sN == 1);
    let sp0 = p - vec2f(sxx, -0.02);
    let fs = f32(sN);
    let flick = 0.82 + 0.13 * sin(t * (6.3 + fs * 1.4) + fs * 9.0) + 0.05 * sin(t * 17.0 + fs * 5.0);
    // the sconce: iron stem up the wall, a shallow dish, a wax candle
    let stemD = sdBox(sp0 - vec2f(0.0, 0.235), vec2f(0.011, 0.085));
    let dishD = max(length((sp0 - vec2f(0.0, 0.150)) * vec2f(1.0, 2.6)) - 0.058, -(sp0.y - 0.128));
    let iron = min(stemD, dishD);
    if (iron < 0.0) {
      var ic2 = vec3f(0.050, 0.040, 0.032) * (0.85 + 0.5 * clamp(-(sp0.y - 0.15) * 8.0 + 0.4, 0.0, 1.0));
      ic2 *= 0.8 + 0.4 * fbm(sp0 * 60.0 + vec2f(fs * 3.0), 2);                 // forged texture
      ic2 += vec3f(1.0, 0.60, 0.22) * smoothstep(0.006, 0.0, abs(dishD + 0.008)) * 0.45 * flick;  // rim catches the flame
      c = mix(c, ic2, smoothstep(0.004, -0.004, iron));
    }
    // the candle: warm wax, dripped edges, a dark wick
    let waxD = sdBox(sp0 - vec2f(0.0, 0.096), vec2f(0.021 + 0.004 * sin(sp0.y * 90.0 + fs * 5.0), 0.036));
    if (waxD < 0.0) {
      var wc2 = vec3f(0.62, 0.50, 0.34) * (0.55 + 0.45 * clamp(-(sp0.x) * 8.0 + 0.5, 0.0, 1.0));
      wc2 += vec3f(1.0, 0.65, 0.28) * exp(-pow((sp0.y - 0.062) * 30.0, 2.0)) * 0.55 * flick;   // translucent glow at the lip
      c = mix(c, wc2, smoothstep(0.003, -0.003, waxD));
    }
    let wickD = sdBox(sp0 - vec2f(0.0, 0.052), vec2f(0.0035, 0.012));
    c = mix(c, vec3f(0.05, 0.03, 0.02), smoothstep(0.003, -0.002, wickD));
    // the flame: a living tongue — fbm-torn edge, layered heat, licking tip
    {
      var fq = sp0 - vec2f(0.0, -0.008);
      // rising turbulence tears the profile; stronger toward the tip
      let rise = clamp(-fq.y * 8.0 + 0.4, 0.0, 1.6);
      let torn = fbm(vec2f(fq.x * 26.0, fq.y * 15.0 - t * 4.2 + fs * 9.0), 3) - 0.5;
      fq.x = fq.x + torn * 0.030 * rise;
      fq.x = fq.x + sin(t * 3.1 + fs * 2.2) * 0.006 * rise;             // slow sway
      // teardrop: wide at the wick, drawn to a licking point
      let neck = 1.0 + clamp(fq.y + 0.035, 0.0, 0.4) * 5.5;
      let tipFlick = 1.0 + 0.22 * sin(t * 11.0 + fs * 4.0) * smoothstep(0.0, -0.06, fq.y);
      let flameD = length(vec2f(fq.x * 2.6 * neck, (fq.y + 0.008) * 1.30 / tipFlick)) - 0.075;
      if (flameD < 0.012) {
        let heat = clamp(-flameD * 11.0, 0.0, 1.0);
        // stratified: transparent skin → orange → yellow → white heart
        var fc2 = mix(vec3f(0.95, 0.30, 0.05), vec3f(1.55, 0.95, 0.25), smoothstep(0.15, 0.55, heat));
        fc2 = mix(fc2, vec3f(2.0, 1.75, 1.25), smoothstep(0.62, 0.95, heat));
        // the blue-violet root at the wick
        fc2 = mix(fc2, vec3f(0.35, 0.25, 0.75), smoothstep(0.035, 0.075, fq.y) * smoothstep(0.9, 0.4, heat) * 0.7);
        // inner darker vein above the wick (real candles hollow there)
        fc2 *= 1.0 - 0.35 * exp(-dot(fq - vec2f(0.0, 0.030), fq - vec2f(0.0, 0.030)) * 900.0);
        let edge = smoothstep(0.010, -0.004, flameD);
        c = mix(c, fc2 * flick * 1.3, edge);
        // heat shimmer just above the tip
        c += vec3f(0.9, 0.55, 0.2) * exp(-pow((fq.y + 0.10) * 22.0, 2.0)) * exp(-fq.x * fq.x * 500.0) * 0.12 * flick;
      }
    }
    // its light: near halo, wall gradient, pool on the floor
    c += vec3f(1.0, 0.55, 0.18) * exp(-dot(sp0, sp0) * 5.0) * 0.36 * flick;
    c += vec3f(0.75, 0.42, 0.14) * exp(-dot(sp0, sp0) * 1.1) * 0.14 * flick;
    let poolD = (p - vec2f(sxx * 0.85, 0.86)) * vec2f(2.2, 8.0);
    c += vec3f(0.85, 0.48, 0.16) * exp(-dot(poolD, poolD) * 1.2) * 0.16 * flick;
  }
  // ── the slab: large, enthroned, readable ──
  let sp2 = p - vec2f(0.0, 0.10);
  let steleD = sdRoundedBox(sp2, vec2f(0.34, 0.58), 0.05);
  // plinth beneath
  c = mix(c, vec3f(0.085, 0.075, 0.068) * (0.7 + 0.3 * fbm(p * 8.0, 2)), smoothstep(0.01, -0.01, sdBox(p - vec2f(0.0, 0.78), vec2f(0.42, 0.10))));
  if (steleD < 0.0) {
    var sc2 = mod_tg_rock(p * 2.6 + vec2f(9.0), vec3f(0.135, 0.122, 0.112));
    sc2 *= 0.80 + 0.35 * smoothstep(0.0, -0.2, steleD);
    // beveled edge catches candlelight
    sc2 += vec3f(0.95, 0.60, 0.25) * smoothstep(0.030, 0.0, abs(steleD + 0.020)) * 0.35;
    // carve: columns k=0..4, ticks = answer[k]+1  (answer 3,1,4,2,0)
    for (var k = 0; k < 5; k++) {
      var ticks = 1;
      if (k == 0) { ticks = 4; } else if (k == 1) { ticks = 2; } else if (k == 2) { ticks = 5; } else if (k == 3) { ticks = 3; }
      let cx = -0.232 + f32(k) * 0.116;
      // faint column channel
      sc2 *= 1.0 - 0.10 * smoothstep(0.040, 0.020, abs(sp2.x - cx)) * step(-0.30, sp2.y) * step(sp2.y, 0.50);
      for (var j = 0; j < 5; j++) {
        if (j >= ticks) { continue; }
        let tickP = sp2 - vec2f(cx, 0.42 - f32(j) * 0.165);
        let td = sdBox(tickP, vec2f(0.036, 0.026));
        let carve = smoothstep(0.014, -0.006, td);
        let inner = smoothstep(0.0, -0.014, td);
        sc2 = mix(sc2, vec3f(0.040, 0.046, 0.048), carve * 0.9);
        sc2 += vec3f(0.22, 0.80, 0.68) * inner * (0.30 + 0.12 * max(sin(t * 0.9 + f32(k)), -0.9));
      }
    }
    // header: the four tide glyphs, the key to the count
    for (var k = 0; k < 4; k++) {
      let gp2 = (sp2 - vec2f(-0.174 + f32(k) * 0.116, -0.470)) / 0.050;
      if (abs(gp2.x) < 1.3 && abs(gp2.y) < 1.3) {
        let g = mod_tg_glyph(k, gp2);
        sc2 = mix(sc2, vec3f(0.045, 0.05, 0.05), g * 0.7);
        sc2 += mod_tg_gcol(k) * g * 0.55;
      }
    }
    // a graven wave-line beneath the header
    sc2 *= 1.0 - 0.25 * smoothstep(0.012, 0.004, abs(sp2.y + 0.40 - sin(sp2.x * 9.0) * 0.012));
    c = mix(c, sc2, smoothstep(0.006, -0.006, steleD));
  }
  // drifting dust in the candlelight
  let dcell = hash21(floor(vec2f(p.x * 130.0, p.y * 80.0 - t * 1.1)));
  c += vec3f(1.0, 0.8, 0.5) * step(0.9955, dcell) * exp(-dot(p, p) * 1.4) * 0.25;
  return c;
}

// aged bronze plate: layered patina over near-black metal, lit from above-left
fn mod_tg_plate(p: vec2f, key: f32) -> vec3f {
  var m = vec3f(0.030, 0.026, 0.022);
  let pat1 = fbm(p * 5.0 + vec2f(7.0), 3);
  let pat2 = fbm(p * 16.0 + vec2f(2.0), 2);
  m = mix(m, vec3f(0.085, 0.065, 0.038), smoothstep(0.45, 0.75, pat1) * 0.8);   // bronze bloom
  m = mix(m, vec3f(0.040, 0.055, 0.045), smoothstep(0.55, 0.85, pat2) * 0.5);   // verdigris fleck
  m *= 0.65 + 0.6 * pat2 * pat1;
  m *= 0.55 + key;                                                              // key light
  return m;
}

fn mod_tg_gate(p: vec2f, px: vec2f, t: f32) -> vec3f {
  let open = uni(8);
  // the cliff is a MACHINE fossil: strata, gear imprints, conduit grooves —
  // the observatory's dead works, pressed into the rock around the living door
  let vign = 0.28 + 0.50 * exp(-dot(p - vec2f(0.0, -0.1), p - vec2f(0.0, -0.1)) * 1.0);
  var c = mod_tg_ancient(p * 1.5, 3.0, vec2f(-0.7, -0.7), vign, 0) * vign;
  c += vec3f(0.30, 0.16, 0.07) * exp(-(p.x + 0.9) * (p.x + 0.9) * 1.0) * exp(-(p.y + 0.9) * (p.y + 0.9) * 1.1) * 0.4;
  // one great half-buried flywheel arcs behind the portal's upper right
  {
    let fq = (p - vec2f(0.94, -0.86)) / 0.52;
    let fg = mod_tg_gearh(fq, 0.72, 14.0);
    c = mix(c, vec3f(0.062, 0.052, 0.040) * (0.8 + vign), fg * 0.55 * smoothstep(1.6, 0.9, length(fq)));
    c += vec3f(0.45, 0.32, 0.12) * fg * 0.20 * vign;
  }
  // ── the plate frame: aged bronze slab enthroning the disc ──
  let fp = p - vec2f(0.0, 0.02);
  let fr1 = abs(sdRoundedBox(fp, vec2f(0.80, 0.80), 0.10)) - 0.030;
  let fr2 = abs(sdRoundedBox(fp, vec2f(0.90, 0.90), 0.12)) - 0.022;
  let frame = min(fr1, fr2);
  if (frame < 0.0) {
    let key = clamp(0.5 - fp.x * 0.6 - fp.y * 0.8, 0.0, 1.1);
    var kc = mod_tg_plate(p * 2.0, key);
    // engraved thin border line inside each band
    kc *= 1.0 - 0.35 * smoothstep(0.006, 0.002, abs(frame + 0.015));
    kc += vec3f(0.75, 0.52, 0.22) * smoothstep(0.008, 0.0, abs(frame + 0.006)) * key * 0.35;
    c = mix(c, kc, smoothstep(0.006, -0.006, frame));
  }
  // between the bands: dark plate with faint scattered etchings
  let between = max(sdRoundedBox(fp, vec2f(0.90, 0.90), 0.12), -sdRoundedBox(fp, vec2f(0.80, 0.80), 0.10));
  if (between < 0.0 && frame > 0.0) {
    var bc2 = mod_tg_plate(p * 2.0 + vec2f(4.0), clamp(0.4 - fp.x * 0.5 - fp.y * 0.6, 0.0, 1.0) * 0.7);
    let ecell = floor((fp + vec2f(2.0)) * 11.0);
    let eh = hash21(ecell);
    if (eh > 0.87) {
      let ep = (fract((fp + vec2f(2.0)) * 11.0) - 0.5) / 0.30;
      let gi2 = i32(eh * 37.0) % 4;
      bc2 += vec3f(0.55, 0.42, 0.18) * mod_tg_glyph(gi2, ep) * 0.16;   // ghost etchings
    }
    c = mix(c, bc2, smoothstep(0.006, -0.006, between));
  }
  // ── the threshold: worn steps and a puddle that remembers the door ──
  if (p.y > 0.86) {
    let sv = p.y - 0.86;
    var gc2 = vec3f(0.070, 0.062, 0.058) * (0.75 + 0.4 * fbm(vec2f(p.x * 7.0, p.y * 18.0), 2));
    gc2 *= 1.0 - 0.35 * smoothstep(0.35, 0.5, abs(fract(sv * 22.0) - 0.5));   // step treads
    // puddle mirrors the door's warmth
    let pd = length((p - vec2f(0.18, 0.965)) * vec2f(2.6, 9.0)) - 0.55;
    if (pd < 0.0) {
      let wob3 = 1.0 + sin(p.x * 60.0 + t * 2.0) * 0.15;
      gc2 = mix(gc2, vec3f(0.05, 0.055, 0.075) + vec3f(0.55, 0.30, 0.10) * (0.25 + open * 0.9) * wob3, smoothstep(0.0, -0.15, pd));
    }
    c = mix(c, gc2 * (0.5 + 0.5 * exp(-p.x * p.x * 1.5)), smoothstep(0.0, 0.05, sv));
  }
  // drips
  let dcol = floor(px.x / 24.0);
  let dh = hash11(dcol);
  if (dh > 0.55) {
    let dy = fract(p.y * 0.5 - t * (0.05 + dh * 0.1) + dh * 7.0);
    c += vec3f(0.35, 0.45, 0.5) * exp(-abs(fract(px.x / 24.0) - 0.5) * 14.0) * smoothstep(0.94, 1.0, dy) * 0.35;
  }
  // ── the great round door ──
  let dp = p - vec2f(0.0, 0.02);
  let R = 0.62;
  let dd = length(dp) - R;
  if (dd < 0.02) {
    // opening: an iris — the door's inner disc pulls back and darkens
    let irisR = R * (1.0 - open * 0.94);
    let ird = length(dp) - irisR;
    let rr = length(dp);
    if (ird > 0.0) {
      // ── the revealed passage: measured from the plate (zone read Jul 19) ──
      // radial law: near-black rim, long amber falloff, small hot heart at the orb
      let rn = rr / R;
      let oc = vec2f(0.0, -0.28);                          // the ornament seat (upper-center)
      var pc = vec3f(0.005, 0.004, 0.004);
      let fall = exp(-pow(rn / 0.46, 1.7) * 2.2);          // L(r) fit
      pc += vec3f(0.86, 0.55, 0.20) * fall * open;
      let heart = exp(-dot(dp - oc, dp - oc) * 26.0);
      pc += vec3f(1.15, 0.80, 0.38) * heart * open * 0.9;
      pc *= smoothstep(1.0, 0.82, rn);                     // rim to true black
      // gold dust: fine grain, mid-radius habitat
      let habitat = smoothstep(0.06, 0.22, rn) * smoothstep(0.88, 0.5, rn);
      let d1 = hash21(floor(dp * 260.0));
      let d2 = hash21(floor(dp * 130.0 + vec2f(37.0)));
      pc += vec3f(1.35, 1.05, 0.58) * step(0.993, d1) * (0.2 + 0.8 * abs(sin(t * 1.4 + d1 * 40.0))) * habitat * open * 0.8;
      pc += vec3f(1.05, 0.75, 0.35) * step(0.9915, d2) * (0.15 + 0.85 * abs(sin(t * 1.0 + d2 * 60.0))) * habitat * open * 0.25;
      // ── the ornament: chevrons and orb, the door's own enter-button ──
      if (open > 0.5) {
        let mm2 = vec2f(uni(27), uni(28));
        let hov = smoothstep(95.0, 34.0, length(mm2 - vec2f(256.0, 184.0)));
        let oq = dp - oc;
        for (var ch = 0; ch < 2; ch++) {
          let oy = select(0.056, -0.034, ch == 1);
          let vd = abs(oq.y - oy - abs(oq.x) * 0.72) - 0.031;
          let band = max(vd, abs(oq.x) - 0.165);
          if (band < 0.0) {
            // top-lit metal: bright upper face, bronze under-face, dark seam
            let face = clamp(-(oq.y - oy - abs(oq.x) * 0.72) * 11.0 + 0.55, 0.0, 1.0);
            var mc = mix(vec3f(0.34, 0.235, 0.095), vec3f(1.30, 1.06, 0.56), face);
            mc *= 1.0 - 0.5 * smoothstep(0.004, 0.0, abs(band + 0.026));   // dark inner seam
            mc += vec3f(1.3, 1.1, 0.65) * smoothstep(0.005, 0.0, abs(band + 0.006)) * 0.55;
            pc = mix(pc, mc * (0.85 + hov * 0.45), smoothstep(0.004, -0.004, band));
          }
        }
        // the orb: a small sun asleep in the notch
        let orbC = oq - vec2f(0.0, 0.014);
        let orb = length(orbC) - 0.047;
        if (orb < 0.0) {
          let sph = clamp(-orb * 18.0, 0.0, 1.0);
          var oc2 = mix(vec3f(0.24, 0.165, 0.07), vec3f(1.15, 0.98, 0.62), sph);
          oc2 *= 0.6 + 0.4 * clamp(-orbC.y * 12.0 + 0.5, 0.0, 1.0);         // shadowed south
          oc2 += vec3f(2.2, 2.0, 1.5) * exp(-dot(orbC - vec2f(-0.014, -0.014), orbC - vec2f(-0.014, -0.014)) * 3200.0);  // spec
          pc = mix(pc, oc2 * (0.9 + hov * 0.35), smoothstep(0.003, -0.003, orb));
        }
        pc += vec3f(1.0, 0.78, 0.42) * exp(-dot(oq, oq) * 44.0) * (0.22 + hov * 0.45);
      }
      // shadowed lip where the iris withdrew
      pc *= smoothstep(0.0, 0.07, ird);
      c = mix(c, pc, smoothstep(0.01, -0.01, dd));
    } else {
      // deep bronze: brushed rings, patina patches, one key light
      let ang = atan2(dp.y, dp.x);
      var bc = mix(vec3f(0.225, 0.140, 0.055), vec3f(0.085, 0.110, 0.095),
                   smoothstep(0.38, 0.78, fbm(dp * 6.0 + vec2f(3.0), 3)));
      bc *= 0.72 + 0.48 * fbm(vec2f(ang * 6.0, rr * 22.0), 2);   // brushed metal
      bc *= 1.0 - 0.38 * smoothstep(0.32, 0.5, abs(fract(rr * 9.0) - 0.5)); // ring grooves
      // engraved glyph ring
      bc *= 1.0 - 0.30 * step(0.46, abs(fract(ang * 3.8197) - 0.5)) * step(abs(rr - 0.485), 0.030);
      // eight spokes
      bc *= 1.0 - 0.26 * smoothstep(0.035, 0.0, abs(fract(ang * 1.2732 + 0.5) - 0.5) * rr) * step(0.17, rr);
      // key light upper-left, ambient falls off to near-black at the rim
      bc *= 0.30 + 0.80 * clamp(0.55 - dp.x * 0.8 - dp.y * 0.8, 0.0, 1.2);
      // center medallion: the vault star, waiting
      if (rr < 0.135) {
        bc = mix(vec3f(0.15, 0.092, 0.038), vec3f(0.26, 0.165, 0.07), clamp(1.0 - rr * 9.0, 0.0, 1.0));
        bc += vec3f(0.85, 0.60, 0.28) * mod_tg_glyph(2, dp / 0.095) * 0.40;
        bc *= 0.85 + 0.3 * clamp(-dp.y * 4.0, 0.0, 1.0);
      }
      // rim bevel light
      bc += vec3f(1.0, 0.62, 0.3) * smoothstep(0.02, -0.03, abs(dd + 0.03)) * clamp(-dp.y - dp.x + 0.3, 0.0, 1.0) * 0.30;
      c = mix(c, bc, smoothstep(0.01, -0.01, dd));
    }
  }
  // carved arch ring around the door
  c += vec3f(0.55, 0.4, 0.22) * smoothstep(0.025, 0.0, abs(length(dp) - (R + 0.05))) * 0.35;
  // ── the four dials, low across the door ──
  for (var k = 0; k < 4; k++) {
    let dc = vec2f(-0.39 + f32(k) * 0.26, 0.60);
    let q = p - dc;
    let r = length(q);
    if (r < 0.118) {
      let mm = vec2f(uni(27), uni(28));
      let mh = smoothstep(60.0, 22.0, length(mm - (dc * 0.5 + 0.5) * 512.0));
      var kc: vec3f;
      if (r > 0.082) {
        // bezel: dark bronze, one worn top-arc highlight (zone read Jul 19)
        kc = mod_tg_plate(q * 8.0 + vec2f(f32(k) * 5.0), 0.35);
        let bang = atan2(q.y, q.x);
        let topArc = exp(-pow((bang + 1.5708) * 1.1, 2.0));
        kc += vec3f(0.55, 0.42, 0.20) * topArc * smoothstep(0.115, 0.095, r) * 0.7;
        kc += vec3f(0.9, 0.68, 0.30) * smoothstep(0.009, 0.0, abs(r - 0.0855)) * (0.22 + topArc * 0.3);
        kc *= 0.8 + 0.25 * fbm(q * 40.0 + vec2f(f32(k) * 9.0), 2);
        kc *= 1.0 + mh * 0.4;
      } else {
        // the well: near-black, the glyph burning quiet inside
        kc = vec3f(0.012, 0.011, 0.012) + vec3f(0.045, 0.032, 0.018) * clamp(1.0 - r * 10.0, 0.0, 1.0);
        let gi = i32(uni(4 + k) + 0.5);
        let gp = q / 0.055;
        let g = mod_tg_glyph(gi, gp);
        let gcol = mod_tg_gcol(gi);
        kc = mix(kc, gcol * (1.05 + mh * 0.4), g * 0.95);
        kc += gcol * exp(-r * r * 260.0) * (0.13 + mh * 0.12);
        kc *= 0.55 + 0.45 * smoothstep(0.082, 0.055, r);   // inner shadow at the lip
      }
      c = mix(c, kc, smoothstep(0.005, -0.005, r - 0.116));
    }
  }
  // solved: gold seam light around everything
  c += vec3f(1.2, 0.85, 0.35) * smoothstep(0.03, 0.0, abs(length(dp) - R * (1.0 - open * 0.94))) * open * (1.0 - open) * 2.2;
  return c;
}

fn mod_tg_hall(p: vec2f, px: vec2f, t: f32) -> vec3f {
  let lit = uni(31);            // 0 dim → 1 solved blaze
  let solved = uni(14);
  // stone interior — the machine-wall again, and behind the organ a COLOSSAL
  // flywheel entombed in the masonry, its teeth just breaking the surface
  var c = mod_tg_ancient(p * 1.8 + vec2f(20.0), 13.0, vec2f(0.0, -0.9), 0.5 + lit * 0.5, 2) * (0.55 + 0.30 * lit);
  {
    let fq = (p - vec2f(0.0, 0.05)) / 1.15;
    let fg = mod_tg_gearh(fq, 0.86, 18.0);
    c = mix(c, vec3f(0.052, 0.045, 0.038) * (0.9 + lit * 0.8), fg * 0.45);
    c += vec3f(0.50, 0.36, 0.14) * fg * (0.10 + lit * 0.22);
    // its axle-boss behind the center pipe
    let ax = length(p - vec2f(0.0, 0.05)) - 0.10;
    c = mix(c, vec3f(0.070, 0.055, 0.038) * (1.0 + lit), smoothstep(0.015, -0.01, ax) * 0.8);
  }
  // back-wall arcade: shadowed arches between the pipes
  for (var a = 0; a < 4; a++) {
    let ax = -0.375 + f32(a) * 0.25;
    let aq = p - vec2f(ax, 0.10);
    var ad2 = 1.0;
    if (aq.y > -0.22) { ad2 = max(abs(aq.x) - 0.072, aq.y - 0.40); }
    else { ad2 = length(vec2f(aq.x, (aq.y + 0.22) * 1.1)) - 0.072; }
    if (ad2 < 0.0) {
      var av = vec3f(0.030, 0.028, 0.034) * (0.8 + 0.4 * fbm(aq * 9.0, 2));
      av += vec3f(0.25, 0.16, 0.08) * exp(-aq.y * aq.y * 3.0) * lit * 0.4;   // borrowed light
      c = mix(c, av, smoothstep(0.008, -0.008, ad2) * 0.85);
    }
    // arch surround highlight
    c += vec3f(0.30, 0.22, 0.13) * smoothstep(0.014, 0.0, abs(ad2 - 0.012)) * 0.35;
  }
  // vaulted ceiling ribs converging on the oculus
  if (p.y < -0.45) {
    let rib = abs(fract(atan2(p.x, -p.y - 0.30) * 2.546) - 0.5);
    c *= 1.0 - 0.30 * smoothstep(0.10, 0.02, rib) * smoothstep(-0.45, -0.75, p.y);
    c += vec3f(0.55, 0.42, 0.25) * smoothstep(0.05, 0.0, rib) * smoothstep(-0.5, -0.9, p.y) * (0.10 + lit * 0.35);
  }
  // oculus aperture ring
  let oring = abs(length((p - vec2f(0.0, -0.98)) * vec2f(1.0, 2.2)) - 0.34) - 0.035;
  c = mix(c, vec3f(0.14, 0.11, 0.06) * (0.8 + lit * 1.6), smoothstep(0.010, -0.010, oring));
  // wall sconces between pipes: small ember lamps
  for (var s = 0; s < 4; s++) {
    let scx = -0.375 + f32(s) * 0.25;
    let sq = p - vec2f(scx, -0.10);
    let flick2 = 0.8 + 0.2 * sin(t * (6.0 + f32(s)) + f32(s) * 7.0);
    let lamp = length(sq * vec2f(1.3, 1.0)) - 0.020;
    if (lamp < 0.0) { c = vec3f(1.5, 0.85, 0.30) * flick2; }
    c += vec3f(0.9, 0.50, 0.16) * exp(-dot(sq, sq) * 30.0) * 0.22 * flick2;
  }
  if (p.y > 0.62) {
    c = mod_tg_rock(vec2f(p.x * 2.0, p.y * 6.0), vec3f(0.09, 0.082, 0.078)) * (1.1 - (p.y - 0.62) * 0.8);
    // wet sheen strip where the pipes drip
    c *= 1.0 + 0.25 * smoothstep(0.68, 0.63, p.y) * (0.5 + 0.5 * sin(p.x * 40.0 + t));
  }
  c *= 0.45 + 0.4 * exp(-dot(p, p) * 0.7);
  // ── oculus shaft ──
  let shaft = exp(-p.x * p.x * mix(14.0, 6.0, lit));
  c += vec3f(0.9, 0.75, 0.5) * shaft * smoothstep(1.0, -1.0, p.y) * (0.09 + lit * 0.42);
  let mcell = hash21(floor(vec2f(p.x * 160.0, p.y * 95.0 - t * 2.4)));
  c += vec3f(1.1, 0.95, 0.7) * step(0.9945, mcell) * shaft * (0.05 + lit * 0.28);
  // ── star-glyph mural, high center — ignites when the organ is solved ──
  let mg = (p - vec2f(0.0, -0.72)) / 0.11;
  if (abs(mg.x) < 1.4 && abs(mg.y) < 1.4) {
    let g = mod_tg_glyph(2, mg);
    let reveal = uni(29);
    c = mix(c, mix(vec3f(0.10, 0.09, 0.10), mod_tg_gcol(2) * (1.1 + 1.3 * sin(t * 1.4) * 0.3), reveal), g * (0.35 + reveal * 0.65));
    c += mod_tg_gcol(2) * exp(-dot(mg, mg) * 0.8) * reveal * 0.5;
  }
  // ── five organ pipes ──
  for (var k = 0; k < 5; k++) {
    let cx = -0.49 + f32(k) * 0.245;
    let q = p - vec2f(cx, 0.14);
    let bodyD = sdRoundedBox(q, vec2f(0.062, 0.46), 0.05);
    if (bodyD < 0.012) {
      // brass shell
      var kc = mix(vec3f(0.34, 0.24, 0.11), vec3f(0.15, 0.19, 0.17), fbm(q * 12.0 + vec2f(f32(k) * 3.0), 2) * 0.7);
      kc *= 0.75 + 0.5 * exp(-q.x * q.x * 160.0);            // cylinder highlight
      // glass gauge window
      let gw = sdRoundedBox(q, vec2f(0.037, 0.40), 0.03);
      if (gw < 0.0) {
        let lvl = uni(9 + k);                                 // 0..1 (level/4)
        let fillTop = 0.40 - (lvl * 0.8 + 0.12) * 0.72;       // liquid surface (y down)
        var gc = vec3f(0.016, 0.022, 0.028);
        if (q.y > fillTop) {
          let glow = 0.55 + 0.45 * sin(q.y * 40.0 - t * 2.0);
          gc = vec3f(0.05, 0.35, 0.33) * (0.8 + lit * 0.8);
          gc += vec3f(0.10, 0.65, 0.58) * glow * 0.35;
          let bub = hash21(floor(vec2f(q.x * 90.0, q.y * 60.0 - t * (1.0 + f32(k) * 0.2))));
          gc += vec3f(0.3, 0.9, 0.8) * step(0.976, bub) * 0.5;
        }
        // liquid surface line
        gc += vec3f(0.5, 1.1, 1.0) * exp(-abs(q.y - fillTop) * 140.0) * 0.8;
        // tick marks — five stations
        let tickY = fract((q.y + 0.40) / 0.144);
        gc += vec3f(0.5, 0.45, 0.3) * smoothstep(0.06, 0.0, abs(tickY - 0.5)) * 0.14;
        kc = mix(kc, gc, smoothstep(0.004, -0.004, gw));
      }
      // hover: the pipe knows the hand is near
      let mm = vec2f(uni(27), uni(28));
      let hd = abs(mm.x - (cx * 0.5 + 0.5) * 512.0);
      kc += vec3f(0.9, 0.75, 0.4) * smoothstep(0.014, 0.0, abs(bodyD + 0.01)) * smoothstep(45.0, 12.0, hd) * 0.5;
      c = mix(c, kc, smoothstep(0.006, -0.006, bodyD));
      // floor reflection
      let fy = 0.62 + (0.62 - p.y) * 0.85;
      if (p.y > 0.62 && fy > -0.34 && fy < 0.60) {
        let rq = vec2f(p.x - cx, fy - 0.14);
        let rd = sdRoundedBox(rq, vec2f(0.062, 0.46), 0.05);
        c = mix(c, vec3f(0.10, 0.16, 0.16) * (0.4 + lit * 0.5), smoothstep(0.01, -0.01, rd) * 0.30 * (1.0 - (p.y - 0.62) * 1.6));
      }
    }
  }
  // solved wash
  c += vec3f(0.9, 0.8, 0.55) * solved * exp(-dot(p - vec2f(0.0, -0.4), p - vec2f(0.0, -0.4)) * 1.2) * 0.35;
  return c;
}

fn mod_tg_lens(p: vec2f, px: vec2f, t: f32) -> vec3f {
  // open night — the observatory crown, under the same physical sky as the shore
  let lrd = normalize(vec3f(p.x, -p.y * 0.85 + 0.30, 1.45));
  let lsd = normalize(vec3f(0.06, -0.30, 0.99));            // the sunk sun — deep night
  let lmd = normalize(vec3f(-0.4, -0.5, 0.8));              // no moon before the finale
  var c = mod_tgo_sky(lrd, lsd, lmd, t, uni(17));
  // ── four constellations, each tagged with a glyph ──
  // az from vertical: -0.90, -0.35, 0.25, 0.80 · glyphs 1,3,2,0 (answer: az 0.25 = glyph 2)
  for (var k = 0; k < 4; k++) {
    var az = -0.90; var gi = 1;
    if (k == 1) { az = -0.35; gi = 3; } else if (k == 2) { az = 0.25; gi = 2; } else if (k == 3) { az = 0.80; gi = 0; }
    let center = vec2f(sin(az), -cos(az)) * 0.72 + vec2f(0.0, 0.85);
    // five stars per figure, deterministic offsets, joined by faint lines
    var prev = vec2f(0.0);
    for (var j = 0; j < 5; j++) {
      let off = (hash22(vec2f(f32(k) * 7.0 + 2.0, f32(j) * 13.0 + 1.0)) - 0.5) * 0.30;
      let spos = center + off;
      let d = length(p - spos);
      let tw = 0.7 + 0.3 * sin(t * 2.0 + f32(j * 3 + k) * 2.1);
      c += vec3f(0.95, 1.0, 1.15) * exp(-d * d * 5200.0) * (1.6 + tw);
      if (j > 0) {
        let sd2 = sdSegment(p, prev, spos);
        c += vec3f(0.35, 0.45, 0.6) * smoothstep(0.004, 0.0, sd2) * 0.30;
      }
      prev = spos;
    }
    // the tag-glyph beneath the figure
    let gp = (p - (center + vec2f(0.0, 0.20))) / 0.045;
    if (abs(gp.x) < 1.4 && abs(gp.y) < 1.4) {
      c += mod_tg_gcol(gi) * mod_tg_glyph(gi, gp) * (0.30 + uni(29) * select(0.0, 0.55, gi == 2));
    }
  }
  // ── the observatory crown: parapet arc, flanking pylons ──
  // curved parapet — a dark arc the platform stands behind
  let par = p.y - (0.64 + 0.06 * p.x * p.x);
  if (par > 0.0) {
    var pc2 = vec3f(0.028, 0.026, 0.034) * (0.8 + 0.4 * fbm(p * 7.0 + vec2f(40.0), 2));
    // crenel notches along the rim
    pc2 *= 1.0 - 0.30 * step(abs(fract(p.x * 6.0) - 0.5), 0.10) * smoothstep(0.05, 0.0, par);
    // rim catch-light from the beam
    pc2 += vec3f(0.45, 0.40, 0.55) * smoothstep(0.020, 0.0, par) * (0.25 + uni(16) * 0.5);
    // engraved star-chart arcs + a rivet course along the parapet face
    let arc = abs(length(vec2f(p.x, (p.y - 1.7) * 1.6)) - 1.30);
    pc2 *= 1.0 - 0.25 * smoothstep(0.012, 0.004, min(arc, abs(arc - 0.09)));
    let riv = length(vec2f(fract(p.x * 9.0) - 0.5, fract((par + 0.05) * 11.0) - 0.5));
    pc2 += vec3f(0.40, 0.34, 0.28) * smoothstep(0.10, 0.04, riv) * smoothstep(0.10, 0.03, par) * 0.5;
    c = mix(c, pc2, smoothstep(0.0, 0.015, par));
  }
  // two glyph-lamp pylons at the platform's edge
  for (var s = 0; s < 2; s++) {
    let sx = select(-0.80, 0.80, s == 1);
    let pq = p - vec2f(sx, 0.72);
    let pyl = sdBox(pq, vec2f(0.045, 0.26));
    if (pyl < 0.0) {
      var yc = vec3f(0.055, 0.048, 0.055) * (0.8 + 0.4 * fbm(pq * 11.0, 2));
      yc += vec3f(0.5, 0.42, 0.28) * smoothstep(0.012, 0.0, abs(pq.x + 0.035)) * 0.4;
      c = mix(c, yc, smoothstep(0.006, -0.006, pyl));
    }
    // lamp head: the star-glyph burns atop each pylon
    let lg = (pq - vec2f(0.0, -0.315)) / 0.042;
    if (abs(lg.x) < 1.3 && abs(lg.y) < 1.3) {
      c += mod_tg_gcol(2) * mod_tg_glyph(2, lg) * (0.7 + 0.3 * sin(t * 1.3 + f32(s) * 3.0));
    }
    c += mod_tg_gcol(2) * exp(-dot(pq - vec2f(0.0, -0.315), pq - vec2f(0.0, -0.315)) * 160.0) * 0.35;
  }
  // ── the great lens, bottom center ──
  let lc = vec2f(0.0, 0.84);
  let lq = p - lc;
  let ang = uni(15);
  let dirv = vec2f(sin(ang), -cos(ang));
  // beam — a cone from the lens along dir
  let along = dot(lq, dirv);
  let across = abs(dot(lq, vec2f(-dirv.y, dirv.x)));
  if (along > 0.0) {
    let width = 0.012 + along * 0.055;
    let beam = exp(-pow(across / width, 2.0)) * exp(-along * 0.55);
    let hold = uni(16);
    c += mix(vec3f(1.0, 0.82, 0.45), vec3f(0.8, 0.62, 1.3), hold) * beam * (0.5 + hold * 1.5);
  }
  // mount pillar (behind the glass)
  let mp = sdBox(p - vec2f(0.0, 1.06), vec2f(0.045, 0.20));
  c = mix(c, vec3f(0.045, 0.040, 0.045), smoothstep(0.01, -0.01, mp));
  c += vec3f(0.5, 0.35, 0.15) * smoothstep(0.012, 0.0, abs(mp)) * 0.4;
  // lens body
  let ld = length(lq) - 0.17;
  if (ld < 0.06) {
    var kc = mix(vec3f(0.30, 0.22, 0.11), vec3f(0.14, 0.18, 0.16), fbm(lq * 20.0, 2) * 0.6);
    if (ld < -0.035) {
      // the glass: sky refracted + inner glow
      kc = mod_tg_sky(vec2f(p.x * 1.4, p.y * 1.4 - 0.9), t, 1.0) * 0.7 + vec3f(0.10, 0.14, 0.20);
      kc += vec3f(0.7, 0.65, 1.0) * exp(-dot(lq, lq) * 60.0) * (0.4 + uni(16) * 1.2);
    }
    kc += vec3f(1.0, 0.9, 0.6) * smoothstep(0.012, 0.0, abs(ld + 0.035)) * 0.5;
    c = mix(c, kc, smoothstep(0.008, -0.008, ld - 0.055));
  }
  // brass yoke: two arms cradle the glass, turning with the aim
  for (var ya = 0; ya < 2; ya++) {
    let side = select(-1.0, 1.0, ya == 1);
    let yang = ang + side * 1.35;
    let ydir = vec2f(sin(yang), -cos(yang));
    let yd = sdSegment(lq, ydir * 0.16, ydir * 0.26) - 0.020;
    if (yd < 0.0) {
      var yc2 = vec3f(0.24, 0.165, 0.075) * (0.8 + 0.5 * clamp(-lq.y * 3.0, 0.0, 1.0));
      yc2 += vec3f(0.9, 0.7, 0.35) * smoothstep(0.008, 0.0, abs(yd + 0.010)) * 0.4;
      c = mix(c, yc2, smoothstep(0.005, -0.005, yd));
    }
  }
  // hold-progress ring
  let hold = uni(16);
  if (hold > 0.001) {
    let pr = polar(lq / 0.22);
    let sweep = step(pr.y / 6.28318 + 0.5, hold);
    c += vec3f(0.8, 0.7, 1.3) * smoothstep(0.05, 0.0, abs(pr.x - 1.0)) * sweep * 1.4;
  }
  return c;
}

fn mod_tg_lattice(p: vec2f, px: vec2f, t: f32) -> vec3f {
  // the observatory interior at night — weave the constellation the island keeps.
  // whiteboard: uni(32)=bloom, uni(33..37)=the five anchor charges, uni(27),uni(28)=cursor px.
  let bloom = uni(32);
  let gold = uni(38);                                               // locked in → the constellation turns gold
  let cLine = mix(vec3f(0.30, 0.75, 0.85), vec3f(1.05, 0.72, 0.22), gold);
  let cGlow = mix(vec3f(0.30, 0.70, 0.80), vec3f(1.05, 0.74, 0.26), gold);
  let cCore = mix(vec3f(0.85, 0.95, 0.90), vec3f(1.0, 0.93, 0.62), gold);
  let neb = fbm4(p * 1.5 + vec2f(t * 0.05, -t * 0.04));
  var col = vec3f(0.015, 0.028, 0.05);
  col = col + vec3f(0.04, 0.10, 0.16) * pow(neb, 2.0);
  let s = 0.6;
  var A = array<vec2f, 5>(vec2f(0.0, 0.0), vec2f(-s, 0.0), vec2f(s, 0.0), vec2f(0.0, -s), vec2f(0.0, s));
  for (var i = 1; i < 5; i = i + 1) {
    let pa = p - A[0]; let ba = A[i] - A[0];
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    let d = length(pa - ba * h);
    col = col + vec3f(0.06, 0.10, 0.15) * exp(-d * d * 70.0) * (0.6 + 0.4 * sin(t * 3.0 + f32(i)));
  }
  for (var i = 0; i < 5; i = i + 1) {
    let ci = uni(33 + i);
    for (var j = i + 1; j < 5; j = j + 1) {
      let cj = uni(33 + j);
      let sm = min(ci, cj);
      if (sm > 0.55) {
        let pa = p - A[i]; let ba = A[j] - A[i];
        let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        let d = length(pa - ba * h);
        col = col + cLine * exp(-d * d * 90.0) * (sm - 0.5) * 2.0;
      }
    }
  }
  for (var i = 0; i < 5; i = i + 1) {
    let c = uni(33 + i);
    let d = p - A[i]; let r = dot(d, d);
    col = col + cGlow * exp(-r * 40.0) * (0.10 + c * 1.4);
    col = col + cCore * exp(-r * 300.0) * (0.25 + c * 1.1);
  }
  let cur = (vec2f(uni(27), uni(28)) - 256.0) / 256.0;
  let dc = p - cur;
  col = col + vec3f(0.80, 0.95, 1.0) * exp(-dot(dc, dc) * 420.0) * 0.9;
  let bloomCol = mix(vec3f(0.5, 0.85, 0.9), vec3f(1.0, 0.78, 0.34), gold);
  col = mix(col, col + bloomCol * 0.7 + vec3f(0.12, 0.13, 0.16) + vec3f(0.08, 0.05, 0.0) * gold, bloom * 0.7);
  return col;
}

fn mod_tg_scene(view: i32, p: vec2f, px: vec2f, t: f32) -> vec3f {
  if (view == 1) { return mod_tg_gate(p, px, t); }
  if (view == 2) { return mod_tg_hall(p, px, t); }
  if (view == 3) { return mod_tg_lens(p, px, t); }
  if (view == 4) { return mod_tg_stele(p, px, t); }
  if (view == 5) { return mod_tg_lattice(p, px, t); }
  return mod_tg_shore(p, px, t);
}
`

const VISUAL = /* wgsl */`
fn visual_tideglass(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = uni(3);
  let px = (uv * 0.5 + 0.5) * 512.0;
  let view = i32(uni(0) + 0.5);
  var c = mod_tg_scene(view, uv, px, t);
  // cross-fade during travel
  let fade = uni(2);
  if (fade > 0.003) {
    let pv = i32(uni(1) + 0.5);
    c = mix(c, mod_tg_scene(pv, uv, px, t), fade);
  }
  // ── nav chevrons (hook mirrors these hit zones) ──
  let mm = vec2f(uni(27), uni(28));
  let act = uni(24);
  let fin = uni(17);
  if (view == 0) {                                    // the shore — two ways on
    // the right chevron → the observatory's constellation room
    let a = mod_tg_chev(px, vec2f(487.0, 256.0), 0, smoothstep(55.0, 20.0, length(mm - vec2f(487.0, 256.0))), t);
    c = mix(c, a.rgb + c, a.a * 0.9);
    // an arrow over the dome — ONLY once the dome has actually breached the sea
    // (uni(26)=vault); by day there's no dome, so no orphaned chevron over water.
    if (uni(26) > 0.03) {
      let dm = vec2f(214.0, 318.0);
      let dhov = smoothstep(92.0, 28.0, length(mm - dm));
      let da = mod_tg_chev(px, vec2f(214.0, 262.0), 3, 0.4 + 0.6 * dhov, t);
      c = mix(c, da.rgb + c, da.a * 0.9 * min(uni(26) * 3.0, 1.0));
    }
    // the observatory building answers the cursor too — its own door is the gate
    let bc = vec2f(440.0, 300.0);
    let bhov = smoothstep(82.0, 30.0, length(mm - bc));
    c += vec3f(0.22, 0.52, 0.62) * bhov * (0.10 + 0.05 * sin(t * 2.0));
  }
  if (view == 5) {                                    // the observatory room → back down to the shore
    let a = mod_tg_chev(px, vec2f(25.0, 256.0), 1, smoothstep(55.0, 20.0, length(mm - vec2f(25.0, 256.0))), t);
    c = mix(c, a.rgb + c, a.a * 0.9);
  }
  if (view == 1) {
    let a = mod_tg_chev(px, vec2f(25.0, 256.0), 1, smoothstep(55.0, 20.0, length(mm - vec2f(25.0, 256.0))), t);
    c = mix(c, a.rgb + c, a.a * 0.9);
    let r2 = mod_tg_chev(px, vec2f(487.0, 256.0), 0, smoothstep(55.0, 20.0, length(mm - vec2f(487.0, 256.0))), t);
    c = mix(c, r2.rgb + c, r2.a * 0.9);               // → the tide record
    // (the door's own chevron-and-orb ornament is the enter button — no UI arrow)
  }
  if (view == 4) {                                    // the record room → back to the gate
    let a = mod_tg_chev(px, vec2f(25.0, 256.0), 1, smoothstep(55.0, 20.0, length(mm - vec2f(25.0, 256.0))), t);
    c = mix(c, a.rgb + c, a.a * 0.9);
  }
  if (view == 2) {
    let a = mod_tg_chev(px, vec2f(25.0, 470.0), 3, smoothstep(55.0, 20.0, length(mm - vec2f(25.0, 470.0))), t);
    c = mix(c, a.rgb + c, a.a * 0.9);
    if (uni(14) > 0.5) {                              // ascend to the lens
      let b = mod_tg_chev(px, vec2f(256.0, 30.0), 2, smoothstep(60.0, 22.0, length(mm - vec2f(256.0, 30.0))), t);
      c = mix(c, b.rgb + c, b.a * 0.9);
    }
  }
  if (view == 3) {
    let a = mod_tg_chev(px, vec2f(60.0, 470.0), 3, smoothstep(55.0, 20.0, length(mm - vec2f(60.0, 470.0))), t);
    c = mix(c, a.rgb + c, a.a * 0.9);
  }
  // click ripple
  let cp = uni(25);
  if (cp > 0.003) {
    let cd = length(px - mm);
    c += vec3f(0.9, 0.85, 0.7) * exp(-pow((cd - (1.0 - cp) * 60.0) * 0.25, 2.0)) * cp * 0.5;
  }
  // finale white bloom breath
  c += vec3f(1.0, 0.95, 0.85) * fin * (1.0 - fin) * 1.2;
  // ── the island's one grade: amber highlights, teal-indigo shadows ──
  c = max(c, vec3f(0.0));
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = mix(vec3f(lum), c, 1.09);                                       // painterly saturation
  c += vec3f(0.030, 0.016, 0.0) * smoothstep(0.30, 1.30, lum);        // gold in the light
  c += vec3f(0.0, 0.010, 0.020) * (1.0 - smoothstep(0.0, 0.30, lum)); // sea-glass in the dark
  c *= 1.0 - 0.16 * dot(uv * 0.72, uv * 0.72);                        // breath of corner shadow
  // gentle grain
  c += (hash21(floor(px * 1.7)) - 0.5) * 0.012;
  return vec4f(max(c, vec3f(0.0)), 1.0);
}
`

// ────────────────────────────────────────────────────────────── the hook ──
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__tg || wd.__tg.v !== 2) wd.__tg = {
    v: 2, view: 0, pv: 0, fade: 0, t: 0,
    dials: [0, 0, 0, 0], pipes: [0, 0, 0, 0, 0],
    door: 0, organ: 0, star: 0, lensA: 0, hold: 0, fin: 0, night: 0, vault: 0,
    clickP: 0, flash: [0, 0, 0, 0], lastToll: -1, act1music: false, musicAct: 0
  }
  const G = wd.__tg
  G.t += dt
  // the observatory's constellation puzzle (view 5) — folded in from LATTICE
  if (!Array.isArray(G.lat)) { G.lat = [0, 0, 0, 0, 0]; G.latBloom = 0 }

  sim.defineChapters(['THE SHORE', 'THE GATE', 'THE ORGAN', 'THE LIGHT'])

  // pin the canvas
  for (const f of sim.fields.values()) {
    if ((f.name || '') === 'Tideglass') { const T = f.transform; T.x = 256; T.y = 256; T.vx = 0; T.vy = 0 }
  }

  const ANSWER_DIALS = [2, 0, 3, 1]      // the toll order
  const ANSWER_PIPES = [3, 1, 4, 2, 0]   // the stele columns (ticks - 1)
  const TONES = [220.0, 293.66, 329.63, 392.0]           // glyph voices
  const PIPE_TONES = [146.83, 164.81, 196.0, 220.0, 246.94]
  const sounds = []

  const mx = wd.mouse_x, my = wd.mouse_y
  const hasMouse = typeof mx === 'number' && typeof my === 'number'
  const inView = v => G.view === v && G.fade < 0.35

  // ── travel ──
  const go = v => { if (v === G.view) return; G.pv = G.view; G.view = v; G.fade = 1; sounds.push({ frequency: 90, duration: 0.35, volume: 0.18, type: 'sine' }) }
  G.fade = Math.max(0, G.fade - dt * 1.8)

  // ── the bells: cycle 11s, four tolls in the answer order ──
  const cyc = G.t % 11
  const slot = Math.floor((cyc - 1.0) / 2.2)
  const inToll = cyc >= 1.0 && (cyc - 1.0) % 2.2 < 0.1
  if (inToll && slot >= 0 && slot < 4 && G.lastToll !== slot) {
    G.lastToll = slot
    const g = ANSWER_DIALS[slot]                       // which buoy speaks
    G.flash[g] = 1
    const vol = inView(0) ? 0.5 : (inView(1) ? 0.16 : 0.05)
    if (vol > 0.06 || G.view === 0) sounds.push(
      { frequency: TONES[g], duration: 1.7, volume: vol, type: 'sine' },
      { frequency: TONES[g] * 2.0, duration: 0.9, volume: vol * 0.3, type: 'sine' })
  }
  if (cyc < 1.0) G.lastToll = -1
  for (let i = 0; i < 4; i++) G.flash[i] = Math.max(0, G.flash[i] - dt * 0.8)

  // ── clicks ──
  G.clickP = Math.max(0, G.clickP - dt * 2.2)
  if (hasMouse && sim.edge('tg-click', !!wd.mouse_down)) {
    G.clickP = 1
    const hit = (x, y, r) => Math.hypot(mx - x, my - y) < r

    if (inView(0)) {
      // MUTUALLY EXCLUSIVE — the right-chevron zone (487,256) and the building
      // zone (440,300) overlap (64px apart), so a bare series fired BOTH: go(5)
      // then go(1), and the finale bounced view 1 back to the shore. else-if =
      // one hit wins, nearest-first.
      if (G.vault > 0.03 && hit(214, 318, 80)) go(5)   // the RISEN dome → the constellation room (only once it's up)
      else if (hit(487, 256, 42)) go(5)                // the right chevron → the constellation room (always)
      else if (hit(440, 300, 60)) go(1)                // the observatory building → the gate
    } else if (inView(5)) {
      if (hit(25, 256, 45)) go(0)                      // back down to the shore
    } else if (inView(1)) {
      if (hit(25, 256, 45)) go(0)
      if (hit(487, 256, 45)) go(4)                    // → the tide record
      if (G.door > 0.9 && hit(256, 184, 75)) go(2)   // the chevron-orb ornament
      // dials at grid (156,409) (222,409) (288,409) (354,409)
      if (G.door < 0.05) for (let k = 0; k < 4; k++) {
        if (hit(156 + k * 66.5, 409, 30)) {
          G.dials[k] = (G.dials[k] + 1) % 4
          sounds.push({ frequency: TONES[G.dials[k]], duration: 0.35, volume: 0.3, type: 'triangle' })
          if (ANSWER_DIALS.every((v, i) => G.dials[i] === v)) {
            sounds.push({ frequency: 55, duration: 2.2, volume: 0.7, type: 'sine' },
                        { frequency: 110, duration: 1.6, volume: 0.35, type: 'sine' },
                        { frequency: TONES[0], duration: 1.8, volume: 0.2, type: 'sine' })
            G.doorGo = true
          }
        }
      }
    } else if (inView(2)) {
      if (hit(25, 470, 45)) go(1)
      if (G.organ > 0.5 && hit(256, 30, 50)) go(3)
      // pipes at x 130.5 + k*62.7, wide zone
      if (G.organ < 0.5) for (let k = 0; k < 5; k++) {
        const cx = 130.5 + k * 62.7
        if (Math.abs(mx - cx) < 28 && my > 160 && my < 430) {
          G.pipes[k] = (G.pipes[k] + 1) % 5
          sounds.push({ frequency: PIPE_TONES[G.pipes[k]], duration: 0.8, volume: 0.35, type: 'triangle' },
                      { frequency: PIPE_TONES[G.pipes[k]] * 2, duration: 0.4, volume: 0.10, type: 'sine' })
          if (ANSWER_PIPES.every((v, i) => G.pipes[i] === v)) {
            sounds.push({ frequency: 146.83, duration: 2.6, volume: 0.5, type: 'sine' },
                        { frequency: 220.0, duration: 2.6, volume: 0.4, type: 'sine' },
                        { frequency: 293.66, duration: 2.6, volume: 0.35, type: 'sine' },
                        { frequency: 369.99, duration: 2.6, volume: 0.3, type: 'sine' })
            G.organGo = true
          }
        }
      }
    } else if (inView(3)) {
      if (hit(60, 470, 45)) go(2)
    } else if (inView(4)) {
      if (hit(25, 256, 45)) go(1)
    }
  }

  // ── door + organ animations, chapter advancement ──
  if (G.doorGo) G.door = Math.min(1, G.door + dt * 0.4)
  if (sim.trigger('tg-gate', G.door >= 1)) sim.completeChapter()
  if (G.organGo) { G.organ = Math.min(1, G.organ + dt * 0.5); G.star = Math.min(1, G.star + dt * 0.35) }
  if (sim.trigger('tg-organ', G.organ >= 1)) sim.completeChapter()

  // ── the lens ──
  if (inView(3) && G.fin < 0.5) {
    if (hasMouse && wd.mouse_down) {
      const dx = mx - 256, dyUp = 430 - my
      if (dyUp > 20) {
        const az = Math.max(-1.15, Math.min(1.15, Math.atan2(dx, dyUp)))
        G.lensA += (az - G.lensA) * Math.min(1, dt * 5)
      }
    }
    const aligned = Math.abs(G.lensA - 0.25) < 0.075
    if (aligned) {
      const was = Math.floor(G.hold * 5)
      G.hold = Math.min(1, G.hold + dt / 2.4)
      if (Math.floor(G.hold * 5) > was) sounds.push({ frequency: 440 + G.hold * 440, duration: 0.15, volume: 0.2, type: 'sine' })
    } else G.hold = Math.max(0, G.hold - dt * 0.6)
    if (sim.trigger('tg-lens', G.hold >= 1)) {
      G.fin = 0.0001; sim.completeChapter()
      sounds.push({ frequency: 73.42, duration: 4.0, volume: 0.6, type: 'sine' },
                  { frequency: 146.83, duration: 4.0, volume: 0.45, type: 'sine' },
                  { frequency: 220.0, duration: 4.0, volume: 0.4, type: 'sine' },
                  { frequency: 293.66, duration: 4.0, volume: 0.35, type: 'sine' },
                  { frequency: 440.0, duration: 3.0, volume: 0.2, type: 'sine' })
    }
  }

  // ── finale: return to a transformed shore ──
  if (G.fin > 0) {
    G.fin = Math.min(1, G.fin + dt / 3.5)
    if (G.fin > 0.35 && G.view !== 0 && G.view !== 5) go(0)   // the night lets you linger in the observatory
    G.night = Math.min(1, G.night + dt / 6)
    if (G.fin > 0.6) G.vault = Math.min(1, G.vault + dt / 8)
  }

  // ── music: one score per era, brightness follows the place ──
  const era = G.fin > 0.5 ? 2 : (G.organ > 0.5 ? 1 : 0)
  if (G.musicAct !== era + 1) {
    G.musicAct = era + 1
    if (era === 0) wd.__play_music = { score: { bpm: 54, loop: true, gain: 0.30, tracks: [
      { inst: 'sine', gain: 0.5, cutoff: 320, a: 1.2, d: 2.5, notes: 'A2 . . . . . . . E2 . . . . . . . F2 . . . . . . . E2 . . . . . . .' },
      { inst: 'triangle', gain: 0.14, cutoff: 700, a: 0.8, d: 2.0, notes: '. . . . A3+C4 . . . . . . . . . . . . . . . G3+B3 . . . . . . . . . . .' },
    ] } }
    if (era === 1) wd.__play_music = { score: { bpm: 58, loop: true, gain: 0.34, tracks: [
      { inst: 'sine', gain: 0.5, cutoff: 380, a: 1.0, d: 2.2, notes: 'D2 . . . . . . . A2 . . . . . . . B2 . . . . . . . A2 . . . . . . .' },
      { inst: 'triangle', gain: 0.18, cutoff: 900, a: 0.5, d: 1.6, notes: '. . D4 . . . F#4 . . . . . A4 . . . . . B3 . . . D4 . . . . . . . . .' },
    ] } }
    if (era === 2) wd.__play_music = { score: { bpm: 64, loop: true, gain: 0.38, swing: 0.05, tracks: [
      { inst: 'sine', gain: 0.5, cutoff: 420, a: 0.8, d: 2.0, notes: 'D2 . . . A2 . . . B2 . . . F#2 . . . G2 . . . D2 . . . G2 . . . A2 . . .' },
      { inst: 'triangle', gain: 0.2, cutoff: 1200, a: 0.3, d: 1.2, notes: 'D4 . F#4 . A4 . B4 . A4 . F#4 . D4 . E4 . D4 . F#4 . A4 . D5 . A4 . F#4 . E4 . D4 .' },
      { inst: 'sawtooth', gain: 0.06, cutoff: 600, a: 1.5, d: 2.5, notes: 'D3+F#3+A3 . . . . . . . G3+B3+D4 . . . . . . . B2+D3+F#3 . . . . . . . A2+C#3+E3 . . . . . . .' },
    ] } }
  }
  // ── the observatory constellation (view 5): weave near a star to kindle it ──
  if (G.latSolved) {
    for (let i = 0; i < 5; i++) G.lat[i] = 1   // locked in — it holds, gold, forever
    G.latBloom = 1
  } else if (G.view === 5) {
    const AX = [0, -0.6, 0.6, 0, 0]
    const AY = [0, 0, 0, -0.6, 0.6]
    const cux = hasMouse ? (mx - 256) / 256 : -99
    const cuy = hasMouse ? (my - 256) / 256 : -99
    let lit = 0
    for (let i = 0; i < 5; i++) {
      const d = Math.hypot(cux - AX[i], cuy - AY[i])
      if (hasMouse && d < 0.22) G.lat[i] = Math.min(1, G.lat[i] + 0.06)
      else G.lat[i] = Math.max(0, G.lat[i] - 0.0035)
      if (G.lat[i] > 0.6) lit++
    }
    G.latBloom = lit >= 5 ? Math.min(1, (G.latBloom || 0) + 0.02) : Math.max(0, (G.latBloom || 0) - 0.01)
    if (sim.trigger('tg-lattice', lit >= 5)) {
      G.latSolved = 1                                                    // it locks
      sounds.push({ frequency: 264, duration: 1.6, volume: 0.34, type: 'sine' })
      sounds.push({ frequency: 528, duration: 1.8, volume: 0.30, type: 'sine' })   // a fifth — the vault answers
    }
  } else {
    // fade the weave when you leave the room, so re-entry starts calm
    for (let i = 0; i < 5; i++) G.lat[i] = Math.max(0, G.lat[i] - dt * 0.5)
    G.latBloom = Math.max(0, (G.latBloom || 0) - dt * 0.5)
  }
  // solving the constellation raises the vault-dome from the sea — a space opens
  if (G.latSolved) G.vault = Math.min(1, (G.vault || 0) + dt / 7)

  wd.music_mod = { brightness: 0.25 + (G.view === 0 ? 0.35 : G.view === 3 ? 0.3 : 0.12) + G.fin * 0.3, gain: 1 }
  if (sounds.length) wd.__play_sound = sounds

  // ── publish the whiteboard ──
  const U = new Array(40).fill(0)
  U[0] = G.view; U[1] = G.pv; U[2] = G.fade; U[3] = G.t
  for (let i = 0; i < 4; i++) U[4 + i] = G.dials[i]
  U[8] = G.door
  for (let i = 0; i < 5; i++) U[9 + i] = G.pipes[i] / 4
  U[14] = G.organ; U[15] = G.lensA; U[16] = G.hold; U[17] = G.fin
  U[18] = G.door > 0 ? 1 : 0
  for (let i = 0; i < 4; i++) U[19 + i] = G.flash[i]
  U[23] = G.night; U[24] = sim.act; U[25] = G.clickP; U[26] = G.vault
  U[27] = hasMouse ? mx : -100; U[28] = hasMouse ? my : -100
  U[29] = G.star; U[30] = (hasMouse && wd.mouse_down) ? 1 : 0
  U[31] = Math.max(G.organ, G.door * 0.25)
  U[32] = G.latBloom || 0
  for (let i = 0; i < 5; i++) U[33 + i] = G.lat[i]
  U[38] = G.latSolved ? 1 : 0
  wd.gpuUniforms = U
} catch (e) { /* the island keeps its silence */ }
`

// ─────────────────────────────────────────────────────────────── build ──
const INSTRUCTIONS = [
  'CLICK — turn dials, work levers, travel (chevrons at the screen edges)',
  'DRAG — aim the great lens',
  '',
  'No words will help you. Watch the bells. Read the stone. Match the sky.',
  'Wake the vault from the sea.',
].join('\n')

async function main() {
  // ONE atomic batch: separate POSTs raced each other to a live tab (module
  // arriving after the visual that calls it → mid-burst quarantine). A single
  // commands array rides one lambda, one SSE replay, in order.
  await send([
    // no bespoke icon_wgsl: the shelf auto-composes from the visual + modules
    { type: 'set_world_data', data: { built_by: 'Claude Fable 5', singlePlayer: true, instructions: INSTRUCTIONS } },
    { type: 'set_world_params', params: { gravity: 0, friction: 0.95, collisionForce: 0, boundaryMode: 'open', gravitationalConstant: 0 } },
    { type: 'define_module', name: 'tg_lib', wgsl: MODULES },
    { type: 'define_module', name: 'tg_views', wgsl: VIEWS },
    { type: 'define_visual', name: 'tideglass', wgsl: VISUAL },
  ], 'atomic world batch')
  const st = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  const existing = (st.fields || []).find(f => f.name === 'Tideglass')
  if (!existing) {
    await send({
      type: 'create_field', name: 'Tideglass', shape: 'rect', x: 256, y: 256, width: 512, height: 512,
      visualType: 'tideglass', color: [0.05, 0.08, 0.12, 1], noHit: true,
    }, 'field')
  }
  const st2 = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  const fld = (st2.fields || []).find(f => f.name === 'Tideglass')
  if (fld) await send({ type: 'set_property', fieldId: fld.id, key: 'superimpose', value: true }, 'superimpose')
  await send({ type: 'add_step_hook', hookId: 'tideglass_core', author: 'Claude Fable 5', description: 'TIDEGLASS: views, bells, dials, organ, lens, finale', code: HOOK }, 'hook')
  await send({ type: 'set_world_data', data: { postProcess: { bloomIntensity: 0.34, bloomThreshold: 0.72, exposure: 1.05, vignetteStrength: 0.34, vignetteRadius: 0.82 } } }, 'post')

  // verify
  const v = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  console.log('VERIFY fields:', (v.fields || []).map(f => f.name),
    '| hooks:', (v.stepHooks || []).map(h => h.id),
    '| visuals:', (v.visualTypes || []).map(x => x.name),
    '| modules:', (v.modules || []).map(x => x.name))
}
main().catch(e => { console.error(e); process.exit(1) })
