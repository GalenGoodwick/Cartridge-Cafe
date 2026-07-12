// TIDERUNNER — realistic dusk-ocean sailing, top-down. A/D = helm, W/S = trim the sail, SPACE = let fly.
// You cannot sail into the wind: tack. Gusts heel the boat — over-canvassed in a squall means a broach.
// Collect lantern rafts, deliver at the lighthouse dock (combo bonus). Rocks hole the hull. The maelstrom pulls.
// Save+load: node tiderunner-cartridge.mjs

// Shared conventions: grid y is DOWN. Sun low in the west: SUN = vec2f(-0.66, -0.30)-ish, warm dusk light.
// All wave/foam motion ≤ ~2 Hz — no strobing.

const SEA = /* wgsl */`
fn tr_h(pw: vec2f, t: f32, wdir: vec2f) -> f32 {
  let d2 = normalize(wdir + vec2f(-wdir.y, wdir.x) * 0.55);
  var h = sin(dot(pw, wdir) * 0.09 - t * 1.05) * 0.55;
  h += sin(dot(pw, d2) * 0.157 - t * 1.45 + 1.7) * 0.28;
  h += (vnoise(pw * 0.045 + vec2f(t * 0.05, t * 0.03)) - 0.5) * 0.9;
  h += (vnoise(pw * 0.11 - vec2f(t * 0.07, t * 0.02)) - 0.5) * 0.45;
  return h;
}
fn visual_tr_sea(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [windX, windY, wind01, 0]
  var wdir = vec2f(p.x, p.y);
  if (length(wdir) < 0.1) { wdir = vec2f(1.0, 0.0); }
  wdir = normalize(wdir);
  let w01 = clamp(p.z, 0.0, 1.0);
  let pw = uv * 256.0;
  let t = time;

  let h0 = tr_h(pw, t, wdir);
  let hx = tr_h(pw + vec2f(1.6, 0.0), t, wdir);
  let hy = tr_h(pw + vec2f(0.0, 1.6), t, wdir);
  let n = normalize(vec3f(h0 - hx, h0 - hy, 0.85));

  // dusk water: deep slate-teal, warmer toward the sun side
  var c = mix(vec3f(0.050, 0.130, 0.175), vec3f(0.085, 0.170, 0.200), h0 * 0.5 + 0.5);
  let sun2 = normalize(vec2f(-0.66, -0.30));
  c = mix(c, vec3f(0.165, 0.125, 0.115), clamp(dot(uv, sun2) * 0.5 + 0.2, 0.0, 0.45));

  // sky reflection modulated by slope (fresnel-ish from above)
  let skyRef = mix(vec3f(0.22, 0.26, 0.34), vec3f(0.62, 0.36, 0.24), clamp(dot(uv, sun2) + 0.45, 0.0, 1.0));
  c = mix(c, skyRef, clamp(0.22 + 0.35 * (1.0 - n.z), 0.0, 0.6));

  // low-sun glitter — anisotropic, stretched along the sun azimuth
  let L = normalize(vec3f(sun2 * 1.0, 0.24));
  let H = normalize(L + vec3f(0.0, 0.0, 1.0));
  var spec = pow(max(dot(n, H), 0.0), 160.0);
  spec *= 0.55 + 0.65 * vnoise(pw * 0.9 + vec2f(t * 0.8, -t * 0.5));
  c += vec3f(2.6, 1.5, 0.7) * spec * (0.35 + 0.65 * clamp(dot(uv, sun2) + 0.55, 0.0, 1.0));

  // whitecaps grow with wind
  let cap = smoothstep(0.9 - w01 * 0.35, 1.15, h0) * (0.4 + 0.6 * vnoise(pw * 0.5 + vec2f(t * 0.6, 0.0)));
  c = mix(c, vec3f(0.62, 0.66, 0.68), cap * (0.25 + 0.55 * w01));

  // wind streaks — elongated noise aligned with the wind
  let perp = vec2f(-wdir.y, wdir.x);
  let streak = vnoise(vec2f(dot(pw, perp) * 0.55, dot(pw, wdir) * 0.045 - t * 0.5));
  c *= 0.94 + 0.12 * streak * (0.3 + 0.7 * w01);

  // drifting cloud shadows
  let cs = fbm(pw * 0.006 + wdir * t * 0.012, 3);
  c *= 0.82 + 0.28 * cs;

  return vec4f(c, 1.0);
}`

