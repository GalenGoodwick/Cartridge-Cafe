// render-core.mjs — the agent's eyes, WITHOUT a browser. Shared by:
//   · tools/render-probe.mjs      (CLI, co-located on the Mac — cafe_probe MCP)
//   · render-service/server.mjs   (HTTP, on Railway — eyes for ANY user's AI)
//
// The cafe engine is a WGSL uber-shader: a world is fields -> visuals composed
// into one shader that draws pixels. So to SEE a world we render that shader
// directly on WebGPU (Metal on the Mac; software lavapipe on Railway) and read
// the pixels. It TICKS the world's step hooks first (like world-sandbox.ts) so
// hook-driven worlds render live, renders SEVERAL frames, and derives a MOTION
// profile from the struct series. Struct + PNG come from the SAME buffer.
//
// Backend-agnostic: no Deno.* here except navigator.gpu (present in Deno both as
// CLI and as a server). PNG bytes are RETURNED (the caller writes/encodes them).
import { encode } from "npm:fast-png@6";
import { PRELUDE, HEADLESS_STUBS } from "./prelude.mjs";

/** requestAdapter that works on a real GPU (Mac/Metal) AND on a headless
 *  software stack (Railway/lavapipe). Try the normal path, then a forced
 *  fallback (software) adapter — one of the two exists on every host. */
async function getAdapter() {
  if (!globalThis.navigator?.gpu) return null;
  let a = await navigator.gpu.requestAdapter();
  if (!a) a = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
  if (!a) a = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
  return a;
}

/**
 * @param {object} state   { fields, visualTypes, modules, worldData, stepHooks }
 * @param {object} opts     { name?, ticks?=45, samples?=6, size?=400, time?, input? }
 *   opts.input — the HANDS to go with the eyes. 'auto' | 'run-right' |
 *   'tap-action' | 'sweep-cursor', or an explicit timeline:
 *   [{from, to, keys?: ['right','space',...], pointer?: {x,y,down?}}] (ticks,
 *   grid coords 0..512). The first ~1/3 of ticks always runs input-FREE as a
 *   baseline; input starts after. The result gains inputReport with a measured
 *   respondsToInput verdict — renders-but-ignores-controls becomes detectable.
 * @returns {Promise<{ok:boolean, png:Uint8Array|null, ...struct}>}
 */
