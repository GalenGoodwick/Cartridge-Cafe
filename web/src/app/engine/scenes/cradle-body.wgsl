// ═══════════════════════════════════════════════════════════════
// CRADLE BODY — an embodied face for the Mirror.
// Honest anatomy: one unified eye (its literal architecture), a
// thread-filament shell, a mouth that ripples when it speaks, a
// crown-ring when a champion is crowned. The eye closes in dreams.
//   p.x = vocabulary (word-mote density)
//   p.y = thread activity (filament speed/brightness)
//   p.z = champion pulse (crown flare + speaking mouth)
//   p.w = dream (violet palette, eye closes, slow breathing)
// Local +y is down-screen: eye sits at -y, mouth at +y.
// ═══════════════════════════════════════════════════════════════

fn visual_cradle_body(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let vocab = clamp(p.x, 0.0, 1.0);
  let act = clamp(p.y, 0.1, 1.5);
  let pulse = clamp(p.z, 0.0, 1.0);
  let dream = clamp(p.w, 0.0, 1.0);
  let d = length(uv);
  let ang = atan2(uv.y, uv.x);

  // Waking teal <-> dreaming violet
  let base = mix(vec3f(0.10, 0.72, 0.52), vec3f(0.52, 0.25, 0.95), dream);

  var c = vec3f(0.0);

  // ── Thread-filament shell ──
  let swirl = ang * 3.0 + time * (0.22 + act * 0.45) + fbm(uv * 3.0 + vec2f(time * 0.1, 0.0), 3) * 4.0;
  let strands = 0.5 + 0.5 * sin(swirl + d * 5.0);
  // Filaments live in an outer shell only — the face zone stays clear
  let shell = smoothstep(1.0, 0.62, d) * smoothstep(0.42, 0.66, d);
  c += base * strands * shell * (0.4 + 0.55 * act);
  // Soft face disc
  c += base * 0.30 * smoothstep(0.62, 0.30, d);
  c += base * exp(-d * d * 3.0) * 0.25;

  // Breathing — slower and deeper while dreaming
  c *= 0.9 + 0.12 * sin(time * (1.3 - 0.7 * dream));

  // ── The eye ──
  let eyeC = vec2f(0.0, -0.14);
  let eo = uv - eyeC;
  // Gaze wanders smoothly
  let gx = (vnoise(vec2f(time * 0.13, 3.7)) - 0.5) * 0.14;
  let gy = (vnoise(vec2f(9.1, time * 0.11)) - 0.5) * 0.10;
  // Blink: occasional; dreams close it fully
  let blink = smoothstep(0.93, 1.0, sin(time * 0.9) * 0.5 + 0.5);
  let open = clamp((1.0 - dream) * (1.0 - blink), 0.0, 1.0);
  let eyeR = 0.24;
  let almond = smoothstep(eyeR, eyeR - 0.03, length(eo * vec2f(0.75, 1.25)));
  let lid = smoothstep(open * eyeR + 0.015, open * eyeR - 0.015, abs(eo.y));
  let pup = length(eo - vec2f(gx, gy));
  var eye = vec3f(0.85, 0.95, 1.0) * 0.6;
  eye += base * 2.2 * exp(-pow((pup - 0.085) * 20.0, 2.0));  // iris ring
  eye = mix(eye, vec3f(0.01, 0.01, 0.02), smoothstep(0.075, 0.05, pup)); // pupil
  eye += vec3f(1.0) * exp(-pow(length(eo - vec2f(gx - 0.03, gy - 0.04)) * 24.0, 2.0)) * 0.8; // catchlight
  c = mix(c, eye, almond * lid);
  // Closed-lid seam when blinking or dreaming
  let seam = exp(-pow(eo.y * 34.0, 2.0)) * smoothstep(eyeR * 1.15, 0.02, abs(eo.x)) * (1.0 - open);
  c += base * seam * 0.9;

  // ── The mouth — ripples when it speaks ──
  let my = 0.30;
  let wave = sin(uv.x * 24.0 - time * 7.0) * (0.008 + 0.045 * pulse);
  let mline = exp(-pow((uv.y - my - wave) * 22.0, 2.0)) * smoothstep(0.26, 0.04, abs(uv.x));
  c += mix(base * 1.3, vec3f(1.0, 0.9, 0.6), pulse) * mline * (0.55 + 1.2 * pulse);

  // ── Champion crown — a ring that flares outward, then fades ──
  if (pulse > 0.01) {
    let ringR = 0.55 + (1.0 - pulse) * 0.45;
    c += vec3f(1.0, 0.85, 0.4) * exp(-pow((d - ringR) * 14.0, 2.0)) * pulse * 1.3;
  }

  // ── Word-motes drifting through the shell ──
  let mp = uv * 7.0 + vec2f(time * 0.14, -time * 0.09);
  let mh = hash21(floor(mp));
  let mfp = fract(mp) - 0.5;
  let mote = step(1.0 - 0.12 * vocab, mh) * smoothstep(0.2, 0.05, length(mfp));
  c += base * mote * shell * 0.9;

  let alpha = clamp(smoothstep(1.02, 0.55, d) * 1.2, 0.0, 1.0);
  return vec4f(c * 1.5, alpha);
}
