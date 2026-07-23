// ALEMBIC — an alchemy of living matter. The whole world is the inside of a
// glass still. Four primal elements breathe in from the walls as REAL FIELDS;
// drag anything into anything, and where two fields touch, the hook consumes
// them and births a new species at the point of contact. Sixteen fusions hide
// in the vessel — like refuses like unless THROWN. Discovery is the game.
//
// This is the engine's compositional showcase: ~54 pooled fields with per-field
// visuals and state, hook-owned motion, contact chemistry, flare births, tones,
// a codex HUD — and every control is a pointer, so it belongs to the mobile
// shelf the day that door opens. Save+load: node alembic-cartridge.mjs
//
// WGSL notes: uv is -1..1 per field cell with y DOWN (uv.y=-1 is the top);
// `behind` is the composited color beneath this field — dew and glass use it
// to be genuinely transparent. Helper fns are suffixed per species because the
// uber-shader concatenates every visual into one module.

// ── shared noise library (module): real value noise + rotated-octave fbm +
// domain warp — the difference between interference patterns and turbulence ──
const NOISELIB = /* wgsl */`
fn mod_alhash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn mod_alnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mod_alhash(i); let b = mod_alhash(i + vec2f(1.0, 0.0));
  let c = mod_alhash(i + vec2f(0.0, 1.0)); let d = mod_alhash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn mod_alfbm(p0: vec2f) -> f32 {
  var p = p0; var amp = 0.5; var s = 0.0;
  for (var i = 0; i < 4; i++) {
    s += amp * mod_alnoise(p);
    p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p;
    amp *= 0.5;
  }
  return s;
}
fn mod_alwarp(p: vec2f, t: f32) -> f32 {
  let q = mod_alfbm(p + vec2f(t * 0.4, -t * 0.9));
  return mod_alfbm(p + vec2f(q * 1.7, q * 1.2) + vec2f(-t * 0.2, -t * 1.3));
}`

// ── the vessel: glass interior — hearth-light, caustics, rising bubbles ──
const VESSEL = /* wgsl */`
fn fbm_vs(p0: vec2f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var i = 0; i < 3; i++) {
    s += a * sin(p.x + sin(p.y * 1.7)) * sin(p.y + sin(p.x * 1.3));
    p = p * 2.03 + vec2f(1.7, 9.2); a *= 0.55;
  }
  return s;
}
fn visual_vessel(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  // interior: warm dusk at the base rising to cool glass dark at the throat
  var col = mix(vec3f(0.020, 0.024, 0.042), vec3f(0.085, 0.056, 0.032), (uv.y + 1.0) * 0.5);
  col += vec3f(0.11, 0.065, 0.028) * pow(max(0.0, uv.y - 0.15), 1.6);   // hearth pools below
  // curved glass: fresnel rim brightening toward the walls, breathing slowly
  let wallD = max(abs(uv.x), abs(uv.y));
  let rim = smoothstep(0.82, 1.0, wallD);
  col += vec3f(0.14, 0.17, 0.20) * rim * (0.7 + 0.15 * sin(t * 0.21 + uv.y * 2.4));
  col += vec3f(0.30, 0.34, 0.38) * smoothstep(0.965, 1.0, wallD);       // the glass edge itself
  // floor caustics — light through liquid, slow interference weave
  let cy = smoothstep(0.45, 1.0, uv.y);
  let weave = sin(uv.x * 11.0 + t * 0.5 + sin(uv.x * 5.0 - t * 0.34) * 1.6) * sin(uv.x * 7.0 - t * 0.42);
  col += vec3f(0.10, 0.085, 0.05) * cy * smoothstep(0.1, 0.9, weave);
  // micro-bubbles climbing the walls (columns of fract-time beads)
  for (var i = 0; i < 4; i++) {
    let fi = f32(i);
    let bx = select(-0.9 + fi * 0.055, 0.9 - (fi - 2.0) * 0.055, i >= 2);
    let cyc = fract(t * (0.05 + fi * 0.013) + fi * 0.37);
    let bpos = vec2f(bx + 0.02 * sin(t * 0.6 + fi), 0.95 - cyc * 1.85);
    let bd = uv - bpos;
    col += vec3f(0.20, 0.24, 0.28) * exp(-dot(bd, bd) * 3200.0) * sin(cyc * 3.14159);
  }
  // drifting motes in the body of the liquid
  let n = fbm_vs(uv * 3.0 + vec2f(t * 0.02, -t * 0.013));
  col += vec3f(0.030, 0.028, 0.022) * smoothstep(0.3, 0.9, n);
  // the cursor is a lens-light moving through the glass
  let mp = vec2f(uni(0), uni(1));
  let md = uv - mp;
  col += vec3f(0.06, 0.05, 0.033) * exp(-dot(md, md) * 8.0);
  // ── the vessel answers its contents: cast light, floor gleam, shadow ──
  // (the hook publishes every element: x, y, class, glow — from uni(3))
  let cnt = i32(uni(2) + 0.5);
  let FLOORY = 0.898;
  for (var e = 0; e < 20; e++) {
    if (e >= cnt) { break; }
    let ex = uni(3 + e * 4);
    let ey = uni(4 + e * 4);
    let cls = i32(uni(5 + e * 4) + 0.5);
    let glow = uni(6 + e * 4);
    let d2 = dot(uv - vec2f(ex, ey), uv - vec2f(ex, ey));
    // each thing lights the room in its own color
    var lc = vec3f(0.0);
    if (cls == 1) { lc = vec3f(1.0, 0.42, 0.10); }        // fire: warm
    else if (cls == 2) { lc = vec3f(0.22, 0.45, 0.75); }  // water: cool
    else if (cls == 3) { lc = vec3f(0.45, 0.5, 0.9); }    // storm: cold
    else if (cls == 4) { lc = vec3f(1.0, 0.85, 0.45); }   // star: golden
    else if (cls == 5) { lc = vec3f(0.16, 0.15, 0.14); }  // solids: only a dull gleam
    if (cls >= 1 && cls <= 4) {
      col += lc * glow * 0.085 / (0.06 + d2 * 7.0);
    }
    // the polished floor: a smeared gleam of everything above it
    if (uv.y > FLOORY - 0.012) {
      let ry = 2.0 * FLOORY - ey;
      let rd = vec2f((uv.x - ex) * 1.7, (uv.y - ry) * 0.75);
      col += lc * glow * 0.4 * exp(-dot(rd, rd) * 26.0);
    }
    // contact shadow pooled beneath, fading with height
    let h = max(0.0, FLOORY - ey);
    let sd = vec2f((uv.x - ex) * (2.4 + h * 3.0), (uv.y - (FLOORY + 0.04)) * 10.0);
    col *= 1.0 - 0.45 * exp(-dot(sd, sd)) / (1.0 + h * 7.0);
  }
  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.01); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}`

// ── EMBER: a live coal wearing a small flame (up is -y) ──
const W_EMBER = /* wgsl */`
fn visual_ember(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let heat0 = select(clamp(params.x, 0.05, 1.0), 1.0, params.x <= 0.0);   // life of the fire
  let t2 = time * (0.6 + 0.75 * heat0);
  var p = vec2f(uv.x, uv.y + 0.14);
  // rising turbulence bends the tongue; finer noise erodes its edge
  let w1 = mod_alfbm(p * 2.6 + vec2f(0.0, t2 * 1.8));
  let w2 = mod_alfbm(p * 5.2 + vec2f(3.7, t2 * 2.7));
  p.x += (w1 - 0.5) * 0.34 * (0.6 - p.y * 0.4);
  let env = length(vec2f(p.x * (1.6 - p.y * 0.5), (p.y - 0.02) * 1.02));
  var flame = clamp(((0.28 + 0.32 * heat0) - env) * 2.3 + (w2 - 0.5) * 0.65 * heat0, 0.0, 1.0);
  let heat = flame * (1.15 + (w1 - 0.5) * 0.5);
  // blackbody ramp: deep red -> orange -> yellow -> near white
  var col = mix(vec3f(0.32, 0.015, 0.0), vec3f(0.95, 0.30, 0.02), clamp(heat * 1.7, 0.0, 1.0));
  col = mix(col, vec3f(1.0, 0.74, 0.22), clamp(heat * 1.7 - 0.6, 0.0, 1.0));
  col = mix(col, vec3f(1.0, 0.96, 0.82), clamp(heat * 1.7 - 1.2, 0.0, 1.0));
  // the coal: rocky lit mass, emissive cracks breathing
  let cq = uv - vec2f(0.0, 0.44);
  let coalR = 0.33 + 0.06 * (mod_alfbm(uv * 6.0) - 0.5);
  let coal = smoothstep(coalR, coalR - 0.10, length(cq));
  let ckn = mod_alfbm(uv * 9.0 + 5.0);
  let crack = smoothstep(0.10, 0.0, abs(ckn - 0.5)) * (0.55 + 0.45 * sin(time * 1.2 + ckn * 6.0)) * (0.15 + 0.85 * heat0);
  let lit = 0.75 - cq.y * 0.9;                       // hearth-light from above the coal
  let coalCol = mix(vec3f(0.055, 0.032, 0.028) * lit, vec3f(1.0, 0.32, 0.04), crack);
  col = mix(col, coalCol, coal);
  var a = max(clamp(flame * 1.4, 0.0, 1.0), coal);
  a *= smoothstep(1.0, 0.9, length(uv));
  if (a < 0.012) { return vec4f(0.0); }
  return vec4f(col * (0.55 + 0.6 * heat0), a);
}`

