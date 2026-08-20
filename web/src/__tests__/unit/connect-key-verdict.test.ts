import { describe, it, expect } from 'vitest'
import { cachedKeyVerdict, type KeyState } from '@/app/ConnectAiPanel'

const KEY = { prefix: 'uc_pt_93322d…', raw: 'uc_pt_93322dabcdef' }
const OLD = { prefix: 'uc_pt_d58dd7…', raw: 'uc_pt_d58dd7abcdef' }
const signedIn = (prefix?: string, extra: Partial<NonNullable<KeyState>> = {}): KeyState =>
  ({ signedIn: true, keys: prefix ? [{ prefix, createdAt: 'now' }] : [], ...extra })

describe('cachedKeyVerdict — when may the panel offer / purge the remembered key', () => {
  it('nothing cached → none', () => {
    expect(cachedKeyVerdict(null, signedIn(KEY.prefix))).toBe('none')
  })

  it('server confirms the cached key is active', () => {
    expect(cachedKeyVerdict(KEY, signedIn(KEY.prefix))).toBe('active')
  })

  it('prefix mismatch with a real signed-in answer PROVES staleness (the Aug 20 flip)', () => {
    expect(cachedKeyVerdict(OLD, signedIn(KEY.prefix))).toBe('stale')
  })

  it('signed in with NO active key: any cached key is revoked → stale', () => {
    expect(cachedKeyVerdict(OLD, signedIn(undefined))).toBe('stale')
  })

  it('no server truth yet → unverified, never stale', () => {
    expect(cachedKeyVerdict(OLD, null)).toBe('unverified')
  })

  it('fetch failed → unverified — a non-answer must not purge', () => {
    expect(cachedKeyVerdict(OLD, { signedIn: false, keys: [], failed: true })).toBe('unverified')
  })

  it('DB degraded (signed in, keys unreadable) → unverified — the empty list is not evidence', () => {
    expect(cachedKeyVerdict(OLD, signedIn(undefined, { degraded: true }))).toBe('unverified')
  })

  it('signed out → unverified (the server cannot see the account keys)', () => {
    expect(cachedKeyVerdict(OLD, { signedIn: false, keys: [] })).toBe('unverified')
  })
})
