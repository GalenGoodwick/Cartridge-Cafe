import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/** The cafe's keeper. Admin = a session whose user id is named in
 *  ADMIN_USER_IDS (comma-separated), or anyone in dev, or the engine agent
 *  token on the Authorization header (so the resident AI can tend the shelf). */
export async function isAdmin(authHeader?: string | null): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  if (authHeader?.startsWith('Bearer ')) {
    const t = process.env.ENGINE_AGENT_TOKEN
    if (t && authHeader.slice(7) === t) return true
  }
  const ids = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  const emails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!ids.length && !emails.length) return false
  const session = await getServerSession(authOptions)
  const u = session?.user as { id?: string; email?: string } | undefined
  return !!(u && ((u.id && ids.includes(u.id)) || (u.email && emails.includes(u.email.toLowerCase()))))
}
