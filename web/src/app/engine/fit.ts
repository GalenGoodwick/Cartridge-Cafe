// THE UNIFIED WORLD — rung 2: the FIT facet as pure math (DESIGN-unified-world.md).
//
// The FitShader lesson made reusable: a visual must KNOW ITS OWN SHAPE and
// recompose, never squish/crop blindly. This module is the one place that math
// lives — pure, backend-agnostic. A WGSL/GLSL shader, the field renderer, and a
// DOM tenant all express the same policy through these numbers:
//
//   · isotropic — divide both axes by min(w,h): 1 unit = same length on both
//     axes, so circles stay circles; the long axis sees MORE world, not a
//     stretched world (the cover-camera, honestly).
//   · cover     — content rect scaled to FILL the box (crop the overflow axis).
//   · contain   — content rect scaled to FIT inside (letterbox the short axis).
//   · stretch   — fill both axes, distortion accepted (explicit opt-in only).
//
// Shader side: uniforms from fitUniforms() → uv = (fc - 0.5*res) * scale + offset.
// DOM/canvas side: coverRect()/containRect() → position the content box.
// The instance side: fitWhenMatches() culls per-viewport (the calculated
// instance predicate — same semantics as the validator's FitWhen).

import type { AspectPolicy, FitWhen } from './world-config'

export type Rect = { x: number; y: number; w: number; h: number }

/** Does a viewport satisfy a fit when-clause? (undefined clause = always.) */
export function fitWhenMatches(when: FitWhen | undefined, vp: { w: number; h: number }): boolean {
  if (!when) return true
  if (when.minW != null && vp.w < when.minW) return false
  if (when.maxW != null && vp.w > when.maxW) return false
  if (when.minH != null && vp.h < when.minH) return false
  if (when.maxH != null && vp.h > when.maxH) return false
  return true
}

/** COVER: scale content (cw×ch) to FILL box (bw×bh), centered; overflow crops.
 *  Returns the content's rect in box coordinates (may exceed the box). */
export function coverRect(cw: number, ch: number, bw: number, bh: number): Rect {
  const s = Math.max(bw / cw, bh / ch)
  const w = cw * s, h = ch * s
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h }
}

/** CONTAIN: scale content to FIT inside the box, centered; letterboxes. */
export function containRect(cw: number, ch: number, bw: number, bh: number): Rect {
  const s = Math.min(bw / cw, bh / ch)
  const w = cw * s, h = ch * s
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h }
}

/** THE SHADER-SIDE NUMBERS — one uniform set that expresses every policy.
 *  uv = (fragCoord - 0.5*res) * scale  → centered composition coordinates:
 *   · isotropic: scale = 1/min(w,h) on BOTH axes (circles round; long axis sees more)
 *   · stretch:   scale = 1/w, 1/h (unit square forced onto the box — distorts)
 *   · cover/contain against a CONTENT aspect `contentAspect` (w/h): the unit
 *     content square is scaled so it fills (cover) or fits (contain) the box.
 *  Returns { scaleX, scaleY } to multiply centered pixels by. */
export function fitUniforms(policy: AspectPolicy, boxW: number, boxH: number, contentAspect = 1): { scaleX: number; scaleY: number } {
  const w = Math.max(1, boxW), h = Math.max(1, boxH)
  switch (policy) {
    case 'isotropic': {
      const s = 1 / Math.min(w, h)
      return { scaleX: s, scaleY: s }
    }
    case 'stretch':
      return { scaleX: 1 / w, scaleY: 1 / h }
    case 'cover': {
      // FILL the box: pixels-per-content-unit = max(w/a, h), so units-per-pixel
      // is the MIN of (a/w, 1/h) — content drawn big, overflow cropped.
      const s = Math.min(contentAspect / w, 1 / h)
      return { scaleX: s / contentAspect, scaleY: s }
    }
    case 'contain': {
      // FIT inside: pixels-per-content-unit = min(w/a, h) → units-per-pixel is
      // the MAX — content drawn small enough to letterbox, never cropped.
      const s = Math.max(contentAspect / w, 1 / h)
      return { scaleX: s / contentAspect, scaleY: s }
    }
  }
}

/** Convenience: how much MORE world the long axis sees under isotropic fit —
 *  the honest cover-camera span (in short-side units) per axis. */
export function isotropicSpan(boxW: number, boxH: number): { spanX: number; spanY: number } {
  const m = Math.min(Math.max(1, boxW), Math.max(1, boxH))
  return { spanX: boxW / m, spanY: boxH / m }
}
