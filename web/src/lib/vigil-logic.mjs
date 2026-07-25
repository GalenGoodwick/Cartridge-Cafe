// vigil-logic — "seeing is touching," redesigned to the real brief: a WALKWAY
// with GAPS, where a gap is solid footing only while a Watcher's sweeping gaze
// lights its pane. Watch the light, cross in the moment. No doors, no flip —
// see the gap bridged, and step across before the gaze moves on.
//
// Kept separate from the cartridge so it is unit-tested against a fake sim and
// then STRINGIFIED verbatim into the live step-hook (one truth, no drift).

import { add, scale, normalize, rayPlaneHit, pointInPaneUV } from './gaze-math.mjs'
import { resolveMove } from './collision.mjs'
import { initPuzzle, gapBlocked } from './vigil-puzzle.mjs'

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

/** A pane as gaze-math wants it: plane point/normal + a uv quad. */
export function paneGeom(p) {
  const center = add(p.origin, scale(add(p.uAxis, p.vAxis), 0.5))
  return { origin: p.origin, uAxis: p.uAxis, vAxis: p.vAxis, center }
}

/** Is a pane lit right now — does any Watcher gaze land inside it? */
export function paneLit(pane, gazes) {
  const geom = paneGeom(pane)
  for (const g of gazes) {
    const th = rayPlaneHit(g.origin, g.dir, geom.center, PANE_UP)
    if (th == null) continue
    const hitP = add(g.origin, scale(g.dir, th))
    if (pointInPaneUV(hitP, geom, 0.4).inside) return true
  }
  return false
}

/** Fresh game state. Deterministic — no RNG, so ticks replay exactly in tests. */
export function initVigilState() {
  return {
    v: 3,
    t: 0,
    flame: { pos: [0, 1, 3], aim: [0, 0, 1] },   // on the walkway, before the first gap
    watchers: [
      { origin: [-4, 3, 8.5], base: [1, -0.55, 0], amp: 0.5, rate: 0.45, phase: 0.0 },
      { origin: [4, 3, 15.5], base: [-1, -0.55, 0], amp: 0.5, rate: 0.40, phase: 1.3 },
    ],
    // panes bridge the two gaps in the central walkway (centres z=8.5, z=15.5)
    panes: [
      { id: 0, origin: [-2.5, 1, 7], uAxis: [5, 0, 0], vAxis: [0, 0, 3], lit: 0 },
      { id: 1, origin: [-2.5, 1, 14], uAxis: [5, 0, 0], vAxis: [0, 0, 3], lit: 0 },
    ],
    ...initPuzzle(),
    reliquaryZ: 24,
    win: 0,
    events: [],
  }
}

/**
 * Advance the world one tick. Pure: mutates and returns `G`, pushing one-shot
 * events onto `G.events` (a pane lighting, a win) for sound/hud.
 */
export function stepVigil(G, input, dt) {
  G.t += dt
  G.events = []

  // ── Watcher gazes light the gap panes (exists-where-seen) ──
  const gazes = G.watchers.map((w) => watcherGaze(w, G.t))
  for (const p of G.panes) {
    const lit = paneLit(p, gazes) ? 1 : 0
    if (lit && !p.lit) G.events.push({ type: 'light', pane: p.id })
    p.lit = lit
  }

  // ── move along the walkway; an unlit gap is a hole you cannot enter ──
  const SPEED = 3.5
  const nx = G.flame.pos[0] + (input.moveX || 0) * SPEED * dt
  const nz = G.flame.pos[2] + (input.moveZ || 0) * SPEED * dt
  const [rx, rz] = resolveMove(G.flame.pos[0], G.flame.pos[2], nx, nz, (x, z) => gapBlocked(x, z, G.gaps, G.panes))
  G.flame.pos[0] = rx
  G.flame.pos[2] = rz
  if (input.aimX || input.aimZ) {
    const a = normalize([input.aimX || 0, 0, input.aimZ || 0])
    if (a[0] || a[2]) G.flame.aim = a           // the flame's light cone (visual)
  }

  // ── footing: over an unlit gap you are unsupported ──
  const fx = G.flame.pos[0], fz = G.flame.pos[2]
  const overUnlit = G.gaps.some((g) => {
    if (Math.abs(fz - g.z) < 1.6 && Math.abs(fx) <= 2.6) {
      const pane = G.panes.find((p) => p.id === g.pane)
      return !pane || !pane.lit
    }
    return false
  })
  G.onSolid = overUnlit ? 0 : 1

  // ── win: reached the reliquary at the walkway's end ──
  if (fz >= G.reliquaryZ - 2 && !G.win) {
    G.win = 1
    G.events.push({ type: 'win' })
  }
  return G
}
