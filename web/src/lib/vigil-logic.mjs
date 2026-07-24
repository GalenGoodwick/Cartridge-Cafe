// vigil-logic — the "seeing is touching" mechanic, as pure functions.
//
// Kept separate from the cartridge so it can be unit-tested against a fake sim
// (see __tests__/unit/vigil-logic.test.mjs) and then STRINGIFIED into the live
// step-hook — the exact tested code is what runs. It depends only on gaze-math,
// whose functions are embedded alongside these into the hook (one truth, no
// drift between test and ship).
//
// World frame: the nave runs along +z; walking plane at y≈1; Watchers stand at
// the sides near y≈3 and sweep gaze rays that angle DOWN across the floor. The
// flame is carried at floor level and casts a light ray along its aim. A pane is
// a horizontal quad of stained glass bridging the chasm — it is only solid where
// a gaze currently falls on it, and its RULE flips where a gaze and the flame's
// light cross on its surface.

import {
  add, scale, normalize, rayPlaneHit, pointInPaneUV, gazeCrossOnPane,
} from './gaze-math.mjs'
import { resolveMove } from './collision.mjs'

export const PANE_UP = [0, 1, 0] // horizontal panes face up

// yaw a direction around the world Y axis (the Watcher sweep)
export function dirYaw(base, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  return normalize([base[0] * c - base[2] * s, base[1], base[0] * s + base[2] * c])
}

/** The current gaze ray of a Watcher at time t: origin + swept, downward dir. */
export function watcherGaze(w, t) {
  const yaw = Math.sin(t * w.rate + w.phase) * w.amp
  return { origin: w.origin.slice(), dir: dirYaw(w.base, yaw) }
}

/** A pane as gaze-math wants it: a plane point/normal + a uv quad. */
export function paneGeom(p) {
  const center = add(p.origin, scale(add(p.uAxis, p.vAxis), 0.5))
  return { origin: p.origin, uAxis: p.uAxis, vAxis: p.vAxis, center }
}

/** The flame's light ray. */
export function flameRay(flame) {
  return { origin: flame.pos.slice(), dir: normalize(flame.aim) }
}

/** Fresh game state. Deterministic — no RNG, so ticks replay exactly in tests. */
export function initVigilState() {
  return {
    v: 1,
    t: 0,
    flame: { pos: [0, 1, 4], aim: [0, 0, 1] },
    watchers: [
      { origin: [-6, 3, 8], base: [1, -0.35, 0], amp: 0.6, rate: 0.40, phase: 0.0 },
      { origin: [6, 3, 14], base: [-1, -0.35, 0], amp: 0.6, rate: 0.35, phase: 1.7 },
      { origin: [-6, 3, 20], base: [1, -0.35, 0], amp: 0.6, rate: 0.45, phase: 3.1 },
    ],
    // panes bridge the chasm along +z; walking plane y=1
    panes: [
      { id: 0, origin: [-1, 1, 7], uAxis: [2, 0, 0], vAxis: [0, 0, 2], rule: 'floor', lit: 0, flipped: 0 },
      { id: 1, origin: [-1, 1, 13], uAxis: [2, 0, 0], vAxis: [0, 0, 2], rule: 'wall', lit: 0, flipped: 0 },
      { id: 2, origin: [-1, 1, 19], uAxis: [2, 0, 0], vAxis: [0, 0, 2], rule: 'floor', lit: 0, flipped: 0 },
    ],
    reliquaryZ: 24,
    win: 0,
    events: [],
  }
}

// rule flips: seeing a gaze cross rewrites what the pane IS
export const FLIP = { floor: 'door', wall: 'bridge', door: 'floor', bridge: 'wall' }

/**
 * Advance the world one tick. Pure: mutates and returns `G`, and pushes any
 * one-shot events (for sound/hud) onto `G.events` (caller drains them).
 *
 * @param G      state from initVigilState (persisted in worldData.__vg)
 * @param input  { moveX, moveZ, aimX, aimZ } in [-1,1] — already debounced
 * @param dt     seconds
 */
export function stepVigil(G, input, dt) {
  G.t += dt
  G.events = []

  // ── flame: move along the floor (collision-resolved), aim the light ──
  const SPEED = 3.5
  const nx = G.flame.pos[0] + (input.moveX || 0) * SPEED * dt
  const nz = G.flame.pos[2] + (input.moveZ || 0) * SPEED * dt
  const [rx, rz] = resolveMove(G.flame.pos[0], G.flame.pos[2], nx, nz)
  G.flame.pos[0] = rx
  G.flame.pos[2] = rz
  if (input.aimX || input.aimZ) {
    const a = normalize([input.aimX || 0, 0, input.aimZ || 0])
    if (a[0] || a[2]) G.flame.aim = a
  }
  const light = flameRay(G.flame)

  // ── gaze rays this tick ──
  const gazes = G.watchers.map((w) => watcherGaze(w, G.t))

  // ── per pane: is it lit (seen), and did a gaze cross the flame on it? ──
  for (const p of G.panes) {
    const geom = paneGeom(p)

    // LIT = some gaze currently lands inside the pane (exists-where-seen)
    let lit = 0
    for (const g of gazes) {
      const th = rayPlaneHit(g.origin, g.dir, geom.center, PANE_UP)
      if (th == null) continue
      const hitP = add(g.origin, scale(g.dir, th))
      if (pointInPaneUV(hitP, geom, 0.2).inside) { lit = 1; break }
    }
    p.lit = lit

    // FLIP = flame light ∩ a gaze, on this pane, in front of both.
    // A pane flips once per "arming"; it re-arms when it goes dark again.
    if (!lit) { p.flipped = 0; continue }
    if (p.flipped) continue
    for (const g of gazes) {
      const cross = gazeCrossOnPane(g.origin, g.dir, light.origin, light.dir, geom, { maxGap: 0.6 })
      if (cross.fires) {
        p.rule = FLIP[p.rule] || p.rule
        p.flipped = 1
        G.events.push({ type: 'flip', pane: p.id, rule: p.rule })
        break
      }
    }
  }

  // ── footing check: are you standing on something solid & lit? ──
  const fx = G.flame.pos[0], fz = G.flame.pos[2]
  let onSolid = false
  for (const p of G.panes) {
    const solid = p.rule === 'floor' || p.rule === 'bridge'
    if (!solid || !p.lit) continue
    const geom = paneGeom(p)
    const { inside } = pointInPaneUV([fx, 1, fz], geom, 2.0)
    if (inside) { onSolid = true; break }
  }
  G.onSolid = onSolid ? 1 : 0

  // ── win: reached the reliquary end of the nave (its front — the ark is solid) ──
  if (fz >= G.reliquaryZ - 2 && !G.win) {
    G.win = 1
    G.events.push({ type: 'win' })
  }
  return G
}
