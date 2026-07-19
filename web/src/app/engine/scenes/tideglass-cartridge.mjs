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
  c += mod_tgo_suncol(el) * pow(sdot, 5.0) * 0.34 * sunUp;
  c += mod_tgo_suncol(el) * pow(sdot, 70.0) * 0.60 * sunUp;
  c += vec3f(5.2, 3.6, 2.0) * smoothstep(0.99972, 0.99990, sdot) * sunUp;
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
fn mod_tgo_ic() -> vec2f { return vec2f(9.5, 26.0); }   // the island's rock in sea space
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
  var col = mix(refracted, reflected, fres);
  let atten = max(1.0 - dot(dist, dist) * 0.001, 0.0);
  col = col + waterCol * (p.y - 0.6) * 0.18 * atten;
  // sun glitter at dusk; at finale-night the vault-lamp takes the water
  col = col + mod_tgo_suncol(el) * vec3f(2.4, 1.5, 0.8) * mod_tgo_spec(n, sd, eye, 90.0) * smoothstep(-0.08, 0.05, el);
  col = col + vec3f(0.55, 1.05, 1.25) * mod_tgo_spec(n, md, eye, 140.0) * night * smoothstep(0.0, 0.15, md.y) * 1.7;
  // crest foam
  let foamN = vnoise(p.xz * 2.2 + vec2f(t * 0.5, -t * 0.35));
  let crest = smoothstep(1.00, 1.50, p.y) * smoothstep(0.42, 0.85, foamN);
  col = mix(col, vec3f(0.90, 0.82, 0.72) * (0.25 + 0.75 * day), crest * atten * 0.4);
  // surf ring around the island rock
  let drf = length(p.xz - mod_tgo_ic()) - 5.0;
  let ph = sin(st * 1.3 - (drf + 5.0) * 0.9) * 0.5 + 0.5;
  var rockFoam = smoothstep(3.0, 0.2, drf) * (0.35 + 0.65 * ph);
  rockFoam = rockFoam * (0.45 + 0.55 * vnoise(p.xz * 2.6 + vec2f(st * 0.8, -st * 0.55)));
  col = mix(col, vec3f(0.90, 0.88, 0.84) * (0.3 + 0.7 * day + 0.25 * night), clamp(rockFoam, 0.0, 1.0) * 0.8);
  return col;
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
    }
  }
  // ── THE RISEN VAULT (finale): a glass dome breaching the sea ──
  if (vault > 0.001) {
    let vy = horizon + 0.02 - vault * 0.16;         // rises out of the water
    let vp = (p - vec2f(-0.15, vy + 0.16)) / 0.20;
    let dome = length(vp * vec2f(1.0, 1.6)) - 1.0;
    if (dome < 0.0 && p.y < vy + 0.16) {
      let nrm = clamp(-dome * 2.0, 0.0, 1.0);
      var vc = mix(vec3f(0.10, 0.20, 0.26), vec3f(0.55, 0.95, 1.05), pow(nrm, 2.0));
      vc += vec3f(0.9, 0.8, 0.5) * mod_tg_glyph(2, vp * 2.4) * (0.6 + 0.4 * sin(t * 1.7));
      // latitude ribs
      vc *= 1.0 - 0.25 * step(0.42, abs(fract(vp.y * 3.0) - 0.5));
      c = mix(c, vc * (0.4 + vault), vault * smoothstep(0.02, -0.04, dome));
    }
    // near halo where it breaches (the sea itself carries its glitter via the lamp)
    let lx = p.x + 0.15;
    c += vec3f(0.30, 0.70, 0.90) * exp(-lx * lx * 22.0) * smoothstep(horizon, horizon + 0.22, p.y) * smoothstep(horizon + 0.45, horizon + 0.1, p.y) * vault * 0.25;
  }
  // ── the island: a coastal skyline silhouette, right side ──
  let ix = clamp((p.x - 0.42) / 0.70, 0.0, 1.0);
  let hump = sin(ix * 3.14159) * (0.9 + 0.25 * sin(ix * 9.0));
  let ridge = fbm(vec2f(p.x * 7.0, 3.7), 2) * 0.035;
  let skyline = horizon - hump * 0.105 - ridge * step(0.01, hump);
  let towerX = 0.74;
  let towerTop = horizon - 0.30;
  let towerD = sdBox(p - vec2f(towerX, (towerTop + horizon - 0.09) * 0.5), vec2f(0.022, (horizon - 0.09 - towerTop) * 0.5));
  let domeD = length((p - vec2f(towerX, towerTop)) * vec2f(1.0, 1.15)) - 0.038;
  let onIsland = step(0.44, p.x) * step(skyline, p.y) * step(p.y, horizon + 0.015);
  let isl = min(min(towerD, domeD), mix(1.0, -0.01, onIsland));
  // dark wobbling base-reflection where the rock meets the water
  if (p.x > 0.44 && p.y > horizon + 0.012 && p.y < horizon + 0.14) {
    let wob2 = 0.6 + 0.4 * sin(p.y * 70.0 + p.x * 8.0 + t * 1.1);
    c = mix(c, vec3f(0.020, 0.018, 0.026), smoothstep(horizon + 0.14, horizon + 0.02, p.y) * 0.75 * wob2 * smoothstep(0.44, 0.60, p.x));
  }
  if (isl < 0.0) {
    var ic = mod_tg_rock(p * 3.0, vec3f(0.055, 0.048, 0.055)) * (0.9 - night * 0.35);
    // dusk rim along the skyline + the sunward (left) flank
    let rimTop = smoothstep(0.022, 0.0, p.y - skyline) * step(onIsland, 0.5 + step(towerD, 0.0) + step(domeD, 0.0));
    ic += mix(vec3f(0.85, 0.38, 0.14), vec3f(0.20, 0.28, 0.48), night) * smoothstep(0.020, 0.0, abs(p.y - skyline)) * 0.8;
    if (towerD < 0.0) {
      ic = mod_tg_rock(vec2f(p.x * 8.0, p.y * 3.0), vec3f(0.075, 0.062, 0.058)) * (1.0 - night * 0.3);
      ic += mix(vec3f(0.75, 0.34, 0.13), vec3f(0.22, 0.30, 0.50), night) * smoothstep(0.014, 0.0, p.x - (towerX - 0.022)) * 0.55;
      // two lit windows
      let w1 = sdBox(p - vec2f(towerX, towerTop + 0.075), vec2f(0.007, 0.014));
      let w2 = sdBox(p - vec2f(towerX, towerTop + 0.135), vec2f(0.007, 0.014));
      ic += vec3f(1.5, 0.95, 0.4) * (smoothstep(0.005, -0.003, w1) + smoothstep(0.005, -0.003, w2));
    }
    if (domeD < 0.0) {
      ic = mix(vec3f(0.10, 0.16, 0.17), vec3f(0.30, 0.52, 0.54), clamp(-domeD * 18.0, 0.0, 1.0));
      ic += vec3f(0.4, 0.95, 0.95) * exp(-abs(domeD) * 60.0) * (0.35 + night * 0.85);
    }
    c = mix(c, ic, 1.0);
  }
  // dome beacon halo + reflections of tower light on the sea
  c += vec3f(0.35, 0.85, 0.85) * exp(-dot(p - vec2f(towerX, towerTop), p - vec2f(towerX, towerTop)) * 260.0) * (0.25 + night * 0.9);
  if (p.y > horizon) {
    let sx2 = p.x - towerX;
    let wob = 0.75 + 0.25 * sin(p.y * 55.0 + t * 1.3);
    c += vec3f(0.9, 0.6, 0.25) * exp(-sx2 * sx2 * 1400.0) * smoothstep(horizon + 0.30, horizon, p.y) * 0.20 * wob * (1.0 - night * 0.5);
    c += vec3f(0.25, 0.6, 0.6) * exp(-sx2 * sx2 * 2000.0) * smoothstep(horizon + 0.45, horizon, p.y) * 0.18 * wob * (0.4 + night);
  }
  // ── four bell-buoys on the swell ──
  for (var k = 0; k < 4; k++) {
    let fk = f32(k);
    let bx = -0.68 + fk * 0.30;
    let bob = sin(t * 0.8 + fk * 1.9) * 0.012;
    let bp = p - vec2f(bx, 0.40 + bob);
    let hull = length(bp * vec2f(1.0, 2.4)) - 0.045;
    let mast = sdBox(bp + vec2f(0.0, 0.055), vec2f(0.006, 0.045));
    let flash = uni(19 + k);
    if (min(hull, mast) < 0.0) {
      var bc = vec3f(0.05, 0.045, 0.05);
      bc += mix(vec3f(0.8, 0.35, 0.12), vec3f(0.1, 0.12, 0.2), uni(23)) * smoothstep(0.01, -0.02, hull) * 0.4;
      c = mix(c, bc, smoothstep(0.004, -0.004, min(hull, mast)));
    }
    // the lantern-glyph above the mast
    let gcol = mod_tg_gcol(k);
    let gp = (bp - vec2f(0.0, -0.135)) / 0.055;
    if (abs(gp.x) < 1.4 && abs(gp.y) < 1.4) {
      let g = mod_tg_glyph(k, gp);
      c = mix(c, gcol * (0.9 + flash * 2.6), g * 0.95);
    }
    // toll halo + reflection streak
    c += gcol * exp(-dot(bp - vec2f(0.0, -0.135), bp - vec2f(0.0, -0.135)) * 240.0) * flash * 2.2;
    let sx = p.x - bx;
    c += gcol * exp(-sx * sx * 900.0) * smoothstep(0.42, 0.75, p.y) * (0.10 + flash * 0.55) * 0.8;
  }
  // ── the stele, foreground left: five carved tick-columns (organ answer) ──
  let sp2 = p - vec2f(-0.66, 0.72);
  let steleD = sdRoundedBox(sp2, vec2f(0.165, 0.30), 0.03);
  if (steleD < 0.0) {
    var sc2 = mod_tg_rock(p * 4.0 + vec2f(9.0), vec3f(0.115, 0.105, 0.10));
    sc2 *= 0.85 + 0.3 * smoothstep(0.0, -0.1, steleD);
    // carve: columns k=0..4, ticks = answer[k]+1  (answer 3,1,4,2,0)
    for (var k = 0; k < 5; k++) {
      var ticks = 1; // level 0 -> 1 tick
      if (k == 0) { ticks = 4; } else if (k == 1) { ticks = 2; } else if (k == 2) { ticks = 5; } else if (k == 3) { ticks = 3; }
      let cx = -0.112 + f32(k) * 0.056;
      for (var j = 0; j < 5; j++) {
        if (j >= ticks) { continue; }
        let tickP = sp2 - vec2f(cx, 0.20 - f32(j) * 0.085);
        let td = sdBox(tickP, vec2f(0.017, 0.013));
        let carve = smoothstep(0.008, -0.004, td);
        sc2 = mix(sc2, vec3f(0.045, 0.05, 0.05), carve * 0.85);
        sc2 += vec3f(0.20, 0.75, 0.65) * carve * (0.22 + 0.12 * max(sin(t * 0.9 + f32(k)), -0.9));
      }
    }
    // top glyph row: the four tide glyphs, a key
    for (var k = 0; k < 4; k++) {
      let gp2 = (sp2 - vec2f(-0.084 + f32(k) * 0.056, -0.235)) / 0.026;
      if (abs(gp2.x) < 1.3 && abs(gp2.y) < 1.3) {
        sc2 = mix(sc2, mod_tg_gcol(k) * 0.5, mod_tg_glyph(k, gp2) * 0.55);
      }
    }
    sc2 += vec3f(0.9, 0.5, 0.2) * smoothstep(0.02, -0.01, abs(steleD + 0.012)) * (1.0 - uni(23)) * 0.25;
    c = mix(c, sc2, smoothstep(0.005, -0.005, steleD));
  }
  return c;
}

