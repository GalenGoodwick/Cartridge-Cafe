import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { loadGameSlot, saveGameSlot } from '../store'
import { join } from 'path'
import { commonsBus } from '@/lib/commons-bus'

export const dynamic = 'force-dynamic'

/**
 * POST /api/engine/quarantine
 * The browser renderer posts here whenever a visual is quarantined — either by
 * the PRE-FLIGHT hazard screen (a baked-image const array / oversized WGSL that
 * would hang the GPU compiler and freeze the machine) or by the reactive
 * fault-isolating compile (a genuine WGSL error).
 *
 * Reports are appended to `quarantine-log.json` at the project root so a human
 * OR an AI assistant can read exactly what was rejected and why — the details
 * needed to fix the offending world without having to reproduce the freeze.
 *
 * This is intentionally low-privilege telemetry: no auth (a freeze can hit an
 * anonymous viewer), a hard cap on kept entries, and truncated payloads so the
 * log can never grow unbounded.
 */

const LOG_PATH = join(process.cwd(), 'quarantine-log.json')
const MAX_ENTRIES = 100
const MAX_REASON = 2000
const MAX_HAZARDS = 32

interface Hazard {
  name?: string
  reason?: string
  wgslBytes?: number
  arrays?: number
  maxArray?: number
  totalElements?: number
  phase?: string
}

interface Report {
  at: string
  phase: string          // 'preflight' | 'compile-error'
  url?: string
  scene?: string
  hazards: Hazard[]
}

function readLogDisk(): Report[] {
  try {
    return JSON.parse(readFileSync(LOG_PATH, 'utf-8')) as Report[]
  } catch {
    return []
  }
}
// the log must OUTLIVE the lambda that took the report — same serverless
// trap scenes fell into: a visitor's diagnostic posted to one instance and
// evaporated for every other. Neon slot first, per-instance disk as fallback.
async function readLog(): Promise<Report[]> {
  try {
    const db = (await loadGameSlot('quarantine-log')) as Report[] | undefined
    if (Array.isArray(db)) return db
  } catch { /* fall through to disk */ }
  return readLogDisk()
}

function clip(s: unknown, n: number): string | undefined {
  if (typeof s !== 'string') return undefined
  return s.length > n ? s.slice(0, n) + '…[truncated]' : s
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawHazards = Array.isArray(body.hazards) ? body.hazards : []
  const hazards: Hazard[] = rawHazards.slice(0, MAX_HAZARDS).map((h) => {
    const o = (h ?? {}) as Record<string, unknown>
    return {
      name: clip(o.name, 200),
      reason: clip(o.reason, MAX_REASON),
      wgslBytes: typeof o.wgslBytes === 'number' ? o.wgslBytes : undefined,
      arrays: typeof o.arrays === 'number' ? o.arrays : undefined,
      maxArray: typeof o.maxArray === 'number' ? o.maxArray : undefined,
      totalElements: typeof o.totalElements === 'number' ? o.totalElements : undefined,
    }
  })

  if (hazards.length === 0) {
    return NextResponse.json({ error: 'Expected non-empty hazards[]' }, { status: 400 })
  }

  // Server stamps the time — the browser clock can't be trusted, and this is
  // the record an AI reads to know *when* the freeze happened.
  const report: Report = {
    at: new Date().toISOString(),
    phase: clip(body.phase, 40) ?? 'unknown',
    url: clip(body.url, 500),
    scene: clip(body.scene, 200),
    hazards,
  }

  const log = await readLog()
  log.push(report)
  // Keep the most recent MAX_ENTRIES.
  const trimmed = log.slice(-MAX_ENTRIES)
  await saveGameSlot('quarantine-log', trimmed)   // durable — survives the lambda
  try { writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2), 'utf-8') } catch { /* disk is best-effort on serverless */ }

  console.error(
    `[quarantine] ${report.phase}: ${hazards.map((h) => `${h.name} — ${h.reason}`).join(' | ')}`,
  )

  // COMMONS BUS — engine telemetry into the nervous system: the daemons watching
  // the commons see breakage the moment it happens and can converge on the fix.
  // Throttled per phase+visual (a broken world reload-loops its report), and
  // only for real shader faults — support-gate/engine-init noise stays out.
  if (report.phase === 'preflight' || report.phase === 'compile-error' || report.phase === 'hook-budget') {
    const g = globalThis as unknown as { __qBusSeen?: Map<string, number> }
    const seen = (g.__qBusSeen ??= new Map())
    const key = report.phase + ':' + (hazards[0]?.name ?? '') + ':' + (report.url ?? '')
    const nowMs = Date.now()
    if ((seen.get(key) ?? 0) < nowMs - 10 * 60_000) {
      seen.set(key, nowMs)
      const what = hazards.map((h) => `${h.name}: ${String(h.reason ?? '').slice(0, 120)}`).join(' | ')
      void commonsBus({ kind: 'quarantine', who: 'engine',
        text: `⚠ quarantine (${report.phase}) at ${report.url ?? 'unknown'} — ${what}`.slice(0, 600),
        data: { phase: report.phase, url: report.url } })
    }
  }
  return NextResponse.json({ ok: true, logged: hazards.length })
}

/** GET /api/engine/quarantine — read the log back (for an AI or a dashboard). */
export async function GET() {
  return NextResponse.json({ reports: await readLog() })
}
