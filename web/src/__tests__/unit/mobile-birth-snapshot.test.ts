import { describe, expect, it, vi } from 'vitest'

// prisma is imported by world-create at module load but NOT queried on the
// no-base mobile path — stub it so the import is inert.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { resolveBirthExtras } from '@/lib/world-create'
import { emptySnapshot, applyCommandToSnapshotObject } from '@/app/api/engine/space-store'
import { placeholderSeedCommands, baseBackdropSeedCommands } from '@/app/engine/placeholder-nodes'

/** THE ACCEPTANCE PROOF (Galen, Aug 30: "cleared when the snapshot shows it
 *  properly done"). Runs the REAL birth pipeline for a mobile world —
 *  resolveBirthExtras → the seed commands → the real pure snapshot applier —
 *  and asserts the exact snapshot a mobile birth produces. No mocks of the
 *  logic under test; this is the snapshot a fresh /create?targets=mobile yields. */
describe('mobile birth snapshot — set up in context, aligned', () => {
  it('produces a viewport-aligned, backdrop-skinned mobile snapshot', async () => {
    // 1) the real birth params for a mobile world (no base)
    const { birthParams } = await resolveBirthExtras('test-user', { targets: 'mobile' })
    expect(birthParams).toMatchObject({ deviceConfig: 'mobile' })   // plain square — matches the working base games
    expect(birthParams.gridW).toBeUndefined()   // NO portrait rect (it mis-framed every mobile world)

    // 2) build the snapshot exactly as birthWorld does: params + seeds
    const snap = emptySnapshot()
    ;(snap as unknown as { worldParams: Record<string, unknown> }).worldParams = { ...birthParams }
    for (const cmd of placeholderSeedCommands(1_700_000_000_000)) applyCommandToSnapshotObject(snap, cmd)
    for (const cmd of baseBackdropSeedCommands(birthParams)) applyCommandToSnapshotObject(snap, cmd)

    // 3) THE SNAPSHOT SHOWS IT PROPERLY DONE:
    // — a plain square world (the proven working shape), deviceConfig for the frame
    const wp = (snap as unknown as { worldParams: Record<string, unknown> }).worldParams
    expect(wp.deviceConfig).toBe('mobile')
    expect(wp.gridW).toBeUndefined()

    // — a base visual exists (no grey square)
    const bg = (snap.visualTypes ?? []).find(v => v.name === 'base_bg')
    expect(bg).toBeTruthy()
    expect(bg!.wgsl).toContain('fn visual_base_bg')

    // — a skinned full-bleed backdrop field, sized to and centered on the rect
    const backdrop = (snap.fields ?? []).find(f => f.name === 'backdrop')
    expect(backdrop).toBeTruthy()
    expect(backdrop!.visualTypeName).toBe('base_bg')
    expect(backdrop!.w).toBe(512)
    expect(backdrop!.h).toBe(512)
    expect(backdrop!.transform.x).toBe(256)   // square center — matches the camera's restingCenter (gridSize/2)
    expect(backdrop!.transform.y).toBe(256)

    // — the anatomy slots are present (builder has somewhere to build)
    const hookIds = (snap.stepHooks ?? []).map(h => h.id)
    expect(hookIds).toEqual(expect.arrayContaining(['player', 'world', 'rules', 'hud']))
  })

  it('a non-mobile world is still born in context (square backdrop, no grey square)', async () => {
    const { birthParams } = await resolveBirthExtras('test-user', {})   // universal/desktop
    const snap = emptySnapshot()
    if (Object.keys(birthParams).length) (snap as unknown as { worldParams: Record<string, unknown> }).worldParams = { ...birthParams }
    for (const cmd of baseBackdropSeedCommands(birthParams)) applyCommandToSnapshotObject(snap, cmd)
    const backdrop = (snap.fields ?? []).find(f => f.name === 'backdrop')
    expect(backdrop).toBeTruthy()
    expect(backdrop!.w).toBe(512)
    expect(backdrop!.transform.x).toBe(256)
  })
})
