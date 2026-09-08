import { describe, it, expect } from 'vitest'
import type { NextRequest } from 'next/server'
import { tokenTag, authorize } from '@/app/api/engine/bridge-auth'

// Item 4/#7 — first module carved off the bridge monolith. These pin the
// DB-free half of the auth contract (classification + rejections); the
// DB-backed token paths are exercised by every live bridge smoke.

const reqWith = (header?: string): NextRequest =>
  ({ headers: { get: (k: string) => (k === 'authorization' ? header ?? null : null) } } as unknown as NextRequest)

describe('tokenTag — stable, non-reversible caller tags', () => {
  it('classifies every token family by prefix', () => {
    expect(tokenTag('Bearer uc_st_abc123')).toMatch(/^space:[0-9a-f]{8}$/)
    expect(tokenTag('Bearer uc_pt_abc123')).toMatch(/^player:[0-9a-f]{8}$/)
    expect(tokenTag('Bearer uc_it_abc123')).toMatch(/^icon:[0-9a-f]{8}$/)
    expect(tokenTag('Bearer something-else')).toMatch(/^other:[0-9a-f]{8}$/)
  })

  it('same token → same tag; different token → different tag (and no raw token leaks)', () => {
    const a = tokenTag('Bearer uc_st_aaaa'), b = tokenTag('Bearer uc_st_aaaa'), c = tokenTag('Bearer uc_st_bbbb')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toContain('aaaa')
  })
})

describe('authorize — rejection paths (no DB needed)', () => {
  it('no header / non-Bearer / empty → unauthorized, global-null scope', async () => {
    for (const h of [undefined, '', 'Basic xyz', 'Bearer']) {
      const a = await authorize(reqWith(h))
      expect(a).toEqual({ authorized: false, spaceId: null, ownerId: null })
    }
  })

  it('an unknown-prefix token that is not the admin token → unauthorized', async () => {
    const a = await authorize(reqWith('Bearer not-a-real-credential'))
    expect(a.authorized).toBe(false)
  })

  it('a malformed scene token → unauthorized (stateless validation)', async () => {
    const a = await authorize(reqWith('Bearer uc_sc_garbage'))
    expect(a.authorized).toBe(false)
  })
})
