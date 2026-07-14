// Field Engine — WGSL Shaders
// Split into base pass (grid + colors + selection highlight), effect pass (per-field WGSL),
// state update compute, and utility library

// ─── Vertex shader (fullscreen quad) ───

export const vertexShaderSource = /* wgsl */`
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
  );
  var out: VertexOutput;
  out.position = vec4f(positions[vi], 0.0, 1.0);
  out.uv = uvs[vi];
  return out;
}
`

// ─── Per-frame uniform struct (Group 0) ───
const FRAME_UNIFORM_STRUCT = /* wgsl */`
struct FrameUniforms {
  camera: vec2f,
  resolution: vec2f,
  zoom: f32,
  time: f32,
  gridSize: f32,
  renderMode: f32,    // 0.0 = 2D, 1.0 = 3D
  cam3Dpos: vec3f,    // 3D camera position
  cam3Dfov: f32,      // field of view (radians)
  cam3Ddir: vec2f,    // pitch, yaw
  _pad3D: vec2f,
};
@group(0) @binding(0) var<uniform> frame: FrameUniforms;
`

// ─── Per-effect uniform struct (Group 2) ───
const EFFECT_UNIFORM_STRUCT = /* wgsl */`
struct EffectUniforms {
  bounds: vec4f,
  params: vec4f,
  transform: vec4f,
  fieldAColor: vec4f,
  fieldBColor: vec4f,
  fieldATransform: vec4f,
  fieldBTransform: vec4f,
};
@group(2) @binding(0) var<uniform> effect: EffectUniforms;
`

// ─── State update uniform struct ───
const STATE_UNIFORM_STRUCT = /* wgsl */`
struct StateUniforms {
  gridSize: f32,
  time: f32,
  dt: f32,
  _pad: f32,
};
@group(0) @binding(0) var<uniform> state_uniforms: StateUniforms;
`

// ─── Shared coordinate math — camera → grid coord conversion ───
const COORD_MATH = /* wgsl */`
  let aspect = frame.resolution.x / frame.resolution.y;
  let gridRange = vec2f(frame.gridSize) / frame.zoom;

  var gridCoord: vec2f;
  if (aspect > 1.0) {
    gridCoord.x = frame.camera.x + (in.uv.x - 0.5) * gridRange.x * aspect;
    gridCoord.y = frame.camera.y + (0.5 - in.uv.y) * gridRange.y;
  } else {
    gridCoord.x = frame.camera.x + (in.uv.x - 0.5) * gridRange.x;
    gridCoord.y = frame.camera.y + (0.5 - in.uv.y) * gridRange.y / aspect;
  }

  let texUV = gridCoord / frame.gridSize;
`

// ─── WGSL Utility Library ───
const SHADER_UTILITIES = /* wgsl */`
// --- Utility Library ---

// GLSL mod semantics: x - y * floor(x / y)
fn glsl_mod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn glsl_mod2(x: vec2f, y: vec2f) -> vec2f { return x - y * floor(x / y); }

// Hash functions
fn hash11(p_in: f32) -> f32 {
  var p = fract(p_in * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33);
  return fract((vec2f(p3.x, p3.x) + vec2f(p3.y, p3.z)) * vec2f(p3.z, p3.y));
}

fn hash33(p3_in: vec3f) -> vec3f {
  var p3 = fract(p3_in * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, vec3f(p3.y, p3.x, p3.z) + 33.33);
  return fract((vec3f(p3.x, p3.x, p3.y) + vec3f(p3.y, p3.x, p3.x)) * vec3f(p3.z, p3.y, p3.x));
}

// Value noise
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Gradient noise (Perlin-like)
fn gnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash22(i) * 2.0 - 1.0, f),
                 dot(hash22(i + vec2f(1.0, 0.0)) * 2.0 - 1.0, f - vec2f(1.0, 0.0)), u.x),
             mix(dot(hash22(i + vec2f(0.0, 1.0)) * 2.0 - 1.0, f - vec2f(0.0, 1.0)),
                 dot(hash22(i + vec2f(1.0, 1.0)) * 2.0 - 1.0, f - vec2f(1.0, 1.0)), u.x), u.y);
}

// Fractal Brownian Motion (2D)
fn fbm(p: vec2f, octaves: i32) -> f32 {
  var val = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  for (var i = 0; i < 8; i++) {
    if (i >= octaves) { break; }
    val += amp * vnoise(p * freq);
    freq *= 2.0;
    amp *= 0.5;
  }
  return val;
}

// 3D hash → scalar
fn hash31(p: vec3f) -> f32 {
  var p3 = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 3D value noise — trilinear interpolation of hashed cube corners
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = hash31(i);
  let b = hash31(i + vec3f(1.0, 0.0, 0.0));
  let c = hash31(i + vec3f(0.0, 1.0, 0.0));
  let d = hash31(i + vec3f(1.0, 1.0, 0.0));
  let e = hash31(i + vec3f(0.0, 0.0, 1.0));
  let g = hash31(i + vec3f(1.0, 0.0, 1.0));
  let h = hash31(i + vec3f(0.0, 1.0, 1.0));
  let k = hash31(i + vec3f(1.0, 1.0, 1.0));
  let x1 = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  let x2 = mix(mix(e, g, f.x), mix(h, k, f.x), f.y);
  return mix(x1, x2, f.z);
}

// 3D Fractal Brownian Motion
fn fbm3d(p: vec3f, octaves: i32) -> f32 {
  var val = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  for (var i = 0; i < 8; i++) {
    if (i >= octaves) { break; }
    val += amp * vnoise3(p * freq);
    freq *= 2.0;
    amp *= 0.5;
  }
  return val;
}

// Domain warping
fn warp(p: vec2f, strength: f32, time: f32) -> vec2f {
  let q = vec2f(fbm(p + vec2f(0.0, 0.0), 4), fbm(p + vec2f(5.2, 1.3), 4));
  let r = vec2f(fbm(p + 4.0 * q + vec2f(1.7, 9.2) + 0.15 * time, 4),
                fbm(p + 4.0 * q + vec2f(8.3, 2.8) + 0.126 * time, 4));
  return p + strength * r;
}

// SDF primitives (2D)
fn sdCircle(p: vec2f, r: f32) -> f32 { return length(p) - r; }
fn sdBox(p: vec2f, b: vec2f) -> f32 { let d = abs(p) - b; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }
fn sdRoundedBox(p: vec2f, b: vec2f, r: f32) -> f32 { return sdBox(p, b - r) - r; }
fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
fn sdEquilateralTriangle(p_in: vec2f, r: f32) -> f32 {
  let k = 1.732050808;
  var p = p_in;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) { p = vec2f(p.x - k * p.y, -k * p.x - p.y) / 2.0; }
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
fn sdStar(p_in: vec2f, r: f32, n: i32, m: f32) -> f32 {
  let an = 3.141593 / f32(n);
  let en = 3.141593 / m;
  let acs = vec2f(cos(an), sin(an));
  let ecs = vec2f(cos(en), sin(en));
  let bn = glsl_mod(atan2(p_in.x, p_in.y), 2.0 * an) - an;
  var p = length(p_in) * vec2f(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}

// SDF operations
fn opUnion(d1: f32, d2: f32) -> f32 { return min(d1, d2); }
fn opSubtract(d1: f32, d2: f32) -> f32 { return max(-d1, d2); }
fn opIntersect(d1: f32, d2: f32) -> f32 { return max(d1, d2); }
fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0); return mix(d2, d1, h) - k * h * (1.0 - h); }
fn opSmoothSubtract(d1: f32, d2: f32, k: f32) -> f32 { let h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0); return mix(d2, -d1, h) + k * h * (1.0 - h); }

// Color utilities
fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3f(c.x) + vec3f(K.x, K.y, K.z)) * 6.0 - vec3f(K.w));
  return c.z * mix(vec3f(K.x), clamp(p - vec3f(K.x), vec3f(0.0), vec3f(1.0)), c.y);
}

fn palette(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(6.28318 * (c * t + d));
}

// Rotation matrix
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, -s, s, c); }

// Normalize position within region to 0..1
fn regionUV(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f) -> vec2f {
  return (cellPos - regionMin) / max(regionMax - regionMin, vec2f(1.0));
}

// Centered region UV (-1..1)
fn regionUVCentered(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f) -> vec2f {
  return regionUV(cellPos, regionMin, regionMax) * 2.0 - 1.0;
}

// Aspect-corrected centered UV
fn regionUVAspect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f) -> vec2f {
  var uv = regionUVCentered(cellPos, regionMin, regionMax);
  let size = regionMax - regionMin;
  let aspect = size.x / max(size.y, 1.0);
  uv.x *= aspect;
  return uv;
}

// Simple lighting
fn diffuseLight(p: vec2f, lightPos: vec2f, falloff: f32) -> f32 {
  let d = length(p - lightPos);
  return 1.0 / (1.0 + d * d * falloff);
}

// Glow effect
fn glow(d: f32, col: vec3f, intensity: f32, radius: f32) -> vec3f {
  return col * intensity * exp(-d * d / (radius * radius));
}

// ─── Agent-Friendly Convenience Wrappers ───
// These have fewer arguments and simpler signatures so AI agents can use them without errors.

// FBM with preset octave counts — 2D versions
fn fbm3(p: vec2f) -> f32 { return fbm(p, 3); }
fn fbm4(p: vec2f) -> f32 { return fbm(p, 4); }
fn fbm5(p: vec2f) -> f32 { return fbm(p, 5); }
fn fbm6(p: vec2f) -> f32 { return fbm(p, 6); }

// FBM with preset octave counts — 3D versions (use vec3f for time-animated noise)
fn fbm3v(p: vec3f) -> f32 { return fbm3d(p, 3); }
fn fbm4v(p: vec3f) -> f32 { return fbm3d(p, 4); }
fn fbm5v(p: vec3f) -> f32 { return fbm3d(p, 5); }
fn fbm6v(p: vec3f) -> f32 { return fbm3d(p, 6); }

// Rotate a 2D point by angle (agents struggled with rot2() * vec2f multiplication)
fn rotate(p: vec2f, angle: f32) -> vec2f { return rot2(angle) * p; }

// Simple noise at a point — 2D and 3D
fn noise(p: vec2f) -> f32 { return vnoise(p); }
fn noisev(p: vec3f) -> f32 { return vnoise3(p); }
fn noise3(p: vec2f) -> f32 { return fbm(p, 3); }

// Simple circle mask: 1.0 inside, 0.0 outside, with smooth edge
fn circleMask(uv: vec2f, radius: f32) -> f32 { return smoothstep(radius, radius - 0.05, length(uv)); }

// Polar coordinates from centered UV
fn polar(uv: vec2f) -> vec2f { return vec2f(length(uv), atan2(uv.y, uv.x)); }

// Quick color ramp between two colors based on value 0..1
fn colorRamp(a: vec3f, b: vec3f, t: f32) -> vec3f { return mix(a, b, clamp(t, 0.0, 1.0)); }

// Soft glow centered at origin
fn softGlow(uv: vec2f, intensity: f32, radius: f32) -> f32 { return intensity * exp(-dot(uv, uv) / (radius * radius)); }

// Ring shape: returns intensity of a ring at given radius with given width
fn ring(uv: vec2f, radius: f32, width: f32) -> f32 { return exp(-pow(length(uv) - radius, 2.0) / (width * width)); }

// ─── Voronoi noise (cellular) ───
// Returns vec2f(minDist, secondMinDist) — useful for cell edges, crystals, cracks
fn voronoi(p: vec2f) -> vec2f {
  let n = floor(p);
  let f = fract(p);
  var md = 8.0;
  var md2 = 8.0;
  for (var j: i32 = -1; j <= 1; j++) {
    for (var i: i32 = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = hash22(n + g);
      let r = g + o - f;
      let d = dot(r, r);
      if (d < md) { md2 = md; md = d; } else if (d < md2) { md2 = d; }
    }
  }
  return vec2f(sqrt(md), sqrt(md2));
}

// Voronoi edge detection — returns 0..1 (1 = on edge)
fn voronoiEdge(p: vec2f, width: f32) -> f32 {
  let v = voronoi(p);
  return 1.0 - smoothstep(0.0, width, v.y - v.x);
}

// ─── Simplex-like noise (2D) ───
fn simplex2d(p: vec2f) -> f32 {
  let K1 = 0.366025404;  // (sqrt(3)-1)/2
  let K2 = 0.211324865;  // (3-sqrt(3))/6
  let si = floor(p + (p.x + p.y) * K1);
  let a = p - si + (si.x + si.y) * K2;
  let of_ = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), a.x > a.y);
  let b = a - of_ + vec2f(K2);
  let c = a - vec2f(1.0) + vec2f(2.0 * K2);
  let h = max(vec3f(0.5) - vec3f(dot(a, a), dot(b, b), dot(c, c)), vec3f(0.0));
  let h4 = h * h * h * h;
  let n = vec3f(dot(a, hash22(si) * 2.0 - 1.0),
                dot(b, hash22(si + of_) * 2.0 - 1.0),
                dot(c, hash22(si + vec2f(1.0)) * 2.0 - 1.0));
  return dot(h4, n) * 70.0;
}

// ─── Pattern generators ───

// Checkerboard: returns 0.0 or 1.0 in alternating squares of given size
fn checkerboard(p: vec2f, size: f32) -> f32 {
  let c = floor(p / size);
  return glsl_mod(c.x + c.y, 2.0);
}

// Brick pattern: returns 0..1 (1 = mortar/gap)
fn brick(p: vec2f, brickSize: vec2f, mortarWidth: f32) -> f32 {
  var bp = p / brickSize;
  let row = floor(bp.y);
  bp.x += glsl_mod(row, 2.0) * 0.5; // offset every other row
  let cell = fract(bp);
  let hw = mortarWidth / brickSize.x * 0.5;
  let hh = mortarWidth / brickSize.y * 0.5;
  let mx = smoothstep(hw, hw + 0.02, cell.x) * smoothstep(hw, hw + 0.02, 1.0 - cell.x);
  let my = smoothstep(hh, hh + 0.02, cell.y) * smoothstep(hh, hh + 0.02, 1.0 - cell.y);
  return 1.0 - mx * my;
}

// Hexagonal grid: returns (dist_to_center, cell_id_hash)
fn hexGrid(p: vec2f, scale: f32) -> vec2f {
  let s = p * scale;
  let r = vec2f(1.0, 1.732);
  let h = r * 0.5;
  let a = glsl_mod2(s, r) - h;
  let b = glsl_mod2(s - h, r) - h;
  let g = select(b, a, length(a) < length(b));
  return vec2f(length(g), hash21(floor(s / r)));
}

// Wood grain — procedural concentric rings with noise distortion
fn woodGrain(p: vec2f, rings: f32, distort: f32) -> f32 {
  let d = length(p) * rings + vnoise(p * 8.0) * distort;
  return 0.5 + 0.5 * sin(d * 6.28318);
}

// Marble — veined pattern using domain-warped FBM
fn marble(p: vec2f, scale: f32, veinFreq: f32) -> f32 {
  let warped = warp(p * scale, 0.4, 0.0);
  return 0.5 + 0.5 * sin(warped.x * veinFreq + fbm(warped, 5) * 8.0);
}

// ─── SDF helpers ───

// Outline/stroke from SDF — returns 1.0 on the edge, 0.0 away from it
fn sdfOutline(sdf: f32, thickness: f32) -> f32 {
  return 1.0 - smoothstep(0.0, thickness, abs(sdf));
}

// Filled SDF — smooth anti-aliased fill. Returns alpha 0..1
fn sdfFill(sdf: f32, edge: f32) -> f32 {
  return smoothstep(edge, -edge, sdf);
}

// SDF shadow — soft drop shadow from SDF offset
fn sdfShadow(p: vec2f, sdf_fn_val: f32, offset: vec2f, blur: f32) -> f32 {
  return smoothstep(blur, -blur, sdf_fn_val) * 0.5;
}

// ─── Lighting from SDF normals ───
// Compute 2D surface normal from SDF value (requires two extra SDF samples)
// normalFromSDF should be called with: normalFromSDF(sdf_center, sdf_right, sdf_up, epsilon)
fn normalFromSDF(sdfCenter: f32, sdfRight: f32, sdfUp: f32, eps: f32) -> vec2f {
  return normalize(vec2f(sdfRight - sdfCenter, sdfUp - sdfCenter));
}

// Directional light on a 2D surface given its normal
fn directionalLight(normal: vec2f, lightDir: vec2f, ambient: f32) -> f32 {
  return clamp(dot(normal, normalize(lightDir)), 0.0, 1.0) * (1.0 - ambient) + ambient;
}

// Specular highlight for 2D SDF surfaces
fn specularLight(normal: vec2f, lightDir: vec2f, viewDir: vec2f, shininess: f32) -> f32 {
  let h = normalize(normalize(lightDir) + normalize(viewDir));
  return pow(max(dot(normal, h), 0.0), shininess);
}

// Ambient occlusion from SDF — darker in concave areas
fn sdfAO(sdf: f32, scale: f32) -> f32 {
  return clamp(sdf * scale + 1.0, 0.0, 1.0);
}

// ─── 3D Utilities ───

// 3D SDF: Sphere
fn sdSphere(p: vec3f, r: f32) -> f32 {
  return length(p) - r;
}

// 3D SDF: Axis-aligned box
fn sdBox3(p: vec3f, b: vec3f) -> f32 {
  let d = abs(p) - b;
  return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, vec3f(0.0)));
}

// 3D SDF: Rounded box
fn sdRoundedBox3(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b + vec3f(r);
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Rotate around X axis
fn rotateX3(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

// Rotate around Y axis
fn rotateY3(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Rotate around Z axis
fn rotateZ3(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// 3D SDF normal via central differences
fn sdfNormal3(p: vec3f, sdfVal: f32, shapeType: u32, dims: vec2f) -> vec3f {
  let e = 0.5;
  var n: vec3f;
  if (shapeType == 1u) {
    // Box
    let b = vec3f(dims.x * 0.5, dims.y * 0.5, min(dims.x, dims.y) * 0.25);
    n = vec3f(
      sdBox3(p + vec3f(e, 0.0, 0.0), b) - sdBox3(p - vec3f(e, 0.0, 0.0), b),
      sdBox3(p + vec3f(0.0, e, 0.0), b) - sdBox3(p - vec3f(0.0, e, 0.0), b),
      sdBox3(p + vec3f(0.0, 0.0, e), b) - sdBox3(p - vec3f(0.0, 0.0, e), b),
    );
  } else {
    // Sphere — analytic normal
    return normalize(p);
  }
  return normalize(n);
}

// Ray-sphere intersection: returns distance t or -1.0 if no hit
fn raySphere(origin: vec3f, dir: vec3f, radius: f32) -> f32 {
  let b = dot(origin, dir);
  let c = dot(origin, origin) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  let sqrtDisc = sqrt(disc);
  let t0 = -b - sqrtDisc;
  let t1 = -b + sqrtDisc;
  if (t0 > 0.001) { return t0; }
  if (t1 > 0.001) { return t1; }
  return -1.0;
}

// Ray-box intersection: returns distance t or -1.0 if no hit
fn rayBox(origin: vec3f, dir: vec3f, halfSize: vec3f) -> f32 {
  let invDir = 1.0 / dir;
  let t1 = (-halfSize - origin) * invDir;
  let t2 = (halfSize - origin) * invDir;
  let tmin = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
  let tmax = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
  if (tmax < 0.0 || tmin > tmax) { return -1.0; }
  if (tmin > 0.001) { return tmin; }
  return tmax;
}

// --- End Utility Library ---
`

