import { beforeEach, describe, expect, it, vi } from 'vitest'

const kv = new Map<string, Record<string, unknown>>()
vi.mock('@/app/api/engine/store', () => ({
  loadGameSlot: async (k: string) => kv.get(k),
  saveGameSlot: async (k: string, v: Record<string, unknown>) => { kv.set(k, v) },
}))

import { normalizeHandle, registerCompany, getCompanyByHandle, getCompanyByOwner, listCompanies, unregisterCompany } from '@/lib/company'

describe('normalizeHandle', () => {
  it('lowercases and strips junk', () => {
    expect(normalizeHandle('Fortis')).toBe('fortis')
    expect(normalizeHandle('  Acme Corp! ')).toBe('acmecorp')
  })
  it('rejects too short, too long, edge dashes, reserved', () => {
    expect(normalizeHandle('a')).toBeNull()
    expect(normalizeHandle('x'.repeat(33))).toBeNull()
    expect(normalizeHandle('-fortis')).toBeNull()
    expect(normalizeHandle('fortis-')).toBeNull()
    expect(normalizeHandle('admin')).toBeNull()
    expect(normalizeHandle('api')).toBeNull()
    expect(normalizeHandle('www')).toBeNull()
  })
})

describe('company registry', () => {
  beforeEach(() => kv.clear())

  it('provisions a chosen handle bound to an owner (not the email username)', async () => {
    const r = await registerCompany({ handle: 'fortis', ownerId: 'u1', name: 'FORTIS', by: 'admin' })
    expect(r.ok).toBe(true)
    const c = await getCompanyByHandle('fortis')
    expect(c?.ownerId).toBe('u1')
    expect(c?.name).toBe('FORTIS')
    expect((await getCompanyByOwner('u1'))?.handle).toBe('fortis')
    expect((await listCompanies()).length).toBe(1)
  })

  it('refuses to steal a handle held by a different owner', async () => {
    await registerCompany({ handle: 'fortis', ownerId: 'u1', name: 'FORTIS', by: 'admin' })
    const r2 = await registerCompany({ handle: 'fortis', ownerId: 'u2', name: 'IMPOSTER', by: 'admin' })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.status).toBe(409)
    expect((await getCompanyByHandle('fortis'))?.ownerId).toBe('u1')  // unchanged
  })

  it('re-provisioning the same owner updates name/domain and keeps first timestamp', async () => {
    const a = await registerCompany({ handle: 'fortis', ownerId: 'u1', name: 'FORTIS', by: 'admin' })
    const firstAt = a.ok ? a.company.at : 0
    const b = await registerCompany({ handle: 'fortis', ownerId: 'u1', name: 'FORTIS INC', domain: 'play.fortis.com', by: 'admin' })
    expect(b.ok).toBe(true)
    const c = await getCompanyByHandle('fortis')
    expect(c?.name).toBe('FORTIS INC')
    expect(c?.domain).toBe('play.fortis.com')
    expect(c?.at).toBe(firstAt)
  })

  it('rejects an invalid handle before touching storage', async () => {
    const r = await registerCompany({ handle: 'admin', ownerId: 'u1', name: 'X', by: 'admin' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
    expect(await listCompanies()).toEqual([])
  })

  it('deprovision releases the handle and drops it from the index', async () => {
    await registerCompany({ handle: 'fortis', ownerId: 'u1', name: 'FORTIS', by: 'admin' })
    expect(await unregisterCompany('fortis')).toBe(true)
    expect(await getCompanyByHandle('fortis')).toBeNull()
    expect(await listCompanies()).toEqual([])
  })

  it('sanitizes a custom domain', async () => {
    const r = await registerCompany({ handle: 'fortis', ownerId: 'u1', name: 'FORTIS', domain: 'HTTPS://Play.Fortis.com/', by: 'admin' })
    expect(r.ok && r.company.domain).toBe('play.fortis.com')
  })
})
