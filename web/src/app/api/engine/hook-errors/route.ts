import { NextRequest, NextResponse } from 'next/server'
import { loadGameSlot, saveGameSlot } from '../store'
import { prisma } from '@/lib/prisma'
import { recordNodeError } from '../space-store'

export const dynamic = 'force-dynamic'

/**
 * POST /api/engine/hook-errors  — the browser running a world posts here whenever
 * a step hook throws (compile OR runtime). The sandbox already writes the failure
 * into `worldData.last_hook_error`; FieldEngine forwards each NEW one here so the
 * building AI can read it back over the bridge (folded into cafe_state as
 * `hookErrors`) instead of guessing why a hook "silently does nothing".
 *
 * GET /api/engine/hook-errors?slug=… (or ?scene=…) — read the buffer directly.
 *
 * Low-privilege telemetry, like /api/engine/quarantine: no auth (a hook can fail
 * for any anonymous visitor), a hard cap on kept entries, consecutive-duplicate
 * folding (a hook that throws every frame becomes ONE entry with a count), and
 * truncated messages so the buffer can never grow unbounded.
 */

const MAX_ENTRIES = 20
const MAX_MSG = 1200

export interface HookError {
  hookId: string
  phase: string        // 'compile' | 'runtime' | 'quarantined'
  error: string
  at: number
  count: number        // consecutive identical failures folded into one entry
}

/** Both sides must agree on this key. Space worlds key by slug (the bridge's
 *  auth.slug === FieldEngine's spaceSlug prop); branch scenes key by scene name. */
export function hookErrorKey(opts: { slug?: string; scene?: string }): string | null {
  if (opts.slug) return 'hook-err:space:' + opts.slug.trim().toLowerCase()
  if (opts.scene) return 'hook-err:scene:' + opts.scene.trim().toLowerCase()
  return null
}

export async function readHookErrors(key: string): Promise<HookError[]> {
  const buf = (await loadGameSlot(key)) as HookError[] | undefined
  return Array.isArray(buf) ? buf : []
}


// THROTTLE (audit F5/F6): these are UNAUTHENTICATED telemetry doors that can
// trigger auto-reverts — un-throttled, an attacker loops a victim's world
// back forever. Per IP+target: 6 reports/min; excess is acknowledged (200)
// but DROPPED so real tabs never see errors.
const __reportHits: Map<string, { n: number; at: number }> = ((globalThis as unknown as { __ccReportHits?: Map<string, { n: number; at: number }> }).__ccReportHits ??= new Map())
function reportThrottled(ip: string, target: string): boolean {
  const k = ip + '|' + target
  const now = Date.now()
  const h = __reportHits.get(k)
  if (!h || now - h.at > 60_000) { __reportHits.set(k, { n: 1, at: now }); return false }
  h.n++
  return h.n > 6
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as
    | { slug?: string; scene?: string; error?: { hookId?: string; phase?: string; error?: string; at?: number } }
    | null
  const key = body ? hookErrorKey(body) : null
  const e = body?.error
  if (!key || !e || typeof e.error !== 'string') {
    return NextResponse.json({ error: 'need slug|scene and error{}' }, { status: 400 })
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local'
  if (reportThrottled(ip, key)) return NextResponse.json({ ok: true, dropped: true })

  const entry: HookError = {
    hookId: String(e.hookId ?? 'sandbox'),
    phase: e.phase === 'compile' || e.phase === 'quarantined' ? e.phase : 'runtime',
    error: e.error.slice(0, MAX_MSG),
    at: typeof e.at === 'number' ? e.at : Date.now(),
    count: 1,
  }

  const buf = await readHookErrors(key)
  const last = buf[buf.length - 1]
  // fold a repeat of the SAME failure into the last entry (a hook that throws
  // every frame is one bug, not a thousand) — otherwise append and cap.
  if (last && last.error === entry.error && last.phase === entry.phase) {
    last.count += 1
    last.at = entry.at
  } else {
    buf.push(entry)
    while (buf.length > MAX_ENTRIES) buf.shift()
  }
  await saveGameSlot(key, buf)

  // RUNG 2 (co-build): an error report on a space world counts against the
  // node's CURRENT rev — a fresh push that keeps erroring AUTO-REVERTS to its
  // last good version (the bad rev is marked; a node with no good ancestor
  // stays, its error chain the builder's breadcrumb). Old settled revs are
  // not on probation, so a griefer spamming this open route can at worst
  // roll a just-pushed rev back to its immediate predecessor.
  let heal: { counted?: number; reverted?: number; noAncestor?: boolean } = {}
  if (body?.slug && entry.hookId !== 'sandbox') {
    try {
      const sp = await prisma.playerSpace.findUnique({ where: { slug: body.slug }, select: { id: true } })
      if (sp) heal = await recordNodeError(sp.id, entry.hookId)
      if (heal.reverted !== undefined) {
        // tell the AI in the SAME channel it reads faults from (world state's
        // hookErrors) — a heal it never learns about is a mystery diff
        buf.push({ hookId: entry.hookId, phase: 'reverted',
          error: `auto-healed: node "${entry.hookId}" kept erroring on its fresh push and was reverted to its last good version (rev ${heal.reverted}) — the bad rev is marked in node_history`,
          at: Date.now(), count: 1 })
        await saveGameSlot(key, buf.slice(-MAX_ENTRIES))
      }
    } catch { /* telemetry never throws */ }
  }
  return NextResponse.json({ ok: true, kept: buf.length, ...heal })
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const key = hookErrorKey({ slug: sp.get('slug') || undefined, scene: sp.get('scene') || undefined })
  if (!key) return NextResponse.json({ error: 'need slug or scene' }, { status: 400 })
  return NextResponse.json({ hookErrors: await readHookErrors(key) })
}