// Extract function names defined in the base SHADER_UTILITIES
const BASE_FUNC_NAMES: Set<string> = new Set()
{
  const funcDefRegex = /fn\s+(\w+)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = funcDefRegex.exec(SHADER_UTILITIES)) !== null) {
    BASE_FUNC_NAMES.add(m[1])
  }
}

/**
 * Auto-fix agent WGSL: rewrite vec2f function calls that got vec3f arguments
 * to use the 3D variant instead. e.g. fbm4(vec3f(...)) → fbm4v(vec3f(...))
 */
const VEC2_TO_VEC3_FUNCS: Record<string, string> = {
  'vnoise': 'vnoise3', 'noise': 'noisev', 'fbm3': 'fbm3v', 'fbm4': 'fbm4v',
  'fbm5': 'fbm5v', 'fbm6': 'fbm6v',
}
function autoFixVec3Calls(code: string): string {
  if (!code) return code ?? ''
  for (const [fn2d, fn3d] of Object.entries(VEC2_TO_VEC3_FUNCS)) {
    // Match funcName(vec3f( — the agent passed a vec3f to a vec2f function
    const pattern = new RegExp(`\\b${fn2d}\\(\\s*vec3f\\(`, 'g')
    code = code.replace(pattern, `${fn3d}(vec3f(`)
  }
  return code
}

/**
 * Strip duplicate WGSL function definitions from mod code.
 * Single pass: accumulates seen names as it goes, so both base conflicts
 * and cross-mod conflicts are handled.
 */
function deduplicateModCode(code: string, seen: Set<string>): string {
  const funcStartRegex = /fn\s+(\w+)\s*\([^)]*\)\s*(?:-> [^{]+)?\{/g
  let result = ''
  let lastEnd = 0

  let match: RegExpExecArray | null
  while ((match = funcStartRegex.exec(code)) !== null) {
    const funcName = match[1]
    const braceStart = match.index + match[0].length - 1
    let depth = 1
    let pos = braceStart + 1
    while (pos < code.length && depth > 0) {
      if (code[pos] === '{') depth++
      else if (code[pos] === '}') depth--
      pos++
    }

    if (seen.has(funcName)) {
      result += code.slice(lastEnd, match.index)
      lastEnd = pos
      funcStartRegex.lastIndex = pos
    } else {
      seen.add(funcName)
    }
  }
  result += code.slice(lastEnd)
  return result
}

/** Get the SHADER_UTILITIES string with optional mod code appended (duplicates stripped) */
export function getShaderUtilities(modCode?: string): string {
  if (!modCode) return SHADER_UTILITIES
  const seen = new Set(BASE_FUNC_NAMES)
  const cleaned = deduplicateModCode(modCode, seen)
  return SHADER_UTILITIES + '\n// --- WGSL Mods ---\n' + cleaned + '\n// --- End WGSL Mods ---\n'
}

/**
 * Base pass: grid lines, painted colors, selection highlight.
 * No fieldEffect(). Uses u_selectionTex for UI selection highlight only.
 */
export function buildBaseFragmentShader(): string {
  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

@group(1) @binding(0) var colorTex: texture_2d<f32>;
@group(1) @binding(1) var stateTex: texture_2d<f32>;
@group(1) @binding(2) var selectionTex: texture_2d<f32>;
@group(1) @binding(3) var effectTex: texture_2d<f32>;
@group(1) @binding(4) var texSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@fragment
fn main(in: VertexOutput) -> @location(0) vec4f {
${COORD_MATH}

  // Use textureLoad (integer coords, no sampler) — works on all GPUs including
  // those without float32-filterable (Safari). No filtering needed for a grid engine.
  let texCoord = vec2i(clamp(vec2i(floor(gridCoord)), vec2i(0), vec2i(i32(frame.gridSize) - 1)));
  let cellColor = textureLoad(colorTex, texCoord, 0);
  let selection = textureLoad(selectionTex, texCoord, 0).r;
  let effectPixel = textureLoad(effectTex, texCoord, 0);

  // Out-of-bounds background
  if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) {
    return vec4f(0.035, 0.045, 0.065, 1.0);
  }

  // Grid lines
  let cellSize = frame.resolution.y * frame.zoom / frame.gridSize;
  let gridAlpha = 0.0;
  let cellFrac = fract(gridCoord);
  let lineWidth = 1.0 / max(cellSize, 1.0);
  let gridLine = 1.0 - step(lineWidth, cellFrac.x) * step(lineWidth, cellFrac.y)
                     * step(cellFrac.x, 1.0 - lineWidth) * step(cellFrac.y, 1.0 - lineWidth);

  let bg = vec3f(0.055, 0.065, 0.09);
  var color = bg;

  // Grid lines
  let gridColor = vec3f(0.15, 0.18, 0.22);
  color = mix(color, gridColor, gridLine * gridAlpha);

  // Selection highlight
  if (selection > 0.5) {
    let pulse = 0.5 + 0.5 * sin(frame.time * 3.0);
    color = mix(color, vec3f(1.0), 0.08 + 0.04 * pulse);
    let selTexCoord = vec2i(floor(gridCoord));
    let nL = textureLoad(selectionTex, selTexCoord + vec2i(-1, 0), 0).r;
    let nR = textureLoad(selectionTex, selTexCoord + vec2i(1, 0), 0).r;
    let nU = textureLoad(selectionTex, selTexCoord + vec2i(0, -1), 0).r;
    let nD = textureLoad(selectionTex, selTexCoord + vec2i(0, 1), 0).r;
    let edge = step(0.5, 1.0 - min(min(nL, nR), min(nU, nD)));
    color = mix(color, vec3f(0.3, 0.7, 1.0), edge * (0.4 + 0.2 * pulse));
  }

  // --- Effect layer rendering ---
  let effectType = effectPixel.r;

  if (effectType > 0.5) {
    let hue = effectPixel.g;
    let brightness = effectPixel.b;
    let intensity = effectPixel.a;

    let h6 = hue * 6.0;
    let h6i = floor(h6);
    let f = h6 - h6i;
    let q = 1.0 - f;
    let t = f;
    var effectColor: vec3f;
    if (h6i < 1.0) { effectColor = vec3f(1.0, t, 0.0); }
    else if (h6i < 2.0) { effectColor = vec3f(q, 1.0, 0.0); }
    else if (h6i < 3.0) { effectColor = vec3f(0.0, 1.0, t); }
    else if (h6i < 4.0) { effectColor = vec3f(0.0, q, 1.0); }
    else if (h6i < 5.0) { effectColor = vec3f(t, 0.0, 1.0); }
    else { effectColor = vec3f(1.0, 0.0, q); }
    effectColor *= brightness;

    // Glow from neighbors
    var glowVal = 0.0;
    let glowCenter = vec2i(floor(gridCoord));
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        if (dx == 0 && dy == 0) { continue; }
        let nbCoord = glowCenter + vec2i(dx, dy);
        let nbData = textureLoad(effectTex, nbCoord, 0);
        if (nbData.r > 0.5) { glowVal += nbData.a; }
      }
    }
    glowVal = min(glowVal * 0.06, 0.8);

    color = mix(color, effectColor, intensity * 0.9);
    color += effectColor * glowVal * 0.4;
  }

  return vec4f(color, 1.0);
}
`
}

/**
 * Effect pass: per-field WGSL effect. Outputs alpha-blended result.
 */
export function buildEffectFragmentShader(injectedWgsl: string, modCode?: string): string {
  // Auto-fix common agent mistake: passing vec3f to vec2f functions
  const fixedWgsl = autoFixVec3Calls(injectedWgsl)
  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

@group(1) @binding(0) var colorTex: texture_2d<f32>;
@group(1) @binding(1) var stateTex: texture_2d<f32>;
@group(1) @binding(2) var fieldMask: texture_2d<f32>;
@group(1) @binding(3) var feedbackTex: texture_2d<f32>;
@group(1) @binding(4) var texSampler: sampler;

${EFFECT_UNIFORM_STRUCT}

// the whiteboard, readable from the compute layer too: input (cursor/keys) a
// step hook writes to worldData.gpuUniforms reaches effects here via uni().
@group(2) @binding(1) var<storage, read> effWorldUni: array<vec4f>;
fn uni(i: i32) -> f32 {
  let v = effWorldUni[clamp(i, 0, 95) / 4];
  let c = clamp(i, 0, 95) % 4;
  if (c == 0) { return v.x; }
  if (c == 1) { return v.y; }
  if (c == 2) { return v.z; }
  return v.w;
}
fn uni4(i: i32) -> vec4f { return effWorldUni[clamp(i, 0, 23)]; }

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

${getShaderUtilities(modCode)}

// Map cell coordinate to feedback texture UV (0..1 within effect bounds)
fn feedbackUV(cellCoord: vec2f) -> vec2f {
  var uv = clamp((cellCoord - effect.bounds.xy) / max(effect.bounds.zw - effect.bounds.xy, vec2f(1.0)), vec2f(0.0), vec2f(1.0));
  uv.y = 1.0 - uv.y;
  return uv;
}
// Fragment-path fallback for feedback(): no per-effect state buffer here, so it
// degrades to the (static) feedback texture. Real feedback runs in the compute
// path; this only keeps a feedback-using shader COMPILING if it falls back.
fn feedback(cellCoord: vec2f) -> vec4f {
  return textureSampleLevel(feedbackTex, texSampler, feedbackUV(cellCoord), 0.0);
}

${fixedWgsl}

@fragment
fn main(in: VertexOutput) -> @location(0) vec4f {
${COORD_MATH}

  let regionMin = effect.bounds.xy;
  let regionMax = effect.bounds.zw;

  // Snap to cell center
  let cellCoord = floor(gridCoord) + 0.5;

  // Call fieldEffect in uniform control flow (before any non-uniform branches)
  // so that user-injected code can safely use textureSample
  let effectResult = fieldEffect(cellCoord, regionMin, regionMax, frame.time, effect.params);

  if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) {
    return vec4f(0.0);
  }
  return vec4f(effectResult.rgb, clamp(effectResult.a, 0.0, 1.0));
}
`
}

/**
 * State update compute shader template.
 * Agent provides a cellUpdate function:
 *   fn cellUpdate(coord: vec2f, state: vec4f, color: vec4f, time: f32, dt: f32) -> vec4f
 */
export function buildStateUpdateComputeShader(injectedWgsl: string, modCode?: string): string {
  return buildCompositeStateComputeShader([{ id: 'single', wgsl: injectedWgsl }], modCode)
}

/**
 * Build a composite state compute shader from multiple field contributions.
 * ADDITIVE composition: all shaders read ORIGINAL state, deltas are summed.
 */