const ROCK = /* wgsl */`
fn visual_tr_rock(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [seed, 0, surgePhaseOffset, 0]
  let r = length(uv);
  if (r > 0.98) { return vec4f(0.0); }
  let ca = uv / max(r, 0.001);
  let seed = p.x;
  var rockR = 0.46 + 0.16 * (vnoise(ca * 2.1 + vec2f(seed * 9.0, seed * 4.0)) - 0.5) * 2.0;
  rockR += 0.07 * (vnoise(ca * 5.0 + vec2f(seed * 3.0, seed * 7.0)) - 0.5) * 2.0;

  var c = vec3f(0.0);
  var a = 0.0;
  let surge = sin(time * 1.25 + p.z * 6.28);

  if (r < rockR) {
    // craggy top-lit basalt; height falls toward the waterline
    let hgt = clamp((rockR - r) / rockR, 0.0, 1.0);
    let tex = fbm(uv * 9.0 + vec2f(seed * 20.0, 0.0), 4);
    c = mix(vec3f(0.055, 0.052, 0.050), vec3f(0.16, 0.145, 0.125), hgt * (0.5 + 0.5 * tex));
    // warm dusk grazing light from the west
    let sun2 = normalize(vec2f(-0.66, -0.30));
    let grad = vnoise(uv * 7.0 + vec2f(seed * 11.0, 3.0)) - vnoise(uv * 7.0 + sun2 * 0.25 + vec2f(seed * 11.0, 3.0));
    c += vec3f(0.55, 0.30, 0.16) * clamp(grad * 3.0, 0.0, 0.35) * hgt;
    // wet dark band at the waterline
    c *= mix(0.35, 1.0, smoothstep(0.02, 0.14, rockR - r));
    a = 1.0;
  } else {
    // breaking surf collar — swells on a slow pulse, textured foam
    let d = r - rockR;
    let foamN = vnoise(uv * 11.0 + vec2f(time * 0.7, seed * 8.0));
    var foam = exp(-d * d * 160.0) * (0.55 + 0.35 * surge) * (0.45 + 0.55 * foamN);
    foam += exp(-pow((d - 0.10 - 0.03 * surge) * 16.0, 2.0)) * 0.4 * foamN;
    c = vec3f(0.72, 0.75, 0.76) * foam * 1.25;
    a = clamp(foam * 1.15, 0.0, 1.0);
  }
  return vec4f(c, a);
}`

const LIGHT = /* wgsl */`
fn visual_tr_light(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [beamAngle, deliverGlow, 0, 0] — islet with tower, rotating beam, and a plank dock (south)
  let r = length(uv);
  var c = vec3f(0.0);
  var a = 0.0;

  // rotating beam wedge over the water (HDR, soft)
  let ang = atan2(uv.y, uv.x);
  var dAng = ang - p.x;
  dAng = atan2(sin(dAng), cos(dAng));
  let wedge = pow(max(cos(dAng), 0.0), 48.0);
  let reach = smoothstep(0.10, 0.30, r) * exp(-r * 1.6);
  c += vec3f(2.0, 1.5, 0.85) * wedge * reach * (1.1 + p.y * 1.4);
  a = max(a, clamp(wedge * reach * 2.0, 0.0, 0.55));

  // islet
  let rockR = 0.40 + 0.10 * (vnoise(uv / max(r, 0.001) * 2.4 + vec2f(4.0, 8.0)) - 0.5) * 2.0;
  if (r < rockR * 0.42) {
    let hgt = clamp((rockR * 0.42 - r) / (rockR * 0.42), 0.0, 1.0);
    let tex = fbm(uv * 8.0 + vec2f(13.0, 5.0), 4);
    c = mix(vec3f(0.06, 0.055, 0.05), vec3f(0.17, 0.15, 0.13), hgt * (0.5 + 0.5 * tex));
    c *= mix(0.4, 1.0, smoothstep(0.01, 0.08, rockR * 0.42 - r));
    a = 1.0;
  } else if (r < rockR * 0.42 + 0.10) {
    let d = r - rockR * 0.42;
    let foamN = vnoise(uv * 12.0 + vec2f(time * 0.7, 2.0));
    let foam = exp(-d * d * 220.0) * (0.6 + 0.3 * sin(time * 1.25)) * (0.5 + 0.5 * foamN);
    c = max(c, vec3f(0.72, 0.75, 0.76) * foam * 1.2);
    a = max(a, clamp(foam, 0.0, 1.0));
  }
  // dock: weathered planks running south
  let dq = uv - vec2f(0.02, 0.30);
  let dockD = sdBox(dq, vec2f(0.055, 0.22));
  if (dockD < 0.0) {
    let plank = 0.8 + 0.2 * sin(dq.y * 90.0);
    c = vec3f(0.30, 0.21, 0.13) * plank * (0.8 + 0.2 * vnoise(dq * 40.0));
    a = 1.0;
  }
  // tower: white drum, red lantern, warm halo
  if (r < 0.085) {
    let ring = smoothstep(0.085, 0.055, r);
    c = mix(vec3f(0.75, 0.72, 0.68), vec3f(0.9, 0.88, 0.84), ring);
    a = 1.0;
  }
  c += vec3f(3.0, 1.6, 0.6) * exp(-r * r * 300.0) * (1.0 + p.y * 2.0);
  return vec4f(c, a);
}`

