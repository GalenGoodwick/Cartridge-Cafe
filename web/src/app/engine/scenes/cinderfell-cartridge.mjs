// CINDERFELL — a physical side-view game world (the "larger game" architecture demo).
// You are a cinder: a heavy iron sphere with a living ember core, alone on a
// windswept fell at blue dusk. Real physics — gravity, slope collision, momentum,
// wind that shoves you — and one long ask: carry your fire east and light the
// five cold beacons. Speed stokes the ember; the wind starves it; a beacon can
// only catch from a cinder that still burns.
//
//   ← → / A D   roll (torque along the ground; weaker in the air)
//   SPACE       leap — the jump fires along the slope's normal, so hills aim you
//
// ARCHITECTURE (the parent/sub shader pattern, spelled out):
//   · PARENT module `cf_lib` (mod_cf_*): terrain height field, sky, flame,
//     snow, lighting — shared WGSL any visual can call. The terrain function
//     mod_cf_h(x) is duplicated LINE FOR LINE in the JS step hook: the same
//     math renders the mountain and collides the ball. One truth, two callers.
//   · SUB shader `visual_cinderfell`: one fullscreen field that composes the
//     parent modules into parallax ridges + gameplay terrain + ball + weather.
//   · WHITEBOARD (worldData.gpuUniforms, 64 floats): the hook simulates, the
//     shader only reads. All cross-layer state crosses here.
//   · STEP HOOK: physics, input, wind, beacons, chapters, synthesized sound.
//
//   Run:  CF_TOKEN=uc_st_... node cinderfell-cartridge.mjs
//
// ── whiteboard layout ──
//   0 t        1 ballX    2 ballY    3 roll     4 vx       5 vy
//   6 grounded 7 heat01   8 camX     9 camY     10 wind    11 dawn01
//   12 warmth  13-17 beaconLit[5]   18 jumpP   19 landP   20 stoke01
//   21 finale  22 onIce   23 hungryFlash       24 introFade

const TOKEN = process.env.CF_TOKEN
if (!TOKEN) { console.error('CF_TOKEN required'); process.exit(1) }
const URL = process.env.CF_URL || 'https://cartridge.cafe/api/engine/bridge'

async function send(cmd, label) {
  const body = Array.isArray(cmd) ? { commands: cmd } : cmd
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
  const t = await r.text()
  console.log(label || (Array.isArray(cmd) ? 'batch' : cmd.type), r.status, t.slice(0, 200))
  if (!r.ok) throw new Error(`${label}: ${r.status} ${t.slice(0, 400)}`)
  return JSON.parse(t)
}

