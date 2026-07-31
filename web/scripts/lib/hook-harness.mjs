// hook-harness — run a world's STEP HOOK (its game logic) in node against a mock
// sim, so the rules can be asserted BEFORE a playtest — no browser, no deploy.
// The mock sim mirrors world-sandbox.ts (worldData ops only); KEEP IT IN SYNC
// with that file the same way the chapters/trigger primitives are mirrored — a
// method the real sandbox adds must be added here too, or a hook that calls it
// silently no-ops (the Proxy hands back a no-op for anything unknown, matching
// the sandbox's own trap).

/** A mock of the sealed-worker sim: worldData + the persist-aware latch/chapter
 *  primitives, plus a no-op Proxy for anything a hook reaches that we don't
 *  model (so an incomplete mock never throws — it degrades like the sandbox). */
export function makeSandboxSim() {
  const fields = new Map([['f0', { id: 'f0', name: 'World', transform: { x: 256, y: 256, vx: 0, vy: 0 }, properties: new Map(), visualParams: [] }]])
  const base = {
    worldData: { save: {}, mouse_x: -100, mouse_y: -100, mouse_down: false },
    fields,
    rand: () => 0.5,
    getFieldByName(n) { for (const f of fields.values()) if (f.name === n) return f; return null },
    getField(id) { return fields.get(id) || null },
    _latchRoot() { const wd = this.worldData; if (wd.persist) { if (!wd.save) wd.save = {}; return wd.save } return wd },
    trigger(id, c) { const R = this._latchRoot(); if (!R.__trig) R.__trig = {}; const L = R.__trig; if (c) { if (!L[id]) { L[id] = true; return true } } return false },
    edge(id, c) { const R = this._latchRoot(); if (!R.__edge) R.__edge = {}; const L = R.__edge; const w = !!L[id], n = !!c; L[id] = n; return n && !w },
    resetTrigger(id) { const L = this._latchRoot().__trig; if (L) delete L[id] },
    _ch() { const R = this._latchRoot(); let c = R.__chapters; if (!c) { c = { names: [''], unlocked: [1], cur: 1 }; R.__chapters = c } return c },
    defineChapters(names) { const c = this._ch(); c.names = ['', ...names]; if (!c.unlocked?.length) c.unlocked = [1]; if (!c.cur) c.cur = 1 },
    get act() { return this._ch().cur },
    chapterName(n) { const c = this._ch(); return c.names[n == null ? c.cur : n] || '' },
    chapterCount() { return this._ch().names.length - 1 },
    chapterUnlocked(n) { return this._ch().unlocked.includes(n) },
    unlockChapter(n) { const c = this._ch(); if (n >= 1 && n <= this.chapterCount() && !c.unlocked.includes(n)) c.unlocked.push(n) },
    goChapter(n) { const c = this._ch(); if (c.unlocked.includes(n)) { c.cur = n; return true } return false },
    completeChapter() { const c = this._ch(); const nx = c.cur + 1; if (nx <= this.chapterCount()) { this.unlockChapter(nx); c.cur = nx; return true } return false },
    // sim.defineScenes is available in the real sim; expose a thin shim so hooks
    // that use it don't no-op. Import the real one if your test needs it.
  }
  return new Proxy(base, { get(t, p, r) { if (typeof p === 'symbol' || p in t) return Reflect.get(t, p, r); return () => undefined } })
}

/** Drive a hook: returns {wd, save, tick, settle, click}. `persist` on by
 *  default so per-player latches land in wd.save like a persist world. */
export function runWorld(hookCode, opts = {}) {
  const hookFn = new Function('sim', 'dt', hookCode)
  const sim = makeSandboxSim()
  const wd = sim.worldData
  if (opts.persist !== false) wd.persist = true
  const dt = opts.dt ?? 0.016
  const tick = (inp = {}) => {
    wd.mouse_x = inp.mx ?? -100; wd.mouse_y = inp.my ?? -100
    wd.mouse_down = !!inp.down
    for (const k in inp.keys || {}) wd['key_' + k] = !!inp.keys[k]
    try { hookFn(sim, dt) } catch (e) { wd.__throw = String(e && e.message || e) }
    return wd
  }
  tick()   // warm up: let the hook initialise its save state
  return {
    sim, wd,
    save: () => wd.save,
    tick,
    settle: (n = 6) => { for (let i = 0; i < n; i++) tick() },        // let a crossfade / transition settle
    click: (x, y) => { tick(); tick({ mx: x, my: y, down: true }); tick({ mx: x, my: y, down: false }) },
  }
}

/** Minimal assert helper for specs. */
export function makeAsserter() {
  const r = { pass: 0, fail: 0 }
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    console.log(`${ok ? '\x1b[32m✓' : '\x1b[31m✗'} ${name}\x1b[0m` + (ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`))
    ok ? r.pass++ : r.fail++
  }
  return { eq, result: r }
}
