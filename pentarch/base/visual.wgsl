fn py_rot(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(p.x * c + p.y * s, -p.x * s + p.y * c); }
fn py_pent(p0: vec2f, rc: f32, th: f32) -> f32 {
  // IQ regular-pentagon SDF; rc = circumradius. Tile frame: vertex up at th=0
  // (IQ's is vertex-down, so flip y after rotating into the tile frame).
  var p = py_rot(p0, th);
  p = vec2f(p.x, -p.y);
  let kx = 0.809016994; let ky = 0.587785252; let kz = 0.726542528;
  let ra = rc * kx;
  p.x = abs(p.x);
  p = p - 2.0 * min(dot(vec2f(-kx, ky), p), 0.0) * vec2f(-kx, ky);
  p = p - 2.0 * min(dot(vec2f(kx, ky), p), 0.0) * vec2f(kx, ky);
  p = p - vec2f(clamp(p.x, -ra * kz, ra * kz), ra);
  return length(p) * sign(p.y);
}
// ── CHROME (harvested from pentarch-stage/chrome.mjs, verbatim WGSL primitives) —
//    a proper drawn UI: rounded-rect panels + buttons, instead of plain HUD text.
//    Entity codes: 300..319 BUTTON (a=state 0/0.5/1, fract(code)=half-width,
//    height=hw·0.5) · 320 PANEL (a packs both half-sizes) · 321 BANNER (unused here).
fn ch_unpackW(a: f32) -> f32 { return floor(a) / 4096.0; }
fn ch_unpackH(a: f32) -> f32 { return fract(a); }
fn ch_rrect(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
fn ch_panel(p: vec2f, hw: f32, hh: f32) -> vec4f {
  let d = ch_rrect(p, vec2f(hw, hh), 0.02);
  let fill = smoothstep(0.004, -0.004, d);
  let rim = exp(-abs(d) * 140.0);
  return vec4f(vec3f(0.05, 0.07, 0.10), fill * 0.62 + rim * 0.3);
}
fn ch_button(p: vec2f, hw: f32, state: f32) -> vec4f {
  let hh = hw * 0.5;
  let d = ch_rrect(p, vec2f(hw, hh), 0.015);
  let fill = smoothstep(0.005, -0.005, d);
  let rim = exp(-abs(d) * 190.0);
  let lift = 0.30 + 0.70 * state;
  let rgb = vec3f(0.14, 0.20, 0.30) * (1.0 + state) * fill + vec3f(0.55, 0.78, 1.0) * rim * lift;
  return vec4f(rgb, fill * 0.9 + rim * lift);
}
fn py_col(part: i32) -> vec3f {
  if (part == 1) { return vec3f(0.36, 0.50, 0.65); }      // hull
  if (part == 2) { return vec3f(0.54, 0.58, 0.65); }      // armor
  if (part == 3) { return vec3f(1.00, 0.48, 0.42); }      // gun
  if (part == 4) { return vec3f(0.48, 0.86, 1.00); }      // main thruster
  if (part == 5) { return vec3f(0.62, 1.00, 0.54); }      // gen
  if (part == 6) { return vec3f(0.62, 0.92, 1.00); }      // jet (pale drive)
  if (part == 7) { return vec3f(0.80, 0.78, 1.00); }      // gyro (violet)
  if (part == 8) { return vec3f(0.95, 1.00, 0.55); }      // battery (charge yellow)
  if (part == 9) { return vec3f(1.00, 0.66, 0.42); }      // fixed gun (ember)
  return vec3f(0.30, 0.36, 0.46);                          // blank
}
fn visual_shipyard(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = uni(0);
  let S = uni(7);                                          // world scale (units→uv)
  var col = vec3f(0.024, 0.030, 0.048);
  col += vec3f(0.006, 0.010, 0.016) * (0.5 + 0.5 * sin(uv.y * 3.0 + t * 0.1));
  // faint dock grid
  let gr = abs(fract(uv.x * 6.0) - 0.5) * abs(fract(uv.y * 6.0) - 0.5);
  col += vec3f(0.010, 0.014, 0.022) * smoothstep(0.24, 0.25, gr);
  let n = popCount();
  let R = S * 0.85065;                                     // tile circumradius in uv
  for (var i = 0; i < n; i = i + 1) {
    let e = pop(i);                                        // x, y (uv), th, code
    let code = i32(e.w);
    // CHROME dispatch FIRST (raw code ranges, not kind%100 — 300+ is reserved,
    // never collides with part/effect codes below it).
    if (code >= 300 && code < 320) {                        // BUTTON
      let hw = fract(e.w); let p = uv - e.xy;
      let bc = ch_button(p, hw, e.z);
      col = mix(col, bc.rgb, bc.a);
      continue;
    }
    if (code == 320) {                                      // PANEL (a packs both half-sizes)
      let hw = ch_unpackW(e.z); let hh = ch_unpackH(e.z);
      let pc = ch_panel(uv - e.xy, hw, hh);
      col = mix(col, pc.rgb, pc.a);
      continue;
    }
    let kind = code % 100;                                 // part+10·o (<50) · 56 plume · 57 arc · 60 ghost · 70 glint
    let flags = code / 100;                                // 1 = selected
    let d = py_pent(uv - e.xy, R, e.z);
    if (kind >= 76) {                                   // TRUE SHAPE OUTLINES
      let hl = fract(e.w);
      let dloc = py_rot(uv - e.xy, e.z);
      let sd = length(vec2f(max(abs(dloc.x) - hl, 0.0), dloc.y));
      var oc = vec3f(1.0, 0.85, 0.45);
      if (kind == 77) { oc = vec3f(0.75, 0.85, 1.0); }
      if (kind == 78) { oc = vec3f(1.0, 0.98, 0.92); }
      if (kind == 79) { oc = vec3f(0.6, 0.75, 0.9); }
      if (kind == 80) { oc = vec3f(0.35, 0.40, 0.50); }
      let pulse = 0.8 + 0.2 * sin(t * 2.2);
      col += oc * smoothstep(0.006, 0.0015, sd) * (1.1 * pulse);   // the line itself
      col += oc * exp(-sd * 120.0) * 0.25;                          // soft halo
      continue;
    }
    if (kind >= 71) {                                    // SEALED SHAPES — the prizes
      let vd = length(uv - e.xy);
      let rr = max(e.z * 0.5, 0.02);
      var hueC = vec3f(1.0, 0.85, 0.45);
      if (kind == 72) { hueC = vec3f(0.75, 0.85, 1.0); }
      if (kind == 73) { hueC = vec3f(1.0, 0.98, 0.9); }
      if (kind == 74) { hueC = vec3f(0.6, 0.75, 0.9); }
      if (kind == 75) { hueC = vec3f(0.35, 0.40, 0.50); }
      col += hueC * exp(-vd * vd * 3000.0) * (0.30 + 0.15 * sin(t * 2.0));
      continue;
    }
    if (kind == 70) {                                      // ROUTE NODE — a small gold glint
      let vd = length(uv - e.xy);
      col += vec3f(1.0, 0.85, 0.45) * exp(-vd * vd * 11000.0) * (0.5 + 0.2 * sin(t * 2.4));
      col += vec3f(1.0, 0.82, 0.4) * exp(-abs(vd - 0.008) * 500.0) * 0.3;
      continue;
    }
    if (kind == 56) {                                      // ENGINE PLUME — throttle in fract(code)
      let inten = fract(e.w);
      let pd = py_rot(uv - e.xy, e.z);                     // local: +x = exhaust direction
      let lenP = S * (0.5 + 1.7 * inten);
      let a2 = clamp(pd.x / max(lenP, 1e-5), 0.0, 1.0);
      let wP = S * 0.17 * (1.0 - a2 * 0.7) * (0.6 + 0.4 * inten);
      let m = step(0.0, pd.x) * smoothstep(wP, wP * 0.2, abs(pd.y)) * (1.0 - a2);
      let flick = 0.75 + 0.25 * sin(t * 31.0 + e.x * 57.0 + e.y * 31.0);
      col += (vec3f(0.45, 0.75, 1.0) * (1.0 - a2) + vec3f(1.0, 0.55, 0.15) * a2) * m * inten * 1.7 * flick;
      continue;
    }
    if (kind == 57) {                                      // TURRET ARC — one clean wedge (half-width/π in fract)
      let half = fract(e.w) * 3.14159265;
      let p2 = uv - e.xy;
      let r2 = length(p2);
      var da = atan2(p2.y, p2.x) - e.z;
      da = atan2(sin(da), cos(da));
      let rArc = S * 0.95;
      let inA = smoothstep(half, half * 0.9, abs(da));
      let stroke = smoothstep(0.006, 0.0018, abs(r2 - rArc)) * inA;
      let fill = smoothstep(rArc, rArc * 0.25, r2) * inA;
      let rim = smoothstep(0.004, 0.0015, abs(abs(da) - half)) * step(r2, rArc) * step(S * 0.3, r2);
      col += vec3f(1.0, 0.62, 0.45) * (stroke * (0.7 + 0.2 * sin(t * 2.0)) + fill * 0.05 + rim * 0.4);
      continue;
    }
    if (kind == 58) {                                      // WEAPON BEAM — half-length(uv) in fract
      let hl = fract(e.w) * 0.5;
      let pd = py_rot(uv - e.xy, e.z);
      let sd = length(vec2f(max(abs(pd.x) - hl, 0.0), pd.y));
      col += vec3f(1.0, 0.55, 0.3) * (smoothstep(0.0045, 0.0012, sd) * 1.5 + exp(-sd * 240.0) * 0.6);
      continue;
    }
    if (kind == 59) {                                      // RANGE DASH — radius in fract·2
      let rr = fract(e.w) * 2.0;
      let p2 = uv - e.xy;
      let r2 = length(p2);
      var da = atan2(p2.y, p2.x) - e.z;
      da = atan2(sin(da), cos(da));
      let m = smoothstep(0.075, 0.05, abs(da)) * smoothstep(0.0055, 0.0018, abs(r2 - rr));
      col += vec3f(1.0, 0.5, 0.32) * m * (0.55 + 0.2 * sin(t * 2.0));
      continue;
    }
    if (kind == 60) {                                      // GHOST — translucent breath
      let g = smoothstep(0.004, -0.004, d);
      col = mix(col, vec3f(0.55, 0.75, 1.0), g * (0.16 + 0.07 * sin(t * 3.0)));
      col += vec3f(0.55, 0.8, 1.0) * exp(-abs(d) * 220.0) * 0.35;
      continue;
    }
    // PART TILES: code = part + 10·orientation, +100 selected, +200 CORE/HELM
    let part = kind % 10;
    let ori = (kind / 10) % 10;
    let isCore = (flags / 2) % 2 == 1;
    let isSel = flags % 2 == 1;
    let isAct = flags >= 4;                                // actuator firing (gyro glow)
    let body = smoothstep(0.003, -0.003, d);
    var base = py_col(part);
    if (isCore) { base = vec3f(1.0, 0.84, 0.45); }         // the HELM — command gold
    col = mix(col, base * 0.34 + vec3f(0.03, 0.04, 0.07), body);
    col += base * exp(-abs(d) * 260.0) * 0.9;              // rim
    if (isSel) {                                           // selected: bright halo
      col += vec3f(1.0, 0.95, 0.7) * exp(-abs(d) * 130.0) * (0.5 + 0.2 * sin(t * 4.0));
    }
    if (isCore) {                                          // HELM glyph: command ring + beacon
      let dloc0 = py_rot(uv - e.xy, e.z);
      let cd0 = length(dloc0);
      col += vec3f(1.0, 0.9, 0.55) * smoothstep(R * 0.08, R * 0.02, abs(cd0 - R * 0.42)) * body * 0.7;
      col += vec3f(1.0, 0.95, 0.7) * exp(-cd0 * cd0 * 2600.0) * (0.7 + 0.3 * sin(t * 2.6));
      let aa0 = atan2(dloc0.y, dloc0.x) - t * 0.9;
      col += vec3f(1.0, 0.85, 0.5) * smoothstep(R * 0.08, R * 0.02, abs(cd0 - R * 0.42)) * max(0.0, sin(aa0 * 1.0)) * body * 0.5;
    }
    // ── per-part GLYPHS, drawn in the tile's local frame ──
    let dloc = py_rot(uv - e.xy, e.z);
    let fa = 1.5707963 + (f32(ori) + 0.5) * 1.2566371;     // facing edge normal (local)
    let fd = vec2f(cos(fa), sin(fa));
    let along = dot(dloc, fd);
    let across = abs(dloc.x * fd.y - dloc.y * fd.x);
    let ap = R * 0.80902;                                  // apothem
    if (part == 4 || part == 6) {                          // MAIN / JET — nozzle on the facing edge
      let wN = select(0.20, 0.40, part == 4) * R;
      let noz = step(ap * 0.42, along) * step(along, ap * 1.0) * smoothstep(wN, wN * 0.55, across);
      col = mix(col, vec3f(0.07, 0.09, 0.13), noz * body * 0.9);
      col += vec3f(0.55, 0.85, 1.0) * noz * body * (0.22 + 0.10 * sin(t * 7.0));
    }
    if (part == 9 || part == 3) {                          // FIXED / TURRET — barrel toward facing
      let bl = step(0.0, along) * step(along, ap * 1.04) * smoothstep(R * 0.11, R * 0.045, across);
      col = mix(col, vec3f(0.15, 0.13, 0.11), bl * body * 0.95);
      col += vec3f(1.0, 0.78, 0.5) * bl * body * 0.4;
      if (part == 3) {                                     // turret DOME
        let cd2 = length(dloc);
        col = mix(col, base * 0.85, smoothstep(R * 0.34, R * 0.28, cd2) * body * 0.85);
        col += vec3f(1.0, 0.6, 0.5) * exp(-abs(cd2 - R * 0.32) * 320.0) * 0.5;
      }
    }
    if (part == 7) {                                       // GYRO — ring; BLAZES + spins hard while firing
      let ring = smoothstep(R * 0.09, R * 0.02, abs(length(dloc) - R * 0.40));
      let sgn = select(1.0, -1.0, uni(14) < 0.0);
      let spin = select(2.6, 14.0 * sgn, isAct);
      let glow = select(0.5, 1.3, isAct);
      col += vec3f(0.72, 0.68, 1.0) * ring * body * glow;
      let aa = atan2(dloc.y, dloc.x) + t * spin;
      col += vec3f(0.92, 0.88, 1.0) * ring * body * max(0.0, sin(aa * 3.0)) * (0.55 + select(0.0, 0.8, isAct));
      if (isAct) { col += vec3f(0.8, 0.75, 1.0) * exp(-length(dloc) * length(dloc) * 1800.0) * 0.7; }
    }
    if (part == 5) {                                       // GEN — radiant core
      let cd2 = length(dloc);
      col += vec3f(0.6, 1.0, 0.5) * exp(-cd2 * cd2 * 2400.0) * (0.55 + 0.25 * sin(t * 3.0));
      let aa = atan2(dloc.y, dloc.x);
      col += vec3f(0.5, 1.0, 0.45) * smoothstep(R * 0.55, 0.0, cd2) * max(0.0, sin(aa * 5.0 + t * 1.3)) * 0.2 * body;
    }
    if (part == 8) {                                       // BATTERY — charge bars
      let inBox = step(abs(dloc.x), R * 0.40) * step(abs(dloc.y), R * 0.52);
      let bar = smoothstep(0.5, 0.34, abs(fract(dloc.y / (R * 0.36)) - 0.5));
      col = mix(col, vec3f(0.10, 0.11, 0.07), inBox * bar * body * 0.75);
      col += vec3f(0.95, 1.0, 0.4) * inBox * bar * body * (0.28 + 0.10 * sin(t * 2.2));
    }
    if (part == 2) {                                       // ARMOR — plating chords
      let pl = smoothstep(0.006, 0.002, abs(abs(dloc.y) - R * 0.34));
      col = mix(col, vec3f(0.42, 0.46, 0.54), pl * body * 0.5);
    }
    if (part == 0) {                                       // blank: hatched pulse
      col += vec3f(0.5, 0.6, 0.8) * body * (0.10 + 0.08 * sin(uv.x * 90.0 + uv.y * 90.0 + t * 2.0));
    }
  }
  // the DELETE pad — a red pentagon at the palette's end; burns while armed
  {
    let d = py_pent(uv - vec2f(0.78, 0.86), 0.075, 0.0);
    let on = uni(13);
    let body = smoothstep(0.004, -0.004, d);
    col = mix(col, vec3f(0.55, 0.16, 0.14) * (0.5 + 0.5 * on), body * 0.9);
    col += vec3f(1.0, 0.35, 0.28) * exp(-abs(d) * 240.0) * (0.5 + 0.7 * on);
  }
  // ── palette strip (5 part pentagons, bottom) ──
  for (var s = 0; s < 5; s = s + 1) {
    let cxp = -0.52 + f32(s) * 0.26;
    let d = py_pent(uv - vec2f(cxp, 0.86), 0.075, 0.0);
    let base = py_col(s + 1);
    let body = smoothstep(0.004, -0.004, d);
    col = mix(col, base * 0.4, body * 0.9);
    col += base * exp(-abs(d) * 240.0) * 0.8;
  }
  // pointer glint
  let gp = vec2f(uni(8), uni(9));
  if (uni(10) > 0.5) {
    let gd = length(uv - gp);
    col += vec3f(0.7, 0.88, 1.0) * (exp(-gd * gd * 1400.0) * 0.7 + exp(-abs(gd - 0.03) * 240.0) * 0.4);
  }
  let fl = uni(11);
  if (fl > 0.01) {
    var fc2 = vec3f(1.0, 0.85, 0.45);
    if (uni(12) > 1.5) { fc2 = vec3f(0.75, 0.85, 1.0); }
    if (uni(12) > 2.5) { fc2 = vec3f(1.0, 0.98, 0.92); }
    col += fc2 * fl * fl * 0.22 * (1.0 - 0.5 * dot(uv, uv));
  }
  col *= 1.0 - 0.30 * dot(uv, uv);
  col = col / (col + vec3f(1.0));
  return vec4f(pow(col, vec3f(0.9)), 1.0);
}