// ───────────────────────────────────────────────── PARENT module: cf_lib ──
// Everything here is a shared function. The visual below is only composition.
const LIB = /* wgsl */`
// ── noise kit ──
fn mod_cf_hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn mod_cf_vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mod_cf_hash(i), mod_cf_hash(i + vec2f(1.0, 0.0)), u.x),
             mix(mod_cf_hash(i + vec2f(0.0, 1.0)), mod_cf_hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn mod_cf_fbm(p: vec2f) -> f32 {
  var v = 0.0; var a = 0.5; var q = p;
  for (var i = 0; i < 4; i++) {
    v += a * mod_cf_vnoise(q);
    q = q * 2.03 + vec2f(17.0, 9.2);
    a *= 0.5;
  }
  return v;
}
fn mod_cf_sm01(t: f32) -> f32 { let c = clamp(t, 0.0, 1.0); return c * c * (3.0 - 2.0 * c); }

// ── THE TERRAIN — the one truth. Mirrored exactly in the JS hook. ──
fn mod_cf_h(x: f32) -> f32 {
  var h = 90.0 * sin(x * 0.0021 + 1.7)
        + 55.0 * sin(x * 0.0047 + 0.4)
        + 26.0 * sin(x * 0.0089 + 3.1)
        + 11.0 * sin(x * 0.0173 + 5.2);
  h = mix(h, 10.0, exp(-(x * x) / 25600.0));                       // the start pad
  let tm = mod_cf_sm01((x - 1840.0) / 120.0) * (1.0 - mod_cf_sm01((x - 2320.0) / 120.0));
  h = mix(h, -30.0, tm * 0.92);                                    // the frozen tarn
  h += 130.0 * exp(-((x - 3050.0) * (x - 3050.0)) / 22500.0);      // the scarp
  // hearth terraces: flat ground under each beacon, so a rolling iron ball can
  // actually PARK for the handoff (levels precomputed from the base curve)
  h = mix(h, 19.5, 0.9 * exp(-((x - 620.0) * (x - 620.0)) / 6400.0));
  h = mix(h, -56.0, 0.9 * exp(-((x - 1520.0) * (x - 1520.0)) / 6400.0));
  h = mix(h, -31.7, 0.9 * exp(-((x - 2290.0) * (x - 2290.0)) / 6400.0));
  h = mix(h, 54.1, 0.9 * exp(-((x - 3390.0) * (x - 3390.0)) / 6400.0));
  h = mix(h, -33.2, 0.9 * exp(-((x - 4250.0) * (x - 4250.0)) / 6400.0));
  return h;
}
fn mod_cf_ice(x: f32) -> f32 {
  return mod_cf_sm01((x - 1840.0) / 120.0) * (1.0 - mod_cf_sm01((x - 2320.0) / 120.0));
}
fn mod_cf_dh(x: f32) -> f32 { return (mod_cf_h(x + 2.0) - mod_cf_h(x - 2.0)) * 0.25; }

fn mod_cf_beaconX(i: i32) -> f32 {
  if (i == 0) { return 620.0; }
  if (i == 1) { return 1520.0; }
  if (i == 2) { return 2290.0; }
  if (i == 3) { return 3390.0; }
  return 4250.0;
}

// ── sky: deep dusk → dawn. y01: 0 horizon, 1 zenith. ──
fn mod_cf_sky(x: f32, y01: f32, t: f32, dawn: f32, warmth: f32) -> vec3f {
  let y = clamp(y01, 0.0, 1.0);
  // dusk: indigo zenith, cold teal band, a dying amber seam where the sun sank
  let zenD = vec3f(0.010, 0.016, 0.045);
  let horD = vec3f(0.055, 0.10, 0.16);
  var c = mix(horD, zenD, pow(y, 0.62));
  c += vec3f(0.30, 0.12, 0.03) * exp(-y * 7.0) * (0.35 + 0.2 * warmth) * (1.0 - dawn);
  // dawn floods from the east (the direction of travel — the fire you lit)
  let sunY = mix(-0.14, 0.16, dawn);
  let sd = length(vec2f((x - 4250.0) * 0.00042, (y - sunY) * 1.35));
  let dawnZen = vec3f(0.18, 0.32, 0.55);
  let dawnHor = vec3f(1.05, 0.55, 0.22);
  let cDawn = mix(dawnHor, dawnZen, pow(y, 0.55));
  c = mix(c, cDawn, dawn);
  c += vec3f(1.35, 0.85, 0.45) * exp(-sd * 5.5) * dawn * 1.6;      // glow
  c += vec3f(2.6, 1.9, 1.2) * smoothstep(0.05, 0.012, sd) * dawn;  // the disc
  // stars — round points in isotropic cells (aniso cells smear them to dashes)
  let sp = vec2f(x, y01 * 470.0) * 0.24;
  let sid = floor(sp);
  let s = mod_cf_hash(sid);
  let soff = (vec2f(mod_cf_hash(sid + 3.0), mod_cf_hash(sid + 9.0)) - 0.5) * 0.6;
  let sdd = length(fract(sp) - 0.5 - soff);
  let tw = 0.55 + 0.45 * sin(t * (1.5 + s * 3.0) + s * 40.0);
  c += vec3f(0.75, 0.82, 1.0) * smoothstep(0.965, 0.998, s) * smoothstep(0.30, 0.04, sdd) * tw * y * (1.0 - dawn) * 0.9;
  return c;
}

// ── flame: a living fbm tongue in a unit box (0..1, y up from the base) ──
fn mod_cf_flame(q: vec2f, t: f32, seed: f32) -> vec3f {
  if (q.y < -0.05 || q.y > 1.25 || abs(q.x) > 0.55) { return vec3f(0.0); }
  let wob = mod_cf_fbm(vec2f(q.x * 3.0 + seed, q.y * 2.6 - t * 2.2 + seed)) - 0.5;
  let xx = q.x + wob * 0.38 * q.y;
  let width = 0.30 * (1.0 - q.y * 0.78);
  let body = smoothstep(width, width * 0.25, abs(xx)) * smoothstep(1.18, 0.55, q.y) * smoothstep(-0.04, 0.10, q.y);
  let core = smoothstep(width * 0.5, 0.0, abs(xx)) * smoothstep(0.75, 0.1, q.y);
  return vec3f(1.60, 0.55, 0.12) * body * 1.4 + vec3f(2.6, 1.9, 0.9) * core;
}

// ── snow: one drifting layer; call per depth. wind bends the fall. ──
fn mod_cf_snow(px: vec2f, t: f32, wind: f32, scale: f32, speed: f32, dawn: f32) -> f32 {
  let drift = vec2f(t * (wind * 0.35 * speed), t * 46.0 * speed);
  let g = (px + drift) / scale;
  let id = floor(g);
  let f = fract(g) - 0.5;
  let r = mod_cf_hash(id);
  if (r < 0.82) { return 0.0; }
  let off = vec2f(mod_cf_hash(id + 7.0) - 0.5, mod_cf_hash(id + 13.0) - 0.5) * 0.6;
  let d = length(f - off);
  let tw = 0.7 + 0.3 * sin(t * 3.0 + r * 50.0);
  return smoothstep(0.10, 0.02, d) * tw * (1.0 - dawn * 0.85);
}

// ── terrain shading: material by height/slope, warm light from fires ──
fn mod_cf_ground(wp: vec2f, t: f32, heat: f32, bx: f32, by: f32, dawn: f32, warmth: f32) -> vec3f {
  let hh = mod_cf_h(wp.x);
  let depth = hh - wp.y;                       // how far below the surface
  let slope = abs(mod_cf_dh(wp.x));
  let ice = mod_cf_ice(wp.x);
  // base materials: frost-grass on the gentle, dark basalt on the steep
  let rockN = mod_cf_fbm(wp * 0.030);
  let fineN = mod_cf_fbm(wp * 0.14);
  var mat = mix(vec3f(0.055, 0.075, 0.075), vec3f(0.035, 0.036, 0.046), mod_cf_sm01(slope * 1.9 - 0.15));
  mat *= 0.75 + 0.5 * rockN;
  // snow cap: on gentle ground, hugging the surface
  let snowBand = mod_cf_sm01(1.0 - slope * 2.1) * mod_cf_sm01(1.0 - depth * 0.05) * (0.55 + 0.45 * fineN);
  mat = mix(mat, vec3f(0.42, 0.47, 0.56), snowBand * 0.85 * (1.0 - ice));
  // the tarn: black ice, glassy, faint teal depths
  let iceCol = mix(vec3f(0.020, 0.05, 0.065), vec3f(0.10, 0.20, 0.24), smoothstep(3.0, 0.0, depth));
  mat = mix(mat, iceCol * (0.8 + 0.4 * fineN), ice);
  // surface line brightens, depths fall to dark
  mat *= mix(1.0, 0.25, mod_cf_sm01(depth * 0.02));
  mat *= 1.0 + 1.4 * exp(-depth * 0.40);
  // ambient: cold dusk → warm dawn
  var c = mat * mix(vec3f(0.45, 0.60, 0.85), vec3f(1.15, 0.95, 0.80), dawn) * (0.9 + warmth * 0.25);
  // the cinder's own light — the whole point of carrying it
  let bd = distance(wp, vec2f(bx, by));
  c += mat * vec3f(1.5, 0.75, 0.28) * (heat * 130.0 / (bd * bd * 0.02 + 30.0)) * exp(-depth * 0.10);
  // every lit beacon is a hearth
  for (var i = 0; i < 5; i++) {
    let lit = uni(13 + i);
    if (lit > 0.01) {
      let fx = mod_cf_beaconX(i);
      let fp = vec2f(fx, mod_cf_h(fx) + 34.0);
      let fd = distance(wp, fp);
      let flick = 0.85 + 0.15 * sin(t * 9.0 + f32(i) * 11.0);
      c += mat * vec3f(1.5, 0.8, 0.3) * (lit * flick * 200.0 / (fd * fd * 0.02 + 40.0)) * exp(-depth * 0.10);
    }
  }
  // ice glint under any light
  c += vec3f(0.5, 0.8, 0.9) * ice * smoothstep(1.2, 0.0, depth) * (0.10 + 0.25 * smoothstep(120.0, 0.0, abs(wp.x - bx)) * heat);
  return c;
}

// ── a far ridge line (parallax) — same parent terrain, remixed ──
fn mod_cf_ridge(wp: vec2f, xo: f32, amp: f32, base: f32, col: vec3f, sky: vec3f) -> vec4f {
  let h = mod_cf_h(wp.x * 0.52 + xo) * amp + base;
  let d = wp.y - h;
  let m = smoothstep(2.0, -2.0, d);
  let fade = mix(col, sky, mod_cf_sm01((wp.y - h) * -0.004));   // haze toward its own depths
  return vec4f(fade, m);
}
`

