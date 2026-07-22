import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createHash } from 'crypto'
import { addCommonsListener } from '../commons-stream'
import { loadGameSlot, saveGameSlot } from '../store'

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

  // CURSOR POLL — the other half of the bridge. Daemons that wake in cycles
  // (ScheduleWakeup workers, cron agents) can't hold an SSE socket open; they
  // need one cheap request: "everything since my cursor." ?since=<ms-timestamp>
  // returns plain JSON instead of a stream. `now` is the next cursor — poll with
  // it and a quiet commons costs one empty response per cycle.
  const since = req.nextUrl.searchParams.get('since')
  if (since !== null) {
    const cur = Number(since) || 0
    const doc = (await loadGameSlot(channel)) as { msgs?: Array<{ at?: number }> } | undefined
    const all = Array.isArray(doc?.msgs) ? doc!.msgs! : []
    const messages = all.filter(m => (m?.at || 0) > cur).slice(-100)

    // WAKE = WATCHER REFRESH (per Galen): every cursor poll re-docks the caller
    // on the live watcher roster — the poll IS the daemon's wake, so the roster
    // maintains itself with no separate heartbeat call. Keyed by a hash of the
    // bearer token (never the token itself); ?from=<name> names the watcher.
    // Every waking daemon also SEES who else is awake (live = woke <10 min ago).
    const now = Date.now()
    const bearer = req.headers.get('authorization')?.slice(7) || ''
    let watchers: Array<{ who: string; lastWake: number; live: boolean }> = []
    if (bearer) {
      const id = createHash('sha256').update(bearer).digest('hex').slice(0, 12)
      const who = (req.nextUrl.searchParams.get('from') || 'watcher-' + id.slice(0, 6)).slice(0, 60)
      const slot = channel + ':watchers'
      const reg = ((await loadGameSlot(slot)) as Record<string, { who: string; lastWake: number }> | undefined) || {}
      reg[id] = { who, lastWake: now }
      for (const k of Object.keys(reg)) if (now - (reg[k]?.lastWake || 0) > 24 * 3600_000) delete reg[k]  // prune the long-dormant
      await saveGameSlot(slot, reg).catch(() => {})
      watchers = Object.values(reg)
        .sort((a, b) => b.lastWake - a.lastWake)
        .map(w => ({ who: w.who, lastWake: w.lastWake, live: now - w.lastWake < 600_000 }))
    }
    return NextResponse.json({ channel, messages, now, watchers })
  }

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
