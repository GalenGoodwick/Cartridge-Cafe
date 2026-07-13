// Field Engine v4 — WebGPU Renderer (Multi-pass, multi-effect)

import { DEFAULT_GRID_SIZE } from './types'
import {
  vertexShaderSource,
  buildBaseFragmentShader,
  buildEffectFragmentShader,
  buildEffectComputeShader,
  buildAccumClearComputeShader,
  buildBlitFragmentShader,
  buildMaskClearShader,
  buildStateUpdateComputeShader,
  buildCompositeStateComputeShader,
  buildSuperimposedComputeShader,
  buildSuperimposed3DComputeShader,
  buildPropagationComputeShader,
  buildPostProcessComputeShader,
  buildParticleUpdateComputeShader,
  buildParticleRenderComputeShader,
  buildStepHookComputeShader,
  PARTICLE_STRIDE,
  MAX_PARTICLES,
  VisualTypeEntry,
  InteractionEntry,
  PropagationEntry,
  ModuleEntry,
} from './shaders'
import type { SuperFieldGPU } from './types'

type BlendMode = 'alpha' | 'additive' | 'multiply' | 'screen' | 'softlight' | 'opaque'

/** Shared compiled pipeline — deduplicated by WGSL source hash + blend mode */
interface SharedPipeline {
  pipeline: GPURenderPipeline
  /** rgba32float-target variant — REQUIRED for the presence-map pass (the
   *  presence texture is float; a canvas-format pipeline is incompatible) */
  presencePipeline?: GPURenderPipeline
  refCount: number
}

/** Per-effect feedback ping-pong texture pair */
interface FeedbackBuffer {
  texA: GPUTexture
  texB: GPUTexture
  currentIndex: 0 | 1
}

/** Lightweight entry mapping a programKey to its shared pipeline hash */
interface FieldPipelineEntry {
  wgslHash: string
}

/** Effect data passed to render() for each effect pass */
export interface FieldEffectData {
  fieldId: string
  programKey: string
  bounds: [number, number, number, number]
  transform: [number, number, number, number]
  params: [number, number, number, number]
  blend: BlendMode
  fieldAColor?: [number, number, number, number]
  fieldBColor?: [number, number, number, number]
  fieldATransform?: [number, number, number, number]
  fieldBTransform?: [number, number, number, number]
  precedence?: boolean
  feedback?: boolean
}