fn mod_tg_gate(p: vec2f, px: vec2f, t: f32) -> vec3f {
  let open = uni(8);
  // cliff face
  var c = mod_tg_rock(p * 2.2, vec3f(0.085, 0.080, 0.088));
  c *= 0.55 + 0.45 * exp(-dot(p - vec2f(0.0, -0.1), p - vec2f(0.0, -0.1)) * 0.8);
  // dusk light falls from the upper left
  c += vec3f(0.55, 0.28, 0.14) * exp(-(p.x + 0.9) * (p.x + 0.9) * 0.8) * exp(-(p.y + 0.9) * (p.y + 0.9) * 0.9) * 0.5;
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
      // the revealed passage — a warm throat receding into the rock
      var pc = vec3f(0.008, 0.009, 0.013);
      let deep = pow(clamp(1.0 - rr / R, 0.0, 1.0), 1.7);
      pc += vec3f(0.55, 0.30, 0.11) * deep * open;
      pc *= 0.72 + 0.28 * sin(rr * 34.0 - t * 0.5);              // depth rings
      pc += vec3f(1.1, 0.62, 0.22) * exp(-dot(dp, dp) * 9.0) * open * 0.8;  // the far light
      let mote = hash21(floor(dp * 150.0 + vec2f(0.0, t * 2.0)));
      pc += vec3f(1.1, 0.75, 0.35) * step(0.9935, mote) * open * deep * 0.35;
      // shadowed lip where the iris withdrew
      pc *= smoothstep(0.0, 0.05, ird);
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
      // key light upper-left, ambient falls off to the rim
      bc *= 0.42 + 0.85 * clamp(0.55 - dp.x * 0.8 - dp.y * 0.8, 0.0, 1.2);
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
    if (r < 0.115) {
      var kc = mix(vec3f(0.30, 0.21, 0.10), vec3f(0.13, 0.17, 0.15), fbm(q * 30.0, 2) * 0.7);
      kc *= 0.8 + 0.5 * sin(r * 120.0);
      let gi = i32(uni(4 + k) + 0.5);
      let gp = q / 0.062;
      kc = mix(kc, mod_tg_gcol(gi) * (0.9 + uni(18) * 1.4), mod_tg_glyph(gi, gp) * 0.95);
      // hover ring
      let mm = vec2f(uni(27), uni(28));
      let mh = smoothstep(60.0, 22.0, length(mm - (dc * 0.5 + 0.5) * 512.0));
      kc += vec3f(1.1, 0.95, 0.6) * smoothstep(0.012, 0.0, abs(r - 0.100)) * (0.25 + mh * 0.8 + uni(18) * 0.6);
      c = mix(c, kc, smoothstep(0.006, -0.006, r - 0.112));
    }
  }
  // solved: gold seam light around everything
  c += vec3f(1.2, 0.85, 0.35) * smoothstep(0.03, 0.0, abs(length(dp) - R * (1.0 - open * 0.94))) * open * (1.0 - open) * 2.2;
  return c;
}