// ── CHAR: what fire leaves — a blackened knuckle holding one dying coal-seed ──
const W_CHAR = /* wgsl */`
fn visual_char(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let edge = 0.88 + 0.10 * (mod_alfbm(vec2f(atan2(uv.y, uv.x) * 1.7, 5.0)) - 0.5);
  let r = length(uv);
  if (r > edge) { return vec4f(0.0); }
  let hs = 5.0;
  let h  = mod_alfbm(uv * hs + 3.0);
  let hx = mod_alfbm((uv + vec2f(0.05, 0.0)) * hs + 3.0);
  let hy = mod_alfbm((uv + vec2f(0.0, 0.05)) * hs + 3.0);
  let nrm = normalize(vec3f((h - hx) * 6.0, (h - hy) * 6.0, 1.0));
  let dif = max(0.0, dot(nrm, normalize(vec3f(-0.4, -0.7, 0.6))));
  // burnt black, a grey ash bloom on the crowns
  var col = mix(vec3f(0.030, 0.026, 0.024), vec3f(0.115, 0.105, 0.10), h) * (0.3 + dif * 0.9);
  col = mix(col, vec3f(0.20, 0.195, 0.19), smoothstep(0.6, 0.9, h) * max(0.0, -uv.y) * 0.7);
  // one seed of heat left in the deepest crevice, breathing at the edge of death
  let seed = smoothstep(0.10, 0.0, abs(h - 0.5)) * smoothstep(0.5, 0.1, r);
  col += vec3f(0.55, 0.10, 0.01) * seed * (0.12 + 0.10 * sin(time * 0.5));
  return vec4f(col, smoothstep(edge, edge - 0.10, r));
}`

// ── DEW: a real glass droplet — refracts what lies behind it ──
const W_DEW = /* wgsl */`
fn visual_dew(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let wob = vec2f(uv.x * (1.0 + 0.045 * sin(time * 2.1)), uv.y * (1.0 - 0.045 * sin(time * 2.1)));
  let r = length(wob);
  if (r > 0.92) { return vec4f(0.0); }
  let rr = r / 0.92;
  let z = sqrt(max(0.0, 1.0 - rr * rr));
  let nrm = normalize(vec3f(wob.x, wob.y, z * 0.92));
  let L = normalize(vec3f(-0.45, -0.65, 0.62));        // the room key light, upper-left
  let fres = pow(1.0 - z, 2.6);
  // refraction: the world behind, pulled toward the center and cooled
  var col = behind.rgb * vec3f(0.80, 0.95, 1.08) * (0.72 + z * 0.5);
  col += vec3f(0.09, 0.20, 0.36) * (0.5 + fres);                  // water body
  col += vec3f(0.55, 0.75, 0.95) * fres * 0.85;                   // limb light
  let dif = max(0.0, dot(nrm, L));
  col += vec3f(0.10, 0.16, 0.22) * dif * 0.5;
  // specular window catch-light, tight and slightly stretched
  let spec = pow(max(0.0, dot(reflect(vec3f(0.0, 0.0, -1.0), nrm), L)), 90.0);
  col += vec3f(1.0) * spec * 1.1;
  // gathered caustic at the foot of the droplet
  let caust = exp(-dot(wob - vec2f(0.10, 0.56), wob - vec2f(0.10, 0.56)) * 16.0);
  col += vec3f(0.35, 0.55, 0.75) * caust * 0.45;
  return vec4f(col, smoothstep(0.92, 0.82, r) * 0.96);
}`

// ── GALE: braided streamlines with a drift of leaves-of-light ──
const W_GALE = /* wgsl */`
fn visual_gale(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let r = length(uv);
  if (r > 1.0) { return vec4f(0.0); }
  var a = 0.0;
  var col = vec3f(0.0);
  // three braided streamlines, each a thin band around a curved path
  for (var i = 0; i < 3; i++) {
    let fi = f32(i);
    let ph = time * 1.9 + fi * 2.09;
    let path = 0.22 * sin(uv.x * 3.4 + ph) + 0.16 * sin(uv.x * 6.1 - ph * 0.7) - 0.34 + fi * 0.34;
    let w = 0.05 + 0.03 * sin(uv.x * 2.0 + ph);
    let band = smoothstep(w, 0.0, abs(uv.y - path)) * smoothstep(1.0, 0.35, r);
    a += band * 0.42;
    col += vec3f(0.72, 0.84, 0.92) * band;
  }
  // caught leaves of light spiraling with it
  for (var k = 0; k < 2; k++) {
    let fk = f32(k);
    let la = time * 1.3 + fk * 3.14;
    let lp = vec2f(cos(la), sin(la) * 0.6) * (0.45 + 0.1 * sin(time * 0.7 + fk));
    let ld = uv - lp;
    let leaf = exp(-dot(ld, ld) * 160.0);
    a += leaf * 0.7;
    col += vec3f(0.9, 0.95, 0.85) * leaf;
  }
  a += exp(-r * r * 3.0) * 0.10;
  col += vec3f(0.6, 0.7, 0.8) * exp(-r * r * 3.0) * 0.12;
  return vec4f(col, clamp(a, 0.0, 0.9));
}`

// ── LOAM: dark strata, embedded pebbles, a living dust ──
const W_LOAM = /* wgsl */`
fn visual_loam(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let edge = 0.90 + 0.07 * (mod_alfbm(vec2f(atan2(uv.y, uv.x) * 1.6, 7.0)) - 0.5);
  let r = length(uv);
  if (r > edge) { return vec4f(0.0); }
  let hs = 4.5;
  let h  = mod_alfbm(uv * hs);
  let hx = mod_alfbm((uv + vec2f(0.05, 0.0)) * hs);
  let hy = mod_alfbm((uv + vec2f(0.0, 0.05)) * hs);
  let nrm = normalize(vec3f((h - hx) * 5.0, (h - hy) * 5.0, 1.0));
  let dif = max(0.0, dot(nrm, normalize(vec3f(-0.4, -0.7, 0.6))));
  var col = mix(vec3f(0.16, 0.105, 0.055), vec3f(0.42, 0.30, 0.16), h) * (0.35 + dif * 0.9);
  // embedded pebbles catch the light on their crowns
  let g = uv * 3.4;
  let cell = floor(g);
  let jit = vec2f(mod_alhash(cell), mod_alhash(cell + 19.7)) - 0.5;
  let pq = fract(g) - 0.5 - jit * 0.5;
  let peb = smoothstep(0.30, 0.18, length(pq));
  col = mix(col, vec3f(0.50, 0.40, 0.26) * (0.5 + 0.7 * max(0.0, -pq.y) + 0.4 * mod_alhash(cell + 7.0)), peb * 0.9);
  return vec4f(col * (0.85 + 0.3 * (1.0 - r)), smoothstep(edge, edge - 0.11, r));
}`

