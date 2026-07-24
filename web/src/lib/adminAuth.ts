import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/** The cafe's keeper. Admin = a session whose user id is named in
 *  ADMIN_USER_IDS (comma-separated), or anyone in dev, or the engine agent
 *  token on the Authorization header (so the resident AI can tend the shelf). */
/** ONE truth for "is this bearer the admin/house engine token" (audit #6 —
 *  this check was copy-pasted in 12 places; change admin policy HERE only).
 *  `allowLegacyAnthropicKey` preserves the three routes that historically also
 *  accepted ANTHROPIC_API_KEY as admin (state, save-snapshot, bridge) — kill
 *  that flag deliberately, not by refactor. */
export function isAdminToken(authHeader?: string | null, opts: { allowLegacyAnthropicKey?: boolean } = {}): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false
  const bearer = authHeader.slice(7)
  const t = process.env.ENGINE_AGENT_TOKEN
  if (t && bearer === t) return true
  if (opts.allowLegacyAnthropicKey) {
    const a = process.env.ANTHROPIC_API_KEY
    if (a && bearer === a) return true
  }
  return false
}

export async function isAdmin(authHeader?: string | null): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  if (isAdminToken(authHeader)) return true
  const ids = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  const emails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!ids.length && !emails.length) return false
  const session = await getServerSession(authOptions)
  const u = session?.user as { id?: string; email?: string } | undefined
  return !!(u && ((u.id && ids.includes(u.id)) || (u.email && emails.includes(u.email.toLowerCase()))))
}
