import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

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

function readLog(): Report[] {
  try {
    return JSON.parse(readFileSync(LOG_PATH, 'utf-8')) as Report[]
  } catch {
    return []
  }
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

  const log = readLog()
  log.push(report)
  // Keep the most recent MAX_ENTRIES.
  const trimmed = log.slice(-MAX_ENTRIES)
  try {
    writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2), 'utf-8')
  } catch (err) {
    console.error('[quarantine] failed to persist report:', err)
    return NextResponse.json({ error: 'Failed to persist' }, { status: 500 })
  }

  console.error(
    `[quarantine] ${report.phase}: ${hazards.map((h) => `${h.name} — ${h.reason}`).join(' | ')}`,
  )
  return NextResponse.json({ ok: true, logged: hazards.length })
}

/** GET /api/engine/quarantine — read the log back (for an AI or a dashboard). */
export async function GET() {
  return NextResponse.json({ reports: readLog() })
}
