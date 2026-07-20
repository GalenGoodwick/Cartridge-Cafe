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
 * @param {object} opts     { name?, ticks?=45, samples?=6, size?=400, time? }
 * @returns {Promise<{ok:boolean, png:Uint8Array|null, ...struct}>}
 */
export async function renderProbe(state, opts = {}) {
  const S = parseInt(opts.size ?? 400);
  const NTICKS = opts.ticks !== undefined ? parseInt(opts.ticks) : 45;
  const DT = 1 / 60;
  const fields = state.fields || [];
  const visuals = state.visualTypes || [];
  const modules = state.modules || [];
  const worldData = state.worldData || {};

  // ── pick the field/visual ──
  let field = null, vname = opts.name || null;
  for (const f of fields) { const n = f.visualTypeName || (typeof f.visualType === "string" ? f.visualType : null); if (n && (!vname || n === vname)) { field = f; vname = n; break; } }
  if (!field && fields.length) { field = fields[0]; vname = field.visualTypeName; }
  if (!vname) return { ok: false, png: null, errors: [{ message: "no field with a visualType to render" }] };
  const vis = visuals.find(v => v.name === vname);
  if (!vis) return { ok: false, png: null, errors: [{ message: `visual "${vname}" not found` }] };

  // ── hooks: compile + sim shim (mirrors world-sandbox.ts) ──
  const hookErrors = [];
  const simFields = new Map();
  for (const f of fields) simFields.set(f.id, { id: f.id, name: f.name, transform: { ...(f.transform || { x: 256, y: 256 }) }, properties: f.properties });
  const ZERO_INPUT = { held: {}, pressed: {}, released: {}, moveX: 0, moveY: 0, action: false, actionHeld: false, pointer: { x: 256, y: 256, down: false, pressed: false, released: false } };
  const sim = { worldData, fields: simFields, rand: Math.random, getFieldByName(n) { for (const f of simFields.values()) if (f.name === n) return f; return null; }, getField(id) { return simFields.get(id) || null; } };
  const compiled = [];
  if (Array.isArray(state.stepHooks)) for (const h of state.stepHooks) {
    try { compiled.push({ id: h.id, fn: new Function("sim", "dt", h.code) }); }
    catch (e) { hookErrors.push({ hookId: h.id, phase: "compile", error: String(e?.message || e) }); }
  }
  const runtimeErrs = new Map();
  const HOOK_BUDGET_MS = 3000; const hookT0 = performance.now();
  function tickOnce(t) {
    if (!compiled.length || NTICKS <= 0) return;
    worldData.input = ZERO_INPUT;
    for (const h of compiled) {
      try { h.fn(sim, DT); }
      catch (e) { let rec = runtimeErrs.get(h.id); if (!rec) { rec = { hookId: h.id, phase: "runtime", error: String(e?.message || e), firstTick: t, count: 0 }; runtimeErrs.set(h.id, rec); } rec.count++; }
    }
  }

  // ── compose shader (only the target visual + shared modules) ──
  const wgsl = `
${modules.map(m => m.wgsl).join("\n")}
${vis.wgsl}
struct Uni { data: array<vec4f, 64> };
@group(0) @binding(1) var<uniform> gu: Uni;
fn uni(i: i32) -> f32 { let j = clamp(i, 0, 255); return gu.data[j / 4][j % 4]; }
fn uni4(i: i32) -> vec4f { return gu.data[clamp(i, 0, 63)]; }
struct U { outSize: f32, time: f32, fx: f32, fy: f32, fw: f32, fh: f32, cr: f32, cg: f32, cb: f32, ca: f32, bgr: f32, bgg: f32, bgb: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f,3>(vec2f(-1.,-3.), vec2f(-1.,1.), vec2f(3.,1.));
  return vec4f(p[vi], 0., 1.);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let grid = (fc.xy / vec2f(u.outSize, u.outSize)) * 512.0;
  let fmin = vec2f(u.fx - u.fw*0.5, u.fy - u.fh*0.5);
  let fmax = vec2f(u.fx + u.fw*0.5, u.fy + u.fh*0.5);
  if (grid.x < fmin.x || grid.y < fmin.y || grid.x > fmax.x || grid.y > fmax.y) { return vec4f(u.bgr,u.bgg,u.bgb,1.0); }
  let uv01 = (grid - fmin) / (fmax - fmin);
  // MATCH THE ENGINE: cellPos.y=0 is the top row (uv.y increases DOWNWARD). No flip.
  let uv = vec2f(uv01.x*2.0 - 1.0, uv01.y*2.0 - 1.0);
  let o = visual_${vname}(uv, 0.0, vec4f(u.cr,u.cg,u.cb,u.ca), u.time, vec4f(0.0), vec4f(0.0));
  let keep = uni(0) * 0.0;
  return vec4f(mix(vec3f(u.bgr,u.bgg,u.bgb), o.rgb, clamp(o.a,0.0,1.0)) + vec3f(keep), 1.0);
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
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: gbuf } }] });
  const bpr = Math.ceil(S * 4 / 256) * 256;
  const rb = device.createBuffer({ size: bpr * S, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const BG = [0.03, 0.02, 0.04]; const bgb = BG.map(v => Math.round(v * 255));
  const isBg = (r, g, b) => Math.abs(r - bgb[0]) + Math.abs(g - bgb[1]) + Math.abs(b - bgb[2]) < 26;

  async function sample(time) {
    const gpu = Array.isArray(worldData.gpuUniforms) ? worldData.gpuUniforms : [];
    const UARR = new Float32Array(256); for (let i = 0; i < Math.min(gpu.length, 256); i++) UARR[i] = +gpu[i] || 0;
    const tr = simFields.get(field.id)?.transform || field.transform || {};
    const fx = tr.x ?? 256, fy = tr.y ?? 256, fw = field.w ?? 512, fh = field.h ?? 512, col = field.color || [1, 1, 1, 1];
    device.queue.writeBuffer(ubuf, 0, new Float32Array([S, time, fx, fy, fw, fh, col[0], col[1], col[2], col[3] ?? 1, BG[0], BG[1], BG[2], 0, 0, 0]));
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
  const NSAMPLES = (NTICKS > 0 && compiled.length) ? Math.max(2, parseInt(opts.samples ?? 6)) : 1;
  const sampleTicks = NSAMPLES === 1 ? [NTICKS] : Array.from({ length: NSAMPLES }, (_, s) => Math.round(1 + s * (NTICKS - 1) / (NSAMPLES - 1)));
  const samples = [];
  let cur = 0;
  for (const target of sampleTicks) {
    while (cur < target) { tickOnce(cur); cur++; if (performance.now() - hookT0 > HOOK_BUDGET_MS) { hookErrors.push({ hookId: "*", phase: "budget", error: `hook loop exceeded ${HOOK_BUDGET_MS}ms — stopped at tick ${cur}` }); break; } }
    samples.push(await sample((opts.time !== undefined ? parseFloat(opts.time) : cur * DT)));
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

  // ── result: final (most-evolved) frame's struct + motion + PNG bytes ──
  const last = samples[samples.length - 1];
  const png = encode({ width: S, height: S, data: last.data, channels: 4 });
  return {
    ok: true, visual: vname, errors: [], ticks: NTICKS, hookErrors,
    meanLum: last.meanLum, maxLum: last.maxLum, coveragePct: last.coveragePct, visible: last.coveragePct > 0.5,
    bbox: last.bbox,
    offscreenHint: last.bbox && (last.bbox.w < S * 0.15 || last.bbox.h < S * 0.15 || last.bbox.x > S * 0.7 || last.bbox.x + last.bbox.w < S * 0.3) ? "content tiny or hugging an edge — likely mis-placed" : null,
    quadrantLum: last.quadrantLum, dominantColors: last.dominantColors,
    motion, png,
  };
}
