import { describe, expect, it } from 'vitest'
import { FieldSimulation as Simulation } from '@/app/engine/simulation'

/** The backdrop healer (4dfeff9) snaps a world-covering static field "home" on
 *  load — drift from old collision damage, not intent. GRID ≡ VIEWPORT
 *  (Galen, Aug 31): home is the DECLARED RECT's center when the world has one,
 *  not the square center — the square-only home made the healer misread every
 *  correctly-placed mobile backdrop (576×1024 at 288,512) as damage and drag
 *  it to (512,512): the misaligned birth. Loads restore fields BEFORE params
 *  land, so setWorldParams re-heals — these tests pin both halves. */

const backdropSnap = (x: number, y: number, w = 576, h = 1024, props?: Record<string, unknown>) => ({
  id: 'bd', name: 'backdrop', color: [0.06, 0.07, 0.1, 1] as [number, number, number, number],
  transform: { x, y, vx: 0, vy: 0, vr: 0, scale: 1, rotation: 0 },
  w, h, shapeType: 'rect' as const,
  ...(props ? { properties: props } : {}),
})

describe('world-covering heal — rect-aware home', () => {
  it('REAL LOAD ORDER: restore before params, then setWorldParams re-homes to the rect center', () => {
    const sim = new Simulation(1024)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.restoreFromSnapshots([backdropSnap(288, 512) as any])
    // params unknown at restore — the healer sees the square and drags it home
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.setWorldParams({ gridW: 576, gridH: 1024 } as any)
    const f = sim.fields.get('bd')!
    expect(f.transform.x).toBe(288)   // re-healed to the RECT center, not 512
    expect(f.transform.y).toBe(512)
  })

  it('params already known: a correctly-placed rect backdrop is NOT damage', () => {
    const sim = new Simulation(1024)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.setWorldParams({ gridW: 576, gridH: 1024 } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.restoreFromSnapshots([backdropSnap(288, 512) as any])
    const f = sim.fields.get('bd')!
    expect(f.transform.x).toBe(288)
    expect(f.transform.y).toBe(512)
  })

  it('a genuinely drifted rect backdrop heals to the rect center', () => {
    const sim = new Simulation(1024)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.setWorldParams({ gridW: 576, gridH: 1024 } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.restoreFromSnapshots([backdropSnap(400, 700) as any])
    const f = sim.fields.get('bd')!
    expect(f.transform.x).toBe(288)
    expect(f.transform.y).toBe(512)
  })

  it('square worlds unchanged: drift snaps to the square center (the proven heal)', () => {
    const sim = new Simulation(512)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.restoreFromSnapshots([backdropSnap(300, 300, 512, 512) as any])
    const f = sim.fields.get('bd')!
    expect(f.transform.x).toBe(256)
    expect(f.transform.y).toBe(256)
  })

  it('static:false (a deliberately moving backdrop) keeps its saved position', () => {
    const sim = new Simulation(1024)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.setWorldParams({ gridW: 576, gridH: 1024 } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.restoreFromSnapshots([backdropSnap(400, 700, 576, 1024, { static: false }) as any])
    const f = sim.fields.get('bd')!
    expect(f.transform.x).toBe(400)
    expect(f.transform.y).toBe(700)
  })

  // ── BACKDROP ≡ RECT (Galen, Sep 23: "the backdrop is always equal to the
  //    viewport/sizing of the world") — the born backdrop's SIZE heals too. ──

  it('a stale square backdrop RESIZES to a later-declared rect (the TUPELO square)', () => {
    const sim = new Simulation(512)
    // born square: grid undeclared at birth → 512×512 backdrop at (256,256)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.restoreFromSnapshots([backdropSnap(256, 256, 512, 512) as any])
    // the AI declares the rect after birth (set_world_params over the bridge)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.setWorldParams({ gridW: 1024, gridH: 576, gridSize: 1024 } as any)
    const f = sim.fields.get('bd')!
    expect(f.w).toBe(1024)            // size snapped to the declared rect
    expect(f.h).toBe(576)
    expect(f.transform.x).toBe(512)   // and centered in it
    expect(f.transform.y).toBe(288)
  })

  it("a builder's near-cover field (not named 'backdrop') keeps its own size", () => {
    const sim = new Simulation(1024)
    const veil = { ...backdropSnap(256, 256, 512, 512), id: 'veil', name: 'veil' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.restoreFromSnapshots([veil as any])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.setWorldParams({ gridW: 1024, gridH: 576 } as any)
    const f = sim.fields.get('veil')!
    expect(f.w).toBe(512)             // size untouched — only the platform's own backdrop resizes
    expect(f.h).toBe(512)
  })
})
