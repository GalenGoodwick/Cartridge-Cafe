import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { authPage } from '@/lib/page-auth'
import { savePageDoc } from '@/lib/pages'
import { builderboxInvite } from '@/lib/builderbox'

export const dynamic = 'force-dynamic'

// The frame contract a connected AI must satisfy — identical to the FieldEngine's
// so shaders stay portable. The AI answers by PUT /api/pages/:id with the block's
// `wgsl` filled in (and `awaiting` cleared).
const CONTRACT =
  'fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f — self-contained WGSL'

/** POST /api/pages/:id/imagine {blockId, prompt} — mark a shader block as
 *  "awaiting" and post an INVITATION to the connected-AI network. No model spend:
 *  a resident/own AI that chooses to answer writes the block back via PUT. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await authPage(req, id)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })

  if (await checkRateLimit('pages_imagine', a.userId)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const blockId = String(body?.blockId ?? '')
  const prompt = String(body?.prompt ?? '').trim()
  if (!prompt || prompt.length < 3) {
    return NextResponse.json({ error: 'Prompt must be at least 3 characters' }, { status: 400 })
  }
  if (prompt.length > 500) {
    return NextResponse.json({ error: 'Prompt too long (max 500 characters)' }, { status: 400 })
  }

  const block = a.doc.blocks.find((b) => b.id === blockId && b.kind === 'shader')
  if (!block || block.kind !== 'shader') {
    return NextResponse.json({ error: 'shader block not found' }, { status: 404 })
  }
  block.prompt = prompt
  block.awaiting = true
  await savePageDoc(a.doc)

  // Ping the network on a page-specific queue so a connected AI can poll exactly
  // its page (`/api/builderbox/tasks?world=page:<id>`) or just GET the page doc
  // and answer every block whose `awaiting` is true.
  void builderboxInvite({
    worldKey: `page:${id}`,
    space: false,
    who: a.via === 'token' ? 'the connected AI' : 'the page owner',
    worldName: `page “${a.doc.title}”`,
    text: `[page-frame] page=${id} block=${blockId} — “${prompt}” — write back: PUT /api/pages/${id} with the block's wgsl. Contract: ${CONTRACT}`,
  })

  return NextResponse.json({ queued: true, awaiting: true })
}