const BOAT = /* wgsl */`
fn visual_tr_boat(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [heading, speed01, boomAngle, heel(-1..1)] — +x forward in boat frame
  let q = rotate(uv, -p.x);
  let spd = clamp(p.y, 0.0, 1.0);
  let sun2n = normalize(vec2f(-0.66, -0.30));
  let shD = rotate(-sun2n, -p.x) * 0.045;      // shadow cast away from the sun, in boat frame
  var c = vec3f(0.0);
  var a = 0.0;

  // ---- Kelvin wake ----
  if (q.x < 0.02 && spd > 0.04) {
    let wx = 0.02 - q.x;
    let wy = q.y;
    let slope = abs(wy) / max(wx, 0.002);
    let armD = abs(slope - 0.354) * wx;
    let arm = exp(-armD * armD * 800.0) * exp(-wx * 2.3);
    var trans = 0.0;
    if (slope < 0.354) {
      trans = (0.5 + 0.5 * sin(wx * (34.0 + 26.0 * (1.0 - spd)))) * exp(-wx * 2.8) * smoothstep(0.354, 0.12, slope);
    }
    let turb = exp(-wy * wy * 260.0) * exp(-wx * 3.0) * (0.55 + 0.45 * vnoise(vec2f(wx * 26.0 - time * 4.0 * spd, wy * 36.0)));
    let foam = (arm + turb * 0.95) * spd;
    c += vec3f(0.70, 0.76, 0.78) * foam * 1.25;
    c += vec3f(0.16, 0.22, 0.26) * trans * spd * 0.8;
    a = max(a, clamp(foam * 1.25 + trans * spd * 0.35, 0.0, 1.0) * 0.9);
  }

  // hull profile: pointed bow (+x), squared transom
  let hL = 0.34;
  let hW = 0.10;
  // ---- shadow on the water (hull + sail silhouette, offset from the sun) ----
  let sq = q - shD;
  let sxn = sq.x / hL;
  if (abs(sxn) < 1.0) {
    let wp = hW * sqrt(max(0.0, 1.0 - sxn * sxn)) * (1.0 - 0.45 * smoothstep(0.1, 1.0, sxn));
    if (abs(sq.y) < wp && sq.x > -hL * 0.94) {
      c = mix(c, vec3f(0.005, 0.012, 0.016), 0.55);
      a = max(a, 0.5);
    }
  }

  // ---- hull ----
  let hq = vec2f(q.x, q.y + p.w * 0.010);     // heel shifts the deck line
  let xn = hq.x / hL;
  if (abs(xn) < 1.0 && hq.x > -hL * 0.94) {
    let wProf = hW * sqrt(max(0.0, 1.0 - xn * xn)) * (1.0 - 0.45 * smoothstep(0.1, 1.0, xn));
    let dy = abs(hq.y);
    if (dy < wProf) {
      // teak deck, planked; brighter on the sunward rail (heel-aware)
      let plank = 0.85 + 0.15 * sin(hq.y * 260.0);
      var deck = vec3f(0.36, 0.26, 0.17) * plank * (0.85 + 0.15 * vnoise(hq * 80.0));
      let railLight = clamp(-hq.y * sign(p.w) * 10.0, -0.2, 0.35);
      deck *= 0.9 + railLight;
      // white gunwale
      let rail = smoothstep(wProf - 0.011, wProf - 0.004, dy);
      deck = mix(deck, vec3f(0.82, 0.80, 0.76), rail);
      // cabin house aft of the mast
      let cd = sdRoundedBox(hq - vec2f(-0.075, 0.0), vec2f(0.055, 0.032), 0.015);
      if (cd < 0.0) { deck = mix(vec3f(0.46, 0.35, 0.24), vec3f(0.55, 0.44, 0.30), 0.5 + 0.5 * sin(hq.x * 200.0)); }
      c = deck * (0.9 + 0.35 * clamp(dot(rotate(vec2f(1.0, 0.0), p.x), -sun2n), 0.0, 1.0));
      a = 1.0;
    }
    // bow spray
    if (xn > 0.55 && spd > 0.35) {
      let bq = hq - vec2f(hL, 0.0);
      let spray = exp(-dot(bq, bq) * 320.0) * spd * (0.5 + 0.5 * vnoise(hq * 60.0 + vec2f(time * 3.0, 0.0)));
      c += vec3f(0.75, 0.8, 0.82) * spray;
      a = max(a, clamp(spray, 0.0, 0.8));
    }
  }

  // ---- rig: mast, boom, canvas ----
  let mast = vec2f(0.075, 0.0);
  let boomAng = p.z;
  let tip = mast + vec2f(cos(3.14159 + boomAng), sin(3.14159 + boomAng)) * 0.27;  // boom sweeps aft
  // sail: curved panel from mast to boom tip, cambered to leeward
  let mid = (mast + tip) * 0.5 + vec2f(-(tip - mast).y, (tip - mast).x) * 0.16;
  let d1 = sdSegment(q, mast, mid);
  let d2 = sdSegment(q, mid, tip);
  let sailD = min(d1, d2);
  if (sailD < 0.020) {
    // cream dacron lit by the low sun
    let lit = 0.65 + 0.4 * clamp(dot(normalize(tip - mast), sun2n), -0.4, 1.0);
    c = vec3f(0.88, 0.84, 0.74) * lit;
    a = 1.0;
  }
  // boom shadow line on deck
  let bD = sdSegment(q, mast, tip);
  if (bD < 0.006) { c = mix(c, vec3f(0.06, 0.05, 0.04), 0.7); a = max(a, 0.9); }
  // mast head
  c += vec3f(0.9, 0.85, 0.75) * exp(-dot(q - mast, q - mast) * 2600.0);
  a = max(a, clamp(exp(-dot(q - mast, q - mast) * 2000.0), 0.0, 1.0));

  a *= smoothstep(1.0, 0.92, length(uv));
  return vec4f(c, a);
}`

