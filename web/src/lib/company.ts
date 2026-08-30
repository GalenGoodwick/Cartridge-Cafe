import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'

// ---- COMPANY REGISTRY (Galen, Aug 30: admin provisioning for proprietary/
// white-label customers). A company is a CHOSEN handle bound to an owner
// account that holds IP control — NOT the email local-part the old /c page
// guessed at. Same KV-slot pattern as entitlements: no migration, prod-safe at
// first touch. Enterprise is high-touch: the keeper provisions here, bills by
// Stripe invoice (net-30), and the customer's door lights up immediately.

export interface CompanyRecord {
  handle: string          // the chosen slug — /c/<handle> and <handle>.cartridge.cafe
  ownerId: string         // the account that owns the company (holds IP control)
  name: string            // display name (FORTIS)
  domain?: string         // optional custom domain, once DNS is pointed
  at: number
  by: string              // admin user id who provisioned it
}

const RESERVED = new Set([
  'www', 'api', 'admin', 'grid', 'account', 'suite', 'c', 'space', 'spaces',
  'auth', 'create', 'pages', 'commons', 'app', 'assets', 'static', 'cdn',
  'mail', 'blog', 'help', 'status', 'dev', 'staging', 'test',
])

const slot = (handle: string) => 'company:' + handle
const INDEX_SLOT = 'company:index'

/** Validate/normalize a chosen handle → the slug, or null if unusable. */
export function normalizeHandle(raw: string): string | null {
  const h = (raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (h.length < 2 || h.length > 32) return null
  if (h.startsWith('-') || h.endsWith('-')) return null
  if (RESERVED.has(h)) return null
  return h
}

/** A bare host: drop any scheme, path, or port, keep host chars only. */
function normalizeDomain(raw?: string): string | undefined {
  if (!raw) return undefined
  const host = raw.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '')   // strip scheme
    .replace(/\/.*$/, '')          // strip path
    .replace(/:.*$/, '')           // strip port
    .replace(/[^a-z0-9.-]/g, '')
  return host || undefined
}

export async function getCompanyByHandle(handle: string): Promise<CompanyRecord | null> {
  const h = normalizeHandle(handle)
  if (!h) return null
  const doc = (await loadGameSlot(slot(h))) as CompanyRecord | undefined
  return doc?.handle ? doc : null
}

export async function listCompanies(): Promise<CompanyRecord[]> {
  const idx = ((await loadGameSlot(INDEX_SLOT)) ?? {}) as { handles?: string[] }
  const handles = Array.isArray(idx.handles) ? idx.handles : []
  const out: CompanyRecord[] = []
  for (const h of handles) {
    const doc = (await loadGameSlot(slot(h))) as CompanyRecord | undefined
    if (doc?.handle) out.push(doc)
  }
  return out.sort((a, b) => b.at - a.at)
}

export async function getCompanyByOwner(ownerId: string): Promise<CompanyRecord | null> {
  const all = await listCompanies()
  return all.find((c) => c.ownerId === ownerId) ?? null
}

export type ProvisionResult =
  | { ok: true; company: CompanyRecord }
  | { ok: false; error: string; status: number }

/** Bind a handle to an owner. Refuses to steal a handle already held by a
 *  different owner. Re-provisioning the same (handle, owner) updates name/domain. */
export async function registerCompany(opts: {
  handle: string; ownerId: string; name: string; domain?: string; by: string
}): Promise<ProvisionResult> {
  const handle = normalizeHandle(opts.handle)
  if (!handle) return { ok: false, error: 'handle must be 2–32 chars, a–z 0–9 and dashes, not a reserved word', status: 400 }
  const existing = (await loadGameSlot(slot(handle))) as CompanyRecord | undefined
  if (existing?.handle && existing.ownerId !== opts.ownerId) {
    return { ok: false, error: `handle "${handle}" is already held by another account`, status: 409 }
  }
  const record: CompanyRecord = {
    handle,
    ownerId: opts.ownerId,
    name: (opts.name || handle).trim().slice(0, 60),
    domain: normalizeDomain(opts.domain),
    at: existing?.at ?? Date.now(),
    by: opts.by,
  }
  await saveGameSlot(slot(handle), record as unknown as Record<string, unknown>)
  const idx = ((await loadGameSlot(INDEX_SLOT)) ?? {}) as { handles?: string[] }
  const handles = new Set(Array.isArray(idx.handles) ? idx.handles : [])
  handles.add(handle)
  await saveGameSlot(INDEX_SLOT, { handles: [...handles].slice(-500) })
  return { ok: true, company: record }
}

/** Release a handle (the IP-control entitlement is revoked separately). */
export async function unregisterCompany(handle: string): Promise<boolean> {
  const h = normalizeHandle(handle)
  if (!h) return false
  await saveGameSlot(slot(h), {} as Record<string, unknown>)
  const idx = ((await loadGameSlot(INDEX_SLOT)) ?? {}) as { handles?: string[] }
  const handles = (Array.isArray(idx.handles) ? idx.handles : []).filter((x) => x !== h)
  await saveGameSlot(INDEX_SLOT, { handles })
  return true
}