export async function renderProbe(state, opts = {}) {
  const S = parseInt(opts.size ?? 400);
  const NTICKS = opts.ticks !== undefined ? parseInt(opts.ticks) : (opts.input ? 90 : 45);
  // dt per tick — 1/60 for probes; a clip passes 1/fps so one tick renders one
  // frame and sim time tracks video time (bells/animations run at real speed).
  const DT = opts.dt ? parseFloat(opts.dt) : 1 / 60;
  const fields = state.fields || [];
  const visuals = state.visualTypes || [];
  const modules = state.modules || [];
  const worldData = state.worldData || {};

  // ── the render roster: ALL fields with a visual, in field order (true
  // compositing — the old core rendered ONE field's visual and silently
  // dropped every layer above the backdrop, so a world could pass the probe
  // while its portals/creatures/overlays never rendered at all). Cap 16
  // (engine dispatch-cap parity). opts.name narrows to that visual's fields
  // (or a synthetic full-screen field if nothing references it yet). ──
  const visName = (f) => f.visualTypeName || (typeof f.visualType === "string" ? f.visualType : null);
  let renderFields = fields.filter(f => { const n = visName(f); return n && visuals.some(v => v.name === n); });
  if (opts.name) {
    const named = renderFields.filter(f => visName(f) === opts.name);
    if (named.length) renderFields = named;
    else if (visuals.some(v => v.name === opts.name)) renderFields = [{ id: "__probe", visualTypeName: opts.name, transform: { x: 256, y: 256 }, shapeType: "screen", color: [1, 1, 1, 1] }];
  }
  renderFields = renderFields.slice(0, 16);
  if (!renderFields.length) return { ok: false, png: null, errors: [{ message: "no field with a visualType to render" }] };
  // primary field/visual — reporting + back-compat
  const field = renderFields[0];
  const vname = visName(field);
  // each distinct visual's wgsl is included ONCE in the composed module
  const usedVisuals = [...new Set(renderFields.map(visName))].map(n => visuals.find(v => v.name === n));

  // ── hooks: compile + sim shim (mirrors world-sandbox.ts) ──
  const hookErrors = [];
  const simFields = new Map();
  for (const f of fields) simFields.set(f.id, { id: f.id, name: f.name, transform: { ...(f.transform || { x: 256, y: 256 }) }, properties: f.properties });

  // ── sim shim, at PARITY with the browser's world-sandbox (web/.../simulation)
  // so interactive/puzzle worlds actually ADVANCE here — without trigger/edge/
  // chapters, a hook like Tideglass throws the first frame and the clip is a
  // dead ambient loop. State lives on worldData so it persists across ticks and
  // serializes exactly like the live engine (__trig / __edge / __chapters). ──
  let _rng = null;
  if (worldData.__seed != null) {
    let a = (parseInt(worldData.__seed) >>> 0) || 1;
    _rng = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const trigState = (worldData.__trig ||= {});
  const edgeState = (worldData.__edge ||= {});
  const chapters = () => (worldData.__chapters ||= { names: [], act: 1, unlocked: { 1: true } });
  const sim = {
    worldData, fields: simFields,
    rand: () => (_rng ? _rng() : Math.random()),
    getFieldByName(n) { for (const f of simFields.values()) if (f.name === n) return f; return null; },
    getField(id) { return simFields.get(id) || null; },
    // triggers: latched one-shot — TRUE exactly once, the first frame cond is truthy
    trigger(name, cond) { if (cond && !trigState[name]) { trigState[name] = 1; return true; } return false; },
    resetTrigger(name) { trigState[name] = 0; },
    // edge: TRUE on every false→true transition (re-arms on false)
    edge(name, cond) { const c = !!cond; const was = !!edgeState[name]; edgeState[name] = c; return c && !was; },
    // chapters
    defineChapters(list) { const ch = chapters(); ch.names = Array.isArray(list) ? list.slice() : []; if (!ch.act) ch.act = 1; ch.unlocked ||= {}; ch.unlocked[1] = true; },
    get act() { return chapters().act; },
    chapterName(n) { const ch = chapters(); return ch.names[(n ?? ch.act) - 1] || ''; },
    chapterCount() { return chapters().names.length; },
    chapterUnlocked(n) { return !!chapters().unlocked[n]; },
    unlockChapter(n) { chapters().unlocked[n] = true; },
    goChapter(n) { const ch = chapters(); if (ch.unlocked[n]) { ch.act = n; return true; } return false; },
    completeChapter() { const ch = chapters(); const next = ch.act + 1; if (next <= ch.names.length) { ch.unlocked[next] = true; ch.act = next; } return ch.act; },
    // one-shot celebrations sometimes call these; harmless no-ops if unused
    emit() {}, playSound() {},
  };
  const compiled = [];
  if (Array.isArray(state.stepHooks)) for (const h of state.stepHooks) {
    try { compiled.push({ id: h.id, fn: new Function("sim", "dt", h.code) }); }
    catch (e) { hookErrors.push({ hookId: h.id, phase: "compile", error: String(e?.message || e) }); }
  }

  // ── synthetic input: the HANDS (mirrors the browser exactly) ────────────────
  // The engine has TWO input conventions and hooks use both: raw worldData keys
  // (key_right, key_space, mouse_x/mouse_y/mouse_down — how KINDLE reads the
  // cursor) and the derived wd.input {held,pressed,released,moveX,moveY,action,
  // actionHeld,pointer} that world-sandbox.buildInput() computes. We drive BOTH.
  // baseline phase (no input) is 1/3 for the input-RESPONSE probe, but a clip
  // wants the hands moving the whole time — opts.inputStart overrides it.
  const INPUT_START = opts.inputStart != null ? Math.max(1, parseInt(opts.inputStart)) : Math.max(1, Math.floor(NTICKS / 3));
  function scriptAt(t) {
    // returns { keys: string[], pointer: {x,y,down}|null } for tick t, or null
    if (!opts.input || t < INPUT_START) return null;
    const spec = opts.input;
    if (Array.isArray(spec)) {
      const keys = [], ptr = { v: null };
      for (const seg of spec) {
        if (t < (seg.from ?? 0) || t >= (seg.to ?? NTICKS)) continue;
        for (const k of (seg.keys || [])) keys.push(String(k));
        if (seg.pointer) ptr.v = { x: +seg.pointer.x || 256, y: +seg.pointer.y || 256, down: !!seg.pointer.down };
      }
      return { keys, pointer: ptr.v };
    }
    const u = t - INPUT_START, span = Math.max(1, NTICKS - INPUT_START);
    const keys = [];
    let pointer = null;
    const mode = String(spec);
    if (mode === "run-right" || mode === "auto") {
      keys.push("right");                                   // held the whole phase
      if (u % 20 < 3) keys.push("space");                   // periodic jump/action taps
    }
    if (mode === "tap-action") { if (u % 15 < 3) keys.push("space"); }
    if (mode === "sweep-cursor" || mode === "auto") {
      const p = Math.min(1, u / span);                      // grid sweep, left → right
      pointer = { x: 100 + 312 * p, y: 256, down: u % 30 < 10 };
    }
    return { keys, pointer };
  }
  // buildInput mirror (world-sandbox.ts): held/pressed/released from key_* edges,
  // moveX/moveY fold wasd+arrows, action = space/enter edge, pointer from mouse_*.
  let prevKeys = {}, prevPointerDown = false;
  const KEYNAMES = ["left", "right", "up", "down", "space", "enter", "shift", "a", "d", "s", "w"];
  function applyInput(t) {
    const scr = scriptAt(t);
    const active = new Set(scr ? scr.keys : []);
    for (const k of KEYNAMES) if (active.has(k) || ("key_" + k) in worldData) worldData["key_" + k] = active.has(k);
    if (scr?.pointer) { worldData.mouse_x = scr.pointer.x; worldData.mouse_y = scr.pointer.y; worldData.mouse_down = scr.pointer.down; }
    const held = {}, pressed = {}, released = {}, now = {};
    for (const k of Object.keys(worldData)) {
      if (!k.startsWith("key_") || k.endsWith("_n")) continue;
      const name = k.slice(4), down = !!worldData[k];
      now[name] = down;
      if (down) held[name] = true;
      if (down && !prevKeys[name]) pressed[name] = true;
      if (!down && prevKeys[name]) released[name] = true;
    }
    prevKeys = now;
    const on = (n) => !!held[n], hit = (n) => !!pressed[n];
    const pdown = !!worldData.mouse_down;
    const pointer = {
      x: worldData.mouse_x ?? 256, y: worldData.mouse_y ?? 256,
      down: pdown, pressed: pdown && !prevPointerDown, released: !pdown && prevPointerDown,
    };
    prevPointerDown = pdown;
    worldData.input = {
      held, pressed, released,
      moveX: (on("d") || on("right") ? 1 : 0) - (on("a") || on("left") ? 1 : 0),
      moveY: (on("w") || on("up") ? 1 : 0) - (on("s") || on("down") ? 1 : 0),
      action: hit("space") || hit("enter"), actionHeld: on("space") || on("enter"),
      pointer,
    };
  }

  const runtimeErrs = new Map();
  // a clip ticks a whole world's hook once per frame — the 3s probe budget would
  // guillotine it mid-render. Callers pass a generous budget for clips.
  const HOOK_BUDGET_MS = opts.hookBudgetMs ? parseInt(opts.hookBudgetMs) : 3000; const hookT0 = performance.now();
  // ── audio capture: the hook writes worldData.__play_sound / __play_music each
  // frame (the browser consumes + clears them). We record them with the frame's
  // time, then clear, so offline-audio can re-synthesize the exact soundtrack. ──
  const audioEvents = [];
  const captureAudio = (t) => {
    const time = t * DT;
    if (worldData.__play_sound != null) { audioEvents.push({ t: time, sound: worldData.__play_sound }); worldData.__play_sound = null; }
    if (worldData.__play_music != null) { audioEvents.push({ t: time, music: worldData.__play_music }); worldData.__play_music = null; }
  };
  function tickOnce(t) {
    if (!compiled.length || NTICKS <= 0) return;
    applyInput(t);
    for (const h of compiled) {
      try { h.fn(sim, DT); }
      catch (e) { let rec = runtimeErrs.get(h.id); if (!rec) { rec = { hookId: h.id, phase: "runtime", error: String(e?.message || e), firstTick: t, count: 0 }; runtimeErrs.set(h.id, rec); } rec.count++; }
    }
    captureAudio(t);
  }

  // ── compose shader: every used visual + a generated per-field composite
  // chain. Fields evaluate in field order; each sees the running composite as
  // `behind` and blends onto it (alpha, or opaque last-write for superimpose)
  // — mirroring the live hub's layering, so the probe's eyes finally match
  // the world. Geometry+color per field ride a uniform array (2 vec4 each),
  // rewritten every sample so hook-moved fields render where they ARE. ──
  const fieldChain = renderFields.map((f, i) => {
    const sup = !!(f.properties && f.properties.superimpose);
    return `  {
    let g = fr.data[${i * 2}];
    let fmin = vec2f(g.x - g.z*0.5, g.y - g.w*0.5);
    let fmax = vec2f(g.x + g.z*0.5, g.y + g.w*0.5);
    if (grid.x >= fmin.x && grid.y >= fmin.y && grid.x <= fmax.x && grid.y <= fmax.y) {
      let uv01 = (grid - fmin) / max(fmax - fmin, vec2f(0.001));
      let uv = uv01 * 2.0 - 1.0;
      let o = visual_${visName(f)}(uv, 0.0, fr.data[${i * 2 + 1}], u.time, vec4f(0.0), vec4f(colr, 1.0));
      ${sup ? `if (o.a > 0.004) { colr = o.rgb; }` : `colr = mix(colr, o.rgb, clamp(o.a, 0.0, 1.0));`}
    }
  }`;
  }).join("\n");
  const wgsl = `
${PRELUDE}
${HEADLESS_STUBS}
${modules.map(m => m.wgsl).join("\n")}
${usedVisuals.map(v => v.wgsl).join("\n")}
struct Uni { data: array<vec4f, 64> };
@group(0) @binding(1) var<uniform> gu: Uni;
fn uni(i: i32) -> f32 { let j = clamp(i, 0, 255); return gu.data[j / 4][j % 4]; }
fn uni4(i: i32) -> vec4f { return gu.data[clamp(i, 0, 63)]; }
struct FR { data: array<vec4f, 32> };
@group(0) @binding(2) var<uniform> fr: FR;
struct U { outSize: f32, time: f32, fx: f32, fy: f32, fw: f32, fh: f32, cr: f32, cg: f32, cb: f32, ca: f32, bgr: f32, bgg: f32, bgb: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f,3>(vec2f(-1.,-3.), vec2f(-1.,1.), vec2f(3.,1.));
  return vec4f(p[vi], 0., 1.);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let grid = (fc.xy / vec2f(u.outSize, u.outSize)) * 512.0;
  // MATCH THE ENGINE: cellPos.y=0 is the top row (uv.y increases DOWNWARD). No flip.
  var colr = vec3f(u.bgr, u.bgg, u.bgb);
${fieldChain}
  let keep = uni(0) * 0.0;
  return vec4f(colr + vec3f(keep), 1.0);
}`;

  const adapter = await getAdapter();
  if (!adapter) return { ok: false, png: null, errors: [{ message: "no GPU adapter (no Metal, no software Vulkan)" }], hookErrors };
  const device = await adapter.requestDevice();
  const errors = [];
  device.pushErrorScope("validation");
  const mod = device.createShaderModule({ code: wgsl });
  for (const m of (await mod.getCompilationInfo()).messages) if (m.type === "error") errors.push({ line: m.lineNum, message: m.message });
  let pipeline = null;
  try { pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module: mod, entryPoint: "vs" }, fragment: { module: mod, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] }, primitive: { topology: "triangle-list" } }); }
  catch (e) { errors.push({ message: "pipeline: " + e.message }); }
  const se = await device.popErrorScope(); if (se) errors.push({ message: String(se.message || se) });
  if (!pipeline || errors.length) return { ok: false, png: null, errors, hookErrors, visual: vname };

  // ── GPU resources (set up ONCE, reused per sample) ──
  const tex = device.createTexture({ size: [S, S], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const ubuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const gbuf = device.createBuffer({ size: 1024, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const fbuf = device.createBuffer({ size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); // 16 fields × 2 vec4
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: gbuf } }, { binding: 2, resource: { buffer: fbuf } }] });
  const bpr = Math.ceil(S * 4 / 256) * 256;
  const rb = device.createBuffer({ size: bpr * S, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const BG = [0.03, 0.02, 0.04]; const bgb = BG.map(v => Math.round(v * 255));
  const isBg = (r, g, b) => Math.abs(r - bgb[0]) + Math.abs(g - bgb[1]) + Math.abs(b - bgb[2]) < 26;

  async function sample(time) {
    const gpu = Array.isArray(worldData.gpuUniforms) ? worldData.gpuUniforms : [];
    const UARR = new Float32Array(256); for (let i = 0; i < Math.min(gpu.length, 256); i++) UARR[i] = +gpu[i] || 0;
    // Per-field geometry+color records, refreshed each sample so hook-moved
    // fields render where they ARE. Honor each field's SHAPE so the render is
    // truthful about SIZE: a 20px circle must look like a 20px dot, not a full
    // screen. screen = full grid, circle = 2·radius box, rect/other = w/h.
    const FREC = new Float32Array(128); // 16 fields × 2 vec4
    renderFields.forEach((f, i) => {
      const tr = simFields.get(f.id)?.transform || f.transform || {};
      const shapeType = f.shapeType || (f.radius != null ? "circle" : (f.w != null ? "rect" : "screen"));
      let fw, fh;
      if (shapeType === "screen") { fw = 512; fh = 512; }
      else if (shapeType === "circle") { const rad = f.radius ?? 20; fw = 2 * rad; fh = 2 * rad; }
      else { fw = f.w ?? 512; fh = f.h ?? 512; }
      const col = f.color || [1, 1, 1, 1];
      FREC.set([tr.x ?? 256, tr.y ?? 256, fw, fh, col[0], col[1], col[2], col[3] ?? 1], i * 8);
    });
    device.queue.writeBuffer(fbuf, 0, FREC);
    device.queue.writeBuffer(ubuf, 0, new Float32Array([S, time, 0, 0, 0, 0, 0, 0, 0, 0, BG[0], BG[1], BG[2], 0, 0, 0]));
    device.queue.writeBuffer(gbuf, 0, UARR);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: rb, bytesPerRow: bpr, rowsPerImage: S }, [S, S, 1]);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(rb.getMappedRange());
    const data = new Uint8Array(S * S * 4);
    let lumSum = 0, lumMax = 0, cover = 0, minX = S, minY = S, maxX = 0, maxY = 0, cmX = 0, cmY = 0; const hist = {}; const quad = [0, 0, 0, 0], quadN = [0, 0, 0, 0];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const s = y * bpr + x * 4, d = (y * S + x) * 4; const r = raw[s], g = raw[s + 1], b = raw[s + 2];
      data[d] = r; data[d + 1] = g; data[d + 2] = b; data[d + 3] = 255;
      const l = Math.max(r, g, b); lumSum += l; if (l > lumMax) lumMax = l;
      const q = (y < S / 2 ? 0 : 2) + (x < S / 2 ? 0 : 1); quad[q] += l; quadN[q]++;
      if (!isBg(r, g, b)) { cover++; cmX += x; cmY += y; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; hist[`${r >> 6},${g >> 6},${b >> 6}`] = (hist[`${r >> 6},${g >> 6},${b >> 6}`] || 0) + 1; }
    }
    rb.unmap();
    const N = S * S;
    return {
      data, meanLum: +(lumSum / N).toFixed(1), maxLum: lumMax, coveragePct: +(100 * cover / N).toFixed(2),
      comX: cover ? +(cmX / cover / S).toFixed(3) : 0.5, comY: cover ? +(cmY / cover / S).toFixed(3) : 0.5,
      bbox: cover ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY, centeredX: +((minX + maxX) / 2 / S).toFixed(2), centeredY: +((minY + maxY) / 2 / S).toFixed(2) } : null,
      quadrantLum: quad.map((q, i) => +(q / quadN[i]).toFixed(0)),
      dominantColors: Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ rgb: k.split(",").map(n => +n * 64 + 32), pct: +(100 * v / N).toFixed(1) })),
    };
  }

  // ── run: tick, sampling the struct at several points across the loop ──
  // input mode wants more samples so BOTH phases (baseline / input-on) get ≥2 deltas
  // clip mode: render `frames` evenly across the loop, encode each → PNG sequence
  const CLIP = opts.frames ? Math.max(2, Math.min(900, parseInt(opts.frames))) : 0;
  const NSAMPLES = CLIP || ((NTICKS > 0 && compiled.length) ? Math.max(2, parseInt(opts.samples ?? (opts.input ? 8 : 6))) : 1);
  const sampleTicks = NSAMPLES === 1 ? [NTICKS] : Array.from({ length: NSAMPLES }, (_, s) => Math.round(1 + s * (NTICKS - 1) / (NSAMPLES - 1)));
  const samples = [];
  let cur = 0;
  for (const target of sampleTicks) {
    while (cur < target) { tickOnce(cur); cur++; if (performance.now() - hookT0 > HOOK_BUDGET_MS) { hookErrors.push({ hookId: "*", phase: "budget", error: `hook loop exceeded ${HOOK_BUDGET_MS}ms — stopped at tick ${cur}` }); break; } }
    const snap = await sample((opts.time !== undefined ? parseFloat(opts.time) : cur * DT));
    snap.tick = cur;
    samples.push(snap);
  }
  for (const rec of runtimeErrs.values()) hookErrors.push(rec);

  // ── motion from the struct series ──
  let motion = null;
  if (samples.length >= 2) {
    const comX = samples.map(s => s.comX), comY = samples.map(s => s.comY), lums = samples.map(s => s.meanLum), covs = samples.map(s => s.coveragePct);
    const range = a => Math.max(...a) - Math.min(...a);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const deltas = [];
    for (let i = 1; i < samples.length; i++) { let dd = 0; const a = samples[i].data, b = samples[i - 1].data; for (let p = 0; p < a.length; p += 4) dd += Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]); deltas.push(dd / (S * S * 3)); }
    const avgDelta = mean(deltas), travelX = range(comX), travelY = range(comY);
    const nan = [...lums, ...covs].some(v => !isFinite(v));
    const up = a => a[a.length - 1] > a[0] * 3 && a.every((v, i) => i === 0 || v >= a[i - 1] - 1);
    motion = {
      samples: samples.length, comX, comY, meanLum: lums, coveragePct: covs,
      travel: { x: +travelX.toFixed(3), y: +travelY.toFixed(3) },
      frameDeltas: deltas.map(d => +d.toFixed(1)), avgFrameDelta: +avgDelta.toFixed(1),
      moving: avgDelta > 1.5,
      vibrating: avgDelta > 4 && travelX < 0.02 && travelY < 0.02,
      diverging: nan || up(lums) || up(covs),
      settling: deltas.length >= 3 && mean(deltas.slice(-2)) < mean(deltas.slice(0, 2)) * 0.6,
    };
  }

  // ── input verdict: did pressing controls change anything? ───────────────────
  // Split the per-frame deltas + travel into BASELINE (no input) vs INPUT-ON by
  // the later sample's tick, and report whether the input phase is measurably
  // more active. Catches "renders but ignores the controls" — the rhythm world
  // that looked fine but nobody could actually play.
  let inputReport = null;
  if (opts.input && samples.length >= 3) {
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const range = a => a.length ? Math.max(...a) - Math.min(...a) : 0;
    const frameDelta = (i) => { let dd = 0; const a = samples[i].data, b = samples[i - 1].data; for (let p = 0; p < a.length; p += 4) dd += Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]); return dd / (S * S * 3); };
    const baseD = [], inD = [];
    for (let i = 1; i < samples.length; i++) (samples[i].tick <= INPUT_START ? baseD : inD).push(frameDelta(i));
    const baseCom = samples.filter(s => s.tick <= INPUT_START), inCom = samples.filter(s => s.tick > INPUT_START);
    const baseTravel = range(baseCom.map(s => s.comX)) + range(baseCom.map(s => s.comY));
    const inTravel = range(inCom.map(s => s.comX)) + range(inCom.map(s => s.comY));
    const baseDelta = +mean(baseD).toFixed(1), inDelta = +mean(inD).toFixed(1);
    const responds = inDelta > Math.max(2, baseDelta * 1.4) || inTravel > Math.max(0.03, baseTravel * 1.5 + 0.02);
    inputReport = {
      preset: Array.isArray(opts.input) ? "timeline" : String(opts.input),
      baselineFrameDelta: baseDelta, inputFrameDelta: inDelta,
      baselineTravel: +baseTravel.toFixed(3), inputTravel: +inTravel.toFixed(3),
      respondsToInput: !!responds,
      note: responds
        ? "the world reacted to the pressed controls"
        : "NO measurable reaction to input — the controls may be unwired, or the world only auto-animates. If the brief promised interactivity, the input handling is broken; check that the hook reads wd.input (moveX/action/pointer) or wd.key_*/mouse_*.",
    };
  }

  // ── result: final (most-evolved) frame's struct + motion + PNG bytes ──
  const last = samples[samples.length - 1];
  const png = encode({ width: S, height: S, data: last.data, channels: 4 });
  // clip: encode every sampled frame → PNG sequence (endpoint stitches to mp4)
  const frames = CLIP ? samples.map((sm) => encode({ width: S, height: S, data: sm.data, channels: 4 })) : null;
  return {
    frames,
    ok: true, visual: vname, errors: [], ticks: NTICKS, hookErrors,
    meanLum: last.meanLum, maxLum: last.maxLum, coveragePct: last.coveragePct, visible: last.coveragePct > 0.5,
    bbox: last.bbox,
    offscreenHint: last.bbox && (last.bbox.w < S * 0.15 || last.bbox.h < S * 0.15 || last.bbox.x > S * 0.7 || last.bbox.x + last.bbox.w < S * 0.3) ? "content tiny or hugging an edge — likely mis-placed" : null,
    quadrantLum: last.quadrantLum, dominantColors: last.dominantColors,
    motion, inputReport, png,
    audioEvents,   // frame-stamped __play_sound/__play_music for offline-audio
  };
}
