/** The EYE, callable from any server route. Ships a world snapshot to the
 *  render-service (Deno + software-Vulkan on Railway), which boots it, runs the
 *  real step-hooks for N ticks, reads the framebuffer, and returns pixel-stats +
 *  a base64 PNG. Extracted from the bridge so icon-baking, probes, and any other
 *  server code share ONE caller instead of hand-rolling the fetch. If the service
 *  is unset/down the caller still gets a structured {ok:false} it can fall back on. */

export type RenderSnapshot = {
  fields?: unknown[]
  visualTypes?: unknown[]
  modules?: unknown[]
  worldData?: Record<string, unknown>
  stepHooks?: unknown[]
} | null | undefined

export type RenderOpts = {
  name?: unknown
  ticks?: unknown
  size?: unknown
  input?: unknown
  trace?: unknown
}

const LOCAL_RENDER = 'http://localhost:8080'
let _localUp: boolean | null = null
async function preferLocal(configured: string | undefined): Promise<string | undefined> {
  if (configured && configured.includes('localhost')) return configured   // already local (dev env)
  if (_localUp === null) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 700)
      const r = await fetch(LOCAL_RENDER + '/health', { signal: ctrl.signal }).catch(() => null)
      clearTimeout(t); _localUp = !!(r && r.ok)
    } catch { _localUp = false }
  }
  return _localUp ? LOCAL_RENDER : configured
}

export async function renderSnapshot(
  snap: RenderSnapshot,
  opts: RenderOpts,
): Promise<Record<string, unknown>> {
  // LOCAL-FIRST (Galen, Aug 29: 'always local, not the railway service'): if the
  // local Metal render is up (render-service/start-local.sh) it wins — a probe
  // never leaves the machine. Railway is only the fallback when local is down.
  // A 700ms health race decides; the result is cached per-process.
  const configured = process.env.RENDER_SERVICE_URL
  const secret = process.env.RENDER_SECRET
  const base = await preferLocal(configured)
  if (!base || !secret) {
    return { ok: false, error: 'render service not configured (no eyes over HTTP yet) — use describe_scene / health for structural eyes', configured: false }
  }
  const state = {
    fields: snap?.fields ?? [],
    visualTypes: snap?.visualTypes ?? [],
    modules: snap?.modules ?? [],
    worldData: snap?.worldData ?? {},
    stepHooks: snap?.stepHooks ?? [],
  }
  if (!Array.isArray(state.fields) || state.fields.length === 0) {
    return { ok: false, error: 'nothing to render — the world has no fields yet' }
  }
  const url = base.replace(/\/+$/, '') + '/render'
  const payload: Record<string, unknown> = { state, size: 256 }
  if (typeof opts.name === 'string') payload.name = opts.name
  if (opts.ticks != null) payload.ticks = Number(opts.ticks)
  if (opts.size != null) payload.size = Math.min(512, Math.max(64, Number(opts.size) || 256))
  // synthetic input — the HANDS: a preset string ('auto'|'run-right'|'tap-action'
  // |'sweep-cursor') or an explicit timeline array. Lets the render VERIFY the
  // world reacts to controls, not just that it draws.
  if (typeof opts.input === 'string' || Array.isArray(opts.input)) payload.input = opts.input
  if (opts.trace) payload.trace = true   // PLAYTHROUGH: return the __vf state trace per sampled tick
  try {
    const ctrl = new AbortController()
    // 90s, not 25: Railway's SOFTWARE Vulkan (lavapipe) spends ~23s on
    // pipeline compile for even a trivial world — 25s aborted EVERY prod
    // probe and reported it as 'unreachable' (the Aug 29 mystery). The local
    // Metal eye answers in seconds; the cloud fallback just needs the time.
    const timer = setTimeout(() => ctrl.abort(), 90_000)
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) return { ok: false, error: `render service ${r.status}: ${(await r.text()).slice(0, 200)}` }
    const out = await r.json()
    // hint the caller how to READ the render, since it's raw pixel-stats not prose
    // THE NOTHING ERROR (Galen, Aug 29: 'rendering as nothing should throw a
    // nothing error over the bridge') — a blank render is a first-class ERROR
    // the AI cannot miss, not a stat it might skip. ok stays true (the render
    // itself worked); `error` carries the verdict loudly.
    if (out.ok && typeof out.coveragePct === 'number' && (out.coveragePct as number) < 1) {
      out.nothing = true
      out.error = `NOTHING RENDERED — the world drew ~${out.coveragePct}% of the frame. Almost always: a field with NO visualType (renders as nothing), a WGSL shader that failed to compile (check errors[]), or content built off the 0..512 grid (check offscreenHint). Fix, then re-probe — do not trust this build.`
    }
    if (out.ok) out.next = 'meanLum=brightness, coveragePct=how much is drawn, bbox=where, dominantColors=palette, motion=movement over time. image is base64 PNG. If coveragePct<1 the world is ~blank; if offscreenHint set, content is mis-placed.' +
      (out.inputReport
        ? ` inputReport.respondsToInput=${out.inputReport.respondsToInput}: ${out.inputReport.note}`
        : ' For anything INTERACTIVE, re-probe with {"input":"auto"} (or "run-right"/"tap-action"/"sweep-cursor") — it presses the controls and tells you if the world actually reacts.')
    return out
  } catch (e) {
    return { ok: false, error: `render service unreachable: ${e instanceof Error ? e.message : String(e)} — static eyes (describe/health) still work` }
  }
}