export function buildCompositeStateComputeShader(fields: { id: string; wgsl: string }[], modCode?: string): string {
  const renamedFunctions = fields.map((f, i) => {
    return f.wgsl.replace(/cellUpdate\s*\(/g, `cellUpdate_${i}(`)
  })

  const deltaCalls = fields.map((_, i) => {
    return `  let out${i} = cellUpdate_${i}(coord, state, color, state_uniforms.time, state_uniforms.dt);
  delta += (out${i} - state);`
  })

  return /* wgsl */`
${STATE_UNIFORM_STRUCT}

@group(1) @binding(0) var stateTex: texture_2d<f32>;
@group(1) @binding(1) var colorTex: texture_2d<f32>;
@group(1) @binding(2) var outputTex: texture_storage_2d<rgba32float, write>;

${getShaderUtilities(modCode)}

${renamedFunctions.join('\n\n')}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let gs = u32(state_uniforms.gridSize);
  if (gid.x >= gs || gid.y >= gs) { return; }

  let coord = vec2f(f32(gid.x) + 0.5, f32(gid.y) + 0.5);
  let uv = coord / state_uniforms.gridSize;
  let texCoord = vec2i(gid.xy);
  let state = textureLoad(stateTex, texCoord, 0);
  let color = textureLoad(colorTex, texCoord, 0);

  var delta = vec4f(0.0);
${deltaCalls.join('\n')}
  textureStore(outputTex, texCoord, clamp(state + delta, vec4f(0.0), vec4f(1.0)));
}
`
}

// Backward compat: buildStateUpdateShader wraps single field
export function buildStateUpdateShader(wgsl: string, modCode?: string): string {
  return buildCompositeStateComputeShader([{ id: 'single', wgsl }], modCode)
}

export function buildCompositeStateShader(fields: { id: string; wgsl: string }[], modCode?: string): string {
  return buildCompositeStateComputeShader(fields, modCode)
}

/**
 * Mask clear shader — erases underlying pixels where an interaction mask is active.
 */
export function buildMaskClearShader(): string {
  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

@group(1) @binding(0) var fieldMask: texture_2d<f32>;
@group(1) @binding(1) var texSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@fragment
fn main(in: VertexOutput) -> @location(0) vec4f {
${COORD_MATH}
  // Use textureLoad — works on all GPUs (no sampler/filtering needed)
  let maskTexCoord = vec2i(clamp(vec2i(floor(gridCoord)), vec2i(0), vec2i(i32(frame.gridSize) - 1)));
  let maskVal = textureLoad(fieldMask, maskTexCoord, 0).r;
  if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) {
    discard;
  }
  if (maskVal < 0.5) { discard; }
  return vec4f(0.055, 0.065, 0.09, 1.0);
}
`
}

/**
 * World effect pass: full-grid WGSL effect with no field mask.
 */
export function buildWorldEffectFragmentShader(injectedWgsl: string, modCode?: string): string {
  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

@group(1) @binding(0) var colorTex: texture_2d<f32>;
@group(1) @binding(1) var stateTex: texture_2d<f32>;
@group(1) @binding(4) var texSampler: sampler;

${EFFECT_UNIFORM_STRUCT}

// the whiteboard, readable from the compute layer too: input (cursor/keys) a
// step hook writes to worldData.gpuUniforms reaches effects here via uni().
@group(2) @binding(1) var<storage, read> effWorldUni: array<vec4f>;
fn uni(i: i32) -> f32 {
  let v = effWorldUni[clamp(i, 0, 95) / 4];
  let c = clamp(i, 0, 95) % 4;
  if (c == 0) { return v.x; }
  if (c == 1) { return v.y; }
  if (c == 2) { return v.z; }
  return v.w;
}
fn uni4(i: i32) -> vec4f { return effWorldUni[clamp(i, 0, 23)]; }

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

${getShaderUtilities(modCode)}

${injectedWgsl}

@fragment
fn main(in: VertexOutput) -> @location(0) vec4f {
${COORD_MATH}

  let cellCoord = floor(gridCoord) + 0.5;

  // Call fieldEffect in uniform control flow so user code can use textureSample
  let effectResult = fieldEffect(cellCoord, vec2f(0.0), vec2f(frame.gridSize), frame.time, effect.params);

  if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) {
    return vec4f(0.0);
  }
  return vec4f(effectResult.rgb, clamp(effectResult.a, 0.0, 1.0));
}
`
}

/** Default field effect — SDF circle at field position using transform. */
export const DEFAULT_FIELD_EFFECT_WGSL = /* wgsl */`
fn fieldEffect(coord: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let pos = effect.transform.xy;
  let d = length(coord - pos);
  let r = (regionMax.x - regionMin.x) * 0.5;
  let alpha = smoothstep(r + 0.5, r - 0.5, d);
  return vec4f(params.rgb, params.a * alpha);
}
`

// ─── Compute effect pipeline shaders ───

/**
 * Compute shader version of effect pass.
 * Dispatched over a field's pixel region only. Reads/blends into a storage buffer.
 * Uses storage buffer (universally supported) instead of read_write storage textures.
 */
export function buildEffectComputeShader(injectedWgsl: string, modCode?: string): string {
  const fixedWgsl = autoFixVec3Calls(injectedWgsl)
  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

@group(1) @binding(0) var colorTex: texture_2d<f32>;
@group(1) @binding(1) var stateTex: texture_2d<f32>;
@group(1) @binding(2) var fieldMask: texture_2d<f32>;
@group(1) @binding(3) var feedbackTex: texture_2d<f32>;
@group(1) @binding(4) var texSampler: sampler;

${EFFECT_UNIFORM_STRUCT}

struct DispatchRegion {
  offset: vec2f,
  size: vec2f,
};
@group(3) @binding(0) var<uniform> dispatchRegion: DispatchRegion;
@group(3) @binding(1) var<storage, read_write> accumBuf: array<vec4f>;
// per-effect feedback state, ping-ponged in field space (the real-feedback
// primitive). prev = last frame (read), next = this frame (written below).
@group(3) @binding(2) var<storage, read> fbStatePrev: array<vec4f>;
@group(3) @binding(3) var<storage, read_write> fbStateNext: array<vec4f>;

${getShaderUtilities(modCode)}

fn feedbackUV(cellCoord: vec2f) -> vec2f {
  var uv = clamp((cellCoord - effect.bounds.xy) / max(effect.bounds.zw - effect.bounds.xy, vec2f(1.0)), vec2f(0.0), vec2f(1.0));
  uv.y = 1.0 - uv.y;
  return uv;
}

// field cell → state buffer index (STATE_DIM² grid over the effect bounds)
const FB_STATE_DIM: f32 = 256.0;
fn fbStateIndex(cellCoord: vec2f) -> u32 {
  let uv = clamp((cellCoord - effect.bounds.xy) / max(effect.bounds.zw - effect.bounds.xy, vec2f(1.0)), vec2f(0.0), vec2f(0.99999));
  let px = vec2u(u32(uv.x * FB_STATE_DIM), u32(uv.y * FB_STATE_DIM));
  return px.y * u32(FB_STATE_DIM) + px.x;
}
// read this effect's OWN previous frame at a field cell — genuine feedback,
// BILINEARLY sampled so advection and display are smooth, not chunky. (On the
// fragment fallback / non-feedback effects the buffer is a 1-elem dummy, so the
// length guard returns zero.)
fn feedback(cellCoord: vec2f) -> vec4f {
  let dim = u32(FB_STATE_DIM);
  if (arrayLength(&fbStatePrev) < dim * dim) { return vec4f(0.0); }
  let uv = clamp((cellCoord - effect.bounds.xy) / max(effect.bounds.zw - effect.bounds.xy, vec2f(1.0)), vec2f(0.0), vec2f(0.99999));
  let fp = uv * FB_STATE_DIM - 0.5;
  let base = floor(fp);
  let f = fp - base;
  let x0 = u32(clamp(base.x, 0.0, FB_STATE_DIM - 1.0));
  let y0 = u32(clamp(base.y, 0.0, FB_STATE_DIM - 1.0));
  let x1 = min(x0 + 1u, dim - 1u);
  let y1 = min(y0 + 1u, dim - 1u);
  let s00 = fbStatePrev[y0 * dim + x0];
  let s10 = fbStatePrev[y0 * dim + x1];
  let s01 = fbStatePrev[y1 * dim + x0];
  let s11 = fbStatePrev[y1 * dim + x1];
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

${fixedWgsl}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let pixel = vec2f(f32(gid.x) + dispatchRegion.offset.x, f32(gid.y) + dispatchRegion.offset.y);
  let pixelI = vec2i(i32(pixel.x), i32(pixel.y));
  let stride = u32(frame.resolution.x);

  if (pixel.x < 0.0 || pixel.y < 0.0 || pixel.x >= frame.resolution.x || pixel.y >= frame.resolution.y) { return; }

  // Pixel → UV (match fragment shader convention: UV y=0 at bottom, y=1 at top)
  let uv = vec2f((pixel.x + 0.5) / frame.resolution.x, 1.0 - (pixel.y + 0.5) / frame.resolution.y);

  // UV → grid coordinate (same as fragment shader COORD_MATH)
  let aspect = frame.resolution.x / frame.resolution.y;
  let gridRange = vec2f(frame.gridSize) / frame.zoom;
  var gridCoord: vec2f;
  if (aspect > 1.0) {
    gridCoord.x = frame.camera.x + (uv.x - 0.5) * gridRange.x * aspect;
    gridCoord.y = frame.camera.y + (0.5 - uv.y) * gridRange.y;
  } else {
    gridCoord.x = frame.camera.x + (uv.x - 0.5) * gridRange.x;
    gridCoord.y = frame.camera.y + (0.5 - uv.y) * gridRange.y / aspect;
  }

  let texUV = gridCoord / frame.gridSize;
  if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) { return; }

  let cellCoord = floor(gridCoord) + 0.5;
  let regionMin = effect.bounds.xy;
  let regionMax = effect.bounds.zw;

  let result = fieldEffect(cellCoord, regionMin, regionMax, frame.time, effect.params);

  // persist this cell's output as next-frame feedback BEFORE the display-alpha
  // cull — an empty/transparent cell must still advance its state (a solver's
  // whole field evolves, not just the visible ink). Skipped when the buffer is
  // the 1-element dummy (non-feedback effects): the index is out of range.
  let sidx = fbStateIndex(cellCoord);
  if (sidx < arrayLength(&fbStateNext)) { fbStateNext[sidx] = result; }

  let alpha = clamp(result.a, 0.0, 1.0);
  if (alpha < 0.002) { return; }

  // Alpha-blend into accumulation buffer
  let idx = u32(pixelI.y) * stride + u32(pixelI.x);
  let existing = accumBuf[idx];
  accumBuf[idx] = vec4f(
    mix(existing.rgb, result.rgb, alpha),
    existing.a + alpha * (1.0 - existing.a),
  );
}
`
}

/**
 * Clear compute shader — zeros the accumulation buffer.
 */
export function buildAccumClearComputeShader(): string {
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> buf: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x < arrayLength(&buf)) {
    buf[gid.x] = vec4f(0.0);
  }
}
`
}

/**
 * Blit shader — reads from accumulation storage buffer and outputs to screen.
 */
