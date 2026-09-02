#!/usr/bin/env node
// render-local — a PORTABLE local eye. Assembles a world's whole uber-shader
// (modules + visual, with optional local edits), runs the real step hook to
// produce the whiteboard uniforms at a forced state, renders one frame, and
// writes a PNG — all LOCAL: no deploy, no cloud probe. Prefers the machine's GPU
// for speed; SW=1 forces SwiftShader (software — no GPU, works on any computer).
//
//   node scripts/render-local.mjs --slug tideglass --out kiln.png
//   node scripts/render-local.mjs --slug tideglass --setup scripts/specs/tideglass.states.mjs --state kiln-bloom
//   SW=1 node scripts/render-local.mjs --slug tideglass                 # software (any computer)
//   node scripts/render-local.mjs --slug tideglass --override ./edits   # render local module edits
//
// --setup   an ES module default-exporting { <stateName>: (G) => void }
// --state   which state from --setup to force (default: first / init state)
// --t       time (seconds) to render at (default 5)
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { fileURLToPath } from 'url'
import { dirname, join, basename, resolve } from 'path'
import http from 'http'
import { chromium } from 'playwright'
import { runWorld } from './lib/hook-harness.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ORIGIN = process.env.CAFE_ORIGIN || 'https://cartridge.cafe'
const arg = n => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : null }
const fail = m => { console.error('\x1b[31m' + m + '\x1b[0m'); process.exit(2) }

// engine helper library + provided-fn bindings (real uni/pop reading buffers we set)
const shSrc = readFileSync(join(HERE, '..', 'src', 'app', 'engine', 'shaders.ts'), 'utf8')
const uB1 = shSrc.indexOf('`', shSrc.indexOf('const SHADER_UTILITIES'))
const UTILS = shSrc.slice(uB1 + 1, shSrc.indexOf('`', uB1 + 1))

const snap = await (async () => {
  const sp = arg('snapshot'); if (sp) { const j = JSON.parse(readFileSync(sp, 'utf8')); return j.snapshot ?? j }
  const slug = arg('slug'); if (!slug) fail('need --slug or --snapshot')
  const r = await fetch(`${ORIGIN}/api/spaces/${encodeURIComponent(slug)}/snapshot`)
  if (!r.ok) fail(`could not fetch "${slug}" (${r.status})`)
  return (await r.json()).snapshot
})()

