import { describe, it, expect, vi } from 'vitest'

/** Guards the publish gate's card law (SEAM-B): a published world owes a valid
 *  card — mandatory type from the live registry. The check itself is pure
 *  (publishCardError), so the gate tests without the bridge. */
vi.mock('@/app/api/engine/store', () => ({
  loadGameSlot: vi.fn(async () => undefined),
  saveGameSlot: vi.fn(async () => {}),
}))
vi.mock('@/app/api/engine/space-store', () => ({
  applyCommandToSnapshot: vi.fn(async () => ({ ok: true })),
}))

import { publishCardError, type TypeRegistry } from '@/app/api/engine/cards-registry'

const REG: TypeRegistry = { v: 1, types: [{ id: 'platformer', label: 'platformer' }, { id: 'action-dungeon', label: 'action dungeon' }] }

describe('publishCardError — the mandatory-type law', () => {
  it('no card at all → the refusal teaches the fix (card_types → set_card)', () => {
    const err = publishCardError({}, REG)
    expect(err).toMatch(/card_types/)
    expect(err).toMatch(/set_card/)
  })

  it('a type outside the registry → refused with the growth path', () => {
    const err = publishCardError({ card: { type: 'zeppelin-farming' } }, REG)
    expect(err).toMatch(/not in the type list/)
    expect(err).toMatch(/propose_card_type/)
  })

  it('a valid card passes (normalization applied: label form → id form)', () => {
    expect(publishCardError({ card: { type: 'action dungeon', tags: ['2d'] } }, REG)).toBeNull()
    expect(publishCardError({ card: { type: 'platformer' } }, REG)).toBeNull()
  })

  it('a malformed card value is a refusal, never a crash', () => {
    expect(publishCardError({ card: 'platformer' }, REG)).toMatch(/card_types/)
    expect(publishCardError({ card: { type: 42 } }, REG)).toMatch(/required/)
  })
})
