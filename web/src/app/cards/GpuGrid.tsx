'use client'

// cards-gpu-grid — the cards are DRAWN ON THE GRID (MAP.cards: cards-gpu-grid).
// ONE WebGPU device, ONE submit per frame, TWO surfaces:
//   · the VOID canvas below the DOM — ember layers, the warm radial (fullscreen)
//   · the ART canvas above the DOM — transparent, pointer-events-none, painting
//     ONLY each visible card's art rect (scissored viewport running that
//     world's composed icon shader; a breathing hue-field while it compiles or
//     when it can't). Text, borders, inputs stay DOM between the two surfaces.
// Baked-photo worlds keep a DOM <img> (static pixels). No WebGPU → onNoGpu →
// the DOM fallback tier. Supersedes 30 per-card canvases + the 2D mote canvas.

import { useEffect, useRef } from 'react'

export interface GpuArt { wgsl: string | null; hue: number | null }

/** Wrap a composed icon (engine visual_* fn + modules) into a rect-aware
 *  standalone shader — @builtin(position) is framebuffer-absolute, so uv
 *  derives from the per-draw rect uniform. */
function wrapIcon(wgsl: string, hue: number | null): string {
  const fns = [...wgsl.matchAll(/fn\s+(visual_\w+)\s*\(/g)].map(m => m[1])
  const entry = fns.includes('visual_icon') ? 'visual_icon' : fns[fns.length - 1]
  if (!entry) throw new Error('no visual fn')
  const uniStub = /\buni\s*\(/.test(wgsl) && !/fn\s+uni\s*\(/.test(wgsl)
    ? 'fn uni(i: i32) -> f32 { return 0.0; }\n' : ''
  const h = hue ?? 0.08
  const c = `vec4f(${(0.55 + 0.4 * Math.abs(Math.cos(h * 6.283))).toFixed(3)}, ${(0.45 + 0.3 * Math.abs(Math.sin(h * 6.283 + 1))).toFixed(3)}, ${(0.35 + 0.4 * Math.abs(Math.sin(h * 6.283))).toFixed(3)}, 1.0)`
  return `${uniStub}${wgsl}
struct QU { rect: vec4f, t: f32, pad0: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> qu: QU;
@vertex fn card_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn card_fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  var uv = ((fp.xy - qu.rect.xy) / qu.rect.zw) * 2.0 - 1.0;
  uv.x = uv.x * (qu.rect.z / qu.rect.w);
  let c = ${entry}(uv, 0.0, ${c}, qu.t, vec4f(0.0), vec4f(0.02, 0.015, 0.01, 1.0));
  return vec4f(c.rgb * c.a + vec3f(0.04, 0.025, 0.015) * (1.0 - c.a), 1.0);
}`
}

/** The hue-field placeholder, GPU edition — a world with no live shader still
 *  breathes on the grid instead of freezing into a gradient. */
const PLACEHOLDER_WGSL = `
struct QU { rect: vec4f, t: f32, hue: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> qu: QU;
fn ph_hsl(h: f32, s: f32, l: f32) -> vec3f {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let x = c * (1.0 - abs(((h * 6.0) % 2.0) - 1.0));
  let m = l - c * 0.5;
  var rgb = vec3f(c, x, 0.0);
  let seg = i32(h * 6.0) % 6;
  if (seg == 1) { rgb = vec3f(x, c, 0.0); } else if (seg == 2) { rgb = vec3f(0.0, c, x); }
  else if (seg == 3) { rgb = vec3f(0.0, x, c); } else if (seg == 4) { rgb = vec3f(x, 0.0, c); }
  else if (seg == 5) { rgb = vec3f(c, 0.0, x); }
  return rgb + m;
}
@vertex fn card_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn card_fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = ((fp.xy - qu.rect.xy) / qu.rect.zw) * 2.0 - 1.0;
  let d = length(uv * vec2f(1.1, 0.9) + vec2f(0.35, 0.35));
  let base = ph_hsl(qu.hue, 0.45, 0.16 + 0.06 * (1.0 - d));
  let pulse = 0.03 * sin(qu.t * 0.8 + uv.x * 2.0);
  let scan = select(1.0, 0.82, (i32(fp.y) % 3) == 0);
  return vec4f((base + vec3f(pulse)) * scan * (1.0 - 0.35 * d), 1.0);
}`

/** The void — ember layers drifting through depth + the warm radial. */
const VOID_WGSL = `
struct QU { rect: vec4f, t: f32, pad0: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> qu: QU;
fn v_hash2(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.547);
}
fn v_layer(uv: vec2f, scale: f32, speed: f32, t: f32) -> f32 {
  let p = uv * scale + vec2f(0.0, t * speed);
  let cell = floor(p);
  let r = v_hash2(cell);
  let d = distance(fract(p), vec2f(0.15) + 0.7 * r);
  let tw = 0.6 + 0.4 * sin(t * (1.0 + r.x * 2.0) + r.y * 6.283);
  return smoothstep(0.10, 0.0, d) * tw;
}
@vertex fn card_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn card_fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fp.xy / qu.rect.zw;
  var c = vec3f(0.031, 0.022, 0.016);
  c += vec3f(1.0, 0.55, 0.25) * v_layer(uv, 22.0, 0.010, qu.t) * 0.10;
  c += vec3f(1.0, 0.62, 0.30) * v_layer(uv + 7.3, 12.0, 0.022, qu.t) * 0.16;
  c += vec3f(1.0, 0.70, 0.38) * v_layer(uv + 3.1, 6.0, 0.045, qu.t) * 0.22;
  let warm = exp(-distance(uv, vec2f(0.7, -0.05)) * 1.8) * 0.05;
  return vec4f(c + vec3f(warm, warm * 0.6, warm * 0.3), 1.0);
}`

type Entry = { pipeline: GPURenderPipeline; ubuf: GPUBuffer; bind: GPUBindGroup }

export function GpuGrid({ arts, onNoGpu, onArtFail }: {
  arts: Map<string, GpuArt>     // slug → its live shader (null → GPU placeholder)
  onNoGpu: () => void
  onArtFail?: (slug: string) => void   // compile failed → the DOM may prefer its baked PNG
}) {
  const voidRef = useRef<HTMLCanvasElement | null>(null)
  const artRef = useRef<HTMLCanvasElement | null>(null)
  const artsRef = useRef(arts); artsRef.current = arts
  const noGpuRef = useRef(onNoGpu); noGpuRef.current = onNoGpu
  const artFailRef = useRef(onArtFail); artFailRef.current = onArtFail

  useEffect(() => {
    const vc = voidRef.current, ac = artRef.current
    if (!vc || !ac) return
    let dead = false, raf = 0, unresize: (() => void) | null = null
    ;(async () => {
      const gpu = (navigator as { gpu?: GPU }).gpu
      const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
      const device = adapter ? await adapter.requestDevice().catch(() => null) : null
      if (!gpu || !device || dead) { if (!device) noGpuRef.current(); return }
      const format = gpu.getPreferredCanvasFormat()
      const vctx = vc.getContext('webgpu') as GPUCanvasContext | null
      const actx = ac.getContext('webgpu') as GPUCanvasContext | null
      if (!vctx || !actx) { noGpuRef.current(); return }
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const size = () => {
        const w = Math.max(2, Math.floor(window.innerWidth * dpr)), h = Math.max(2, Math.floor(window.innerHeight * dpr))
        vc.width = w; vc.height = h; ac.width = w; ac.height = h
      }
      size()
      window.addEventListener('resize', size)
      unresize = () => window.removeEventListener('resize', size)
      vctx.configure({ device, format, alphaMode: 'opaque' })
      actx.configure({ device, format, alphaMode: 'premultiplied' })   // transparent overlay

      const mkEntry = async (code: string): Promise<Entry | null> => {
        try {
          const mod = device.createShaderModule({ code })
          if ((await mod.getCompilationInfo()).messages.some(m => m.type === 'error')) return null
          const pipeline = await device.createRenderPipelineAsync({
            layout: 'auto',
            vertex: { module: mod, entryPoint: 'card_vs' },
            fragment: { module: mod, entryPoint: 'card_fs', targets: [{ format }] },
          })
          const ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
          const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] })
          return { pipeline, ubuf, bind }
        } catch { return null }
      }

      const voidE = await mkEntry(VOID_WGSL)
      const placeE = await mkEntry(PLACEHOLDER_WGSL)
      if (!voidE || !placeE || dead) { if (!voidE || !placeE) noGpuRef.current(); return }
      const live = new Map<string, Entry | 'failed' | 'building'>()
      const placeBufs: Entry[] = []

      const t0 = performance.now()
      let last = 0
      const frame = (now: number) => {
        if (dead) return
        raf = requestAnimationFrame(frame)
        if (now - last < 33) return                          // ~30fps
        last = now
        const t = (now - t0) / 1000
        const W = vc.width, H = vc.height
        const enc = device.createCommandEncoder()

        // pass 1 · the VOID (below the DOM), fullscreen
        {
          const pass = enc.beginRenderPass({
            colorAttachments: [{ view: vctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.031, g: 0.022, b: 0.016, a: 1 } }],
          })
          device.queue.writeBuffer(voidE.ubuf, 0, new Float32Array([0, 0, W, H, t, 0, 0, 0]))
          pass.setPipeline(voidE.pipeline); pass.setBindGroup(0, voidE.bind); pass.draw(3)
          pass.end()
        }

        // pass 2 · the ART overlay (above the DOM): clear transparent, then
        // paint ONLY each visible card's art rect
        {
          const pass = enc.beginRenderPass({
            colorAttachments: [{ view: actx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
          })
          let placeN = 0
          document.querySelectorAll<HTMLElement>('[data-artslot]').forEach(el => {
            const b = el.getBoundingClientRect()
            if (b.bottom < -40 || b.top > window.innerHeight + 40 || b.width < 4) return
            const x = Math.max(0, Math.floor(b.left * dpr)), y = Math.max(0, Math.floor(b.top * dpr))
            const w = Math.min(W - x, Math.ceil(b.width * dpr)), h = Math.min(H - y, Math.ceil(b.height * dpr))
            if (w < 4 || h < 4) return
            const slug = el.dataset.artslot || ''
            const art = artsRef.current.get(slug)
            let e: Entry | null = null
            if (art?.wgsl) {
              const cur = live.get(slug)
              if (cur === undefined) {
                live.set(slug, 'building')
                mkEntry(wrapIcon(art.wgsl, art.hue)).then(built => {
                  if (dead) return
                  live.set(slug, built ?? 'failed')
                  if (!built) artFailRef.current?.(slug)
                })
              } else if (cur !== 'failed' && cur !== 'building') e = cur
            }
            if (e) {
              device.queue.writeBuffer(e.ubuf, 0, new Float32Array([x, y, w, h, t, 0, 0, 0]))
            } else {
              // building / failed / no shader → the breathing hue field
              if (!placeBufs[placeN]) {
                const ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
                placeBufs[placeN] = { pipeline: placeE.pipeline, ubuf, bind: device.createBindGroup({ layout: placeE.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] }) }
              }
              e = placeBufs[placeN++]
              device.queue.writeBuffer(e.ubuf, 0, new Float32Array([x, y, w, h, t, Number(el.dataset.hue ?? 0.08), 0, 0]))
            }
            pass.setViewport(x, y, w, h, 0, 1)
            pass.setScissorRect(x, y, w, h)
            pass.setPipeline(e.pipeline); pass.setBindGroup(0, e.bind); pass.draw(3)
          })
          pass.end()
        }
        device.queue.submit([enc.finish()])
      }
      raf = requestAnimationFrame(frame)
    })()
    return () => { dead = true; cancelAnimationFrame(raf); unresize?.() }
  }, [])

  return (
    <>
      <canvas ref={voidRef} className="fixed inset-0 z-0" aria-hidden />
      <canvas ref={artRef} className="fixed inset-0 z-20 pointer-events-none" aria-hidden />
    </>
  )
}
