import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { authPage, requireOwner } from '@/lib/page-auth'
import {
  savePageDoc, deletePage, sanitizeBlocks, syncPublishedSnapshot, publishPage,
  autoSlug, MAX_TITLE,
  type Block,
} from '@/lib/pages'

/** Merge guard for whole-document PUTs: if the CLIENT still thinks a shader
 *  block is `awaiting` but the SERVER copy has been answered (an AI wrote wgsl
 *  and cleared the flag since the client's last fetch), keep the server block —
 *  otherwise the owner's debounced autosave silently destroys the AI's work
 *  and the frame shows "awaiting your AI…" forever. */
function keepAnsweredFrames(incoming: Block[], current: Block[]): Block[] {
  return incoming.map((b) => {
    if (b.kind !== 'shader' || !b.awaiting) return b
    const server = current.find((s) => s.id === b.id && s.kind === 'shader')
    if (server && server.kind === 'shader' && !server.awaiting && server.wgsl !== b.wgsl) return server
    return b
  })
}

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
  if (Array.isArray(body.blocks)) {
    doc.blocks = keepAnsweredFrames(sanitizeBlocks(body.blocks), doc.blocks)
  }

  if (!doc.slug) {
    // legacy draft from the pre-live model — a page IS its live URL now; the
    // first save mints its auto address and takes it live (unclaimed).
    doc.claimed = doc.claimed ?? false
    await publishPage(doc, await autoSlug(doc.title, doc.id))
  } else {
    await savePageDoc(doc)
    // The page is LIVE BY DESIGN — every edit (owner or connected AI) lands on
    // /p/<slug> immediately, exactly like AI-built worlds edit live. The owner
    // chose to hand the token over; sanitation + revocation are the guardrails.
    await syncPublishedSnapshot(doc)
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
