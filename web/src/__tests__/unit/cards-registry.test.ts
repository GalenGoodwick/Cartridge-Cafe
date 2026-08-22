import { describe, it, expect, vi, beforeEach } from 'vitest'

// The registry's I/O is deliberately thin: the game-slot store on one side,
// the space-snapshot path on the other. Mock BOTH seams and test the logic
// hard — seed/growth/dedupe, corruption recovery, set_card validation, and
// the verb-collision trap (the bridge envelope's `type` is the verb, never
// the card type).
vi.mock('@/app/api/engine/store', () => ({
  loadGameSlot: vi.fn(),
  saveGameSlot: vi.fn(async () => undefined),
}))
vi.mock('@/app/api/engine/space-store', () => ({
  applyCommandToSnapshot: vi.fn(async () => ({})),
}))

import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'
import { applyCommandToSnapshot } from '@/app/api/engine/space-store'
import { readTypeRegistry, handleCardTypes, handleProposeCardType, handleSetCard } from '@/app/api/engine/cards-registry'
import { SEED_CARD_TYPES } from '@/lib/cards'

const load = vi.mocked(loadGameSlot)
const save = vi.mocked(saveGameSlot)
const apply = vi.mocked(applyCommandToSnapshot)

const SLOT = 'cardtypes:index'
const reg = (types: unknown) => ({ v: 1, types })

beforeEach(() => { vi.clearAllMocks() })

describe('readTypeRegistry — seed on first read', () => {
  it('seeds SEED_CARD_TYPES into the slot when the slot is empty', async () => {
    load.mockResolvedValue(undefined)
    const out = await readTypeRegistry()
    expect(out).toEqual({ v: 1, types: SEED_CARD_TYPES })
    expect(save).toHaveBeenCalledWith(SLOT, { v: 1, types: SEED_CARD_TYPES })
  })

  it('returns a stored registry as-is, WITHOUT re-saving (reads never churn the slot)', async () => {
    const stored = reg([{ id: 'puzzle', label: 'puzzle' }, { id: 'my-jam', label: 'my jam', desc: 'grown' }])
    load.mockResolvedValue(stored)
    const out = await readTypeRegistry()
    expect(out.types).toHaveLength(2)
    expect(out.types[1].id).toBe('my-jam')
    expect(save).not.toHaveBeenCalled()
  })

  it('re-seeds a malformed slot (wrong version / non-array / empty types)', async () => {
    for (const garbage of ['nonsense', { v: 2, types: [{ id: 'x2', label: 'x' }] }, reg('nope'), reg([])]) {
      vi.clearAllMocks()
      load.mockResolvedValue(garbage)
      const out = await readTypeRegistry()
      expect(out.types).toEqual(SEED_CARD_TYPES)
      expect(save).toHaveBeenCalledWith(SLOT, { v: 1, types: SEED_CARD_TYPES })
    }
  })

  it('degrades a half-corrupt slot to its well-formed rows (no reseed, no garbage served)', async () => {
    load.mockResolvedValue(reg([
      { id: 'puzzle', label: 'puzzle' },
      { id: 42, label: 'bad id' },          // malformed — dropped
      null,                                  // malformed — dropped
      { id: '', label: 'empty id' },         // malformed — dropped
      { label: 'no id at all' },             // malformed — dropped
    ]))
    const out = await readTypeRegistry()
    expect(out.types).toEqual([{ id: 'puzzle', label: 'puzzle' }])
    expect(save).not.toHaveBeenCalled()
  })
})

describe('handleCardTypes', () => {
  it('serves the vocabulary with a count', async () => {
    load.mockResolvedValue(reg([{ id: 'puzzle', label: 'puzzle' }]))
    const out = await handleCardTypes()
    expect(out.type).toBe('card_types')
    expect(out.count).toBe(1)
    expect(out.types).toEqual([{ id: 'puzzle', label: 'puzzle' }])
  })
})

