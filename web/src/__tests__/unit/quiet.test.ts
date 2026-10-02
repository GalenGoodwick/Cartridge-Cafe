// QUIET WHEN IDLE — the one gate that stops every poll when nobody is here
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('quiet when idle', () => {
  let real: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const listeners: Record<string, Array<() => void>> = {}
    const doc = { visibilityState: 'visible', addEventListener: (e: string, fn: () => void) => { (listeners[e] ||= []).push(fn) } }
    real = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const win = { fetch: real, addEventListener: (e: string, fn: () => void) => { (listeners[e] ||= []).push(fn) } }
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', win)
    vi.stubGlobal('location', { origin: 'https://cartridge.cafe' })
    ;(globalThis as { __fire?: (e: string) => void }).__fire = (e) => { for (const fn of listeners[e] || []) fn() }
  })

  it('lets polls through while someone is here, and answers them locally after five idle minutes', async () => {
    const q = await import('@/lib/quiet')
    q.installQuiet()
    const w = (globalThis as unknown as { window: { fetch: typeof fetch } }).window
    expect((await w.fetch('/api/pulse?space=x')).status).toBe(200)
    vi.setSystemTime(1_000_000 + q.IDLE_MS + 1)
    const r = await w.fetch('/api/pulse?space=x')
    expect(r.status).toBe(503); expect(r.headers.get('x-quiet')).toBe('1'); expect(await r.json()).toEqual({})
    expect(real).toHaveBeenCalledTimes(1)
  })
  it('a touch wakes it; POSTs and non-api fetches are never held', async () => {
    const q = await import('@/lib/quiet')
    q.installQuiet()
    const w = (globalThis as unknown as { window: { fetch: typeof fetch } }).window
    vi.setSystemTime(1_000_000 + q.IDLE_MS + 1)
    expect((await w.fetch('/api/engine/save?slot=a')).status).toBe(503)
    expect((await w.fetch('/api/engine/save', { method: 'POST', body: '{}' })).status).toBe(200)
    expect((await w.fetch('https://example.com/x')).status).toBe(200)
    ;(globalThis as { __fire?: (e: string) => void }).__fire!('pointerdown')
    expect((await w.fetch('/api/engine/save?slot=a')).status).toBe(200)
  })
  it('a hidden tab is quiet at once, and wakes when it is shown again', async () => {
    const q = await import('@/lib/quiet')
    q.installQuiet()
    const w = (globalThis as unknown as { window: { fetch: typeof fetch } }).window
    const doc = (globalThis as unknown as { document: { visibilityState: string } }).document
    doc.visibilityState = 'hidden'
    expect((await w.fetch('/api/membership')).status).toBe(503)
    doc.visibilityState = 'visible'
    ;(globalThis as { __fire?: (e: string) => void }).__fire!('visibilitychange')
    expect((await w.fetch('/api/membership')).status).toBe(200)
  })
})
