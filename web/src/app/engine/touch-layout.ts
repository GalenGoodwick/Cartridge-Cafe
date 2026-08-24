/** TOUCH-ZONE LAYOUT — a pure function, not a pile of magic pixels.
 *
 *  Born from Galen's diagnosis (Aug 23, first real phone test): the stick and
 *  A/B buttons overlapped at real mobile widths because their positions were
 *  hand-written CSS constants nobody could REASON about — "an overarching
 *  spatial reasoning disability for AI in our source code… no mathematical
 *  visioning method for straight UI design."
 *
 *  The method, demonstrated: layout is COMPUTED from the viewport by one pure
 *  function, collision-free BY CONSTRUCTION (buttons stack vertically when the
 *  row doesn't fit), and the unit suite PROVES non-overlap across the real
 *  device matrix (SE portrait → ultrawide). An AI designs this UI by running
 *  the math, not by imagining pixels. See ui-solver.ts for the same law
 *  applied to world UI panels.
 */

export interface Zone { x: number; y: number; w: number; h: number }
export interface TouchLayout {
  scale: number
  stick: Zone            // the thumb-stick footprint
  knob: number           // knob diameter
  buttons: Zone[]        // A, B — in order
  stacked: boolean       // true when A/B stack vertically (narrow viewports)
}

// design constants at scale 1 (a ~430px-wide phone and up)
const STICK = 112, KNOB = 48, BTN = 64, GAP = 16, EDGE = 20, BOTTOM = 32

/** Compute every touch-zone rect for a viewport. Guarantees:
 *   - stick and buttons never overlap (≥ GAP clear between them)
 *   - everything inside the viewport with EDGE margins
 *   - zones shrink (never below 0.7×) before they stack */
export function layoutTouchZones(vw: number, vh: number): TouchLayout {
  // shrink toward 0.7× as width tightens below the reference
  const scale = Math.max(0.7, Math.min(1, vw / 430))
  const stickS = Math.round(STICK * scale)
  const btnS = Math.round(BTN * scale)
  const gapS = Math.round(GAP * scale)
  const bottom = Math.round(BOTTOM * scale)

  const stick: Zone = { x: EDGE, y: vh - bottom - stickS, w: stickS, h: stickS }

  // try the ROW: [A][gap][B] right-aligned; stack if it would invade the stick
  const rowW = btnS * 2 + gapS
  const rowX = vw - EDGE - rowW
  const stacked = rowX < stick.x + stick.w + gapS
  let buttons: Zone[]
  if (!stacked) {
    const by = vh - bottom - btnS - Math.round(8 * scale)   // slight lift over the stick line
    buttons = [
      { x: rowX, y: by, w: btnS, h: btnS },
      { x: rowX + btnS + gapS, y: by, w: btnS, h: btnS },
    ]
  } else {
    // COLUMN: B above A, right edge — narrow portrait always fits
    const bx = vw - EDGE - btnS
    buttons = [
      { x: bx, y: vh - bottom - btnS, w: btnS, h: btnS },
      { x: bx, y: vh - bottom - btnS * 2 - gapS, w: btnS, h: btnS },
    ]
  }
  return { scale, stick, knob: Math.round(KNOB * scale), buttons, stacked }
}

/** The non-overlap proof helper — used by the unit suite, usable by any AI
 *  checking a layout before shipping it. */
export function zonesOverlap(a: Zone, b: Zone, clearance = 0): boolean {
  return a.x < b.x + b.w + clearance && b.x < a.x + a.w + clearance
      && a.y < b.y + b.h + clearance && b.y < a.y + a.h + clearance
}
