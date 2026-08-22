
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
  return 0.0;   // THE FLAT BASE — level design begins where this function stops returning zero
}
fn mod_cf_ice(x: f32) -> f32 { return 0.0; }
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