/** Blend state descriptors keyed by blend mode */
function blendState(mode: BlendMode): GPUBlendState {
  switch (mode) {
    case 'alpha':
      return { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }
    case 'additive':
      return { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } }
    case 'multiply':
      return { color: { srcFactor: 'dst', dstFactor: 'zero', operation: 'add' }, alpha: { srcFactor: 'dst-alpha', dstFactor: 'zero', operation: 'add' } }
    case 'screen':
      return { color: { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }
    case 'softlight':
      return { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }
    case 'opaque':
      return { color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' } }
  }
}

export class FieldRenderer {
  device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private canvasFormat: GPUTextureFormat = 'bgra8unorm'
  private gridSize: number
  private hasFloat32Filterable: boolean = false

  // Base pipeline
  private basePipeline: GPURenderPipeline | null = null
  private vertexModule: GPUShaderModule | null = null

  // Shared pipelines: hash(wgsl+blend) → pipeline
  private sharedPipelines: Map<string, SharedPipeline> = new Map()
  /** Textures retired from the maps but possibly referenced by in-flight
   *  command buffers (async presence readbacks span frames). They are
   *  destroyed a few frames later — never at the moment of removal. */
  private retiredTextures: Array<{ tex: GPUTexture; frame: number }> = []
  private frameCounter = 0
  private retireTexture(tex: GPUTexture): void {
    this.retiredTextures.push({ tex, frame: this.frameCounter })
  }
  private reapRetiredTextures(): void {
    this.frameCounter++
    if (this.retiredTextures.length === 0) return
    const keep: Array<{ tex: GPUTexture; frame: number }> = []
    for (const r of this.retiredTextures) {
      if (this.frameCounter - r.frame > 6) { try { r.tex.destroy() } catch { /* already gone */ } }
      else keep.push(r)
    }
    this.retiredTextures = keep
  }
  private fieldEntries: Map<string, FieldPipelineEntry> = new Map()

  // Textures
  private colorTex: GPUTexture | null = null
  private stateTex: GPUTexture | null = null
  private stateTex2: GPUTexture | null = null
  private selectionTex: GPUTexture | null = null
  private effectTex: GPUTexture | null = null
  private fieldMaskTextures: Map<string, GPUTexture> = new Map()
  private sampler: GPUSampler | null = null

  // Presence map (async readback — per-field rendering)
  private presenceTex: GPUTexture | null = null
  private presenceStagingBuf: GPUBuffer | null = null
  private presenceStagingBufCapacity: number = 0
  private presenceReadPending: boolean = false
  private presenceLastResult: Map<string, Uint8Array> = new Map()

  // State update compute
  private stateUpdatePipeline: GPUComputePipeline | null = null
  private stateUpdateActive: boolean = false
  private stateTexCurrent: 0 | 1 = 0

  // Mask clear pipeline
  private maskClearPipeline: GPURenderPipeline | null = null

  // Frame uniform buffer
  private frameUniformBuf: GPUBuffer | null = null
  private effectUniformBuf: GPUBuffer | null = null
  private stateUniformBuf: GPUBuffer | null = null
  // World uniforms — the shared "whiteboard" hooks write and all shaders read
  private worldUniBuffer: GPUBuffer | null = null
  private _worldUniData = new Float32Array(64)
  private _worldUniDirty = true

  // Icon atlas — packed RGBA8 screenshots (64x64/slot) the cafe door samples
  // into its bubbles. Always allocated (min 1 u32) so the super layout is
  // satisfied for every world, even those that never sample it.
  private iconBuffer: GPUBuffer | null = null
  private iconBufferCapacity = 0

  // Pre-allocated typed arrays (reused every frame to avoid GC pressure)
  private _frameUniformData = new Float32Array(16)
  private _stateUniformData = new Float32Array(4)
  private _effectUniformData = new Float32Array(28) // 4+4+4+4+4+4+4 = 28 floats
  private _dispatchUniformData = new Float32Array(4)
  private _expandedMaskBuf: Float32Array | null = null // reused for mask/selection uploads

  // Bind group layouts
  private frameBindGroupLayout: GPUBindGroupLayout | null = null
  private baseTextureBindGroupLayout: GPUBindGroupLayout | null = null
  private effectTextureBindGroupLayout: GPUBindGroupLayout | null = null
  private effectUniformBindGroupLayout: GPUBindGroupLayout | null = null
  private maskClearTextureBindGroupLayout: GPUBindGroupLayout | null = null
  private computeBindGroupLayout0: GPUBindGroupLayout | null = null
  private computeBindGroupLayout1: GPUBindGroupLayout | null = null

  // Feedback buffers
  private feedbackBuffers: Map<string, FeedbackBuffer> = new Map()
  private static readonly MAX_FEEDBACK_BUFFERS = 32
  private static readonly FEEDBACK_SIZE = 256
  static readonly MAX_FIELD_EFFECTS = 128

  /** Render resolution scale (0.25–2.0). Lower = fewer pixels = faster. Default 1.0. */
  renderScale: number = 1.0

  // ─── Compute effect pipeline ───
  /** Whether compute effects are available and enabled */
  useComputeEffects: boolean = true
  private accumBuf: GPUBuffer | null = null
  /** Post-process output — bloom must read raw HDR neighbors while writing
   *  tonemapped pixels; same-buffer read/write raced per 16x16 workgroup
   *  (the dark-square artifact on bright regions) */
  private postOutBuf: GPUBuffer | null = null
  private prevAccumBuf: GPUBuffer | null = null
  private accumBufPixelCount: number = 0
  private accumBufStride: number = 0
  private clearComputePipeline: GPUComputePipeline | null = null
  private blitPipeline: GPURenderPipeline | null = null
  private dispatchUniformBuf: GPUBuffer | null = null
  private computeDispatchLayout: GPUBindGroupLayout | null = null
  private clearComputeLayout: GPUBindGroupLayout | null = null
  private blitStorageLayout: GPUBindGroupLayout | null = null
  private sharedComputePipelines: Map<string, { pipeline: GPUComputePipeline; refCount: number }> = new Map()
  private fieldComputeEntries: Map<string, { wgslHash: string }> = new Map()

  // Staging buffers for per-effect uniforms (fixes writeBuffer ordering)
  private effectUniformStagingBuf: GPUBuffer | null = null
  private dispatchStagingBuf: GPUBuffer | null = null
  private static readonly EFFECT_UNIFORM_SIZE = 112 // 28 floats
  private static readonly DISPATCH_UNIFORM_SIZE = 16 // 4 floats

  // ─── Superimposed rendering ───
  private superFieldBuffer: GPUBuffer | null = null
  private superFieldBufferCapacity: number = 0
  private _superFieldDataCache: Float32Array<ArrayBuffer> | null = null
  private _ixDataCache: Uint32Array<ArrayBuffer> | null = null
  private superPipeline: GPUComputePipeline | null = null
  private super3DPipeline: GPUComputePipeline | null = null
  private superBindGroupLayout: GPUBindGroupLayout | null = null
  private superPipelineReady: boolean = false
  private super3DPipelineReady: boolean = false
  private superCompilationId: number = 0  // Bumped only by registerVisualType/registerInteraction
  private superCompiling: boolean = false  // Prevents re-entrant compilation
  private super3DCompiling: boolean = false
  private superCompilationError: string | null = null  // Last uber-shader compile error
  static readonly SUPER_FIELD_STRIDE = 96 // 6 vec4f = 24 floats = 96 bytes per field
  static readonly SUPER_MAX_FIELDS = 128

  // ─── Interaction propagation ───
  private ixBuf: GPUBuffer | null = null
  private ixBufPixelCount: number = 0
  private propagationPipeline: GPUComputePipeline | null = null
  private propagationBindGroupLayout: GPUBindGroupLayout | null = null
  private superLayoutHasIxBuf: boolean = false

  // ─── Pixel-perfect hit testing ───
  private hitIdBuffer: GPUBuffer | null = null
  private hitIdStagingBuffer: GPUBuffer | null = null
  private hitIdPixelCount: number = 0
  private hitIdReadbackPending: boolean = false
  /** Latest readback: per-pixel field index (0xFFFFFFFF = no field) */
  hitMap: Uint32Array | null = null
  hitMapWidth: number = 0
  hitMapHeight: number = 0

  // ─── Post-processing ───
  private postProcessPipeline: GPUComputePipeline | null = null
  private postProcessBindGroupLayout: GPUBindGroupLayout | null = null
  private postProcessUniformBuf: GPUBuffer | null = null
  private postProcessUniformBindGroupLayout: GPUBindGroupLayout | null = null
  private _cachedPostProcessBG: GPUBindGroup | null = null
  private _postProcessUniformData = new Float32Array(12) // matches PostProcessUniforms struct with padding
  /** Post-processing settings — set via setPostProcess() */
  postProcessSettings = {
    enabled: true,
    bloomIntensity: 0.3,
    bloomThreshold: 0.8,
    vignetteStrength: 0.3,
    vignetteRadius: 0.8,
    exposure: 1.0,
    lightDir: [0.5, 0.7] as [number, number],
    lightIntensity: 0.0,
  }

  // ─── GPU Particle System ───
  private particleBuffer: GPUBuffer | null = null
  private particleUpdatePipeline: GPUComputePipeline | null = null
  private particleRenderPipeline: GPUComputePipeline | null = null
  private particleUpdateBindGroupLayout: GPUBindGroupLayout | null = null
  private particleRenderBindGroupLayout: GPUBindGroupLayout | null = null
  private _particleData: Float32Array<ArrayBuffer> = new Float32Array(MAX_PARTICLES * (PARTICLE_STRIDE / 4))
  private _particleNextSlot: number = 0
  private _particleDirty: boolean = false
  private _particleCount: number = 0

  // ─── GPU Step Hooks ───
  private stepStateBuffer: GPUBuffer | null = null
  private stepStateStagingBuffer: GPUBuffer | null = null
  private stepStateCapacity: number = 0
  private stepUniformBuffer: GPUBuffer | null = null
  private stepHookPipeline: GPUComputePipeline | null = null
  private stepHookBindGroupLayout: GPUBindGroupLayout | null = null
  private stepStateReadbackPending: boolean = false
  private superFieldStagingBuffer: GPUBuffer | null = null
  private superFieldReadbackPending: boolean = false
  private _stepHookCompilationId: number = 0
  private _stepHookLastCompiledId: number = -1
  private _stepHookCompiling: boolean = false
  static readonly STEP_STATE_STRIDE = 64 // 4 vec4f = 16 floats = 64 bytes per field

  // Visual type registry (dynamic visual types)
  private visualTypeRegistry: Map<string, VisualTypeEntry> = new Map()
  private nextVisualTypeId: number = 0  // All visual types are runtime-defined

  // Shader module registry (reusable WGSL utility functions)
  private moduleRegistry: Map<string, ModuleEntry> = new Map()

  // Render target registry (named intermediate buffers for RTT)
  private renderTargets: Map<string, { buffer: GPUBuffer; id: number }> = new Map()
  private nextRenderTargetId: number = 0
  static readonly MAX_RENDER_TARGETS = 6
  private renderTargetBindGroupLayout: GPUBindGroupLayout | null = null
  private _cachedRenderTargetBG: GPUBindGroup | null = null
  private _renderTargetPixelCount: number = 0

  // Interaction registry (a + b = c effects at overlap pixels)
  private interactionRegistry: Map<string, InteractionEntry> = new Map()
  private nextInteractionId: number = 0
  private interactionBuffer: GPUBuffer | null = null
  private interactionBufferCapacity: number = 0
  static readonly INTERACTION_STRIDE = 16 // 4 u32 per interaction
  private _ixLogDone = false
  private _propLogDone = false

  // Propagation type registry (how interaction effects spread)
  private propagationRegistry: Map<string, PropagationEntry> = new Map()
  private nextPropagationId: number = 0
  private propagationCompilationId: number = 0
  private ixTypeBuf: GPUBuffer | null = null
  private ixTypeBufPixelCount: number = 0

  // ─── Cached per-frame bind groups (avoid GPU allocations in hot path) ───
  private _cachedClearBG: GPUBindGroup | null = null
  private _cachedDispatchBG: GPUBindGroup | null = null
  private _cachedPropBG: GPUBindGroup | null = null
  private _cachedBlitBG: GPUBindGroup | null = null
  private _cachedSuperBG: GPUBindGroup | null = null
  private _lastSuperFieldCount: number = -1
  private _lastInteractionCount: number = -1

  constructor(gridSize: number = DEFAULT_GRID_SIZE) {
    this.gridSize = gridSize
  }

  setRenderScale(scale: number): void {
    this.renderScale = Math.max(0.25, Math.min(2.0, scale))
  }

  /** Compute-buffer pixel budget. Full-canvas raymarched worlds die by retina
   * dpr (a 1512×982 window at dpr 2 is ~5.9M pixels per stacked visual);
   * upscaling from ~2.2M pixels is invisible at play distance while the
   * compute cost drops 2-3×. */
  maxBufferPixels: number = 2_200_000

  /** dpr × renderScale, capped so bufferW × bufferH stays under the budget. */
  effectiveDpr(displayW: number, displayH: number): number {
    const dpr = (window.devicePixelRatio || 1) * this.renderScale
    const px = displayW * displayH * dpr * dpr
    return px > this.maxBufferPixels ? dpr * Math.sqrt(this.maxBufferPixels / px) : dpr
  }

  /** Update post-processing settings. Partial updates supported. */
  setPostProcess(settings: Partial<typeof FieldRenderer.prototype.postProcessSettings>): void {
    Object.assign(this.postProcessSettings, settings)
    this._cachedPostProcessBG = null
  }

  /** Emit particles at a position in grid space.
   *  @param x Grid X position
   *  @param y Grid Y position
   *  @param count Number of particles to emit
   *  @param options Optional overrides for color, velocity, size, lifetime */
  emitParticles(x: number, y: number, count: number, options?: {
    color?: [number, number, number]
    velX?: number
    velY?: number
    spread?: number
    size?: number
    life?: number
  }): void {
    const opts = options || {}
    const color = opts.color || [1, 0.8, 0.3]
    const baseVelX = opts.velX ?? 0
    const baseVelY = opts.velY ?? 30
    const spread = opts.spread ?? 15
    const size = opts.size ?? 2
    const life = opts.life ?? 1.5
    const floatsPerParticle = PARTICLE_STRIDE / 4 // 12

    for (let i = 0; i < count; i++) {
      const slot = this._particleNextSlot % MAX_PARTICLES
      const offset = slot * floatsPerParticle
      // Random spread
      const angle = Math.random() * Math.PI * 2
      const speed = Math.random() * spread
      this._particleData[offset + 0] = x + (Math.random() - 0.5) * size  // posX
      this._particleData[offset + 1] = y + (Math.random() - 0.5) * size  // posY
      this._particleData[offset + 2] = baseVelX + Math.cos(angle) * speed // velX
      this._particleData[offset + 3] = baseVelY + Math.sin(angle) * speed // velY
      this._particleData[offset + 4] = color[0]  // R
      this._particleData[offset + 5] = color[1]  // G
      this._particleData[offset + 6] = color[2]  // B
      this._particleData[offset + 7] = 1.0       // A
      this._particleData[offset + 8] = life * (0.5 + Math.random() * 0.5)  // life
      this._particleData[offset + 9] = life      // maxLife
      this._particleData[offset + 10] = size * (0.5 + Math.random() * 0.5) // size
      this._particleData[offset + 11] = 1.0      // flags (alive)
      this._particleNextSlot++
      this._particleCount = Math.min(this._particleCount + 1, MAX_PARTICLES)
    }
    this._particleDirty = true
  }

  /** Dispatch particle update and render compute passes */
  private dispatchParticles(encoder: GPUCommandEncoder, device: GPUDevice, bufferW: number, bufferH: number): void {
    if (!this.particleBuffer || !this.particleUpdatePipeline || !this.particleRenderPipeline || this._particleCount === 0) return
    if (!this.accumBuf) return

    // Upload new particle data if dirty
    if (this._particleDirty) {
      device.queue.writeBuffer(this.particleBuffer, 0, this._particleData)
      this._particleDirty = false
    }

    const frameBG = this.getFrameBindGroup()

    // Update pass — advance particle physics
    {
      const updateBG = device.createBindGroup({
        layout: this.particleUpdateBindGroupLayout!,
        entries: [{ binding: 0, resource: { buffer: this.particleBuffer } }],
      })
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.particleUpdatePipeline)
      pass.setBindGroup(0, frameBG)
      pass.setBindGroup(1, updateBG)
      pass.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 256))
      pass.end()
    }

    // Render pass — draw particles into accumBuf
    {
      const renderBG = device.createBindGroup({
        layout: this.particleRenderBindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.particleBuffer } },
          { binding: 1, resource: { buffer: this.accumBuf } },
        ],
      })
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.particleRenderPipeline)
      pass.setBindGroup(0, frameBG)
      pass.setBindGroup(1, renderBG)
      pass.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 256))
      pass.end()
    }
  }

  /** Convert grid-space bounds to pixel-perfect screen-space scissor rect [x, y, w, h].
   *  Grid→UV→pixel: X is direct, Y is flipped (UV y=0 at screen bottom, pixel y=0 at screen top). */
  private gridBoundsToScissor(
    bounds: [number, number, number, number],
    camera: { x: number; y: number },
    zoom: number,
    bufferW: number,
    bufferH: number,
  ): [number, number, number, number] {
    const aspect = bufferW / bufferH
    const gridRange = this.gridSize / zoom
    const [gMinX, gMinY, gMaxX, gMaxY] = bounds

    // Formula: pixelCoord = ((gridCoord - camera) / visibleRange + 0.5) * bufferSize
    // This works for both X and Y because the UV→pixel Y flip cancels the grid→UV Y flip.
    let sMinX: number, sMinY: number, sMaxX: number, sMaxY: number
    if (aspect > 1) {
      const rangeX = gridRange * aspect
      sMinX = ((gMinX - camera.x) / rangeX + 0.5) * bufferW
      sMaxX = ((gMaxX - camera.x) / rangeX + 0.5) * bufferW
      sMinY = ((gMinY - camera.y) / gridRange + 0.5) * bufferH
      sMaxY = ((gMaxY - camera.y) / gridRange + 0.5) * bufferH
    } else {
      const rangeY = gridRange / aspect
      sMinX = ((gMinX - camera.x) / gridRange + 0.5) * bufferW
      sMaxX = ((gMaxX - camera.x) / gridRange + 0.5) * bufferW
      sMinY = ((gMinY - camera.y) / rangeY + 0.5) * bufferH
      sMaxY = ((gMaxY - camera.y) / rangeY + 0.5) * bufferH
    }

    const x = Math.max(0, Math.floor(sMinX))
    const y = Math.max(0, Math.floor(sMinY))
    const w = Math.min(bufferW, Math.ceil(sMaxX)) - x
    const h = Math.min(bufferH, Math.ceil(sMaxY)) - y
    return [x, y, Math.max(1, w), Math.max(1, h)]
  }

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    if (!navigator.gpu) {
      console.error('WebGPU not supported')
      return false
    }

    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      console.error('No WebGPU adapter found')
      return false
    }

    this.hasFloat32Filterable = adapter.features.has('float32-filterable')
    const features: GPUFeatureName[] = []
    if (this.hasFloat32Filterable) {
      features.push('float32-filterable')
    }
    // the uber-shader binds up to 9 storage buffers per stage; WebGPU's
    // DEFAULT limit is 8 — ask for what the adapter actually supports
    const wantStorage = Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 12)
    const device = await adapter.requestDevice({
      requiredFeatures: features,
      requiredLimits: wantStorage > 8 ? { maxStorageBuffersPerShaderStage: wantStorage } : undefined,
    })
    this.device = device

    // ── fault surface: a dead GPU must SAY SO. Device loss and uncaptured
    // errors dispatch 'cc:fault' — FieldEngine shows them to the player. ──
    device.lost.then(info => {
      console.error('[GPU] device lost:', info.reason, info.message)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cc:fault', {
          detail: { kind: 'gpu-lost', message: `GPU device lost (${info.reason}): ${info.message || 'no detail'}` },
        }))
      }
    }).catch(() => { /* never rejects in practice */ })
    let uncapCount = 0
    device.onuncapturederror = (e: GPUUncapturedErrorEvent) => {
      uncapCount++
      if (uncapCount > 3) return   // first faults tell the story; don't spam
      console.error('[GPU] uncaptured error:', e.error.message)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cc:fault', {
          detail: { kind: 'gpu-error', message: e.error.message.slice(0, 400) },
        }))
      }
    }

    const ctx = canvas.getContext('webgpu')
    if (!ctx) {
      console.error('Failed to get webgpu context')
      return false
    }
    this.context = ctx
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat()

    ctx.configure({
      device,
      format: this.canvasFormat,
      alphaMode: 'opaque',
    })

    // Create bind group layouts
    this.createBindGroupLayouts()

    // Create shared resources
    this.sampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })

    this.frameUniformBuf = device.createBuffer({
      size: 64, // 16 floats: camera(2) + resolution(2) + zoom(1) + time(1) + gridSize(1) + renderMode(1) + cam3Dpos(3) + cam3Dfov(1) + cam3Ddir(2) + pad(2)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // The whiteboard: 64 floats written from worldData.gpuUniforms each frame,
    // visible to every visual/interaction shader as uni(i) / uni4(i)
    this.worldUniBuffer = device.createBuffer({
      size: 256, // 16 vec4f
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    this.effectUniformBuf = device.createBuffer({
      size: 112, // 28 floats: bounds(4) + params(4) + transform(4) + fieldAColor(4) + fieldBColor(4) + fieldATransform(4) + fieldBTransform(4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.stateUniformBuf = device.createBuffer({
      size: 16, // 4 floats: gridSize, time, dt, pad
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Compile vertex module (shared across all render pipelines)
    this.vertexModule = device.createShaderModule({ code: vertexShaderSource })

    // Create textures
    this.colorTex = this.createDataTexture('colorTex')
    this.stateTex = this.createDataTexture('stateTex')
    this.stateTex2 = this.createDataTexture('stateTex2')
    this.selectionTex = this.createDataTexture('selectionTex')
    this.effectTex = this.createDataTexture('effectTex')
    this.presenceTex = this.createDataTexture('presenceTex')

    // Presence staging buffer — created dynamically in schedulePresenceReadback
    // sized to numFields * bytesPerRow * gridSize for per-field rendering

    // Build base pipeline
    const baseFragModule = device.createShaderModule({ code: buildBaseFragmentShader() })
    this.basePipeline = await this.createRenderPipeline(baseFragModule, this.baseTextureBindGroupLayout!, undefined)

    // Build mask clear pipeline
    const maskClearFragModule = device.createShaderModule({ code: buildMaskClearShader() })
    this.maskClearPipeline = await this.createMaskClearPipeline(maskClearFragModule)

    // ─── Staging buffers for per-effect uniforms ───
    // Each effect needs its own uniform slice; we write all to staging, then copyBufferToBuffer per pass.
    this.effectUniformStagingBuf = device.createBuffer({
      size: FieldRenderer.EFFECT_UNIFORM_SIZE * FieldRenderer.MAX_FIELD_EFFECTS,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    this.dispatchStagingBuf = device.createBuffer({
      size: FieldRenderer.DISPATCH_UNIFORM_SIZE * FieldRenderer.MAX_FIELD_EFFECTS,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })

    // ─── Compute effect pipeline resources ───
    this.dispatchUniformBuf = device.createBuffer({
      size: 16, // 4 floats: offsetX, offsetY, sizeX, sizeY
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Clear compute pipeline
    {
      const clearModule = device.createShaderModule({ code: buildAccumClearComputeShader() })
      this.clearComputePipeline = await device.createComputePipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.clearComputeLayout!] }),
        compute: { module: clearModule, entryPoint: 'main' },
      })
    }

    // Propagation compute pipeline (spreads interaction results beyond overlap zone)
    {
      const propModule = device.createShaderModule({ code: buildPropagationComputeShader() })
      this.propagationPipeline = await device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.frameBindGroupLayout!, this.propagationBindGroupLayout!],
        }),
        compute: { module: propModule, entryPoint: 'main' },
      })
    }

    // Post-processing compute pipeline (bloom, tone mapping, vignette)
    {
      this.postProcessUniformBuf = device.createBuffer({
        size: 48, // 12 floats matching PostProcessUniforms struct
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      const ppModule = device.createShaderModule({ code: buildPostProcessComputeShader() })
      this.postProcessPipeline = await device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.postProcessUniformBindGroupLayout!, this.postProcessBindGroupLayout!],
        }),
        compute: { module: ppModule, entryPoint: 'main' },
      })
    }

    // GPU Particle system pipelines
    {
      this.particleBuffer = device.createBuffer({
        size: MAX_PARTICLES * PARTICLE_STRIDE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })

      const updateModule = device.createShaderModule({ code: buildParticleUpdateComputeShader() })
      this.particleUpdatePipeline = await device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.frameBindGroupLayout!, this.particleUpdateBindGroupLayout!],
        }),
        compute: { module: updateModule, entryPoint: 'main' },
      })

      const renderModule = device.createShaderModule({ code: buildParticleRenderComputeShader() })
      this.particleRenderPipeline = await device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.frameBindGroupLayout!, this.particleRenderBindGroupLayout!],
        }),
        compute: { module: renderModule, entryPoint: 'main' },
      })
    }

    // Blit pipeline (reads from storage buffer, alpha-blends onto screen)
    {
      const blitModule = device.createShaderModule({ code: buildBlitFragmentShader() })
      const blitLayout = device.createPipelineLayout({
        bindGroupLayouts: [this.frameBindGroupLayout!, this.blitStorageLayout!],
      })
      this.blitPipeline = await device.createRenderPipelineAsync({
        layout: blitLayout,
        vertex: { module: this.vertexModule!, entryPoint: 'main' },
        fragment: {
          module: blitModule,
          entryPoint: 'main',
          targets: [{
            format: this.canvasFormat,
            blend: blendState('alpha'),
          }],
        },
        primitive: { topology: 'triangle-list' },
      })
    }

    if (!this.hasFloat32Filterable) {
      console.warn('WebGPU: float32-filterable not available — textureSample on float textures may fail. Consider using a GPU that supports this feature.')
    }
    console.log('WebGPU renderer initialized (compute effects: enabled)')
    return true
  }

  /** Ensure the accumulation buffer matches the current canvas pixel dimensions */
  private ensureAccumBuf(width: number, height: number): void {
    const device = this.device!
    const pixelCount = width * height
    if (this.accumBuf && this.accumBufPixelCount === pixelCount && this.accumBufStride === width) return

    this.accumBuf?.destroy()
    this.prevAccumBuf?.destroy()
    const bufSize = pixelCount * 16 // vec4f = 16 bytes per pixel
    this.accumBuf = device.createBuffer({
      size: bufSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    this.prevAccumBuf = device.createBuffer({
      size: bufSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    this.postOutBuf?.destroy()
    this.postOutBuf = device.createBuffer({
      size: bufSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.accumBufPixelCount = pixelCount
    this.accumBufStride = width
    this.invalidateBindGroupCaches()
  }

  /** Swap accumBuf and prevAccumBuf so the previous frame's result is readable */
  private swapAccumBufs(): void {
    const tmp = this.accumBuf
    this.accumBuf = this.prevAccumBuf
    this.prevAccumBuf = tmp
    // Bind groups reference specific buffers, must be invalidated on swap
    this._cachedClearBG = null
    this._cachedDispatchBG = null
    this._cachedPropBG = null
    this._cachedBlitBG = null
    this._cachedSuperBG = null
  }

  /** Ensure the interaction result buffer matches the current canvas pixel dimensions */
  private ensureIxBuf(width: number, height: number): void {
    const device = this.device!
    const pixelCount = width * height
    if (this.ixBuf && this.ixBufPixelCount === pixelCount) return

    this.ixBuf?.destroy()
    this.ixBuf = device.createBuffer({
      size: pixelCount * 16, // vec4f = 16 bytes per pixel
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.ixBufPixelCount = pixelCount
    this.invalidateBindGroupCaches()
  }

  /** Ensure the interaction type buffer matches the current canvas pixel dimensions */
  private ensureIxTypeBuf(width: number, height: number): void {
    const device = this.device!
    const pixelCount = width * height
    if (this.ixTypeBuf && this.ixTypeBufPixelCount === pixelCount) return

    this.ixTypeBuf?.destroy()
    this.ixTypeBuf = device.createBuffer({
      size: pixelCount * 4, // u32 per pixel
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.ixTypeBufPixelCount = pixelCount
    this.invalidateBindGroupCaches()
  }

  private createBindGroupLayouts(): void {
    const device = this.device!
    // When float32-filterable is available, textureSample works with float textures
    const texSampleType: GPUTextureSampleType = this.hasFloat32Filterable ? 'float' : 'unfilterable-float'
    const samplerType: GPUSamplerBindingType = this.hasFloat32Filterable ? 'filtering' : 'non-filtering'

    // Group 0: per-frame uniforms
    this.frameBindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }],
    })

    // Group 1 for base pass: colorTex, stateTex, selectionTex, effectTex, sampler
    this.baseTextureBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: texSampleType } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: texSampleType } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: texSampleType } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: texSampleType } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: samplerType } },
      ],
    })

    // Group 1 for effect pass: colorTex, stateTex, fieldMask, feedbackTex, sampler
    // FRAGMENT | COMPUTE so the same bind group works for both render and compute pipelines
    this.effectTextureBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: texSampleType } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: texSampleType } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: texSampleType } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: texSampleType } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, sampler: { type: samplerType } },
      ],
    })

    // Group 2: per-effect uniforms (FRAGMENT | COMPUTE)
    this.effectUniformBindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }],
    })

    // ─── Compute effect pipeline layouts ───

    // Group 3 for compute effects: dispatch region uniform + accumulation storage buffer
    this.computeDispatchLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    })

    // Group 0 for accum clear compute: storage buffer
    this.clearComputeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    })

    // Group 1 for blit: read-only storage buffer
    this.blitStorageLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    })

    // Mask clear: group 1 with fieldMask + sampler
    this.maskClearTextureBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: texSampleType } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: samplerType } },
      ],
    })

    // ─── Superimposed rendering bind group layout ───
    // Group 1: fields (read) + accum (rw) + hitId (rw) + interactions (read) + ixBuf (rw) + ixTypeBuf (rw) + prevAccum (read)
    this.superBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    })

    this.superLayoutHasIxBuf = true

    // Propagation pass: ixBuf (read) + accumBuf (rw) + ixTypeBuf (read)
    this.propagationBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    })

    // Post-process group 0: frame uniforms + post-process uniforms
    this.postProcessUniformBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    })

    // Post-process group 1: accumBuf in (read-only), postOut (write)
    this.postProcessBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    })

    // Particle update group 1: particle buffer (read-write)
    this.particleUpdateBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    })

    // Particle render group 1: particle buffer (read) + accumBuf (read-write)
    this.particleRenderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    })

    // Compute bind group layout 0: state uniforms
    this.computeBindGroupLayout0 = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }],
    })

    // Compute bind group layout 1: stateTex, colorTex, outputTex
    this.computeBindGroupLayout1 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
      ],
    })
  }

  private createDataTexture(label = 'data'): GPUTexture {
    return this.device!.createTexture({
      label,   // a fault must NAME its corpse — "(unlabeled)" taught us that
      size: [this.gridSize, this.gridSize],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING,
    })
  }

  private createFeedbackTexture(): GPUTexture {
    return this.device!.createTexture({
      size: [FieldRenderer.FEEDBACK_SIZE, FieldRenderer.FEEDBACK_SIZE],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  private async createRenderPipeline(
    fragModule: GPUShaderModule,
    textureBindGroupLayout: GPUBindGroupLayout,
    blend: GPUBlendState | undefined,
    extraGroupLayouts?: GPUBindGroupLayout[],
  ): Promise<GPURenderPipeline> {
    const layouts = [this.frameBindGroupLayout!, textureBindGroupLayout]
    if (extraGroupLayouts) layouts.push(...extraGroupLayouts)

    const layout = this.device!.createPipelineLayout({ bindGroupLayouts: layouts })

    return this.device!.createRenderPipelineAsync({
      layout,
      vertex: { module: this.vertexModule!, entryPoint: 'main' },
      fragment: {
        module: fragModule,
        entryPoint: 'main',
        targets: [{
          format: this.canvasFormat,
          blend,
        }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  private async createPresenceRenderPipeline(
    fragModule: GPUShaderModule,
    textureBindGroupLayout: GPUBindGroupLayout,
    blend: GPUBlendState | undefined,
    extraGroupLayouts?: GPUBindGroupLayout[],
  ): Promise<GPURenderPipeline> {
    const layouts = [this.frameBindGroupLayout!, textureBindGroupLayout]
    if (extraGroupLayouts) layouts.push(...extraGroupLayouts)

    const layout = this.device!.createPipelineLayout({ bindGroupLayouts: layouts })

    return this.device!.createRenderPipelineAsync({
      layout,
      vertex: { module: this.vertexModule!, entryPoint: 'main' },
      fragment: {
        module: fragModule,
        entryPoint: 'main',
        targets: [{
          format: 'rgba32float',
          blend: blend ? {
            color: blend.color,
            alpha: blend.alpha,
          } : undefined,
        }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  private async createMaskClearPipeline(fragModule: GPUShaderModule): Promise<GPURenderPipeline> {
    const layout = this.device!.createPipelineLayout({
      bindGroupLayouts: [this.frameBindGroupLayout!, this.maskClearTextureBindGroupLayout!],
    })

    return this.device!.createRenderPipelineAsync({
      layout,
      vertex: { module: this.vertexModule!, entryPoint: 'main' },
      fragment: {
        module: fragModule,
        entryPoint: 'main',
        targets: [{ format: this.canvasFormat }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  /** FNV-1a hash of source string */
  private hashSource(source: string): string {
    let hash = 0x811c9dc5 | 0
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(36)
  }

  /** Dispatch the post-processing compute pass if enabled */
  private _postRanThisFrame = false
  private _cachedBlitSrcPost: boolean | null = null

  private dispatchPostProcess(encoder: GPUCommandEncoder, device: GPUDevice, bufferW: number, bufferH: number): void {
    this._postRanThisFrame = false
    if (!this.postProcessSettings.enabled || !this.postProcessPipeline || !this.postProcessUniformBuf || !this.accumBuf || !this.postOutBuf) return

    const pp = this.postProcessSettings
    const d = this._postProcessUniformData
    d[0] = pp.bloomIntensity; d[1] = pp.bloomThreshold; d[2] = pp.vignetteStrength; d[3] = pp.vignetteRadius
    d[4] = pp.exposure; d[5] = 0 // _pad
    d[6] = pp.lightDir[0]; d[7] = pp.lightDir[1] // lightDir (vec2f at offset 24, aligned to 8)
    d[8] = pp.lightIntensity; d[9] = 0; d[10] = 0; d[11] = 0 // lightIntensity + padding
    device.queue.writeBuffer(this.postProcessUniformBuf, 0, d)

    const ppUniformBG = device.createBindGroup({
      layout: this.postProcessUniformBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.frameUniformBuf! } },
        { binding: 1, resource: { buffer: this.postProcessUniformBuf } },
      ],
    })
    const ppStorageBG = device.createBindGroup({
      layout: this.postProcessBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.accumBuf } },
        { binding: 1, resource: { buffer: this.postOutBuf! } },
      ],
    })
    this._postRanThisFrame = true

    const ppPass = encoder.beginComputePass()
    ppPass.setPipeline(this.postProcessPipeline)
    ppPass.setBindGroup(0, ppUniformBG)
    ppPass.setBindGroup(1, ppStorageBG)
    ppPass.dispatchWorkgroups(Math.ceil(bufferW / 16), Math.ceil(bufferH / 16))
    ppPass.end()
  }

  private writeFrameUniforms(
    camera: { x: number; y: number },
    resolution: [number, number],
    zoom: number,
    time: number,
    mode3D?: { pos: [number, number, number]; pitch: number; yaw: number; fov: number },
  ): void {
    const d = this._frameUniformData
    d[0] = camera.x; d[1] = camera.y; d[2] = resolution[0]; d[3] = resolution[1]
    d[4] = zoom; d[5] = time; d[6] = this.gridSize; d[7] = mode3D ? 1.0 : 0.0
    // 3D camera params (ignored in 2D mode)
    d[8] = mode3D?.pos[0] ?? 0; d[9] = mode3D?.pos[1] ?? 0; d[10] = mode3D?.pos[2] ?? 0
    d[11] = mode3D?.fov ?? 1.047 // default 60°
    d[12] = mode3D?.pitch ?? 0; d[13] = mode3D?.yaw ?? 0
    d[14] = 0; d[15] = 0 // padding
    this.device!.queue.writeBuffer(this.frameUniformBuf!, 0, d)
  }

  /** Write effect uniforms to the staging buffer at the given slot index.
   *  Use encoder.copyBufferToBuffer before each pass to transfer to effectUniformBuf. */
  private stageEffectUniforms(index: number, effect: FieldEffectData): void {
    const d = this._effectUniformData
    const ac = effect.fieldAColor, bc = effect.fieldBColor, at = effect.fieldATransform, bt = effect.fieldBTransform
    d[0] = effect.bounds[0]; d[1] = effect.bounds[1]; d[2] = effect.bounds[2]; d[3] = effect.bounds[3]
    d[4] = effect.params[0]; d[5] = effect.params[1]; d[6] = effect.params[2]; d[7] = effect.params[3]
    d[8] = effect.transform[0]; d[9] = effect.transform[1]; d[10] = effect.transform[2]; d[11] = effect.transform[3]
    d[12] = ac?.[0] ?? 0; d[13] = ac?.[1] ?? 0; d[14] = ac?.[2] ?? 0; d[15] = ac?.[3] ?? 0
    d[16] = bc?.[0] ?? 0; d[17] = bc?.[1] ?? 0; d[18] = bc?.[2] ?? 0; d[19] = bc?.[3] ?? 0
    d[20] = at?.[0] ?? 0; d[21] = at?.[1] ?? 0; d[22] = at?.[2] ?? 0; d[23] = at?.[3] ?? 0
    d[24] = bt?.[0] ?? 0; d[25] = bt?.[1] ?? 0; d[26] = bt?.[2] ?? 0; d[27] = bt?.[3] ?? 0
    this.device!.queue.writeBuffer(this.effectUniformStagingBuf!, index * FieldRenderer.EFFECT_UNIFORM_SIZE, d)
  }

  private writeEffectUniforms(
    bounds: [number, number, number, number],
    params: [number, number, number, number],
    transform: [number, number, number, number],
    fieldAColor?: [number, number, number, number],
    fieldBColor?: [number, number, number, number],
    fieldATransform?: [number, number, number, number],
    fieldBTransform?: [number, number, number, number],
  ): void {
    const d = this._effectUniformData
    d[0] = bounds[0]; d[1] = bounds[1]; d[2] = bounds[2]; d[3] = bounds[3]
    d[4] = params[0]; d[5] = params[1]; d[6] = params[2]; d[7] = params[3]
    d[8] = transform[0]; d[9] = transform[1]; d[10] = transform[2]; d[11] = transform[3]
    d[12] = fieldAColor?.[0] ?? 0; d[13] = fieldAColor?.[1] ?? 0; d[14] = fieldAColor?.[2] ?? 0; d[15] = fieldAColor?.[3] ?? 0
    d[16] = fieldBColor?.[0] ?? 0; d[17] = fieldBColor?.[1] ?? 0; d[18] = fieldBColor?.[2] ?? 0; d[19] = fieldBColor?.[3] ?? 0
    d[20] = fieldATransform?.[0] ?? 0; d[21] = fieldATransform?.[1] ?? 0; d[22] = fieldATransform?.[2] ?? 0; d[23] = fieldATransform?.[3] ?? 0
    d[24] = fieldBTransform?.[0] ?? 0; d[25] = fieldBTransform?.[1] ?? 0; d[26] = fieldBTransform?.[2] ?? 0; d[27] = fieldBTransform?.[3] ?? 0
    this.device!.queue.writeBuffer(this.effectUniformBuf!, 0, d)
  }

  // ─── Cached bind groups (avoid per-frame GPU allocations) ───
  private _cachedFrameBG: GPUBindGroup | null = null
  private _cachedEffectUniformBG: GPUBindGroup | null = null
  private _cachedBaseTexBG: GPUBindGroup | null = null
  private _cachedEffectTexBGs: Map<string, GPUBindGroup> = new Map()

  private getFrameBindGroup(): GPUBindGroup {
    if (!this._cachedFrameBG) {
      this._cachedFrameBG = this.device!.createBindGroup({
        layout: this.frameBindGroupLayout!,
        entries: [{ binding: 0, resource: { buffer: this.frameUniformBuf! } }],
      })
    }
    return this._cachedFrameBG
  }

  private getBaseTextureBindGroup(): GPUBindGroup {
    if (!this._cachedBaseTexBG) {
      this._cachedBaseTexBG = this.device!.createBindGroup({
        layout: this.baseTextureBindGroupLayout!,
        entries: [
          { binding: 0, resource: this.colorTex!.createView() },
          { binding: 1, resource: this.getCurrentStateTex().createView() },
          { binding: 2, resource: this.selectionTex!.createView() },
          { binding: 3, resource: this.effectTex!.createView() },
          { binding: 4, resource: this.sampler! },
        ],
      })
    }
    return this._cachedBaseTexBG
  }

  private getEffectTextureBindGroup(fieldId: string, feedbackTex?: GPUTexture): GPUBindGroup {
    const cacheKey = feedbackTex ? `${fieldId}_fb` : fieldId
    let bg = this._cachedEffectTexBGs.get(cacheKey)
    if (!bg) {
      const maskTex = this.fieldMaskTextures.get(fieldId) || this.createEmptyMaskTexture(fieldId)
      bg = this.device!.createBindGroup({
        layout: this.effectTextureBindGroupLayout!,
        entries: [
          { binding: 0, resource: this.colorTex!.createView() },
          { binding: 1, resource: this.getCurrentStateTex().createView() },
          { binding: 2, resource: maskTex.createView() },
          { binding: 3, resource: (feedbackTex || this.colorTex!).createView() },
          { binding: 4, resource: this.sampler! },
        ],
      })
      this._cachedEffectTexBGs.set(cacheKey, bg)
    }
    return bg
  }

  private getEffectUniformBindGroup(): GPUBindGroup {
    if (!this._cachedEffectUniformBG) {
      this._cachedEffectUniformBG = this.device!.createBindGroup({
        layout: this.effectUniformBindGroupLayout!,
        entries: [{ binding: 0, resource: { buffer: this.effectUniformBuf! } }],
      })
    }
    return this._cachedEffectUniformBG
  }

  /** Invalidate all cached bind groups (call when buffers/textures are reallocated) */
  private invalidateBindGroupCaches(): void {
    this._cachedFrameBG = null
    this._cachedEffectUniformBG = null
    this._cachedBaseTexBG = null
    this._cachedEffectTexBGs.clear()
    this._cachedClearBG = null
    this._cachedDispatchBG = null
    this._cachedPropBG = null
    this._cachedBlitBG = null
    this._cachedSuperBG = null
    this._cachedPostProcessBG = null
    this._cachedStateUpdateBG0 = null
    this._cachedStateUpdateBG1A = null
    this._cachedStateUpdateBG1B = null
    this._cachedRenderTargetBG = null
  }

  private createEmptyMaskTexture(fieldId: string): GPUTexture {
    // a NEW mask means any cached bind group views the OLD one — invalidate
    this._cachedEffectTexBGs.delete(fieldId)
    this._cachedEffectTexBGs.delete(fieldId + '_fb')
    const tex = this.createDataTexture(`mask:${fieldId}`)
    // Already zeroed — GPUTexture initial contents are 0
    this.fieldMaskTextures.set(fieldId, tex)
    return tex
  }

  // --- Public texture upload methods ---

  /** Guarantee the icon buffer exists (min 1 u32) so the super bind group is
   *  always valid, even before any atlas is uploaded. */
  private ensureIconBuffer(): void {
    if (!this.device || this.iconBuffer) return
    this.iconBuffer = this.device.createBuffer({
      size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.iconBufferCapacity = 4
  }

  /** Upload the packed RGBA8 icon atlas (one u32 per texel, 64x64 per slot).
   *  Grows the buffer if needed and invalidates the super bind group so the
   *  new buffer is picked up. Cheap and rare — called when thumbnails change. */
  uploadIconAtlas(data: Uint32Array): void {
    if (!this.device) return
    const bytes = Math.max(4, data.byteLength)
    if (!this.iconBuffer || this.iconBufferCapacity < bytes) {
      this.iconBuffer?.destroy()
      this.iconBuffer = this.device.createBuffer({
        size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      this.iconBufferCapacity = bytes
      this._cachedSuperBG = null   // new buffer → the cached bind group is stale
    }
    this.device.queue.writeBuffer(this.iconBuffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
  }

  uploadColorData(data: Float32Array): void {
    if (!this.device || !this.colorTex) return
    this.device.queue.writeTexture(
      { texture: this.colorTex },
      data.buffer as ArrayBuffer,
      { bytesPerRow: this.gridSize * 16 },
      [this.gridSize, this.gridSize],
    )
  }

  uploadStateData(data: Float32Array): void {
    if (!this.device) return
    const tex = this.stateTexCurrent === 0 ? this.stateTex : this.stateTex2
    if (!tex) return
    this.device.queue.writeTexture(
      { texture: tex },
      data.buffer as ArrayBuffer,
      { bytesPerRow: this.gridSize * 16 },
      [this.gridSize, this.gridSize],
    )
  }

  uploadEffectData(data: Float32Array): void {
    if (!this.device || !this.effectTex) return
    this.device.queue.writeTexture(
      { texture: this.effectTex },
      data.buffer as ArrayBuffer,
      { bytesPerRow: this.gridSize * 16 },
      [this.gridSize, this.gridSize],
    )
  }

  private getExpandedMaskBuf(): Float32Array {
    const needed = this.gridSize * this.gridSize * 4
    if (!this._expandedMaskBuf || this._expandedMaskBuf.length !== needed) {
      this._expandedMaskBuf = new Float32Array(needed)
    }
    return this._expandedMaskBuf
  }

  uploadSelectionData(data: Uint8Array): void {
    if (!this.device || !this.selectionTex) return
    // Selection data is single-channel uint8 — expand to rgba32float
    const expanded = this.getExpandedMaskBuf()
    expanded.fill(0)
    for (let i = 0; i < data.length; i++) {
      expanded[i * 4] = data[i] > 0 ? 1.0 : 0.0
    }
    this.device.queue.writeTexture(
      { texture: this.selectionTex },
      expanded.buffer as ArrayBuffer,
      { bytesPerRow: this.gridSize * 16 },
      [this.gridSize, this.gridSize],
    )
  }

  uploadFieldMask(fieldId: string, data: Uint8Array): void {
    if (!this.device) return
    let maskTex = this.fieldMaskTextures.get(fieldId)
    if (!maskTex) {
      maskTex = this.createEmptyMaskTexture(fieldId)
    }
    // Expand to rgba32float (mask in red channel)
    const expanded = this.getExpandedMaskBuf()
    expanded.fill(0)
    for (let i = 0; i < data.length; i++) {
      expanded[i * 4] = data[i] > 0 ? 1.0 : 0.0
    }
    this.device.queue.writeTexture(
      { texture: maskTex },
      expanded.buffer as ArrayBuffer,
      { bytesPerRow: this.gridSize * 16 },
      [this.gridSize, this.gridSize],
    )
  }

  // --- Effect pipeline compilation ---

  async compileFieldEffect(programKey: string, fieldId: string, glsl: string, modCode?: string): Promise<{ success: boolean; error?: string }> {
    const device = this.device
    if (!device) return { success: false, error: 'No WebGPU device' }

    const fragSrc = buildEffectFragmentShader(glsl, modCode)
    const hash = this.hashSource(fragSrc)

    this.removeFieldEffect(programKey)

    // ─── Always compile render pipeline (used for presence maps + fallback) ───
    let shared = this.sharedPipelines.get(hash)
    if (shared) {
      shared.refCount++
    } else {
      if (this.sharedPipelines.size >= FieldRenderer.MAX_FIELD_EFFECTS) {
        return { success: false, error: `Max ${FieldRenderer.MAX_FIELD_EFFECTS} unique field effects reached` }
      }

      try {
        const fragModule = device.createShaderModule({ code: fragSrc })

        // Check for compilation errors
        const info = await fragModule.getCompilationInfo()
        const errors = info.messages.filter(m => m.type === 'error')
        if (errors.length > 0) {
          return { success: false, error: errors.map(e => e.message).join('\n') }
        }

        const pipeline = await this.createRenderPipeline(
          fragModule,
          this.effectTextureBindGroupLayout!,
          blendState('alpha'),
          [this.effectUniformBindGroupLayout!],
        )
        // the presence pass draws into an rgba32float texture — it needs its
        // own pipeline variant (this was built but never wired: every effect
        // hitting the presence path raised an attachment-format error)
        const presencePipeline = await this.createPresenceRenderPipeline(
          fragModule,
          this.effectTextureBindGroupLayout!,
          undefined,   // rgba32float is not blendable — presence is a footprint, not a composite
          [this.effectUniformBindGroupLayout!],
        )

        shared = { pipeline, presencePipeline, refCount: 1 }
        this.sharedPipelines.set(hash, shared)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Pipeline creation failed' }
      }
    }

    if (!this.fieldMaskTextures.has(fieldId)) {
      this.createEmptyMaskTexture(fieldId)
    }

    this.fieldEntries.set(programKey, { wgslHash: hash })

    // ─── Also compile compute pipeline (for main render loop) ───
    if (this.useComputeEffects) {
      const computeSrc = buildEffectComputeShader(glsl, modCode)
      const computeHash = this.hashSource(computeSrc)

      let sharedCompute = this.sharedComputePipelines.get(computeHash)
      if (sharedCompute) {
        sharedCompute.refCount++
      } else {
        try {
          const computeModule = device.createShaderModule({ code: computeSrc })
          const info = await computeModule.getCompilationInfo()
          const errors = info.messages.filter(m => m.type === 'error')
          if (errors.length > 0) {
            console.warn(`[Compute] Shader compile failed for ${programKey}, using render fallback:`, errors[0].message)
          } else {
            const computePipelineLayout = device.createPipelineLayout({
              bindGroupLayouts: [
                this.frameBindGroupLayout!,
                this.effectTextureBindGroupLayout!,
                this.effectUniformBindGroupLayout!,
                this.computeDispatchLayout!,
              ],
            })
            const pipeline = await device.createComputePipelineAsync({
              layout: computePipelineLayout,
              compute: { module: computeModule, entryPoint: 'main' },
            })
            sharedCompute = { pipeline, refCount: 1 }
            this.sharedComputePipelines.set(computeHash, sharedCompute)
          }
        } catch (err) {
          console.warn(`[Compute] Pipeline creation failed for ${programKey}, using render fallback`)
        }
      }

      if (sharedCompute) {
        this.fieldComputeEntries.set(programKey, { wgslHash: sharedCompute ? computeHash : '' })
      }
    }

    return { success: true }
  }

  removeFieldEffect(programKey: string): void {
    const entry = this.fieldEntries.get(programKey)
    if (entry) {
      const shared = this.sharedPipelines.get(entry.wgslHash)
      if (shared) {
        shared.refCount--
        if (shared.refCount <= 0) {
          this.sharedPipelines.delete(entry.wgslHash)
        }
      }
      this.fieldEntries.delete(programKey)
    }

    // Also clean up compute pipeline entry
    const computeEntry = this.fieldComputeEntries.get(programKey)
    if (computeEntry) {
      const sharedCompute = this.sharedComputePipelines.get(computeEntry.wgslHash)
      if (sharedCompute) {
        sharedCompute.refCount--
        if (sharedCompute.refCount <= 0) {
          this.sharedComputePipelines.delete(computeEntry.wgslHash)
        }
      }
      this.fieldComputeEntries.delete(programKey)
    }

    const fb = this.feedbackBuffers.get(programKey)
    if (fb) {
      this.retireTexture(fb.texA)
      this.retireTexture(fb.texB)
      this.feedbackBuffers.delete(programKey)
    }
  }

  removeAllFieldEffects(fieldId: string): void {
    const keysToRemove: string[] = []
    for (const key of this.fieldEntries.keys()) {
      if (key === fieldId || key.startsWith(fieldId + '_')) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      this.removeFieldEffect(key)
    }
    const maskTex = this.fieldMaskTextures.get(fieldId)
    if (maskTex) {
      this.retireTexture(maskTex)
      this.fieldMaskTextures.delete(fieldId)
      this._cachedEffectTexBGs.delete(fieldId)
      this._cachedEffectTexBGs.delete(fieldId + '_fb')
    }
  }

  getFieldEffectKeys(): IterableIterator<string> {
    return this.fieldEntries.keys()
  }

  removeFieldMask(fieldId: string): void {
    const tex = this.fieldMaskTextures.get(fieldId)
    if (tex) {
      this.retireTexture(tex)   // deferred: an in-flight submit may still hold it
      this.fieldMaskTextures.delete(fieldId)
      // the cached bind group holds a VIEW of the dead texture — it must die
      // with it, or every later pass submits the corpse (the ix-mask fault)
      this._cachedEffectTexBGs.delete(fieldId)
      this._cachedEffectTexBGs.delete(fieldId + '_fb')
    }
  }

  hasFieldEffect(programKey: string): boolean {
    return this.fieldEntries.has(programKey)
  }

  // --- Render ---

  render(
    camera: { x: number; y: number },
    zoom: number,
    time: number,
    fieldEffects?: FieldEffectData[],
    superFields?: SuperFieldGPU[],
    activeInteractions?: { fieldIdxA: number; fieldIdxB: number; interactionType: number; propagationType?: number }[],
    mode3D?: { pos: [number, number, number]; pitch: number; yaw: number; fov: number },
    stepHookData?: { dt: number; worldData: Record<string, unknown> },
  ): void {
    const device = this.device
    const ctx = this.context
    if (!device || !ctx || !this.basePipeline) return

    this.reapRetiredTextures()
    const canvas = ctx.canvas as HTMLCanvasElement
    const displayW = canvas.clientWidth
    const displayH = canvas.clientHeight
    const dpr = this.effectiveDpr(displayW, displayH)
    const bufferW = Math.round(displayW * dpr)
    const bufferH = Math.round(displayH * dpr)

    if (canvas.width !== bufferW || canvas.height !== bufferH) {
      canvas.width = bufferW
      canvas.height = bufferH
    }

    this.writeFrameUniforms(camera, [bufferW, bufferH], zoom, time, mode3D)

    const encoder = device.createCommandEncoder()
    const textureView = ctx.getCurrentTexture().createView()

    // --- Pass 1: Base (opaque) ---
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          clearValue: { r: 0.035, g: 0.045, b: 0.065, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      })

      pass.setPipeline(this.basePipeline)
      pass.setBindGroup(0, this.getFrameBindGroup())
      pass.setBindGroup(1, this.getBaseTextureBindGroup())
      pass.draw(6)
      pass.end()
    }

    // --- Effects ---
    const is3D = !!mode3D
    const hasSuperFields = superFields && superFields.length > 0 && (is3D ? this.super3DPipelineReady : this.superPipelineReady)
    if ((fieldEffects && fieldEffects.length > 0) || hasSuperFields) {
      // Separate effects into compute-eligible and render-fallback
      const computeEffects: FieldEffectData[] = []
      const renderEffects: FieldEffectData[] = []

      if (fieldEffects && fieldEffects.length > 0) {
        if (this.useComputeEffects && this.clearComputePipeline && this.blitPipeline) {
          for (const effect of fieldEffects) {
            const computeEntry = this.fieldComputeEntries.get(effect.programKey)
            if (computeEntry && this.sharedComputePipelines.has(computeEntry.wgslHash)) {
              computeEffects.push(effect)
            } else {
              renderEffects.push(effect)
            }
          }
        } else {
          renderEffects.push(...fieldEffects)
        }
      }

      // ─── Stage ALL effect uniforms upfront ───
      let stageIdx = 0
      const computeStageIndices: number[] = []
      for (const effect of computeEffects) {
        this.stageEffectUniforms(stageIdx, effect)
        computeStageIndices.push(stageIdx++)
      }
      const renderStageIndices: number[] = []
      for (const effect of renderEffects) {
        this.stageEffectUniforms(stageIdx, effect)
        renderStageIndices.push(stageIdx++)
      }

      // Stage dispatch uniforms for compute effects
      for (let i = 0; i < computeEffects.length; i++) {
        this._dispatchUniformData[0] = 0; this._dispatchUniformData[1] = 0; this._dispatchUniformData[2] = bufferW; this._dispatchUniformData[3] = bufferH
        device.queue.writeBuffer(this.dispatchStagingBuf!, i * FieldRenderer.DISPATCH_UNIFORM_SIZE, this._dispatchUniformData)
      }

      // ─── Compute path: superimposed + per-field, blit once ───
      const needsAccum = computeEffects.length > 0 || hasSuperFields
      if (needsAccum) {
        this.ensureAccumBuf(bufferW, bufferH)

        // Swap accum buffers so prevAccumBuf holds last frame's composite
        this.swapAccumBufs()

        // Clear accumulation buffer
        {
          if (!this._cachedClearBG) {
            this._cachedClearBG = device.createBindGroup({
              layout: this.clearComputeLayout!,
              entries: [{ binding: 0, resource: { buffer: this.accumBuf! } }],
            })
          }
          const pass = encoder.beginComputePass()
          pass.setPipeline(this.clearComputePipeline!)
          pass.setBindGroup(0, this._cachedClearBG)
          pass.dispatchWorkgroups(Math.ceil(this.accumBufPixelCount / 256))
          pass.end()
        }

        // ─── GPU step hooks (modifies superFieldBuffer before uber-shader reads it) ───
        if (hasSuperFields && this.stepHookPipeline && stepHookData) {
          this.dispatchStepHooks(encoder, superFields!.length, stepHookData.dt, time, stepHookData.worldData)
        }

        // ─── Superimposed fields (single uber-shader dispatch) ───
        if (hasSuperFields) {
          this.renderSuperimposed(encoder, superFields!, bufferW, bufferH, activeInteractions, is3D)
        }

        // ─── Per-field compute effects ───
        const frameBG = this.getFrameBindGroup()
        const effectUniformBG = this.getEffectUniformBindGroup()

        for (let i = 0; i < computeEffects.length; i++) {
          const effect = computeEffects[i]
          const computeEntry = this.fieldComputeEntries.get(effect.programKey)!
          const sharedCompute = this.sharedComputePipelines.get(computeEntry.wgslHash)!

          // Copy this effect's uniforms from staging → active buffer (ordered within encoder)
          encoder.copyBufferToBuffer(
            this.effectUniformStagingBuf!, computeStageIndices[i] * FieldRenderer.EFFECT_UNIFORM_SIZE,
            this.effectUniformBuf!, 0, FieldRenderer.EFFECT_UNIFORM_SIZE,
          )
          encoder.copyBufferToBuffer(
            this.dispatchStagingBuf!, i * FieldRenderer.DISPATCH_UNIFORM_SIZE,
            this.dispatchUniformBuf!, 0, FieldRenderer.DISPATCH_UNIFORM_SIZE,
          )

          if (!this._cachedDispatchBG) {
            this._cachedDispatchBG = device.createBindGroup({
              layout: this.computeDispatchLayout!,
              entries: [
                { binding: 0, resource: { buffer: this.dispatchUniformBuf! } },
                { binding: 1, resource: { buffer: this.accumBuf! } },
              ],
            })
          }

          const pass = encoder.beginComputePass()
          pass.setPipeline(sharedCompute.pipeline)
          pass.setBindGroup(0, frameBG)
          pass.setBindGroup(1, this.getEffectTextureBindGroup(effect.fieldId))
          pass.setBindGroup(2, effectUniformBG)
          pass.setBindGroup(3, this._cachedDispatchBG)
          // Fullscreen dispatch — shader handles pixel-perfect shape via alpha
          pass.dispatchWorkgroups(
            Math.ceil(bufferW / 16),
            Math.ceil(bufferH / 16),
          )
          pass.end()
        }

        // ─── Interaction propagation pass ───
        if (!this._propLogDone && hasSuperFields) {
          console.log('[Propagation] Check:', { hasPipeline: !!this.propagationPipeline, hasIxBuf: !!this.ixBuf, ixBufPixels: this.ixBufPixelCount })
          this._propLogDone = true
        }
        if (hasSuperFields && this.propagationPipeline && this.ixBuf && this.ixTypeBuf) {
          if (!this._cachedPropBG) {
            this._cachedPropBG = device.createBindGroup({
              layout: this.propagationBindGroupLayout!,
              entries: [
                { binding: 0, resource: { buffer: this.ixBuf } },
                { binding: 1, resource: { buffer: this.accumBuf! } },
                { binding: 2, resource: { buffer: this.ixTypeBuf } },
              ],
            })
          }
          const propPass = encoder.beginComputePass()
          propPass.setPipeline(this.propagationPipeline)
          propPass.setBindGroup(0, frameBG)
          propPass.setBindGroup(1, this._cachedPropBG)
          propPass.dispatchWorkgroups(
            Math.ceil(bufferW / 16),
            Math.ceil(bufferH / 16),
          )
          propPass.end()
        }

        // ─── GPU Particles ───
        this.dispatchParticles(encoder, device, bufferW, bufferH)

        // ─── Post-processing pass (bloom, tone mapping, vignette) ───
        this.dispatchPostProcess(encoder, device, bufferW, bufferH)

        // Blit accumulation buffer to screen
        {
          if (!this._cachedBlitBG || this._cachedBlitSrcPost !== this._postRanThisFrame) {
            this._cachedBlitBG = device.createBindGroup({
              layout: this.blitStorageLayout!,
              entries: [{ binding: 0, resource: { buffer: (this._postRanThisFrame ? this.postOutBuf! : this.accumBuf!) } }],
            })
            this._cachedBlitSrcPost = this._postRanThisFrame
          }
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: textureView,
              loadOp: 'load',
              storeOp: 'store',
            }],
          })
          pass.setPipeline(this.blitPipeline!)
          pass.setBindGroup(0, frameBG)
          pass.setBindGroup(1, this._cachedBlitBG!)
          pass.draw(6)
          pass.end()
        }
      }

      // ─── Render pass fallback for effects without compute pipelines ───
      if (renderEffects.length > 0) {
        const frameBG = this.getFrameBindGroup()
        const effectUniformBG = this.getEffectUniformBindGroup()

        for (let i = 0; i < renderEffects.length; i++) {
          const effect = renderEffects[i]
          const entry = this.fieldEntries.get(effect.programKey)
          if (!entry) continue
          const shared = this.sharedPipelines.get(entry.wgslHash)
          if (!shared) continue

          // Copy this effect's uniforms from staging → active buffer
          encoder.copyBufferToBuffer(
            this.effectUniformStagingBuf!, renderStageIndices[i] * FieldRenderer.EFFECT_UNIFORM_SIZE,
            this.effectUniformBuf!, 0, FieldRenderer.EFFECT_UNIFORM_SIZE,
          )

          if (effect.precedence && this.maskClearPipeline) {
            const maskTex = this.fieldMaskTextures.get(effect.fieldId)
            if (maskTex) {
              const mcPass = encoder.beginRenderPass({
                colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
              })
              // maskClear uses fullscreen — mask texture handles pixel-perfect clearing
              mcPass.setPipeline(this.maskClearPipeline)
              mcPass.setBindGroup(0, frameBG)
              mcPass.setBindGroup(1, device.createBindGroup({
                layout: this.maskClearTextureBindGroupLayout!,
                entries: [
                  { binding: 0, resource: maskTex.createView() },
                  { binding: 1, resource: this.sampler! },
                ],
              }))
              mcPass.draw(6)
              mcPass.end()
            }
          }

          // Fullscreen render pass — no scissor rect, shader alpha defines pixel-perfect shape
          const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
          })
          pass.setPipeline(shared.pipeline)
          pass.setBindGroup(0, frameBG)
          pass.setBindGroup(1, this.getEffectTextureBindGroup(effect.fieldId))
          pass.setBindGroup(2, effectUniformBG)
          pass.draw(6)
          pass.end()
        }
      }
    }

    device.queue.submit([encoder.finish()])
  }

  /** Effects-only render — used for spatial canvas decoration */
  renderEffectsOnly(
    camera: { x: number; y: number },
    zoom: number,
    time: number,
    fieldEffects: FieldEffectData[],
    clearColor: [number, number, number, number] = [0.008, 0.024, 0.09, 1.0],
  ): void {
    const device = this.device
    const ctx = this.context
    if (!device || !ctx) return

    const canvas = ctx.canvas as HTMLCanvasElement
    const displayW = canvas.clientWidth
    const displayH = canvas.clientHeight
    const dpr = this.effectiveDpr(displayW, displayH)
    const bufferW = Math.round(displayW * dpr)
    const bufferH = Math.round(displayH * dpr)

    if (canvas.width !== bufferW || canvas.height !== bufferH) {
      canvas.width = bufferW
      canvas.height = bufferH
    }

    this.writeFrameUniforms(camera, [bufferW, bufferH], zoom, time)

    const encoder = device.createCommandEncoder()
    const textureView = ctx.getCurrentTexture().createView()

    // Clear pass
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: clearColor[3] },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      })
      pass.end()
    }

    if (fieldEffects.length > 0) {
      const computeEffects: FieldEffectData[] = []
      const renderEffects: FieldEffectData[] = []

      if (this.useComputeEffects && this.clearComputePipeline && this.blitPipeline) {
        for (const effect of fieldEffects) {
          const ce = this.fieldComputeEntries.get(effect.programKey)
          if (ce && this.sharedComputePipelines.has(ce.wgslHash)) {
            computeEffects.push(effect)
          } else {
            renderEffects.push(effect)
          }
        }
      } else {
        renderEffects.push(...fieldEffects)
      }

      // Stage all effect uniforms
      let stageIdx = 0
      const computeStageIndices: number[] = []
      for (const effect of computeEffects) { this.stageEffectUniforms(stageIdx, effect); computeStageIndices.push(stageIdx++) }
      const renderStageIndices: number[] = []
      for (const effect of renderEffects) { this.stageEffectUniforms(stageIdx, effect); renderStageIndices.push(stageIdx++) }
      // Fullscreen dispatch — no scissor clipping
      for (let i = 0; i < computeEffects.length; i++) {
        this._dispatchUniformData[0] = 0; this._dispatchUniformData[1] = 0; this._dispatchUniformData[2] = bufferW; this._dispatchUniformData[3] = bufferH
        device.queue.writeBuffer(this.dispatchStagingBuf!, i * FieldRenderer.DISPATCH_UNIFORM_SIZE, this._dispatchUniformData)
      }

      if (computeEffects.length > 0) {
        this.ensureAccumBuf(bufferW, bufferH)
        if (!this._cachedClearBG) {
          this._cachedClearBG = device.createBindGroup({ layout: this.clearComputeLayout!, entries: [{ binding: 0, resource: { buffer: this.accumBuf! } }] })
        }
        { const pass = encoder.beginComputePass(); pass.setPipeline(this.clearComputePipeline!); pass.setBindGroup(0, this._cachedClearBG); pass.dispatchWorkgroups(Math.ceil(this.accumBufPixelCount / 256)); pass.end() }

        const frameBG = this.getFrameBindGroup()
        const effectUniformBG = this.getEffectUniformBindGroup()

        for (let i = 0; i < computeEffects.length; i++) {
          const effect = computeEffects[i]
          const ce = this.fieldComputeEntries.get(effect.programKey)!
          const sc = this.sharedComputePipelines.get(ce.wgslHash)!

          encoder.copyBufferToBuffer(this.effectUniformStagingBuf!, computeStageIndices[i] * FieldRenderer.EFFECT_UNIFORM_SIZE, this.effectUniformBuf!, 0, FieldRenderer.EFFECT_UNIFORM_SIZE)
          encoder.copyBufferToBuffer(this.dispatchStagingBuf!, i * FieldRenderer.DISPATCH_UNIFORM_SIZE, this.dispatchUniformBuf!, 0, FieldRenderer.DISPATCH_UNIFORM_SIZE)

          if (!this._cachedDispatchBG) {
            this._cachedDispatchBG = device.createBindGroup({ layout: this.computeDispatchLayout!, entries: [{ binding: 0, resource: { buffer: this.dispatchUniformBuf! } }, { binding: 1, resource: { buffer: this.accumBuf! } }] })
          }
          const pass = encoder.beginComputePass()
          pass.setPipeline(sc.pipeline)
          pass.setBindGroup(0, frameBG)
          pass.setBindGroup(1, this.getEffectTextureBindGroup(effect.fieldId))
          pass.setBindGroup(2, effectUniformBG)
          pass.setBindGroup(3, this._cachedDispatchBG)
          pass.dispatchWorkgroups(Math.ceil(bufferW / 16), Math.ceil(bufferH / 16))
          pass.end()
        }

        // Post-processing
        this.dispatchPostProcess(encoder, device, bufferW, bufferH)

        if (!this._cachedBlitBG || this._cachedBlitSrcPost !== this._postRanThisFrame) {
          this._cachedBlitBG = device.createBindGroup({ layout: this.blitStorageLayout!, entries: [{ binding: 0, resource: { buffer: (this._postRanThisFrame ? this.postOutBuf! : this.accumBuf!) } }] })
          this._cachedBlitSrcPost = this._postRanThisFrame
        }
        const blitPass = encoder.beginRenderPass({ colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }] })
        blitPass.setPipeline(this.blitPipeline!)
        blitPass.setBindGroup(0, this.getFrameBindGroup())
        blitPass.setBindGroup(1, this._cachedBlitBG)
        blitPass.draw(6)
        blitPass.end()
      }

      if (renderEffects.length > 0) {
        const frameBG = this.getFrameBindGroup()
        const effectUniformBG = this.getEffectUniformBindGroup()
        for (let i = 0; i < renderEffects.length; i++) {
          const effect = renderEffects[i]
          const entry = this.fieldEntries.get(effect.programKey)
          if (!entry) continue
          const shared = this.sharedPipelines.get(entry.wgslHash)
          if (!shared) continue
          encoder.copyBufferToBuffer(this.effectUniformStagingBuf!, renderStageIndices[i] * FieldRenderer.EFFECT_UNIFORM_SIZE, this.effectUniformBuf!, 0, FieldRenderer.EFFECT_UNIFORM_SIZE)
          // Fullscreen render — no scissor, shader alpha defines pixel-perfect shape
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }] })
          pass.setPipeline(shared.pipeline)
          pass.setBindGroup(0, frameBG)
          pass.setBindGroup(1, this.getEffectTextureBindGroup(effect.fieldId))
          pass.setBindGroup(2, effectUniformBG)
          pass.draw(6)
          pass.end()
        }
      }
    }

    device.queue.submit([encoder.finish()])
  }

  /** Sample rendered pixels in a region — async version using buffer readback */
  async sampleRenderedRegion(
    camera: { x: number; y: number },
    zoom: number,
    gridX: number, gridY: number,
    gridW: number, gridH: number,
    sampleSize: number = 16,
  ): Promise<{ width: number; height: number; pixels: number[] } | null> {
    const device = this.device
    const ctx = this.context
    if (!device || !ctx) return null
    const canvas = ctx.canvas as HTMLCanvasElement

    const bufferW = canvas.width
    const bufferH = canvas.height
    const aspect = bufferW / bufferH

    const gridRange = this.gridSize / zoom
    let screenX: number, screenY: number, screenW: number, screenH: number
    if (aspect > 1) {
      screenX = ((gridX - camera.x) / (gridRange * aspect) + 0.5) * bufferW
      screenY = ((gridY - camera.y) / gridRange + 0.5) * bufferH
      screenW = (gridW / (gridRange * aspect)) * bufferW
      screenH = (gridH / gridRange) * bufferH
    } else {
      screenX = ((gridX - camera.x) / gridRange + 0.5) * bufferW
      screenY = ((gridY - camera.y) / (gridRange / aspect) + 0.5) * bufferH
      screenW = (gridW / gridRange) * bufferW
      screenH = (gridH / (gridRange / aspect)) * bufferH
    }

    const x0 = Math.max(0, Math.floor(screenX))
    const y0 = Math.max(0, Math.floor(screenY))
    const x1 = Math.min(bufferW, Math.ceil(screenX + screenW))
    const y1 = Math.min(bufferH, Math.ceil(screenY + screenH))
    const pw = x1 - x0
    const ph = y1 - y0
    if (pw <= 0 || ph <= 0) return null

    // Copy region from current texture to buffer
    const canvasTex = ctx.getCurrentTexture()
    const bytesPerRow = Math.ceil(pw * 4 / 256) * 256
    const buf = device.createBuffer({
      size: bytesPerRow * ph,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer(
      { texture: canvasTex, origin: [x0, y0, 0] },
      { buffer: buf, bytesPerRow, rowsPerImage: ph },
      [pw, ph],
    )
    device.queue.submit([encoder.finish()])

    await buf.mapAsync(GPUMapMode.READ)
    const raw = new Uint8Array(buf.getMappedRange())

    const outW = Math.min(sampleSize, pw)
    const outH = Math.min(sampleSize, ph)
    const pixels: number[] = []
    for (let sy = 0; sy < outH; sy++) {
      for (let sx = 0; sx < outW; sx++) {
        const srcX = Math.floor((sx / outW) * pw)
        const srcY = Math.floor((sy / outH) * ph)
        const rowStart = srcY * bytesPerRow
        const idx = rowStart + srcX * 4
        // BGRA → RGBA
        pixels.push(raw[idx + 2] / 255, raw[idx + 1] / 255, raw[idx] / 255, raw[idx + 3] / 255)
      }
    }
    buf.unmap()
    buf.destroy()

    return { width: outW, height: outH, pixels }
  }

  // --- State update compute ---

  async compileStateUpdate(wgsl: string, modCode?: string): Promise<{ success: boolean; error?: string }> {
    return this.compileCompositeStateUpdate([{ id: 'single', wgsl }], modCode)
  }

  async compileCompositeStateUpdate(fields: { id: string; wgsl: string }[], modCode?: string): Promise<{ success: boolean; error?: string }> {
    const device = this.device
    if (!device) return { success: false, error: 'No WebGPU device' }
    if (fields.length === 0) {
      this.removeStateUpdate()
      return { success: true }
    }

    const computeSrc = buildCompositeStateComputeShader(fields, modCode)

    try {
      const module = device.createShaderModule({ code: computeSrc })
      const info = await module.getCompilationInfo()
      const errors = info.messages.filter(m => m.type === 'error')
      if (errors.length > 0) {
        return { success: false, error: errors.map(e => e.message).join('\n') }
      }

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [this.computeBindGroupLayout0!, this.computeBindGroupLayout1!],
      })

      const pipeline = await device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module, entryPoint: 'main' },
      })

      this.stateUpdatePipeline = pipeline
      this.stateUpdateActive = true
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Compute pipeline creation failed' }
    }
  }

  removeStateUpdate(): void {
    this.stateUpdatePipeline = null
    this.stateUpdateActive = false
  }

  private _cachedStateUpdateBG0: GPUBindGroup | null = null
  private _cachedStateUpdateBG1A: GPUBindGroup | null = null // tex 0→1
  private _cachedStateUpdateBG1B: GPUBindGroup | null = null // tex 1→0

  runStateUpdate(time: number, dt: number): void {
    const device = this.device
    if (!device || !this.stateUpdateActive || !this.stateUpdatePipeline) return

    const d = this._stateUniformData
    d[0] = this.gridSize; d[1] = time; d[2] = dt; d[3] = 0
    device.queue.writeBuffer(this.stateUniformBuf!, 0, d)

    if (!this._cachedStateUpdateBG0) {
      this._cachedStateUpdateBG0 = device.createBindGroup({
        layout: this.computeBindGroupLayout0!,
        entries: [{ binding: 0, resource: { buffer: this.stateUniformBuf! } }],
      })
    }

    // Two cached bind groups — one per texture direction
    const bg1 = this.stateTexCurrent === 0
      ? (this._cachedStateUpdateBG1A ??= device.createBindGroup({
          layout: this.computeBindGroupLayout1!,
          entries: [
            { binding: 0, resource: this.stateTex!.createView() },
            { binding: 1, resource: this.colorTex!.createView() },
            { binding: 2, resource: this.stateTex2!.createView() },
          ],
        }))
      : (this._cachedStateUpdateBG1B ??= device.createBindGroup({
          layout: this.computeBindGroupLayout1!,
          entries: [
            { binding: 0, resource: this.stateTex2!.createView() },
            { binding: 1, resource: this.colorTex!.createView() },
            { binding: 2, resource: this.stateTex!.createView() },
          ],
        }))

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(this.stateUpdatePipeline)
    pass.setBindGroup(0, this._cachedStateUpdateBG0)
    pass.setBindGroup(1, bg1)
    pass.dispatchWorkgroups(Math.ceil(this.gridSize / 16), Math.ceil(this.gridSize / 16))
    pass.end()

    device.queue.submit([encoder.finish()])
    this.stateTexCurrent = this.stateTexCurrent === 0 ? 1 : 0
  }

  getCurrentStateTex(): GPUTexture {
    return this.stateTexCurrent === 0 ? this.stateTex! : this.stateTex2!
  }

  /** Read GPU state back to CPU. Async — non-blocking. */
  /** The screen's mood: sparse taps of the last finished composite.
   *  bright = tonemapped mean luma · warm = red-vs-blue balance ·
   *  busy = mean change since the previous sample. For the audio layer. */
  private lastMoodTaps: Float32Array | null = null
  async sampleMood(points = 8): Promise<{ bright: number; warm: number; busy: number } | null> {
    const device = this.device
    const src = this.prevAccumBuf
    if (!device || !src || !this.accumBufStride || !this.accumBufPixelCount) return null
    const W = this.accumBufStride
    const H = Math.floor(this.accumBufPixelCount / W)
    if (H < points || W < points) return null
    const n = points * points
    const out = device.createBuffer({ size: n * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const enc = device.createCommandEncoder()
    let k = 0
    for (let j = 0; j < points; j++) {
      for (let i = 0; i < points; i++) {
        const x = Math.floor((i + 0.5) / points * W)
        const y = Math.floor((j + 0.5) / points * H)
        enc.copyBufferToBuffer(src, (y * W + x) * 16, out, k * 16, 16)
        k++
      }
    }
    device.queue.submit([enc.finish()])
    await out.mapAsync(GPUMapMode.READ)
    const f = new Float32Array(out.getMappedRange().slice(0))
    out.unmap()
    out.destroy()
    let lum = 0, warm = 0, busy = 0
    for (let i = 0; i < n; i++) {
      const r = f[i * 4], g = f[i * 4 + 1], b = f[i * 4 + 2]
      lum += 0.299 * r + 0.587 * g + 0.114 * b
      warm += r - b
      if (this.lastMoodTaps) {
        busy += Math.abs(r - this.lastMoodTaps[i * 4]) + Math.abs(g - this.lastMoodTaps[i * 4 + 1]) + Math.abs(b - this.lastMoodTaps[i * 4 + 2])
      }
    }
    this.lastMoodTaps = f
    return {
      bright: 1 - Math.exp(-(lum / n) * 1.4),
      warm: Math.max(0, Math.min(1, (warm / n) * 1.8 + 0.5)),
      busy: Math.min(1, (busy / n) * 2.2),
    }
  }

  async readbackState(target: Float32Array): Promise<void> {
    const device = this.device
    if (!device) return

    const currentTex = this.getCurrentStateTex()
    const bytesPerRow = Math.ceil(this.gridSize * 16 / 256) * 256
    const buf = device.createBuffer({
      size: bytesPerRow * this.gridSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer(
      { texture: currentTex },
      { buffer: buf, bytesPerRow },
      [this.gridSize, this.gridSize],
    )
    device.queue.submit([encoder.finish()])

    await buf.mapAsync(GPUMapMode.READ)
    const mapped = new Float32Array(buf.getMappedRange())
    // Copy row by row (bytesPerRow may include padding)
    const rowFloats = this.gridSize * 4
    const rowBytes = bytesPerRow / 4
    for (let y = 0; y < this.gridSize; y++) {
      target.set(mapped.subarray(y * rowBytes, y * rowBytes + rowFloats), y * rowFloats)
    }
    buf.unmap()
    buf.destroy()
  }

  /** Render each field's effects individually to the presence texture, then async readback
   *  into per-field Uint8Array maps. Each field gets its OWN presence map (not shared).
   *  Call consumePresenceMaps() next frame to get results. */
  schedulePresenceReadback(
    time: number,
    fieldEffects: FieldEffectData[],
  ): void {
    const device = this.device
    if (!device || !this.presenceTex || this.presenceReadPending) return

    // Group effects by fieldId
    const effectsByField = new Map<string, FieldEffectData[]>()
    for (const effect of fieldEffects) {
      let list = effectsByField.get(effect.fieldId)
      if (!list) {
        list = []
        effectsByField.set(effect.fieldId, list)
      }
      list.push(effect)
    }

    const numFields = effectsByField.size
    if (numFields === 0) return

    // Calculate per-field slice in the staging buffer
    const bytesPerRow = Math.ceil(this.gridSize * 16 / 256) * 256
    const sliceSize = bytesPerRow * this.gridSize
    const totalBufSize = numFields * sliceSize

    // Resize staging buffer if it's too small for current field count
    if (!this.presenceStagingBuf || this.presenceStagingBufCapacity < totalBufSize) {
      this.presenceStagingBuf?.destroy()
      this.presenceStagingBuf = device.createBuffer({
        size: totalBufSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      this.presenceStagingBufCapacity = totalBufSize
    }

    // Identity camera — render full grid
    this.writeFrameUniforms(
      { x: this.gridSize / 2, y: this.gridSize / 2 },
      [this.gridSize, this.gridSize],
      1.0,
      time,
    )

    // Stage all effect uniforms upfront into the staging buffer
    let stageIdx = 0
    const fieldStageMap = new Map<string, number[]>()
    for (const [fieldId, effects] of effectsByField) {
      const indices: number[] = []
      for (const effect of effects) {
        this.stageEffectUniforms(stageIdx, effect)
        indices.push(stageIdx++)
      }
      fieldStageMap.set(fieldId, indices)
    }

    const encoder = device.createCommandEncoder()
    const frameBG = this.getFrameBindGroup()
    const effectUniformBG = this.getEffectUniformBindGroup()
    const fieldOrder: string[] = []
    let fieldIdx = 0

    for (const [fieldId, effects] of effectsByField) {
      fieldOrder.push(fieldId)
      const stageIndices = fieldStageMap.get(fieldId)!

      // Clear presence texture before rendering this field
      {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: this.presenceTex.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        })
        pass.end()
      }

      // Render only this field's effects
      for (let i = 0; i < effects.length; i++) {
        const effect = effects[i]
        const entry = this.fieldEntries.get(effect.programKey)
        if (!entry) continue
        const shared = this.sharedPipelines.get(entry.wgslHash)
        if (!shared?.presencePipeline) continue   // float-target variant only

        // Copy this effect's uniforms from staging → active buffer
        encoder.copyBufferToBuffer(
          this.effectUniformStagingBuf!, stageIndices[i] * FieldRenderer.EFFECT_UNIFORM_SIZE,
          this.effectUniformBuf!, 0, FieldRenderer.EFFECT_UNIFORM_SIZE,
        )

        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: this.presenceTex.createView(),
            loadOp: 'load',
            storeOp: 'store',
          }],
        })
        pass.setPipeline(shared.presencePipeline)
        pass.setBindGroup(0, frameBG)
        pass.setBindGroup(1, this.getEffectTextureBindGroup(effect.fieldId))
        pass.setBindGroup(2, effectUniformBG)
        pass.draw(6)
        pass.end()
      }

      // Copy this field's presence render to its slot in the staging buffer
      encoder.copyTextureToBuffer(
        { texture: this.presenceTex },
        { buffer: this.presenceStagingBuf!, bytesPerRow, offset: fieldIdx * sliceSize },
        [this.gridSize, this.gridSize],
      )

      fieldIdx++
    }

    device.queue.submit([encoder.finish()])

    // Async readback — split staging buffer into per-field presence maps
    this.presenceReadPending = true
    this.presenceStagingBuf!.mapAsync(GPUMapMode.READ).then(() => {
      const mapped = this.presenceStagingBuf!.getMappedRange()
      const gs = this.gridSize
      const rowFloats = bytesPerRow / 4
      const result = new Map<string, Uint8Array>()

      for (let fi = 0; fi < fieldOrder.length; fi++) {
        const fieldId = fieldOrder[fi]
        const sliceOffset = fi * sliceSize
        const fieldData = new Float32Array(mapped, sliceOffset, sliceSize / 4)
        const presence = new Uint8Array(gs * gs)

        for (let y = 0; y < gs; y++) {
          const srcRow = y * rowFloats
          const dstRow = y * gs
          for (let x = 0; x < gs; x++) {
            const alpha = fieldData[srcRow + x * 4 + 3]
            if (alpha > 0.02) {
              presence[dstRow + x] = 255
            }
          }
        }

        result.set(fieldId, presence)
      }

      this.presenceLastResult = result
      this.presenceStagingBuf!.unmap()
      this.presenceReadPending = false
    }).catch(() => {
      this.presenceReadPending = false
    })
  }

  /** Consume the results from the previous frame's presence readback */
  consumePresenceMaps(): Map<string, Uint8Array> {
    const result = this.presenceLastResult
    this.presenceLastResult = new Map()
    return result
  }

  /** Synchronous presence map render — renders each field individually.
   *  Fallback for when async pipeline isn't set up yet. */
  renderFieldPresenceMaps(
    time: number,
    fieldEffects: FieldEffectData[],
  ): Map<string, Uint8Array> {
    // Use the last async result if available
    if (this.presenceLastResult.size > 0) {
      return this.consumePresenceMaps()
    }

    // Schedule for next frame
    this.schedulePresenceReadback(time, fieldEffects)
    return new Map()
  }

  /** Render a single-pixel presence check */
  pickFieldAtPixel(field: { id: string; effects: { id: string }[]; transform: { x: number; y: number; rotation: number; scale: number }; color: [number, number, number, number] }, gx: number, gy: number): boolean {
    // For WebGPU, we use the last presence map result instead of per-pixel GPU pick
    const presence = this.presenceLastResult.get(field.id)
    if (!presence) return false
    if (gx < 0 || gx >= this.gridSize || gy < 0 || gy >= this.gridSize) return false
    return presence[gy * this.gridSize + gx] > 0
  }

  hasStateUpdate(): boolean {
    return this.stateUpdateActive
  }

  /** Render presence map into target buffer (legacy sync API wrapper) */
  renderPresenceMap(
    camera: { x: number; y: number },
    zoom: number,
    time: number,
    fieldEffects: FieldEffectData[],
    target: Float32Array,
  ): void {
    // Schedule async readback — results available next frame
    this.schedulePresenceReadback(time, fieldEffects)
  }

  // ─── Superimposed rendering ───

  /** Lazily compile the superimposed compute pipeline.
   *  Guards against re-entrant calls (render loop calls every frame).
   *  compilationId is only bumped by register methods — if it changes
   *  during async compilation, the result is discarded and recompilation
   *  is triggered on the next frame. */
  private async ensureSuperPipeline(): Promise<boolean> {
    if (this.superPipelineReady) return true
    if (this.superCompiling) return false  // Already compiling, wait for it
    const device = this.device
    if (!device || !this.superBindGroupLayout || !this.frameBindGroupLayout) return false

    this.superCompiling = true
    const myCompilationId = this.superCompilationId  // Snapshot — don't bump

    try {
      const allVisuals = this.getAllVisualTypes().filter(v => !v.broken)
      const allInteractions = this.getAllInteractionTypes()
      const allModules = this.getAllModules()
      const targetCount = this.renderTargets.size
      console.log(`[Super] Compiling uber-shader with ${allVisuals.length} visuals, ${allInteractions.length} interactions, ${allModules.length} modules, ${targetCount} targets`)
      const shaderSrc = buildSuperimposedComputeShader(allVisuals, allInteractions, allModules, targetCount)
      console.log('[Super] Generated WGSL length:', shaderSrc.length, 'chars')
      // Log interaction-related WGSL
      if (allInteractions.length > 0) {
        const ixLines = shaderSrc.split('\n').filter((l: string) => l.includes('interaction') || l.includes('Interaction') || l.includes('dispatchInteraction'))
        console.log('[Super] Interaction-related WGSL lines:', ixLines)
      }
      const module = device.createShaderModule({ code: shaderSrc })
      const info = await module.getCompilationInfo()
      const errors = info.messages.filter(m => m.type === 'error')
      if (errors.length > 0) {
        // Fault isolation: find the offending visual(s) by compiling each one
        // alone, quarantine them, and let the next frame recompile with the
        // healthy set. One broken shader must not black out the whole world.
        const quarantined = await this.quarantineBrokenVisuals(allVisuals, allModules, targetCount)
        if (quarantined.length > 0) {
          console.error(`[Super] QUARANTINED ${quarantined.length} broken visual(s): ${quarantined.join(', ')} — recompiling without them`)
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('cc:fault', {
              detail: { kind: 'quarantine', message: `visual(s) failed to compile and were quarantined: ${quarantined.join(', ')}` },
            }))
          }
          this.superCompilationError = null
          this.super3DPipelineReady = false
          this.super3DPipeline = null
          return false
        }
        const errorMsg = errors.map(e => `Line ${e.lineNum}:${e.linePos}: ${e.message}`).join('\n')
        this.superCompilationError = errorMsg
        console.error('[Super] Shader compile errors:')
        for (const e of errors) {
          console.error(`  Line ${e.lineNum}:${e.linePos}: ${e.message}`)
        }
        console.error('[Super] Generated shader source:\n', shaderSrc)
        return false
      }
      // Log warnings too
      const warnings = info.messages.filter(m => m.type === 'warning')
      if (warnings.length > 0) {
        console.warn('[Super] Shader warnings:', warnings.map(w => w.message).join('\n'))
      }

      // Check if a register call invalidated during compilation
      if (myCompilationId !== this.superCompilationId) {
        console.log('[Super] Compilation superseded, will recompile next frame')
        return false
      }

      // Build pipeline layout — include render target bind group layout if targets exist
      if (targetCount > 0) {
        this.ensureRenderTargetBindGroupLayout()
      }
      const bindGroupLayouts: GPUBindGroupLayout[] = [this.frameBindGroupLayout, this.superBindGroupLayout]
      if (targetCount > 0 && this.renderTargetBindGroupLayout) {
        bindGroupLayouts.push(this.renderTargetBindGroupLayout)
      }
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts })
      this.superPipeline = await device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module, entryPoint: 'main' },
      })

      if (myCompilationId !== this.superCompilationId) {
        console.log('[Super] Compilation superseded after pipeline creation, will recompile')
        return false
      }

      this.superPipelineReady = true
      this.superCompilationError = null
      console.log('[Super] Pipeline compiled (' + allVisuals.length + ' visuals, ' + this.getAllInteractionTypes().length + ' interactions, ' + allModules.length + ' modules, ' + targetCount + ' targets)')
      return true
    } catch (err) {
      this.superCompilationError = err instanceof Error ? err.message : 'Pipeline creation failed'
      console.error('[Super] Pipeline creation failed:', err)
      return false
    } finally {
      this.superCompiling = false
    }
  }

  /** Compile each visual in isolation to find the ones that break the
   *  uber-shader. Broken entries are flagged (entry.broken/entry.error) so
   *  subsequent compiles exclude them. Returns the quarantined names. */
  private async quarantineBrokenVisuals(
    visuals: VisualTypeEntry[],
    modules: { name: string; wgsl: string }[],
    targetCount: number,
  ): Promise<string[]> {
    const device = this.device
    if (!device) return []
    const quarantined: string[] = []
    for (const v of visuals) {
      try {
        const src = buildSuperimposedComputeShader([v], [], modules, targetCount)
        const mod = device.createShaderModule({ code: src })
        const info = await mod.getCompilationInfo()
        const errs = info.messages.filter(m => m.type === 'error')
        if (errs.length > 0) {
          v.broken = true
          v.error = errs.map(e => `Line ${e.lineNum}:${e.linePos}: ${e.message}`).join('\n')
          quarantined.push(v.name)
          console.error(`[Super] Visual '${v.name}' failed isolated compile:\n${v.error}`)
        }
      } catch (err) {
        v.broken = true
        v.error = err instanceof Error ? err.message : 'compile threw'
        quarantined.push(v.name)
      }
    }
    return quarantined
  }

  /** Lazy-compile the 3D uber-shader pipeline (mirrors ensureSuperPipeline). */
  private async ensureSuper3DPipeline(): Promise<boolean> {
    if (this.super3DPipelineReady) return true
    if (this.super3DCompiling) return false
    const device = this.device
    if (!device || !this.superBindGroupLayout || !this.frameBindGroupLayout) return false

    this.super3DCompiling = true
    const myCompilationId = this.superCompilationId

    try {
      const allVisuals = this.getAllVisualTypes().filter(v => !v.broken)
      const allInteractions = this.getAllInteractionTypes()
      const allModules = this.getAllModules()
      const targetCount = this.renderTargets.size
      console.log(`[Super3D] Compiling 3D uber-shader with ${allVisuals.length} visuals, ${allModules.length} modules`)
      const shaderSrc = buildSuperimposed3DComputeShader(allVisuals, allInteractions, allModules, targetCount)
      const module = device.createShaderModule({ code: shaderSrc })
      const info = await module.getCompilationInfo()
      const errors = info.messages.filter(m => m.type === 'error')
      if (errors.length > 0) {
        console.error('[Super3D] Shader compile errors:')
        for (const e of errors) {
          console.error(`  Line ${e.lineNum}:${e.linePos}: ${e.message}`)
        }
        console.error('[Super3D] Generated shader source:\n', shaderSrc)
        return false
      }

      if (myCompilationId !== this.superCompilationId) {
        console.log('[Super3D] Compilation superseded, will recompile next frame')
        return false
      }

      if (targetCount > 0) this.ensureRenderTargetBindGroupLayout()
      const bindGroupLayouts: GPUBindGroupLayout[] = [this.frameBindGroupLayout, this.superBindGroupLayout]
      if (targetCount > 0 && this.renderTargetBindGroupLayout) {
        bindGroupLayouts.push(this.renderTargetBindGroupLayout)
      }
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts })
      this.super3DPipeline = await device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module, entryPoint: 'main' },
      })

      if (myCompilationId !== this.superCompilationId) {
        console.log('[Super3D] Compilation superseded after pipeline creation')
        return false
      }

      this.super3DPipelineReady = true
      console.log('[Super3D] 3D pipeline compiled')
      return true
    } catch (err) {
      console.error('[Super3D] Pipeline creation failed:', err)
      return false
    } finally {
      this.super3DCompiling = false
    }
  }

  /** Ensure the field storage buffer can hold the given number of fields */
  private ensureSuperFieldBuffer(fieldCount: number): void {
    const device = this.device!
    const needed = fieldCount * FieldRenderer.SUPER_FIELD_STRIDE
    if (this.superFieldBuffer && this.superFieldBufferCapacity >= needed) return

    this.superFieldBuffer?.destroy()
    this.superFieldStagingBuffer?.destroy()
    const capacity = Math.max(needed, FieldRenderer.SUPER_MAX_FIELDS * FieldRenderer.SUPER_FIELD_STRIDE)
    this.superFieldBuffer = device.createBuffer({
      size: capacity,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    this.superFieldStagingBuffer = device.createBuffer({
      size: capacity,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })
    this.superFieldBufferCapacity = capacity
  }

  /** Ensure the hit ID buffer exists and is large enough for the current canvas size */
  private ensureHitIdBuffer(pixelCount: number): void {
    const device = this.device!
    if (this.hitIdBuffer && this.hitIdPixelCount >= pixelCount) return

    this.hitIdBuffer?.destroy()
    this.hitIdStagingBuffer?.destroy()

    const byteSize = pixelCount * 4 // u32 per pixel
    this.hitIdBuffer = device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    this.hitIdStagingBuffer = device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })
    this.hitIdPixelCount = pixelCount
  }

  /** Write the world-uniform whiteboard (up to 64 floats). Cheap: skips upload when values unchanged. */
  updateWorldUniforms(vals: number[] | Float32Array): void {
    const n = Math.min(64, vals.length)
    let changed = false
    for (let i = 0; i < n; i++) {
      const v = Number.isFinite(vals[i]) ? vals[i] : 0
      if (this._worldUniData[i] !== v) { this._worldUniData[i] = v; changed = true }
    }
    if (changed) this._worldUniDirty = true
  }

  private flushWorldUniforms(): void {
    if (!this.device) return
    if (!this.worldUniBuffer) {
      this.worldUniBuffer = this.device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      this._worldUniDirty = true
    }
    if (!this._worldUniDirty) return
    this.device.queue.writeBuffer(this.worldUniBuffer, 0, this._worldUniData)
    this._worldUniDirty = false
  }

  /** Ensure the interaction buffer exists and is large enough */
  private ensureInteractionBuffer(count: number): void {
    const device = this.device!
    // Need at least 1 entry so the storage buffer is non-zero size
    const needed = Math.max(1, count) * FieldRenderer.INTERACTION_STRIDE
    if (this.interactionBuffer && this.interactionBufferCapacity >= needed) return

    this.interactionBuffer?.destroy()
    this.interactionBuffer = device.createBuffer({
      size: needed,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.interactionBufferCapacity = needed
  }

  /** Pack field data into the GPU storage buffer and dispatch the superimposed shader.
   *  Call between accum clear and blit.
   *  When render targets are active, fields are sorted into dependency levels and
   *  dispatched in order: fields writing to targets first, then fields sampling them. */
  renderSuperimposed(
    encoder: GPUCommandEncoder,
    fields: SuperFieldGPU[],
    bufferW: number,
    bufferH: number,
    activeInteractions?: { fieldIdxA: number; fieldIdxB: number; interactionType: number; propagationType?: number }[],
    use3D?: boolean,
  ): void {
    const pipeline = use3D ? this.super3DPipeline : this.superPipeline
    if (fields.length === 0 || !pipeline || !this.accumBuf) return

    // Lazy upgrade: if renderer was initialized before ixTypeBuf support, recreate layout
    if (!this.superLayoutHasIxBuf && this.device) {
      this.superBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        ],
      })
      this.superLayoutHasIxBuf = true
      this.superPipelineReady = false // force uber-shader recompilation with new layout
      this.super3DPipelineReady = false
    }

    // Lazy create/recompile propagation pipeline if missing or invalidated
    if (!this.propagationPipeline && this.device) {
      this.recompilePropagationPipeline()
    }

    this.flushWorldUniforms()
    const pixelCount = bufferW * bufferH
    this.ensureSuperFieldBuffer(fields.length)
    this.ensureHitIdBuffer(pixelCount)
    this.ensureIxBuf(bufferW, bufferH)
    this.ensureIxTypeBuf(bufferW, bufferH)
    this.ensureRenderTargets(pixelCount)
    this.ensureIconBuffer()
    this.hitMapWidth = bufferW
    this.hitMapHeight = bufferH

    // Pack all fields into a Float32Array (24 floats per field) — reuse if same field count
    const neededLen = fields.length * 24
    if (!this._superFieldDataCache || this._superFieldDataCache.length !== neededLen) {
      this._superFieldDataCache = new Float32Array(neededLen)
    }
    const data = this._superFieldDataCache!
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]
      const off = i * 24
      data[off +  0] = f.posScaleRot[0]
      data[off +  1] = f.posScaleRot[1]
      data[off +  2] = f.posScaleRot[2]
      data[off +  3] = f.posScaleRot[3]
      data[off +  4] = f.shapeDims[0]
      data[off +  5] = f.shapeDims[1]
      data[off +  6] = f.shapeDims[2]
      data[off +  7] = f.shapeDims[3]
      data[off +  8] = f.color[0]
      data[off +  9] = f.color[1]
      data[off + 10] = f.color[2]
      data[off + 11] = f.color[3]
      data[off + 12] = f.visualAndParams[0]
      data[off + 13] = f.visualAndParams[1]
      data[off + 14] = f.visualAndParams[2]
      data[off + 15] = f.visualAndParams[3]
      data[off + 16] = f.extraParams[0]
      data[off + 17] = f.extraParams[1]
      data[off + 18] = f.extraParams[2]
      data[off + 19] = f.extraParams[3]
      data[off + 20] = f.pos3D?.[0] ?? 0  // z
      data[off + 21] = f.pos3D?.[1] ?? 0  // rotX
      data[off + 22] = f.pos3D?.[2] ?? 0  // rotY
      data[off + 23] = f.pos3D?.[3] ?? 0  // reserved
    }
    this.device!.queue.writeBuffer(this.superFieldBuffer!, 0, data)

    // Pack interactions (4 u32 each: fieldIdxA, fieldIdxB, interactionType, pad)
    const ixList = activeInteractions || []
    if (ixList.length > 0 && !this._ixLogDone) {
      console.log('[Super] Active interactions:', JSON.stringify(ixList))
      this._ixLogDone = true
    }
    this.ensureInteractionBuffer(ixList.length)
    const ixNeeded = Math.max(1, ixList.length) * 4
    if (!this._ixDataCache || this._ixDataCache.length !== ixNeeded) {
      this._ixDataCache = new Uint32Array(ixNeeded)
    }
    const ixData = this._ixDataCache!
    for (let i = 0; i < ixList.length; i++) {
      ixData[i * 4 + 0] = ixList[i].fieldIdxA
      ixData[i * 4 + 1] = ixList[i].fieldIdxB
      ixData[i * 4 + 2] = ixList[i].interactionType
      ixData[i * 4 + 3] = ixList[i].propagationType ?? 0xFFFFFFFF
    }
    // If no interactions, write a sentinel (0xFFFFFFFF indices won't match anything)
    if (ixList.length === 0) {
      ixData[0] = 0xFFFFFFFF
      ixData[1] = 0xFFFFFFFF
      ixData[2] = 0
      ixData[3] = 0
    }
    this.device!.queue.writeBuffer(this.interactionBuffer!, 0, ixData)

    // Create bind group (cached — invalidated when buffers resize or swap)
    if (!this._cachedSuperBG || fields.length !== this._lastSuperFieldCount || ixList.length !== this._lastInteractionCount) {
      this._cachedSuperBG = this.device!.createBindGroup({
        layout: this.superBindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.superFieldBuffer!, size: fields.length * FieldRenderer.SUPER_FIELD_STRIDE } },
          { binding: 1, resource: { buffer: this.accumBuf } },
          { binding: 2, resource: { buffer: this.hitIdBuffer! } },
          { binding: 3, resource: { buffer: this.interactionBuffer!, size: Math.max(1, ixList.length) * FieldRenderer.INTERACTION_STRIDE } },
          { binding: 4, resource: { buffer: this.ixBuf! } },
          { binding: 5, resource: { buffer: this.ixTypeBuf! } },
          { binding: 6, resource: { buffer: this.prevAccumBuf! } },
          { binding: 7, resource: { buffer: this.worldUniBuffer! } },
          { binding: 8, resource: { buffer: this.iconBuffer! } },
        ],
      })
      this._lastSuperFieldCount = fields.length
      this._lastInteractionCount = ixList.length
    }

    const frameBG = this.getFrameBindGroup()
    const rtBG = this.getRenderTargetBindGroup()

    // Clear render target buffers before dispatch
    if (this.renderTargets.size > 0) {
      const clearSize = pixelCount * 16
      for (const entry of this.renderTargets.values()) {
        // Zero out the buffer via writeBuffer (vec4f(0) for each pixel)
        // Use a single clear compute pass instead for efficiency
        encoder.clearBuffer(entry.buffer, 0, clearSize)
      }
    }

    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, frameBG)
    pass.setBindGroup(1, this._cachedSuperBG)
    if (rtBG) {
      pass.setBindGroup(2, rtBG)
    }
    pass.dispatchWorkgroups(
      Math.ceil(bufferW / 16),
      Math.ceil(bufferH / 16),
    )
    pass.end()

    // Copy hit ID buffer to staging for CPU readback
    if (this.hitIdStagingBuffer && !this.hitIdReadbackPending) {
      const byteSize = bufferW * bufferH * 4
      encoder.copyBufferToBuffer(this.hitIdBuffer!, 0, this.hitIdStagingBuffer, 0, byteSize)
    }
  }

  /** Trigger async readback of the hit ID buffer. Call after queue.submit(). */
  readbackHitMap(): void {
    if (!this.hitIdStagingBuffer || this.hitIdReadbackPending) return
    this.hitIdReadbackPending = true

    const staging = this.hitIdStagingBuffer
    const w = this.hitMapWidth
    const h = this.hitMapHeight

    staging.mapAsync(GPUMapMode.READ).then(() => {
      const data = new Uint32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      this.hitMap = data
      this.hitIdReadbackPending = false
    }).catch(() => {
      this.hitIdReadbackPending = false
    })
  }

  /** Check if the superimposed pipeline is ready, and trigger compilation if not */
  isSuperReady(): boolean {
    if (this.superPipelineReady) return true
    // Trigger lazy compilation
    this.ensureSuperPipeline()
    return false
  }

  /** Check if the 3D pipeline is ready, and trigger compilation if not */
  isSuper3DReady(): boolean {
    if (this.super3DPipelineReady) return true
    this.ensureSuper3DPipeline()
    return false
  }

  // ─── GPU Step Hooks ───

  /** Check if GPU step hooks are active */
  hasStepHooks(): boolean {
    return this.stepHookPipeline !== null
  }

  /** Bump step hook compilation ID (call when hooks are added/removed) */
  invalidateStepHooks(): void {
    this._stepHookCompilationId++
  }

  /** Ensure the step state buffer can hold the given number of fields */
  private ensureStepStateBuffer(fieldCount: number): void {
    const device = this.device!
    const needed = fieldCount * FieldRenderer.STEP_STATE_STRIDE
    if (this.stepStateBuffer && this.stepStateCapacity >= needed) return

    const oldBuffer = this.stepStateBuffer
    const oldCapacity = this.stepStateCapacity

    const capacity = Math.max(needed, FieldRenderer.SUPER_MAX_FIELDS * FieldRenderer.STEP_STATE_STRIDE)
    this.stepStateBuffer = device.createBuffer({
      size: capacity,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    this.stepStateStagingBuffer?.destroy()
    this.stepStateStagingBuffer = device.createBuffer({
      size: capacity,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })

    // Preserve existing state data when growing
    if (oldBuffer && oldCapacity > 0) {
      const encoder = device.createCommandEncoder()
      encoder.copyBufferToBuffer(oldBuffer, 0, this.stepStateBuffer, 0, oldCapacity)
      device.queue.submit([encoder.finish()])
      oldBuffer.destroy()
    }

    this.stepStateCapacity = capacity
  }

  /** Compile the GPU step hook compute pipeline from user WGSL hooks */
  async compileStepHookPipeline(hooks: Array<{ id: string; wgsl: string }>): Promise<{ ok: boolean; error: string | null }> {
    if (this._stepHookCompiling) return { ok: false, error: 'Compilation already in progress' }
    this._stepHookCompiling = true
    const compilationId = this._stepHookCompilationId

    try {
      const device = this.device!
      const wgsl = buildStepHookComputeShader(hooks)

      if (!this.stepHookBindGroupLayout) {
        this.stepHookBindGroupLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          ],
        })
      }

      if (!this.stepUniformBuffer) {
        this.stepUniformBuffer = device.createBuffer({
          size: 64, // 16 floats
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
      }

      const module = device.createShaderModule({ code: wgsl })
      const info = await module.getCompilationInfo()
      const errors = info.messages.filter(m => m.type === 'error')
      if (errors.length > 0) {
        const errMsg = errors.map(m => `Line ${m.lineNum}: ${m.message}`).join('\n')
        console.error('[StepHook] Compilation errors:', errMsg)
        this._stepHookCompiling = false
        return { ok: false, error: errMsg }
      }

      // Check if compilation was invalidated during async compile
      if (compilationId !== this._stepHookCompilationId) {
        this._stepHookCompiling = false
        return { ok: false, error: 'Compilation invalidated' }
      }

      const layout = device.createPipelineLayout({
        bindGroupLayouts: [this.stepHookBindGroupLayout],
      })
      this.stepHookPipeline = device.createComputePipeline({
        layout,
        compute: { module, entryPoint: 'main' },
      })
      this._stepHookLastCompiledId = compilationId
      this._stepHookCompiling = false
      console.log('[StepHook] Pipeline compiled successfully')
      return { ok: true, error: null }
    } catch (err) {
      console.error('[StepHook] Pipeline creation failed:', err)
      this._stepHookCompiling = false
      return { ok: false, error: String(err) }
    }
  }

  /** Remove the step hook pipeline (no GPU hooks active) */
  clearStepHookPipeline(): void {
    this.stepHookPipeline = null
  }

  /** Check if step hook pipeline needs recompilation */
  stepHookNeedsRecompile(): boolean {
    return this._stepHookLastCompiledId !== this._stepHookCompilationId && !this._stepHookCompiling
  }

  /** Dispatch GPU step hooks. Call BEFORE renderSuperimposed in the command encoder. */
  dispatchStepHooks(
    encoder: GPUCommandEncoder,
    fieldCount: number,
    dt: number,
    time: number,
    worldData: Record<string, unknown>,
  ): void {
    if (!this.stepHookPipeline || !this.device || fieldCount === 0) return
    if (!this.superFieldBuffer || !this.stepUniformBuffer) return

    this.ensureStepStateBuffer(fieldCount)

    // Upload step uniforms (16 floats = 64 bytes)
    const d = new Float32Array(16)
    d[0] = dt
    d[1] = time
    d[2] = (worldData['mouse_x'] as number) ?? 0
    d[3] = (worldData['mouse_y'] as number) ?? 0
    d[4] = (worldData['mouse_down'] as number) ?? 0
    d[5] = (worldData['key_up'] as number) ?? 0
    d[6] = (worldData['key_down'] as number) ?? 0
    d[7] = (worldData['key_left'] as number) ?? 0
    d[8] = (worldData['key_right'] as number) ?? 0
    d[9] = (worldData['key_space'] as number) ?? 0
    d[10] = (worldData['key_shift'] as number) ?? 0
    // fieldCount must be stored as u32 bits in a f32 slot
    const fieldCountView = new DataView(d.buffer)
    fieldCountView.setUint32(44, fieldCount, true) // offset 11*4=44
    d[12] = this.gridSize
    d[13] = (worldData['gpu_custom0'] as number) ?? 0
    d[14] = (worldData['gpu_custom1'] as number) ?? 0
    d[15] = (worldData['gpu_custom2'] as number) ?? 0
    this.device.queue.writeBuffer(this.stepUniformBuffer, 0, d)

    if (!this.stepStateBuffer || !this.stepHookBindGroupLayout) return

    const bg = this.device.createBindGroup({
      layout: this.stepHookBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.superFieldBuffer, size: fieldCount * FieldRenderer.SUPER_FIELD_STRIDE } },
        { binding: 1, resource: { buffer: this.stepStateBuffer, size: fieldCount * FieldRenderer.STEP_STATE_STRIDE } },
        { binding: 2, resource: { buffer: this.stepUniformBuffer } },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.stepHookPipeline)
    pass.setBindGroup(0, bg)
    pass.dispatchWorkgroups(Math.ceil(fieldCount / 64))
    pass.end()
  }

  /** Request async readback of superFieldBuffer after step hooks modify it.
   *  Call after queue.submit(). */
  readbackSuperFields(fieldCount: number): void {
    if (!this.superFieldStagingBuffer || this.superFieldReadbackPending || !this.superFieldBuffer) return
    if (fieldCount === 0) return

    this.superFieldReadbackPending = true
    const staging = this.superFieldStagingBuffer
    const byteSize = fieldCount * FieldRenderer.SUPER_FIELD_STRIDE

    // Must use a separate command encoder for the copy since render already submitted
    const encoder = this.device!.createCommandEncoder()
    encoder.copyBufferToBuffer(this.superFieldBuffer, 0, staging, 0, byteSize)
    this.device!.queue.submit([encoder.finish()])

    staging.mapAsync(GPUMapMode.READ).then(() => {
      const data = new Float32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      this._lastSuperFieldReadback = data
      this.superFieldReadbackPending = false
    }).catch(() => {
      this.superFieldReadbackPending = false
    })
  }

  /** Latest readback data from GPU step hooks (null if no readback yet) */
  private _lastSuperFieldReadback: Float32Array | null = null

  /** Consume the latest superField readback data (returns null if not ready, clears after read) */
  consumeSuperFieldReadback(): Float32Array | null {
    const data = this._lastSuperFieldReadback
    this._lastSuperFieldReadback = null
    return data
  }

  /** Upload initial step state for a field (velocity + custom state + flags) */
  uploadStepState(fieldIndex: number, velocity: [number, number, number, number], state0: [number, number, number, number], state1: [number, number, number, number], flags: [number, number, number, number]): void {
    if (!this.stepStateBuffer || !this.device) return
    const data = new Float32Array(16)
    data.set(velocity, 0)
    data.set(state0, 4)
    data.set(state1, 8)
    data.set(flags, 12)
    this.device.queue.writeBuffer(this.stepStateBuffer, fieldIndex * FieldRenderer.STEP_STATE_STRIDE, data)
  }

  /** Force-compile the uber-shader and return whether it succeeded.
   *  Used by FieldEngine to get synchronous compile feedback for define_visual. */
  async compileSuperPipeline(): Promise<{ ok: boolean; error: string | null }> {
    this.superPipelineReady = false
    const success = await this.ensureSuperPipeline()
    return { ok: success, error: this.superCompilationError }
  }

  /** Returns the last uber-shader compilation error, or null if no error. */
  getSuperCompilationError(): string | null {
    return this.superCompilationError
  }

  /** Register a new visual type. Returns the assigned ID or updates existing.
   *  Triggers uber-shader recompilation. */
  /** Per-visual time dependency — the signature always names `time` once, so
   *  a second occurrence means the body actually animates. Unknown = animated. */
  private visualTimeDep: Map<number, boolean> = new Map()

  /** Is this visual a function of time? (conservative: unknown ids animate) */
  visualAnimated(id: number): boolean {
    return this.visualTimeDep.get(id) ?? true
  }

  /** Is the superimposed pipeline compiled and current? (safe to reuse last frame) */
  get superReady(): boolean {
    return this.superPipelineReady
  }

  /** Shader-registry version — part of the frame fingerprint */
  get compilationId(): number {
    return this.superCompilationId
  }

  registerVisualType(name: string, wgsl: string): { id: number; error?: string } {
    const existing = this.visualTypeRegistry.get(name)
    let id: number
    if (existing) {
      id = existing.id
      existing.wgsl = wgsl
      // New code gets a fresh chance — un-quarantine on update
      existing.broken = undefined
      existing.error = undefined
    } else {
      id = this.nextVisualTypeId++
      this.visualTypeRegistry.set(name, { id, name, wgsl })
    }
    // Signature contributes exactly one `time` — more means the body uses it
    this.visualTimeDep.set(id, ((wgsl.match(/\btime\b/g) || []).length) > 1 || /\b(prevAt|prevHere)\b/.test(wgsl))
    // Invalidate uber-shader — bump compilation ID so any in-flight compilation is discarded
    this.superCompilationId++
    this.superCompilationError = null
    this.superPipelineReady = false
    this.superPipeline = null
    this.super3DPipelineReady = false
    this.super3DPipeline = null
    return { id }
  }

  /** Get all registered visual types */
  getAllVisualTypes(): VisualTypeEntry[] {
    return [...this.visualTypeRegistry.values()]
  }

  /** Resolve a visual type name to its ID */
  resolveVisualType(name: string): number | undefined {
    const entry = this.visualTypeRegistry.get(name)
    return entry?.id
  }

  /** Register an interaction type. Triggers uber-shader recompilation. */
  registerInteraction(name: string, wgsl: string): { id: number } {
    const existing = this.interactionRegistry.get(name)
    let id: number
    if (existing) {
      id = existing.id
      existing.wgsl = wgsl
    } else {
      id = this.nextInteractionId++
      this.interactionRegistry.set(name, { id, name, wgsl })
    }
    this.superCompilationId++
    this.superPipelineReady = false
    this.superPipeline = null
    this.super3DPipelineReady = false
    this.super3DPipeline = null
    this._ixLogDone = false
    console.log(`[Super] Registered interaction '${name}' as id ${id}, triggering recompilation (compilationId=${this.superCompilationId})`)
    return { id }
  }

  /** Get all registered interaction types */
  getAllInteractionTypes(): InteractionEntry[] {
    return [...this.interactionRegistry.values()]
  }

  /** Resolve an interaction name to its ID */
  resolveInteraction(name: string): number | undefined {
    const entry = this.interactionRegistry.get(name)
    return entry?.id
  }

  /** Register a propagation type. Triggers propagation pipeline recompilation. */
  registerPropagation(name: string, wgsl: string): { id: number } {
    const existing = this.propagationRegistry.get(name)
    let id: number
    if (existing) {
      id = existing.id
      existing.wgsl = wgsl
    } else {
      id = this.nextPropagationId++
      this.propagationRegistry.set(name, { id, name, wgsl })
    }
    this.propagationCompilationId++
    this.propagationPipeline = null // force recompilation
    this._propLogDone = false
    console.log(`[Propagation] Registered '${name}' as id ${id}, triggering recompilation`)
    return { id }
  }

  /** Get all registered propagation types */
  getAllPropagationTypes(): PropagationEntry[] {
    return [...this.propagationRegistry.values()]
  }

  /** Resolve a propagation name to its ID */
  resolvePropagation(name: string): number | undefined {
    const entry = this.propagationRegistry.get(name)
    return entry?.id
  }

  /** Recompile the propagation pipeline with current registry */
  private recompilePropagationPipeline(): void {
    const device = this.device
    if (!device || !this.frameBindGroupLayout || !this.propagationBindGroupLayout) return

    const allPropagations = this.getAllPropagationTypes()
    const shaderSrc = buildPropagationComputeShader(allPropagations)
    const propModule = device.createShaderModule({ code: shaderSrc })
    // Check for compile errors
    propModule.getCompilationInfo().then(info => {
      const errors = info.messages.filter(m => m.type === 'error')
      if (errors.length > 0) {
        console.error('[Propagation] Shader compile errors:')
        for (const e of errors) console.error(`  Line ${e.lineNum}:${e.linePos}: ${e.message}`)
      }
    })
    this.propagationPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.frameBindGroupLayout, this.propagationBindGroupLayout],
      }),
      compute: { module: propModule, entryPoint: 'main' },
    })
    console.log(`[Propagation] Pipeline compiled (${allPropagations.length} types)`)
  }

  // ─── Shader Modules ───

  /** Register a shader module (reusable WGSL utility functions).
   *  Module functions use the mod_NAME prefix and can be called by any visual type.
   *  Triggers uber-shader recompilation (compile-time concatenation only, zero runtime cost). */
  registerModule(name: string, wgsl: string): void {
    this.moduleRegistry.set(name, { name, wgsl })
    this.superCompilationId++
    this.superPipelineReady = false
    this.superPipeline = null
    this.super3DPipelineReady = false
    this.super3DPipeline = null
    console.log(`[Module] Registered '${name}', triggering recompilation (compilationId=${this.superCompilationId})`)
  }

  /** Get all registered shader modules */
  getAllModules(): ModuleEntry[] {
    return [...this.moduleRegistry.values()]
  }

  // ─── Render Targets ───

  /** Create a named render target buffer. Returns the assigned ID (0-5).
   *  Targets auto-resize when canvas dimensions change. */
  createRenderTarget(name: string): { id: number; error?: string } {
    if (this.renderTargets.has(name)) {
      return { id: this.renderTargets.get(name)!.id }
    }
    if (this.renderTargets.size >= FieldRenderer.MAX_RENDER_TARGETS) {
      return { id: -1, error: `Maximum ${FieldRenderer.MAX_RENDER_TARGETS} render targets reached` }
    }
    const device = this.device
    if (!device) return { id: -1, error: 'Device not initialized' }

    const id = this.nextRenderTargetId++
    // Create buffer sized to current accumBuf (will be resized in ensureRenderTargets)
    const pixelCount = Math.max(this.accumBufPixelCount, 1)
    const buffer = device.createBuffer({
      size: pixelCount * 16, // vec4f = 16 bytes per pixel
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.renderTargets.set(name, { buffer, id })
    this._renderTargetPixelCount = pixelCount
    this._cachedRenderTargetBG = null
    // Trigger recompilation — target count changed
    this.superCompilationId++
    this.superPipelineReady = false
    this.superPipeline = null
    this.super3DPipelineReady = false
    this.super3DPipeline = null
    console.log(`[RTT] Created render target '${name}' (id=${id})`)
    return { id }
  }

  /** Destroy a named render target buffer */
  destroyRenderTarget(name: string): void {
    const entry = this.renderTargets.get(name)
    if (!entry) return
    entry.buffer.destroy()
    this.renderTargets.delete(name)
    this._cachedRenderTargetBG = null
    // Trigger recompilation — target count changed
    this.superCompilationId++
    this.superPipelineReady = false
    this.superPipeline = null
    this.super3DPipelineReady = false
    this.super3DPipeline = null
    console.log(`[RTT] Destroyed render target '${name}'`)
  }

  /** Get the number of active render targets */
  getRenderTargetCount(): number {
    return this.renderTargets.size
  }

  /** Resolve a render target name to its ID. Returns -1 if not found. */
  resolveRenderTarget(name: string): number {
    const entry = this.renderTargets.get(name)
    return entry ? entry.id : -1
  }

  /** Ensure all render target buffers match the current canvas pixel dimensions */
  private ensureRenderTargets(pixelCount: number): void {
    if (this.renderTargets.size === 0) return
    if (this._renderTargetPixelCount === pixelCount) return

    const device = this.device!
    const bufSize = pixelCount * 16
    for (const [name, entry] of this.renderTargets) {
      entry.buffer.destroy()
      entry.buffer = device.createBuffer({
        size: bufSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
    }
    this._renderTargetPixelCount = pixelCount
    this._cachedRenderTargetBG = null
  }

  /** Create the render target bind group layout for group 2 */
  private ensureRenderTargetBindGroupLayout(): void {
    const device = this.device!
    const count = this.renderTargets.size
    if (count === 0) {
      this.renderTargetBindGroupLayout = null
      return
    }
    const entries: GPUBindGroupLayoutEntry[] = []
    for (let i = 0; i < count; i++) {
      entries.push({
        binding: i,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' as GPUBufferBindingType },
      })
    }
    this.renderTargetBindGroupLayout = device.createBindGroupLayout({ entries })
  }

  /** Get render target bind group for group 2 */
  private getRenderTargetBindGroup(): GPUBindGroup | null {
    if (this.renderTargets.size === 0) return null
    if (this._cachedRenderTargetBG) return this._cachedRenderTargetBG

    const device = this.device!
    if (!this.renderTargetBindGroupLayout) this.ensureRenderTargetBindGroupLayout()
    if (!this.renderTargetBindGroupLayout) return null

    // Sort targets by id to ensure consistent binding order
    const sorted = [...this.renderTargets.values()].sort((a, b) => a.id - b.id)
    const entries: GPUBindGroupEntry[] = sorted.map((entry, i) => ({
      binding: i,
      resource: { buffer: entry.buffer },
    }))
    this._cachedRenderTargetBG = device.createBindGroup({
      layout: this.renderTargetBindGroupLayout,
      entries,
    })
    return this._cachedRenderTargetBG
  }

  /** Clear all visual type, interaction, propagation, and module registries. Called on reset. */
  clearRegistries(): void {
    this.visualTypeRegistry.clear()
    this.nextVisualTypeId = 0
    this.interactionRegistry.clear()
    this.nextInteractionId = 0
    this.propagationRegistry.clear()
    this.nextPropagationId = 0
    this.moduleRegistry.clear()
    // Destroy render target buffers
    for (const entry of this.renderTargets.values()) {
      entry.buffer.destroy()
    }
    this.renderTargets.clear()
    this.nextRenderTargetId = 0
    this._cachedRenderTargetBG = null
    this.renderTargetBindGroupLayout = null
    this.superPipelineReady = false
    this.superPipeline = null
    this.super3DPipelineReady = false
    this.super3DPipeline = null
    this.superCompilationId++
    this.propagationCompilationId++
    this.propagationPipeline = null
    this._ixLogDone = false
    this._propLogDone = false
    this.invalidateBindGroupCaches()
  }

  destroy(): void {
    this.sharedPipelines.clear()
    this.fieldEntries.clear()
    this.sharedComputePipelines.clear()
    this.fieldComputeEntries.clear()

    for (const tex of this.fieldMaskTextures.values()) {
      tex.destroy()
    }
    this.fieldMaskTextures.clear()

    for (const fb of this.feedbackBuffers.values()) {
      fb.texA.destroy()
      fb.texB.destroy()
    }
    this.feedbackBuffers.clear()

    this.colorTex?.destroy()
    this.stateTex?.destroy()
    this.stateTex2?.destroy()
    this.selectionTex?.destroy()
    this.effectTex?.destroy()
    this.presenceTex?.destroy()
    this.presenceStagingBuf?.destroy()
    this.frameUniformBuf?.destroy()
    this.effectUniformBuf?.destroy()
    this.stateUniformBuf?.destroy()
    this.dispatchUniformBuf?.destroy()
    this.effectUniformStagingBuf?.destroy()
    this.dispatchStagingBuf?.destroy()
    this.accumBuf?.destroy()
    this.prevAccumBuf?.destroy()
    this.ixBuf?.destroy()
    this.ixTypeBuf?.destroy()
    this.superFieldBuffer?.destroy()
    this.postProcessUniformBuf?.destroy()
    this.particleBuffer?.destroy()
    for (const entry of this.renderTargets.values()) {
      entry.buffer.destroy()
    }
    this.renderTargets.clear()

    this.device = null
    this.context = null
    this.basePipeline = null
    this.maskClearPipeline = null
    this.stateUpdatePipeline = null
    this.clearComputePipeline = null
    this.blitPipeline = null
    this.postProcessPipeline = null
    this.particleBuffer = null
    this.particleUpdatePipeline = null
    this.particleRenderPipeline = null
    this.colorTex = null
    this.stateTex = null
    this.stateTex2 = null
    this.selectionTex = null
    this.effectTex = null
    this.presenceTex = null
    this.effectUniformStagingBuf = null
    this.dispatchStagingBuf = null
    this.accumBuf = null
    this.prevAccumBuf = null
    this.superFieldBuffer = null
    this.superPipeline = null
    this.superPipelineReady = false
    this.super3DPipeline = null
    this.super3DPipelineReady = false
    this.visualTypeRegistry.clear()
    this.nextVisualTypeId = 0
    this.interactionRegistry.clear()
    this.nextInteractionId = 0
    this.interactionBuffer?.destroy()
    this.interactionBuffer = null
    this.hitIdBuffer?.destroy()
    this.hitIdStagingBuffer?.destroy()
    this.hitIdBuffer = null
    this.hitIdStagingBuffer = null
    this.hitMap = null
  }
}
