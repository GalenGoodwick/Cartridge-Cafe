'use client'

// cards-live-art — the art windows are ALIVE (MAP.cards: cards-live-art).
// Each card's composed icon shader (the engine's `visual_*` convention, via
// composeIcon) runs in REAL WebGPU inside the grid: one shared device, one
// 30fps loop, per-card canvases, IntersectionObserver so only visible cards
// draw. A shader that fails to compile — or a machine with no WebGPU — falls
// silently to the baked PNG, then the hue placeholder. The card never breaks.

import { useEffect, useRef } from 'react'

type Entry = {
  canvas: HTMLCanvasElement
  ctx: GPUCanvasContext
  pipeline: GPURenderPipeline
  ubuf: GPUBuffer
  bind: GPUBindGroup
  visible: boolean
  t0: number
}

const REG = new Set<Entry>()
let device: GPUDevice | null = null
let format: GPUTextureFormat = 'bgra8unorm'
let devicePromise: Promise<GPUDevice | null> | null = null
let loopOn = false

async function getDevice(): Promise<GPUDevice | null> {
  if (device) return device
  if (!devicePromise) {
    devicePromise = (async () => {
      try {
        const gpu = (navigator as { gpu?: GPU }).gpu
        if (!gpu) return null
        const adapter = await gpu.requestAdapter()
        if (!adapter) return null
        device = await adapter.requestDevice()
        format = gpu.getPreferredCanvasFormat()
        device.lost.then(() => { device = null; devicePromise = null; REG.clear() })
        return device
      } catch { return null }
    })()
  }
  return devicePromise
}

/** Wrap a composed icon (visual_* fn + modules) into a standalone shader.
 *  Entry pick: `visual_icon` when present (compose's wrapper), else the LAST
 *  visual_* defined. `uni()` is stubbed only if referenced and undefined. */
function wrapIcon(wgsl: string, hue: number | null): string {
  const fns = [...wgsl.matchAll(/fn\s+(visual_\w+)\s*\(/g)].map(m => m[1])
  const entry = fns.includes('visual_icon') ? 'visual_icon' : fns[fns.length - 1]
  if (!entry) throw new Error('no visual fn')
  const uniStub = /\buni\s*\(/.test(wgsl) && !/fn\s+uni\s*\(/.test(wgsl)
    ? 'fn uni(i: i32) -> f32 { return 0.0; }\n' : ''
  const h = hue ?? 0.08
  // hue → a warm-ish field color for visuals that read `color`
  const c = `vec4f(${(0.55 + 0.4 * Math.abs(Math.cos(h * 6.283))).toFixed(3)}, ${(0.45 + 0.3 * Math.abs(Math.sin(h * 6.283 + 1))).toFixed(3)}, ${(0.35 + 0.4 * Math.abs(Math.sin(h * 6.283))).toFixed(3)}, 1.0)`
  return `${uniStub}${wgsl}
struct QU { t: f32, ar: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> qu: QU;
@vertex fn card_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn card_fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let res = vec2f(qu.ar * 256.0, 256.0);
  var uv = (fp.xy / res) * 2.0 - 1.0;
  uv.x = uv.x * qu.ar;
  let c = ${entry}(uv, 0.0, ${c}, qu.t, vec4f(0.0), vec4f(0.02, 0.015, 0.01, 1.0));
  return vec4f(c.rgb * c.a + vec3f(0.04, 0.025, 0.015) * (1.0 - c.a), 1.0);
}`
}

function ensureLoop() {
  if (loopOn) return
  loopOn = true
  let last = 0
  const frame = (now: number) => {
    if (!device) { loopOn = false; return }
    if (now - last >= 33) {                       // ~30fps cap
      last = now
      const enc = device.createCommandEncoder()
      let drew = false
      for (const e of REG) {
        if (!e.visible) continue
        try {
          device.queue.writeBuffer(e.ubuf, 0, new Float32Array([(now - e.t0) / 1000, e.canvas.width / e.canvas.height, 0, 0]))
          const pass = enc.beginRenderPass({
            colorAttachments: [{ view: e.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.03, g: 0.02, b: 0.015, a: 1 } }],
          })
          pass.setPipeline(e.pipeline)
          pass.setBindGroup(0, e.bind)
          pass.draw(3)
          pass.end()
          drew = true
        } catch { REG.delete(e) }
      }
      if (drew) device.queue.submit([enc.finish()])
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

export function LiveArt({ wgsl, hue, onFail }: { wgsl: string; hue: number | null; onFail: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const failRef = useRef(onFail)
  failRef.current = onFail

  useEffect(() => {
    let dead = false
    let entry: Entry | null = null
    let io: IntersectionObserver | null = null
    ;(async () => {
      const dev = await getDevice()
      const cv = ref.current
      if (dead || !dev || !cv) { if (!dev) failRef.current(); return }
      try {
        const mod = dev.createShaderModule({ code: wrapIcon(wgsl, hue) })
        const info = await mod.getCompilationInfo()
        if (info.messages.some(m => m.type === 'error')) throw new Error('compile')
        const pipeline = await dev.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module: mod, entryPoint: 'card_vs' },
          fragment: { module: mod, entryPoint: 'card_fs', targets: [{ format }] },
        })
        if (dead) return
        const w = Math.max(2, Math.floor(cv.clientWidth || 256)), h = Math.max(2, Math.floor(cv.clientHeight || 160))
        cv.width = w; cv.height = h
        const ctx = cv.getContext('webgpu') as GPUCanvasContext | null
        if (!ctx) throw new Error('no context')
        ctx.configure({ device: dev, format, alphaMode: 'opaque' })
        const ubuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
        const bind = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] })
        entry = { canvas: cv, ctx, pipeline, ubuf, bind, visible: true, t0: performance.now() }
        REG.add(entry)
        io = new IntersectionObserver(es => { if (entry) entry.visible = es[0]?.isIntersecting ?? true }, { rootMargin: '80px' })
        io.observe(cv)
        ensureLoop()
      } catch {
        if (!dead) failRef.current()   // broken shader → the PNG/placeholder chain
      }
    })()
    return () => { dead = true; io?.disconnect(); if (entry) REG.delete(entry) }
  }, [wgsl, hue])

  return <canvas ref={ref} className="absolute inset-0 w-full h-full" aria-hidden />
}
