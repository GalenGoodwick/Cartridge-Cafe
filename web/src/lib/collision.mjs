// collision.mjs — the player cannot pass through solid cathedral geometry.
//
// JS MIRROR of the shader's vg_map solids (the CINDERFELL mod_cf_h one-truth
// discipline): columns, Watchers, the reliquary, the back wall, and the world
// bounds. It MUST stay in sync with vigil-cartridge LIB `vg_map` — same numbers.
// Collision is resolved at the walking plane (y ≈ 1); the central chasm (|x|<3)
// is intentionally NOT solid — you can step over it onto a lit pane, and fall if
// there is none (that is footing, handled in the mechanic).

// Column rows repeat every 6 in z (rows at z = 2,8,14,20), on both sides x=±6.
function nearestColumnZ(z) {
  return Math.min(Math.max(Math.round((z - 2) / 6), 0), 4) * 6 + 2
}

const WATCHERS = [[-6, 8], [6, 14], [-6, 20]]

/** Is (x,z) inside a solid obstacle or outside the walkable bounds, at y≈1? */
export function solidAt(x, z) {
  // world bounds: ledges span x∈[-9,9]; nave z∈[0,25.5] (back wall at z=26)
  if (Math.abs(x) > 9 || z < 0 || z > 25.5) return true
  // columns at x=±6, nearest row in z (0.9 footprint)
  const cz = nearestColumnZ(z)
  if (Math.hypot(x - 6, z - cz) < 0.9 || Math.hypot(x + 6, z - cz) < 0.9) return true
  // Watchers
  for (const [wx, wz] of WATCHERS) if (Math.hypot(x - wx, z - wz) < 0.8) return true
  // reliquary at (0, 24)
  if (Math.abs(x) < 1.2 && Math.abs(z - 24) < 1.0) return true
  return false
}

/**
 * Resolve a move from (ox,oz) → (nx,nz) against the solids: take the full move
 * if clear; else slide along whichever axis is clear (so you scrape past a
 * column instead of sticking); else stay put. Returns the resolved [x, z].
 * `extra` is an optional predicate for DYNAMIC solids (e.g. a locked door).
 */
export function resolveMove(ox, oz, nx, nz, extra) {
  const blocked = (x, z) => solidAt(x, z) || (extra ? extra(x, z) : false)
  if (!blocked(nx, nz)) return [nx, nz]
  if (!blocked(nx, oz)) return [nx, oz] // slide along x
  if (!blocked(ox, nz)) return [ox, nz] // slide along z
  return [ox, oz]                        // fully blocked
}
