// Shader-page frames — a mobile-first, separate feature from the game world.
// A "frame" is a full-bleed WGSL surface authored by the connected AI. We reuse
// the exact FieldEngine utility library (getShaderUtilities) and the same
// `fn fieldEffect(...)` contract so frames stay portable — but we map uv directly
// to a 0..gridSize region (no square-grid camera) so a frame fills its rectangle
// edge-to-edge and procedural text (char5x7) renders upright, top-left origin.

import { getShaderUtilities, vertexShaderSource } from '@/app/engine/shaders'

export const PAGE_FRAME_VERTEX = vertexShaderSource

/**
 * Wrap an AI-authored `fn fieldEffect(cellPos, regionMin, regionMax, time, params) -> vec4f`
 * into a complete fragment module. Same utility library + signature as the engine;
 * the whiteboard/flock accessors are stubbed so engine-authored shaders still compile.
 */
export function buildPageFrameShader(fieldEffectWgsl: string): string {
  return /* wgsl */ `
struct FrameU {
  resolution: vec2f,
  time: f32,
  gridSize: f32,
  params: vec4f,
};
@group(0) @binding(0) var<uniform> u: FrameU;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

// Stubs — a page frame has no engine whiteboard/flock, but shaders may reference these.
fn uni(i: i32) -> f32 { return 0.0; }
fn uni4(i: i32) -> vec4f { return vec4f(0.0); }
fn pop(i: i32) -> vec4f { return vec4f(0.0); }
fn popCount() -> i32 { return 0; }

${getShaderUtilities()}

${fieldEffectWgsl}

@fragment
fn main(in: VertexOutput) -> @location(0) vec4f {
  // uv arrives y-up from the fullscreen quad; flip to a top-left, y-down origin
  // so text is upright and (0,0) is the top-left corner of the frame.
  let suv = vec2f(in.uv.x, 1.0 - in.uv.y);
  let cellCoord = floor(suv * u.gridSize) + vec2f(0.5);
  let region = vec2f(u.gridSize);
  let c = fieldEffect(cellCoord, vec2f(0.0), region, u.time, u.params);
  return vec4f(c.rgb, 1.0);
}
`
}

// ─── Seed frames (hand-authored, so a new page renders instantly, no AI call) ───

export const SEED_HERO = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  // cold field, darker toward the base
  var col = mix(vec3f(0.05, 0.07, 0.12), vec3f(0.02, 0.03, 0.06), uv.y);
  // ember glow rising from the hearth line
  let d = distance(uv, vec2f(0.5, 0.86));
  col += vec3f(1.0, 0.42, 0.17) * (0.10 / (d * d + 0.02)) * (0.9 + 0.2 * sin(time * 2.0));
  // wordmark "CAFE" via the procedural 5x7 font
  var codes = array<i32, 4>(67, 65, 70, 69);
  let n = 4.0;
  let x0 = 0.24;
  let x1 = 0.76;
  let yc = 0.40;
  let ch = 0.17;
  let lx = (uv.x - x0) / ((x1 - x0) / n);
  let li = i32(floor(lx));
  if (li >= 0 && li < 4) {
    let cy = (uv.y - (yc - ch * 0.5)) / ch;
    if (cy >= 0.0 && cy <= 1.0) {
      let ink = char5x7(vec2f(fract(lx), cy), codes[li]);
      col = mix(col, vec3f(1.0, 0.74, 0.38), ink);
    }
  }
  return vec4f(col, 1.0);
}
`

export const SEED_EMBER = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  var col = mix(vec3f(0.03, 0.05, 0.09), vec3f(0.01, 0.02, 0.04), uv.y);
  // cold motes drifting in the field
  let m = hash21(floor(cellPos * 0.6) + floor(time * 0.5));
  if (m > 0.987) { col += vec3f(0.2, 0.4, 0.55) * 0.5; }
  // rising embers
  for (var i = 0; i < 26; i = i + 1) {
    let fi = f32(i);
    let sx = 0.5 + (hash11(fi) - 0.5) * 0.6;
    let speed = 0.05 + hash11(fi + 7.0) * 0.09;
    let py = fract(1.0 - (time * speed + hash11(fi + 3.0)));
    let px = sx + sin(py * 6.0 + fi) * 0.03;
    let dd = distance(uv, vec2f(px, py));
    let g = 0.006 / (dd * dd + 0.0009);
    let warm = mix(vec3f(1.0, 0.5, 0.15), vec3f(0.8, 0.1, 0.02), py);
    col += warm * g * (1.0 - py) * 0.5;
  }
  // hearth glow at the base
  let hd = distance(uv, vec2f(0.5, 0.98));
  col += vec3f(1.0, 0.45, 0.18) * (0.05 / (hd * hd + 0.02));
  return vec4f(col, 1.0);
}
`

export const SEED_AURORA = /* wgsl */ `
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  let w = warp(uv * 2.0 + vec2f(0.0, time * 0.05), 0.6, time * 0.1);
  let n = fbm(w * 2.5, 5);
  let band = smoothstep(0.2, 0.85, n);
  var col = mix(vec3f(0.02, 0.03, 0.06), vec3f(0.05, 0.5, 0.55), band * 0.6);
  col += vec3f(0.4, 0.2, 0.6) * pow(band, 3.0) * 0.5;
  // an ember counterpoint threading through the cold
  col += vec3f(1.0, 0.4, 0.15) * pow(fbm(uv * 3.0 - vec2f(time * 0.1), 4), 4.0) * 0.4;
  return vec4f(col, 1.0);
}
`
