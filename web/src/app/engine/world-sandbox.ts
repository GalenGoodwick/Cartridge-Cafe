// world-sandbox — run a world's JS hook in a sealed Web Worker.
//
// The threat this closes: a snapshot's step-hook code runs in every visitor's
// browser. On the main thread `new Function(code)` has the whole page — fetch,
// cookies, same-origin APIs — and cannot be sandboxed (constructor chains
// escape any shadowing). Inside a Worker there is NO DOM and NO cookies to
// begin with, and we additionally shadow every network primitive to undefined.
// Even a globalThis-escape reaches a global with nothing dangerous on it.
//
// The hook still writes the same things it always did — worldData, gpuUniforms,
// field transforms, cafe:* events, __play_sound — but now as a message the host
// applies, not as a direct reach into the live page. One frame of latency; for
// cursor/physics worlds it is invisible.

import type { FieldSimulation } from './simulation'

// ── the worker: sealed global, compiles the hook, runs it against a shim ──
const WORKER_SRC = `
// seal the network/storage surface — a Worker has no DOM already
for (const k of ['fetch','XMLHttpRequest','WebSocket','importScripts','indexedDB',
                 'caches','Worker','SharedWorker','EventSource','navigator','Notification']) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) {}
}
// shim the event bus + CustomEvent so a hook that "dispatches" only collects
let __events = [];
self.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };
self.window = { dispatchEvent(e) { __events.push({ type: e.type, detail: e.detail }); return true; } };

let __hook = null;
self.onmessage = function (ev) {
  const msg = ev.data;
  if (msg.type === 'load') {
    try { __hook = new Function('sim', 'dt', msg.code); self.postMessage({ type: 'ready' }); }
    catch (e) { self.postMessage({ type: 'ready', error: String((e && e.message) || e) }); }
    return;
  }
  if (msg.type === 'tick' && __hook) {
    __events = [];
    const fields = new Map();
    const before = new Map();   // remember each transform so we patch only what the hook MOVED
    for (const f of msg.fields) {
      fields.set(f.id, { id: f.id, name: f.name, transform: f.transform, properties: f.properties });
      before.set(f.id, JSON.stringify(f.transform));
    }
    const sim = {
      worldData: msg.worldData,
      fields,
      getFieldByName(n) { for (const f of fields.values()) if (f.name === n) return f; return null; },
      getField(id) { return fields.get(id) || null; },
    };
    try { __hook(sim, msg.dt); }
    catch (e) { self.postMessage({ type: 'result', error: String((e && e.message) || e), worldData: msg.worldData, fieldPatches: [], events: [] }); return; }
    // only fields the hook actually changed — never hand the host a stale
    // transform for a field it manages itself (that fight reads as jitter)
    const fieldPatches = [];
    for (const f of fields.values()) {
      if (JSON.stringify(f.transform) !== before.get(f.id)) fieldPatches.push({ id: f.id, transform: f.transform });
    }
    self.postMessage({ type: 'result', worldData: sim.worldData, fieldPatches, events: __events });
  }
};
`

interface SandboxReply {
  type: 'result'
  worldData?: Record<string, unknown>
  fieldPatches?: { id: string; transform: Record<string, number> }[]
  events?: { type: string; detail: unknown }[]
  error?: string
}

export class WorldSandbox {
  private worker: Worker | null = null
  private ready = false
  private compileError: string | null = null
  private inFlight = false
  private pending: SandboxReply | null = null

  /** compile a hook into a fresh sealed worker */
  load(code: string): void {
    this.dispose()
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }))
      this.worker = new Worker(url)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.warn('[sandbox] worker spawn failed:', e)
      this.worker = null
      return
    }
    this.worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: 'ready' | 'result'; error?: string } & Partial<Omit<SandboxReply, 'type'>>
      if (m.type === 'ready') {
        this.ready = true
        if (m.error) { this.compileError = m.error; console.warn('[sandbox] hook compile error:', m.error) }
      } else {
        this.inFlight = false
        this.pending = m as SandboxReply
      }
    }
    this.worker.onerror = (e) => console.warn('[sandbox] worker error:', e.message)
    this.worker.postMessage({ type: 'load', code })
  }

  get active(): boolean { return !!this.worker }
  get error(): string | null { return this.compileError }

  /** one frame: apply the worker's last reply, then post current sim state.
   *  Call this BEFORE sim.step so gpuUniforms/__play_sound land for this frame. */
  tick(sim: FieldSimulation, dt: number): void {
    if (!this.worker || !this.ready) return

    // 1 ─ apply the pending reply (from ~1 frame ago)
    if (this.pending) {
      if (this.pending.error) {
        console.warn('[sandbox] hook runtime error:', this.pending.error)
      } else {
        const wd = sim.worldData as Record<string, unknown>
        const incoming = this.pending.worldData || {}
        // apply ONLY what a hook produces: render outputs + its own __state.
        // Blasting the whole worldData back would clobber host-owned keys
        // (presence, pixel samples, live input) with a stale frame — which
        // reads as warping and jitter. The host owns everything else.
        for (const k of Object.keys(incoming)) {
          if (k === 'gpuUniforms' || k === 'hud' || k === '__play_sound' || k === '__play_music' ||
              k === 'instructions' ||
              (k.startsWith('__') && k !== '__sandbox' && k !== '__fresh')) {
            wd[k] = incoming[k]
          }
        }
        // field transforms the hook moved
        for (const p of this.pending.fieldPatches || []) {
          const f = sim.fields.get(p.id)
          if (f && p.transform) f.transform = { ...f.transform, ...p.transform }
        }
        // the whitelisted events the hook "dispatched"
        if (typeof window !== 'undefined') {
          for (const e of this.pending.events || []) {
            if (typeof e.type === 'string' && e.type.startsWith('cafe:')) {
              window.dispatchEvent(new CustomEvent(e.type, { detail: e.detail }))
            }
          }
        }
      }
      this.pending = null
    }

    // 2 ─ post current state for the next frame (backpressure: skip if busy)
    if (this.inFlight) return
    const fields: { id: string; name: string; transform: unknown; properties: unknown }[] = []
    for (const f of sim.fields.values()) {
      fields.push({ id: f.id, name: f.name, transform: f.transform, properties: f.properties })
    }
    try {
      this.worker.postMessage({ type: 'tick', worldData: cloneable(sim.worldData), dt, fields })
      this.inFlight = true
    } catch (e) {
      // non-cloneable worldData (shouldn't happen — it's plain data)
      console.warn('[sandbox] tick post failed:', e)
    }
  }

  dispose(): void {
    if (this.worker) { this.worker.terminate(); this.worker = null }
    this.ready = false
    this.inFlight = false
    this.pending = null
    this.compileError = null
  }
}

// host-managed blobs the hook never reads — cloning them across the worker
// boundary every frame is slow AND makes the round-trip time VARIABLE, which
// surfaces as an irregular update rate (warp/jitter). Drop them from the send.
const HOST_HEAVY = new Set(['presence', 'fieldPixels', 'cellSample', 'gpuUniforms', 'hud', '__play_sound', '__play_music'])

/** minimal, cheap-to-clone payload: the hook's inputs and its own state, never
 *  the host's heavy blobs or the hook's own outputs (which it overwrites). */
function cloneable(wd: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(wd)) {
    if (HOST_HEAVY.has(k)) continue
    if (typeof wd[k] === 'function') continue
    out[k] = wd[k]
  }
  return out
}
