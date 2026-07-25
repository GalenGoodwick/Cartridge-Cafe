// VEILFIRE — atmosphere. Dread mood layered over a plainly-lit color.
//   vf_atmos(c, pos, rd, t, time):
//     c    = lit color at the hit (linear HDR)
//     pos  = hit point in world space
//     rd   = ray direction (unit)
//     t    = hit distance (fog falloff)
//     time = seconds
//   returns the color, dread-soaked. Output stays LINEAR HDR — no tonemap here.
//
// Four cheap layers, in order:
//   1. cool desaturation with a warm firelight bias (drain life, keep the fire)
//   2. torch flicker — layered sin-noise multiplying the whole scene
//   3. depth fog toward near-black cold murk (dread deepens it)
//   4. faint drifting ember specks low in the frame
//
// Mood dials read from the whiteboard (see SPEC): uni(12)=dread01, uni(18)=fogDensity.
// Both degrade gracefully to sane defaults when unset (zero).

fn vf_hash11(n: f32) -> f32 { return fract(sin(n * 43758.5453) * 12345.6789); }

fn vf_atmos(c: vec3f, pos: vec3f, rd: vec3f, t: f32, time: f32) -> vec3f {
  var col = c;

  let dread = clamp(uni(12), 0.0, 1.0);
  let fogD  = max(uni(18), 0.0);

  // ── 1. cool desaturation + warm firelight bias ─────────────────────────────
  // Drain saturation toward grey (harder the more dread), then re-tint: warm
  // ember in the lit/bright regions, cold blue in the shadows.
  let lum   = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  let desat = mix(col, vec3f(lum), 0.42 + 0.28 * dread);
  let warm  = vec3f(1.18, 0.60, 0.28);
  let cool  = vec3f(0.52, 0.66, 0.96);
  let tint  = mix(cool, warm, clamp(lum * 1.6, 0.0, 1.0));
  col = desat * tint;

  // ── 2. torch flicker — layered sin-noise, multiplies everything ────────────
  let f1 = sin(time * 11.0) * 0.5 + sin(time * 17.3 + 1.7) * 0.3 + sin(time * 29.0) * 0.2;
  let f2 = sin(time * 3.1 + 0.5);
  let flick = 1.0 + 0.06 * f1 + 0.03 * f2;   // roughly ±9% breathing
  col = col * flick;

  // ── 3. depth fog toward near-black cold murk ───────────────────────────────
  let density = fogD + 0.0035 + 0.007 * dread;
  let fogAmt  = 1.0 - exp(-t * t * density);
  let murk    = vec3f(0.014, 0.012, 0.020);  // near-black with a faint cold cast
  col = mix(col, murk, fogAmt);

  // ── 4. drifting ember specks, low in the frame ─────────────────────────────
  // Parameterize by ray direction so motes float in view; drift upward in time.
  let ep = vec2f(rd.x * 6.0, rd.y * 6.0 - time * 0.35);
  var ember = 0.0;
  for (var k = 0; k < 3; k = k + 1) {
    let sc   = 1.0 + f32(k) * 1.7;
    let g    = ep * sc + vec2f(f32(k) * 13.7, f32(k) * 7.3);
    let cell = floor(g);
    let fr   = fract(g) - 0.5;
    let h    = vf_hash11(cell.x * 57.0 + cell.y * 131.0 + f32(k) * 3.0);
    let on   = step(0.92, h);                 // only a few cells host an ember
    let jit  = vec2f(vf_hash11(h * 21.0) - 0.5, vf_hash11(h * 47.0) - 0.5) * 0.6;
    let d    = length(fr - jit);
    let mote = on * smoothstep(0.09, 0.0, d);
    let tw   = 0.5 + 0.5 * sin(time * (4.0 + h * 6.0) + h * 30.0);  // twinkle
    ember = ember + mote * tw;
  }
  // Sit near the low end (bottom of view) and glow warmer through the murk.
  let lowBias  = smoothstep(0.30, -0.45, rd.y);
  let emberCol = vec3f(1.30, 0.52, 0.16);
  col = col + emberCol * ember * lowBias * (0.35 + 0.55 * fogAmt);

  return col;
}