const WHIRL = /* wgsl */`
fn visual_tr_whirl(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let r = length(uv);
  if (r > 0.97) { return vec4f(0.0); }
  let ang = atan2(uv.y, uv.x);
  let sang = ang + 4.2 * log(r + 0.13) + time * 0.9;
  let streak = pow(0.5 + 0.5 * sin(sang * 3.0), 2.0);
  // bowl darkening toward the drain
  var c = mix(vec3f(0.050, 0.115, 0.150), vec3f(0.008, 0.022, 0.032), smoothstep(0.75, 0.05, r));
  c *= 0.75 + 0.4 * streak;
  // sheared foam collar and inner filaments
  let foamN = vnoise(vec2f(sang * 2.0, r * 14.0 - time * 0.8));
  var foam = exp(-pow((r - 0.72) * 7.0, 2.0)) * (0.4 + 0.6 * foamN);
  foam += smoothstep(0.28, 0.05, r) * streak * 0.5 * foamN;
  c += vec3f(0.55, 0.60, 0.62) * foam;
  let a = smoothstep(0.95, 0.6, r) * 0.92;
  return vec4f(c, a);
}`

const SQUALL = /* wgsl */`
fn visual_tr_squall(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [windX, windY, intensity, 0]
  let r = length(uv);
  if (r > 0.98) { return vec4f(0.0); }
  var wdir = vec2f(p.x, p.y);
  if (length(wdir) < 0.1) { wdir = vec2f(1.0, 0.0); }
  wdir = normalize(wdir);
  let perp = vec2f(-wdir.y, wdir.x);
  let edge = smoothstep(0.95, 0.45, r);
  // grey rain veil
  var c = vec3f(0.115, 0.130, 0.145);
  var a = 0.38 * edge * p.z;
  // rain streaks driven along the wind
  let streak = vnoise(vec2f(dot(uv, perp) * 26.0, dot(uv, wdir) * 2.2 - time * 2.2));
  c += vec3f(0.10, 0.11, 0.12) * pow(streak, 3.0) * 2.0;
  // agitated water sheen beneath
  let churn = vnoise(uv * 14.0 + vec2f(time * 1.3, 0.0));
  c += vec3f(0.16, 0.18, 0.19) * churn * 0.35;
  a = clamp(a + pow(streak, 3.0) * 0.25 * edge, 0.0, 0.75);
  return vec4f(c, a);
}`