// ─────────────────────────────────────────────── SUB shader: the composer ──
const VISUAL = /* wgsl */`
fn visual_cinderfell(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = uni(0);
  // superimposed compute path: +uv.y points DOWN — flip into y-up world space
  let su = vec2f(uv.x, -uv.y);
  let camX = uni(8); let camY = uni(9);
  let HALF = 300.0;
  let wp = vec2f(camX + su.x * HALF, camY + su.y * HALF);
  let px = (uv * 0.5 + 0.5) * 512.0;
  let dawn = uni(11); let warmth = uni(12); let wind = uni(10);
  let bx = uni(1); let by = uni(2); let heat = uni(7);

  // ── sky ──
  let y01 = clamp((wp.y + 120.0) / 520.0, 0.0, 1.0);
  var c = mod_cf_sky(wp.x, y01, t, dawn, warmth);

  // ── parallax ridges (parent module remixes; each hazier than the last) ──
  let farWp = vec2f(camX * 0.35 + su.x * HALF, camY * 0.5 + su.y * HALF);
  let r1 = mod_cf_ridge(farWp, 5200.0, 1.5, -30.0, mix(vec3f(0.028, 0.045, 0.085), vec3f(0.35, 0.30, 0.34), dawn), c);
  c = mix(c, r1.rgb, r1.a * 0.85);
  let midWp = vec2f(camX * 0.62 + su.x * HALF, camY * 0.72 + su.y * HALF);
  let r2 = mod_cf_ridge(midWp, 2600.0, 1.15, -70.0, mix(vec3f(0.020, 0.030, 0.055), vec3f(0.22, 0.17, 0.20), dawn), c);
  c = mix(c, r2.rgb, r2.a * 0.92);

  // ── back snow (falls behind the near ground) ──
  c += vec3f(0.7, 0.78, 0.95) * mod_cf_snow(px + vec2f(camX * 0.4, -camY * 0.4), t, wind, 34.0, 0.6, dawn) * 0.35;

  // ── the gameplay terrain — the exact surface the ball collides with ──
  let hNear = mod_cf_h(wp.x);
  let dg = wp.y - hNear;
  let aa = HALF / 256.0;
  let gm = smoothstep(aa, -aa, dg);
  if (gm > 0.001) {
    let g = mod_cf_ground(wp, t, heat, bx, by, dawn, warmth);
    c = mix(c, g, gm);
  }

  // ── beacons: cairn, brazier, rune or fire ──
  for (var i = 0; i < 5; i++) {
    let fx = mod_cf_beaconX(i);
    if (abs(wp.x - fx) > 90.0) { continue; }
    let fh = mod_cf_h(fx);
    let lp = wp - vec2f(fx, fh);
    let lit = uni(13 + i);
    // stacked stones: three fading slabs
    let s1 = length((lp - vec2f(0.0, 6.0)) / vec2f(20.0, 7.5));
    let s2 = length((lp - vec2f(1.5, 16.0)) / vec2f(14.0, 6.5));
    let s3 = length((lp - vec2f(-1.0, 25.0)) / vec2f(9.0, 5.5));
    let stone = min(s1, min(s2, s3));
    if (stone < 1.0) {
      let sh = 0.030 + 0.02 * mod_cf_fbm(wp * 0.2);
      c = mix(c, vec3f(sh, sh, sh * 1.3) * (1.0 + heat * 60.0 / (dot(lp, lp) * 0.02 + 30.0) + lit * 2.0), smoothstep(1.0, 0.88, stone));
    }
    // the bowl
    let bowl = length((lp - vec2f(0.0, 31.0)) / vec2f(11.0, 3.4));
    if (bowl < 1.0) { c = mix(c, vec3f(0.05, 0.04, 0.04) + vec3f(0.9, 0.4, 0.1) * lit, smoothstep(1.0, 0.85, bowl)); }
    if (lit > 0.01) {
      // FIRE — parent flame module, sized by how lit it is
      let q = vec2f(lp.x / 26.0, (lp.y - 33.0) / (30.0 * (0.4 + 0.6 * lit)));
      c += mod_cf_flame(q, t, f32(i) * 7.7) * lit;
    } else {
      // dormant rune ring — hungry flicker when a cold cinder is near
      let rr = abs(length(lp - vec2f(0.0, 34.0)) - 7.0);
      let hungry = uni(23) * smoothstep(140.0, 40.0, abs(bx - fx));
      let pulse = 0.35 + 0.25 * sin(t * 2.0 + f32(i) * 3.0) + hungry * (0.5 * sin(t * 24.0));
      c += vec3f(0.25, 0.55, 0.85) * smoothstep(2.2, 0.4, rr) * max(pulse, 0.0) * (1.0 - dawn);
    }
  }

  // ── THE CINDER ──
  let lp = wp - vec2f(bx, by);
  let bd = length(lp);
  let R = 14.0;
  // ember glow — HDR, breathes with heat, bloom does the rest
  let breathe = 0.9 + 0.1 * sin(t * 3.4);
  c += vec3f(1.6, 0.62, 0.15) * (heat * breathe * 55.0 / (bd * bd * 0.06 + 22.0));
  if (bd < R + 1.2) {
    // iron crust, rotated by the roll — cracks leak the core
    let roll = uni(3);
    let ca = cos(roll); let sa = sin(roll);
    let rp = vec2f(lp.x * ca - lp.y * sa, lp.x * sa + lp.y * ca);
    let crack = mod_cf_fbm(rp * 0.16 + 3.7);
    let vein = smoothstep(0.46, 0.52, crack) * smoothstep(0.60, 0.54, crack);
    var bc = vec3f(0.030, 0.028, 0.032) * (0.7 + 0.6 * mod_cf_fbm(rp * 0.5));
    bc += vec3f(2.6, 0.85, 0.16) * vein * (0.15 + heat * 1.6) * breathe;
    let coreG = smoothstep(R * 0.55, 0.0, bd);
    bc += vec3f(2.2, 0.7, 0.12) * coreG * heat * 0.7;
    // cold rim from the sky, warm rim from travel direction
    let rim = smoothstep(R - 3.0, R, bd);
    bc += vec3f(0.25, 0.35, 0.55) * rim * (1.0 - dawn * 0.5);
    c = mix(c, bc, smoothstep(R + 1.2, R - 1.2, bd));
  }
  // sparks when the ember is being stoked — streaks trailing the motion
  let stoke = uni(20);
  if (stoke > 0.02 && bd < 90.0 && bd > R) {
    let vx = uni(4);
    let back = vec2f(lp.x + sign(vx) * bd * 0.5, lp.y - bd * 0.18);
    let sp = mod_cf_hash(floor(back * 0.5 + vec2f(0.0, t * 9.0)));
    c += vec3f(2.2, 1.1, 0.25) * smoothstep(0.93, 0.995, sp) * stoke * smoothstep(90.0, 20.0, bd);
  }

  // ── front snow, wind-bent, heaviest before dawn ──
  c += vec3f(0.85, 0.9, 1.05) * mod_cf_snow(px + vec2f(camX * 1.6, -camY * 1.6), t, wind, 60.0, 1.0, dawn) * 0.8;
  c += vec3f(0.7, 0.75, 0.9) * mod_cf_snow(px + vec2f(camX * 1.0, -camY), t + 40.0, wind, 45.0, 0.8, dawn) * 0.5;

  // intro fade from black
  c *= uni(24);
  return vec4f(c, 1.0);
}
`