fn mod_tg_hall(p: vec2f, px: vec2f, t: f32) -> vec3f {
  let lit = uni(31);            // 0 dim → 1 solved blaze
  let solved = uni(14);
  // stone interior, floor below y=0.62
  var c = mod_tg_rock(p * 2.0 + vec2f(20.0), vec3f(0.075, 0.070, 0.080));
  if (p.y > 0.62) {
    c = mod_tg_rock(vec2f(p.x * 2.0, p.y * 6.0), vec3f(0.09, 0.082, 0.078)) * (1.1 - (p.y - 0.62) * 0.8);
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
  // ── horizon silhouette ──
  c = mix(c, vec3f(0.012, 0.012, 0.02), smoothstep(0.60, 0.66, p.y));
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
  // hold-progress ring
  let hold = uni(16);
  if (hold > 0.001) {
    let pr = polar(lq / 0.22);
    let sweep = step(pr.y / 6.28318 + 0.5, hold);
    c += vec3f(0.8, 0.7, 1.3) * smoothstep(0.05, 0.0, abs(pr.x - 1.0)) * sweep * 1.4;
  }
  return c;
}

fn mod_tg_scene(view: i32, p: vec2f, px: vec2f, t: f32) -> vec3f {
  if (view == 1) { return mod_tg_gate(p, px, t); }
  if (view == 2) { return mod_tg_hall(p, px, t); }
  if (view == 3) { return mod_tg_lens(p, px, t); }
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
  if (view == 0 && fin < 0.5) {                       // shore → gate
    let a = mod_tg_chev(px, vec2f(487.0, 256.0), 0, smoothstep(55.0, 20.0, length(mm - vec2f(487.0, 256.0))), t);
    c = mix(c, a.rgb + c, a.a * 0.9);
  }
  if (view == 1) {
    let a = mod_tg_chev(px, vec2f(25.0, 256.0), 1, smoothstep(55.0, 20.0, length(mm - vec2f(25.0, 256.0))), t);
    c = mix(c, a.rgb + c, a.a * 0.9);
    if (uni(8) > 0.9) {                               // enter the open door
      let b = mod_tg_chev(px, vec2f(256.0, 250.0), 2, smoothstep(70.0, 25.0, length(mm - vec2f(256.0, 250.0))), t);
      c = mix(c, b.rgb + c, b.a * 0.9);
    }
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
      if (hit(487, 256, 45) && G.fin < 0.5) go(1)
      if (G.fin >= 0.5 && hit(487, 256, 45)) go(1)     // free travel after the end
    } else if (inView(1)) {
      if (hit(25, 256, 45)) go(0)
      if (G.door > 0.9 && hit(256, 250, 70)) go(2)
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
    if (G.fin > 0.35 && G.view !== 0) go(0)
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
  wd.music_mod = { brightness: 0.25 + (G.view === 0 ? 0.35 : G.view === 3 ? 0.3 : 0.12) + G.fin * 0.3, gain: 1 }
  if (sounds.length) wd.__play_sound = sounds

  // ── publish the whiteboard ──
  const U = new Array(32).fill(0)
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
  await send({ type: 'set_world_data', data: { built_by: 'Claude Fable 5', singlePlayer: true, instructions: INSTRUCTIONS } }, 'world_data')
  await send({ type: 'set_world_params', params: { gravity: 0, friction: 0.95, collisionForce: 0, boundaryMode: 'open', gravitationalConstant: 0 } }, 'world_params')
  await send({ type: 'define_module', name: 'tg_lib', wgsl: MODULES }, 'module tg_lib')
  await send({ type: 'define_module', name: 'tg_views', wgsl: VIEWS }, 'module tg_views')
  await send({ type: 'define_visual', name: 'tideglass', wgsl: VISUAL }, 'visual tideglass')
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
