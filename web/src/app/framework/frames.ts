// Per-concept inline shader frames for /framework. Each is a WGSL
// `fn fieldEffect(...)` authored against the SAME contract the /pages feature
// uses (buildPageFrameShader in ../pages/frame-shader), so it renders through
// <ShaderFrame>. Built only from utilities proven to compile in the SEED_*
// frames — regionUV, fbm, warp, hash11, hash21 — plus WGSL builtins.

// 01 · FIELD — a grid of cells with two shader-painted fields (circle + rect)
export const FRAME_FIELD = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = mix(vec3f(0.04, 0.06, 0.10), vec3f(0.02, 0.03, 0.06), uv.y);
  let g = 13.0;
  let f = fract(uv * g);
  let inside = smoothstep(0.0, 0.06, f.x) * smoothstep(0.0, 0.06, 1.0 - f.x) * smoothstep(0.0, 0.06, f.y) * smoothstep(0.0, 0.06, 1.0 - f.y);
  col += vec3f(0.22, 0.42, 0.55) * (1.0 - inside) * 0.16;
  let cell = floor(uv * g);
  let h = hash21(cell + floor(vec2f(time * 2.0, time * 1.3)));
  col += vec3f(1.0, 0.5, 0.2) * step(0.93, h) * (0.4 + 0.4 * sin(time * 7.0));
  let dc = distance(uv, vec2f(0.33, 0.52));
  col += vec3f(0.2, 0.9, 0.6) * smoothstep(0.17, 0.15, dc) * 0.55;
  let rq = max(abs(uv.x - 0.68) - 0.12, abs(uv.y - 0.5) - 0.12);
  col += vec3f(1.0, 0.45, 0.2) * smoothstep(0.008, -0.008, rq) * 0.5;
  return vec4f(col, 1.0);
}
`

// 02 · PIXEL-FIRST — a blocky, quantized shape with a readback scanline
export const FRAME_PIXEL = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = vec3f(0.02, 0.03, 0.06);
  let px = 20.0;
  let q = (floor(uv * px) + 0.5) / px;
  let d = distance(q, vec2f(0.5, 0.5));
  let shape = smoothstep(0.30, 0.27, d);
  col = mix(col, vec3f(1.0, 0.5, 0.2), shape * 0.85);
  let idx = hash21(floor(uv * px));
  col += vec3f(0.15, 0.5, 0.6) * step(0.5, shape) * (0.15 + 0.35 * idx);
  let sy = fract(time * 0.35);
  col += vec3f(0.3, 1.0, 0.65) * smoothstep(0.015, 0.0, abs(uv.y - sy));
  return vec4f(col, 1.0);
}
`

// 03 · WHITEBOARD — a row of pulsing float slots (the shared uniform array)
export const FRAME_WHITEBOARD = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = vec3f(0.03, 0.05, 0.09);
  let n = 8.0;
  let i = floor(uv.x * n);
  let fx = fract(uv.x * n);
  let inslot = smoothstep(0.10, 0.16, fx) * smoothstep(0.10, 0.16, 1.0 - fx);
  let val = 0.25 + 0.65 * abs(sin(time * 1.6 + i * 0.8));
  let fill = step(1.0 - val, uv.y);
  let c = mix(vec3f(1.0, 0.5, 0.2), vec3f(0.2, 0.85, 0.6), i / (n - 1.0));
  col += c * fill * inslot * 0.8;
  return vec4f(col, 1.0);
}
`

// 04 · CARTRIDGE — a glowing cartridge silhouette with a notch + label band
export const FRAME_CARTRIDGE = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = mix(vec3f(0.05, 0.06, 0.10), vec3f(0.02, 0.02, 0.05), uv.y);
  let b = max(abs(uv.x - 0.5) - 0.24, abs(uv.y - 0.5) - 0.30);
  let body = smoothstep(0.01, -0.01, b);
  let notch = max(abs(uv.x - 0.5) - 0.12, abs(uv.y - 0.26) - 0.06);
  let cut = smoothstep(0.0, -0.02, notch);
  let card = clamp(body - cut, 0.0, 1.0);
  col = mix(col, vec3f(0.9, 0.42, 0.18), card * 0.45);
  col += vec3f(1.0, 0.7, 0.35) * smoothstep(0.02, 0.0, abs(b)) * 0.5;
  col += vec3f(0.2, 0.85, 0.6) * card * step(0.58, uv.y) * step(uv.y, 0.63) * (0.4 + 0.4 * sin(time * 3.0));
  return vec4f(col, 1.0);
}
`

// 05 · BRIDGE — two pads on a wire with a pulse traveling between them
export const FRAME_BRIDGE = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = vec3f(0.02, 0.03, 0.07);
  let a = vec2f(0.2, 0.5);
  let bpt = vec2f(0.8, 0.5);
  col += vec3f(0.2, 0.85, 0.6) * smoothstep(0.06, 0.04, distance(uv, a)) * 0.85;
  col += vec3f(1.0, 0.5, 0.2) * smoothstep(0.06, 0.04, distance(uv, bpt)) * 0.85;
  col += vec3f(0.4, 0.6, 0.75) * smoothstep(0.010, 0.0, abs(uv.y - 0.5)) * step(0.2, uv.x) * step(uv.x, 0.8) * 0.5;
  let pxp = 0.2 + 0.6 * fract(time * 0.4);
  col += vec3f(0.6, 1.0, 0.8) * smoothstep(0.03, 0.0, distance(uv, vec2f(pxp, 0.5)));
  return vec4f(col, 1.0);
}
`

// 06 · THE EYES — an almond eye with an iris ring, pupil, and a scan sweep
export const FRAME_EYES = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = vec3f(0.02, 0.03, 0.06);
  let top = distance(uv, vec2f(0.5, 0.90)) - 0.52;
  let bot = distance(uv, vec2f(0.5, 0.10)) - 0.52;
  let eye = max(top, bot);
  let ink = smoothstep(0.0, -0.02, eye);
  col = mix(col, vec3f(0.05, 0.08, 0.13), ink);
  let dc = distance(uv, vec2f(0.5, 0.5));
  col += vec3f(1.0, 0.5, 0.2) * ink * smoothstep(0.02, 0.0, abs(dc - 0.13)) * (0.6 + 0.4 * sin(time * 2.0));
  col += vec3f(1.0, 0.8, 0.5) * ink * smoothstep(0.06, 0.04, dc);
  col += vec3f(0.3, 1.0, 0.6) * ink * smoothstep(0.02, 0.0, abs(uv.x - (0.2 + 0.6 * fract(time * 0.3)))) * 0.4;
  return vec4f(col, 1.0);
}
`

