// Shared authorization for page routes: a page may be edited by its OWNER
// (browser session) or by a CONNECTED AI holding a `uc_page_…` bearer token
// scoped to that exact page. Everything funnels through here so the two paths
// can never drift apart.
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadPageDoc, verifyPageToken, type PageDoc } from '@/lib/pages'

export type PageAuth =
  | { ok: true; doc: PageDoc; via: 'owner' | 'token'; userId: string }
  | { ok: false; status: number; error: string }

export async function authPage(req: NextRequest, id: string): Promise<PageAuth> {
  const doc = await loadPageDoc(id)
  if (!doc) return { ok: false, status: 404, error: 'page not found' }

  const auth = req.headers.get('authorization') || ''
  if (auth.startsWith('Bearer ')) {
    const rec = await verifyPageToken(auth.slice(7).trim())
    if (rec && rec.pageId === id) return { ok: true, doc, via: 'token', userId: rec.ownerId }
    return { ok: false, status: 403, error: 'invalid page token' }
  }

  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (userId && userId === doc.ownerId) return { ok: true, doc, via: 'owner', userId }
  return { ok: false, status: 401, error: 'not authorized for this page' }
}

/** Owner-only gate (publish, token mint, delete): rejects page-token callers. */
export async function requireOwner(id: string): Promise<PageAuth> {
  const doc = await loadPageDoc(id)
  if (!doc) return { ok: false, status: 404, error: 'page not found' }
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return { ok: false, status: 401, error: 'sign in required' }
  if (userId !== doc.ownerId) return { ok: false, status: 403, error: 'only the owner can do that' }
  return { ok: true, doc, via: 'owner', userId }
}
