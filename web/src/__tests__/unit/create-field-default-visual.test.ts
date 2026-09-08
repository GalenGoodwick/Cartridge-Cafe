import { describe, it, expect } from 'vitest'
import { applyCommandToSnapshotObject, emptySnapshot } from '@/app/api/engine/space-store'

// "Lower the floor" FIX 1, the space-store half: a field the author gave a COLOR
// but no visualType should still DRAW — it defaults to the built-in 'solid' look
// (no shader). Gated on an explicit color so a bare invisible collider stays
// invisible. And the default must NOT flip the `skinned` shape logic (which would
// turn every plain field into a full-screen quad).

function makeField(cmd: Record<string, unknown>) {
  const snap = emptySnapshot()
  applyCommandToSnapshotObject(snap, { type: 'create_field', ...cmd })
  return snap.fields[snap.fields.length - 1]
}

describe('create_field — the no-shader coloured field', () => {
  it('a coloured field with no visualType defaults to the built-in solid look', () => {
    const f = makeField({ shape: 'circle', color: [1, 0, 0, 1] })
    expect(f.visualTypeName).toBe('solid')
  })

  it('does NOT flip the shape default: a plain coloured field stays a circle, not a screen quad', () => {
    // `skinned` (=caller passed visualType) must remain false so the shape stays
    // the physics-primitive default, not the full-viewport 'screen' canvas.
    const f = makeField({ color: [0, 1, 0, 1] })
    expect(f.shapeType).toBe('circle')
    expect(f.radius).toBe(20)
    expect(f.visualTypeName).toBe('solid')
  })

  it('an explicit visualType is preserved (never overridden by the default)', () => {
    const f = makeField({ shape: 'circle', color: [1, 0, 0, 1], visualType: 'glow' })
    expect(f.visualTypeName).toBe('glow')
  })

  it('a bare field with NO color stays invisible (no forced visual — colliders unaffected)', () => {
    const f = makeField({ shape: 'rect', w: 100, h: 20 })
    expect(f.visualTypeName).toBeUndefined()
  })
})
