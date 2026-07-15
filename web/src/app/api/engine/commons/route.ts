import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { addCommonsListener } from '../commons-stream'
import { loadGameSlot } from '../store'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // SSE can stay open

/**
 * GET /api/engine/commons?sub=<slug>
 * SSE stream of a commons channel — replays recent messages, then pushes each
 * new one live. No `sub` = the whole-cafe commons (commons:main). Open to any
 * signed-in user or token-bearing AI (reading the commons is not sensitive).
 * The bridge's `main_say` broadcasts onto this stream.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const hasToken = req.headers.get('authorization')?.startsWith('Bearer ')
    const session = await getServerSession(authOptions)
    if (!hasToken && !session?.user?.id) {
      return NextResponse.json({ error: 'Sign in or connect with a token' }, { status: 401 })
    }
  }

  const subParam = req.nextUrl.searchParams.get('sub')
  const sub = subParam ? subParam.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) : null
  const channel = sub ? 'commons:sub:' + sub : 'commons:main'

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); return true }
        catch { return false }
      }
      send({ type: 'connected', channel })

      // replay the recent tail so a fresh subscriber has context
      const doc = (await loadGameSlot(channel)) as { msgs?: unknown[] } | undefined
      const recent = Array.isArray(doc?.msgs) ? doc!.msgs!.slice(-30) : []
      for (const m of recent) send({ type: 'msg', msg: m })

      const remove = addCommonsListener(channel, (msg) => { if (!send({ type: 'msg', msg })) remove() })
      const heartbeat = setInterval(() => { if (!send({ type: 'ping' })) { clearInterval(heartbeat); remove() } }, 15000)
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat); remove()
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' },
  })
}
