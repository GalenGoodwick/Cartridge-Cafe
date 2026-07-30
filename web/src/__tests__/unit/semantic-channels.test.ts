// SEMANTIC CHANNELS — a field tagged 'ch:<name>' publishes that channel through its
// rendered pixels; the sim STATES, for each field, the fraction of its pixels
// overlapped by each channel from OTHER fields. Open ontology (any name), no
// hardcoded reactions (the world's hook decides meaning). Derived from presence, so
// it's deterministic → replayable.
import { describe, it, expect } from 'vitest'
import { FieldSimulation } from '@/app/engine/simulation'
import { DEFAULT_GRID_SIZE } from '@/app/engine/types'

const GS = DEFAULT_GRID_SIZE
function discMask(cx: number, cy: number, r: number): Uint8Array {
  const m = new Uint8Array(GS * GS)
  for (let y = Math.max(0, cy - r); y <= Math.min(GS - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(GS - 1, cx + r); x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= r * r) m[y * GS + x] = 255
    }
  return m
}
function addField(sim: FieldSimulation, id: string, x: number, y: number, r: number, tags: string[] = []) {
  const f = sim.createField(id, id, [1, 1, 1, 1])
  f.shapeType = 'circle'; f.radius = r; f.transform.x = x; f.transform.y = y
  if (tags.length) sim.addTag(id, tags)
  return f
}

describe('semantic channels: engine states the intersection, world decides meaning', () => {
  it('a subscriber reads the fraction of ITS pixels covered by a channel', () => {
    const sim = new FieldSimulation(GS)
    // heat orb (publishes ch:heat) fully overlapping an ice disc of the same size
    addField(sim, 'heat', 100, 100, 20, ['ch:heat'])
    addField(sim, 'ice', 100, 100, 20)
    sim.fieldPresence.set('heat', discMask(100, 100, 20))
    sim.fieldPresence.set('ice', discMask(100, 100, 20))
    const r = sim.fieldChannelReadings('ice')
    expect(r.heat).toBeGreaterThan(0.98)   // fully covered
  })

  it('partial overlap → partial reading (~half)', () => {
    const sim = new FieldSimulation(GS)
    addField(sim, 'heat', 100, 100, 20, ['ch:heat'])
    addField(sim, 'ice', 120, 100, 20)          // shifted so heat covers ~half the ice
    sim.fieldPresence.set('heat', discMask(100, 100, 20))
    sim.fieldPresence.set('ice', discMask(120, 100, 20))
    const r = sim.fieldChannelReadings('ice')
    expect(r.heat).toBeGreaterThan(0.25)
    expect(r.heat).toBeLessThan(0.75)
  })

  it('a field never reads its OWN channel (heat does not heat itself)', () => {
    const sim = new FieldSimulation(GS)
    addField(sim, 'heat', 100, 100, 20, ['ch:heat'])
    sim.fieldPresence.set('heat', discMask(100, 100, 20))
    expect(sim.fieldChannelReadings('heat').heat).toBeUndefined()
  })

  it('no overlap → no reading for that channel', () => {
    const sim = new FieldSimulation(GS)
    addField(sim, 'heat', 100, 100, 20, ['ch:heat'])
    addField(sim, 'ice', 300, 300, 20)
    sim.fieldPresence.set('heat', discMask(100, 100, 20))
    sim.fieldPresence.set('ice', discMask(300, 300, 20))
    expect(sim.fieldChannelReadings('ice').heat).toBeUndefined()
  })

  it('open ontology: any channel name works, and multiple channels stack', () => {
    const sim = new FieldSimulation(GS)
    addField(sim, 'heat', 100, 100, 20, ['ch:heat'])
    addField(sim, 'grief', 100, 100, 20, ['ch:griefwater'])   // invented channel
    addField(sim, 'thing', 100, 100, 20)
    sim.fieldPresence.set('heat', discMask(100, 100, 20))
    sim.fieldPresence.set('grief', discMask(100, 100, 20))
    sim.fieldPresence.set('thing', discMask(100, 100, 20))
    const r = sim.fieldChannelReadings('thing')
    expect(r.heat).toBeGreaterThan(0.98)
    expect(r.griefwater).toBeGreaterThan(0.98)
  })

  it('no channels declared → allChannelReadings is empty (zero cost)', () => {
    const sim = new FieldSimulation(GS)
    addField(sim, 'a', 100, 100, 20)
    sim.fieldPresence.set('a', discMask(100, 100, 20))
    expect(sim.allChannelReadings()).toEqual({})
  })

  it('allChannelReadings keys by field id and includes only fields that read something', () => {
    const sim = new FieldSimulation(GS)
    addField(sim, 'heat', 100, 100, 20, ['ch:heat'])
    addField(sim, 'ice', 100, 100, 20)
    addField(sim, 'faraway', 400, 400, 20)
    sim.fieldPresence.set('heat', discMask(100, 100, 20))
    sim.fieldPresence.set('ice', discMask(100, 100, 20))
    sim.fieldPresence.set('faraway', discMask(400, 400, 20))
    const all = sim.allChannelReadings()
    expect(all.ice?.heat).toBeGreaterThan(0.98)
    expect(all.faraway).toBeUndefined()
    expect(all.heat).toBeUndefined()   // heat reads no channel (only its own)
  })
})