// ── MIST: three drifting billow layers, truly translucent ──
const W_MIST = /* wgsl */`
fn visual_mist(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let r = length(uv);
  if (r > 1.0) { return vec4f(0.0); }
  let w = mod_alwarp(uv * 1.5 + vec2f(7.0, 3.0), time * 0.35);
  let w2 = mod_alfbm(uv * 3.1 + vec2f(-time * 0.06, time * 0.04) + w * 1.4);
  var dens = smoothstep(0.38, 0.8, w * 0.62 + w2 * 0.5);
  dens *= smoothstep(1.0, 0.3, r);
  // vapor is lit from above: bright crowns, shadowed underbelly
  let lit = 0.72 + 0.5 * smoothstep(0.5, -0.6, uv.y) * w;
  var col = mix(behind.rgb, vec3f(0.82, 0.87, 0.93) * lit, 0.8);
  return vec4f(col, clamp(dens * 0.8, 0.0, 0.8));
}`

// ── RAIN: a falling streak — glossy head, torn tail above it ──
const W_RAIN = /* wgsl */`
fn visual_rain(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // head near the bottom of the cell (it falls +y), tail streaming up behind
  let head = uv - vec2f(0.0, 0.45);
  let hr = length(head * vec2f(2.0, 1.4));
  let hbody = smoothstep(0.55, 0.25, hr);
  let tail = smoothstep(0.30, 0.0, abs(uv.x + 0.06 * sin(uv.y * 6.0 + time * 3.0))) * smoothstep(0.6, -0.95, uv.y) * 0.6;
  var col = mix(vec3f(0.30, 0.50, 0.72), vec3f(0.70, 0.88, 1.0), hbody);
  col += behind.rgb * 0.25;
  let hi = exp(-dot(head - vec2f(-0.12, -0.10), head - vec2f(-0.12, -0.10)) * 30.0);
  col += vec3f(1.0) * hi * 0.7;
  let a = clamp(hbody + tail * (0.5 + 0.2 * sin(time * 2.8)), 0.0, 1.0);
  if (a < 0.012) { return vec4f(0.0); }
  return vec4f(col, a * 0.9);
}`

// ── MAGMA: black crust plates split by breathing fire ──
const W_MAGMA = /* wgsl */`
fn visual_magma(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let edge = 0.90 + 0.06 * (mod_alfbm(vec2f(atan2(uv.y, uv.x) * 1.9, 2.0)) - 0.5);
  let r = length(uv);
  if (r > edge) { return vec4f(0.0); }
  // crust heightfield + finite-difference normal — the plates are LIT, not flat
  let hs = 3.2;
  let h  = mod_alfbm(uv * hs + vec2f(0.0, time * 0.04));
  let hx = mod_alfbm((uv + vec2f(0.04, 0.0)) * hs + vec2f(0.0, time * 0.04));
  let hy = mod_alfbm((uv + vec2f(0.0, 0.04)) * hs + vec2f(0.0, time * 0.04));
  let nrm = normalize(vec3f((h - hx) * 6.0, (h - hy) * 6.0, 1.0));
  let L = normalize(vec3f(-0.4, -0.7, 0.6));
  let dif = max(0.0, dot(nrm, L));
  // fissures where the height crosses its middle; they breathe
  let fis = smoothstep(0.10, 0.015, abs(h - 0.5));
  let breath = 0.6 + 0.4 * sin(time * 0.85 + h * 5.0);
  var col = mix(vec3f(0.045, 0.032, 0.032), vec3f(0.17, 0.13, 0.12), h) * (0.35 + dif * 0.85);
  var molten = mix(vec3f(0.9, 0.22, 0.01), vec3f(1.0, 0.65, 0.12), breath * fis);
  col = mix(col, molten * (0.9 + breath * 0.7), fis);
  col = mix(col, vec3f(1.0, 0.62, 0.12) * breath, smoothstep(0.24, 0.0, r) * 0.5);
  col += vec3f(1.0, 0.4, 0.06) * fis * breath * 0.25;   // fissure light spills onto the crust
  return vec4f(col, smoothstep(edge, edge - 0.12, r));
}`

// ── MOSS: cushioned clumps with breathing spore-lights ──
const W_MOSS = /* wgsl */`
fn hash_mo(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(269.5, 183.3))) * 43758.5453); }
fn visual_moss(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // three overlapping cushions make the clump silhouette
  var d = 1e5;
  d = min(d, length(uv - vec2f(-0.28, 0.18)) - 0.52);
  d = min(d, length(uv - vec2f(0.30, 0.22)) - 0.48);
  d = min(d, length(uv - vec2f(0.02, -0.20)) - 0.58);
  let fuzz = 0.05 * sin(atan2(uv.y, uv.x) * 13.0 + time * 0.5) + 0.04 * sin(atan2(uv.y, uv.x) * 23.0);
  d += fuzz;
  if (d > 0.10) { return vec4f(0.0); }
  let body = smoothstep(0.10, -0.10, d);
  // lit from above, dark in the creases
  var col = mix(vec3f(0.06, 0.17, 0.07), vec3f(0.28, 0.55, 0.20), smoothstep(0.4, -0.4, uv.y) * 0.5 + 0.25);
  // spore-lights: tiny slow lanterns in the weave
  let g = uv * 5.5;
  let cell = floor(g);
  let sp = hash_mo(cell);
  let tw = 0.5 + 0.5 * sin(time * (0.4 + sp * 0.5) + sp * 40.0);
  let sd = length(fract(g) - 0.5 - (vec2f(hash_mo(cell + 3.1), hash_mo(cell + 5.7)) - 0.5) * 0.6);
  col += vec3f(0.55, 0.9, 0.35) * smoothstep(0.12, 0.02, sd) * step(0.75, sp) * tw * 0.8;
  return vec4f(col, body);
}`

// ── WILDFIRE: a ring of hunting tongues around a white heart ──
const W_WILDFIRE = /* wgsl */`
fn visual_wildfire(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t2 = time * 2.0;
  let w1 = mod_alfbm(uv * 2.7 + vec2f(t2 * 0.6, -t2 * 1.4));
  let w2 = mod_alfbm(uv * 5.4 + vec2f(-t2 * 0.8, -t2 * 2.1) + w1 * 1.8);
  var field = clamp((0.70 - length(uv)) * 2.1 + (w2 - 0.5) * 1.35 + (w1 - 0.5) * 0.6, 0.0, 1.35);
  if (field < 0.02) { return vec4f(0.0); }
  // blackbody, run hotter than the ember — this thing is hungry
  var col = mix(vec3f(0.30, 0.01, 0.0), vec3f(1.0, 0.32, 0.02), clamp(field * 1.5, 0.0, 1.0));
  col = mix(col, vec3f(1.0, 0.72, 0.18), clamp(field * 1.5 - 0.55, 0.0, 1.0));
  col = mix(col, vec3f(1.0, 0.97, 0.9), clamp(field * 1.5 - 1.05, 0.0, 1.0));
  let a = clamp(field * 1.3, 0.0, 1.0) * smoothstep(1.0, 0.85, length(uv));
  return vec4f(col * 1.45, a);
}`

// ── STORM: a rotating cloud knot with true branched lightning ──
const W_STORM = /* wgsl */`
fn visual_storm(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let r = length(uv);
  if (r > 1.0) { return vec4f(0.0); }
  let w = mod_alwarp(uv * 1.7 + vec2f(11.0, 4.0), time * 0.22);
  let w2 = mod_alfbm(uv * 3.4 + vec2f(time * 0.05, 0.0) + w * 1.3);
  var dens = smoothstep(0.36, 0.78, w * 0.6 + w2 * 0.52) * smoothstep(1.0, 0.4, r);
  if (dens < 0.015) { return vec4f(0.0); }
  // moon-lit crowns above, charged darkness beneath
  let lit = smoothstep(0.55, -0.6, uv.y);
  var col = mix(vec3f(0.045, 0.045, 0.075), vec3f(0.30, 0.29, 0.40), w * (0.4 + lit * 0.8));
  col += vec3f(0.42, 0.40, 0.52) * lit * w2 * 0.35;
  // the bolt: a noise-walked channel with two forks. params.x = thunder pulse.
  let liveness = 0.15 + 0.85 * clamp(params.x, 0.0, 1.0);
  let wob = (mod_alnoise(vec2f(uv.y * 4.5, time * 1.1)) - 0.5) * 0.7;
  let chan = abs(uv.x - wob - uv.y * 0.15);
  let bolt = smoothstep(0.030, 0.0, chan) * smoothstep(0.85, 0.1, abs(uv.y));
  let f1 = smoothstep(0.024, 0.0, abs((uv.y - 0.12) - (uv.x - wob) * 1.7)) * smoothstep(0.45, 0.05, abs(uv.x - 0.22));
  let f2 = smoothstep(0.024, 0.0, abs((uv.y + 0.22) + (uv.x - wob) * 1.4)) * smoothstep(0.38, 0.05, abs(uv.x + 0.20));
  let strike = (bolt + f1 * 0.6 + f2 * 0.5) * liveness;
  col += vec3f(0.80, 0.82, 1.0) * strike * 2.2 * dens;
  col += vec3f(0.45, 0.47, 0.75) * exp(-r * r * 2.2) * liveness * 0.4;   // the cloud glows from within
  return vec4f(col, clamp(dens * 1.15, 0.0, 0.95));
}`