export function buildBlitFragmentShader(): string {
  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

@group(1) @binding(0) var<storage, read> accumBuf: array<vec4f>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@fragment
fn main(in: VertexOutput) -> @location(0) vec4f {
  let pixel = vec2u(in.position.xy);
  let stride = u32(frame.resolution.x);
  let idx = pixel.y * stride + pixel.x;
  let color = accumBuf[idx];
  if (color.a < 0.001) { discard; }
  return color;
}
`
}

// ─── Dynamic Visual Type System ───

/** Visual type definition — each type provides a WGSL rendering function.
 *  Function signature: fn visual_NAME(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f) -> vec4f
 *  - uv: local UV coordinates within the field (-1..1)
 *  - sdf: signed distance to field boundary (negative = inside)
 *  - color: field's base color (RGBA)
 *  - time: current frame time in seconds
 *  - params: 4 custom parameters from visualParams
 *  Returns: RGBA color for this pixel (alpha=0 means transparent)
 */
export interface VisualTypeEntry {
  id: number
  name: string
  /** Complete WGSL function definition */
  wgsl: string
  /** Quarantined by the fault-isolating compile — excluded from the uber-shader */
  broken?: boolean
  /** Compile error that caused the quarantine */
  error?: string
}

// No built-in visual types. All visual types are defined at runtime via define_visual.
// The uber-shader's default case provides a basic solid fill as fallback.

/** Interaction visual — renders at pixels where two specific fields overlap.
 *  Function signature: fn interaction_NAME(uvA: vec2f, uvB: vec2f, colorA: vec4f, colorB: vec4f, time: f32) -> vec4f
 *  - uvA/uvB: local UV coordinates within each field (-1..1)
 *  - colorA/colorB: base colors of each field
 *  - time: frame time in seconds
 *  Returns: RGBA color to render at the overlap pixel (replaces both field visuals) */
export interface InteractionEntry {
  id: number
  name: string
  wgsl: string
}

/** Propagation type — defines how interaction effects spread beyond the overlap zone.
 *  Function signature: fn propagation_NAME(srcColor: vec4f, offset: vec2f, dist: f32, time: f32) -> vec4f
 *  - srcColor: interaction color at the source pixel (from ixBuf)
 *  - offset: vector from source pixel to current pixel (positive y = upward on screen)
 *  - dist: pixel distance from source to current pixel
 *  - time: frame time in seconds
 *  Returns: RGBA color contribution from this source sample */
export interface PropagationEntry {
  id: number
  name: string
  wgsl: string
}

/** Shader module — reusable WGSL utility functions injected into the uber-shader.
 *  Module functions use the mod_NAME prefix and can be called by any visual type.
 *  Modules are concatenated before visual functions during shader assembly. */
export interface ModuleEntry {
  name: string
  wgsl: string
}

// ─── Built-in visual type library ───
// These are always available without runtime registration.
// Runtime types with the same name override built-ins.

export const BUILTIN_VISUAL_WGSL: Array<{ id: number; name: string; wgsl: string }> = []

const _BUILTIN_VISUAL_WGSL_DISABLED: Array<{ id: number; name: string; wgsl: string }> = [
  // 0: Solid — flat fill with SDF edge
  { id: 0, name: 'solid', wgsl: `
fn visual_solid(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  return vec4f(col.rgb, a * col.a);
}` },

  // 1: Circle — soft radial gradient, p.x = falloff (default 2.0)
  { id: 1, name: 'circle', wgsl: `
fn visual_circle(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let d = length(uv);
  let falloff = max(p.x, 0.5);
  let a = smoothstep(1.0, 0.0, pow(d, falloff));
  if (a < 0.01) { return vec4f(0.0); }
  return vec4f(col.rgb, a * col.a);
}` },

  // 2: Glow — exponential glow extending beyond SDF, HDR-capable
  { id: 2, name: 'glow', wgsl: `
fn visual_glow(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let d = length(uv);
  let radius = max(p.x, 0.3);
  let intensity = max(p.y, 1.5);
  let g = intensity * exp(-d * d / (radius * radius));
  if (g < 0.01) { return vec4f(0.0); }
  return vec4f(col.rgb * g, min(g, 1.0) * col.a);
}` },

  // 3: Ring — ring shape, p.x = radius (0.6), p.y = width (0.1)
  { id: 3, name: 'ring', wgsl: `
fn visual_ring(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let d = length(uv);
  let radius = select(0.6, p.x, p.x > 0.01);
  let width = select(0.1, p.y, p.y > 0.01);
  let r = exp(-pow(d - radius, 2.0) / (width * width));
  if (r < 0.01) { return vec4f(0.0); }
  return vec4f(col.rgb * (0.5 + r * 0.5), r * col.a);
}` },

  // 4: Eyes — two eye shapes, pupils track behind brightness
  { id: 4, name: 'eyes', wgsl: `
fn visual_eyes(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let sep = select(0.35, p.x, p.x > 0.01);
  let eyeR = 0.22;
  let pupilR = 0.08;
  let blink = smoothstep(-0.98, -1.0, cos(time * 0.7));
  let dL = length(uv - vec2f(-sep, 0.05));
  let dR = length(uv - vec2f(sep, 0.05));
  let whiteL = smoothstep(eyeR, eyeR - 0.04, dL) * (1.0 - blink);
  let whiteR = smoothstep(eyeR, eyeR - 0.04, dR) * (1.0 - blink);
  let look = behind.a * 0.06;
  let pupilOff = vec2f(look * sin(time * 0.5), look * cos(time * 0.3));
  let pL = smoothstep(pupilR, pupilR - 0.03, length(uv - vec2f(-sep, 0.05) + pupilOff));
  let pR = smoothstep(pupilR, pupilR - 0.03, length(uv - vec2f(sep, 0.05) + pupilOff));
  let eye = max(whiteL, whiteR);
  let pupil = max(pL * whiteL, pR * whiteR);
  let c = mix(col.rgb, vec3f(1.0), eye * 0.8);
  let c2 = mix(c, vec3f(0.05), pupil);
  let bodyA = smoothstep(0.5, -0.5, sdf) * col.a;
  let finalA = max(bodyA * 0.5, eye);
  return vec4f(c2, finalA);
}` },

  // 5: Coin — metallic disc with rim lighting
  { id: 5, name: 'coin', wgsl: `
fn visual_coin(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let d = length(uv);
  let rim = smoothstep(0.85, 0.95, d) * 0.6;
  let spec = pow(max(0.0, 1.0 - abs(uv.x * 0.7 + uv.y * 0.3 - 0.15)), 8.0) * 0.5;
  let shade = 0.6 + 0.4 * (1.0 - d);
  let c = col.rgb * shade + vec3f(rim + spec);
  let inner = smoothstep(0.7, 0.65, d);
  let innerRim = smoothstep(0.72, 0.68, d) - smoothstep(0.68, 0.64, d);
  let c2 = c + col.rgb * innerRim * 0.3;
  return vec4f(c2, a * col.a);
}` },

  // 6: Platform — flat top with bottom shadow/depth
  { id: 6, name: 'platform', wgsl: `
fn visual_platform(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let topLight = smoothstep(-0.3, -0.8, uv.y) * 0.3;
  let bottomShadow = smoothstep(0.3, 0.8, uv.y) * 0.4;
  let edgeHighlight = smoothstep(0.0, -0.2, sdf) - smoothstep(-0.2, -0.5, sdf);
  let shade = 1.0 + topLight - bottomShadow;
  let c = col.rgb * shade + vec3f(edgeHighlight * 0.15);
  return vec4f(c, a * col.a);
}` },

  // 7: Stripe — animated diagonal stripes, p.x = count (6), p.y = speed (1)
  { id: 7, name: 'stripe', wgsl: `
fn visual_stripe(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let count = select(6.0, p.x, p.x > 0.5);
  let speed = select(1.0, p.y, abs(p.y) > 0.01);
  let stripe = 0.5 + 0.5 * sin((uv.x + uv.y) * count * 3.14159 + time * speed);
  let c = col.rgb * (0.5 + stripe * 0.5);
  return vec4f(c, a * col.a);
}` },

  // 8: Pulse — radial pulse wave expanding outward
  { id: 8, name: 'pulse', wgsl: `
fn visual_pulse(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let d = length(uv);
  let speed = select(2.0, p.x, p.x > 0.1);
  let wave = fract(d - time * speed * 0.3);
  let ring_val = smoothstep(0.0, 0.1, wave) * smoothstep(0.3, 0.1, wave);
  let core = exp(-d * 3.0) * (0.7 + 0.3 * sin(time * speed));
  let c = col.rgb * (core + ring_val * 0.6);
  let finalA = a * max(core, ring_val * 0.5 + 0.2) * col.a;
  return vec4f(c, finalA);
}` },

  // 9: Gradient — linear gradient, p.x = angle in radians
  { id: 9, name: 'gradient', wgsl: `
fn visual_gradient(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let angle = p.x;
  let dir = vec2f(cos(angle), sin(angle));
  let t = dot(uv, dir) * 0.5 + 0.5;
  let c = col.rgb * (0.3 + t * 0.7);
  return vec4f(c, a * col.a);
}` },

  // 10: Lava — turbulent FBM flow, hot color ramp
  { id: 10, name: 'lava', wgsl: `
fn visual_lava(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let flow = fbm(vec2f(uv.x * 3.0, uv.y * 3.0 - time * 0.4), 5);
  let heat = fbm(vec2f(uv.x * 5.0 + time * 0.2, uv.y * 5.0), 4);
  let t = clamp(flow * 0.5 + 0.5 + heat * 0.3, 0.0, 1.0);
  var c: vec3f;
  if (t < 0.3) { c = mix(vec3f(0.05, 0.0, 0.0), vec3f(0.6, 0.05, 0.0), t / 0.3); }
  else if (t < 0.7) { c = mix(vec3f(0.6, 0.05, 0.0), vec3f(1.0, 0.4, 0.0), (t - 0.3) / 0.4); }
  else { c = mix(vec3f(1.0, 0.4, 0.0), vec3f(1.0, 0.9, 0.3), (t - 0.7) / 0.3); }
  c *= col.rgb;
  return vec4f(c * (1.0 + heat * 0.5), a * col.a);
}` },

  // 11: Crystal — voronoi cells with edge glow and shimmer
  { id: 11, name: 'crystal', wgsl: `
fn visual_crystal(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let scale = 4.0 + p.x * 4.0;
  let v = voronoi(uv * scale);
  let edge = voronoiEdge(uv * scale, 0.08);
  let shimmer = 0.5 + 0.5 * sin(v.y * 20.0 + time * 2.0);
  let facet = 0.3 + 0.7 * v.x;
  let c = col.rgb * facet + vec3f(edge * 0.6 * shimmer);
  return vec4f(c, a * col.a);
}` },

  // 12: Plasma — classic sine-sum plasma, rainbow cycling
  { id: 12, name: 'plasma', wgsl: `
fn visual_plasma(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let speed = select(1.0, p.x, p.x > 0.01);
  let t = time * speed;
  let v1 = sin(uv.x * 5.0 + t);
  let v2 = sin(uv.y * 5.0 + t * 0.7);
  let v3 = sin((uv.x + uv.y) * 5.0 + t * 0.5);
  let v4 = sin(length(uv) * 7.0 - t);
  let v = (v1 + v2 + v3 + v4) * 0.25;
  let r = 0.5 + 0.5 * sin(v * 3.14159 * 2.0 + 0.0);
  let g = 0.5 + 0.5 * sin(v * 3.14159 * 2.0 + 2.094);
  let b = 0.5 + 0.5 * sin(v * 3.14159 * 2.0 + 4.189);
  let c = vec3f(r, g, b) * col.rgb;
  return vec4f(c, a * col.a);
}` },

  // 13: Nebula — layered FBM clouds with star points
  { id: 13, name: 'nebula', wgsl: `
fn visual_nebula(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let n1 = fbm(vec2f(uv.x * 2.0 + time * 0.08, uv.y * 2.0), 5);
  let n2 = fbm(vec2f(uv.x * 3.0 - time * 0.12, uv.y * 3.0 + time * 0.06), 4);
  let density = clamp(n1 * 0.6 + n2 * 0.4 + 0.2, 0.0, 1.0);
  let starNoise = fbm(uv * 25.0, 2);
  let star = smoothstep(0.9, 0.95, starNoise) * 2.0;
  let c = col.rgb * density + vec3f(star);
  return vec4f(c, a * density * col.a);
}` },

  // 14: Water — ripples + caustic pattern, shows behind through transparency
  { id: 14, name: 'water', wgsl: `
fn visual_water(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let d = length(uv);
  let ripple1 = sin(d * 12.0 - time * 3.0) * 0.5 + 0.5;
  let ripple2 = sin(length(uv - vec2f(0.3, -0.2)) * 10.0 - time * 2.5) * 0.5 + 0.5;
  let caustic = voronoiEdge(uv * 6.0 + vec2f(time * 0.3, time * 0.2), 0.15) * 0.4;
  let surface = ripple1 * 0.3 + ripple2 * 0.2 + caustic;
  let waterCol = col.rgb * (0.6 + surface * 0.4);
  let transparency = 0.5 + p.x * 0.3;
  let c = mix(behind.rgb, waterCol, transparency) * select(1.0, 1.0, behind.a > 0.01);
  let finalC = mix(waterCol, c, behind.a * 0.5);
  return vec4f(finalC, a * col.a * transparency);
}` },

  // 15: Fire — upward FBM displacement with hot gradient
  { id: 15, name: 'fire', wgsl: `
fn visual_fire(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  var fuv = uv;
  fuv.y += 0.3;
  let distort = fbm(vec2f(fuv.x * 4.0, fuv.y * 2.0 - time * 2.0), 4) * 0.3;
  fuv.x += distort;
  let d = length(fuv);
  var flame = 1.0 - smoothstep(0.0, 0.9, d);
  let flicker = fbm(vec2f(fuv.x * 6.0, fuv.y * 3.0 - time * 3.0), 3);
  flame *= (0.7 + flicker * 0.5);
  if (flame < 0.01) { return vec4f(0.0); }
  let t = clamp(flame, 0.0, 1.0);
  var c: vec3f;
  if (t < 0.4) { c = mix(vec3f(0.1, 0.0, 0.0), vec3f(0.8, 0.1, 0.0), t / 0.4); }
  else if (t < 0.7) { c = mix(vec3f(0.8, 0.1, 0.0), vec3f(1.0, 0.6, 0.0), (t - 0.4) / 0.3); }
  else { c = mix(vec3f(1.0, 0.6, 0.0), vec3f(1.0, 1.0, 0.7), (t - 0.7) / 0.3); }
  c *= col.rgb;
  return vec4f(c, flame * col.a);
}` },

  // 16: Electric — branching noise like lightning
  { id: 16, name: 'electric', wgsl: `
fn visual_electric(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let n1 = fbm(vec2f(uv.x * 8.0 + time * 2.0, uv.y * 2.0), 4);
  let n2 = fbm(vec2f(uv.x * 2.0, uv.y * 8.0 - time * 1.5), 4);
  let bolt1 = smoothstep(0.15, 0.0, abs(uv.y - n1 * 0.6));
  let bolt2 = smoothstep(0.15, 0.0, abs(uv.x - n2 * 0.6));
  let bolts = max(bolt1, bolt2);
  let core = exp(-length(uv) * 2.0) * 0.3;
  let intensity = bolts + core;
  if (intensity < 0.01) { return vec4f(0.0); }
  let c = col.rgb * 0.3 + vec3f(0.5, 0.8, 1.0) * bolts + col.rgb * core;
  return vec4f(c, min(intensity, 1.0) * a * col.a);
}` },

  // 17: Terrain — heightmap with contour bands
  { id: 17, name: 'terrain', wgsl: `
fn visual_terrain(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let height = fbm(uv * 3.0, 5) * 0.5 + 0.5;
  let bands = select(8.0, p.x, p.x > 0.5);
  let contour = fract(height * bands);
  let contourLine = smoothstep(0.02, 0.0, contour) + smoothstep(0.98, 1.0, contour);
  var c: vec3f;
  if (height < 0.3) { c = mix(vec3f(0.1, 0.3, 0.15), vec3f(0.2, 0.5, 0.2), height / 0.3); }
  else if (height < 0.6) { c = mix(vec3f(0.2, 0.5, 0.2), vec3f(0.5, 0.4, 0.25), (height - 0.3) / 0.3); }
  else { c = mix(vec3f(0.5, 0.4, 0.25), vec3f(0.9, 0.9, 0.95), (height - 0.6) / 0.4); }
  c *= col.rgb;
  let shade = 1.0 - contourLine * 0.4;
  return vec4f(c * shade, a * col.a);
}` },

  // 18: Portal — swirling vortex with behind-warp
  { id: 18, name: 'portal', wgsl: `
fn visual_portal(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let pol = polar(uv);
  let swirl = pol.y + pol.x * 3.0 - time * 2.0;
  let spiralCount = 3.0 + p.x * 3.0;
  let spiral = 0.5 + 0.5 * sin(swirl * spiralCount);
  let tunnel = exp(-pol.x * 2.0);
  let n = fbm(uv * 4.0 + time * 0.3, 3);
  let rimVal = ring(uv, 0.7, 0.15);
  let c = col.rgb * spiral * (0.5 + n * 0.5) + col.rgb * rimVal * 2.0;
  let centerMask = tunnel * 0.6;
  let finalC = mix(c, behind.rgb, centerMask * behind.a);
  return vec4f(finalC, a * col.a);
}` },

  // 19: Organic — cellular/biological look, voronoi + membrane
  { id: 19, name: 'organic', wgsl: `
fn visual_organic(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let scale = 5.0 + p.x * 3.0;
  let v = voronoi(uv * scale + vec2f(time * 0.1, 0.0));
  let membrane = voronoiEdge(uv * scale + vec2f(time * 0.1, 0.0), 0.06);
  let pulse_val = 0.7 + 0.3 * sin(v.x * 10.0 + time * 1.5);
  let interior = v.x * pulse_val;
  let nucl = smoothstep(0.15, 0.05, v.x) * 0.6;
  let c = col.rgb * (0.3 + interior * 0.5) + col.rgb * membrane * 0.4 + vec3f(nucl * 0.3, nucl * 0.1, 0.0);
  return vec4f(c, a * col.a);
}` },
]

// ─── Superimposed rendering compute shader ───

/**
 * Uber-shader for superimposed rendering. All fields are evaluated in a single
 * compute pass. Each pixel loops over every field, evaluates SDF membership and
 * visual type, and resolves overlaps natively (no alpha compositing between fields).
 *
 * Fields are stored in a storage buffer as packed FieldGPU structs (5 vec4f each).
 * Visual types are parameterized function IDs dispatched via switch.
 */
export function buildSuperimposedComputeShader(
  visualTypes?: VisualTypeEntry[],
  interactionTypes?: InteractionEntry[],
  modules?: ModuleEntry[],
  targetCount?: number,
): string {
  const runtimeTypes = visualTypes || []
  const interactions = interactionTypes || []
  const mods = modules || []
  const numTargets = targetCount || 0

  // Merge built-in + runtime visual types (runtime overrides built-in by name)
  const runtimeNames = new Set(runtimeTypes.map(t => t.name))
  const mergedTypes = [
    ...BUILTIN_VISUAL_WGSL.filter(b => !runtimeNames.has(b.name)),
    ...runtimeTypes,
  ]

  // Deduplicate by name AND by ID (runtime overrides built-in by name; first ID wins)
  const seenNames = new Set<string>()
  const seenIds = new Set<number>()
  const dedupedTypes = mergedTypes.filter(t => {
    if (seenNames.has(t.name) || seenIds.has(t.id)) return false
    seenNames.add(t.name)
    seenIds.add(t.id)
    return true
  })
  const visualFunctions = dedupedTypes.map(t => t.wgsl).join('\n\n')

  // Generate switch cases for visual dispatch
  const switchCases = dedupedTypes.map(t =>
    `    case ${t.id}u: { return visual_${t.name}(uv, sdf, col, time, p, behind); }`
  ).join('\n')

  // Generate interaction function definitions (deduplicate by name)
  const seenIx = new Set<string>()
  const dedupedIx = interactions.filter(ix => {
    if (seenIx.has(ix.name)) return false
    seenIx.add(ix.name)
    return true
  })
  const interactionFunctions = dedupedIx.map(ix => ix.wgsl).join('\n\n')
  const interactionSwitchCases = dedupedIx.map(ix =>
    `    case ${ix.id}u: { return interaction_${ix.name}(uvA, uvB, colorA, colorB, time); }`
  ).join('\n')
  const hasInteractions = dedupedIx.length > 0

  // Deduplicate module WGSL — strip functions already in SHADER_UTILITIES or earlier modules
  const modSeen = new Set(BASE_FUNC_NAMES)
  const moduleCode = mods.map(m => deduplicateModCode(m.wgsl, modSeen)).join('\n\n')

  // Render target bindings (group 2) — read_write for both sampling and writing
  const targetBindings: string[] = []
  for (let i = 0; i < numTargets; i++) {
    targetBindings.push(`@group(2) @binding(${i}) var<storage, read_write> renderTarget_${i}: array<vec4f>;`)
  }
  const targetBindingsStr = targetBindings.join('\n')

  // sampleTarget() function — always injected so visuals can reference it even
  // when no render targets exist yet (returns black). When targets exist, routes
  // to the appropriate buffer via switch dispatch.
  let sampleTargetFn: string
  if (numTargets > 0) {
    const targetCases: string[] = []
    for (let i = 0; i < numTargets; i++) {
      targetCases.push(`    case ${i}u: { return renderTarget_${i}[pixelIdx]; }`)
    }
    sampleTargetFn = `
fn sampleTarget(targetId: u32, pixelCoord: vec2f) -> vec4f {
  let px = vec2u(clamp(vec2i(pixelCoord), vec2i(0), vec2i(i32(frame.resolution.x) - 1, i32(frame.resolution.y) - 1)));
  let pixelIdx = px.y * u32(frame.resolution.x) + px.x;
  switch (targetId) {
${targetCases.join('\n')}
    default: { return vec4f(0.0); }
  }
}

fn sampleTargetUV(targetId: u32, uv: vec2f) -> vec4f {
  let px = vec2f(uv.x * frame.resolution.x, (1.0 - uv.y) * frame.resolution.y);
  return sampleTarget(targetId, px);
}
`
  } else {
    // Stub — no render targets allocated, but visuals may still call sampleTarget
    sampleTargetFn = `
fn sampleTarget(targetId: u32, pixelCoord: vec2f) -> vec4f {
  return vec4f(0.0);
}

fn sampleTargetUV(targetId: u32, uv: vec2f) -> vec4f {
  return vec4f(0.0);
}
`
  }

  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

struct FieldGPU {
  posScaleRot: vec4f,
  shapeDims: vec4f,
  color: vec4f,
  visualAndParams: vec4f,
  extraParams: vec4f,
  pos3D: vec4f,         // z, rotX, rotY, superimpose (0=OIT, 1=legacy overwrite)
};

struct InteractionGPU {
  fieldIdxA: u32,
  fieldIdxB: u32,
  interactionType: u32,
  propagationType: u32,
};

@group(1) @binding(0) var<storage, read> superFields: array<FieldGPU>;
@group(1) @binding(1) var<storage, read_write> accumBuf: array<vec4f>;
@group(1) @binding(2) var<storage, read_write> hitIdBuf: array<u32>;
@group(1) @binding(3) var<storage, read> interactions: array<InteractionGPU>;
@group(1) @binding(4) var<storage, read_write> ixBuf: array<vec4f>;
@group(1) @binding(5) var<storage, read_write> ixTypeBuf: array<u32>;
@group(1) @binding(6) var<storage, read> prevAccumBuf: array<vec4f>;
@group(1) @binding(7) var<storage, read> worldUni: array<vec4f>;
// icon atlas: packed RGBA8 (one u32 per texel), 64x64 per slot, row-major top-down.
// The cafe door samples a world's real screenshot INTO its bubble with this —
// same shader pass as the bubble, so the face can never detach. Empty for
// every other world (a 1-element fallback keeps the layout satisfied).
@group(1) @binding(8) var<storage, read> iconBuf: array<u32>;

// ─── World uniforms ("the whiteboard") ───
// 64 shared floats written by step hooks via worldData.gpuUniforms.
// Every visual and interaction shader can read them: uni(0)..uni(63), or uni4(0)..uni4(15).
fn uni(i: i32) -> f32 {
  let v = worldUni[clamp(i, 0, 95) / 4];
  let c = clamp(i, 0, 95) % 4;
  if (c == 0) { return v.x; }
  if (c == 1) { return v.y; }
  if (c == 2) { return v.z; }
  return v.w;
}
fn uni4(i: i32) -> vec4f { return worldUni[clamp(i, 0, 23)]; }

// Sample slot's screenshot at disc-local uv (-1..1, y up). Returns rgb (linearized
// from sRGB so the tonemapper treats it like every other visual). Off-disc → black.
const CAFE_ICON: i32 = 64;
fn cafeIcon(slot: i32, uv: vec2f) -> vec3f {
  if (slot < 0) { return vec3f(0.0); }
  let px = clamp(i32((uv.x * 0.5 + 0.5) * f32(CAFE_ICON)), 0, CAFE_ICON - 1);
  // atlas rows were being read bottom-up vs. how they're packed → icons flipped;
  // sample top-down so the screenshot lands upright in the bubble
  let py = clamp(i32((uv.y * 0.5 + 0.5) * f32(CAFE_ICON)), 0, CAFE_ICON - 1);
  let idx = slot * CAFE_ICON * CAFE_ICON + py * CAFE_ICON + px;
  if (idx < 0 || u32(idx) >= arrayLength(&iconBuf)) { return vec3f(0.0); }
  let p = iconBuf[idx];
  let c = vec3f(f32(p & 0xffu), f32((p >> 8u) & 0xffu), f32((p >> 16u) & 0xffu)) / 255.0;
  // sRGB→linear, then expose up so ACES (applied downstream) lands the photo
  // near its original display brightness instead of crushing it to black
  return pow(c, vec3f(2.2)) * 4.5;
}

// Seven-segment digits as smooth SDF strokes — crisp and antialiased at any
// bubble size, no pixel chunk. Lets the cafe door draw head-counts INSIDE the
// bubble, same pass — the number can never drift because it IS the bubble.
fn cafeSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// one digit at local p (x -0.5..0.5, y -1..1, y down). Soft coverage of stroke
// half-width w. Segment bits: A=1 B=2 C=4 D=8 E=16 F=32 G=64.
fn cafeDigit(d: i32, p: vec2f, w: f32) -> f32 {
  if (d < 0 || d > 9) { return 0.0; }
  var segs = array<u32,10>(63u, 6u, 91u, 79u, 102u, 109u, 125u, 7u, 127u, 111u);
  let m = segs[d];
  let x0 = -0.34; let x1 = 0.34;
  let yT = -0.82; let yM = 0.0; let yB = 0.82;
  var dist = 1e9;
  if ((m & 1u)  != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yT), vec2f(x1, yT))); }  // A
  if ((m & 2u)  != 0u) { dist = min(dist, cafeSeg(p, vec2f(x1, yT), vec2f(x1, yM))); }  // B
  if ((m & 4u)  != 0u) { dist = min(dist, cafeSeg(p, vec2f(x1, yM), vec2f(x1, yB))); }  // C
  if ((m & 8u)  != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yB), vec2f(x1, yB))); }  // D
  if ((m & 16u) != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yM), vec2f(x0, yB))); }  // E
  if ((m & 32u) != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yT), vec2f(x0, yM))); }  // F
  if ((m & 64u) != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yM), vec2f(x1, yM))); }  // G
  return smoothstep(w, w * 0.4, dist);
}
// ink coverage of 'count' at local p (x,y in -1..1 over the number's box).
// Two digits max; w is stroke half-width in local units.
fn cafeCount(p: vec2f, count: i32, w: f32) -> f32 {
  if (count < 0) { return 0.0; }
  let two = count >= 10;
  let n = select(1.0, 2.0, two);
  let u = p.x * n;                              // -n..n across the digits
  var ink = 0.0;
  for (var k = 0; k < 2; k++) {
    if (f32(k) >= n) { break; }
    let c = -n + 2.0 * f32(k) + 1.0;            // this digit's center in u
    var d = count;
    if (two) { if (k == 0) { d = count / 10; } else { d = count % 10; } }
    ink = max(ink, cafeDigit(d, vec2f((u - c) * 0.66, p.y), w));
  }
  return ink;
}

// ─── Cell shaders: the previous frame is the world's memory ───
// prevAt(o) reads last frame's composite at this pixel + offset o (in pixels,
// clamped at edges). prevHere() is prevAt(vec2f(0)). pix() is this pixel's
// canvas coordinate. A visual that returns f(its neighbors' past) is a
// cellular automaton — Life, reaction-diffusion, wave equations, sand.
// State persists frame to frame in the accumulation buffer itself.
var<private> ca_pix: vec2i = vec2i(0, 0);
fn pix() -> vec2f { return vec2f(ca_pix); }
fn prevAt(o: vec2f) -> vec4f {
  let r = vec2i(i32(frame.resolution.x), i32(frame.resolution.y));
  let p = clamp(ca_pix + vec2i(o), vec2i(0, 0), r - vec2i(1, 1));
  return prevAccumBuf[u32(p.y) * u32(r.x) + u32(p.x)];
}
fn prevHere() -> vec4f { return prevAt(vec2f(0.0)); }

${targetBindingsStr}

${SHADER_UTILITIES}

// ─── Shader modules (reusable utility functions) ───
${moduleCode}

${sampleTargetFn}

// ─── SDF for field shape ───
fn superSDF(coord: vec2f, f: FieldGPU) -> f32 {
  let pos = f.posScaleRot.xy;
  let scale = max(f.posScaleRot.z, 0.001);
  let rot = f.posScaleRot.w;

  var local = coord - pos;
  if (rot != 0.0) {
    let c = cos(-rot);
    let s = sin(-rot);
    local = vec2f(c * local.x - s * local.y, s * local.x + c * local.y);
  }
  local /= scale;

  let st = u32(f.shapeDims.x);
  if (st == 2u) { return -1.0; } // screen/pixel-perfect — always inside, shader alpha defines shape
  if (st == 1u) { // rect
    return sdBox(local, vec2f(f.shapeDims.y * 0.5, f.shapeDims.z * 0.5));
  }
  // default: circle
  return length(local) - f.shapeDims.y;
}

// ─── Local UV within field bounds (-1..1) ───
fn superLocalUV(coord: vec2f, f: FieldGPU) -> vec2f {
  let pos = f.posScaleRot.xy;
  let scale = max(f.posScaleRot.z, 0.001);
  let rot = f.posScaleRot.w;

  var local = coord - pos;
  if (rot != 0.0) {
    let c = cos(-rot);
    let s = sin(-rot);
    local = vec2f(c * local.x - s * local.y, s * local.x + c * local.y);
  }
  local /= scale;

  let st = u32(f.shapeDims.x);
  if (st == 1u || st == 2u) { // rect or screen — normalize by half-extents
    return vec2f(local.x / max(f.shapeDims.y * 0.5, 1.0), local.y / max(f.shapeDims.z * 0.5, 1.0));
  }
  // circle — normalize by radius
  return local / max(f.shapeDims.y, 1.0);
}

// ─── Visual type functions (dynamically generated from registry) ───
${visualFunctions}

// ─── Visual dispatch (dynamically generated switch) ───
// behind: vec4f(rgb, a) = whatever has already been rendered at this pixel by
// earlier fields in the loop. Fields can see and respond to what's underneath.
fn superVisual(uv: vec2f, sdf: f32, f: FieldGPU, time: f32, behind: vec4f) -> vec4f {
  let vtype = u32(f.visualAndParams.x);
  let col = f.color;
  let p = vec4f(f.visualAndParams.yzw, f.extraParams.x);

  switch (vtype) {
${switchCases}
    default: {
      // Inline solid fallback — no visual type defined for this field
      let fa = smoothstep(0.5, -0.5, sdf);
      if (fa < 0.01) { return vec4f(0.0); }
      return vec4f(col.rgb, fa);
    }
  }
}

// ─── Interaction functions (a + b = c at overlap pixels) ───
${interactionFunctions}

fn dispatchInteraction(itype: u32, uvA: vec2f, uvB: vec2f, colorA: vec4f, colorB: vec4f, time: f32) -> vec4f {
  switch (itype) {
${interactionSwitchCases}
    default: { return vec4f(0.0); }
  }
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let pixel = vec2f(f32(gid.x), f32(gid.y));
  if (pixel.x >= frame.resolution.x || pixel.y >= frame.resolution.y) { return; }
  ca_pix = vec2i(gid.xy);

  let stride = u32(frame.resolution.x);
  let idx = gid.y * stride + gid.x;

  // Clear interaction buffers for this pixel (before any early return)
  ixBuf[idx] = vec4f(0.0);
  ixTypeBuf[idx] = 0xFFFFFFFFu;

  // Pixel → UV → grid coord (same transform as effect compute shader)
  let uv = vec2f((pixel.x + 0.5) / frame.resolution.x, 1.0 - (pixel.y + 0.5) / frame.resolution.y);
  let aspect = frame.resolution.x / frame.resolution.y;
  let gridRange = vec2f(frame.gridSize) / frame.zoom;
  var gridCoord: vec2f;
  if (aspect > 1.0) {
    gridCoord.x = frame.camera.x + (uv.x - 0.5) * gridRange.x * aspect;
    gridCoord.y = frame.camera.y + (0.5 - uv.y) * gridRange.y;
  } else {
    gridCoord.x = frame.camera.x + (uv.x - 0.5) * gridRange.x;
    gridCoord.y = frame.camera.y + (0.5 - uv.y) * gridRange.y / aspect;
  }

  // Use continuous gridCoord (not snapped cellCoord) for superimposed fields.
  // Superimposed visuals are resolution-independent procedural shaders, not grid cells.
  // Snapping to floor()+0.5 quantizes rendering to grid resolution, causing blocky
  // visuals and pixel-dancing when the grid doesn't align 1:1 with screen pixels.
  let cellCoord = gridCoord;
  let fieldCount = arrayLength(&superFields);

  // ─── Superimposed field evaluation ───
  //
  // SUPERIMPOSITION LEAK (intentional, documented behavior):
  //
  // Fields do NOT composite independently. The overlap loop has a structural
  // asymmetry: color is OVERWRITTEN by each successive field (last wins), but
  // presence (alpha) is ACCUMULATED via max(). This means:
  //
  //   - If field A (alpha=1.0) is behind field B (alpha=0.3 at its edge),
  //     the pixel renders B's color at A's alpha. B appears more opaque than
  //     it would alone because A's presence is "ghost-writing" B's compositing.
  //
  //   - Neither field fully owns the pixel. The color belongs to one field,
  //     the opacity to another. It's an accidental superposition where each
  //     field leaks into the other's rendering.
  //
  //   - The effect is asymmetric and order-dependent: field array position
  //     determines which field's color survives, but any field's alpha can
  //     dominate. Reordering the fields changes the visual.
  //
  //   - At overlap boundaries where both fields have partial SDF coverage,
  //     the result is a color-opacity mismatch that creates a third visual
  //     state — belonging to neither field alone.
  //
  // This is NOT a bug. It creates emergent visual interaction between fields
  // without any explicit interaction shader. The fields affect each other
  // through shared compositing state, not through shared computation.
  //
  // Previous frame's composite at this pixel — used for temporal bidirectional behind.
  // Fields with extraParams.y > 0.5 see the full scene from the previous frame (~16ms latency)
  // instead of only forward-accumulated fields. Single pass, zero extra field evaluations.
  let prevPixel = prevAccumBuf[idx];

  var resultColor = vec3f(0.0);
  var resultPresence: f32 = 0.0;
  // OIT accumulators — weighted blended order-independent transparency
  var oitColorSum = vec3f(0.0);
  var oitWeightSum: f32 = 0.0;
  var oitTransmittance: f32 = 1.0;

  // Overlap tracking — store indices of all fields present at this pixel (max 8)
  var overlapIndices: array<u32, 8>;
  var overlapCount: u32 = 0u;

  for (var i = 0u; i < fieldCount; i++) {
    let f = superFields[i];

    // ─── AABB early reject — skip fields whose bounding box doesn't contain this pixel ───
    // Accounts for rotation: a rotated rect's AABB expands. Circles are rotation-invariant.
    let fpos = f.posScaleRot.xy;
    let fscale = max(f.posScaleRot.z, 0.001);
    let frot = f.posScaleRot.w;
    let fst = u32(f.shapeDims.x);
    var halfExtent: vec2f;
    if (fst == 1u || fst == 2u) { // rect or screen — expand AABB for rotation
      let hw = f.shapeDims.y * 0.5 * fscale;
      let hh = f.shapeDims.z * 0.5 * fscale;
      let ac = abs(cos(frot));
      let as_ = abs(sin(frot));
      halfExtent = vec2f(hw * ac + hh * as_, hw * as_ + hh * ac);
    } else { // circle — rotation doesn't change bounds
      halfExtent = vec2f(f.shapeDims.y * fscale);
    }
    halfExtent += vec2f(1.0); // 1px AA margin
    if (cellCoord.x < fpos.x - halfExtent.x || cellCoord.x > fpos.x + halfExtent.x ||
        cellCoord.y < fpos.y - halfExtent.y || cellCoord.y > fpos.y + halfExtent.y) {
      continue;
    }

    let sdf = superSDF(cellCoord, f);
    let localUV = superLocalUV(cellCoord, f);
    // Per-field behind: temporal bidirectional (prev frame) or forward-only
    // Include OIT accumulated color in behind estimate
    var behind: vec4f;
    if (f.extraParams.y > 0.5) {
      // Bidirectional: use previous frame's full composite for behind
      behind = vec4f(
        select(resultColor, prevPixel.rgb, prevPixel.a > resultPresence),
        max(resultPresence, prevPixel.a)
      );
    } else {
      // Forward-only: merge OIT accumulated color with superimposed result
      let oitSoFar = select(vec3f(0.0), oitColorSum / max(oitWeightSum, 0.001), oitWeightSum > 0.001);
      let oitAlphaSoFar = 1.0 - oitTransmittance;
      let behindColor = mix(oitSoFar, resultColor, resultPresence);
      let behindAlpha = oitAlphaSoFar + resultPresence * oitTransmittance;
      behind = vec4f(behindColor, behindAlpha);
    }
    var visual = superVisual(localUV, sdf, f, frame.time, behind);

    // ─── Auto-computed SDF normals + lighting ───
    // extraParams.z = lighting intensity (0 = no lighting, 1 = full)
    // extraParams.w = specular shininess (0 = off, higher = sharper)
    let lightAmt = f.extraParams.z;
    if (visual.a > 0.01 && lightAmt > 0.01) {
      let eps = max(fscale * 0.5, 0.5);
      let sdfR = superSDF(cellCoord + vec2f(eps, 0.0), f);
      let sdfU = superSDF(cellCoord + vec2f(0.0, eps), f);
      let normal = normalize(vec2f(sdfR - sdf, sdfU - sdf));
      // Global light direction from _pad field (we reuse frame uniforms)
      let lightDir = normalize(vec2f(0.5, 0.7));
      let diff = clamp(dot(normal, lightDir), 0.0, 1.0);
      let ambient = 0.4;
      let lighting = diff * (1.0 - ambient) + ambient;
      // Specular
      let shininess = f.extraParams.w;
      var spec = 0.0;
      if (shininess > 0.1) {
        let viewDir = vec2f(0.0, 1.0);
        let halfDir = normalize(lightDir + viewDir);
        spec = pow(max(dot(normal, halfDir), 0.0), shininess) * 0.5;
      }
      // AO from SDF — concave areas are darker
      let ao = clamp(sdf * 0.3 + 1.0, 0.3, 1.0);
      visual = vec4f(visual.rgb * mix(1.0, lighting * ao, lightAmt) + vec3f(spec * lightAmt), visual.a);
    }

    if (visual.a > 0.01) {
      // Fields targeted to a render target (shapeDims.w >= 0) should NOT
      // contribute to the screen buffer (accumBuf). They only render to
      // their designated target via the RTT write section below.
      if (i32(f.shapeDims.w) < 0) {
        let superimpose = f.pos3D.w; // 0.0 = OIT (correct transparency), 1.0 = legacy overwrite
        if (superimpose > 0.5) {
          // Legacy superimposition: last-write-wins overwrite
          resultColor = visual.rgb;
          resultPresence = max(resultPresence, visual.a);
        } else {
          // OIT: weighted blended accumulation — order-independent
          let depth = f32(i) / max(f32(fieldCount), 1.0);
          let w = visual.a * max(0.01, 1.0 - depth * 0.5);
          oitColorSum += visual.rgb * w;
          oitWeightSum += w;
          oitTransmittance *= (1.0 - visual.a);
        }
      }
      if (overlapCount < 8u) {
        overlapIndices[overlapCount] = i;
        overlapCount++;
      }
    }
  }

  // ─── Merge OIT result with any superimposed fields ───
  if (oitWeightSum > 0.001) {
    let oitColor = oitColorSum / oitWeightSum;
    let oitAlpha = 1.0 - oitTransmittance;
    // OIT forms the base, superimposed fields overwrite on top
    resultColor = mix(oitColor, resultColor, resultPresence);
    resultPresence = oitAlpha + resultPresence * oitTransmittance;
  }

  if (overlapCount == 0u) {
    hitIdBuf[idx] = 0xFFFFFFFFu;
    return;
  }

  // ─── Interaction effects: a + b = c ───
  // When two fields overlap, check if an interaction is defined for that pair.
  // If so, the interaction visual replaces both fields at this pixel.
  // Early-exit after first match per pair to avoid O(n³) worst case.
  let intCount = arrayLength(&interactions);
  if (overlapCount >= 2u && intCount > 0u) {
    for (var oi = 0u; oi < overlapCount; oi++) {
      for (var oj = oi + 1u; oj < overlapCount; oj++) {
        let idxA = overlapIndices[oi];
        let idxB = overlapIndices[oj];
        for (var k = 0u; k < intCount; k++) {
          let ix = interactions[k];
          let matchAB = (ix.fieldIdxA == idxA && ix.fieldIdxB == idxB);
          let matchBA = (ix.fieldIdxA == idxB && ix.fieldIdxB == idxA);
          if (matchAB || matchBA) {
            let fA = superFields[idxA];
            let fB = superFields[idxB];
            let uvA = superLocalUV(cellCoord, fA);
            let uvB = superLocalUV(cellCoord, fB);
            let ixResult = dispatchInteraction(ix.interactionType, uvA, uvB, fA.color, fB.color, frame.time);
            if (ixResult.a > 0.01) {
              resultColor = ixResult.rgb;
              resultPresence = ixResult.a;
              ixBuf[idx] = ixResult;
              ixTypeBuf[idx] = ix.propagationType;
            }
            break; // Only one interaction per pair
          }
        }
      }
    }
  }

  // Write topmost screen-visible field index for pixel-perfect hit testing
  // Skip RTT-targeted fields (shapeDims.w >= 0) and noHit fields (shapeDims.w == -2)
  var hitIdx = 0xFFFFFFFFu;
  for (var hi = overlapCount; hi > 0u; hi--) {
    let hfi = overlapIndices[hi - 1u];
    if (i32(superFields[hfi].shapeDims.w) == -1) {
      hitIdx = hfi;
      break;
    }
  }
  hitIdBuf[idx] = hitIdx;

  // Write to accumulation buffer (blend with existing for coexistence with per-field effects)
  let existing = accumBuf[idx];
  accumBuf[idx] = vec4f(
    mix(existing.rgb, resultColor, resultPresence),
    existing.a + resultPresence * (1.0 - existing.a),
  );
${numTargets > 0 ? `
  // ─── Render target writes ───
  // Fields with shapeDims.w >= 0 are excluded from accumBuf above — they ONLY
  // write to their designated render target buffer. Re-scan visible fields here.
  for (var ti = 0u; ti < overlapCount; ti++) {
    let tfi = overlapIndices[ti];
    let tf = superFields[tfi];
    let targetId = i32(tf.shapeDims.w);
    if (targetId < 0) { continue; }
    let tuv = superLocalUV(cellCoord, tf);
    let tsdf = superSDF(cellCoord, tf);
    let tbehind = vec4f(resultColor, resultPresence);
    let tvisual = superVisual(tuv, tsdf, tf, frame.time, tbehind);
    if (tvisual.a > 0.01) {
      switch (u32(targetId)) {
${Array.from({length: numTargets}, (_, i) => `        case ${i}u: {
          let rt_ex_${i} = renderTarget_${i}[idx];
          renderTarget_${i}[idx] = vec4f(mix(rt_ex_${i}.rgb, tvisual.rgb, tvisual.a), rt_ex_${i}.a + tvisual.a * (1.0 - rt_ex_${i}.a));
        }`).join('\n')}
        default: {}
      }
    }
  }
` : ''}
}
`
}

