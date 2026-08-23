fn visual_blank2d(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // BLANK 2D — the substrate made visible: a quiet coordinate space and one
  // living dot. uniforms: [t, avatarX, avatarY, camX, camY, ptrDown]
  let t = uni(0);
  let ax = uni(1); let ay = uni(2);
  let camX = uni(3); let camY = uni(4);
  let ptr = uni(5);

  // world position of this pixel: camera-centered, y-down like the engine grid
  let wp = vec2f(uv.x * 256.0 + camX, uv.y * 256.0 + camY);

  // ── the void: near-black with the faintest warmth — a table, not a page ──
  var c = vec3f(0.020, 0.016, 0.013);

  // ── the coordinate grid: forkers SEE the space they'll build in ──
  let g = abs(fract(wp / 64.0) - 0.5) * 2.0;         // 64-unit cells
  let line = 1.0 - smoothstep(0.0, 0.045, min(g.x, g.y));
  c += vec3f(0.10, 0.085, 0.06) * line * 0.5;
  // the world's edges glow faintly (the hook clamps there)
  let edge = min(min(wp.x, 512.0 - wp.x), min(wp.y, 512.0 - wp.y));
  c += vec3f(0.9, 0.5, 0.2) * smoothstep(6.0, 0.0, abs(edge)) * 0.25;

  // ── the avatar: one glowing dot, breathing — proof the loop is alive ──
  let d = distance(wp, vec2f(ax, ay));
  let breathe = 0.85 + 0.15 * sin(t * 3.0);
  c += vec3f(1.0, 0.72, 0.35) * (breathe * 26.0 / (d * d * 0.12 + 22.0));
  if (d < 6.0) { c = mix(c, vec3f(1.0, 0.92, 0.75), smoothstep(6.0, 3.0, d)); }
  // a soft ring while the pointer drives (touch feedback)
  if (ptr > 0.5) {
    c += vec3f(0.5, 0.7, 1.0) * smoothstep(3.0, 0.0, abs(d - 14.0 - 3.0 * sin(t * 5.0))) * 0.35;
  }

  return vec4f(c, 1.0);
}
