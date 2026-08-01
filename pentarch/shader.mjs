// PENTARCH — the ONE visual builder (shader node).
//
// Exports visualSource(): the WGSL for `fn visual_pentarch(...)` plus its private
// helpers. build.mjs inlines this into dist/visual.wgsl and pushes it via
// `define_visual { name:'pentarch' }`. The engine supplies `uni(i)->f32`,
// `uni4(i)->vec4f`, `pop(i)->vec4f`, `popCount()->i32` (see render-core.mjs) — this
// module must NOT redefine them or it collides on the live device.
//
// It is the ONLY decoder of the entity `code` (4th float of every pop entity).
// Single registry (CONTRACT §4 / STRUCTURE entity codes) — a pop entity is
// [x, y, a, code]; positions are uv-ish world units in the letterbox square, the
// same mapping the input helpers use. The fractional part of `code` (e.w) carries
// a packed length where a code needs one (v9 pattern: `fract(e.w)`).
//
//   0..5                   designer tile, part index = code    (a = 0 normal / 1 selected / 2 flash)
//   60..68                 ghost outline, seat = code-60        (a = legal?1:0)
//   70                     void glint (a diamond hole marker)
//   71..75                 sealed-shape heartbeat, shape = code-71   (a = pulse radius)
//   76..80                 shape outline, shape = code-76       (a = half-length of the seam)
//   100+seat  (100..199)   beam, seat = trunc(code)-100         (a = angle rad; len = fract(code))
//   200+owner (200..299)   capture ring, owner = code-200 (0=neutral) (a = ring radius; fract=hold frac)
//   part + (seat+2)*100    battle hull tile, part = code%100, seatHue = code/100 - 2  (a = tile th already in z)
//   300..319               UI button, id = code-300             (a = pressed?1:0; fract(code) = half-width)
//
// The 3rd float of the entity (referred to as `e.z` in WGSL) is the pose/aux `a`
// from pushEnt(x,y,a,code): tile rotation, ghost legality, ring radius, beam angle,
// button pressed. Uniform channels (from the hook's gpuUniforms) the chrome reads:
//   uni(0)=time  uni(7)=world scale S  uni(8..10)=pointer x,y,down
//   uni(11)=flash amount  uni(12)=flash shape  uni(13)=delete-pad armed  uni(15)=MY_SEAT

// chrome (a green foundation) owns the shared Istrolid UI primitives as a WGSL
// string. shader.mjs is the sole owner of the assembled visual, so IT pastes those
// primitives in (CONTRACT connect: shader "includes the panel/button/card WGSL")
// and calls them from the decode loop — build.mjs inlines only chrome's PRELUDE
// (the JS side), never CHROME_WGSL, so there is exactly one copy of each fn.
import { CHROME_WGSL } from './chrome.mjs';

