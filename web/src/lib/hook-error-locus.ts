// Auto-document errors AT THE SOURCE.
//
// The cafe is uniquely able to do this because the engine HOLDS the source of
// every dynamic artifact: step-hooks are strings it stores (with their author),
// shaders expose compile line-numbers into WGSL it also holds. So an error's
// line maps straight back into the original authored text — no source maps.
//
// Two pure halves (unit-tested in scratchpad/locus-test.mjs, 6/6):
//   parseAnonLoc — worker-side: pull the hook line/col out of a V8 stack.
//   sliceSnippet — main-side:   cut the offending line (±ctx) from held source.
// Plus reportError — the ONE funnel into /api/engine/quarantine (the existing
// telemetry sink), throttled and keepalive, that never throws into a caller.

/** Extract the throwing hook line/col from a V8 error stack. Hooks run as
 *  `new Function('sim','dt', code)`; V8 tags eval'd frames `<anonymous>:L:C`,
 *  and the body starts 2 lines below the generated header (measured), so
 *  hookLine = L - 2. First matching frame = deepest = where it threw. */
export function parseAnonLoc(stack: unknown): { line: number; col: number } | null {
  if (typeof stack !== 'string') return null
  for (const raw of stack.split('\n')) {
    const m = raw.match(/<anonymous>:(\d+):(\d+)\)?\s*$/)
    if (m) {
      const line = Number(m[1]) - 2
      return line >= 1 ? { line, col: Number(m[2]) } : null
    }
  }
  return null
}

/** Cut the offending source line (with ±ctx context) out of held code, marking
 *  the culprit with →. Returns null if the line is out of range. */
export function sliceSnippet(code: unknown, line: unknown, ctx = 2): string | null {
  if (typeof code !== 'string' || typeof line !== 'number' || !Number.isFinite(line)) return null
  const lines = code.split('\n')
  if (line < 1 || line > lines.length) return null
  const from = Math.max(1, line - ctx), to = Math.min(lines.length, line + ctx)
  const out: string[] = []
  for (let i = from; i <= to; i++) out.push((i === line ? '→ ' : '  ') + i + ' | ' + lines[i - 1])
  return out.join('\n')
}

export interface FaultHazard {
  name?: string       // what failed: hook id, 'device-lost', 'window', a visual name
  reason?: string     // the message
  author?: string     // who authored the offending hook/shader (provenance)
  line?: number
  col?: number
  snippet?: string    // the source, marked at the culprit line
  gpuModel?: string   // UNMASKED_RENDERER, for gpu-lost triage
  stack?: string      // raw stack for engine-code errors (no held source)
}

// client-side throttle: a broken world reload-loops; don't spam the log with
// the same fault. Keyed by phase+name+url, 60s window.
const _seen = new Map<string, number>()

/** The one funnel. POST a fault to the existing quarantine sink. Never throws
 *  into the caller (telemetry must not break the render path); best-effort. */
export function reportError(phase: string, hazard: FaultHazard, scene?: string): void {
  try {
    if (typeof window === 'undefined') return
    const now = Date.now()
    const key = phase + ':' + (hazard.name ?? '') + ':' + (window.location?.pathname ?? '')
    if ((_seen.get(key) ?? 0) > now - 60_000) return
    _seen.set(key, now)
    void fetch('/api/engine/quarantine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ phase, url: window.location?.href, scene, hazards: [hazard] }),
    }).catch(() => {})
  } catch { /* telemetry never throws into the caller */ }
}

/** The GPU model, for gpu-lost triage — the WebGL2 UNMASKED_RENDERER, the same
 *  tell the SupportGate uses. Cheap; returns '' if unavailable. */
export function gpuModel(): string {
  try {
    const c = document.createElement('canvas')
    const g = c.getContext('webgl2') as WebGL2RenderingContext | null
    if (!g) return ''
    const dbg = g.getExtension('WEBGL_debug_renderer_info')
    return String(dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)).slice(0, 80)
  } catch { return '' }
}