// ── ASH: a curled grey flake still holding a dying vein of heat ──
const W_ASH = /* wgsl */`
fn visual_ash(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let bump = 0.12 * sin(atan2(uv.y, uv.x) * 6.0 + 2.0) + 0.07 * sin(atan2(uv.y, uv.x) * 11.0);
  let r = length(uv) + bump;
  if (r > 0.88) { return vec4f(0.0); }
  let flake = sin(uv.x * 9.0 + uv.y * 7.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.24, 0.235, 0.23), vec3f(0.42, 0.41, 0.40), flake) * (0.75 + 0.3 * (1.0 - r));
  // the last vein of heat, breathing out slowly
  let vein = smoothstep(0.06, 0.0, abs(sin(uv.x * 5.0 + 1.0) * 0.3 - uv.y));
  col += vec3f(0.9, 0.30, 0.05) * vein * (0.25 + 0.20 * sin(time * 0.7)) * smoothstep(0.9, 0.3, r);
  return vec4f(col, smoothstep(0.88, 0.62, r) * 0.9);
}`

// ── GLASS: a faceted gem — transparent, dispersive, patient ──
const W_GLASSGEM = /* wgsl */`
fn visual_glassgem(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // hexagonal silhouette
  let qa = vec2f(abs(uv.x), abs(uv.y));
  let hex = max(qa.x * 0.866 + qa.y * 0.5, qa.y);
  if (hex > 0.82) { return vec4f(0.0); }
  // kaleidoscope fold: interior facets
  let ang = atan2(uv.y, uv.x);
  let fold = abs(fract(ang / 1.0472) - 0.5) * 2.0;    // 6-fold
  let facet = smoothstep(0.0, 1.0, fold) * 0.5 + 0.5 * smoothstep(0.2, 0.8, length(uv));
  // the world behind, seen through cut glass
  var col = behind.rgb * vec3f(0.9, 1.02, 1.05) * (0.55 + facet * 0.5);
  col += vec3f(0.30, 0.42, 0.45) * facet * 0.35;
  // dispersion along facet edges — slow rainbow, never flashing
  let edge = smoothstep(0.82, 0.76, hex) - smoothstep(0.68, 0.5, hex);
  let hue = fold * 3.0 + time * 0.25;
  col += (0.5 + 0.5 * cos(vec3f(hue, hue + 2.09, hue + 4.19))) * max(edge, 0.0) * 0.55;
  let hi = exp(-dot(uv - vec2f(-0.25, -0.3), uv - vec2f(-0.25, -0.3)) * 20.0);
  col += vec3f(1.0) * hi * 0.5;
  return vec4f(col, smoothstep(0.82, 0.74, hex) * 0.85 + max(edge, 0.0) * 0.15);
}`

// ── STONE: a rugged boulder — like refused like, and made this ──
const W_STONE = /* wgsl */`
fn visual_stone(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let edge = 0.90 + 0.09 * (mod_alfbm(vec2f(atan2(uv.y, uv.x) * 1.4, 3.0)) - 0.5);
  let r = length(uv);
  if (r > edge) { return vec4f(0.0); }
  let hs = 3.0;
  let h  = mod_alfbm(uv * hs + 9.0);
  let hx = mod_alfbm((uv + vec2f(0.05, 0.0)) * hs + 9.0);
  let hy = mod_alfbm((uv + vec2f(0.0, 0.05)) * hs + 9.0);
  let nrm = normalize(vec3f((h - hx) * 6.0, (h - hy) * 6.0, 1.0));
  let dif = max(0.0, dot(nrm, normalize(vec3f(-0.4, -0.7, 0.6))));
  var col = mix(vec3f(0.13, 0.135, 0.16), vec3f(0.38, 0.39, 0.43), h) * (0.30 + dif * 1.0);
  col = mix(col, vec3f(0.09, 0.095, 0.11), smoothstep(0.09, 0.02, abs(mod_alnoise(uv * 4.0 + 2.0) - 0.5)) * 0.55);
  let spec = pow(max(0.0, dot(nrm, normalize(vec3f(-0.3, -0.8, 0.52)))), 24.0);
  col += vec3f(0.5, 0.52, 0.58) * spec * 0.35;
  return vec4f(col, smoothstep(edge, edge - 0.10, r));
}`

// ── STAR: the crown — diffraction spikes, chromatic halo, patient pulse ──
const W_STAR = /* wgsl */`
fn visual_star(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let r = length(uv);
  if (r > 1.0) { return vec4f(0.0); }
  let ang = atan2(uv.y, uv.x);
  let pulse = 0.85 + 0.15 * sin(time * 0.6);
  let core = exp(-r * r * 16.0) * 2.4 * pulse;
  // two interleaved diffraction spike sets, counter-turning slowly
  let ray1 = pow(max(0.0, cos(ang * 4.0 + time * 0.22)), 14.0) * smoothstep(1.0, 0.1, r);
  let ray2 = pow(max(0.0, cos(ang * 6.0 - time * 0.31)), 20.0) * smoothstep(0.8, 0.1, r) * 0.7;
  // chromatic halo ring
  let ringR = abs(r - 0.5 - 0.04 * sin(time * 0.5));
  let ring = smoothstep(0.10, 0.0, ringR);
  let hue = ang * 0.95 + time * 0.2;
  var col = vec3f(1.0, 0.94, 0.68) * (core + (ray1 + ray2) * 0.9);
  col += (0.5 + 0.5 * cos(vec3f(hue, hue + 2.09, hue + 4.19))) * ring * 0.5 * pulse;
  let a = clamp(core + ray1 + ray2 + ring * 0.5, 0.0, 1.0) * smoothstep(1.0, 0.8, r);
  if (a < 0.012) { return vec4f(0.0); }
  return vec4f(col, a);
}`

