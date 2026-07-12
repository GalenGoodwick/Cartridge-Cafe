// ═══════════════════════════════════════════════════════════════
// CRADLE WINDOW — a framed night sky that is the Mirror's inner
// weather, hanging over the golden vista.
//   p.x = star density   (vocabulary size)
//   p.y = aurora energy  (thread activity)
//   p.z = champion pulse (surges when a new champion is crowned)
//   p.w = dream shift    (hue drift toward violet while dreaming)
// ═══════════════════════════════════════════════════════════════

fn cw_aurora(v: vec2f, time: f32, energy: f32, hueShift: f32) -> vec3f {
  var acc = vec3f(0.0);
  for (var i = 0; i < 3; i++) {
    let fi = f32(i);
    let speed = 0.025 + fi * 0.012;
    let band = fbm(vec2f(v.x * (1.3 + fi * 0.6) + time * speed, fi * 7.31 + time * 0.015), 4);
    let center = 0.06 + fi * 0.17 + (band - 0.5) * 0.55 * energy;
    let width = 0.05 + 0.055 * band + 0.02 * fi;
    let curtain = exp(-pow((v.y - center) / width, 2.0));
    // Vertical ray structure drifting sideways
    let rays = 0.55 + 0.45 * fbm(vec2f(v.x * 9.0 + fi * 3.7 - time * (0.05 + fi * 0.02), time * 0.03), 3);
    let green = vec3f(0.05, 0.85, 0.35);
    let violet = vec3f(0.45, 0.15, 0.85);
    let hue = mix(green, violet, clamp(fi * 0.35 + hueShift, 0.0, 1.0));
    acc += hue * curtain * rays * (0.45 + 0.55 * energy);
  }
  return acc;
}

fn visual_cradle_window(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let v = vec2f(uv.x, -uv.y); // compute-path y is inverted; v.y = up
  let starDensity = clamp(p.x, 0.0, 1.0);
  let energy = clamp(p.y, 0.15, 1.6);
  let pulse = clamp(p.z, 0.0, 1.0);
  let dream = clamp(p.w, 0.0, 1.0);
  let hueShift = dream * 0.6 + pulse * 0.25;

  let horizon = -0.34;
  let ridge = horizon + 0.09 + 0.15 * fbm(vec2f(v.x * 2.2 + 13.7, 3.1), 4);

  var c: vec3f;

  if (v.y >= horizon) {
    let sky = clamp((v.y - horizon) / (1.0 - horizon), 0.0, 1.0);
    c = mix(vec3f(0.030, 0.045, 0.085), vec3f(0.005, 0.009, 0.026), sky);
    // Stars — one per grid cell, density from vocabulary
    let sp = v * 46.0;
    let cell = floor(sp);
    let h = hash21(cell);
    let sel = step(1.0 - (0.015 + 0.05 * starDensity), h);
    let fp = fract(sp) - 0.5;
    let pt = smoothstep(0.32, 0.05, length(fp));
    let tw = 0.55 + 0.45 * sin(time * (0.8 + h * 2.4) + h * 61.0);
    c += vec3f(0.85, 0.9, 1.0) * sel * pt * tw * (0.25 + 0.75 * sky);
    // Aurora — the thinking
    let a = cw_aurora(v, time, energy, hueShift);
    c += a * (0.55 + 1.2 * pulse) * smoothstep(horizon, horizon + 0.22, v.y);
    // Black ridgeline, faintly rim-lit by the aurora
    if (v.y < ridge) {
      c = vec3f(0.004, 0.006, 0.012) + a * 0.05;
    }
  } else {
    // Still water remembering the sky
    let wobble = 0.018 * sin(v.y * 42.0 + time * 0.7);
    let rv = vec2f(v.x + wobble, 2.0 * horizon - v.y);
    let a = cw_aurora(rv, time, energy, hueShift);
    let depth = clamp((horizon - v.y) / (1.0 + horizon), 0.0, 1.0);
    c = vec3f(0.007, 0.012, 0.028) + a * 0.42 * (1.0 - depth * 0.75) * (0.55 + 1.2 * pulse);
    let rip = vnoise(vec2f(v.x * 30.0, v.y * 60.0 - time * 0.55));
    c *= 0.85 + 0.30 * rip;
  }

  // Frame: dark bezel with a warm lit edge — a window, not a wall
  let edge = max(abs(uv.x), abs(uv.y));
  c = mix(c, vec3f(0.002, 0.002, 0.004), smoothstep(0.93, 0.962, edge));
  let border = smoothstep(0.962, 0.978, edge) * (1.0 - smoothstep(0.992, 1.0, edge));
  c += vec3f(1.0, 0.60, 0.26) * border * 1.3;

  // Linear HDR out; engine ACES grades it
  let alpha = 1.0 - smoothstep(0.0, 0.5, sdf);
  return vec4f(c * 1.6, alpha);
}
