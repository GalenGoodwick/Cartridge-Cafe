'use client'

import { useEffect, useRef, useState } from 'react'
import { buildPageFrameShader, PAGE_FRAME_VERTEX } from './frame-shader'

// One shared WebGPU device across every frame on the page.
let devicePromise: Promise<GPUDevice | null> | null = null
async function getSharedDevice(): Promise<GPUDevice | null> {
  if (typeof navigator === 'undefined' || !(navigator as unknown as { gpu?: unknown }).gpu) return null
  if (!devicePromise) {
    devicePromise = (async () => {
      try {
        const gpu = (navigator as unknown as { gpu: GPU }).gpu
        const adapter = await gpu.requestAdapter()
        if (!adapter) return null
        return await adapter.requestDevice()
      } catch {
        return null
      }
    })()
  }
  return devicePromise
}

type Props = {
  wgsl: string
  res?: number
  params?: [number, number, number, number]
  className?: string
  onCompile?: (error: string | null) => void
}

export default function ShaderFrame({ wgsl, res = 200, params = [0, 0, 0, 0], className, onCompile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    let alive = true
    let ctx: GPUCanvasContext | null = null
    let ubuf: GPUBuffer | null = null
    let ro: ResizeObserver | null = null
    let io: IntersectionObserver | null = null
    let visible = true
    const start = performance.now()

    ;(async () => {
      const device = await getSharedDevice()
      if (!alive) return
      if (!device) {
        setFatal('WebGPU not available in this browser')
        onCompile?.('WebGPU not available')
        return
      }

      ctx = canvas.getContext('webgpu') as GPUCanvasContext | null
      if (!ctx) {
        setFatal('Could not get a WebGPU canvas context')
        return
      }
      const format = (navigator as unknown as { gpu: GPU }).gpu.getPreferredCanvasFormat()
      ctx.configure({ device, format, alphaMode: 'opaque' })

      const sizeToBox = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
        const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
        if (canvas.width !== w) canvas.width = w
        if (canvas.height !== h) canvas.height = h
      }
      sizeToBox()
      ro = new ResizeObserver(sizeToBox)
      ro.observe(canvas)
      io = new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true })
      io.observe(canvas)

      // Compile the frame's fragment shader; keep the frame black on error.
      const vModule = device.createShaderModule({ code: PAGE_FRAME_VERTEX })
      const fModule = device.createShaderModule({ code: buildPageFrameShader(wgsl) })
      const info = await fModule.getCompilationInfo()
      const errors = info.messages.filter((m) => m.type === 'error')
      if (errors.length) {
        onCompile?.(errors.map((e) => e.message).join('\n'))
        return
      }
      onCompile?.(null)

      let pipeline: GPURenderPipeline
      try {
        pipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module: vModule, entryPoint: 'main' },
          fragment: { module: fModule, entryPoint: 'main', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        })
      } catch (e) {
        onCompile?.(e instanceof Error ? e.message : 'Pipeline error')
        return
      }

      ubuf = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: ubuf } }],
      })
      const uniforms = new Float32Array(8)

      const frame = () => {
        if (!alive || !ctx || !ubuf) return
        raf = requestAnimationFrame(frame)
        if (!visible) return
        const t = (performance.now() - start) / 1000
        uniforms[0] = canvas.width
        uniforms[1] = canvas.height
        uniforms[2] = t
        uniforms[3] = res
        uniforms[4] = params[0]
        uniforms[5] = params[1]
        uniforms[6] = params[2]
        uniforms[7] = params[3]
        device.queue.writeBuffer(ubuf, 0, uniforms)

        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: ctx.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(6)
        pass.end()
        device.queue.submit([encoder.finish()])
      }
      raf = requestAnimationFrame(frame)
    })()

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro?.disconnect()
      io?.disconnect()
      try { ubuf?.destroy() } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wgsl, res, params[0], params[1], params[2], params[3]])

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {fatal && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          background: '#0A0D13', color: '#7E93AC', fontSize: 12, textAlign: 'center', padding: 16,
          fontFamily: 'var(--font-mono, monospace)',
        }}>
          {fatal}
        </div>
      )}
    </div>
  )
}