describe('handleProposeCardType — growth + dedupe', () => {
  it('appends a new type (normalized id) and persists the grown registry', async () => {
    load.mockResolvedValue(reg([{ id: 'puzzle', label: 'puzzle' }]))
    const out = await handleProposeCardType({ label: '  Idle Clicker ', desc: 'numbers go up' })
    expect(out).toMatchObject({ ok: true, added: true, id: 'idle-clicker' })
    expect(save).toHaveBeenCalledTimes(1)
    const [slot, doc] = save.mock.calls[0]
    expect(slot).toBe(SLOT)
    expect((doc as { types: { id: string; desc?: string }[] }).types.map(t => t.id)).toEqual(['puzzle', 'idle-clicker'])
    expect((doc as { types: { desc?: string }[] }).types[1].desc).toBe('numbers go up')
  })

  it('dedupes an existing id: ok but not added, and the slot is NOT rewritten', async () => {
    load.mockResolvedValue(reg([{ id: 'idle-clicker', label: 'idle clicker' }]))
    const out = await handleProposeCardType({ label: 'IDLE   CLICKER' })   // normalizes to the same id
    expect(out).toMatchObject({ ok: true, added: false, id: 'idle-clicker' })
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses a missing label and a label that normalizes to nothing usable', async () => {
    load.mockResolvedValue(reg([{ id: 'puzzle', label: 'puzzle' }]))
    expect((await handleProposeCardType({})).ok).toBe(false)
    expect((await handleProposeCardType({ label: 42 })).ok).toBe(false)
    expect((await handleProposeCardType({ label: '!!!' })).ok).toBe(false)   // → '' after normalize
    expect((await handleProposeCardType({ label: 'ab' })).ok).toBe(false)    // < 3 chars
    expect(save).not.toHaveBeenCalled()
  })
})

describe('handleSetCard — validation against the LIVE registry', () => {
  const LIVE = reg([{ id: 'puzzle', label: 'puzzle' }, { id: 'action-dungeon', label: 'action dungeon' }])

  it('stamps worldData.card through the snapshot path on a valid cardType', async () => {
    load.mockResolvedValue(LIVE)
    const out = await handleSetCard('space_1', { type: 'set_card', cardType: 'Action Dungeon', tags: ['2D', 'Multiplayer', '2d'] })
    expect(out).toMatchObject({ ok: true, card: { type: 'action-dungeon', tags: ['2d', 'multiplayer'] } })
    expect(apply).toHaveBeenCalledWith('space_1', {
      type: 'set_world_data',
      data: { card: { type: 'action-dungeon', tags: ['2d', 'multiplayer'] } },
    })
  })

  it('accepts the nested card:{type,tags} shape too', async () => {
    load.mockResolvedValue(LIVE)
    const out = await handleSetCard('space_1', { type: 'set_card', card: { type: 'puzzle', tags: ['relaxing'] } })
    expect(out).toMatchObject({ ok: true, card: { type: 'puzzle', tags: ['relaxing'] } })
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('refuses a type outside the registry — and never writes the snapshot', async () => {
    load.mockResolvedValue(LIVE)
    const out = await handleSetCard('space_1', { type: 'set_card', cardType: 'definitely-not-a-type' })
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('not in the type list')
    expect(apply).not.toHaveBeenCalled()
  })

  it('never mistakes the bridge verb for the card type: bare {type:"set_card"} is a MISSING type', async () => {
    load.mockResolvedValue(LIVE)
    const out = await handleSetCard('space_1', { type: 'set_card' })
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('card.type is required')
    expect(apply).not.toHaveBeenCalled()
  })

  it('validates against the registry as it is NOW (a grown type is immediately usable)', async () => {
    load.mockResolvedValue(reg([...(LIVE.types as object[]), { id: 'idle-clicker', label: 'idle clicker' }]))
    const out = await handleSetCard('space_1', { type: 'set_card', cardType: 'idle-clicker' })
    expect(out).toMatchObject({ ok: true, card: { type: 'idle-clicker', tags: [] } })
  })
})