// ───────────────────────────────────────────────────────── the step hook ──
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__cf || wd.__cf.v !== 1) wd.__cf = {
    v: 1, t: 0, x: 0, y: 60, vx: 0, vy: 0, roll: 0, heat: 1,
    grounded: 0, camX: 0, camY: 40, lit: [0, 0, 0, 0, 0], litAnim: [0, 0, 0, 0, 0],
    dawn: 0, warmth: 0, jumpP: 0, landP: 0, stoke: 0, hungry: 0, intro: 0,
    gustT: 3, gustA: 0, gustSign: -1, wind: 0, wasDown: false, airT: 0
  }
  const G = wd.__cf
  // worldData persists — a session that dies mid-keypress leaves key_*=true
  // forever (and the state RESTORE can resurrect it over any one-shot clear).
  // Watchdog: a key "held" with no fresh press-pulse (_n unchanged) for 8s is
  // a ghost, not a finger. Clear it. Real holds re-press; scripts tap shorter.
  if (!G.kw) G.kw = {}
  const step = Math.min(dt, 1 / 30)
  for (const k of ['key_left', 'key_right', 'key_up', 'key_down', 'key_space', 'key_a', 'key_d', 'key_w']) {
    const n = wd[k + '_n'] || 0
    const w = G.kw[k] || (G.kw[k] = { n: -1, t: 0 })
    if (!wd[k]) { w.n = n; w.t = 0; continue }
    if (n !== w.n) { w.n = n; w.t = 0; continue }   // fresh press — legit
    w.t += step
    if (w.t > 8) { wd[k] = false; w.t = 0 }
  }
  G.t += step
  G.intro = Math.min(1, G.intro + step * 0.5)

  // ── THE TERRAIN — mirrored exactly from mod_cf_h in cf_lib. One truth. ──
  const sm01 = t => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c) }
  const mixN = (a, b, m) => a + (b - a) * m
  const terrainH = x => {
    let h = 90 * Math.sin(x * 0.0021 + 1.7)
          + 55 * Math.sin(x * 0.0047 + 0.4)
          + 26 * Math.sin(x * 0.0089 + 3.1)
          + 11 * Math.sin(x * 0.0173 + 5.2)
    h = mixN(h, 10, Math.exp(-(x * x) / 25600))
    const tm = sm01((x - 1840) / 120) * (1 - sm01((x - 2320) / 120))
    h = mixN(h, -30, tm * 0.92)
    h += 130 * Math.exp(-((x - 3050) * (x - 3050)) / 22500)
    // hearth terraces — MUST mirror mod_cf_h exactly
    h = mixN(h, 19.5, 0.9 * Math.exp(-((x - 620) * (x - 620)) / 6400))
    h = mixN(h, -56.0, 0.9 * Math.exp(-((x - 1520) * (x - 1520)) / 6400))
    h = mixN(h, -31.7, 0.9 * Math.exp(-((x - 2290) * (x - 2290)) / 6400))
    h = mixN(h, 54.1, 0.9 * Math.exp(-((x - 3390) * (x - 3390)) / 6400))
    h = mixN(h, -33.2, 0.9 * Math.exp(-((x - 4250) * (x - 4250)) / 6400))
    return h
  }
  const iceAt = x => sm01((x - 1840) / 120) * (1 - sm01((x - 2320) / 120))
  const dH = x => (terrainH(x + 2) - terrainH(x - 2)) * 0.25
  const BEACONS = [620, 1520, 2290, 3390, 4250]

  sim.defineChapters(['THE COLD', 'FIRST LIGHT', 'THE TARN', 'THE SCARP', 'THE LAST BEACON', 'DAWN'])

  // ── wind: a slow body + gusts that arrive like weather ──
  G.gustT -= step
  if (G.gustT <= 0) {
    G.gustT = 7 + (Math.sin(G.t * 7.13) * 0.5 + 0.5) * 9
    G.gustA = 120 + (Math.sin(G.t * 3.7) * 0.5 + 0.5) * 90
    G.gustSign = Math.sin(G.t * 1.93) > 0.25 ? 1 : -1   // mostly a headwind
    G.gustLife = 2.6
  }
  G.gustLife = Math.max(0, (G.gustLife || 0) - step)
  const gustEnv = sm01(G.gustLife / 0.6) * sm01((2.6 - G.gustLife) / 0.6)
  G.wind = Math.sin(G.t * 0.10) * 26 + Math.sin(G.t * 0.043 + 2) * 20 + G.gustSign * G.gustA * gustEnv

  // ── input ──
  const L = !!(wd.key_left || wd.key_a), Rt = !!(wd.key_right || wd.key_d)
  const jumpKey = !!(wd.key_space || wd.key_up || wd.key_w)
  const dir = (Rt ? 1 : 0) - (L ? 1 : 0)

  // ── physics: semi-implicit Euler against the height field ──
  const RAD = 14, GRAV = 780, REST = 0.20, VMAX = 460
  G.vy -= GRAV * step
  // drive: torque along the ground when grounded, faint air control aloft
  const ice = iceAt(G.x)
  const driveA = G.grounded ? mixN(900, 260, ice) : 240
  G.vx += dir * driveA * step
  // wind couples to the ball — hardest when airborne (nothing to grip)
  G.vx += (G.wind - G.vx) * (G.grounded ? 0.05 : 0.28) * step
  // an iron ball has a terminal roll — past it, crests become launch ramps
  if (G.vx > VMAX) G.vx = VMAX; else if (G.vx < -VMAX) G.vx = -VMAX
  G.x += G.vx * step
  G.y += G.vy * step

  const h = terrainH(G.x)
  const wasGrounded = G.grounded
  G.grounded = 0
  const pen = (h + RAD) - G.y
  if (pen > 0) {
    const s = dH(G.x)
    const inv = 1 / Math.sqrt(1 + s * s)
    const nx = -s * inv, ny = inv                     // surface normal (y-up)
    G.x += nx * pen * ny; G.y += ny * pen             // push out along the normal
    const vn = G.vx * nx + G.vy * ny
    if (vn < 0) {
      const impact = -vn
      G.vx -= nx * vn * (1 + REST); G.vy -= ny * vn * (1 + REST)
      if (impact > 120 && G.airT > 0.15) {
        G.landP = Math.min(1, impact / 480)
        wd.__play_sound = [{ frequency: 52 + Math.min(40, impact * 0.06), duration: 0.16, volume: Math.min(0.3, impact / 1400), type: 'sine' }]
      }
    }
    // tangential friction — the tarn barely takes any
    const tx = ny, ty = -nx
    let vt = G.vx * tx + G.vy * ty
    const mu = mixN(2.6, 0.12, ice) * (dir !== 0 ? 0.35 : 1)   // driving fights friction
    vt *= Math.exp(-mu * step)
    const vn2 = G.vx * nx + G.vy * ny
    G.vx = tx * vt + nx * vn2; G.vy = ty * vt + ny * vn2
    G.grounded = 1
    G.airT = 0
    // jump: an impulse along the slope's NORMAL — hills aim your leap
    if (jumpKey && !G.wasDown) {
      G.vx += nx * 310; G.vy += ny * 310
      G.grounded = 0
      G.jumpP = 1
      wd.__play_sound = [{ frequency: 84, duration: 0.15, volume: 0.2, type: 'triangle' }]
    }
  } else { G.airT += step }
  G.wasDown = jumpKey
  // soft walls hold the fell
  if (G.x < -120) { G.x = -120; G.vx = Math.max(0, G.vx) }
  if (G.x > 4600) { G.x = 4600; G.vx = Math.min(0, G.vx) }
  if (G.y < -400) { G.y = terrainH(G.x) + RAD + 2; G.vy = 0 }   // never lost
  G.roll += (G.vx / RAD) * step
  G.jumpP = Math.max(0, G.jumpP - step * 3)
  G.landP = Math.max(0, G.landP - step * 2.5)

  // ── the ember: wind starves it, speed stokes it, beacons restore it ──
  const speed = Math.abs(G.vx)
  const stokeIn = sm01((speed - 150) / 260)
  G.stoke = mixN(G.stoke, stokeIn, 1 - Math.exp(-4 * step))
  // three currents: wind starves, speed stokes, and STILLNESS rekindles — a
  // resting cinder's crust insulates, so going cold is never a dead end
  const rest = (G.grounded && speed < 80) ? 0.014 : 0
  G.heat = Math.max(0.12, Math.min(1,
    G.heat - step * (0.010 + 0.030 * gustEnv) + (stokeIn * 0.06 + rest) * step))

  // ── beacons ──
  G.hungry = 0
  let litCount = 0
  for (let i = 0; i < 5; i++) {
    const bx = BEACONS[i]
    const near = Math.abs(G.x - bx) < 60 && Math.abs(G.y - (terrainH(bx) + 34)) < 90
    if (!G.lit[i] && near) {
      // fire passes only to a steady hand: burn hot, but STOP to give it
      if (G.heat > 0.3 && Math.abs(G.vx) < 150 && G.grounded) {
        G.lit[i] = 1
        G.heat = 1
        wd.__play_sound = [
          { frequency: 392, duration: 0.5, volume: 0.22, type: 'sine' },
          { frequency: 494, duration: 0.6, volume: 0.18, type: 'sine' },
          { frequency: 588, duration: 0.9, volume: 0.15, type: 'sine' },
        ]
        try { if (sim.trigger('cf_lit_' + i, true)) sim.completeChapter() } catch (e) {}
      } else G.hungry = 1   // the rune flickers: too cold, or moving too fast to hand over
    }
    if (G.lit[i]) { G.heat = Math.max(G.heat, Math.abs(G.x - bx) < 120 ? 0.9 : G.heat); litCount++ }
    G.litAnim[i] = mixN(G.litAnim[i], G.lit[i], 1 - Math.exp(-2.2 * step))
  }
  G.warmth = mixN(G.warmth, litCount / 5, 1 - Math.exp(-0.8 * step))
  const finale = litCount === 5
  G.dawn = mixN(G.dawn, finale ? 1 : 0, 1 - Math.exp(-0.28 * step))
  if (finale && !G.dawnSung) {
    G.dawnSung = true
    wd.__play_sound = [
      { frequency: 196, duration: 2.2, volume: 0.2, type: 'sine' },
      { frequency: 294, duration: 2.2, volume: 0.16, type: 'sine' },
      { frequency: 392, duration: 2.6, volume: 0.14, type: 'sine' },
      { frequency: 588, duration: 3.0, volume: 0.10, type: 'sine' },
    ]
  }

  // ── hold R two seconds: the fell goes cold again (replayable demo) ──
  G.resetT = (wd.key_r ? (G.resetT || 0) + step : 0)
  if (G.resetT > 2) {
    G.lit = [0, 0, 0, 0, 0]; G.litAnim = [0, 0, 0, 0, 0]
    G.dawn = 0; G.warmth = 0; G.heat = 1; G.dawnSung = false; G.resetT = 0
    G.x = 0; G.y = terrainH(0) + 20; G.vx = 0; G.vy = 0
    wd.__trig = null
    wd.__play_sound = [{ frequency: 110, duration: 0.6, volume: 0.15, type: 'sine' }]
  }

  // ── camera: leads the motion, breathes with the hill ──
  const lookX = G.x + G.vx * 0.30
  // the camera belongs to the FELL, not the ball — terrain-weighted, so leaps
  // rise on screen instead of dragging the whole horizon up with them
  const lookY = mixN(G.y, terrainH(G.x), 0.72) + 85
  G.camX += (Math.max(-40, Math.min(4520, lookX)) - G.camX) * (1 - Math.exp(-3.2 * step))
  G.camY += (lookY - G.camY) * (1 - Math.exp(-2.6 * step))

  // pin the canvas field
  for (const f of sim.fields.values()) {
    if ((f.name || '') === 'Cinderfell') { const T = f.transform; T.x = 256; T.y = 256; T.vx = 0; T.vy = 0 }
  }

  // ── publish the whiteboard ──
  const U = new Array(32).fill(0)
  U[0] = G.t; U[1] = G.x; U[2] = G.y; U[3] = G.roll
  U[4] = G.vx; U[5] = G.vy; U[6] = G.grounded; U[7] = G.heat
  U[8] = G.camX; U[9] = G.camY; U[10] = G.wind; U[11] = G.dawn
  U[12] = G.warmth
  for (let i = 0; i < 5; i++) U[13 + i] = G.litAnim[i]
  U[18] = G.jumpP; U[19] = G.landP; U[20] = G.stoke
  U[21] = finale ? 1 : 0; U[22] = iceAt(G.x); U[23] = G.hungry
  U[24] = G.intro
  wd.gpuUniforms = U
  if (wd.cfDebug) wd.hud = [{ id: 'cf_dbg', type: 'text', x: '1%', y: '97%',
    text: 'x=' + Math.round(G.x) + ' vx=' + Math.round(G.vx) + ' heat=' + G.heat.toFixed(2) + ' lit=' + G.lit.join(''),
    color: '#050505', fontSize: '2px' }]   // invisible on camera, readable by a script
  else if (wd.hud && wd.hud.length && wd.hud[0] && wd.hud[0].id === 'cf_dbg') wd.hud = []
} catch (e) { /* the fell keeps its weather */ }
`

// ───────────────────────────────────────────────────────────────── build ──
const INSTRUCTIONS = [
  '← → or A D — roll. The ground grips; the ice does not.',
  'SPACE — leap. The jump fires along the slope, so hills aim you.',
  '',
  'You are the last cinder of a dead hearth. Five beacons stand cold',
  'on the long fell east. A beacon only catches from a cinder that',
  'still burns — speed stokes your ember, the wind starves it.',
  'But fire passes only to a steady hand: come in hot, then STOP.',
  '',
  'Light all five. Bring the dawn.  (hold R — winter returns)',
].join('\n')

async function main() {
  // ONE atomic batch — modules must land with the visual that calls them
  await send([
    { type: 'set_world_data', data: { built_by: 'Claude Fable 5', singlePlayer: true, instructions: INSTRUCTIONS } },
    { type: 'set_world_params', params: { gravity: 0, friction: 0.95, collisionForce: 0, boundaryMode: 'open', gravitationalConstant: 0 } },
    { type: 'define_module', name: 'cf_lib', wgsl: LIB },
    { type: 'define_visual', name: 'cinderfell', wgsl: VISUAL },
  ], 'atomic world batch')
  const st = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  const existing = (st.fields || []).find(f => f.name === 'Cinderfell')
  if (!existing) {
    await send({
      type: 'create_field', name: 'Cinderfell', shape: 'rect', x: 256, y: 256, width: 512, height: 512,
      visualType: 'cinderfell', color: [0.02, 0.03, 0.06, 1], noHit: true,
    }, 'field')
  }
  const st2 = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  const fld = (st2.fields || []).find(f => f.name === 'Cinderfell')
  if (fld) await send({ type: 'set_property', fieldId: fld.id, key: 'superimpose', value: true }, 'superimpose')
  await send({ type: 'add_step_hook', hookId: 'cinderfell_core', author: 'Claude Fable 5', description: 'CINDERFELL: ball physics vs shared height field, wind, ember heat, beacons, dawn', code: HOOK }, 'hook')
  await send({ type: 'set_world_data', data: { postProcess: { bloomIntensity: 0.42, bloomThreshold: 0.68, exposure: 1.04, vignetteStrength: 0.32, vignetteRadius: 0.85 } } }, 'post')

  const v = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  console.log('VERIFY fields:', (v.fields || []).map(f => f.name),
    '| hooks:', (v.stepHooks || []).map(h => h.id),
    '| visuals:', (v.visualTypes || []).map(x => x.name),
    '| modules:', (v.modules || []).map(x => x.name))
}
main().catch(e => { console.error(e); process.exit(1) })