/**
 * 3D superimposed compute shader — ray-based rendering with full superposition.
 * For each pixel, casts a ray from the perspective camera, tests against all fields
 * (circle→sphere, rect→box), and accumulates color/presence in array order
 * (same superposition leak as 2D). Visual types receive UV from the 3D hit point
 * projected onto the field's local XY plane, so all existing visuals work unchanged.
 */
export function buildSuperimposed3DComputeShader(
  visualTypes?: VisualTypeEntry[],
  interactionTypes?: InteractionEntry[],
  modules?: ModuleEntry[],
  targetCount?: number,
): string {
  const runtimeTypes = visualTypes || []
  const interactions = interactionTypes || []
  const mods = modules || []
  const numTargets = targetCount || 0

  // Merge built-in + runtime visual types (runtime overrides built-in by name)
  const runtimeNames = new Set(runtimeTypes.map(t => t.name))
  const mergedTypes = [
    ...BUILTIN_VISUAL_WGSL.filter(b => !runtimeNames.has(b.name)),
    ...runtimeTypes,
  ]

  const seenNames = new Set<string>()
  const dedupedTypes = mergedTypes.filter(t => {
    if (seenNames.has(t.name)) return false
    seenNames.add(t.name)
    return true
  })
  const visualFunctions = dedupedTypes.map(t => t.wgsl).join('\n\n')
  const switchCases = dedupedTypes.map(t =>
    `    case ${t.id}u: { return visual_${t.name}(uv, sdf, col, time, p, behind); }`
  ).join('\n')

  const seenIx = new Set<string>()
  const dedupedIx = interactions.filter(ix => {
    if (seenIx.has(ix.name)) return false
    seenIx.add(ix.name)
    return true
  })
  const interactionFunctions = dedupedIx.map(ix => ix.wgsl).join('\n\n')
  const interactionSwitchCases = dedupedIx.map(ix =>
    `    case ${ix.id}u: { return interaction_${ix.name}(uvA, uvB, colorA, colorB, time); }`
  ).join('\n')

  const modSeen = new Set(BASE_FUNC_NAMES)
  const moduleCode = mods.map(m => deduplicateModCode(m.wgsl, modSeen)).join('\n\n')

  const targetBindings: string[] = []
  for (let i = 0; i < numTargets; i++) {
    targetBindings.push(`@group(2) @binding(${i}) var<storage, read_write> renderTarget_${i}: array<vec4f>;`)
  }
  const targetBindingsStr = targetBindings.join('\n')

  let sampleTargetFn: string
  if (numTargets > 0) {
    const targetCases: string[] = []
    for (let i = 0; i < numTargets; i++) {
      targetCases.push(`    case ${i}u: { return renderTarget_${i}[pixelIdx]; }`)
    }
    sampleTargetFn = `
fn sampleTarget(targetId: u32, pixelCoord: vec2f) -> vec4f {
  let pixelIdx = u32(pixelCoord.y) * u32(frame.resolution.x) + u32(pixelCoord.x);
  switch (targetId) {
${targetCases.join('\n')}
    default: { return vec4f(0.0); }
  }
}`
  } else {
    sampleTargetFn = `
fn sampleTarget(targetId: u32, pixelCoord: vec2f) -> vec4f {
  return vec4f(0.0);
}`
  }

  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}
