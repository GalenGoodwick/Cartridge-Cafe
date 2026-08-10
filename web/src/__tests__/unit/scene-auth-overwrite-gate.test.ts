import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// mayWriteScene resolves the caller from the NextAuth session — mock it per-case.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
import { getServerSession } from 'next-auth'
import { mayWriteScene } from '@/app/api/engine/scene-auth'

// a request with no admin token → authority comes purely from the session
const req = (auth: string | null = null) =>
  ({ headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? auth : null) } }) as unknown as Parameters<typeof mayWriteScene>[0]
const asUser = (email: string | null) =>
  (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(email ? { user: { email } } : null)

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')   // the auth logic is a dev no-op; exercise the real prod rules
  vi.stubEnv('ADMIN_EMAILS', 'boss@cartridge.cafe')
})
afterAll(() => { vi.unstubAllEnvs() })

describe('overwrite-in-place gate: mayWriteScene(_, name, "govern")', () => {
  it('DENIES a guest govern (overwrite) on a canonical house world — the fork can never be skipped', async () => {
    asUser('rando@guest.cartridge.cafe')
    expect(await mayWriteScene(req(), 'globewarp', 'govern')).toBe(false)
  })

  it('still ALLOWS a guest to WRITE (fork-save) that same house world — open ground intact', async () => {
    asUser('rando@guest.cartridge.cafe')
    expect(await mayWriteScene(req(), 'globewarp', 'write')).toBe(true)
  })

  it('ALLOWS an admin to govern (overwrite the head of) a canonical house world', async () => {
    asUser('boss@cartridge.cafe')
    expect(await mayWriteScene(req(), 'globewarp', 'govern')).toBe(true)
  })

  it('ALLOWS a user to govern their OWN branch, DENIES someone else’s', async () => {
    asUser('alice@example.com')
    expect(await mayWriteScene(req(), 'globewarp ⑂ alice · v2', 'govern')).toBe(true)
    expect(await mayWriteScene(req(), 'globewarp ⑂ bob · v2', 'govern')).toBe(false)
  })
})
