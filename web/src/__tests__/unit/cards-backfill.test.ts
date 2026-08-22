import { describe, it, expect, vi } from 'vitest'

/** Guards the type backfill's classifier: worlds are typed from their own
 *  words, uncertainty is FLAGGED (defaulted to 'toy'), never silent. */
vi.mock('@/lib/prisma', () => {
  const prisma = { playerSpace: { findMany: vi.fn() } }
  return { prisma, default: prisma }
})
vi.mock('@/app/api/engine/space-store', () => ({
  getSpaceSnapshot: vi.fn(async () => null),
  setSpaceSnapshot: vi.fn(async () => {}),
}))
vi.mock('@/app/api/engine/cards-registry', () => ({
  readTypeRegistry: vi.fn(async () => ({ v: 1, types: [] })),
}))

import { classifyType } from '@/app/api/admin/backfill-card-types/route'
import { SEED_CARD_TYPES } from '@/lib/cards'

describe('classifyType — worlds typed from their own words', () => {
  it('reads the obvious genres confidently', () => {
    expect(classifyType('grab stretch and fling the doggo to bounce across platforms', SEED_CARD_TYPES))
      .toEqual({ type: 'platformer', confident: true })
    expect(classifyType('a Riven-style island of puzzles — solve the tide mystery', SEED_CARD_TYPES))
      .toEqual({ type: 'puzzle', confident: true })
    expect(classifyType('raymarched demon dungeon crawl, rooms of monsters', SEED_CARD_TYPES))
      .toEqual({ type: 'action-dungeon', confident: true })
    expect(classifyType('an io arena — multiplayer versus in one pool', SEED_CARD_TYPES))
      .toEqual({ type: 'arena', confident: true })
  })

  it('a type label itself counts as a signal', () => {
    expect(classifyType('a little roguelike about tea', SEED_CARD_TYPES).type).toBe('roguelike')
  })

  it('no signal at all → the uncertain default, flagged not confident', () => {
    const out = classifyType('untitled scribbles 2024', SEED_CARD_TYPES)
    expect(out.type).toBe('toy')
    expect(out.confident).toBe(false)
  })

  it('an empty registry cannot crash the sweep', () => {
    expect(classifyType('anything', []).type).toBe('toy')
  })
})