${SHADER_UTILITIES}

${moduleCode}

// ─── Bindings ───
@group(1) @binding(0) var<storage, read> superFields: array<FieldGPU>;
@group(1) @binding(1) var<storage, read_write> accumBuf: array<vec4f>;
@group(1) @binding(2) var<storage, read_write> hitIdBuf: array<u32>;
@group(1) @binding(3) var<storage, read> interactions: array<InteractionGPU>;
@group(1) @binding(4) var<storage, read_write> ixBuf: array<vec4f>;
@group(1) @binding(5) var<storage, read_write> ixTypeBuf: array<u32>;
@group(1) @binding(6) var<storage, read> prevAccumBuf: array<vec4f>;
@group(1) @binding(7) var<storage, read> worldUni: array<vec4f>;
// icon atlas: packed RGBA8 (one u32 per texel), 64x64 per slot, row-major top-down.
// The cafe door samples a world's real screenshot INTO its bubble with this —
// same shader pass as the bubble, so the face can never detach. Empty for
// every other world (a 1-element fallback keeps the layout satisfied).
@group(1) @binding(8) var<storage, read> iconBuf: array<u32>;

// ─── World uniforms ("the whiteboard") ───
// 64 shared floats written by step hooks via worldData.gpuUniforms.
// Every visual and interaction shader can read them: uni(0)..uni(63), or uni4(0)..uni4(15).
fn uni(i: i32) -> f32 {
  let v = worldUni[clamp(i, 0, 95) / 4];
  let c = clamp(i, 0, 95) % 4;
  if (c == 0) { return v.x; }
  if (c == 1) { return v.y; }
  if (c == 2) { return v.z; }
  return v.w;
}
fn uni4(i: i32) -> vec4f { return worldUni[clamp(i, 0, 23)]; }

// Sample slot's screenshot at disc-local uv (-1..1, y up). Returns rgb (linearized
// from sRGB so the tonemapper treats it like every other visual). Off-disc → black.
const CAFE_ICON: i32 = 64;
fn cafeIcon(slot: i32, uv: vec2f) -> vec3f {
  if (slot < 0) { return vec3f(0.0); }
  let px = clamp(i32((uv.x * 0.5 + 0.5) * f32(CAFE_ICON)), 0, CAFE_ICON - 1);
  // atlas rows were being read bottom-up vs. how they're packed → icons flipped;
  // sample top-down so the screenshot lands upright in the bubble
  let py = clamp(i32((uv.y * 0.5 + 0.5) * f32(CAFE_ICON)), 0, CAFE_ICON - 1);
  let idx = slot * CAFE_ICON * CAFE_ICON + py * CAFE_ICON + px;
  if (idx < 0 || u32(idx) >= arrayLength(&iconBuf)) { return vec3f(0.0); }
  let p = iconBuf[idx];
  let c = vec3f(f32(p & 0xffu), f32((p >> 8u) & 0xffu), f32((p >> 16u) & 0xffu)) / 255.0;
  // sRGB→linear, then expose up so ACES (applied downstream) lands the photo
  // near its original display brightness instead of crushing it to black
  return pow(c, vec3f(2.2)) * 4.5;
}

// Seven-segment digits as smooth SDF strokes — crisp and antialiased at any
// bubble size, no pixel chunk. Lets the cafe door draw head-counts INSIDE the
// bubble, same pass — the number can never drift because it IS the bubble.
fn cafeSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// one digit at local p (x -0.5..0.5, y -1..1, y down). Soft coverage of stroke
// half-width w. Segment bits: A=1 B=2 C=4 D=8 E=16 F=32 G=64.
fn cafeDigit(d: i32, p: vec2f, w: f32) -> f32 {
  if (d < 0 || d > 9) { return 0.0; }
  var segs = array<u32,10>(63u, 6u, 91u, 79u, 102u, 109u, 125u, 7u, 127u, 111u);
  let m = segs[d];
  let x0 = -0.34; let x1 = 0.34;
  let yT = -0.82; let yM = 0.0; let yB = 0.82;
  var dist = 1e9;
  if ((m & 1u)  != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yT), vec2f(x1, yT))); }  // A
  if ((m & 2u)  != 0u) { dist = min(dist, cafeSeg(p, vec2f(x1, yT), vec2f(x1, yM))); }  // B
  if ((m & 4u)  != 0u) { dist = min(dist, cafeSeg(p, vec2f(x1, yM), vec2f(x1, yB))); }  // C
  if ((m & 8u)  != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yB), vec2f(x1, yB))); }  // D
  if ((m & 16u) != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yM), vec2f(x0, yB))); }  // E
  if ((m & 32u) != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yT), vec2f(x0, yM))); }  // F
  if ((m & 64u) != 0u) { dist = min(dist, cafeSeg(p, vec2f(x0, yM), vec2f(x1, yM))); }  // G
  return smoothstep(w, w * 0.4, dist);
}
// ink coverage of 'count' at local p (x,y in -1..1 over the number's box).
// Two digits max; w is stroke half-width in local units.
fn cafeCount(p: vec2f, count: i32, w: f32) -> f32 {
  if (count < 0) { return 0.0; }
  let two = count >= 10;
  let n = select(1.0, 2.0, two);
  let u = p.x * n;                              // -n..n across the digits
  var ink = 0.0;
  for (var k = 0; k < 2; k++) {
    if (f32(k) >= n) { break; }
    let c = -n + 2.0 * f32(k) + 1.0;            // this digit's center in u
    var d = count;
    if (two) { if (k == 0) { d = count / 10; } else { d = count % 10; } }
    ink = max(ink, cafeDigit(d, vec2f((u - c) * 0.66, p.y), w));
  }
  return ink;
}