const RAFT = /* wgsl */`
fn visual_tr_raft(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [seed, 0, 0, hidden] — a lantern lashed to a small raft
  if (p.w > 0.5) { return vec4f(0.0); }
  let r = length(uv);
  var c = vec3f(0.0);
  var a = 0.0;
  // expanding ripple rings (slow)
  let rip = sin(r * 22.0 - time * 2.2 + p.x * 9.0) * exp(-r * 2.6);
  c += vec3f(0.10, 0.12, 0.13) * max(rip, 0.0) * 0.8;
  a = max(a, max(rip, 0.0) * 0.35);
  // raft planks
  let rq = rotate(uv, p.x * 6.0);
  if (sdBox(rq, vec2f(0.16, 0.11)) < 0.0) {
    c = vec3f(0.24, 0.17, 0.11) * (0.8 + 0.2 * sin(rq.y * 70.0));
    a = 1.0;
  }
  // warm lantern — gentle breathing, HDR for bloom
  let breathe = 0.85 + 0.15 * sin(time * 1.6 + p.x * 12.0);
  c += vec3f(2.6, 1.5, 0.55) * exp(-r * r * 60.0) * breathe;
  c += vec3f(1.2, 0.6, 0.2) * exp(-r * r * 9.0) * 0.5 * breathe;
  a = max(a, clamp(exp(-r * r * 20.0) * 1.3, 0.0, 1.0));
  return vec4f(c, a);
}`

const HUD = /* wgsl */`
fn visual_tr_hud(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  // p = [hull, cargo, windAngle, wind01] — quiet glass instruments, no chrome
  var c = vec3f(0.0);
  var a = 0.0;
  // wind rose: arrow rotated to where the wind blows
  let wq = rotate((uv - vec2f(-0.86, 0.0)) * vec2f(8.0, 3.6), -p.z);
  let tri = sdEquilateralTriangle(rotate(wq, 1.5708), 0.30);
  let ring = abs(length(wq) - 0.42);
  c += vec3f(0.75, 0.82, 0.88) * smoothstep(0.05, -0.02, tri) * (0.55 + 0.45 * p.w);
  c += vec3f(0.45, 0.55, 0.62) * smoothstep(0.03, 0.0, ring) * 0.5;
  a = max(a, smoothstep(0.05, -0.02, tri) * 0.85);
  a = max(a, smoothstep(0.03, 0.0, ring) * 0.4);
  // hull integrity: three small planks
  for (var i = 0; i < 3; i++) {
    let q = (uv - vec2f(-0.55 + f32(i) * 0.09, 0.0)) * vec2f(12.0, 5.0);
    let on = select(0.12, 1.0, f32(i) < p.x);
    let g = exp(-dot(q, q) * 2.0);
    c += vec3f(0.85, 0.55, 0.35) * g * on;
    a = max(a, g * 0.7);
  }
  // cargo lanterns aboard
  for (var i = 0; i < 4; i++) {
    let q = (uv - vec2f(0.30 + f32(i) * 0.09, 0.0)) * vec2f(12.0, 5.0);
    let on = select(0.10, 1.0, f32(i) < p.y);
    let g = exp(-dot(q, q) * 2.0);
    c += vec3f(1.6, 0.95, 0.35) * g * on;
    a = max(a, g * 0.75 * max(on, 0.25));
  }
  return vec4f(c, clamp(a, 0.0, 1.0) * 0.8);
}`

