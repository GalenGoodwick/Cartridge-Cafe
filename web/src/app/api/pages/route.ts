import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { createPage, listOwnerPageIds, loadPageDoc } from '@/lib/pages'

export const dynamic = 'force-dynamic'

/** GET /api/pages — list the signed-in user's pages (summary only). */
export async function GET() {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const ids = await listOwnerPageIds(userId)
  const docs = await Promise.all(ids.map((id) => loadPageDoc(id)))
  const pages = docs
    .filter((d): d is NonNullable<typeof d> => !!d && d.ownerId === userId)
    .map((d) => ({
      id: d.id, title: d.title, slug: d.slug, published: d.published,
      blockCount: d.blocks.length, updatedAt: d.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return NextResponse.json({ pages })
}

/** POST /api/pages — create a new page for the signed-in user. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  if (await checkRateLimit('pages_write', userId)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const doc = await createPage(userId, { title: body?.title, blocks: body?.blocks })
  return NextResponse.json({ id: doc.id, doc })
}
