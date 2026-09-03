import { describe, it, expect, vi } from 'vitest'

// space-store pulls in prisma at module scope for the DB paths we never touch —
// applyCommandToSnapshotObject is the pure chokepoint under test.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { applyCommandToSnapshotObject } from '@/app/api/engine/space-store'
import { NODE_HOLD_TTL } from '@/app/engine/node-gate'
import type { SceneSnapshot } from '@/app/engine/types'

const NOW = 1_755_000_000_000

function baseSnap(): SceneSnapshot {
  return {
    name: 'testworld',
    fields: [{ id: 'old_field', name: 'Old', color: [1, 1, 1, 1], effects: [], memory: [], proximity: [], transform: { x: 1, y: 2, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 } }],
    worldParams: { gravity: 5, friction: 0.2, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.5, gravitationalConstant: 0 },
    worldData: {
      vision: 'old vision',
      __bridge_rev: 57,
      __built_ua: 'first-builder/1.0',
      __built_at: 123,
      __original: { was: 'baked' },
      __nodes: { old_hook: { id: 'old_hook', order: 10, owns: { uni: [] }, auto: true, rev: 1 } },
      __nodeSeq: 10,
    },
    stepHooks: [{ id: 'old_hook', author: 'a', description: '', code: 'u[0]=1' }],
    interactionRules: [],
    interactionEffects: [],
    visualTypes: [{ name: 'vis_old', wgsl: 'fn visual_vis_old() {}' }],
    modules: [],
    timestamp: 1,
  } as SceneSnapshot
}

