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
fn py_col(part: i32) -> vec3f {
  if (part == 1) { return vec3f(0.36, 0.50, 0.65); }      // hull
  if (part == 2) { return vec3f(0.54, 0.58, 0.65); }      // armor
  if (part == 3) { return vec3f(1.00, 0.48, 0.42); }      // gun
  if (part == 4) { return vec3f(0.48, 0.86, 1.00); }      // engine
  if (part == 5) { return vec3f(0.62, 1.00, 0.54); }      // gen
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
    if (code >= 200 && code < 300) {                       // capture ring
      let owner = code - 200;
      let dR = length(uv - e.xy);
      var oc2 = vec3f(0.5, 0.6, 0.75);
      if (owner > 0) { oc2 = 0.55 + 0.45 * cos(6.2831853 * (f32(owner - 1) * 0.381966) + vec3f(0.0, 2.1, 4.2)); }
      col += oc2 * exp(-abs(dR - e.z) * 90.0) * (0.7 + 0.2 * sin(t * 2.0 + e.x * 7.0));
      continue;
    }
    let kind = code % 100;                                 // 0..5 part · 60 ghost · 70 void
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
    if (kind == 70) {                                      // VOID — a gold diamond glint
      let vd = length(uv - e.xy);
      col += vec3f(1.0, 0.85, 0.45) * exp(-vd * vd * 5200.0) * (0.5 + 0.2 * sin(t * 2.4));
      col += vec3f(1.0, 0.82, 0.4) * exp(-abs(vd - 0.016) * 300.0) * 0.35;
      continue;
    }
    if (kind == 60) {                                      // GHOST — translucent breath
      let g = smoothstep(0.004, -0.004, d);
      col = mix(col, vec3f(0.55, 0.75, 1.0), g * (0.16 + 0.07 * sin(t * 3.0)));
      col += vec3f(0.55, 0.8, 1.0) * exp(-abs(d) * 220.0) * 0.35;
      continue;
    }
    let body = smoothstep(0.003, -0.003, d);
    let base = py_col(kind);
    if (flags >= 2) {                                      // battle tile: seat-hued rim
      let sh = 0.55 + 0.45 * cos(6.2831853 * (f32(flags - 2) * 0.381966) + vec3f(0.0, 2.1, 4.2));
      col = mix(col, base * 0.35 + vec3f(0.03, 0.05, 0.08), body);
      col += sh * exp(-abs(d) * 280.0) * 0.95;
      continue;
    }
    col = mix(col, base * 0.34 + vec3f(0.03, 0.04, 0.07), body);
    col += base * exp(-abs(d) * 260.0) * 0.9;              // rim
    if (flags == 1) {                                      // selected: bright halo
      col += vec3f(1.0, 0.95, 0.7) * exp(-abs(d) * 130.0) * (0.5 + 0.2 * sin(t * 4.0));
    }
    if (kind == 0) {                                       // blank: hatched pulse
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