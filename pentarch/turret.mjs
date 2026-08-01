// turret.mjs — PENTARCH turrets: ARC EARNED BY PLACEMENT. Each FREE edge of the
// turret's tile grants a 72° firing sector centered on that edge's outward
// normal; adjacent free edges tile into one contiguous arc (36° half-widths meet
// exactly). An interior tile grants nothing — bury a turret and it is blind.
// Weapons SLOT ONTO turrets (two-layer mounts); the turret owns traverse.
// Render-free; DESIGN-ship-systems.md §2.
import { freeEdges } from './penta-core.mjs'

const ST = (2 * Math.PI) / 5
export const SECTOR_HALF = Math.PI / 5   // 36° — one pentagon edge's share

export const wrap = (a) => { let x = a % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; if (x < -Math.PI) x += 2 * Math.PI; return x }

/** arcOf(tiles, i) — the firing sectors tile i has EARNED: [{center, half}]
 *  (ship-frame angles). Empty array = blind mount (interior tile). */
export function arcOf(tiles, i) {
  const free = freeEdges(tiles).filter(f => f.i === i)
  return free.map(f => {
    const t = tiles[i]
    const center = t.th + Math.PI / 2 + (f.e + 0.5) * ST
    return { center: wrap(center), half: SECTOR_HALF }
  })
}

/** total sweep in radians (the designer's one-number readout for a mount) */
export const arcWidth = (sectors) => sectors.length * 2 * SECTOR_HALF

/** inArc(sectors, ang) — may the turret aim at ship-frame angle `ang`? */
export function inArc(sectors, ang) {
  return sectors.some(s => Math.abs(wrap(ang - s.center)) <= s.half + 1e-9)
}

/** clampToArc(sectors, ang) — the nearest permitted aim to `ang` */
export function clampToArc(sectors, ang) {
  if (!sectors.length) return null
  if (inArc(sectors, ang)) return wrap(ang)
  let best = null, bd = Infinity
  for (const s of sectors) {
    for (const edge of [s.center - s.half, s.center + s.half]) {
      const d = Math.abs(wrap(ang - edge))
      if (d < bd) { bd = d; best = wrap(edge) }
    }
  }
  return best
}

/** newMount(tiles, i, spec) — turret state on tile i.
 *  spec: { rate (rad/s traverse), weapon: {range, damage, energyPerShot, cooldown} | null } */
export function newMount(tiles, i, spec = {}) {
  const sectors = arcOf(tiles, i)
  const aim = sectors.length ? sectors[0].center : 0
  return { i, sectors, aim, rate: spec.rate ?? 2.5, weapon: spec.weapon ?? null, cd: 0 }
}

/** traverse(mount, targetAng, dt) — rate-limited swing toward the nearest
 *  permitted aim. (v1 simplification, documented: the aim may pass through a
 *  blocked zone mid-swing — the CLAMP guarantees it never RESTS or FIRES there.) */
export function traverse(mount, targetAng, dt) {
  const goal = clampToArc(mount.sectors, targetAng)
  if (goal == null) return mount.aim
  const d = wrap(goal - mount.aim)
  const step = Math.max(-mount.rate * dt, Math.min(mount.rate * dt, d))
  mount.aim = wrap(mount.aim + step)
  return mount.aim
}

export const AIM_TOL = 0.06   // ~3.4° — close enough to loose a shot

/** canFire(mount, targetAng, dist) — aimed on target, target in arc, in range,
 *  off cooldown. Energy is the power grid's business (energy2), not ours. */
export function canFire(mount, targetAng, dist) {
  if (!mount.weapon || mount.cd > 0) return false
  if (dist > mount.weapon.range) return false
  if (!inArc(mount.sectors, targetAng)) return false
  return Math.abs(wrap(targetAng - mount.aim)) <= AIM_TOL
}

/** fire(mount) — commit a shot: returns its energy price, starts cooldown */
export function fire(mount) {
  mount.cd = mount.weapon.cooldown
  return mount.weapon.energyPerShot
}

export const cool = (mount, dt) => { mount.cd = Math.max(0, mount.cd - dt) }