// modules (+ local overrides) + the primary visual
const mods = new Map((snap.modules || []).map(m => [m.name, m.wgsl]))
const odir = arg('override')
if (odir && existsSync(odir)) for (const f of readdirSync(odir).filter(f => f.endsWith('.wgsl'))) mods.set(basename(f, '.wgsl'), readFileSync(join(odir, f), 'utf8'))
const visualEntry = (snap.visualTypes || []).find(v => /fn\s+visual_\w+\s*\(/.test(v.wgsl || ''))
if (!visualEntry) fail('no visual with a visual_* fn in the snapshot')
const visualFn = 'visual_' + visualEntry.name

const SHADER = `
@group(0) @binding(0) var<storage, read> WB: array<vec4f>;
@group(0) @binding(1) var<uniform> POPB: array<vec4f, 4096>;
fn uni(i: i32) -> f32 { let v = WB[clamp(i,0,255)/4]; let c = clamp(i,0,255)%4; if (c==0){return v.x;} if (c==1){return v.y;} if (c==2){return v.z;} return v.w; }
fn uni4(i: i32) -> vec4f { return WB[clamp(i,0,63)]; }
fn pop(i: i32) -> vec4f { return POPB[1 + clamp(i,0,4094)]; }
fn popCount() -> i32 { return i32(POPB[0].x); }
fn pix() -> vec2f { return vec2f(0.0); }
fn prevHere() -> vec4f { return vec4f(0.0); }
fn prevAt(o: vec2f) -> vec4f { return vec4f(0.0); }
fn feedback(c: vec2f) -> vec4f { return vec4f(0.0); }
fn feedbackUV(c: vec2f) -> vec2f { return vec2f(0.0); }
fn sampleTarget(id: u32, p: vec2f) -> vec4f { return vec4f(0.0); }
fn sampleTargetUV(id: u32, uv: vec2f) -> vec4f { return vec4f(0.0); }
${UTILS}
${[...mods.values()].join('\n')}
${visualEntry.wgsl}
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f,3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 256.0 - 1.0;
  return ${visualFn}(uv, 0.0, vec4f(0.0), uni(3), vec4f(0.0), vec4f(0.0));
}`

// ── whiteboard uniforms: run the real hook at a forced state ──
const t = parseFloat(arg('t') || '5')
let setup = () => {}
const setupFile = arg('setup')
if (setupFile) {
  const states = (await import(pathToFileURL(resolve(setupFile)).href)).default
  const name = arg('state') || Object.keys(states)[0]
  if (!states[name]) fail(`state "${name}" not in ${setupFile} (have: ${Object.keys(states).join(', ')})`)
  setup = states[name]
}
// pick the hook that actually drives the frame (writes gpuUniforms/gpuPopulation),
// not just stepHooks[0] (often an empty born-slot). --ticks N runs it N times so
// populations spawn/settle before the frame.
const hook = (snap.stepHooks || []).find(h => /gpuPopulation|gpuUniforms/.test(h.code || '')) || (snap.stepHooks || [])[0]
const ticks = Math.max(1, parseInt(arg('ticks') || '1', 10))
const U = new Float32Array(256)
let POPsrc = []
if (hook?.code) {
  const w = runWorld(hook.code)
  try { setup(w.save()) } catch (e) { console.warn('setup threw (continuing):', e.message) }
  for (let k = 0; k < ticks; k++) { w.wd.__t = t; w.tick() }
  const src = w.wd.gpuUniforms || []
  for (let i = 0; i < Math.min(src.length, 256); i++) U[i] = src[i] || 0
  POPsrc = w.wd.gpuPopulation || []
}
U[3] = U[3] || t   // ensure a time is present even for hookless worlds
// pack the population the way POPB expects: [0].x = count, then vec4 per entity
const POP = new Float32Array(4096 * 4)
POP[0] = Math.min(4095, (POPsrc.length / 4) | 0)
for (let i = 0; i < Math.min(POPsrc.length, 4095 * 4); i++) POP[4 + i] = POPsrc[i] || 0

// ── render (GPU by default; SW=1 → SwiftShader, any computer) ──
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<!doctype html><body>') })
await new Promise(r => srv.listen(0, r)); const port = srv.address().port
const launch = { headless: true, args: ['--headless=new', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist'] }
let browser
try { browser = await chromium.launch({ ...launch, channel: 'chrome' }) } catch { browser = await chromium.launch(launch) }
const page = await browser.newPage()
await page.goto('http://localhost:' + port)
const res = await page.evaluate(async ({ shader, u, pop, sw }) => {
  const W = 512
  if (!navigator.gpu) return { error: 'no WebGPU in this browser build' }
  const adapter = await navigator.gpu.requestAdapter(sw ? { forceFallbackAdapter: true } : {})
  if (!adapter) return { error: sw ? 'no software (fallback) adapter' : 'no GPU adapter' }
  const dev = await adapter.requestDevice()
  const mod = dev.createShaderModule({ code: shader })
  const errs = (await mod.getCompilationInfo()).messages.filter(m => m.type === 'error')
  if (errs.length) return { error: 'COMPILE:\n' + errs.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n') }
  dev.pushErrorScope('validation')
  const tex = dev.createTexture({ size: [W, W], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
  const wb = dev.createBuffer({ size: 1024, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(wb, 0, new Float32Array(u))
  const popb = dev.createBuffer({ size: 4096 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(popb, 0, new Float32Array(pop))
  const bgl = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] })
  const pipe = dev.createRenderPipeline({ layout: dev.createPipelineLayout({ bindGroupLayouts: [bgl] }), vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } })
  const bg = dev.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: wb } }, { binding: 1, resource: { buffer: popb } }] })
  const enc = dev.createCommandEncoder()
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
  pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.draw(3); pass.end()
  const rb = dev.createBuffer({ size: W * W * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  enc.copyTextureToBuffer({ texture: tex }, { buffer: rb, bytesPerRow: W * 4, rowsPerImage: W }, [W, W])
  dev.queue.submit([enc.finish()]); await dev.queue.onSubmittedWorkDone()
  const v = await dev.popErrorScope(); if (v) return { error: 'VALIDATION: ' + v.message }
  await rb.mapAsync(GPUMapMode.READ)
  const bytes = new Uint8ClampedArray(rb.getMappedRange().slice(0)); rb.unmap()
  const out = document.createElement('canvas'); out.width = W; out.height = W
  out.getContext('2d').putImageData(new ImageData(bytes, W, W), 0, 0)
  return { png: out.toDataURL('image/png'), backend: adapter.info?.architecture || (sw ? 'software' : 'gpu') }
}, { shader: SHADER, u: Array.from(U), pop: Array.from(POP), sw: !!process.env.SW })
await browser.close(); srv.close()
if (res.error) { console.log('\x1b[31m✗ ' + res.error + '\x1b[0m'); process.exit(1) }
const outPath = arg('out') || `render-${arg('state') || 'init'}.png`
writeFileSync(outPath, Buffer.from(res.png.split(',')[1], 'base64'))
console.log(`\x1b[32m✓ rendered on ${res.backend} → ${outPath}\x1b[0m`)
