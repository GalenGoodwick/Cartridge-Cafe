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

// a world can register SEVERAL step hooks (ball physics, player AI, clock…).
// Each compiles independently and runs in its own try/catch so one bad hook
// doesn't kill the others — the real games AI builds need this.
let __hooks = [];
// seeded PRNG (mulberry32) — armed when worldData.__seed is a number, so a
// world that opts in gets the same sim.rand() sequence every run (replays)
let __randSeed = null, __randState = 0;
function __rand() {
  if (__randSeed === null) return Math.random();
  __randState = (__randState + 0x6D2B79F5) | 0;
  let t = Math.imul(__randState ^ (__randState >>> 15), 1 | __randState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
self.onmessage = function (ev) {
  const msg = ev.data;
  if (msg.type === 'load') {
    // accept {hooks:[{id,code}]} or a single {code} (legacy)
    const specs = Array.isArray(msg.hooks) ? msg.hooks : [{ id: 'hook', code: msg.code }];
    __hooks = [];
    const errs = [];
    for (const h of specs) {
      try { __hooks.push({ id: h.id, fn: new Function('sim', 'dt', h.code) }); }
      catch (e) { errs.push((h.id || '?') + ': ' + String((e && e.message) || e)); }
    }
    self.postMessage({ type: 'ready', error: errs.length ? errs.join(' | ') : undefined });
    return;
  }
  if (msg.type === 'tick' && __hooks.length) {
    __events = [];
    const ws = msg.worldData && msg.worldData.__seed;
    if (typeof ws === 'number' && ws !== __randSeed) { __randSeed = ws; __randState = ws | 0; }
    const fields = new Map();
    const before = new Map();   // remember each transform so we patch only what the hook MOVED
    for (const f of msg.fields) {
      fields.set(f.id, { id: f.id, name: f.name, transform: f.transform, properties: f.properties });
      before.set(f.id, JSON.stringify(f.transform));
    }
    const sim = {
      worldData: msg.worldData,
      fields,
      rand: __rand,
      getFieldByName(n) { for (const f of fields.values()) if (f.name === n) return f; return null; },
      getField(id) { return fields.get(id) || null; },
      // ── chapter / trigger primitives — MUST mirror FieldSimulation exactly, or a
      // sandboxed puzzle hook throws on the first sim.trigger()/sim.act it reaches,
      // its own try/catch swallows it, and the world freezes with stale uniforms
      // (the TIDEGLASS/HELIOS freeze — a sandboxed world using chapters had NO
      // access to these). All are pure worldData ops, so they port verbatim.
      trigger(id, cond) {
        const wd = this.worldData;
        if (!wd.__trig) wd.__trig = {};
        const L = wd.__trig;
        if (cond) { if (!L[id]) { L[id] = true; return true; } }
        return false;
      },
      edge(id, cond) {
        const wd = this.worldData;
        if (!wd.__edge) wd.__edge = {};
        const L = wd.__edge;
        const was = !!L[id]; const now = !!cond; L[id] = now;
        return now && !was;
      },
      resetTrigger(id) { const L = this.worldData.__trig; if (L) delete L[id]; },
      _ch() {
        const wd = this.worldData;
        let c = wd.__chapters;
        if (!c) { c = { names: [''], unlocked: [1], cur: 1 }; wd.__chapters = c; }
        return c;
      },
      defineChapters(names) {
        const c = this._ch();
        c.names = ['', ...names];
        if (!Array.isArray(c.unlocked) || !c.unlocked.length) c.unlocked = [1];
        if (!c.cur) c.cur = 1;
      },
      get act() { return this._ch().cur; },
      chapterName(n) { const c = this._ch(); return c.names[n == null ? c.cur : n] || ''; },
      chapterCount() { return this._ch().names.length - 1; },
      chapterUnlocked(n) { return this._ch().unlocked.includes(n); },
      unlockChapter(n) { const c = this._ch(); if (n >= 1 && n <= this.chapterCount() && !c.unlocked.includes(n)) c.unlocked.push(n); },
      goChapter(n) { const c = this._ch(); if (c.unlocked.includes(n)) { c.cur = n; return true; } return false; },
      completeChapter() { const c = this._ch(); const nx = c.cur + 1; if (nx <= this.chapterCount()) { this.unlockChapter(nx); c.cur = nx; return true; } return false; },
    };
    // A hook reaching for a sim member this sandbox doesn't provide (a new
    // FieldSimulation method not yet mirrored here) would throw — and many hooks
    // wrap themselves in a try/catch that SILENTLY swallows it, so the world just
    // freezes with no error surfaced anywhere (the TIDEGLASS hunt: hours to find
    // one missing sim.trigger). Trap unknown members: record the name, hand back a
    // no-op so the hook keeps running, and REPORT the gap instead of losing it.
    const __missing = new Set();
    const __noop = function () { return undefined; };
    const __sim = new Proxy(sim, {
      get(t, p, r) {
        if (typeof p === 'symbol' || p in t) return Reflect.get(t, p, r);
        __missing.add(String(p));
        return __noop;
      },
    });
    const __now = () => (self.performance && self.performance.now) ? self.performance.now() : Date.now();
    const __t0 = __now();
    let __runErr = null;
    for (const h of __hooks) {
      try { h.fn(__sim, msg.dt); }
      catch (e) { __runErr = (h.id || '?') + ': ' + String((e && e.message) || e); }  // keep running the rest
    }
    if (__missing.size) {
      const m = 'sandbox has no sim.' + [...__missing].join('/sim.') + ' — a hook called it; returned a no-op. Mirror it in world-sandbox.ts.';
      __runErr = __runErr ? (__runErr + ' | ' + m) : m;
    }
    const __ms = __now() - __t0;   // host watches this for a runaway-cost kill-switch
    // only fields a hook actually changed — never hand the host a stale
    // transform for a field it manages itself (that fight reads as jitter).
    // Partial success still applies: a thrown hook doesn't void the others' work.
    const fieldPatches = [];
    for (const f of fields.values()) {
      if (JSON.stringify(f.transform) !== before.get(f.id)) fieldPatches.push({ id: f.id, transform: f.transform });
    }
    self.postMessage({ type: 'result', error: __runErr || undefined, worldData: sim.worldData, fieldPatches, events: __events, ms: __ms });
  }
};
`

interface SandboxReply {
  type: 'result'
  worldData?: Record<string, unknown>
  fieldPatches?: { id: string; transform: Record<string, number> }[]
  events?: { type: string; detail: unknown }[]
  error?: string
  ms?: number
}

// ── runaway-cost kill-switch — deliberately LIBERAL ──
// A sandboxed hook can't steal cookies or reach the network, but a hostile or
// buggy one can still peg a core. These thresholds only ever catch a genuine
// infinite loop or SUSTAINED heavy overrun — a normal hook runs in well under a
// millisecond, so there is enormous headroom before anything trips.
const perfNow = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
const HANG_MS = 5000        // no reply for 5s while a tick is in flight ⇒ looping
const SLOW_MS = 150         // one tick over 150ms (a frame is ~16ms) counts as heavy
const SLOW_STRIKE_LIMIT = 240   // ~240 sustained heavy ticks (several seconds) ⇒ quarantine

export class WorldSandbox {
  private worker: Worker | null = null
  private ready = false
  private compileError: string | null = null
  private inFlight = false
  private pending: SandboxReply | null = null
  private reportedError = false
  private lastSurfaced = ''
  private quarantined = false
  private lastPostAt = 0
  private slowStrikes = 0
  // input edge-detection: last frame's held-state, so the hook is handed a ready
  // `input` object (held / pressed / released / moveX / moveY / action) instead
  // of diffing raw key_* itself. ESC is never a game key (unmapped upstream); R
  // is withheld while restart-with-R is armed so a world can't fight the reset.
  private prevKeys: Record<string, boolean> = {}
  private prevPointerDown = false

  /** Put a hook failure where players AND agents can see it: worldData
   *  (synced, bridge-visible as last_hook_error) + the cc:fault overlay. */
  private surface(sim: FieldSimulation, phase: 'compile' | 'runtime', msg: string): void {
    if (msg === this.lastSurfaced) return
    this.lastSurfaced = msg
    ;(sim.worldData as Record<string, unknown>)['last_hook_error'] = { hookId: 'sandbox', phase, error: msg, at: Date.now() }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cc:fault', {
        detail: { kind: 'hook-error', message: `world hook ${phase} error: ${msg}` },
      }))
    }
  }

  /** Stop the hooks for good and SAY WHY, on the same surfaces a fault uses.
   *  Liberal by design — this only fires on a true runaway, so the message is
   *  reassuring: the rest of the world keeps running. */
  private quarantine(sim: FieldSimulation, reason: string, detail: string): void {
    if (this.quarantined) return
    this.quarantined = true
    this.dispose()
    const message = `this world's live code was paused — ${reason}. everything else still runs.`
    ;(sim.worldData as Record<string, unknown>)['__hook_quarantined'] = { reason, detail, at: Date.now() }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cc:fault', { detail: { kind: 'quarantine', message } }))
      try {
        void fetch('/api/engine/quarantine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase: 'hook-budget', url: window.location?.href, hazards: [{ name: 'step hook', reason: detail, phase: 'runtime' }] }),
          keepalive: true,
        }).catch(() => {})
      } catch { /* telemetry must never throw into the render path */ }
    }
  }

  /** Derive a ready-to-use input frame from the raw key_ and mouse_ held-state the
   *  host writes, so a hook reads `wd.input.pressed.space` etc. instead of tracking
   *  key-press deltas by hand. Reserved keys: ESC is never mapped upstream (so never
   *  appears here); R is withheld while restart-with-R is armed. moveX/moveY fold
   *  WASD + arrows into a -1..1 axis (moveY: forward/up = +1). */
  private buildInput(wd: Record<string, unknown>): Record<string, unknown> {
    const held: Record<string, boolean> = {}
    const pressed: Record<string, boolean> = {}
    const released: Record<string, boolean> = {}
    const rArmed = !!wd['rResetKey']
    const now: Record<string, boolean> = {}
    for (const k of Object.keys(wd)) {
      if (!k.startsWith('key_') || k.endsWith('_n')) continue
      const name = k.slice(4)
      if (name === 'r' && rArmed) continue        // reset owns R
      const down = !!wd[k]
      now[name] = down
      if (down) held[name] = true
      if (down && !this.prevKeys[name]) pressed[name] = true
      if (!down && this.prevKeys[name]) released[name] = true
    }
    this.prevKeys = now
    const on = (n: string) => !!held[n]
    const hit = (n: string) => !!pressed[n]
    const moveX = (on('d') || on('right') ? 1 : 0) - (on('a') || on('left') ? 1 : 0)
    const moveY = (on('w') || on('up') ? 1 : 0) - (on('s') || on('down') ? 1 : 0)
    const pdown = !!wd['mouse_down']
    const pointer = {
      x: (wd['mouse_x'] as number) ?? 0,
      y: (wd['mouse_y'] as number) ?? 0,
      down: pdown,
      pressed: pdown && !this.prevPointerDown,
      released: !pdown && this.prevPointerDown,
    }
    this.prevPointerDown = pdown
    return {
      held, pressed, released, moveX, moveY,
      action: hit('space') || hit('enter'),         // primary-action edge
      actionHeld: on('space') || on('enter'),
      pointer,
    }
  }

  /** compile one or more hooks into a fresh sealed worker */
  load(hooks: string | { id: string; code: string }[]): void {
    this.dispose()
    // a fresh install (e.g. the owner/AI just fixed the hook) gets a clean slate
    this.quarantined = false
    this.slowStrikes = 0
    this.lastPostAt = 0
    const specs = typeof hooks === 'string' ? [{ id: 'hook', code: hooks }] : hooks
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
    this.worker.postMessage({ type: 'load', hooks: specs })
  }

  get active(): boolean { return !!this.worker }
  get error(): string | null { return this.compileError }

  /** one frame: apply the worker's last reply, then post current sim state.
   *  Call this BEFORE sim.step so gpuUniforms/__play_sound land for this frame. */
  tick(sim: FieldSimulation, dt: number): void {
    if (this.quarantined || !this.worker || !this.ready) return

    // KILL-SWITCH ─ a tick posted but no reply for HANG_MS means a hook is
    // looping. It can't hurt the page (sealed worker) but it pegs a core —
    // terminate and say why. Very liberal: a real hook replies in <1 frame.
    if (this.inFlight && this.lastPostAt && (perfNow() - this.lastPostAt > HANG_MS)) {
      this.quarantine(sim, 'it stopped responding (a loop with no exit)', `no reply for ${Math.round((perfNow() - this.lastPostAt))}ms — hook is looping`)
      return
    }

    // a compile error means the hook will NEVER run — a world that looks dead
    // must say why, on the same surfaces a runtime failure uses
    if (this.compileError && !this.reportedError) {
      this.reportedError = true
      this.surface(sim, 'compile', this.compileError)
    }

    // 1 ─ apply the pending reply (from ~1 frame ago)
    if (this.pending) {
      // SUSTAINED heavy cost ⇒ quarantine. Strikes accrue on a heavy tick and
      // decay 2× as fast, so brief spikes never trip it — only a hook that is
      // consistently over budget for seconds on end.
      if (typeof this.pending.ms === 'number') {
        if (this.pending.ms > SLOW_MS) {
          if (++this.slowStrikes >= SLOW_STRIKE_LIMIT) {
            this.quarantine(sim, 'it was using too much time every frame', `sustained ${Math.round(this.pending.ms)}ms/tick over ${SLOW_STRIKE_LIMIT} ticks (budget ${SLOW_MS}ms)`)
            return
          }
        } else {
          this.slowStrikes = Math.max(0, this.slowStrikes - 2)
        }
      }
      // an error means ONE hook threw — surface it, but still apply the reply:
      // the other hooks ran fine and their worldData/patches are valid.
      if (this.pending.error) {
        console.warn('[sandbox] hook runtime error:', this.pending.error)
        this.surface(sim, 'runtime', this.pending.error)
      }
      {
        const wd = sim.worldData as Record<string, unknown>
        const incoming = this.pending.worldData || {}
        // apply ONLY what a hook produces: render outputs + its own __state.
        // Blasting the whole worldData back would clobber host-owned keys
        // (presence, pixel samples, live input) with a stale frame — which
        // reads as warping and jitter. The host owns everything else.
        for (const k of Object.keys(incoming)) {
          if (k === 'gpuUniforms' || k === 'gpuPopulation' || k === 'hud' || k === '__play_sound' || k === '__play_music' ||
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
    // Determinism opt-in: worldData.__fixedStep pins the dt the hook sees to
    // one exact quantum — one tick per rendered frame, same sequence every run
    const fs = sim.worldData['__fixedStep']
    const useDt = (typeof fs === 'number' && fs > 0) ? Math.min(fs, 0.1) : dt
    try {
      const payload = cloneable(sim.worldData)
      payload.input = this.buildInput(sim.worldData)   // derived; never persisted to sim.worldData
      // slim PRESENCE for hooks: the full presence blob is host-heavy and dropped
      // by cloneable, but a hook that reacts to the ROOM (a shared/ambient world)
      // needs everyone's cursor. Hand it a compact [{x,y}] — just positions, capped
      // — so `wd.players` lets any hook light a fire per visitor, not just the local one.
      const pres = sim.worldData['presence']
      payload.players = Array.isArray(pres)
        ? pres.slice(0, 32).map((pp) => { const o = pp as { x?: number; y?: number }; return { x: Number(o.x) || 0, y: Number(o.y) || 0 } })
        : []
      this.worker.postMessage({ type: 'tick', worldData: payload, dt: useDt, fields })
      this.inFlight = true
      this.lastPostAt = perfNow()   // hang-detector baseline for this in-flight tick
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
const HOST_HEAVY = new Set(['presence', 'fieldPixels', 'cellSample', 'gpuUniforms', 'gpuPopulation', 'hud', '__play_sound', '__play_music'])

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