export function visualSource() {
  // CHROME_WGSL declares ch_rrect/ch_panel/ch_banner/ch_button/ch_unpack* BEFORE
  // visual_pentarch, satisfying WGSL's declaration-before-use rule.
  return CHROME_WGSL + String.raw`
fn pp_rot(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(p.x * c + p.y * s, -p.x * s + p.y * c); }
fn pp_pent(p0: vec2f, rc: f32, th: f32) -> f32 {
  // IQ regular-pentagon SDF; rc = circumradius; tile frame has a vertex UP at th=0.
  var p = pp_rot(p0, th);
  p = vec2f(p.x, -p.y);
  let kx = 0.809016994; let ky = 0.587785252; let kz = 0.726542528;
  let ra = rc * kx;
  p.x = abs(p.x);
  p = p - 2.0 * min(dot(vec2f(-kx, ky), p), 0.0) * vec2f(-kx, ky);
  p = p - 2.0 * min(dot(vec2f(kx, ky), p), 0.0) * vec2f(kx, ky);
  p = p - vec2f(clamp(p.x, -ra * kz, ra * kz), ra);
  return length(p) * sign(p.y);
}
fn pp_box(p: vec2f, b: vec2f) -> f32 { let d = abs(p) - b; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }
fn pp_seg(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
fn pp_hue(s: f32) -> vec3f { return 0.55 + 0.45 * cos(6.2831853 * (s * 0.381966) + vec3f(0.0, 2.1, 4.2)); }
fn pp_col(part: i32) -> vec3f {
  if (part == 1) { return vec3f(0.36, 0.50, 0.65); }      // hull
  if (part == 2) { return vec3f(0.54, 0.58, 0.65); }      // armor
  if (part == 3) { return vec3f(1.00, 0.48, 0.42); }      // gun
  if (part == 4) { return vec3f(0.48, 0.86, 1.00); }      // engine (drive)
  if (part == 5) { return vec3f(0.62, 1.00, 0.54); }      // gen (power)
  return vec3f(0.30, 0.36, 0.46);                          // blank
}
fn pp_shapeHue(kind: i32) -> vec3f {
  if (kind == 72 || kind == 77) { return vec3f(0.75, 0.85, 1.00); }
  if (kind == 73 || kind == 78) { return vec3f(1.00, 0.98, 0.92); }
  if (kind == 74 || kind == 79) { return vec3f(0.60, 0.75, 0.90); }
  if (kind == 75 || kind == 80) { return vec3f(0.35, 0.40, 0.50); }
  return vec3f(1.00, 0.85, 0.45);
}

fn visual_pentarch(_uv: vec2f, _p: f32, _c: vec4f, time: f32, _a: vec4f, _b: vec4f) -> vec4f {
  // the render-service hands us +y-DOWN uv; the whole build (toUV, chrome, scenes)
  // is +y-UP (matches v9's mouse/256-1 space). Flip once here so entity positions,
  // the cursor, ghosts, and every panel land where the hook placed them.
  let uv = vec2f(_uv.x, -_uv.y);
  let t = uni(0);
  var S = uni(7);
  if (S <= 0.0) { S = 0.053; }                            // world scale (units→uv); sane default when no hook
  let R = S * 0.85065;                                    // tile circumradius in uv

  // ── background: dark field + slow tint + faint dock grid ──
  var col = vec3f(0.022, 0.028, 0.046);
  col += vec3f(0.006, 0.010, 0.016) * (0.5 + 0.5 * sin(uv.y * 3.0 + t * 0.1));
  let gr = abs(fract(uv.x * 6.0) - 0.5) * abs(fract(uv.y * 6.0) - 0.5);
  col += vec3f(0.010, 0.014, 0.022) * smoothstep(0.24, 0.25, gr);

  let n = popCount();
  for (var i = 0; i < n; i = i + 1) {
    let e = pop(i);                                       // x, y (uv), a, code(+packed len)
    let code = i32(e.w);

    // ── capture ring (200..299) — owner-tinted annulus ──
    if (code >= 200 && code < 300) {
      let owner = code - 200;                             // 0 neutral, 1.. = seat+1
      let dR = length(uv - e.xy);
      let rad = e.z;
      var oc = vec3f(0.5, 0.6, 0.75);
      if (owner > 0) { oc = pp_hue(f32(owner - 1)); }
      let hold = fract(e.w);                              // hold fraction, if the hook packs it
      col += oc * exp(-abs(dR - rad) * 90.0) * (0.7 + 0.2 * sin(t * 2.0 + e.x * 7.0));
      col += oc * exp(-dR * dR / max(rad * rad, 1e-4)) * 0.10;
      if (hold > 0.001 && owner > 0) {                    // sweeping capture arc
        let ang = atan2(uv.y - e.xy.y, uv.x - e.xy.x);
        let frac01 = (ang + 3.14159265) / 6.2831853;
        col += oc * exp(-abs(dR - rad) * 60.0) * step(frac01, hold) * 0.6;
      }
      continue;
    }

    // ── beam (100..199) — seat-hued lance from origin along the aux angle ──
    if (code >= 100 && code < 200) {
      let seat = code - 100;
      let ang = e.z;
      let len = max(fract(e.w), 0.02);                    // length packed in the fractional part
      let tip = e.xy + vec2f(cos(ang), sin(ang)) * len;
      let db = pp_seg(uv, e.xy, tip);
      let hue = pp_hue(f32(seat));
      col += hue * exp(-db * 260.0) * 0.9;                // the bolt
      col += vec3f(1.0, 0.97, 0.9) * exp(-db * 700.0) * 0.7;  // hot core
      col += hue * exp(-length(uv - tip) * 120.0) * 0.4;     // impact flare
      continue;
    }

    // ── chrome UI — drawn by the SHARED primitives so every scene matches ──
    // button (300..319): a = state (0 idle · 0.5 hover · 1 pressed), fract(code) = half-width.
    if (code >= 300 && code < 320) {
      var hw = fract(e.w);
      if (hw < 0.01) { hw = 0.085; }
      let cb = ch_button(uv, e.xy, hw, e.z);              // premultiplied rgb, a = coverage
      col = col * (1.0 - cb.a) + cb.rgb;
      continue;
    }
    // panel (320): translucent overlay rect. a packs both half-sizes (ch_unpack*).
    if (code == 320) {
      let cp = ch_panel(uv, e.xy, ch_unpackW(e.z), ch_unpackH(e.z));
      col = col * (1.0 - cp.a) + cp.rgb;
      continue;
    }
    // banner (321): red inline reason banner ("would overlap" / "disconnected").
    if (code == 321) {
      let cbn = ch_banner(uv, e.xy, ch_unpackW(e.z), ch_unpackH(e.z));
      col = col * (1.0 - cbn.a) + cbn.rgb;
      continue;
    }

    let kind = code % 100;                                // 0..5 part · 60 ghost · 70 void · 71+ shapes
    let flags = code / 100;                               // designer: 1 = selected · battle: seat+2

    // ── shape outlines (76..80) — the true seam of a sealed prize ──
    if (kind >= 76 && kind <= 80) {
      let hl = fract(e.w);                                // half-length of the seam segment
      let dloc = pp_rot(uv - e.xy, e.z);
      let sd = length(vec2f(max(abs(dloc.x) - hl, 0.0), dloc.y));
      let oc = pp_shapeHue(kind);
      let pulse = 0.8 + 0.2 * sin(t * 2.2);
      col += oc * smoothstep(0.006, 0.0015, sd) * (1.1 * pulse);
      col += oc * exp(-sd * 120.0) * 0.25;
      continue;
    }

    // ── sealed-shape heartbeat (71..75) — the prize glows ──
    if (kind >= 71 && kind <= 75) {
      let vd = length(uv - e.xy);
      let hueC = pp_shapeHue(kind);
      col += hueC * exp(-vd * vd * 3000.0) * (0.30 + 0.15 * sin(t * 2.0));
      continue;
    }

    // ── void (70) — a gold diamond glint at an open hole ──
    if (kind == 70) {
      let vd = length(uv - e.xy);
      col += vec3f(1.0, 0.85, 0.45) * exp(-vd * vd * 5200.0) * (0.5 + 0.2 * sin(t * 2.4));
      col += vec3f(1.0, 0.82, 0.4) * exp(-abs(vd - 0.016) * 300.0) * 0.35;
      continue;
    }

    // ── ghost (60..68) — translucent placement preview; red if illegal ──
    // CONTRACT §4: a = legal?1:0. Rotation (optional) rides fract(code)·2π so the
    // designer can orient the preview without stealing the legality channel.
    if (kind >= 60 && kind <= 68) {
      let th = fract(e.w) * 6.2831853;
      let d = pp_pent(uv - e.xy, R, th);
      let g = smoothstep(0.004, -0.004, d);
      var gc = vec3f(0.55, 0.75, 1.0);
      if (e.z < 0.5) { gc = vec3f(1.0, 0.42, 0.36); }      // illegal placement → red
      col = mix(col, gc, g * (0.16 + 0.07 * sin(t * 3.0)));
      col += gc * exp(-abs(d) * 220.0) * 0.35;
      continue;
    }

    // ── tiles (0..5 designer, or +100·(seat+2) battle) ──
    let d = pp_pent(uv - e.xy, R, e.z);
    let body = smoothstep(0.003, -0.003, d);
    let base = pp_col(kind);
    if (flags >= 2) {                                     // battle tile: seat-hued rim
      let sh = pp_hue(f32(flags - 2));
      col = mix(col, base * 0.35 + vec3f(0.03, 0.05, 0.08), body);
      col += sh * exp(-abs(d) * 280.0) * 0.95;
      col += base * exp(-abs(d) * 300.0) * 0.35;
      continue;
    }
    col = mix(col, base * 0.34 + vec3f(0.03, 0.04, 0.07), body);
    col += base * exp(-abs(d) * 260.0) * 0.9;             // rim
    if (flags == 1) {                                     // selected: bright halo
      col += vec3f(1.0, 0.95, 0.7) * exp(-abs(d) * 130.0) * (0.5 + 0.2 * sin(t * 4.0));
    }
    if (kind == 0) {                                      // blank: hatched pulse
      col += vec3f(0.5, 0.6, 0.8) * body * (0.10 + 0.08 * sin(uv.x * 90.0 + uv.y * 90.0 + t * 2.0));
    }
  }

  // ── pointer glint (chrome) — reads the pooled cursor uniform ──
  let gp = vec2f(uni(8), uni(9));
  if (uni(10) > 0.5) {
    let gd = length(uv - gp);
    col += vec3f(0.7, 0.88, 1.0) * (exp(-gd * gd * 1400.0) * 0.7 + exp(-abs(gd - 0.03) * 240.0) * 0.4);
  }

  // ── placement flash (chrome) — a shape-tinted wash when a prize seals ──
  let fl = uni(11);
  if (fl > 0.01) {
    var fc = vec3f(1.0, 0.85, 0.45);
    if (uni(12) > 1.5) { fc = vec3f(0.75, 0.85, 1.0); }
    if (uni(12) > 2.5) { fc = vec3f(1.0, 0.98, 0.92); }
    col += fc * fl * fl * 0.22 * (1.0 - 0.5 * dot(uv, uv));
  }

  col *= 1.0 - 0.30 * dot(uv, uv);                        // vignette
  col = col / (col + vec3f(1.0));                         // reinhard tonemap
  return vec4f(pow(col, vec3f(0.9)), 1.0);
}
`;
}