// ── FLARE: the visible moment of fusion. params: x packs age + style*10 +
// parentA-class*100 + parentB-class*1000; yzw = child color. Every fusion is
// unique because the parents are IN the birth — each parent class leaves its
// own dissolving remnant converging into the child's own arrival. ──
const W_FLARE = /* wgsl */`
fn visual_flare(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let pB = floor(params.x / 1000.0);
  let r1 = params.x - pB * 1000.0;
  let pA = floor(r1 / 100.0);
  let r2 = r1 - pA * 100.0;
  let style = i32(r2 / 10.0);
  let age = clamp(r2 - f32(style) * 10.0, 0.0, 1.0);
  if (age >= 1.0) { return vec4f(0.0); }
  let r = length(uv);
  let ang = atan2(uv.y, uv.x);
  let col0 = vec3f(params.y, params.z, params.w);
  let ring = smoothstep(0.09, 0.0, abs(r - age * 0.9));
  let bloom = exp(-r * r * 7.0) * (1.0 - age);
  var a = ring * (1.0 - age) * 0.8 + bloom;
  var col = col0 * (1.2 + bloom) + vec3f(1.0) * bloom * 0.35;
  if (style == 1) {
    // fire: sparks thrown up on ballistic arcs, cooling as they fly
    for (var i = 0; i < 6; i++) {
      let fi = f32(i);
      let sa = -1.5708 + (mod_alhash(vec2f(fi, 3.0)) - 0.5) * 2.2;
      let sp = vec2f(cos(sa), sin(sa)) * age * (0.5 + mod_alhash(vec2f(fi, 7.0)) * 0.5);
      let g = vec2f(sp.x, sp.y + age * age * 0.55);
      let d = uv - g;
      let sparkle = exp(-dot(d, d) * 700.0) * (1.0 - age);
      a += sparkle;
      col += mix(vec3f(1.0, 0.85, 0.4), vec3f(0.8, 0.2, 0.02), age) * sparkle * 2.0;
    }
  } else if (style == 2) {
    // water: a crown — squashed ring plus flung droplets that fall back
    let cr = smoothstep(0.06, 0.0, abs(length(vec2f(uv.x, uv.y * 2.4)) - age * 0.8)) * (1.0 - age);
    a += cr * 0.9;
    col += vec3f(0.75, 0.9, 1.0) * cr * 1.4;
    for (var i = 0; i < 5; i++) {
      let fi = f32(i);
      let dx = (fi - 2.0) * 0.22;
      let g = vec2f(dx * (0.4 + age), -age * 0.8 * (1.0 - abs(dx)) + age * age * 1.1);
      let d = uv - g;
      let drop = exp(-dot(d, d) * 900.0) * (1.0 - age);
      a += drop;
      col += vec3f(0.7, 0.88, 1.0) * drop * 1.6;
    }
  } else if (style == 3) {
    // earth: a slow bloom of dust, textured by the shared noise
    let dust = mod_alfbm(uv * 5.0 + age * 2.0) * smoothstep(age * 1.1, age * 0.3, r) * (1.0 - age);
    a += dust * 0.7;
    col += col0 * dust * 1.2;
  } else if (style == 4) {
    // storm: jagged crackle arcs biting around the ring
    let bite = pow(abs(sin(ang * 7.0 + age * 14.0)), 24.0) * smoothstep(0.08, 0.0, abs(r - age * 0.85));
    a += bite * (1.0 - age) * 1.2;
    col += vec3f(0.85, 0.88, 1.0) * bite * 2.5;
  } else if (style == 5) {
    // growth: green motes spiraling gently upward
    for (var i = 0; i < 5; i++) {
      let fi = f32(i);
      let ma = fi * 1.257 + age * 3.0;
      let g = vec2f(cos(ma) * 0.3 * (1.0 - age * 0.4), -age * 0.7 + sin(ma) * 0.12);
      let d = uv - g;
      let mote = exp(-dot(d, d) * 800.0) * (1.0 - age);
      a += mote;
      col += vec3f(0.5, 0.95, 0.4) * mote * 1.5;
    }
  }
  // the parents' last gesture: class remnants on either side, dissolving inward
  for (var s = 0; s < 2; s++) {
    let cls = select(pA, pB, s == 1);
    if (cls < 0.5) { continue; }
    let side = select(-1.0, 1.0, s == 1);
    let cx = side * 0.42 * (1.0 - age * 0.75);
    let fade = (1.0 - age) * (1.0 - age);
    let ic = i32(cls + 0.5);
    if (ic == 1) {
      // fire: sparks rising, cooling as they go out
      for (var k = 0; k < 3; k++) {
        let fk = f32(k);
        let g = vec2f(cx + (mod_alhash(vec2f(fk, side + 2.0)) - 0.5) * 0.24, -age * (0.3 + fk * 0.14));
        let d = uv - g;
        let sp2 = exp(-dot(d, d) * 800.0) * fade;
        a += sp2;
        col += mix(vec3f(1.0, 0.8, 0.35), vec3f(0.7, 0.15, 0.02), age) * sp2 * 1.8;
      }
    } else if (ic == 2) {
      // water: droplets letting go, falling away
      for (var k = 0; k < 3; k++) {
        let fk = f32(k);
        let g = vec2f(cx + (fk - 1.0) * 0.13, age * (0.25 + fk * 0.12) - 0.06);
        let d = uv - g;
        let dr = exp(-dot(d, d) * 900.0) * fade;
        a += dr;
        col += vec3f(0.6, 0.85, 1.0) * dr * 1.5;
      }
    } else if (ic == 3) {
      // storm: one last biting arc
      let d = vec2f(uv.x - cx, uv.y);
      let arc = smoothstep(0.02, 0.0, abs(length(d) - 0.16 - age * 0.1)) * pow(abs(sin(atan2(d.y, d.x) * 5.0 + age * 9.0)), 8.0);
      a += arc * fade * 1.2;
      col += vec3f(0.8, 0.84, 1.0) * arc * fade * 2.2;
    } else if (ic == 4) {
      // star: a four-ray glint refusing to die quietly
      let d = vec2f(uv.x - cx, uv.y);
      let gl = exp(-dot(d, d) * 500.0) + pow(max(0.0, cos(atan2(d.y, d.x) * 2.0)), 30.0) * exp(-length(d) * 9.0) * 0.8;
      a += gl * fade;
      col += vec3f(1.0, 0.94, 0.6) * gl * fade * 1.6;
    } else if (ic == 5) {
      // earth: dust settling down and out
      let d = vec2f(uv.x - cx, uv.y - age * 0.18);
      let du = mod_alfbm(d * 7.0 + age * 3.0) * smoothstep(0.34, 0.05, length(d));
      a += du * fade * 0.8;
      col += vec3f(0.55, 0.42, 0.26) * du * fade * 1.1;
    } else if (ic == 6) {
      // air: a curling wisp unwinding
      let d = vec2f(uv.x - cx, uv.y);
      let wsp = smoothstep(0.035, 0.0, abs(d.y - 0.10 * sin(d.x * 9.0 + age * 12.0 + side))) * smoothstep(0.4, 0.1, abs(d.x));
      a += wsp * fade * 0.9;
      col += vec3f(0.75, 0.86, 0.94) * wsp * fade * 1.3;
    }
  }
  a = clamp(a, 0.0, 1.0);
  if (a < 0.01) { return vec4f(0.0); }
  return vec4f(col, a);
}`

