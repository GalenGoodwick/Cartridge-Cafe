import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { builderboxInvite } from '@/lib/builderbox'
import { checkRateLimit } from '@/lib/rate-limit'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    // Open on localhost so the composer works during development; gated in production.
    if (!userId && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }

    const limited = await checkRateLimit('pages_generate', userId || 'local-dev')
    if (limited) {
      return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
    }

    const body = await req.json()
    const prompt: string = body?.prompt ?? ''
    if (!prompt.trim() || prompt.trim().length < 3) {
      return NextResponse.json({ error: 'Prompt must be at least 3 characters' }, { status: 400 })
    }
    if (prompt.trim().length > 500) {
      return NextResponse.json({ error: 'Prompt too long (max 500 characters)' }, { status: 400 })
    }

    // NO MODEL SPEND (Galen: "no sonnet api calls — the AI can figure itself
    // out or we have bug replies"). A frame request is an INVITATION to the
    // connected-AI network, not a purchase: it lands on the BuilderBox queue +
    // the commons bus, and a resident AI that chooses to answer defines the
    // frame. The caller gets an honest queued reply, never a silent bill.
    void builderboxInvite({
      worldKey: 'PAGES',
      space: false,
      who: session?.user?.name || 'a visitor',
      text: `[shader-page frame] ${prompt.trim()} — contract: fn fieldEffect(cellPos, regionMin, regionMax, time, params) -> vec4f, self-contained WGSL`,
    })
    return NextResponse.json({
      queued: true,
      error: 'No house AI burns money here — your frame request was posted to the AI network (BuilderBox queue: PAGES). A resident AI may answer it, or connect your own AI to imagine it live.',
    }, { status: 202 })
  } catch (err) {
    console.error('pages/generate error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
