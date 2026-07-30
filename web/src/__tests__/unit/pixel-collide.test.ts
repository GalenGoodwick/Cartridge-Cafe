// PIXEL-COLLIDE LAW — appearance IS geometry. A field with pixelCollide:true
// collides by its RENDERED pixels (GPU presence readback), not its bounding rect.
// The proof case: a ball inside a ring's hole. Bounds overlap (box-in-box) but
// rendered pixels never touch — with the law ON there is no collision; with the
// law OFF (bounds physics, the old world) they collide. Also: graceful fallback
// to bounds before the first presence readback lands, and flag round-trip
// through generateSnapshots (the sync used to strip interaction flags).
import { describe, it, expect } from 'vitest'
import { FieldSimulation } from '@/app/engine/simulation'
import { DEFAULT_GRID_SIZE } from '@/app/engine/types'

const GS = DEFAULT_GRID_SIZE

/** presence mask helpers — masks are gridSize² Uint8Arrays, index y*gs+x */
function discMask(cx: number, cy: number, r: number): Uint8Array {
  const m = new Uint8Array(GS * GS)
  for (let y = Math.max(0, cy - r); y <= Math.min(GS - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(GS - 1, cx + r); x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= r * r) m[y * GS + x] = 255
    }
  return m
}
function ringMask(cx: number, cy: number, rOuter: number, rInner: number): Uint8Array {
  const m = discMask(cx, cy, rOuter)
  for (let y = Math.max(0, cy - rInner); y <= Math.min(GS - 1, cy + rInner); y++)
    for (let x = Math.max(0, cx - rInner); x <= Math.min(GS - 1, cx + rInner); x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= rInner * rInner) m[y * GS + x] = 0
    }
  return m
}

/** a sim with collision forces on and ambient physics off (pure collision test) */
function makeSim(): FieldSimulation {
  const sim = new FieldSimulation(GS)
  sim.running = true   // step() no-ops on a stopped sim
  Object.assign(sim.worldParams, { collisionForce: 100, gravity: 0, gravitationalConstant: 0, friction: 1 })
  return sim
}

function addRect(sim: FieldSimulation, id: string, x: number, y: number, w: number, h: number, pixelCollide: boolean) {
  const f = sim.createField(id, id, [1, 1, 1, 1])
  f.shapeType = 'rect'
  f.w = w; f.h = h
  f.transform.x = x; f.transform.y = y
  if (pixelCollide) f.pixelCollide = true
  return f
}

const colliding = (sim: FieldSimulation, a: string, b: string) => {
  sim.step(1 / 60)
  const mem = sim.getMemory(a) ?? []
  return mem.some(m => m.type === 'collision' && (m as { data?: { otherFieldId?: string } }).data?.otherFieldId === b)
}

describe('pixel-collide law: rendered pixels are the body', () => {
  it('ball inside a ring\'s hole: bounds overlap but pixels do not → NO collision', () => {
    const sim = makeSim()
    addRect(sim, 'ring', 100, 100, 80, 80, true)   // ring: outer r40, hole r20
    addRect(sim, 'ball', 100, 100, 16, 16, true)   // ball r8, dead center of the hole
    sim.fieldPresence.set('ring', ringMask(100, 100, 40, 20))
    sim.fieldPresence.set('ball', discMask(100, 100, 8))
    expect(colliding(sim, 'ball', 'ring')).toBe(false)
    const ball = sim.fields.get('ball')!
    expect(Math.abs(ball.transform.vx) + Math.abs(ball.transform.vy)).toBe(0)
  })

  it('same geometry WITHOUT the law (bounds physics) → collision — the law changes the outcome', () => {
    const sim = makeSim()
    addRect(sim, 'ring', 100, 100, 80, 80, false)
    addRect(sim, 'ball', 100, 100, 16, 16, false)
    expect(colliding(sim, 'ball', 'ring')).toBe(true)
  })

  it('ball moved onto the ring band: pixels touch → collision + push away from contact', () => {
    const sim = makeSim()
    addRect(sim, 'ring', 100, 100, 80, 80, true)
    addRect(sim, 'ball', 130, 100, 16, 16, true)   // center at r=30, inside the 20..40 band
    sim.fieldPresence.set('ring', ringMask(100, 100, 40, 20))
    sim.fieldPresence.set('ball', discMask(130, 100, 8))
    expect(colliding(sim, 'ball', 'ring')).toBe(true)
    const ball = sim.fields.get('ball')!
    expect(Math.abs(ball.transform.vx) + Math.abs(ball.transform.vy)).toBeGreaterThan(0)
  })

  it('presence not read back yet → graceful fallback to bounds (still collides)', () => {
    const sim = makeSim()
    addRect(sim, 'ring', 100, 100, 80, 80, true)
    addRect(sim, 'ball', 100, 100, 16, 16, true)
    // no fieldPresence injected — the readback hasn't landed
    expect(colliding(sim, 'ball', 'ring')).toBe(true)
  })

  it('interaction flags survive the snapshot round-trip (the sync used to strip them)', () => {
    const sim = makeSim()
    const f = addRect(sim, 'x', 50, 50, 20, 20, true)
    f.noCollide = true; f.noHit = true
    const snap = sim.generateSnapshots().find(s => s.id === 'x')!
    expect(snap.pixelCollide).toBe(true)
    expect(snap.noCollide).toBe(true)
    expect(snap.noHit).toBe(true)
    const sim2 = makeSim()
    sim2.restoreFromSnapshots([snap])
    const g = sim2.fields.get('x')!
    expect(g.pixelCollide).toBe(true)
    expect(g.noCollide).toBe(true)
  })
})