// ─── Cell shaders: the previous frame is the world's memory ───
// prevAt(o) reads last frame's composite at this pixel + offset o (in pixels,
// clamped at edges). prevHere() is prevAt(vec2f(0)). pix() is this pixel's
// canvas coordinate. A visual that returns f(its neighbors' past) is a
// cellular automaton — Life, reaction-diffusion, wave equations, sand.
// State persists frame to frame in the accumulation buffer itself.
var<private> ca_pix: vec2i = vec2i(0, 0);
fn pix() -> vec2f { return vec2f(ca_pix); }
fn prevAt(o: vec2f) -> vec4f {
  let r = vec2i(i32(frame.resolution.x), i32(frame.resolution.y));
  let p = clamp(ca_pix + vec2i(o), vec2i(0, 0), r - vec2i(1, 1));
  return prevAccumBuf[u32(p.y) * u32(r.x) + u32(p.x)];
}
fn prevHere() -> vec4f { return prevAt(vec2f(0.0)); }
${targetBindingsStr}

struct FieldGPU {
  posScaleRot: vec4f,
  shapeDims: vec4f,
  color: vec4f,
  visualAndParams: vec4f,
  extraParams: vec4f,
  pos3D: vec4f,         // z, rotX, rotY, superimpose (0=OIT, 1=legacy overwrite)
};

struct InteractionGPU {
  fieldIdxA: u32,
  fieldIdxB: u32,
  interactionType: u32,
  propagationType: u32,
};

${sampleTargetFn}

// ─── Ray-field intersection ───
// Transforms ray into field's local 3D space and tests against sphere/box.
// Returns hit distance t (>0 if hit, <0 if miss).
fn rayFieldIntersect(origin: vec3f, dir: vec3f, f: FieldGPU) -> f32 {
  let pos3 = vec3f(f.posScaleRot.xy, f.pos3D.x);
  let scale = max(f.posScaleRot.z, 0.001);
  let rotZ = f.posScaleRot.w;
  let rotX = f.pos3D.y;
  let rotY = f.pos3D.z;

  // Transform ray into field's local space
  var lo = origin - pos3;
  var ld = dir;
  // Apply inverse rotation: undo Y, then X, then Z
  lo = rotateY3(lo, -rotY); ld = rotateY3(ld, -rotY);
  lo = rotateX3(lo, -rotX); ld = rotateX3(ld, -rotX);
  lo = rotateZ3(lo, -rotZ); ld = rotateZ3(ld, -rotZ);
  lo /= scale;

  let st = u32(f.shapeDims.x);
  if (st == 1u) {
    // Rect → Box (use half dim1 × half dim2 × min(dim1,dim2)/4 depth)
    let hx = f.shapeDims.y * 0.5;
    let hy = f.shapeDims.z * 0.5;
    let hz = min(hx, hy) * 0.5;
    return rayBox(lo, ld, vec3f(hx, hy, hz)) * scale;
  }
  // Circle → Sphere
  return raySphere(lo, ld, f.shapeDims.y) * scale;
}

// ─── Compute local UV from 3D hit point (projected onto field's local XY plane) ───
fn hitLocalUV(hitWorld: vec3f, f: FieldGPU) -> vec2f {
  let pos3 = vec3f(f.posScaleRot.xy, f.pos3D.x);
  let scale = max(f.posScaleRot.z, 0.001);
  let rotZ = f.posScaleRot.w;
  let rotX = f.pos3D.y;
  let rotY = f.pos3D.z;

  var local = hitWorld - pos3;
  local = rotateY3(local, -rotY);
  local = rotateX3(local, -rotX);
  local = rotateZ3(local, -rotZ);
  local /= scale;

  let st = u32(f.shapeDims.x);
  if (st == 1u) {
    return vec2f(local.x / max(f.shapeDims.y * 0.5, 1.0), local.y / max(f.shapeDims.z * 0.5, 1.0));
  }
  return local.xy / max(f.shapeDims.y, 1.0);
}

// ─── Compute 2D SDF from 3D hit point (for visual type compatibility) ───
fn hitSDF(hitWorld: vec3f, f: FieldGPU) -> f32 {
  let pos3 = vec3f(f.posScaleRot.xy, f.pos3D.x);
  let scale = max(f.posScaleRot.z, 0.001);
  let rotZ = f.posScaleRot.w;
  let rotX = f.pos3D.y;
  let rotY = f.pos3D.z;

  var local = hitWorld - pos3;
  local = rotateY3(local, -rotY);
  local = rotateX3(local, -rotX);
  local = rotateZ3(local, -rotZ);
  local /= scale;

  let st = u32(f.shapeDims.x);
  if (st == 1u) {
    return sdBox(local.xy, vec2f(f.shapeDims.y * 0.5, f.shapeDims.z * 0.5));
  }
  return length(local.xy) - f.shapeDims.y;
}

// ─── Visual type functions ───
${visualFunctions}

fn superVisual3D(uv: vec2f, sdf: f32, f: FieldGPU, time: f32, behind: vec4f) -> vec4f {
  let vtype = u32(f.visualAndParams.x);
  let col = f.color;
  let p = vec4f(f.visualAndParams.yzw, f.extraParams.x);

  switch (vtype) {
${switchCases}
    default: {
      let fa = smoothstep(0.5, -0.5, sdf);
      if (fa < 0.01) { return vec4f(0.0); }
      return vec4f(col.rgb, fa);
    }
  }
}

// ─── Interaction functions ───
${interactionFunctions}

fn dispatchInteraction3D(itype: u32, uvA: vec2f, uvB: vec2f, colorA: vec4f, colorB: vec4f, time: f32) -> vec4f {
  switch (itype) {
${interactionSwitchCases}
    default: { return vec4f(0.0); }
  }
}

// ─── Main 3D compute kernel ───
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let pixel = gid.xy;
  if (pixel.x >= u32(frame.resolution.x) || pixel.y >= u32(frame.resolution.y)) { return; }
  let idx = pixel.y * u32(frame.resolution.x) + pixel.x;
  hitIdBuf[idx] = 0xFFFFFFFFu;

  let fieldCount = arrayLength(&superFields);

  // ─── Generate perspective ray ───
  let uv_screen = (vec2f(f32(pixel.x), f32(pixel.y)) + 0.5) / frame.resolution * 2.0 - 1.0;
  let aspect = frame.resolution.x / frame.resolution.y;
  let halfFov = frame.cam3Dfov * 0.5;
  var dir = normalize(vec3f(
    uv_screen.x * aspect * tan(halfFov),
    -uv_screen.y * tan(halfFov),
    -1.0
  ));
  // Rotate ray by camera pitch (X) and yaw (Y)
  dir = rotateX3(dir, frame.cam3Ddir.x);
  dir = rotateY3(dir, frame.cam3Ddir.y);
  let origin = frame.cam3Dpos;

  // ─── Superposition accumulation with OIT ───
  var resultColor = vec3f(0.0);
  var resultPresence: f32 = 0.0;
  // OIT accumulators — weighted blended order-independent transparency
  var oitColorSum = vec3f(0.0);
  var oitWeightSum: f32 = 0.0;
  var oitTransmittance: f32 = 1.0;
  var overlapCount = 0u;
  var overlapIndices: array<u32, 8>;
  var hitIdx = 0xFFFFFFFFu;

  for (var i = 0u; i < fieldCount; i++) {
    let f = superFields[i];

    // Bounding sphere cull: quick rejection
    let pos3 = vec3f(f.posScaleRot.xy, f.pos3D.x);
    let scale = max(f.posScaleRot.z, 0.001);
    let st = u32(f.shapeDims.x);
    var boundRadius: f32;
    if (st == 1u) {
      boundRadius = length(vec2f(f.shapeDims.y, f.shapeDims.z)) * 0.5 * scale * 1.2;
    } else {
      boundRadius = f.shapeDims.y * scale * 1.2;
    }
    let toField = pos3 - origin;
    let proj = dot(toField, dir);
    let perpDist = length(toField - dir * proj);
    if (perpDist > boundRadius && proj > -boundRadius) {
      if (perpDist > boundRadius * 2.0) { continue; }
    }

    // Ray-field intersection
    let t = rayFieldIntersect(origin, dir, f);
    if (t < 0.0) { continue; }

    let hitWorld = origin + dir * t;
    let uv = hitLocalUV(hitWorld, f);
    let sdf = hitSDF(hitWorld, f);

    // Behind: merge OIT accumulated color with superimposed result
    let oitSoFar = select(vec3f(0.0), oitColorSum / max(oitWeightSum, 0.001), oitWeightSum > 0.001);
    let oitAlphaSoFar = 1.0 - oitTransmittance;
    let behindColor = mix(oitSoFar, resultColor, resultPresence);
    let behindAlpha = oitAlphaSoFar + resultPresence * oitTransmittance;
    let behind = vec4f(behindColor, behindAlpha);
    let visual = superVisual3D(uv, sdf, f, frame.time, behind);

    if (visual.a > 0.01) {
      if (i32(f.shapeDims.w) < 0) {
        let superimpose = f.pos3D.w; // 0.0 = OIT, 1.0 = legacy overwrite
        if (superimpose > 0.5) {
          // Legacy superimposition: last-write-wins overwrite
          resultColor = visual.rgb;
          resultPresence = max(resultPresence, visual.a);
        } else {
          // OIT: depth-weighted blended accumulation
          let w = visual.a * max(0.01, min(1.0, 100.0 / (t * t + 1.0)));
          oitColorSum += visual.rgb * w;
          oitWeightSum += w;
          oitTransmittance *= (1.0 - visual.a);
        }
      }
      if (overlapCount < 8u) {
        overlapIndices[overlapCount] = i;
        overlapCount++;
      }
    }
  }

  // ─── Merge OIT result with any superimposed fields ───
  if (oitWeightSum > 0.001) {
    let oitColor = oitColorSum / oitWeightSum;
    let oitAlpha = 1.0 - oitTransmittance;
    resultColor = mix(oitColor, resultColor, resultPresence);
    resultPresence = oitAlpha + resultPresence * oitTransmittance;
  }

  if (overlapCount == 0u) { return; }

  // ─── Hit testing: topmost screen-visible field (skip noHit = -2) ───
  for (var hi = overlapCount; hi > 0u; hi--) {
    let hfi = overlapIndices[hi - 1u];
    if (i32(superFields[hfi].shapeDims.w) == -1) {
      hitIdx = hfi;
      break;
    }
  }

  // ─── 3D lighting from SDF normal ───
  if (hitIdx != 0xFFFFFFFFu) {
    let f = superFields[hitIdx];
    let lighting = f.extraParams.z;
    if (lighting > 0.0) {
      let hitWorld = origin + dir * rayFieldIntersect(origin, dir, f);
      let pos3 = vec3f(f.posScaleRot.xy, f.pos3D.x);
      let scale = max(f.posScaleRot.z, 0.001);
      var localHit = hitWorld - pos3;
      localHit = rotateY3(localHit, -f.pos3D.z);
      localHit = rotateX3(localHit, -f.pos3D.y);
      localHit = rotateZ3(localHit, -f.posScaleRot.w);
      localHit /= scale;
      let normal = sdfNormal3(localHit, 0.0, u32(f.shapeDims.x), f.shapeDims.yz);
      let lightDir = normalize(vec3f(0.3, 1.0, 0.5));
      let diff = max(dot(normal, lightDir), 0.0);
      let ambient = 0.3;
      let lit = ambient + diff * (1.0 - ambient);
      resultColor *= mix(1.0, lit, lighting);
    }
  }

  // ─── Write hit ID for click detection ───
  hitIdBuf[idx] = hitIdx;

  // ─── Write to accumBuf with alpha blend ───
  let existing = accumBuf[idx];
  accumBuf[idx] = vec4f(
    mix(existing.rgb, resultColor, resultPresence * (1.0 - existing.a)),
    existing.a + resultPresence * (1.0 - existing.a),
  );
}
`
}

/**
 * Propagation compute shader — spreads interaction results beyond the overlap zone.
 * Reads ixBuf (color) and ixTypeBuf (propagation type ID) from the uber-shader,
 * samples radially around each pixel, and dispatches to the appropriate propagation
 * function based on the source pixel's type.
 *
 * Default behavior (type 0xFFFFFFFF / no type): "rising steam" — samples below,
 * spreads upward with turbulent wobble.
 *
 * Custom propagation types are registered at runtime via define_propagation.
 * Each provides: fn propagation_NAME(srcColor: vec4f, offset: vec2f, dist: f32, time: f32) -> vec4f
 */
export function buildPropagationComputeShader(propagationTypes?: PropagationEntry[]): string {
  const types = propagationTypes || []

  // Deduplicate by name
  const seenNames = new Set<string>()
  const dedupedTypes = types.filter(t => {
    if (seenNames.has(t.name)) return false
    seenNames.add(t.name)
    return true
  })

  // Generate propagation function definitions
  const propagationFunctions = dedupedTypes.map(t => t.wgsl).join('\n\n')

  // Generate switch cases for propagation dispatch
  const switchCases = dedupedTypes.map(t =>
    `    case ${t.id}u: { return propagation_${t.name}(srcColor, offset, dist, time); }`
  ).join('\n')

  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

@group(1) @binding(0) var<storage, read> ixBuf: array<vec4f>;
@group(1) @binding(1) var<storage, read_write> accumBuf: array<vec4f>;
@group(1) @binding(2) var<storage, read> ixTypeBuf: array<u32>;

${SHADER_UTILITIES}

fn propHash(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ─── Built-in "steam" propagation (default) ───
fn propagation_steam(srcColor: vec4f, offset: vec2f, dist: f32, time: f32) -> vec4f {
  // Only propagate upward (source is below → offset.y > 0)
  if (offset.y < 0.0) { return vec4f(0.0); }
  let t = dist / 200.0;
  if (t > 1.0) { return vec4f(0.0); }
  let falloff = 1.0 - t * t;
  return vec4f(srcColor.rgb * falloff, srcColor.a * falloff);
}

// ─── Custom propagation functions (dynamically generated) ───
${propagationFunctions}

// ─── Propagation dispatch ───
fn dispatchPropagation(ptype: u32, srcColor: vec4f, offset: vec2f, dist: f32, time: f32) -> vec4f {
  switch (ptype) {
${switchCases}
    default: {
      return propagation_steam(srcColor, offset, dist, time);
    }
  }
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let px = f32(gid.x);
  let py = f32(gid.y);
  if (px >= frame.resolution.x || py >= frame.resolution.y) { return; }

  let stride = u32(frame.resolution.x);
  let idx = gid.y * stride + gid.x;
  let resX = i32(frame.resolution.x);
  let resY = i32(frame.resolution.y);

  var spreadColor = vec3f(0.0);
  var spreadAlpha: f32 = 0.0;

  // ─── Radial sampling: 4 directions × 8 steps = 32 samples ───
  // Reduced from 8×16 (128) to stay Safari-friendly. Wobble provides coverage.
  let maxDist: f32 = 200.0;
  let steps: i32 = 8;
  let stepSize: f32 = maxDist / f32(steps);
  let numDirs: i32 = 4;

  for (var d: i32 = 0; d < numDirs; d++) {
    let angle = f32(d) * 6.28318 / f32(numDirs);
    let dir = vec2f(cos(angle), sin(angle));

    for (var s: i32 = 1; s <= steps; s++) {
      let dist = f32(s) * stepSize;

      // Turbulent wobble perpendicular to sample direction
      let perpDir = vec2f(-dir.y, dir.x);
      let seed1 = vec2f(px * 0.07 + frame.time * 1.3, py * 0.09 + f32(s) * 3.7 + f32(d) * 11.0);
      let seed2 = vec2f(px * 0.13 - frame.time * 0.9, py * 0.05 + f32(s) * 7.1 + f32(d) * 5.0);
      let wobble = (propHash(seed1) - 0.5) * 2.0 + (propHash(seed2) - 0.5);
      let wobbleAmt = dist * 0.15;

      let srcPos = vec2f(px, py) + dir * dist + perpDir * wobble * wobbleAmt;
      let srcXi = clamp(i32(srcPos.x), 0, resX - 1);
      let srcYi = clamp(i32(srcPos.y), 0, resY - 1);

      let srcIdx = u32(srcYi) * stride + u32(srcXi);
      let samp = ixBuf[srcIdx];

      if (samp.a > 0.01) {
        let ptype = ixTypeBuf[srcIdx];
        // offset = vector from source to current pixel (flip sign: source is at srcPos, we're at px,py)
        let offset = vec2f(px - srcPos.x, srcPos.y - py); // positive y = source below = upward
        let result = dispatchPropagation(ptype, samp, offset, dist, frame.time);
        if (result.a > 0.005) {
          spreadColor = max(spreadColor, result.rgb);
          spreadAlpha = max(spreadAlpha, result.a);
        }
      }
    }
  }

  if (spreadAlpha > 0.005) {
    let existing = accumBuf[idx];
    accumBuf[idx] = vec4f(
      existing.rgb + spreadColor * spreadAlpha,
      max(existing.a, spreadAlpha),
    );
  }
}
`
}