// ── the hook: motion, drag, chemistry, wells, codex ──
const HOOK = `
try {
  const wd = sim.worldData
  const dtc = Math.min(dt, 0.05)

  // ── freeze diagnostic (temporary): if the frame interval spikes, say so on
  // the HUD, tagged with whether a fusion just happened. Read it, report it.
  const nowMs = performance.now()
  if (!wd.__al) { /* first frame — state made below */ } else {
    const A0 = wd.__al
    if (A0.lastMs && nowMs - A0.lastMs > 120) {
      A0.spike = Math.round(nowMs - A0.lastMs) + 'ms ' + (A0.fuseAt && nowMs - A0.fuseAt < 1200 ? 'at ' + (A0.fuseKey || 'fusion') : 'idle')
      A0.spikeAt = nowMs
    }
    A0.lastMs = nowMs
  }

  // species table: radius (grid), gravity (+down), lifespan (0 = abiding), tone
  const SP = {
    ember:    { r: 24, g: -16, life: 0,  tone: 392, well: [92, 442] },
    dew:      { r: 21, g:  24, life: 0,  tone: 523, well: [420, 72] },
    gale:     { r: 27, g:   0, life: 0,  tone: 587, well: [64, 240] },
    loam:     { r: 25, g:  34, life: 0,  tone: 294, well: [150, 70] },
    mist:     { r: 32, g: -12, life: 26, tone: 659 },
    rain:     { r: 14, g:  95, life: 0,  tone: 494 },
    magma:    { r: 27, g:  16, life: 0,  tone: 196 },
    moss:     { r: 24, g:  20, life: 0,  tone: 440 },
    wildfire: { r: 27, g:  -8, life: 7,  tone: 740 },
    storm:    { r: 38, g:  -2, life: 40, tone: 110 },
    ash:      { r: 17, g:  12, life: 0,  tone: 262 },
    glass:    { r: 22, g:   4, life: 0,  tone: 880 },
    stone:    { r: 28, g:  40, life: 0,  tone: 147 },
    char:     { r: 15, g:  22, life: 0,  tone: 220 },
    star:     { r: 20, g:   0, life: 0,  tone: 1047 },
  }
  // the book of fusions — sorted-pair key. Like refuses like unless THROWN.
  const RX = {
    'dew+ember': 'mist',      'ember+loam': 'magma',    'dew+loam': 'moss',
    'dew+gale': 'rain',       'ember+gale': 'wildfire', 'gale+mist': 'storm',
    'dew+magma': 'glass',     'ember+moss': 'ash',      'ash+dew': 'loam',
    'magma+storm': 'star',    'moss+wildfire': 'ember', 'mist+mist': 'dew',
    'ember+ember': 'wildfire','dew+dew': 'rain',        'gale+gale': 'storm',
    'loam+loam': 'stone',
    'char+gale': 'ember',     'char+dew': 'ash',        'stone+wildfire': 'magma',
    'stone+storm': 'glass',   'mist+moss': 'moss',
    // every creation has a further use — only the STAR is final
    'magma+rain': 'stone',    'glass+wildfire': 'magma',
    'dew+moss': 'moss',       'ash+rain': 'loam',       'ember+rain': 'mist',
    'magma+mist': 'stone',
    // ── the book grows (Galen: all combos should make something) ──
    // weather writes on the land
    'gale+rain': 'storm',     'loam+rain': 'moss',      'loam+mist': 'moss',
    'rain+stone': 'loam',     'gale+stone': 'ash',      'dew+stone': 'moss',
    'mist+rain': 'rain',      'dew+mist': 'rain',       'moss+rain': 'moss',
    // fire meets water, water wins slowly
    'dew+wildfire': 'mist',   'rain+wildfire': 'mist',  'mist+wildfire': 'gale',
    'ember+mist': 'gale',     'gale+magma': 'wildfire',     // the burnt world
    'ash+ember': 'char',      'ash+wildfire': 'char',   'loam+wildfire': 'char',
    'magma+moss': 'ash',      'ash+moss': 'loam',       'char+rain': 'loam',
    'char+stone': 'stone',    'ash+glass': 'stone',     'moss+stone': 'loam',
    // glass sweats, magma breathes
    'glass+mist': 'dew',      'ember+glass': 'magma',
    // the star ascends what it touches (light is generous, not final after all)
    'ember+star': 'wildfire', 'dew+star': 'mist',       'gale+star': 'storm',
    'loam+star': 'glass',     'star+stone': 'magma',    'mist+star': 'rain',
    'moss+star': 'loam',      'star+wildfire': 'star',
  }
  const NAMES = { mist:'MIST', rain:'RAIN', magma:'MAGMA', moss:'MOSS', wildfire:'WILDFIRE',
                  storm:'STORM', ash:'ASH', glass:'GLASS', stone:'STONE', star:'STAR',
                  dew:'DEW', ember:'EMBER', loam:'LOAM', gale:'GALE', char:'CHAR' }
  // element classes: 1 fire, 2 water, 3 storm, 4 star, 5 earth/solid, 6 air —
  // used for the vessel's coupled lighting AND each flare's parent remnants
  const CLS  = { ember: 1, wildfire: 1, magma: 1, dew: 2, rain: 2, mist: 2, storm: 3, star: 4, loam: 5, stone: 5, glass: 5, moss: 5, ash: 5, char: 5, gale: 6 }
  const GLOW = { ember: 0.9, wildfire: 1.4, magma: 0.75, dew: 0.4, rain: 0.3, mist: 0.3, storm: 0.9, star: 1.7, loam: 0.5, stone: 0.55, glass: 0.6, moss: 0.45, ash: 0.3, char: 0.15, gale: 0.25 }

  // state: A.s[id] = { sp, on, x, y, vx, vy, age, rest } — one entry per pooled field
  if (!wd.__al) wd.__al = { s: {}, wellT: 1.2, mn: 0, grab: null, sq: [], thunderT: 4, lastMs: performance.now() }
  if (!wd.__alcodex) wd.__alcodex = { found: {}, last: '' }   // survives leaving (cc-save stash)
  const A = wd.__al, CX = wd.__alcodex
  const spOf = (id) => id.replace(/^al_/, '').replace(/\\d+$/, '')

  // fresh session: park everything, re-seed the vessel
  if (wd.__fresh) {
    delete wd.__fresh
    A.s = {}; A.grab = null; A.sq = []; A.wellT = 0.6; A.thunderT = 4
    for (const f of sim.fields.values()) {
      if (!f.id.startsWith('al_') || f.id === 'al_vessel') continue
      A.s[f.id] = { sp: spOf(f.id), on: 0, x: -100, y: -100, vx: 0, vy: 0, age: 0, rest: 0 }
      f.transform.x = -100; f.transform.y = -100
    }
  }

  const slots = Object.keys(A.s)
  const active = slots.filter(id => A.s[id].on)
  const wake = (sp, x, y, vx, vy) => {
    const id = slots.find(k => A.s[k].sp === sp && !A.s[k].on)
    if (!id) return null
    const st = A.s[id]
    st.on = 1; st.x = x; st.y = y; st.vx = vx || 0; st.vy = vy || 0; st.age = 0; st.rest = 0
    st.heat = 1   // a reused slot MUST start hot — else a stale burnt-out ember dies on frame 1 (the spawn-die loop)
    return id
  }
  const park = (id) => { const st = A.s[id]; st.on = 0; st.x = -100; st.y = -100; if (A.grab === id) A.grab = null }
  const tone = (freq, vol, dur, typ) => A.sq.push({ frequency: freq, duration: dur || 0.35, volume: vol || 0.16, type: typ || 'sine' })

  // ── wells: the vessel breathes primal matter back in ──
  A.wellT -= dtc
  if (A.wellT <= 0) {
    A.wellT = 1.5
    const want = { ember: 4, dew: 4, gale: 3, loam: 3 }
    // breathe in a RANDOM under-target primal each time, so the vessel fills
    // interleaved (fire, water, air, earth…) instead of 4-of-one-then-4-of-the-next
    const under = Object.keys(want).filter(sp => active.filter(id => A.s[id].sp === sp).length < want[sp])
    if (under.length) {
      const sp = under[Math.floor(Math.random() * under.length)]
      const w = SP[sp].well
      if (wake(sp, w[0] + (Math.random() - 0.5) * 46, w[1] + (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 14, 0)) {
        tone(SP[sp].tone * 0.5, 0.05, 0.25)
      }
    }
  }

  // ── the alchemist's hand: grab, carry, fling ──
  const mx = wd.mouse_x ?? 256, my = wd.mouse_y ?? 256
  const down = !!wd.mouse_down
  if (down && !A.grab) {
    let best = null, bd = 1e9
    for (const id of active) {
      const st = A.s[id]
      if (st.sp === 'flare') continue   // light cannot be held
      const d = Math.hypot(mx - st.x, my - st.y)
      if (d < SP[st.sp].r + 20 && d < bd) { bd = d; best = id }
    }
    if (best) A.grab = best
  }
  if (!down) A.grab = null
  if (A.grab && A.s[A.grab] && A.s[A.grab].on) {
    const st = A.s[A.grab]
    const k = Math.min(1, dtc * 14)
    const nx = st.x + (mx - st.x) * k, ny = st.y + (my - st.y) * k
    st.vx = (nx - st.x) / Math.max(dtc, 0.001) * 0.55   // carried momentum → the fling
    st.vy = (ny - st.y) / Math.max(dtc, 0.001) * 0.55
    st.x = nx; st.y = ny; st.rest = 0
  }

  // ── motion: every species has a temperament ──
  const FLOOR = 486, CEIL = 26, L = 26, R = 486
  for (const id of active) {
    const st = A.s[id]
    if (st.sp === 'flare') continue   // aged separately below — no physics, no SP entry
    if (id === A.grab) continue
    const sp = SP[st.sp]
    st.age += dtc
    if (st.sp === 'star') {
      // the crown discovery orbits the heart of the vessel, forever
      const oa = st.age * 0.5
      st.x = 256 + Math.cos(oa) * 120; st.y = 256 + Math.sin(oa) * 120
      continue
    }
    if (st.sp === 'gale') st.vx += Math.sin(st.age * 0.9 + st.y * 0.02) * 46 * dtc
    if (st.sp === 'mist') st.vx += Math.sin(st.age * 0.6) * 14 * dtc
    if (st.sp === 'wildfire') { st.vx += (Math.random() - 0.5) * 320 * dtc; st.vy += (Math.random() - 0.5) * 320 * dtc }
    if (st.sp === 'storm') { st.vx += Math.sin(st.age * 0.8) * 30 * dtc; st.vy += Math.cos(st.age * 0.7) * 16 * dtc }
    st.vy += sp.g * dtc * 3.2
    st.vx *= (1 - Math.min(1, dtc * 1.4)); st.vy *= (1 - Math.min(1, dtc * 1.4))
    st.x += st.vx * dtc; st.y += st.vy * dtc
    // the glass: soft walls, a floor where the heavy things rest
    if (st.x < L) { st.x = L; st.vx = Math.abs(st.vx) * 0.5 }
    if (st.x > R) { st.x = R; st.vx = -Math.abs(st.vx) * 0.5 }
    if (st.y < CEIL) { st.y = CEIL; st.vy = Math.abs(st.vy) * 0.3 }
    if (st.sp === 'ember') {
      // fire spends itself: the flame dims, and what is left is char
      st.heat = (st.heat === undefined ? 1 : st.heat) - dtc / 50
      if (st.heat <= 0) { const x = st.x, y = st.y; park(id); wake('char', x, y, 0, 0); tone(180, 0.08, 0.5); continue }
    }
    if (st.sp === 'rain') st.vx += Math.sin(st.age * 2.1 + st.y * 0.03) * 26 * dtc   // wind-sway
    if (st.y > FLOOR) {
      st.y = FLOOR; st.vy = -Math.abs(st.vy) * 0.25
      if (st.sp === 'rain') {
        // the strike is VISIBLE: a crown splash where it lands, and the water
        // stays in the world as a droplet — nothing vanishes
        const fid = slots.find(k => A.s[k].sp === 'flare' && !A.s[k].on)
        if (fid) { const fs = A.s[fid]; fs.on = 1; fs.x = st.x; fs.y = FLOOR - 6; fs.age = 0; fs.style = 2; fs.tint = [0.6, 0.8, 1.0]; fs.pa = 0; fs.pb = 0 }
        tone(700 + Math.random() * 200, 0.06, 0.15)
        // the drop BOUNCES — the harder it fell, the higher the droplet leaps
        // (st.vy was already damped to 0.25x by the floor above; 1.8x ≈ 0.45x impact)
        park(id); wake('dew', st.x, FLOOR - 4, st.vx * 0.3, -Math.max(30, Math.abs(st.vy) * 1.8))
        continue
      }
    }
    // lifespans: mist thins away, wildfire burns to ash, a storm rains itself out
    if (sp.life && st.age > sp.life) {
      const x = st.x, y = st.y, vx = st.vx, vy = st.vy
      park(id)
      if (st.sp === 'wildfire') wake('ash', x, y, vx * 0.2, vy * 0.2)
      if (st.sp === 'storm') { wake('rain', x - 12, y, -10, 40); wake('rain', x + 12, y, 10, 40); tone(140, 0.12, 0.5) }
    }
  }

  // ── the chemistry: contact is a question, the recipe book answers ──
  const act2 = slots.filter(id => A.s[id].on)
  for (let i = 0; i < act2.length; i++) {
    const a = A.s[act2[i]]
    if (a.age < 0.7 || !a.on || a.sp === 'flare') continue
    for (let j = i + 1; j < act2.length; j++) {
      const b = A.s[act2[j]]
      if (b.age < 0.7 || !b.on || !a.on || b.sp === 'flare') continue
      const rr = (SP[a.sp].r + SP[b.sp].r) * 0.66
      const dx = b.x - a.x, dy = b.y - a.y
      if (dx * dx + dy * dy > rr * rr) continue
      const key = [a.sp, b.sp].sort().join('+')
      let child = RX[key]
      // LIKE REFUSES LIKE unless thrown — a deliberate act, not a graze.
      // (mist is the exception: condensation is gentle by nature.)
      if (child && a.sp === b.sp && a.sp !== 'mist') {
        const rvx = a.vx - b.vx, rvy = a.vy - b.vy
        if (rvx * rvx + rvy * rvy < 90 * 90) child = null
      }
      if (!child) {
        // no reaction — but NOTHING is mute (Galen: all combos make something).
        // Matter that refuses still ANSWERS: on a real bump (not a graze) it
        // throws a brief spark, sounds the two tones together, and kicks apart.
        const d = Math.max(6, Math.hypot(dx, dy)), push = 60 * dtc
        a.vx -= dx / d * push; a.vy -= dy / d * push
        b.vx += dx / d * push; b.vy += dy / d * push
        const rvx2 = a.vx - b.vx, rvy2 = a.vy - b.vy
        A.fzT = Math.max(0, (A.fzT || 0) - dtc)
        if (A.fzT <= 0 && rvx2 * rvx2 + rvy2 * rvy2 > 55 * 55) {
          A.fzT = 0.25
          const fid2 = slots.find(k => A.s[k].sp === 'flare' && !A.s[k].on)
          if (fid2) {
            const fs2 = A.s[fid2]
            fs2.on = 1; fs2.x = (a.x + b.x) / 2; fs2.y = (a.y + b.y) / 2
            fs2.age = 0; fs2.style = 2; fs2.tint = [1.0, 0.88, 0.55]; fs2.pa = 0; fs2.pb = 0
          }
          tone(SP[a.sp].tone, 0.05, 0.12)
          tone(SP[b.sp].tone * 1.06, 0.05, 0.12)   // a near-miss interval — the sound of refusal
          const kick = 40
          a.vx -= dx / d * kick * 0.5; a.vy -= dy / d * kick * 0.5
          b.vx += dx / d * kick * 0.5; b.vy += dy / d * kick * 0.5
        }
        continue
      }
      const cxp = (a.x + b.x) / 2, cyp = (a.y + b.y) / 2
      const cvx = (a.vx + b.vx) / 2, cvy = (a.vy + b.vy) / 2
      // snapshot the parents: parking them first frees a same-species slot for
      // the child, but if the child's pool is STILL full we must not eat them
      // (silent loss = "not all combinations work"). Undo on failure.
      const pa = { sp: a.sp, x: a.x, y: a.y, vx: a.vx, vy: a.vy }
      const pb = { sp: b.sp, x: b.x, y: b.y, vx: b.vx, vy: b.vy }
      park(act2[i]); park(act2[j])
      if (!wake(child, cxp, cyp, cvx, cvy)) {
        wake(pa.sp, pa.x, pa.y, pa.vx, pa.vy); wake(pb.sp, pb.x, pb.y, pb.vx, pb.vy)
        continue   // pool full — nothing lost; the pair meets again next contact
      }
      if (child === 'ember') wake('ember', cxp + 16, cyp - 8, 20, -20)   // wildfire spreads
      if (key === 'dew+moss') wake('moss', cxp + 20, cyp + 4, 12, -8)    // watered: the moss doubles
      // the flare IS the fusion made visible
      const fid = slots.find(k => A.s[k].sp === 'flare' && !A.s[k].on)
      if (fid) {
        const fs = A.s[fid]; fs.on = 1; fs.x = cxp; fs.y = cyp; fs.age = 0; fs.vx = 0; fs.vy = 0
        const tint = { mist:[.7,.8,.9], rain:[.4,.7,1], magma:[1,.4,.1], moss:[.4,.8,.3], wildfire:[1,.6,.1],
                       storm:[.5,.5,.9], ash:[.5,.5,.5], glass:[.7,.95,1], stone:[.6,.6,.68], star:[1,.95,.6],
                       dew:[.5,.8,1], ember:[1,.5,.15], loam:[.5,.35,.2], char:[.4,.3,.25] }[child] || [1,1,1]
        fs.tint = tint
        // every birth has its own body language: fire sparks, water crowns,
        // earth breathes dust, storms crackle, growth drifts up green —
        // and the parents each leave their class's remnant, so all 21
        // fusions (and any future combos of combos) look like themselves
        fs.style = { ember:1, wildfire:1, magma:1, char:1, dew:2, rain:2, mist:2, glass:2,
                     loam:3, stone:3, ash:3, storm:4, star:4, moss:5 }[child] || 0
        fs.pa = CLS[a.sp] || 5; fs.pb = CLS[b.sp] || 5
      }
      A.fuseAt = performance.now(); A.fuseKey = key
      tone(SP[child].tone, 0.2, 0.5)
      if (!CX.found[key]) {
        CX.found[key] = child
        CX.last = key.toUpperCase().replace('+', ' + ') + ' \\u2192 ' + NAMES[child]
        tone(SP[child].tone * 2, 0.1, 0.7)
        if (child === 'star') { tone(1047, 0.2, 0.9); tone(1319, 0.14, 1.1) }
      }
      break
    }
  }

  // ── life: established moss buds on its own — the vessel slowly greens.
  // Population is capped by the moss slot pool, so it settles, not swarms. ──
  A.growT = (A.growT ?? 20) - dtc
  if (A.growT <= 0) {
    A.growT = 16 + Math.random() * 10
    const mosses = act2.filter(id => A.s[id].on && A.s[id].sp === 'moss' && A.s[id].age > 8)
    if (mosses.length) {
      const p = A.s[mosses[Math.floor(Math.random() * mosses.length)]]
      const nid = wake('moss', p.x + (Math.random() - 0.5) * 64, p.y - 16 - Math.random() * 22, (Math.random() - 0.5) * 10, -8)
      if (nid) {
        tone(440, 0.06, 0.45)
        const fid = slots.find(k => A.s[k].sp === 'flare' && !A.s[k].on)
        if (fid) { const fs = A.s[fid]; fs.on = 1; fs.x = A.s[nid].x; fs.y = A.s[nid].y; fs.age = 0; fs.style = 5; fs.tint = [0.4, 0.8, 0.3]; fs.pa = 0; fs.pb = 0 }
      }
    }
  }

  // flares age out fast; storms mutter thunder
  for (const id of slots) {
    const st = A.s[id]
    if (st.sp === 'flare' && st.on) { st.age += dtc * 1.8; if (st.age >= 1) park(id) }
  }
  A.thunderT -= dtc
  const stormUp = act2.some(id => A.s[id].sp === 'storm' && A.s[id].on)
  if (stormUp && A.thunderT <= 0) { A.thunderT = 3.5 + Math.random() * 3; tone(70 + Math.random() * 40, 0.14, 0.8); A.flash = 1 }
  A.flash = Math.max(0, (A.flash || 0) - dtc * 2.5)

  // ── write the fields: state → transforms, flare params ──
  for (const id of slots) {
    const f = sim.fields.get(id)
    if (!f) continue
    const st = A.s[id]
    f.transform.x = st.x; f.transform.y = st.y
    if (st.sp === 'flare') f.visualParams = [(st.on ? st.age : 1) + (st.style || 0) * 10 + (st.pa || 0) * 100 + (st.pb || 0) * 1000, (st.tint||[1,1,1])[0], (st.tint||[1,1,1])[1], (st.tint||[1,1,1])[2]]
    if (st.sp === 'storm') f.visualParams = [A.flash || 0, 0, 0, 0]
    if (st.sp === 'ember') f.visualParams = [st.heat === undefined ? 1 : Math.max(0, st.heat), 0, 0, 0]
  }

  // one voice per frame — the tone queue drains politely
  if (A.sq.length) wd.__play_sound = A.sq.shift()

  // a window for watchers: live positions + codex, read-only by convention
  if (typeof window !== 'undefined') window.__alembic = { s: A.s, codex: CX }

  // ── the codex ──
  const n = Object.keys(CX.found).length
  const held = A.grab && A.s[A.grab] ? NAMES[A.s[A.grab].sp] : null
  wd.hud = [
    { id: 'ax_c', type: 'text', x: '14px', y: '12px', text: 'CODEX ' + n + ' / ' + Object.keys(RX).length + (CX.last ? '  \\u00b7  ' + CX.last : ''), color: '#c9b370', fontSize: '13px' },
    ...(held ? [{ id: 'ax_h', type: 'text', x: '14px', y: '34px', text: 'in hand: ' + held, color: '#8fb3c9', fontSize: '12px' }] : []),
    ...(A.spike && nowMs - (A.spikeAt || 0) < 20000 ? [{ id: 'ax_dbg', type: 'text', x: '14px', y: '56px', text: 'lag ' + A.spike, color: '#c97a4a', fontSize: '11px' }] : []),
  ]
  // publish the vessel's contents to the whiteboard: the room lights itself
  // by what it holds. u = [mx, my, count, then (x, y, class, glow) per element]
  const u = [((mx) - 256) / 256, ((my) - 256) / 256, 0]
  let cnt = 0
  for (const id of slots) {
    const st = A.s[id]
    if (!st.on || st.sp === 'flare' || cnt >= 20) continue
    u.push((st.x - 256) / 256, (st.y - 256) / 256, CLS[st.sp] || 0, GLOW[st.sp] || 0.4)
    cnt++
  }
  u[2] = cnt
  wd.gpuUniforms = u
} catch (e) { /* the vessel holds */ }
`

