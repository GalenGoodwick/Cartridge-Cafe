// collision.mjs — the player is confined to the central WALKWAY and cannot pass
// through its walls, the reliquary, or off its ends. Mirrors the shader's vg_map
// solids (the CINDERFELL mod_cf_h one-truth); keep the numbers in sync.
//
// The walkway is narrow (|x| ≤ 2.6), flanked by colonnade walls. The two GAPS in
// it are NOT handled here — they are dynamic (crossable only where a Watcher's
// gaze lights the pane), so the mechanic gates them via `gapBlocked` (vigil-puzzle).

/** Is (x,z) a solid wall / off the walkway / inside the reliquary, at y≈1? */
export function solidAt(x, z) {
  if (z < -1 || z > 25.5) return true                          // ends of the nave
  if (Math.abs(x) > 2.6) return true                           // walkway walls (colonnade sides)
  if (Math.abs(x) < 1.2 && Math.abs(z - 24) < 1.0) return true // the reliquary ark
  return false
}

/**
 * Resolve a move (ox,oz)→(nx,nz): take it if clear; else slide along a clear
 * axis; else stay. `extra` is an optional predicate for DYNAMIC solids — the
 * mechanic passes a gap-gate here so an unlit gap reads as a hole you can't enter.
 */
export function resolveMove(ox, oz, nx, nz, extra) {
  const blocked = (x, z) => solidAt(x, z) || (extra ? extra(x, z) : false)
  if (!blocked(nx, nz)) return [nx, nz]
  if (!blocked(nx, oz)) return [nx, oz]
  if (!blocked(ox, nz)) return [ox, nz]
  return [ox, oz]
}