// ─── Post-processing compute shader ───
// Reads from accumBuf, applies bloom + ACES tone mapping + vignette, writes back.
// Single-pass approximate bloom using 13-tap cross-shaped kernel.

export function buildPostProcessComputeShader(): string {
  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

struct PostProcessUniforms {
  bloomIntensity: f32,
  bloomThreshold: f32,
  vignetteStrength: f32,
  vignetteRadius: f32,
  exposure: f32,
  _pad: f32,
  lightDir: vec2f,
  lightIntensity: f32,
  _pad2: f32,
  _pad3: f32,
  _pad4: f32,
};
@group(0) @binding(1) var<uniform> pp: PostProcessUniforms;

@group(1) @binding(0) var<storage, read> accumIn: array<vec4f>;
@group(1) @binding(1) var<storage, read_write> postOut: array<vec4f>;

// ACES filmic tone mapping
fn acesToneMap(x: vec3f) -> vec3f {
  let a = vec3f(2.51);
  let b = vec3f(0.03);
  let c = vec3f(2.43);
  let d = vec3f(0.59);
  let e = vec3f(0.14);
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let px = f32(gid.x);
  let py = f32(gid.y);
  if (px >= frame.resolution.x || py >= frame.resolution.y) { return; }

  let stride = u32(frame.resolution.x);
  let resX = i32(frame.resolution.x);
  let resY = i32(frame.resolution.y);
  let idx = gid.y * stride + gid.x;

  let center = accumIn[idx];

  var color = center.rgb;

  // ─── Bloom: 13-tap cross kernel sampling bright pixels ───
  if (pp.bloomIntensity > 0.001) {
    var bloomAccum = vec3f(0.0);
    let offsets = array<i32, 6>(1, 2, 4, 8, 16, 32);
    let weights = array<f32, 6>(0.25, 0.2, 0.15, 0.1, 0.06, 0.03);
    let thresh = vec3f(pp.bloomThreshold);

    for (var bi = 0; bi < 6; bi++) {
      let off = offsets[bi];
      let w = weights[bi];

      // Horizontal samples
      let lx = clamp(i32(gid.x) - off, 0, resX - 1);
      let rx = clamp(i32(gid.x) + off, 0, resX - 1);
      let sL = accumIn[gid.y * stride + u32(lx)].rgb;
      let sR = accumIn[gid.y * stride + u32(rx)].rgb;

      // Vertical samples
      let uy = clamp(i32(gid.y) - off, 0, resY - 1);
      let dy_ = clamp(i32(gid.y) + off, 0, resY - 1);
      let sU = accumIn[u32(uy) * stride + gid.x].rgb;
      let sD = accumIn[u32(dy_) * stride + gid.x].rgb;

      // Threshold — only accumulate bright parts
      bloomAccum += max(sL - thresh, vec3f(0.0)) * w;
      bloomAccum += max(sR - thresh, vec3f(0.0)) * w;
      bloomAccum += max(sU - thresh, vec3f(0.0)) * w;
      bloomAccum += max(sD - thresh, vec3f(0.0)) * w;
    }

    color += bloomAccum * pp.bloomIntensity;
  }

  // ─── Exposure ───
  color *= pp.exposure;

  // ─── ACES tone mapping ───
  color = acesToneMap(color);

  // ─── Vignette ───
  if (pp.vignetteStrength > 0.001) {
    let uv = vec2f(px / frame.resolution.x, py / frame.resolution.y);
    let centeredUV = uv - 0.5;
    let dist = length(centeredUV) * 2.0;
    let vig = 1.0 - smoothstep(pp.vignetteRadius, pp.vignetteRadius + 0.5, dist) * pp.vignetteStrength;
    color *= vig;
  }

  postOut[idx] = vec4f(color, center.a);
}
`
}

// ─── GPU Particle System ───

export const PARTICLE_STRIDE = 48 // 12 floats × 4 bytes = 48 bytes per particle
export const MAX_PARTICLES = 4096

/**
 * Particle update compute shader — advances particle physics each frame.
 * Reads/writes particle buffer: each particle = 12 floats:
 *   [posX, posY, velX, velY, colorR, colorG, colorB, alpha, life, maxLife, size, flags]
 * flags: bit 0 = alive
 */
export function buildParticleUpdateComputeShader(): string {
  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

struct Particle {
  pos: vec2f,
  vel: vec2f,
  color: vec4f,
  life: f32,
  maxLife: f32,
  size: f32,
  flags: f32,
};

@group(1) @binding(0) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&particles)) { return; }

  var p = particles[i];
  if (p.flags < 0.5) { return; } // dead particle

  let dt = 1.0 / 60.0; // fixed timestep

  // Apply velocity
  p.pos += p.vel * dt;

  // Gravity (gentle downward pull)
  p.vel.y -= 20.0 * dt;

  // Drag
  p.vel *= 0.99;

  // Age
  p.life -= dt;
  if (p.life <= 0.0) {
    p.flags = 0.0; // kill particle
  }

  // Fade alpha based on remaining life
  let lifeRatio = clamp(p.life / max(p.maxLife, 0.001), 0.0, 1.0);
  p.color.a = lifeRatio;

  // Shrink near death
  p.size = max(p.size * (0.5 + 0.5 * lifeRatio), 0.1);

  particles[i] = p;
}
`
}

/**
 * Particle render compute shader — draws particles into the accumulation buffer.
 * Each particle renders as a soft circle at its grid-space position.
 */
export function buildParticleRenderComputeShader(): string {
  return /* wgsl */`
${FRAME_UNIFORM_STRUCT}

struct ParticleR {
  pos: vec2f,
  vel: vec2f,
  color: vec4f,
  life: f32,
  maxLife: f32,
  size: f32,
  flags: f32,
};

@group(1) @binding(0) var<storage, read> particles: array<ParticleR>;
@group(1) @binding(1) var<storage, read_write> accumBuf: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let pi = gid.x;
  if (pi >= arrayLength(&particles)) { return; }

  let p = particles[pi];
  if (p.flags < 0.5 || p.color.a < 0.01) { return; }

  // Convert particle grid position to pixel position
  let aspect = frame.resolution.x / frame.resolution.y;
  let gridRange = vec2f(frame.gridSize) / frame.zoom;

  var pixelCenter: vec2f;
  if (aspect > 1.0) {
    pixelCenter.x = ((p.pos.x - frame.camera.x) / (gridRange.x * aspect) + 0.5) * frame.resolution.x;
    pixelCenter.y = (0.5 - (p.pos.y - frame.camera.y) / gridRange.y) * frame.resolution.y;
  } else {
    pixelCenter.x = ((p.pos.x - frame.camera.x) / gridRange.x + 0.5) * frame.resolution.x;
    pixelCenter.y = (0.5 - (p.pos.y - frame.camera.y) / (gridRange.y / aspect)) * frame.resolution.y;
  }

  // Pixel radius from grid-space size
  let pixelSize = p.size * frame.resolution.x / (gridRange.x * select(1.0, aspect, aspect > 1.0));

  let minX = max(i32(pixelCenter.x - pixelSize - 1.0), 0);
  let maxX = min(i32(pixelCenter.x + pixelSize + 1.0), i32(frame.resolution.x) - 1);
  let minY = max(i32(pixelCenter.y - pixelSize - 1.0), 0);
  let maxY = min(i32(pixelCenter.y + pixelSize + 1.0), i32(frame.resolution.y) - 1);

  let stride = u32(frame.resolution.x);

  for (var py = minY; py <= maxY; py++) {
    for (var px = minX; px <= maxX; px++) {
      let d = length(vec2f(f32(px), f32(py)) - pixelCenter);
      let alpha = smoothstep(pixelSize, pixelSize * 0.3, d) * p.color.a;
      if (alpha < 0.01) { continue; }

      let bufIdx = u32(py) * stride + u32(px);
      let existing = accumBuf[bufIdx];
      // Additive blend for glowing particles
      accumBuf[bufIdx] = vec4f(
        existing.rgb + p.color.rgb * alpha,
        max(existing.a, alpha),
      );
    }
  }
}
`
}

// ─── GPU Step Hook Compute Shader ───
// Dispatches one thread per field. Each hook function can read all fields
// and read/write its own field's state. World config lives on field 0.
// Fully GPU-sandboxed — no JS, DOM, network, or filesystem access.

export function buildStepHookComputeShader(hooks: Array<{ id: string; wgsl: string }>): string {
  // Sort hooks and collect their function bodies
  const hookFunctions = hooks.map(h => h.wgsl).join('\n\n')
  const hookCalls = hooks.map(h => `  hook_${h.id}(idx);`).join('\n')

  return /* wgsl */`
// ─── Step Hook Compute Shader ───

struct FieldGPU {
  posScaleRot: vec4f,      // x, y, scale, rotation
  shapeDims: vec4f,        // shapeType, dim1, dim2, renderTargetId
  color: vec4f,            // r, g, b, a
  visualAndParams: vec4f,  // visualType, param0, param1, param2
  extraParams: vec4f,      // param3, bidirectionalBehind, lighting, specular
  pos3D: vec4f,            // z, rotX, rotY, reserved
};

struct FieldStepState {
  velocity: vec4f,         // vx, vy, vz, vr (angular velocity)
  state0: vec4f,           // user-defined slots 0-3
  state1: vec4f,           // user-defined slots 4-7
  flags: vec4f,            // x=alive (0/1), y=age (seconds), z=tag0, w=tag1
};

struct StepUniforms {
  dt: f32,
  time: f32,
  mouseX: f32,
  mouseY: f32,
  mouseDown: f32,
  keyUp: f32,
  keyDown: f32,
  keyLeft: f32,
  keyRight: f32,
  keySpace: f32,
  keyShift: f32,
  fieldCount: u32,
  gridSize: f32,
  custom0: f32,
  custom1: f32,
  custom2: f32,
};

@group(0) @binding(0) var<storage, read_write> superFields: array<FieldGPU>;
@group(0) @binding(1) var<storage, read_write> stepStates: array<FieldStepState>;
@group(0) @binding(2) var<uniform> step: StepUniforms;

// ─── Step Hook Helper Functions ───

// Distance between two fields (center-to-center)
fn fieldDist(a: u32, b: u32) -> f32 {
  return distance(superFields[a].posScaleRot.xy, superFields[b].posScaleRot.xy);
}

// Direction from field a toward field b (normalized)
fn fieldDir(a: u32, b: u32) -> vec2f {
  let d = superFields[b].posScaleRot.xy - superFields[a].posScaleRot.xy;
  let len = length(d);
  if (len < 0.001) { return vec2f(0.0); }
  return d / len;
}

// Check if a field is alive
fn isAlive(i: u32) -> bool {
  return stepStates[i].flags.x > 0.5;
}

// Kill a field (set alive=0, hide it)
fn kill(i: u32) {
  stepStates[i].flags.x = 0.0;
  superFields[i].color.a = 0.0;
}

// Activate a dead field (find first dead field starting from startIdx)
fn spawn(startIdx: u32) -> u32 {
  for (var i = startIdx; i < step.fieldCount; i++) {
    if (stepStates[i].flags.x < 0.5) {
      stepStates[i].flags.x = 1.0;
      stepStates[i].flags.y = 0.0;
      stepStates[i].velocity = vec4f(0.0);
      superFields[i].color.a = 1.0;
      return i;
    }
  }
  return 0xFFFFFFFFu;
}

// Get effective radius of a field (circle or rect approximation)
fn fieldRadius(i: u32) -> f32 {
  let f = superFields[i];
  let s = max(f.posScaleRot.z, 0.001);
  if (f.shapeDims.x < 0.5) { return f.shapeDims.y * s; }
  return max(f.shapeDims.y, f.shapeDims.z) * 0.5 * s;
}

// Check if two fields overlap (bounding circle test)
fn overlaps(a: u32, b: u32) -> bool {
  return fieldDist(a, b) < fieldRadius(a) + fieldRadius(b);
}

// Clamp position to grid boundaries
fn clampToGrid(pos: vec2f) -> vec2f {
  return clamp(pos, vec2f(0.0), vec2f(step.gridSize));
}

// Wrap position around grid boundaries
fn wrapGrid(pos: vec2f) -> vec2f {
  let gs = step.gridSize;
  return vec2f(
    pos.x - gs * floor(pos.x / gs),
    pos.y - gs * floor(pos.y / gs),
  );
}

${SHADER_UTILITIES}

// ─── User Hook Functions ───

${hookFunctions}

// ─── Main Entry Point ───

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;

  // Phase 1: ALL threads restore persistent positions before any hook reads other fields.
  // This must happen before the barrier — no early returns allowed above it.
  if (idx < step.fieldCount && stepStates[idx].flags.x > 0.5) {
    let persistX = stepStates[idx].flags.z;
    let persistY = stepStates[idx].flags.w;
    if (persistX != 0.0 || persistY != 0.0) {
      superFields[idx].posScaleRot.x = persistX;
      superFields[idx].posScaleRot.y = persistY;
    } else {
      // First frame: seed persistent position from CPU
      stepStates[idx].flags.z = superFields[idx].posScaleRot.x;
      stepStates[idx].flags.w = superFields[idx].posScaleRot.y;
    }
  }

  // Barrier: all positions are now restored — hooks can safely read any field's position.
  storageBarrier();

  // Phase 2: skip out-of-range and dead threads
  if (idx >= step.fieldCount) { return; }
  if (stepStates[idx].flags.x < 0.5) { return; }

  // Increment age
  stepStates[idx].flags.y += step.dt;

  // Execute user hooks in order
${hookCalls}

  // Apply velocity → position integration (component-wise, no full-struct write-back).
  // Writing only the fields that change avoids round-tripping the entire 24-float struct
  // through a read-modify-write cycle, which prevents precision drift and unintended
  // modification of fields like color/visual that should stay as the CPU uploaded them.
  let vel = stepStates[idx].velocity;
  let velMag = abs(vel.x) + abs(vel.y) + abs(vel.z) + abs(vel.w);
  if (velMag > 0.0) {
    superFields[idx].posScaleRot.x += vel.x * step.dt;
    superFields[idx].posScaleRot.y += vel.y * step.dt;
    superFields[idx].pos3D.x += vel.z * step.dt;
    superFields[idx].posScaleRot.w += vel.w * step.dt;

    // Persist final position for next frame
    stepStates[idx].flags.z = superFields[idx].posScaleRot.x;
    stepStates[idx].flags.w = superFields[idx].posScaleRot.y;
  }
}
`
}

// Backward-compatible exports
export function buildFragmentShader(injectedWgsl?: string): string {
  if (injectedWgsl) {
    return buildEffectFragmentShader(injectedWgsl)
  }
  return buildBaseFragmentShader()
}

export const fragmentShaderSource = buildBaseFragmentShader()