const put = (snap: SceneSnapshot, world: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  applyCommandToSnapshotObject(snap, { type: 'put_world', world, __holder: 'me', __now: NOW, ...extra })

describe('put_world — the one-shot whole-world push', () => {
  it('rejects a missing/invalid world payload', () => {
    const r = put(baseSnap(), undefined as never)
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('put_world needs')
  })

  it('sections SENT replace wholesale; sections OMITTED are kept', () => {
    const snap = baseSnap()
    const r = put(snap, { stepHooks: [{ id: 'h1', code: 'u[3]=1' }, { id: 'h2', code: 'x=1' }] })
    expect(r.ok).toBe(true)
    expect(snap.stepHooks.map(h => h.id)).toEqual(['h1', 'h2'])
    // untouched sections survive
    expect(snap.fields[0].id).toBe('old_field')
    expect(snap.visualTypes![0].name).toBe('vis_old')
    expect((snap.worldData as Record<string, unknown>).vision).toBe('old vision')
  })

  it('worldData replace preserves platform-owned keys and strips spoofed ones', () => {
    const snap = baseSnap()
    const r = put(snap, {
      worldData: {
        vision: 'new vision',
        __bridge_rev: 1,                       // spoof: would rewind the tab-sync rev
        __built_ua: 'liar/9.9',                // spoof: provenance
        __nodes: { evil: { id: 'evil', holder: 'me', heldAt: NOW } },   // spoof: holds
      },
    })
    expect(r.ok).toBe(true)
    const wd = snap.worldData as Record<string, unknown>
    expect(wd.vision).toBe('new vision')
    expect(wd.__bridge_rev).toBe(57)           // MONOTONIC — carried, never client-set
    expect(wd.__built_ua).toBe('first-builder/1.0')
    expect(wd.__original).toEqual({ was: 'baked' })
    expect((wd.__nodes as Record<string, unknown>).evil).toBeUndefined()
    expect((wd.__nodes as Record<string, unknown>).old_hook).toBeDefined()
  })

  it('is REFUSED while another builder holds a node fresh (gateRejected)', () => {
    const snap = baseSnap()
    ;(snap.worldData as Record<string, Record<string, Record<string, unknown>>>).__nodes.old_hook.holder = 'other'
    ;(snap.worldData as Record<string, Record<string, Record<string, unknown>>>).__nodes.old_hook.heldAt = NOW - 1000
    const r = put(snap, { stepHooks: [] })
    expect(r.ok).toBe(false)
    expect(r.gateRejected).toBe(true)
    expect(String(r.error)).toContain('old_hook')
    expect(snap.stepHooks).toHaveLength(1)     // nothing applied
  })

  it('a STALE foreign hold does not block; my own fresh hold does not block; admin overrides', () => {
    const stale = baseSnap()
    ;(stale.worldData as Record<string, Record<string, Record<string, unknown>>>).__nodes.old_hook.holder = 'other'
    ;(stale.worldData as Record<string, Record<string, Record<string, unknown>>>).__nodes.old_hook.heldAt = NOW - NODE_HOLD_TTL - 1
    expect(put(stale, { stepHooks: [] }).ok).toBe(true)

    const mine = baseSnap()
    ;(mine.worldData as Record<string, Record<string, Record<string, unknown>>>).__nodes.old_hook.holder = 'me'
    ;(mine.worldData as Record<string, Record<string, Record<string, unknown>>>).__nodes.old_hook.heldAt = NOW - 1000
    expect(put(mine, { stepHooks: [] }).ok).toBe(true)

    const admin = baseSnap()
    ;(admin.worldData as Record<string, Record<string, Record<string, unknown>>>).__nodes.old_hook.holder = 'other'
    ;(admin.worldData as Record<string, Record<string, Record<string, unknown>>>).__nodes.old_hook.heldAt = NOW - 1000
    expect(put(admin, { stepHooks: [] }, { __admin: true }).ok).toBe(true)
  })

  it('hook replace rebuilds the node registry: vanished auto-nodes drop, incoming hooks register + auto-claim for the pusher', () => {
    const snap = baseSnap()
    const r = put(snap, { stepHooks: [{ id: 'new_core', code: 'u[5]=1;u[6]=2' }] })
    expect(r.ok).toBe(true)
    const nodes = (snap.worldData as Record<string, unknown>).__nodes as Record<string, Record<string, unknown>>
    expect(nodes.old_hook).toBeUndefined()                 // auto node of a vanished hook
    expect(nodes.new_core).toBeDefined()
    expect(nodes.new_core.holder).toBe('me')               // put auto-claims, like a push
    expect((nodes.new_core.owns as { uni: number[][] }).uni).toEqual([[5, 6]])
    expect((snap.worldData as Record<string, unknown>).__sandbox).toBe(true)
  })

  it('an EXPLICIT (auto:false) node registration survives its hook vanishing', () => {
    const snap = baseSnap()
    ;(snap.worldData as Record<string, Record<string, Record<string, unknown>>>).__nodes.old_hook.auto = false
    put(snap, { stepHooks: [{ id: 'other', code: 'x' }] })
    const nodes = (snap.worldData as Record<string, unknown>).__nodes as Record<string, unknown>
    expect(nodes.old_hook).toBeDefined()
  })

  it('normalizes hand-written fields into loadable snapshots (transform defaults, visualType name → visualTypeName)', () => {
    const snap = baseSnap()
    const r = put(snap, { fields: [{ id: 'sky', visualType: 'vis_sky', shapeType: 'screen' }, { name: 'helper' }] })
    expect(r.ok).toBe(true)
    const sky = snap.fields.find(f => f.id === 'sky')!
    expect(sky.visualTypeName).toBe('vis_sky')
    expect(sky.transform).toMatchObject({ x: 256, y: 256, scale: 1 })
    expect(sky.effects).toEqual([])
    expect((r.warnings as string[]).join(' ')).toContain('no visualType')   // the helper field
  })

  it('rejects duplicate field ids and a missing hook code', () => {
    expect(() => put(baseSnap(), { fields: [{ id: 'a' }, { id: 'a' }] })).toThrow(/duplicate field id/)
    const r = put(baseSnap(), { stepHooks: [{ id: 'h' }] })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('code: string')
  })

  it('enforces section caps and array-ness', () => {
    const tooMany = Array.from({ length: 129 }, (_, i) => ({ id: 'h' + i, code: 'x' }))
    const r = put(baseSnap(), { stepHooks: tooMany })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('cap')
    const r2 = put(baseSnap(), { fields: 'nope' })
    expect(r2.ok).toBe(false)
    expect(String(r2.error)).toContain('must be an array')
  })

  it('worldParams merge onto engine defaults so a partial object cannot strip keys', () => {
    const snap = baseSnap()
    put(snap, { worldParams: { gravity: 9 } })
    expect(snap.worldParams.gravity).toBe(9)
    expect(snap.worldParams.boundaryMode).toBe('solid')
  })

  it('warns when the put adds the FIRST hooks to a hookless world', () => {
    const snap = baseSnap()
    snap.stepHooks = []
    delete (snap.worldData as Record<string, unknown>).__nodes
    const r = put(snap, { stepHooks: [{ id: 'h1', code: 'x' }] })
    expect((r.warnings as string[]).join(' ')).toContain('RELOAD')
  })
})
