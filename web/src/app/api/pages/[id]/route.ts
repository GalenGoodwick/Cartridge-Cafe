import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { authPage, requireOwner } from '@/lib/page-auth'
import { savePageDoc, deletePage, sanitizeBlocks, MAX_TITLE, publicView } from '@/lib/pages'

export const dynamic = 'force-dynamic'

/** GET /api/pages/:id — load the working draft (owner session or page token). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await authPage(req, id)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  return NextResponse.json({ doc: a.doc })
}

/** PUT /api/pages/:id — patch title/blocks (owner OR connected AI via token).
 *  Blocks are re-sanitized server-side: unknown kinds, empty content, and WGSL
 *  freeze-hazards are stripped before anything is stored. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await authPage(req, id)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })

  // AI writes (token) get the tighter budget; owner autosave the looser one.
  const bucket = a.via === 'token' ? 'pages_ai_write' : 'pages_write'
  if (await checkRateLimit(bucket, a.userId)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const doc = a.doc
  if (typeof body.title === 'string') doc.title = body.title.slice(0, MAX_TITLE) || doc.title
  if (Array.isArray(body.blocks)) doc.blocks = sanitizeBlocks(body.blocks)
  await savePageDoc(doc)

  // Keep a live published page in sync when its owner edits after publishing —
  // they already paid for this slug, so a re-save just refreshes the snapshot.
  if (doc.published && doc.slug) {
    const { saveGameSlot } = await import('@/app/api/engine/store')
    await saveGameSlot(`page:pub:${doc.slug}`, publicView(doc))
  }
  return NextResponse.json({ doc })
}

/** DELETE /api/pages/:id — owner only. Removes draft, published copy, slug. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await requireOwner(id)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  await deletePage(a.doc)
  return NextResponse.json({ ok: true })
}
