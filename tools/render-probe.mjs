// render-probe.mjs — the agent's eyes, WITHOUT a browser.
//
// The cafe engine is a WGSL uber-shader: a world is fields -> visuals composed
// into one shader that draws pixels. So to SEE a world we render that shader
// directly on Deno's native WebGPU (Metal, headless, ms) and read the pixels.
//
// It also TICKS the world's step hooks first (like web/src/app/engine/world-sandbox.ts),
// so hook-driven worlds render in a LIVE frame — not their dead boot state — and
// every hook compile/runtime throw is surfaced as hookErrors. Without ticking the
// probe only ever sees frame 0 of a static shader.
//
// Emits a PIXEL-STATE STRUCT (brightness, coverage, bbox, dominant colors,
// per-quadrant) that decides the dark/blank/off-screen class from numbers alone,
// plus hookErrors, plus a PNG for a vision agent to cross-confirm the look. Struct
// and image come from the SAME buffer, so they must agree.
//
// Deno: deno run -A --unstable-webgpu tools/render-probe.mjs --state s.json --name v --out o.png [--ticks 45]
import { encode } from "npm:fast-png@6";

const A = {}; for (let i = 0; i < Deno.args.length; i += 2) A[Deno.args[i].replace(/^--/, "")] = Deno.args[i + 1];
const S = parseInt(A.size || "400");
const NTICKS = A.ticks !== undefined ? parseInt(A.ticks) : 45;   // ~0.75s @ 60fps; --ticks 0 = static
const DT = 1 / 60;
const state = JSON.parse(await Deno.readTextFile(A.state));
const fields = state.fields || [];
const visuals = state.visualTypes || [];
const modules = state.modules || [];
const worldData = state.worldData || {};

// ── pick the field/visual to render ──
let field = null, vname = A.name || null;
for (const f of fields) { const n = f.visualTypeName || (typeof f.visualType === "string" ? f.visualType : null); if (n && (!vname || n === vname)) { field = f; vname = n; break; } }
if (!field && fields.length) { field = fields[0]; vname = field.visualTypeName; }
if (!vname) { console.log(JSON.stringify({ ok: false, errors: [{ message: "no field with a visualType to render" }] })); Deno.exit(1); }
const vis = visuals.find(v => v.name === vname);
if (!vis) { console.log(JSON.stringify({ ok: false, errors: [{ message: `visual "${vname}" not found` }] })); Deno.exit(1); }

// ── TICK the step hooks (evolve gpuUniforms + field transforms to a live frame) ──
// Mirrors world-sandbox.ts: each hook is new Function('sim','dt',code) run against
// a shim. Compile + runtime throws are caught per hook (never wedge the probe), and
// the whole loop is under a hard wall-time budget so a runaway hook can't hang us.
const hookErrors = [];
const simFields = new Map();
for (const f of fields) simFields.set(f.id, { id: f.id, name: f.name, transform: { ...(f.transform || { x: 256, y: 256 }) }, properties: f.properties });
const ZERO_INPUT = { held: {}, pressed: {}, released: {}, moveX: 0, moveY: 0, action: false, actionHeld: false, pointer: { x: 256, y: 256, down: false, pressed: false, released: false } };
const sim = {
  worldData,
  fields: simFields,
  rand: Math.random,
  getFieldByName(n) { for (const f of simFields.values()) if (f.name === n) return f; return null; },
  getField(id) { return simFields.get(id) || null; },
};
if (NTICKS > 0 && Array.isArray(state.stepHooks) && state.stepHooks.length) {
  const compiled = [];
  for (const h of state.stepHooks) {
    try { compiled.push({ id: h.id, fn: new Function("sim", "dt", h.code) }); }
    catch (e) { hookErrors.push({ hookId: h.id, phase: "compile", error: String(e?.message || e) }); }
  }
  const BUDGET_MS = 3000; const t0 = performance.now();
  // one runtime record per hook (a hook that throws every tick is ONE problem,
  // not 45) — keep the first message + a count so the daemon sees signal not spam
  const runtimeErrs = new Map();
  outer: for (let t = 0; t < NTICKS; t++) {
    worldData.input = ZERO_INPUT;
    for (const h of compiled) {
      try { h.fn(sim, DT); }
      catch (e) {
        let rec = runtimeErrs.get(h.id);
        if (!rec) { rec = { hookId: h.id, phase: "runtime", error: String(e?.message || e), firstTick: t, count: 0 }; runtimeErrs.set(h.id, rec); }
        rec.count++;
      }
      if (performance.now() - t0 > BUDGET_MS) { hookErrors.push({ hookId: h.id, phase: "budget", error: `hook loop exceeded ${BUDGET_MS}ms — stopped at tick ${t}` }); break outer; }
    }
  }
  for (const rec of runtimeErrs.values()) hookErrors.push(rec);
}
// evolved outputs
const T = A.time !== undefined ? parseFloat(A.time) : +(NTICKS * DT).toFixed(4);
const tr = simFields.get(field.id)?.transform || field.transform || {};
const fx = tr.x ?? 256, fy = tr.y ?? 256;
const fw = field.w ?? 512, fh = field.h ?? 512;
const col = field.color || [1, 1, 1, 1];
const gpu = Array.isArray(worldData.gpuUniforms) ? worldData.gpuUniforms : [];
const UARR = new Float32Array(256); for (let i = 0; i < Math.min(gpu.length, 256); i++) UARR[i] = +gpu[i] || 0;