// ─────────────────────────────────────────────────────────────────────────────
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__tr) wd.__tr = {
    t: 0, score: 0, best: 0, hull: 3, cargo: 0, inv: 2,
    head: -1.57, trim: 0.5, vx: 0, vy: 0,
    windA: 0.6, windV: 6.0, over: 0, boom: 0.4, heel: 0,
    raftT: 3, deliverGlow: 0
  }
  const G = wd.__tr
  G.t += dt
  let boat = null, sea = null, hud = null, light = null, whirl = null
  const rocks = [], squalls = [], rafts = []
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Sloop')) boat = f
    else if (n.startsWith('Sea')) sea = f
    else if (n.startsWith('Rock')) rocks.push(f)
    else if (n.startsWith('Squall')) squalls.push(f)
    else if (n.startsWith('Raft')) rafts.push(f)
    else if (n.startsWith('Beacon')) light = f
    else if (n.startsWith('Maelstrom')) whirl = f
    else if (n.startsWith('TIDERUNNER')) hud = f
  }
  if (boat && sea) {
    const T = f => f.transform
    G.inv = Math.max(0, G.inv - dt)
    G.deliverGlow = Math.max(0, G.deliverGlow - dt * 0.8)

    // ── living wind: slow veer + strength swell ──
    G.windA += (Math.sin(G.t * 0.043 + 1.3) * 0.0016 + Math.sin(G.t * 0.011) * 0.0022) * 60 * dt
    G.windV = 5.6 + Math.sin(G.t * 0.031) * 1.6 + Math.min(G.score * 0.04, 2.0)
    const wdx = Math.cos(G.windA), wdy = Math.sin(G.windA)

    // squalls drift downwind and wrap; gust if the boat is inside
    let gust = 1.0
    for (const s of squalls) {
      T(s).x += wdx * 9 * dt; T(s).y += wdy * 9 * dt
      if (T(s).x < -80) T(s).x += 672; if (T(s).x > 592) T(s).x -= 672
      if (T(s).y < -80) T(s).y += 672; if (T(s).y > 592) T(s).y -= 672
      T(s).vx = 0; T(s).vy = 0
      const d = Math.hypot(T(boat).x - T(s).x, T(boat).y - T(s).y)
      if (d < 78) gust = Math.max(gust, 1.55 + 0.35 * Math.sin(G.t * 1.9))
      s.visualParams = [wdx, wdy, 1, 0]
    }

    // ── helm & trim ──
    const fwd = [Math.cos(G.head), Math.sin(G.head)]
    const fwdSpd = G.vx * fwd[0] + G.vy * fwd[1]
    const turnRate = (1.55 - G.cargo * 0.10) * (0.35 + Math.min(Math.abs(fwdSpd) / 55, 1.0))
    if (wd.key_a) G.head -= turnRate * dt
    if (wd.key_d) G.head += turnRate * dt
    if (wd.key_w) G.trim = Math.min(1, G.trim + 0.9 * dt)
    if (wd.key_s) G.trim = Math.max(0.05, G.trim - 0.9 * dt)
    if (wd.key_space) G.trim = Math.max(0.05, G.trim - 3.5 * dt)   // let fly

    // ── sail physics: no-go zone, trim matching, heel ──
    const windFrom = G.windA + Math.PI
    let off = G.head - windFrom
    while (off > Math.PI) off -= 2 * Math.PI
    while (off < -Math.PI) off += 2 * Math.PI
    const offA = Math.abs(off)                       // 0 = in irons, PI = dead run
    const smoothstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u) }
    const eff = smoothstep(0.42, 0.85, offA) * (0.55 + 0.45 * Math.sin(Math.min(offA, 2.1)))
    const idealTrim = Math.min(1, Math.max(0.15, offA / Math.PI))
    const trimPen = 1 - Math.min(Math.abs(G.trim - idealTrim) * 2.0, 0.85)
    const wPow = G.windV * gust
    const drive = wPow * 13.5 * eff * trimPen
    G.heel = Math.min(1.45, (wPow / 6) * G.trim * Math.sin(Math.min(offA, 2.4)) * 1.05) * (off > 0 ? 1 : -1)

    // broach: over-canvassed too long → rounded up, cargo overboard
    if (Math.abs(G.heel) > 1.0) G.over += dt; else G.over = Math.max(0, G.over - dt * 2)
    if (G.over > 0.9) {
      G.over = 0; G.trim = 0.25
      G.head = windFrom + (off > 0 ? 0.5 : -0.5)
      G.vx *= 0.35; G.vy *= 0.35
      if (G.cargo > 0) {
        G.cargo--
        const r = rafts.find(q => q.visualParams && q.visualParams[3] > 0.5)
        if (r) { T(r).x = T(boat).x - fwd[0] * 30; T(r).y = T(boat).y - fwd[1] * 30; r.visualParams = [Math.random(), 0, 0, 0]; r.properties.set('ttl', 60) }
      }
    }

    // ── integrate ──
    G.vx += fwd[0] * drive * dt; G.vy += fwd[1] * drive * dt
    const dragK = 0.62 + G.cargo * 0.05
    G.vx -= G.vx * dragK * dt; G.vy -= G.vy * dragK * dt
    // leeway + wave push
    G.vx += -fwd[1] * G.heel * 6.5 * dt; G.vy += fwd[0] * G.heel * 6.5 * dt
    G.vx += wdx * 2.2 * dt; G.vy += wdy * 2.2 * dt
    // maelstrom pull
    if (whirl) {
      const mx = T(whirl).x - T(boat).x, my = T(whirl).y - T(boat).y
      const md = Math.hypot(mx, my) || 1
      if (md < 165) {
        const pull = 5200 / (md * md)
        G.vx += (mx / md) * pull; G.vy += (my / md) * pull
        G.vx += (-my / md) * pull * 0.55; G.vy += (mx / md) * pull * 0.55
        if (md < 26 && G.inv <= 0) { hullHit(mx, my, md, 1) }
      }
      whirl.visualParams = [1, 0, 0, 0]
    }
    const spd = Math.hypot(G.vx, G.vy)
    const cap2 = 95 + 20 * (gust - 1)
    if (spd > cap2) { G.vx *= cap2 / spd; G.vy *= cap2 / spd }
    T(boat).x += G.vx * dt; T(boat).y += G.vy * dt
    T(boat).x = Math.max(14, Math.min(498, T(boat).x))
    T(boat).y = Math.max(14, Math.min(498, T(boat).y))
    T(boat).vx = 0; T(boat).vy = 0

    // ── rocks: hard contact ──
    function hullHit(nx, ny, nd, soft) {
      G.hull--; G.inv = 2.2
      G.vx -= (nx / nd) * (soft ? 60 : 85); G.vy -= (ny / nd) * (soft ? 60 : 85)
      if (G.hull <= 0) {
        G.hull = 3; G.cargo = 0; G.score = Math.max(0, G.score - 5)
        T(boat).x = 412; T(boat).y = 205; G.vx = 0; G.vy = 0; G.head = 1.9; G.trim = 0.3; G.inv = 3
      }
    }
    for (const rk of rocks) {
      const rr = (rk.properties.get('rr') || 26)
      const rx = T(boat).x - T(rk).x, ry = T(boat).y - T(rk).y
      const rd2 = Math.hypot(rx, ry) || 1
      if (rd2 < rr && G.inv <= 0) {
        hullHit(-rx, -ry, rd2, 0)
        const vn = (G.vx * rx + G.vy * ry) / rd2
        if (vn < 0) { G.vx -= 1.6 * vn * rx / rd2; G.vy -= 1.6 * vn * ry / rd2 }
      }
      T(rk).vx = 0; T(rk).vy = 0
    }
    // beacon islet is rock too
    if (light) {
      const lx = T(boat).x - T(light).x, ly = T(boat).y - T(light).y
      const ld = Math.hypot(lx, ly) || 1
      if (ld < 34 && G.inv <= 0) hullHit(-lx, -ly, ld, 0)
      light.visualParams = [G.t * 0.55, G.deliverGlow, 0, 0]
      T(light).vx = 0; T(light).vy = 0
    }

    // ── lantern rafts: spawn, drift, collect, deliver ──
    G.raftT -= dt
    const active = rafts.filter(r => r.visualParams && r.visualParams[3] < 0.5).length
    if (G.raftT <= 0 && active < 4) {
      const r = rafts.find(q => q.visualParams && q.visualParams[3] > 0.5)
      if (r) {
        let ok = false, x = 0, y = 0, tries = 0
        while (!ok && tries < 12) {
          tries++
          x = 60 + Math.random() * 392; y = 60 + Math.random() * 392
          ok = true
          for (const rk of rocks) if (Math.hypot(x - T(rk).x, y - T(rk).y) < 70) ok = false
          if (light && Math.hypot(x - T(light).x, y - T(light).y) < 90) ok = false
          if (whirl && Math.hypot(x - T(whirl).x, y - T(whirl).y) < 100) ok = false
        }
        T(r).x = x; T(r).y = y; T(r).vx = 0; T(r).vy = 0
        r.visualParams = [Math.random(), 0, 0, 0]
        r.properties.set('ttl', 45)
      }
      G.raftT = 8
    }
    for (const r of rafts) {
      if (!r.visualParams || r.visualParams[3] > 0.5) continue
      const ttl = (r.properties.get('ttl') || 0) - dt
      r.properties.set('ttl', ttl)
      T(r).x += wdx * 3.5 * dt; T(r).y += wdy * 3.5 * dt
      T(r).vx = 0; T(r).vy = 0
      if (ttl <= 0) { r.visualParams = [0, 0, 0, 1]; T(r).x = 8; T(r).y = 8; continue }
      if (G.cargo < 4 && Math.hypot(T(boat).x - T(r).x, T(boat).y - T(r).y) < 24) {
        G.cargo++; r.visualParams = [0, 0, 0, 1]; T(r).x = 8; T(r).y = 8
      }
    }
    // deliver at the dock (south of the beacon)
    if (light && G.cargo > 0) {
      const dkx = T(light).x + 4, dky = T(light).y + 54
      if (Math.hypot(T(boat).x - dkx, T(boat).y - dky) < 30 && spd < 45) {
        G.score += G.cargo * (G.cargo + 1) / 2
        if (G.score > G.best) G.best = G.score
        G.cargo = 0; G.deliverGlow = 1
      }
    }

    // ── boom geometry & visuals ──
    const side = off > 0 ? 1 : -1
    const boomTarget = side * (0.25 + (1 - G.trim) * 0.5 + (offA / Math.PI) * 0.55)
    G.boom += (boomTarget - G.boom) * Math.min(1, dt * 5)
    boat.visualParams = [G.head, Math.min(1, spd / 80), G.boom, G.heel]
    sea.visualParams = [wdx, wdy, Math.min(1, (G.windV * gust - 4) / 6), 0]
    if (hud) {
      hud.visualParams = [G.hull, G.cargo, G.windA, Math.min(1, (G.windV - 4) / 5)]
      hud.name = 'TIDERUNNER \\u00b7 ' + G.score + ' \\u00b7 best ' + G.best + (G.inv > 0 ? ' \\u00b7 hull!' : '')
    }
  }
} catch (e) { /* keep the sim alive */ }
`

// ─────────────────────────────────────────────────────────────────────────────
const field = (id, name, color, x, y, shape, visualTypeName, vp, props) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: props || {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
  ...(vp ? { visualParams: vp } : {}),
})

const HIDDEN = [0, 0, 0, 1]
const fields = [
  field('tr_sea_f', 'Sea', [0.02, 0.05, 0.07, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'tr_sea', [1, 0, 0.4, 0]),
  field('tr_whirl_f', 'Maelstrom', [0.01, 0.03, 0.04, 1], 150, 400, { shapeType: 'circle', radius: 62 }, 'tr_whirl', [1, 0, 0, 0]),
  field('tr_rock_1', 'Rock West', [0.1, 0.09, 0.08, 1], 120, 150, { shapeType: 'circle', radius: 56 }, 'tr_rock', [0.23, 0, 0.0, 0], { rr: 30 }),
  field('tr_rock_2', 'Rock Mid', [0.1, 0.09, 0.08, 1], 300, 290, { shapeType: 'circle', radius: 48 }, 'tr_rock', [0.61, 0, 0.35, 0], { rr: 25 }),
  field('tr_rock_3', 'Rock South', [0.1, 0.09, 0.08, 1], 90, 330, { shapeType: 'circle', radius: 44 }, 'tr_rock', [0.87, 0, 0.7, 0], { rr: 23 }),
  field('tr_squall_1', 'Squall A', [0.06, 0.07, 0.08, 1], 430, 380, { shapeType: 'circle', radius: 80 }, 'tr_squall', [1, 0, 1, 0]),
  field('tr_squall_2', 'Squall B', [0.06, 0.07, 0.08, 1], 60, 60, { shapeType: 'circle', radius: 72 }, 'tr_squall', [1, 0, 1, 0]),
  field('tr_light_f', 'Beacon', [0.9, 0.8, 0.6, 1], 408, 118, { shapeType: 'circle', radius: 95 }, 'tr_light', [0, 0, 0, 0]),
]
for (let i = 1; i <= 6; i++) {
  fields.push(field(`tr_raft_${i}`, `Raft ${i}`, [1, 0.8, 0.4, 1], 8, 8, { shapeType: 'circle', radius: 16 }, 'tr_raft', HIDDEN))
}
fields.push(field('tr_boat_f', 'Sloop', [0.5, 0.4, 0.3, 1], 412, 205, { shapeType: 'circle', radius: 60 }, 'tr_boat', [1.9, 0, 0.4, 0]))
fields.push(field('tr_hud_f', 'TIDERUNNER · A/D helm · W/S trim · SPACE let fly', [0.8, 0.85, 0.9, 1], 256, 22, { shapeType: 'rect', w: 340, h: 30 }, 'tr_hud', [3, 0, 0, 0.4]))

const scene = {
  name: 'TIDERUNNER',
  fields,
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0.4, gravitationalConstant: 0 },
  worldData: { noPixelSampling: true },
  stepHooks: [{ id: 'tiderunner_core', author: 'fable', description: 'TIDERUNNER: sailing physics (tack/trim/heel/broach), squall gusts, maelstrom, rafts & dock delivery', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'tr_sea', wgsl: SEA },
    { name: 'tr_whirl', wgsl: WHIRL },
    { name: 'tr_rock', wgsl: ROCK },
    { name: 'tr_squall', wgsl: SQUALL },
    { name: 'tr_light', wgsl: LIGHT },
    { name: 'tr_raft', wgsl: RAFT },
    { name: 'tr_boat', wgsl: BOAT },
    { name: 'tr_hud', wgsl: HUD },
  ],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'TIDERUNNER', scene }),
})
console.log('TIDERUNNER saved:', res.status, await res.text())
