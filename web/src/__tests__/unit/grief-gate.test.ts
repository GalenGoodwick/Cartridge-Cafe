// grief gate (task #6): destructive verbs at the persist chokepoint.
// Members build — they don't demolish. Holds protect every builder's nodes.
import { describe, it, expect } from 'vitest'
import { applyCommandToSnapshotObject, emptySnapshot } from '@/app/api/engine/space-store'
import type { SceneSnapshot } from '@/app/engine/types'

const HOLDER_A = 'a'.repeat(16)
const HOLDER_B = 'b'.repeat(16)
const NOW = 1_700_000_000_000

function worldWith(hooks: Array<{ id: string; holder?: string; heldAt?: number }>): SceneSnapshot {
  const snap = emptySnapshot()
  const nodes: Record<string, unknown> = {}
  for (const h of hooks) {
    snap.stepHooks.push({ id: h.id, code: '// hook', name: h.id } as never)
    if (h.holder) nodes[h.id] = { id: h.id, holder: h.holder, heldAt: h.heldAt ?? NOW }
  }
  ;(snap.worldData as Record<string, unknown>).__nodes = nodes
  return snap
}

describe('grief gate — remove_step_hook', () => {
  it('a HELD node refuses removal by anyone else (owner key included)', () => {
    const snap = worldWith([{ id: 'physics', holder: HOLDER_A, heldAt: NOW }])
    const r = applyCommandToSnapshotObject(snap, {
      type: 'remove_step_hook', hookId: 'physics', __holder: HOLDER_B, __now: NOW, __member: false,
    })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('HELD')
    expect(snap.stepHooks).toHaveLength(1)
  })

  it('the holder removes their own node', () => {
    const snap = worldWith([{ id: 'physics', holder: HOLDER_A, heldAt: NOW }])
    const r = applyCommandToSnapshotObject(snap, {
      type: 'remove_step_hook', hookId: 'physics', __holder: HOLDER_A, __now: NOW, __member: true,
    })
    expect(r.error).toBeUndefined()
    expect(snap.stepHooks).toHaveLength(0)
  })

  it('a MEMBER may not remove an unheld node — must dock first', () => {
    const snap = worldWith([{ id: 'legacy-hud' }])
    const r = applyCommandToSnapshotObject(snap, {
      type: 'remove_step_hook', hookId: 'legacy-hud', __holder: HOLDER_A, __now: NOW, __member: true,
    })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('dock_node')
    expect(snap.stepHooks).toHaveLength(1)
  })

  it('an OWNER key removes an unheld node freely (legacy-neutral)', () => {
    const snap = worldWith([{ id: 'legacy-hud' }])
    const r = applyCommandToSnapshotObject(snap, {
      type: 'remove_step_hook', hookId: 'legacy-hud', __holder: HOLDER_A, __now: NOW, __member: false,
    })
    expect(r.error).toBeUndefined()
    expect(snap.stepHooks).toHaveLength(0)
  })

  it('a stale hold (15m idle) is removable by an owner key', () => {
    const snap = worldWith([{ id: 'physics', holder: HOLDER_A, heldAt: NOW - 16 * 60_000 }])
    const r = applyCommandToSnapshotObject(snap, {
      type: 'remove_step_hook', hookId: 'physics', __holder: HOLDER_B, __now: NOW, __member: false,
    })
    expect(r.error).toBeUndefined()
    expect(snap.stepHooks).toHaveLength(0)
  })

  it('admin overrides a fresh hold', () => {
    const snap = worldWith([{ id: 'physics', holder: HOLDER_A, heldAt: NOW }])
    const r = applyCommandToSnapshotObject(snap, {
      type: 'remove_step_hook', hookId: 'physics', __holder: HOLDER_B, __now: NOW, __member: true, __admin: true,
    })
    expect(r.error).toBeUndefined()
    expect(snap.stepHooks).toHaveLength(0)
  })
})

describe('grief gate — world-wide destruction is owner-only for members', () => {
  it('reset refuses a member key', () => {
    const snap = emptySnapshot()
    const r = applyCommandToSnapshotObject(snap, { type: 'reset', __member: true })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain("owner's key")
  })

  it('delete_field refuses a member key but serves the owner', () => {
    const snap = emptySnapshot()
    applyCommandToSnapshotObject(snap, { type: 'create_field', fieldId: 'orb', radius: 10 })
    const deny = applyCommandToSnapshotObject(snap, { type: 'delete_field', fieldId: 'orb', __member: true })
    expect(deny.ok).toBe(false)
    expect(snap.fields).toHaveLength(1)
    const allow = applyCommandToSnapshotObject(snap, { type: 'delete_field', fieldId: 'orb', __member: false })
    expect(allow.error).toBeUndefined()
    expect(snap.fields).toHaveLength(0)
  })
})
