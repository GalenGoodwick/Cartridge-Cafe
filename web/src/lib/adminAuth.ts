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
  // Legacy parity is EXACT: the old code was `ENGINE_AGENT_TOKEN || ANTHROPIC_API_KEY`,
  // so the Anthropic key was accepted ONLY when the engine token was UNSET. Keeping
  // that short-circuit — a broader "either key" reading would newly promote a leaked
  // ANTHROPIC_API_KEY to admin in prod (adversarial review, Jul 24).
  if (opts.allowLegacyAnthropicKey && !t) {
    const a = process.env.ANTHROPIC_API_KEY
    if (a && bearer === a) return true
  }
  return false
}

/** Is THIS user id an admin? (session-free — for server code that has a userId
 *  but no request, e.g. membership tier.) Checks ADMIN_USER_IDS directly, then
 *  ADMIN_EMAILS via a lookup. Deliberately does NOT grant dev-everyone (unlike
 *  isAdmin) — so membership stays honest to test in dev with a non-admin account. */
export async function isAdminUserId(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const ids = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (ids.includes(userId)) return true
  const emails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!emails.length) return false
  try {
    const { prisma } = await import('@/lib/prisma')
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    return !!(u?.email && emails.includes(u.email.toLowerCase()))
  } catch { return false }
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
