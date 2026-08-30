import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// TAB-AS-EYE (render_probe → live tab): the bridge queues a probe_frame through
// the agent POST, gates on the reported per-space listener count, then awaits
// the tab's answer via waitForCommandResult. These tests drive the REAL agent
// route handler + store waiter plumbing — the exact path the bridge branch uses
// — with a fake SSE tab standing where a browser would.

// agent route imports next-auth + authOptions (→ prisma) for its session
// fallback; the bearer-token path under test never touches them.
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import type { NextRequest } from 'next/server'
import { POST } from '@/app/api/engine/agent/route'
import { postCommandResult, waitForCommandResult } from '@/app/api/engine/store'

type QueueEntry = { id: string; command: Record<string, unknown>; timestamp: number }
const g = globalThis as unknown as {
  __engineSSEListeners?: Set<(entry: QueueEntry) => void>
  __spaceSSEListeners?: Map<string, Set<(entry: QueueEntry) => void>>
  __spaceCommandQueues?: Map<string, QueueEntry[]>
}

const req = (body: unknown): NextRequest =>
  ({
    headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer test-engine-token' : null) },
    json: async () => body,
  }) as unknown as NextRequest

beforeEach(() => {
  vi.stubEnv('ENGINE_AGENT_TOKEN', 'test-engine-token')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('probe_frame through the agent queue (the tab-as-eye transport)', () => {
  it('routes to the SPACE channel, reports THAT space\'s listener count, and never queues for replay', async () => {
    const spaceId = `sp_probe_${Date.now()}`
    const seen: QueueEntry[] = []
    // a fake live tab on this world — where the browser's EventSource would sit
    g.__spaceSSEListeners ??= new Map()
    g.__spaceSSEListeners.set(spaceId, new Set([e => seen.push(e)]))

    const res = await POST(req({ type: 'probe_frame', __spaceId: spaceId }))
    const body = await res.json()

    expect(body.queued).toBe(1)
    expect(body.listeners).toBe(1)                       // the SPACE's tab — not the global set
    expect(seen).toHaveLength(1)                         // the tab received the live broadcast
    expect(seen[0].command).toEqual({ type: 'probe_frame' })  // __spaceId stripped
    expect(seen[0].id).toBe(body.commands[0].id)         // same id the bridge will await on
    // NO_REPLAY: a reconnecting tab must never replay a stale probe against a dead command id
    expect((g.__spaceCommandQueues?.get(spaceId) ?? []).some(e => (e.command as { type?: string }).type === 'probe_frame')).toBe(false)

    g.__spaceSSEListeners.delete(spaceId)
  })

  it('reports 0 listeners for a tabless space even when GLOBAL tabs exist — the bridge gate skips the wait', async () => {
    const spaceId = `sp_dark_${Date.now()}`
    const globalTab = () => {}
    g.__engineSSEListeners ??= new Set()
    g.__engineSSEListeners.add(globalTab)
    try {
      const body = await (await POST(req({ type: 'probe_frame', __spaceId: spaceId }))).json()
      expect(body.listeners).toBe(0)                     // global tabs are a different audience
    } finally {
      g.__engineSSEListeners.delete(globalTab)
    }
  })

  it('still reports the GLOBAL listener count for non-space commands (compile-await parity kept)', async () => {
    const globalTab = () => {}
    g.__engineSSEListeners ??= new Set()
    g.__engineSSEListeners.add(globalTab)
    try {
      const body = await (await POST(req({ type: 'status' }))).json()
      expect(body.listeners).toBeGreaterThanOrEqual(1)
    } finally {
      g.__engineSSEListeners.delete(globalTab)
    }
  })

  it('resolves the bridge\'s wait when the tab posts its capture (compile-result plumbing)', async () => {
    const spaceId = `sp_answer_${Date.now()}`
    g.__spaceSSEListeners ??= new Map()
    let entryId = ''
    g.__spaceSSEListeners.set(spaceId, new Set([e => { entryId = e.id }]))

    const body = await (await POST(req({ type: 'probe_frame', __spaceId: spaceId }))).json()
    expect(entryId).toBe(body.commands[0].id)

    // the bridge's side of the handshake…
    const wait = waitForCommandResult(entryId, 2000)
    // …and the tab's side (what /api/engine/compile-result calls after capture)
    const answer = { ok: true, source: 'live-tab', realGpu: true, meanLum: 42.5, coveragePct: 87.3, w: 256, h: 144 }
    postCommandResult(entryId, answer)
    expect(await wait).toEqual(answer)

    g.__spaceSSEListeners.delete(spaceId)
  })

  it('times out to null when no tab answers — the bridge falls through to the service eye', async () => {
    expect(await waitForCommandResult('cmd_never_answered_probe', 50)).toBeNull()
  })
})