// ── the scene: one vessel, a pooled population of matter ──
const SLOTS = [
  ['ember', 6], ['dew', 6], ['gale', 4], ['loam', 4], ['mist', 4], ['rain', 4],
  ['magma', 3], ['moss', 6], ['wildfire', 3], ['storm', 2], ['ash', 3], ['glass', 3],
  ['stone', 3], ['char', 4], ['star', 1], ['flare', 4],
]
const VISUAL_OF = { glass: 'glassgem' }
const RADIUS_OF = { ember: 24, dew: 21, gale: 27, loam: 25, mist: 32, rain: 14, magma: 27, moss: 24, wildfire: 27, storm: 38, ash: 17, glass: 22, stone: 28, char: 16, star: 20, flare: 42 }
const fields = [{
  id: 'al_vessel', name: 'ALEMBIC',
  color: [0.02, 0.015, 0.01, 1],
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  shapeType: 'rect', w: 512, h: 512, visualTypeName: 'vessel', noHit: true, noCollide: true,
}]
for (const [sp, n] of SLOTS) {
  for (let i = 0; i < n; i++) {
    fields.push({
      id: `al_${sp}${i}`, name: sp,
      color: [1, 1, 1, 1],
      effects: [], memory: [], proximity: [], properties: {},
      transform: { x: -100, y: -100, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
      shapeType: 'circle', radius: RADIUS_OF[sp], visualTypeName: VISUAL_OF[sp] || sp,
      noCollide: true, renderOrder: sp === 'flare' ? 6 : (sp === 'mist' ? 2 : 4),
    })
  }
}

const scene = {
  name: 'ALEMBIC',
  fields,
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    mobile: true,   // pointer-only by design — first citizen of the mobile shelf
    built_by: 'fable',
    // cheap per pixel — buy back full retina sharpness, and let the hot things bloom
    maxBufferPixels: 5_000_000,
    postProcess: { bloomIntensity: 0.55, bloomThreshold: 0.55, exposure: 1.05, vignetteStrength: 0.35, vignetteRadius: 0.85 },
    instructions: 'ALEMBIC \\u2014 an alchemy of living matter.\\n\\nDRAG anything into anything \\u2014 some pairs become something new. No keys; a pointer is enough.\\n\\nFire spends itself down to CHAR \\u2014 a breath of GALE rekindles it. Water quenches what it touches. Like refuses like unless THROWN.\\n\\nA book of fusions hides in the vessel; every creation has a further use. Water the MOSS and it doubles \\u2014 left alone, life slowly greens the glass. Only the STAR is final \\u2014 and it must be provoked.',
  },
  stepHooks: [{ id: 'alembic_still', author: 'fable', description: 'ALEMBIC: pooled-field chemistry — drag, fuse, discover', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'vessel', wgsl: VESSEL },
    { name: 'ember', wgsl: W_EMBER },
    { name: 'dew', wgsl: W_DEW },
    { name: 'gale', wgsl: W_GALE },
    { name: 'loam', wgsl: W_LOAM },
    { name: 'mist', wgsl: W_MIST },
    { name: 'rain', wgsl: W_RAIN },
    { name: 'magma', wgsl: W_MAGMA },
    { name: 'moss', wgsl: W_MOSS },
    { name: 'wildfire', wgsl: W_WILDFIRE },
    { name: 'storm', wgsl: W_STORM },
    { name: 'ash', wgsl: W_ASH },
    { name: 'glassgem', wgsl: W_GLASSGEM },
    { name: 'stone', wgsl: W_STONE },
    { name: 'char', wgsl: W_CHAR },
    { name: 'star', wgsl: W_STAR },
    { name: 'flare', wgsl: W_FLARE },
  ],
  modules: [{ name: 'alnoise', wgsl: NOISELIB }],
  timestamp: Date.now(),
}

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/ALEMBIC.json'), JSON.stringify(scene, null, 1))
console.log('ALEMBIC bundled to public/cartridges/ALEMBIC.json')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'ALEMBIC', scene }),
})
console.log('ALEMBIC saved:', res.status, await res.text())