// ── compose + render (only the target visual + shared modules; engine isolates each) ──
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
  let uv = vec2f(uv01.x*2.0 - 1.0, -(uv01.y*2.0 - 1.0));
  let o = visual_${vname}(uv, 0.0, vec4f(u.cr,u.cg,u.cb,u.ca), u.time, vec4f(0.0), vec4f(0.0));
  let keep = uni(0) * 0.0;   // force the gpuUniforms binding live even if the visual never reads uni() (else auto-layout drops it and the bind group is invalid)
  return vec4f(mix(vec3f(u.bgr,u.bgg,u.bgb), o.rgb, clamp(o.a,0.0,1.0)) + vec3f(keep), 1.0);
}`;

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) { console.log(JSON.stringify({ ok: false, errors: [{ message: "no GPU adapter" }], hookErrors })); Deno.exit(2); }
const device = await adapter.requestDevice();
const errors = [];
device.pushErrorScope("validation");
const mod = device.createShaderModule({ code: wgsl });
for (const m of (await mod.getCompilationInfo()).messages) if (m.type === "error") errors.push({ line: m.lineNum, message: m.message });
let pipeline = null;
try { pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module: mod, entryPoint: "vs" }, fragment: { module: mod, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] }, primitive: { topology: "triangle-list" } }); }
catch (e) { errors.push({ message: "pipeline: " + e.message }); }
const se = await device.popErrorScope(); if (se) errors.push({ message: String(se.message || se) });
if (!pipeline || errors.length) { console.log(JSON.stringify({ ok: false, errors, hookErrors, visual: vname })); Deno.exit(1); }

const tex = device.createTexture({ size: [S, S], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
const ubuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const gbuf = device.createBuffer({ size: 1024, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const bg = [0.03, 0.02, 0.04];
device.queue.writeBuffer(ubuf, 0, new Float32Array([S, T, fx, fy, fw, fh, col[0], col[1], col[2], col[3] ?? 1, bg[0], bg[1], bg[2], 0, 0, 0]));
device.queue.writeBuffer(gbuf, 0, UARR);
const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: gbuf } }] });
const bpr = Math.ceil(S * 4 / 256) * 256;
const rb = device.createBuffer({ size: bpr * S, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
const enc = device.createCommandEncoder();
const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
enc.copyTextureToBuffer({ texture: tex }, { buffer: rb, bytesPerRow: bpr, rowsPerImage: S }, [S, S, 1]);
device.queue.submit([enc.finish()]);
await rb.mapAsync(GPUMapMode.READ);
const raw = new Uint8Array(rb.getMappedRange());

// ── pixel-state struct ──
const data = new Uint8Array(S * S * 4);
const bgb = [Math.round(bg[0] * 255), Math.round(bg[1] * 255), Math.round(bg[2] * 255)];
const isBg = (r, g, b) => Math.abs(r - bgb[0]) + Math.abs(g - bgb[1]) + Math.abs(b - bgb[2]) < 26;
let lumSum = 0, lumMax = 0, cover = 0, minX = S, minY = S, maxX = 0, maxY = 0; const hist = {}; const quad = [0, 0, 0, 0], quadN = [0, 0, 0, 0];
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const s = y * bpr + x * 4, d = (y * S + x) * 4; const r = raw[s], g = raw[s + 1], b = raw[s + 2];
  data[d] = r; data[d + 1] = g; data[d + 2] = b; data[d + 3] = 255;
  const l = Math.max(r, g, b); lumSum += l; if (l > lumMax) lumMax = l;
  const q = (y < S / 2 ? 0 : 2) + (x < S / 2 ? 0 : 1); quad[q] += l; quadN[q]++;
  if (!isBg(r, g, b)) { cover++; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; hist[`${r >> 6},${g >> 6},${b >> 6}`] = (hist[`${r >> 6},${g >> 6},${b >> 6}`] || 0) + 1; }
}
const N = S * S;
const dom = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ rgb: k.split(",").map(n => +n * 64 + 32), pct: +(100 * v / N).toFixed(1) }));
const out = A.out || "/tmp/render-probe.png";
await Deno.writeFile(out, encode({ width: S, height: S, data, channels: 4 }));
console.log(JSON.stringify({
  ok: true, visual: vname, errors: [], ticks: NTICKS, hookErrors,
  meanLum: +(lumSum / N).toFixed(1), maxLum: lumMax,
  coveragePct: +(100 * cover / N).toFixed(1), visible: cover / N > 0.005,
  bbox: cover ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY, centeredX: +((minX + maxX) / 2 / S).toFixed(2), centeredY: +((minY + maxY) / 2 / S).toFixed(2) } : null,
  offscreenHint: cover && (maxX - minX < S * 0.15 || maxY - minY < S * 0.15 || minX > S * 0.7 || maxX < S * 0.3) ? "content tiny or hugging an edge — likely mis-placed" : null,
  quadrantLum: quad.map((q, i) => +(q / quadN[i]).toFixed(0)),
  dominantColors: dom, png: out,
}));
