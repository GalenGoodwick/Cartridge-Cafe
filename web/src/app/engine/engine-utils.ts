// engine/engine-utils.ts — module-level helpers carved out of FieldEngine.tsx
// (DESIGN-fieldengine-carve.md, Phase 2). Pure moves, byte-identical bodies.
// NOTE: the icon-atlas cache (cafeIconCache + iconCacheSave/Load) stays in
// FieldEngine — component code assigns the `let` directly, and import bindings
// are read-only; converting to accessors would exceed a pure move.

import { DEFAULT_GRID_SIZE } from './types'

let fieldCounter = 0
export function genFieldId() {
  return `field_${++fieldCounter}_${Date.now()}`
}

let effectCounter = 0
export function genEffectId() {
  return `effect_${++effectCounter}_${Date.now()}`
}

// Reusable Set for per-frame interaction key cleanup (avoids allocation every frame)
export const _reusableKeySet = new Set<string>()

/** Convert screen pixel coordinates to float grid coordinates (no flooring) */
export function screenToGrid(
  screenX: number, screenY: number,
  canvasRect: DOMRect,
  camera: { x: number; y: number },
  zoom: number,
  gridSize: number = DEFAULT_GRID_SIZE
): { x: number; y: number } {
  const normX = (screenX - canvasRect.left) / canvasRect.width
  const normY = (screenY - canvasRect.top) / canvasRect.height
  const aspect = canvasRect.width / canvasRect.height
  const gridRange = gridSize / zoom

  if (aspect > 1) {
    return {
      x: camera.x + (normX - 0.5) * gridRange * aspect,
      y: camera.y + (normY - 0.5) * gridRange,
    }
  } else {
    return {
      x: camera.x + (normX - 0.5) * gridRange,
      y: camera.y + (normY - 0.5) * gridRange / aspect,
    }
  }
}

export const DEFAULT_HUES = [190, 30, 120, 280, 0, 60, 330, 210]

export function hueToRgba(hue: number): [number, number, number, number] {
  const h = hue / 360
  const s = 0.75
  const l = 0.6
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 1/6) { r = c; g = x }
  else if (h < 2/6) { r = x; g = c }
  else if (h < 3/6) { g = c; b = x }
  else if (h < 4/6) { g = x; b = c }
  else if (h < 5/6) { r = x; b = c }
  else { r = c; b = x }
  return [r + m, g + m, b + m, 1.0]
}

/** Wrap interaction WGSL for the field effect pipeline.
 *  Interaction shaders define `fn interactionEffect(coord, regionMin, regionMax, time, params) → vec4f`.
 *  This wrapper adapts it to `fn fieldEffect(...)` expected by the field pipeline. */
export function wrapInteractionWgsl(interactionWgsl: string): string {
  return `
// Per-pixel overlap mask: 1.0 where both parent fields' dilated presence overlaps, 0.0 elsewhere.
fn overlapMask(coord: vec2f) -> f32 {
  // textureSampleLevel: field effects run in a COMPUTE pipeline, where
  // textureSample (implicit derivatives) is illegal — this was the silent
  // killer that blacked out any world with an interaction effect.
  return textureSampleLevel(fieldMask, texSampler, coord / frame.gridSize, 0.0).r;
}

${interactionWgsl}

fn fieldEffect(coord: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let eff = interactionEffect(coord, regionMin, regionMax, time, params);
  let mask = overlapMask(coord);
  return vec4f(eff.rgb, eff.a * mask);
}`
}

/** Engine build marker — bump when engine-level fixes land, so a running tab
 *  can PROVE which build it holds (shown in the fault banner + console). */
export const ENGINE_BUILD = 'e5-fx-dbg'

// downloaded scenes, cached by playScene name — the vote reckoning flicks between
// five candidates, and this spares the network/DB on every re-hover. It caches the
// DOWNLOAD only; one scene runs at a time. Dev hot-reload deletes an entry on edit.
export const scenePreloadCache = new Map<string, unknown>()

// BREWED GLYPH — the player's cursor WGSL, wrapped to fill the hub shader's
// mod_playerglyph container (a no-op until swapped). Shared by the scene
// loader (overlay BEFORE the first compile — one compile per hub entry, no
// second stall) and the cafe:icon watcher (recompile only on a real change).
export const playerGlyphWgsl = (): string | null => {
  if (typeof window === 'undefined') return null
  const ic = (window as unknown as { __cafeIcon?: { wgsl?: string } }).__cafeIcon
  return typeof ic?.wgsl === 'string' && /fn\s+visual_glyph\s*\(/.test(ic.wgsl) ? ic.wgsl : null
}
export const wrapPlayerGlyph = (wgsl: string): string =>
  wgsl + '\nfn mod_playerglyph(uv: vec2f, t: f32) -> vec4f { return visual_glyph(uv, 0.0, vec4f(1.0), t, vec4f(0.0), vec4f(0.0)); }'
// OTHER players' glyphs arrive over presence and share ONE uber-shader — every
// function a glyph declares is renamed into its slot's namespace so two
// players' visual_glyph (and any helpers) can coexist. Slots pg0..pg2.
export const wrapOtherGlyph = (wgsl: string, slot: number): string => {
  let code = wgsl
  const names = new Set(Array.from(wgsl.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*\(/g), m => m[1]))
  for (const n of names) code = code.replace(new RegExp('\\b' + n + '\\b', 'g'), `${n}_pg${slot}`)
  return code + `\nfn mod_pg${slot}(uv: vec2f, t: f32) -> vec4f { return visual_glyph_pg${slot}(uv, 0.0, vec4f(1.0), t, vec4f(0.0), vec4f(0.0)); }`
}
