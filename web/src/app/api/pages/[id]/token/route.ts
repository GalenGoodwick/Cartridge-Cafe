import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireOwner } from '@/lib/page-auth'
import { mintPageToken, revokePageToken } from '@/lib/pages'

export const dynamic = 'force-dynamic'

/** POST /api/pages/:id/token — owner mints a page-author token for a connected
 *  AI. The raw `uc_page_…` value is returned exactly ONCE (only its hash is
 *  stored); the connected AI uses it as a Bearer token to GET/PUT the page. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await requireOwner(id)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })

  if (await checkRateLimit('pages_write', a.userId)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name : 'connected AI'
  const token = await mintPageToken(id, a.userId, name)
  return NextResponse.json({ token })
}

/** DELETE /api/pages/:id/token {token} — revoke a page-author token. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await requireOwner(id)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const body = await req.json().catch(() => ({}))
  const token = String(body?.token ?? '')
  if (token.startsWith('uc_page_')) await revokePageToken(token)
  return NextResponse.json({ ok: true })
}
