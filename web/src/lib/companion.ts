import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

// Companion keys — a persistent AI identity's OWN personal credential.
//   uc_ck_  — the companion's personal key (identity; create + tend its own worlds)
//   uc_st_  — a world-scoped token (minted per world the companion creates)
// Mirrors the SpaceToken pattern: raw key shown once, only its SHA-256 is stored.

export interface CompanionAuth {
  companionId: string
  name: string
  handle: string
  ownerId: string
  worldsPerDay: number
}

/** Resolve a raw uc_ck_ personal key → the companion identity, or null. */
export async function validateCompanionKey(rawToken: string): Promise<CompanionAuth | null> {
  if (!rawToken || !rawToken.startsWith('uc_ck_')) return null
  const keyHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const c = await prisma.companion.findUnique({ where: { keyHash } })
  if (!c || c.revokedAt) return null
  // fire-and-forget: stamp activity
  prisma.companion.update({ where: { id: c.id }, data: { lastActiveAt: new Date() } }).catch(() => {})
  return { companionId: c.id, name: c.name, handle: c.handle, ownerId: c.ownerId, worldsPerDay: c.worldsPerDay }
}

export function mintCompanionKey() {
  const raw = `uc_ck_${crypto.randomBytes(16).toString('hex')}`
  return { raw, keyHash: crypto.createHash('sha256').update(raw).digest('hex'), keyPrefix: raw.slice(0, 12) + '...' }
}

export function mintSpaceToken() {
  const raw = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  return { raw, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.slice(0, 12) + '...' }
}

/** Extract a Bearer token from a request's Authorization header. */
export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization')
  if (!h?.startsWith('Bearer ')) return null
  return h.slice(7).trim()
}

/** slugify → lowercase, dash-separated, ≤60 chars */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}