// 07 · COMMONS — many motes drifting on one shared field
export const FRAME_COMMONS = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = vec3f(0.02, 0.04, 0.08);
  for (var i = 0; i < 30; i = i + 1) {
    let fi = f32(i);
    let ang = hash11(fi) * 6.2831 + time * 0.2 * (0.5 + hash11(fi + 9.0));
    let rad = 0.42 * fract(hash11(fi + 3.0) + time * 0.06 * (0.5 + hash11(fi + 5.0)));
    let p = vec2f(0.5, 0.5) + vec2f(cos(ang), sin(ang)) * (0.42 - rad);
    let d = distance(uv, p);
    col += mix(vec3f(0.3, 0.7, 0.9), vec3f(1.0, 0.6, 0.3), hash11(fi + 1.0)) * (0.004 / (d * d + 0.0008)) * 0.4;
  }
  col += vec3f(1.0, 0.7, 0.35) * (0.02 / (distance(uv, vec2f(0.5, 0.5)) + 0.05)) * 0.3;
  return vec4f(col, 1.0);
}
`

// 08 · WORK-GRAPH — (kept as the live SVG node-graph in the page)
//     A subtle constellation, used only if a shader fallback is ever wanted.
export const FRAME_GRAPH = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = vec3f(0.02, 0.03, 0.07);
  for (var i = 0; i < 7; i = i + 1) {
    let fi = f32(i);
    let p = vec2f(0.15 + 0.7 * hash11(fi), 0.2 + 0.6 * hash11(fi + 11.0));
    col += mix(vec3f(0.2, 0.85, 0.6), vec3f(1.0, 0.5, 0.2), hash11(fi + 3.0)) * smoothstep(0.045, 0.02, distance(uv, p)) * 0.8;
  }
  return vec4f(col, 1.0);
}
`

// 09 · WORKTREE — parallel lanes, each drifting a token independently
export const FRAME_WORKTREE = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = vec3f(0.03, 0.04, 0.07);
  let n = 5.0;
  let lane = floor(uv.x * n);
  let fx = fract(uv.x * n);
  let sep = smoothstep(0.0, 0.04, fx) * smoothstep(0.0, 0.04, 1.0 - fx);
  col += vec3f(0.1, 0.2, 0.3) * (1.0 - sep) * 0.3;
  let ph = fract(uv.y + time * (0.10 + 0.05 * hash11(lane)) + hash11(lane + 2.0));
  col += mix(vec3f(0.2, 0.85, 0.6), vec3f(1.0, 0.5, 0.2), hash11(lane + 7.0)) * smoothstep(0.06, 0.0, abs(ph - 0.5)) * sep * 0.7;
  return vec4f(col, 1.0);
}
`

// 10 · HUBWORLD — portal rings expanding out, satellite bubbles orbiting
export const FRAME_HUB = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = vec3f(0.02, 0.03, 0.07);
  let d = distance(uv, vec2f(0.5, 0.5));
  for (var i = 0; i < 5; i = i + 1) {
    let fi = f32(i);
    let r = fract(time * 0.15 + fi * 0.2) * 0.5;
    col += mix(vec3f(0.3, 0.7, 0.9), vec3f(1.0, 0.6, 0.3), fi / 4.0) * smoothstep(0.02, 0.0, abs(d - r)) * (1.0 - r * 1.8) * 0.6;
  }
  for (var j = 0; j < 6; j = j + 1) {
    let fj = f32(j);
    let a = fj / 6.0 * 6.2831 + time * 0.3;
    let p = vec2f(0.5, 0.5) + vec2f(cos(a), sin(a)) * 0.36;
    col += vec3f(0.5, 0.9, 0.8) * smoothstep(0.05, 0.03, distance(uv, p)) * 0.6;
  }
  return vec4f(col, 1.0);
}
`

// 11 · ARENA — a grid pulsing on a beat, with a shared puck bouncing
export const FRAME_ARENA = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = vec3f(0.02, 0.03, 0.06);
  let g = 10.0;
  let f = fract(uv * g);
  let cellIn = smoothstep(0.0, 0.05, f.x) * smoothstep(0.0, 0.05, 1.0 - f.x) * smoothstep(0.0, 0.05, f.y) * smoothstep(0.0, 0.05, 1.0 - f.y);
  let beat = 0.5 + 0.5 * sin(time * 2.5);
  col += mix(vec3f(0.2, 0.5, 0.7), vec3f(1.0, 0.5, 0.2), beat) * (1.0 - cellIn) * (0.15 + 0.25 * beat);
  let bx = 0.5 + 0.4 * sin(time * 1.7);
  let by = 0.5 + 0.35 * cos(time * 2.3);
  col += vec3f(1.0, 0.8, 0.5) * smoothstep(0.05, 0.03, distance(uv, vec2f(bx, by)));
  return vec4f(col, 1.0);
}
`
