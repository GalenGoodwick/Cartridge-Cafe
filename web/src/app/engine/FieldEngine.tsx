'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import { FieldRenderer } from './renderer'
import type { FieldEffectData } from './renderer'
import { FieldSimulation } from './simulation'
import { FieldInput } from './input'
import Toolbar from './Toolbar'
import PromptPanel from './PromptPanel'
import type { DialogEntry } from './AgentDialogPanel'
import AgentTerminalPanel from './AgentTerminalPanel'
import type { TerminalEntry } from './AgentTerminalPanel'
import type { BrushState, Camera, Field, FieldEffect, SelectionState, GenerationState, InteractionEffect, CameraFollow, HudElement, SuperFieldGPU } from './types'
import { DEFAULT_GRID_SIZE } from './types'
import { GameAudio } from './audio'
import SpaceManagementOverlay from './SpaceManagementOverlay'
import SpaceBreadcrumb from './SpaceBreadcrumb'
import { useToast } from '@/components/Toast'
// DEFAULT_FIELD_EFFECT_GLSL removed — fields are invisible until agents give them a shader

let fieldCounter = 0
function genFieldId() {
  return `field_${++fieldCounter}_${Date.now()}`
}

let effectCounter = 0
function genEffectId() {
  return `effect_${++effectCounter}_${Date.now()}`
}

// Reusable Set for per-frame interaction key cleanup (avoids allocation every frame)
const _reusableKeySet = new Set<string>()

/** Convert screen pixel coordinates to float grid coordinates (no flooring) */
function screenToGrid(
  screenX: number, screenY: number,
  canvasRect: DOMRect,
  camera: { x: number; y: number },
  zoom: number,
  gridSize: number = DEFAULT_GRID_SIZE
): { x: number; y: number } {
  const normX = (screenX - canvasRect.left) / canvasRect.width
  const normY = (screenY - canvasRect.top) / canvasRect.height
  const aspect = canvasRect.width / canvasRect.height
  const gridRange = gridSize / zoom

  if (aspect > 1) {
    return {
      x: camera.x + (normX - 0.5) * gridRange * aspect,
      y: camera.y + (normY - 0.5) * gridRange,
    }
  } else {
    return {
      x: camera.x + (normX - 0.5) * gridRange,
      y: camera.y + (normY - 0.5) * gridRange / aspect,
    }
  }
}

const DEFAULT_HUES = [190, 30, 120, 280, 0, 60, 330, 210]

function hueToRgba(hue: number): [number, number, number, number] {
  const h = hue / 360
  const s = 0.75
  const l = 0.6
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 1/6) { r = c; g = x }
  else if (h < 2/6) { r = x; g = c }
  else if (h < 3/6) { g = c; b = x }
  else if (h < 4/6) { g = x; b = c }
  else if (h < 5/6) { r = x; b = c }
  else { r = c; b = x }
  return [r + m, g + m, b + m, 1.0]
}

/** Wrap interaction WGSL for the field effect pipeline.
 *  Interaction shaders define `fn interactionEffect(coord, regionMin, regionMax, time, params) → vec4f`.
 *  This wrapper adapts it to `fn fieldEffect(...)` expected by the field pipeline. */
function wrapInteractionWgsl(interactionWgsl: string): string {
  return `
// Per-pixel overlap mask: 1.0 where both parent fields' dilated presence overlaps, 0.0 elsewhere.
fn overlapMask(coord: vec2f) -> f32 {
  return textureSample(fieldMask, texSampler, coord / frame.gridSize).r;
}

${interactionWgsl}

fn fieldEffect(coord: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let eff = interactionEffect(coord, regionMin, regionMax, time, params);
  let mask = overlapMask(coord);
  return vec4f(eff.rgb, eff.a * mask);
}`
}

interface FieldEngineProps {
  spaceId?: string
  spaceSlug?: string
  isOwner?: boolean
  /** View a historical save point instead of the live world (read-only demo mode) */
  versionView?: number
  /** Load this saved scene on mount and just play it — local sim, no server state, no chrome */
  playScene?: string
}

export default function FieldEngine({ spaceId, spaceSlug, isOwner, versionView, playScene }: FieldEngineProps = {}) {
  const { showToast } = useToast()

  useEffect(() => {
    const onFocus = () => { windowFocusedRef.current = true }
    const onBlur = () => { windowFocusedRef.current = false }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Every world carries instructions (worldData.instructions) behind a mandatory
  // top-right button — a world you can enter is a world you can learn.
  // Convention: key entry first (every input, one per line), then the point.
  const [instrOpen, setInstrOpen] = useState(false)
  const [instrEdit, setInstrEdit] = useState(false)
  const [instrDraft, setInstrDraft] = useState('')
  // ── branches: every world can be branched by anyone signed in; versions are
  // cut by the EYE — a watcher that snapshots each settled burst of AI edits ──
  const [me, setMe] = useState<string | null>(null)
  const [aiPulse, setAiPulse] = useState(0)
  const [plugOpen, setPlugOpen] = useState(false)
  const [plugToken, setPlugToken] = useState<string | null>(null)
  const [plugBusy, setPlugBusy] = useState(false)
  const lastSceneRef = useRef<string>('')
  const aiDirtyRef = useRef(false)
  const aiLastEditRef = useRef(0)
  const eyeCheckRef = useRef(0)
  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json())
      .then(s => setMe(s?.user?.email || s?.user?.name || null)).catch(() => {})
  }, [])
  // Focus throttle: a WATCHING viewer gets full rate (spectators give no input) —
  // only an unfocused-but-visible window drops to ~10fps. Hidden tabs pause free (rAF).
  const windowFocusedRef = useRef(typeof document !== 'undefined' ? document.hasFocus() : true)
  // Lossless frame memoization: fingerprint of everything the pixels depend on
  const frameFingerprintRef = useRef('')
  // SSE liveness: last time the agent stream said anything (pings count)
  const lastSSEMsgRef = useRef(Date.now())
  const lastParticleRef = useRef(0)
  const rendererRef = useRef<FieldRenderer | null>(null)
  const simulationRef = useRef<FieldSimulation | null>(null)
  const inputRef = useRef<FieldInput | null>(null)
  const animFrameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  const lastFrameRef = useRef<number>(0)
  const lastSampleTimeRef = useRef<number>(0)
  const lastPresenceRef = useRef<number>(0)
  const cachedOverlapMasksRef = useRef<Map<string, Uint8Array>>(new Map())
  const renderedSamplesRef = useRef<Map<string, { width: number; height: number; pixels: number[] }>>(new Map())
  // Hook-initiated room transitions: hooks set worldData.__loadScene = 'Name';
  // the frame loop consumes it via this ref (assigned before the render loop starts)
  const loadSceneRef = useRef<((name: string) => void) | null>(null)

  // WGSL mods — reusable shader utilities registered by agents
  const wgslModsRef = useRef<Map<string, { id: string; code: string }>>(new Map())

  // Track which fields have had their step state initialized on GPU (don't re-upload every frame)
  const stepStateInitializedRef = useRef<Set<string>>(new Set())


  // Camera follow mode
  const cameraFollowRef = useRef<CameraFollow | null>(null)

  // Audio system
  const audioRef = useRef<GameAudio>(new GameAudio())

  // HUD elements (driven by worldData['hud'])
  const hudContainerRef = useRef<HTMLDivElement>(null)
  const hudElementCacheRef = useRef<Map<string, HTMLElement>>(new Map())
  const nameToIdRef = useRef<Map<string, string>>(new Map())
  const lastFieldCountRef = useRef<number>(0)

  // Camera
  const gridSize = DEFAULT_GRID_SIZE
  const cameraRef = useRef<Camera>({ x: gridSize / 2, y: gridSize / 2, zoom: 1 })
  const [, forceUpdate] = useState(0)

  // 2D/3D render mode
  // 3D mode removed: the superimposed 2D path carries full 3D via raymarched
  // visuals (see the scene library) — a second pipeline was pure overhead.
  const renderMode = '2d' as const
  const renderModeRef = useRef<'2d' | '3d'>('2d')
  const camera3DRef = useRef({ pos: [gridSize / 2, gridSize / 2, 150] as [number, number, number], pitch: -0.6, yaw: 0, fov: 1.047 })
  const isOrbiting = useRef(false)

  // Brush state
  const [brush, setBrush] = useState<BrushState>({
    tool: 'brush',
    size: 4,
    activeFieldId: null,
  })

  // Fields (mirrored from simulation for React rendering)
  const [fields, setFields] = useState<Map<string, Field>>(new Map())
  const [running, setRunning] = useState(false)

  // Selection state
  const [selection, setSelection] = useState<SelectionState>({
    selectedFieldId: null,
    selectionMask: new Uint8Array(DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE),
  })

  // Designer sidebar state
  const [terminalOpen, setTerminalOpen] = useState(false)
  // WebGPU unavailable or lost — show a human answer, not a black void
  const [gpuFailed, setGpuFailed] = useState(false)

  // World mode: the world is just the world — editor chrome hides behind a toggle
  const [chromeVisible, setChromeVisible] = useState(!spaceId && !playScene)

  // Saved scenes list (server-side persistent)
  const [savedScenes, setSavedScenes] = useState<string[]>([])
  // Writer lease: this tab's identity for global-world sync. When another
  // session holds the lease, our syncs 409 and we go read-only (worldLocked).
  const clientIdRef = useRef(`tab_${Math.random().toString(36).slice(2, 10)}`)
  const takeoverRef = useRef(false)
  const [worldLocked, setWorldLocked] = useState(false)

  // Generation state — UI-only loading tracker, WGSL lives on Field objects
  const [generation, setGeneration] = useState<GenerationState>({
    loading: false,
    error: null,
    targetFieldId: null,
  })

  // Pointer state for panning (Space + drag to pan)
  const pointerDown = useRef(false)
  const isPanning = useRef(false)
  const spaceHeld = useRef(false)
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Drag state for fields
  const draggingFieldId = useRef<string | null>(null)
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragStartScreen = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Pixel hover tooltip
  const [pixelInfo, setPixelInfo] = useState<{
    screenX: number; screenY: number
    gridX: number; gridY: number
    r: number; g: number; b: number; a: number
    fields: string[]
  } | null>(null)
  const pixelInfoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Get concatenated WGSL mod code from all registered mods */
  const getModCode = useCallback((): string | undefined => {
    const mods = wgslModsRef.current
    if (mods.size === 0) return undefined
    return Array.from(mods.values()).map(m => m.code).join('\n')
  }, [])

  // Sync fields from simulation to React state
  const syncFields = useCallback(() => {
    const sim = simulationRef.current
    if (!sim) return
    setFields(new Map(sim.fields))
  }, [])

  // Update selection mask and upload to GPU
  const updateSelectionMask = useCallback((fieldId: string | null) => {
    const renderer = rendererRef.current
    if (!renderer) return
    const mask = new Uint8Array(gridSize * gridSize)
    renderer.uploadSelectionData(mask)
    setSelection({ selectedFieldId: fieldId, selectionMask: mask })
  }, [])

  // No default shader — fields are invisible until an agent adds an effect

  // Create field
  const handleCreateField = useCallback(() => {
    const sim = simulationRef.current
    if (!sim) return
    const id = genFieldId()
    const hue = DEFAULT_HUES[sim.fields.size % DEFAULT_HUES.length]
    const color = hueToRgba(hue)
    const name = `Field ${sim.fields.size + 1}`
    sim.createField(id, name, color)

    setBrush(prev => ({ ...prev, activeFieldId: id }))
    syncFields()
  }, [syncFields])

  // Delete field — removes all effects
  const handleDeleteField = useCallback((id: string) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim) return

    // Remove all effect programs for this field
    if (renderer) renderer.removeAllFieldEffects(id)

    sim.removeField(id)
    if (selection.selectedFieldId === id) {
      updateSelectionMask(null)
    }
    setBrush(prev => {
      if (prev.activeFieldId === id) {
        const remaining = Array.from(sim.fields.keys())
        return { ...prev, activeFieldId: remaining[0] || null }
      }
      return prev
    })
    syncFields()
  }, [syncFields, selection.selectedFieldId, updateSelectionMask])

  // Broadcast the player's focus to connected agents: the current selection rides
  // the snapshot sync into worldData, so a world's AI can follow the player's target.
  useEffect(() => {
    const sim = simulationRef.current
    if (!sim) return
    if (selection.selectedFieldId) {
      const f = sim.fields.get(selection.selectedFieldId)
      sim.worldData['player_focus'] = {
        fieldId: selection.selectedFieldId,
        fieldName: f?.name || null,
        at: Date.now(),
      }
    } else {
      delete sim.worldData['player_focus']
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.selectedFieldId])

  // Select field (toolbar click)
  const handleSelectField = useCallback((id: string) => {
    setBrush(prev => ({ ...prev, activeFieldId: id }))
    updateSelectionMask(id)
  }, [updateSelectionMask])

  // Save field + children to library (explicit action via button)
  const handleSaveToLibrary = useCallback((fieldId: string) => {
    const sim = simulationRef.current
    if (!sim) return
    const field = sim.fields.get(fieldId)
    if (!field) return
    const allSnaps = sim.generateSnapshots()
    const snap = allSnaps.find(s => s.id === fieldId)
    if (!snap) return
    const groupIds = new Set<string>([fieldId])
    let changed = true
    while (changed) {
      changed = false
      for (const s of allSnaps) {
        if (s.parentFieldId && groupIds.has(s.parentFieldId) && !groupIds.has(s.id)) {
          groupIds.add(s.id)
          changed = true
        }
      }
    }
    const groupSnaps = allSnaps.filter(s => groupIds.has(s.id))
    try {
      const existing: unknown[] = JSON.parse(localStorage.getItem('fieldLibrary') || '[]')
      const filtered = existing.filter((f: unknown) => !groupIds.has((f as { id: string }).id))
      filtered.push(...groupSnaps)
      localStorage.setItem('fieldLibrary', JSON.stringify(filtered))
      const childCount = groupSnaps.length - 1
      const label = childCount > 0 ? `"${field.name}" + ${childCount} children` : `"${field.name}"`
      showToast(`Saved ${label} to library`, 'success')
    } catch { /* ignore */ }
  }, [showToast])

  // Refresh saved scenes list from server
  const refreshSceneList = useCallback(async () => {
    try {
      const resp = await fetch('/api/engine/scene?action=list')
      const { scenes } = await resp.json()
      const next = Array.isArray(scenes) ? scenes : []
      // Only touch state when the list actually changed — this refresh polls
      setSavedScenes(prev => (prev.length === next.length && prev.every((n, i) => n === next[i])) ? prev : next)
    } catch { /* ignore */ }
  }, [])

  // Save entire scene (all fields, effects, rules, hooks, world params)
  /** Snapshot the live world under a given name — the branch/version writer */
  const saveSceneAs = useCallback(async (sceneName: string) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim) return false
    const sceneData = {
      name: sceneName,
      fields: sim.generateSnapshots(),
      worldParams: sim.getWorldParams(),
      worldData: { ...sim.worldData },
      stepHooks: sim.getStepHookSnapshots(),
      interactionRules: [...sim.interactionRules],
      interactionEffects: [...sim.interactionEffects],
      visualTypes: renderer ? renderer.getAllVisualTypes().map(vt => ({ name: vt.name, wgsl: vt.wgsl })) : [],
      modules: renderer ? renderer.getAllModules().map(m => ({ name: m.name, wgsl: m.wgsl })) : [],
      timestamp: Date.now(),
    }
    // no blank submissions — a branch version must contain a world
    if (!sceneData.fields.length && !sceneData.stepHooks.length && !sceneData.visualTypes.length) return false
    try {
      await fetch('/api/engine/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', name: sceneName, scene: sceneData }),
      })
      return true
    } catch { return false }
  }, [])

  /** BRANCH: signed-out → auth; signed-in → fork the current world as yours, v1 */
  const handleBranch = useCallback(async () => {
    if (!me) { window.location.href = '/auth/signin'; return }
    const src = lastSceneRef.current || playScene || ''
    if (!src) { showToast('load a world first', 'error'); return }
    const base = src.split(' ⑂ ')[0]
    const user = me.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
    const name = `${base} ⑂ ${user} · v1`
    if (await saveSceneAs(name)) {
      lastSceneRef.current = name
      showToast(`branch opened: ${name} — the eye is watching`, 'success')
      setPlugOpen(true)   // a branch without an AI is a car without keys
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, playScene, saveSceneAs])

  const handleSaveScene = useCallback(async () => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim) return
    const name = window.prompt('Scene name:')
    if (!name?.trim()) return
    const sceneName = name.trim()
    const sceneData = {
      name: sceneName,
      fields: sim.generateSnapshots(),
      worldParams: sim.getWorldParams(),
      worldData: { ...sim.worldData },
      stepHooks: sim.getStepHookSnapshots(),
      interactionRules: [...sim.interactionRules],
      interactionEffects: [...sim.interactionEffects],
      visualTypes: renderer ? renderer.getAllVisualTypes().map(vt => ({ name: vt.name, wgsl: vt.wgsl })) : [],
      modules: renderer ? renderer.getAllModules().map(m => ({ name: m.name, wgsl: m.wgsl })) : [],
      timestamp: Date.now(),
    }
    try {
      await fetch('/api/engine/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', name: sceneName, scene: sceneData }),
      })
      showToast(`Scene "${sceneName}" saved (${sceneData.fields.length} fields)`, 'success')
      refreshSceneList()
    } catch {
      showToast('Failed to save scene', 'error')
    }
  }, [showToast, refreshSceneList])

  // Load a saved scene (replaces current state)
  const handleLoadScene = useCallback(async (sceneName: string) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim || !renderer) return
    lastSceneRef.current = sceneName
    try {
      const resp = await fetch(`/api/engine/scene?name=${encodeURIComponent(sceneName)}`)
      const { scene } = await resp.json()
      if (!scene) { showToast(`Scene "${sceneName}" not found`, 'error'); return }

      // Clear current state
      for (const field of sim.fields.values()) {
        renderer.removeAllFieldEffects(field.id)
      }
      for (const key of Array.from(renderer.getFieldEffectKeys())) {
        if (key.startsWith('ix_')) { renderer.removeFieldEffect(key); renderer.removeFieldMask(key) }
      }
      sim.clearAll()
      sim.fields.clear()
      sim.interactionRules = []
      sim.interactionEffects = []
      sim.stepHooks.clear()
      sim.tweens.clear()
      sim.timers.clear()
      sim.collisionCallbacks.clear()
      cachedOverlapMasksRef.current = new Map()

      // A scene is a complete world — reset the shader registries so visuals
      // from previously loaded scenes don't accumulate forever (every stale
      // visual bloats the uber-shader and slows each recompile).
      renderer.clearRegistries()

      // Restore visual types and modules first (before fields that reference them)
      if (scene.visualTypes) {
        for (const vt of scene.visualTypes) {
          renderer.registerVisualType(vt.name, vt.wgsl)
        }
      }
      if (scene.modules) {
        for (const m of scene.modules) {
          renderer.registerModule(m.name, m.wgsl)
        }
      }

      // Restore scene
      sim.restoreFromSnapshots(scene.fields || [])
      // Name is authoritative — resolve visual types against this session's
      // registry (numeric IDs shift between sessions)
      for (const field of sim.fields.values()) {
        if (field.visualTypeName) {
          const runtimeId = renderer.resolveVisualType(field.visualTypeName)
          if (runtimeId !== undefined) field.visualType = runtimeId
        }
      }
      if (scene.worldParams) sim.setWorldParams(scene.worldParams)
      if (scene.worldData) Object.assign(sim.worldData, scene.worldData)
      // Transient input state must never arrive via a scene
      for (const k of Object.keys(sim.worldData)) {
        if (k.startsWith('key_') || k.startsWith('mouse_')) delete sim.worldData[k]
      }
      if (scene.interactionRules) sim.interactionRules = scene.interactionRules
      if (scene.interactionEffects) {
        for (const ie of scene.interactionEffects) sim.addInteractionEffect(ie)
      }
      if (scene.stepHooks) {
        for (const h of scene.stepHooks) sim.addStepHook(h.id, h.author, h.description, h.code)
        // A scene with logic should boot running (game cartridges)
        if (scene.stepHooks.length > 0 && !sim.running) {
          sim.running = true
          setRunning(true)
        }
      }

      // Recompile effects
      for (const field of sim.fields.values()) {
        for (const effect of field.effects) {
          const programKey = `${field.id}_${effect.id}`
          await renderer.compileFieldEffect(programKey, field.id, effect.wgsl, getModCode())
        }
      }

      updateSelectionMask(null)
      syncFields()
      showToast(`Scene "${sceneName}" loaded (${scene.fields?.length || 0} fields)`, 'success')
    } catch {
      showToast(`Failed to load "${sceneName}"`, 'error')
    }
  }, [showToast, getModCode, syncFields, updateSelectionMask])

  // Delete a saved scene
  const handleDeleteScene = useCallback(async (sceneName: string) => {
    try {
      await fetch('/api/engine/scene', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sceneName }),
      })
      showToast(`Scene "${sceneName}" deleted`, 'success')
      refreshSceneList()
    } catch {
      showToast(`Failed to delete "${sceneName}"`, 'error')
    }
  }, [showToast, refreshSceneList])

  // Play mode: the screen, heard. Every ~600ms sample the rendered frame at
  // 8x8 and dispatch its mood (brightness, warmth, busy-ness) for the audio
  // layer. Skipped when the tab is hidden.
  useEffect(() => {
    if (!playScene) return
    let stop = false
    const tick = async () => {
      if (stop) return
      const renderer = rendererRef.current
      if (renderer && !document.hidden) {
        try {
          const mood = await renderer.sampleMood(8)
          if (mood) window.dispatchEvent(new CustomEvent('cafe:mood', { detail: mood }))
        } catch { /* readback is best-effort */ }
      }
      if (!stop) setTimeout(tick, 600)
    }
    const t = setTimeout(tick, 1500)
    return () => { stop = true; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene])

  // Play mode: the shell can freeze the world (back-button confirm dialog)
  useEffect(() => {
    if (!playScene) return
    const onPause = (e: Event) => {
      const sim = simulationRef.current
      if (sim) sim.running = !(e as CustomEvent).detail
    }
    window.addEventListener('cafe:pause', onPause)
    return () => window.removeEventListener('cafe:pause', onPause)
  }, [playScene])

  // Play mode and spaces: the world IS the screen. Fit the 512 grid to the
  // viewport (contain: the whole world visible, void beyond it) on mount and
  // resize. zoom is world-cells-per-short-axis (gridRange = gridSize / zoom),
  // resolution-independent — contain is zoom = 1 on every screen; the old
  // Math.min(w,h)/gridSize treated zoom as pixels-per-cell and cropped ~40%
  // on any viewport taller than the grid.
  useEffect(() => {
    if (!playScene && !spaceId) return
    const fit = () => {
      cameraRef.current.x = gridSize / 2
      cameraRef.current.y = gridSize / 2
      cameraRef.current.zoom = 1
    }
    fit()
    const t = setTimeout(fit, 300)   // after the canvas settles
    window.addEventListener('resize', fit)
    return () => { clearTimeout(t); window.removeEventListener('resize', fit) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene, spaceId])

  // Play mode: load a saved scene into the local sim and run it.
  // Reacts to playScene changes — the world swaps in place (portal travel).
  const playLoadedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!playScene || playLoadedRef.current === playScene) return
    const prevScene = playLoadedRef.current
    playLoadedRef.current = playScene

    const loadPlayScene = async () => {
      const sim = simulationRef.current
      const renderer = rendererRef.current
      if (!sim || !renderer) { setTimeout(loadPlayScene, 500); return }
      try {
        // save data survives the swap: stash the departing scene's game state
        // (the __-prefixed worldData blobs) so re-entering a game resumes it
        if (prevScene) {
          const stash: Record<string, unknown> = {}
          for (const k of Object.keys(sim.worldData)) {
            if (k.startsWith('__')) stash[k] = sim.worldData[k]
          }
          try { localStorage.setItem(`cc-save-${prevScene}`, JSON.stringify(stash)) } catch { /* full/blocked */ }
        }

        // teardown the previous scene COMPLETELY — restoreFromSnapshots only
        // adds, so every old field must be removed by hand
        for (const id of Array.from(sim.fields.keys())) {
          renderer.removeAllFieldEffects(id)
          sim.removeField(id)
        }
        sim.stepHooks.clear()
        sim.interactionRules = []
        sim.interactionEffects = []
        for (const k of Object.keys(sim.worldData)) delete sim.worldData[k]
        frameFingerprintRef.current = ''
        // every world opens with a fresh eye — a zoom left over from another
        // scene must not follow the player through the door. CONTAIN, not cover:
        // the whole world at max size in the viewport; letterbox is honest,
        // cropping is not (a wide monitor was losing 40% of every scene).
        cameraRef.current = { x: gridSize / 2, y: gridSize / 2, zoom: 1 }

        // house cartridges ship as static files (CDN, stateless-server-proof);
        // the store API is the fallback for locally saved scenes
        let resp = await fetch(`/cartridges/${encodeURIComponent(playScene)}.json`)
        if (!resp.ok) resp = await fetch(`/api/engine/scene?name=${encodeURIComponent(playScene)}`)
        const data = await resp.json()
        const scene = data.scene || data
        if (!scene || !scene.fields) return
        if (scene.visualTypes) for (const vt of scene.visualTypes) renderer.registerVisualType(vt.name, vt.wgsl)
        if (scene.modules) for (const m of scene.modules) renderer.registerModule(m.name, m.wgsl)
        sim.restoreFromSnapshots(scene.fields || [])
        for (const field of sim.fields.values()) {
          if (field.visualTypeName) {
            const runtimeId = renderer.resolveVisualType(field.visualTypeName)
            if (runtimeId !== undefined) field.visualType = runtimeId
          }
        }
        if (scene.worldParams) sim.setWorldParams(scene.worldParams)
        if (scene.worldData) Object.assign(sim.worldData, scene.worldData)
        // resume: this scene's stashed save data (best scores, builds) returns
        try {
          const stash = localStorage.getItem(`cc-save-${playScene}`)
          if (stash) Object.assign(sim.worldData, JSON.parse(stash))
        } catch { /* no save, no problem */ }
        // session-start signal: hooks reset per-session state (timers, key latches)
        // while keeping restored save data
        sim.worldData.__fresh = true
        for (const k of Object.keys(sim.worldData)) {
          if (k.startsWith('key_') || k.startsWith('mouse_')) delete sim.worldData[k]
        }
        if (scene.interactionRules) sim.interactionRules = scene.interactionRules
        if (scene.interactionEffects) for (const ie of scene.interactionEffects) sim.addInteractionEffect(ie)
        if (scene.stepHooks) for (const h of scene.stepHooks) sim.addStepHook(h.id, h.author, h.description, h.code)
        sim.running = true
        setRunning(true)
        syncFields()
      } catch (err) {
        console.error('Failed to load play scene:', err)
      }
    }
    loadPlayScene()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene])

  // Load space snapshot on mount (for space mode)
  const spaceLoadedRef = useRef(false)
  useEffect(() => {
    if (!spaceSlug || spaceLoadedRef.current) return
    spaceLoadedRef.current = true

    const loadSpaceSnapshot = async () => {
      const sim = simulationRef.current
      const renderer = rendererRef.current
      if (!sim || !renderer) {
        // Retry after renderer initializes
        setTimeout(loadSpaceSnapshot, 500)
        return
      }

      try {
        const versionQ = versionView ? `?version=${versionView}` : ''
        const resp = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/snapshot${versionQ}`)
        const { snapshot } = await resp.json()
        if (!snapshot) return // Empty space — blank canvas

        // Restore visual types and modules first
        if (snapshot.visualTypes) {
          for (const vt of snapshot.visualTypes) {
            renderer.registerVisualType(vt.name, vt.wgsl)
          }
        }
        if (snapshot.modules) {
          for (const m of snapshot.modules) {
            renderer.registerModule(m.name, m.wgsl)
          }
        }

        // Restore fields and state
        sim.restoreFromSnapshots(snapshot.fields || [])

        // Resolve visualTypeName → numeric visualType from runtime registry.
        // The name is authoritative: numeric IDs are assigned per renderer
        // session, so a stored numeric can point at a different visual type
        // after a reload. Always re-resolve when a name is present.
        for (const field of sim.fields.values()) {
          if (field.visualTypeName) {
            const runtimeId = renderer.resolveVisualType(field.visualTypeName)
            if (runtimeId !== undefined) field.visualType = runtimeId
          }
        }

        if (snapshot.worldParams) sim.setWorldParams(snapshot.worldParams)
        if (snapshot.worldData) Object.assign(sim.worldData, snapshot.worldData)
        // Transient input state must never survive a restore (stuck ghost keys)
        for (const k of Object.keys(sim.worldData)) {
          if (k.startsWith('key_') || k.startsWith('mouse_')) delete sim.worldData[k]
        }
        if (snapshot.interactionRules) sim.interactionRules = snapshot.interactionRules
        if (snapshot.interactionEffects) {
          for (const ie of snapshot.interactionEffects) sim.addInteractionEffect(ie)
        }
        if (snapshot.stepHooks) {
          for (const h of snapshot.stepHooks) sim.addStepHook(h.id, h.author, h.description, h.code)
        }

        // Recompile effects
        for (const field of sim.fields.values()) {
          for (const effect of field.effects) {
            const programKey = `${field.id}_${effect.id}`
            await renderer.compileFieldEffect(programKey, field.id, effect.wgsl, getModCode())
          }
        }

        syncFields()
      } catch (err) {
        console.error('Failed to load space snapshot:', err)
      }
    }

    loadSpaceSnapshot()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceSlug])

  // Change field color — just update color, shader uses params
  const handleFieldColorChange = useCallback((id: string, color: [number, number, number, number]) => {
    const sim = simulationRef.current
    if (!sim) return
    const field = sim.fields.get(id)
    if (!field) return
    field.color = color
    syncFields()
  }, [syncFields])

  // Toggle simulation
  const handleToggleRunning = useCallback(() => {
    const sim = simulationRef.current
    if (!sim) return
    sim.running = !sim.running
    setRunning(sim.running)
  }, [])

  // Clear all — removes all effects from all fields
  const handleClear = useCallback(() => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim) return

    // Remove all field effects
    if (renderer) {
      for (const field of sim.fields.values()) {
        renderer.removeAllFieldEffects(field.id)
      }
    }

    sim.clearAll()
    // Clear effects from all fields
    for (const field of sim.fields.values()) {
      field.effects = []
    }
    updateSelectionMask(null)
    setGeneration({ loading: false, error: null, targetFieldId: null })
    syncFields()
  }, [syncFields, updateSelectionMask])

  // Generate AI effect for selected field
  const handleGenerate = useCallback(async (prompt: string) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim || !renderer || !selection.selectedFieldId) return

    const targetFieldId = selection.selectedFieldId
    setGeneration({ loading: true, error: null, targetFieldId })

    try {
      const bounds = sim.getFieldBounds(targetFieldId)

      const res = await fetch('/api/engine/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, bounds, fieldId: targetFieldId }),
      })

      const data = await res.json()

      if (!res.ok) {
        setGeneration({ loading: false, error: data.error || 'Generation failed', targetFieldId })
        return
      }

      // Add as an effect
      const effectId = genEffectId()
      const programKey = `${targetFieldId}_${effectId}`
      const result = await renderer.compileFieldEffect(programKey, targetFieldId, data.wgsl, getModCode())

      if (result.success) {
        const effect: FieldEffect = {
          id: effectId,
          author: 'user',
          wgsl: data.wgsl,
          description: data.description || 'AI generated',
          blend: 'alpha',
          order: 10,
        }
        sim.addFieldEffect(targetFieldId, effect)

        setGeneration({ loading: false, error: null, targetFieldId: null })
        syncFields()
      } else {
        setGeneration({
          loading: false,
          error: `Shader compile error: ${result.error}`,
          targetFieldId,
        })
      }
    } catch (err) {
      setGeneration({
        loading: false,
        error: err instanceof Error ? err.message : 'Network error',
        targetFieldId,
      })
    }
  }, [selection.selectedFieldId, syncFields])

  // Clear effect for a specific field (or selected field)
  const handleClearEffect = useCallback((targetId?: string) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim || !renderer) return

    const fieldId = targetId || selection.selectedFieldId
    if (!fieldId) return

    renderer.removeAllFieldEffects(fieldId)
    const field = sim.fields.get(fieldId)
    if (field) {
      field.effects = []
    }
    setGeneration({ loading: false, error: null, targetFieldId: null })
    syncFields()
  }, [selection.selectedFieldId, syncFields])

  // Pointer handlers — canvas is view-only (agents do the painting)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current
    const sim = simulationRef.current
    if (!canvas) return

    pointerDown.current = true
    lastPointer.current = { x: e.clientX, y: e.clientY }

    // A still press must be visible to hooks (the Held Sun pattern): write
    // mouse_down on DOWN, not only in the move handler — real fingers tremble,
    // automated and deliberate ones don't.
    if (sim) {
      const rect0 = canvas.getBoundingClientRect()
      const cam0 = cameraRef.current
      const grid0 = screenToGrid(e.clientX, e.clientY, rect0, cam0, cam0.zoom)
      sim.worldData['mouse_x'] = grid0.x
      sim.worldData['mouse_y'] = grid0.y
      sim.worldData['mouse_down'] = true
      // pulse counter — a click shorter than one sim frame still lands once
      sim.worldData['mouse_down_n'] = ((sim.worldData['mouse_down_n'] as number) || 0) + 1
    }

    // 3D mode: right-click or alt+click = orbit camera
    if (renderModeRef.current === '3d' && (e.button === 2 || e.altKey)) {
      isOrbiting.current = true
      canvas.style.cursor = 'grab'
      return
    }

    // Space + click = pan camera
    if (spaceHeld.current) {
      isPanning.current = true
      canvas.style.cursor = 'grabbing'
      return
    }

    // Play mode: the pointer belongs to the game (hooks read mouse_*).
    // Never start a field drag — a full-canvas game field would ride the
    // cursor and pull the whole scene with it.
    if (playScene) return

    // Hit-test: check if pointer is over a field
    if (sim) {
      const rect = canvas.getBoundingClientRect()
      const camera = cameraRef.current
      const grid = screenToGrid(e.clientX, e.clientY, rect, camera, camera.zoom)
      const hitField = sim.getFieldAtPoint(grid.x, grid.y)

      if (hitField) {
        // Walk up to root parent so dragging a child moves the whole group
        let dragTarget = hitField
        while (dragTarget.parentFieldId) {
          const parent = sim.fields.get(dragTarget.parentFieldId)
          if (!parent) break
          dragTarget = parent
        }
        draggingFieldId.current = dragTarget.id
        dragOffset.current = {
          x: dragTarget.transform.x - grid.x,
          y: dragTarget.transform.y - grid.y,
        }
        dragStartScreen.current = { x: e.clientX, y: e.clientY }
        canvas.style.cursor = 'grabbing'
        return
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const input = inputRef.current
    const canvas = canvasRef.current
    if (!input || !canvas) return

    const rect = canvas.getBoundingClientRect()
    const camera = cameraRef.current

    // Track mouse grid position for step hooks and agents
    const sim = simulationRef.current
    const gridPos = input.screenToCell(e.clientX, e.clientY, rect, camera, camera.zoom)
    if (sim) {
      sim.worldData['mouse_x'] = gridPos.x
      sim.worldData['mouse_y'] = gridPos.y
      sim.worldData['mouse_down'] = pointerDown.current
    }

    // Dragging a field — update its position and skip panning
    if (draggingFieldId.current && sim) {
      const grid = screenToGrid(e.clientX, e.clientY, rect, camera, camera.zoom)
      const newX = grid.x + dragOffset.current.x
      const newY = grid.y + dragOffset.current.y
      sim.setPosition(draggingFieldId.current, newX, newY)
      // Zero out velocity so physics doesn't fight the drag
      const field = sim.fields.get(draggingFieldId.current)
      if (field) {
        field.transform.vx = 0
        field.transform.vy = 0
      }
      syncFields()
      return
    }

    // Pixel hover tooltip (throttled)
    if (!pointerDown.current) {
      if (pixelInfoTimeout.current) clearTimeout(pixelInfoTimeout.current)
      pixelInfoTimeout.current = setTimeout(() => {
        const renderer = rendererRef.current
        if (!renderer?.device || !sim) { setPixelInfo(null); return }
        const gx = Math.floor(gridPos.x)
        const gy = Math.floor(gridPos.y)
        if (gx < 0 || gx >= gridSize || gy < 0 || gy >= gridSize) { setPixelInfo(null); return }

        // Read color from CPU-side colorData (avoids GPU readback for tooltip)
        const idx = (gy * gridSize + gx) * 4
        const cd = sim.world.colorData
        const r = Math.round(cd[idx] * 255)
        const g = Math.round(cd[idx + 1] * 255)
        const b = Math.round(cd[idx + 2] * 255)
        const a = Math.round(cd[idx + 3] * 255)

        // Use pixel-perfect presence data for field identification
        const fieldIds = sim.getFieldsAtPixel(gx, gy)
        const fieldsHere = fieldIds.map(id => sim.fields.get(id)?.name).filter(Boolean) as string[]

        setPixelInfo({
          screenX: e.clientX, screenY: e.clientY,
          gridX: gx, gridY: gy,
          r, g, b, a,
          fields: fieldsHere,
        })
      }, 50)
    } else {
      setPixelInfo(null)
    }

    if (!pointerDown.current) return

    // 3D orbit
    if (isOrbiting.current) {
      const dx = e.clientX - lastPointer.current.x
      const dy = e.clientY - lastPointer.current.y
      const cam3D = camera3DRef.current
      cam3D.yaw += dx * 0.005
      cam3D.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cam3D.pitch - dy * 0.005))
      lastPointer.current = { x: e.clientX, y: e.clientY }
      forceUpdate(n => n + 1)
      return
    }

    if (!isPanning.current) return

    const dx = e.clientX - lastPointer.current.x
    const dy = e.clientY - lastPointer.current.y
    const delta = input.screenDeltaToGridDelta(dx, dy, rect, camera.zoom)

    // bound the grid to the viewport: the camera center never leaves the
    // world, so at most half the view can be void in any direction
    camera.x = Math.max(0, Math.min(gridSize, camera.x - delta.dx))
    camera.y = Math.max(0, Math.min(gridSize, camera.y - delta.dy))
    lastPointer.current = { x: e.clientX, y: e.clientY }
  }, [syncFields])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // release must be visible to hooks even without a final move event
    { const simUp = simulationRef.current; if (simUp) simUp.worldData['mouse_down'] = false }
    if (draggingFieldId.current) {
      const sim = simulationRef.current
      const fieldId = draggingFieldId.current
      const dx = e.clientX - dragStartScreen.current.x
      const dy = e.clientY - dragStartScreen.current.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      draggingFieldId.current = null
      pointerDown.current = false
      const canvas = canvasRef.current
      if (canvas) canvas.style.cursor = 'grab'

      // Click (not drag) — select this field (highlight in list + inspector)
      if (dist < 5 && sim) {
        const field = sim.fields.get(fieldId)
        if (field) {
          // Portal navigation — click portal to enter target space
          const portalTarget = field.properties.get('portalTarget') as string | undefined
          if (portalTarget && field.properties.get('portalType') === 'space') {
            window.location.href = `/space/${portalTarget}`
            return
          }
          setBrush(prev => ({ ...prev, activeFieldId: fieldId }))
          updateSelectionMask(fieldId)
        }
      } else {
        syncFields()
      }
      return
    }

    // Click on empty canvas (not pan, not field drag) — deselect
    if (!isPanning.current && pointerDown.current) {
      setBrush(prev => ({ ...prev, activeFieldId: null }))
      updateSelectionMask(null)
    }
    isPanning.current = false
    isOrbiting.current = false
    pointerDown.current = false
    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = 'grab'
  }, [syncFields, updateSelectionMask])

  // Wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (renderModeRef.current === '3d') {
        // 3D mode: dolly camera along view direction
        const cam3D = camera3DRef.current
        const dollySpeed = 5
        const delta = e.deltaY > 0 ? dollySpeed : -dollySpeed
        // Move along view direction
        const cp = Math.cos(cam3D.pitch), sp = Math.sin(cam3D.pitch)
        const cy = Math.cos(cam3D.yaw), sy = Math.sin(cam3D.yaw)
        cam3D.pos[0] += -sy * cp * delta
        cam3D.pos[1] += sp * delta
        cam3D.pos[2] += -cy * cp * delta
        forceUpdate(n => n + 1)
        return
      }
      const camera = cameraRef.current
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
      camera.zoom = Math.max(0.5, Math.min(8, camera.zoom * zoomFactor))
      forceUpdate(n => n + 1)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // Keyboard input — writes key states into sim.worldData for step hooks
  useEffect(() => {
    const keyMap: Record<string, string> = {
      ArrowLeft: 'key_left', ArrowRight: 'key_right', ArrowUp: 'key_up', ArrowDown: 'key_down',
      ' ': 'key_space', Enter: 'key_enter', Shift: 'key_shift', Backspace: 'key_backspace',
    }
    // the whole alphabet — worlds that listen to language need every letter
    for (let c = 97; c <= 122; c++) keyMap[String.fromCharCode(c)] = 'key_' + String.fromCharCode(c)
    const onKeyDown = (e: KeyboardEvent) => {
      const sim = simulationRef.current
      if (!sim) return
      if (e.key === ' ') spaceHeld.current = true
      const mapped = keyMap[e.key] ?? keyMap[e.key.toLowerCase()]
      if (mapped) {
        sim.worldData[mapped] = true
        // pulse counter — a tap shorter than one sim frame still registers once
        sim.worldData[mapped + '_n'] = ((sim.worldData[mapped + '_n'] as number) || 0) + 1
        // Prevent arrow keys from scrolling
        if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const sim = simulationRef.current
      if (!sim) return
      if (e.key === ' ') spaceHeld.current = false
      const mapped = keyMap[e.key] ?? keyMap[e.key.toLowerCase()]
      if (mapped) {
        sim.worldData[mapped] = false
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Initialize engine
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new FieldRenderer(gridSize)
    const sim = new FieldSimulation(gridSize)
    const input = new FieldInput(gridSize)

    rendererRef.current = renderer
    simulationRef.current = sim
    inputRef.current = input

    let cancelled = false

    async function initEngine() {
    let ok = await renderer.init(canvas!)
    if (!ok && !cancelled) {
      // transient device loss (tab remounts, GPU pressure) — one retry earns a lot
      await new Promise(r => setTimeout(r, 700))
      ok = await renderer.init(canvas!)
    }
    if (!ok || cancelled) {
      console.error('Failed to initialize WebGPU renderer')
      if (!cancelled) setGpuFailed(true)
      return
    }

    // Upload initial empty textures
    renderer.uploadColorData(sim.world.colorData)
    renderer.uploadStateData(sim.world.stateData)
    renderer.uploadSelectionData(new Uint8Array(gridSize * gridSize))

    startTimeRef.current = performance.now() / 1000
    lastFrameRef.current = performance.now()

    // Restore state from server, or create initial field.
    // Space mode restores from its own snapshot effect — pulling the GLOBAL
    // state here would layer global fields on top of the space's world.
    try {
      const data = (spaceId || spaceSlug || playScene)
        ? {}
        : await fetch('/api/engine/state').then(r => r.json())
      if (cancelled) return
      const snaps = data.fields || []
      if (snaps.length > 0) {
        sim.restoreFromSnapshots(snaps)
        if (data.worldParams) sim.setWorldParams(data.worldParams)

        // Restore WGSL mods BEFORE compiling effects (effects may use mod functions)
        if (Array.isArray(data.wgslMods || data.glslMods)) {
          for (const mod of (data.wgslMods || data.glslMods)) {
            if (mod.id && mod.code) {
              wgslModsRef.current.set(mod.id, { id: mod.id, code: mod.code })
            }
          }
        }

        // Restore visual types for superimposed uber-shader
        if (Array.isArray(data.visualTypes)) {
          for (const vt of data.visualTypes) {
            if (vt.name && vt.wgsl) {
              renderer.registerVisualType(vt.name, vt.wgsl)
            }
          }
        }

        // Name is authoritative — numeric visualType IDs are per-session, so a
        // reloaded page must re-resolve each field's visualTypeName against the
        // registry we just rebuilt (same as handleLoadScene / space restore)
        for (const field of sim.fields.values()) {
          if (field.visualTypeName) {
            const runtimeId = renderer.resolveVisualType(field.visualTypeName)
            if (runtimeId !== undefined) field.visualType = runtimeId
          }
        }

        // Restore uber-shader interaction definitions
        if (Array.isArray(data.interactionDefs)) {
          if (!sim.interactionPairs) sim.interactionPairs = []
          for (const def of data.interactionDefs) {
            if (def.name && def.wgsl && def.fieldA && def.fieldB) {
              const result = renderer.registerInteraction(def.name, def.wgsl)
              const propagationTypeId = def.propagation ? renderer.resolvePropagation(def.propagation) : undefined
              sim.interactionPairs = sim.interactionPairs.filter((p: { name: string }) => p.name !== def.name)
              sim.interactionPairs.push({ name: def.name, fieldA: def.fieldA, fieldB: def.fieldB, interactionTypeId: result.id, propagationTypeId })
              console.log(`[Restore] Interaction '${def.name}': ${def.fieldA} + ${def.fieldB} (type ${result.id})`)
            }
          }
        }

        // Restore shader modules
        if (Array.isArray(data.modules)) {
          for (const mod of data.modules) {
            if (mod.name && mod.wgsl) {
              renderer.registerModule(mod.name, mod.wgsl)
            }
          }
        }

        // Restore render targets
        if (Array.isArray(data.renderTargets)) {
          for (const rt of data.renderTargets) {
            if (rt.name) {
              renderer.createRenderTarget(rt.name)
            }
          }
        }

        const firstId = snaps[0].id

        // Restore effect programs for all fields
        let compiled = 0, failed = 0
        for (const field of sim.fields.values()) {
          for (const effect of field.effects) {
            const programKey = `${field.id}_${effect.id}`
            const result = await renderer.compileFieldEffect(programKey, field.id, effect.wgsl, getModCode())
            if (result.success) {
              compiled++
            } else {
              failed++
              console.warn(`[Restore] Effect compile failed for ${field.name}/${effect.id}: ${result.error?.substring(0, 200)}`)
            }
          }
        }
        console.log(`[Restore] Effects: ${compiled} compiled, ${failed} failed, mods: ${wgslModsRef.current.size}`)

        setBrush(prev => ({ ...prev, activeFieldId: firstId }))
      }

      // Restore step hooks
      if (Array.isArray(data.stepHooks)) {
        for (const hook of data.stepHooks) {
          if (hook.id && hook.code) {
            sim.addStepHook(hook.id, hook.author || 'unknown', hook.description || '', hook.code)
          }
        }
        // A restored world with logic should resume running, same as a
        // freshly loaded scene cartridge — otherwise reload freezes the game
        if (data.stepHooks.length > 0 && !sim.running) {
          sim.running = true
          setRunning(true)
        }
      }
      // Restore interaction effects
      if (Array.isArray(data.interactionEffects)) {
        for (const ie of data.interactionEffects) {
          if (ie.wgsl) {
            sim.addInteractionEffect(ie)
          }
        }
      }
      // Restore world data
      if (data.worldData && typeof data.worldData === 'object') {
        Object.assign(sim.worldData, data.worldData)
      }
      setFields(new Map(sim.fields))
    } catch {
      if (!cancelled) setFields(new Map(sim.fields))
    }

    // Wire hook-initiated scene transitions (handleLoadScene reads live refs, so a
    // mount-time capture stays valid)
    loadSceneRef.current = handleLoadScene

    // Render loop
    function frame() {
      const now = performance.now()
      // Cap at ~60fps: ProMotion displays otherwise drive the full compute
      // pipeline at 120Hz — double the GPU load (and laptop heat) for no
      // perceptible gain in a shader-driven scene. Watching IS using, focused
      // or not — the usual posture is the engine visible beside a chat window,
      // and a 10fps unfocused throttle read as "the scene is choppy" (Jul 12
      // 2026, measured: every dropped frame was an unfocused one). Full rate
      // whenever visible; hidden tabs still pause free via rAF.
      const minFrameMs = 15
      if (now - lastFrameRef.current < minFrameMs) {
        animFrameRef.current = requestAnimationFrame(frame)
        return
      }
      const dt = (now - lastFrameRef.current) / 1000
      lastFrameRef.current = now

      const sim = simulationRef.current
      const renderer = rendererRef.current
      if (!sim || !renderer) return

      sim.step(dt)

      // Process audio triggers from worldData (single event or an array per tick)
      type PlaySoundCmd = { id?: string; frequency?: number; duration?: number; volume?: number; pitch?: number; type?: OscillatorType }
      const playSoundRaw = sim.worldData['__play_sound'] as PlaySoundCmd | PlaySoundCmd[] | undefined
      if (playSoundRaw) {
        delete sim.worldData['__play_sound']
        const audio = audioRef.current
        for (const playSound of Array.isArray(playSoundRaw) ? playSoundRaw : [playSoundRaw]) {
          if (playSound.id && audio.hasSound(playSound.id)) {
            audio.play(playSound.id, playSound.volume ?? 1.0, playSound.pitch ?? 1.0)
          } else if (playSound.frequency) {
            audio.beep(playSound.frequency, playSound.duration ?? 0.2, playSound.volume ?? 0.5, playSound.type)
          }
        }
      }

      // Music: { url, loop?, volume? } starts/switches a track; { stop: true } fades out
      const playMusic = sim.worldData['__play_music'] as { url?: string; volume?: number; loop?: boolean; stop?: boolean } | undefined
      if (playMusic) {
        delete sim.worldData['__play_music']
        const audio = audioRef.current
        if (playMusic.stop) audio.stopMusic()
        else if (playMusic.url) void audio.playMusic(playMusic.url, { volume: playMusic.volume, loop: playMusic.loop })
      }

      // the EYE cuts a version when an AI edit-burst settles on a branch
      if (now - eyeCheckRef.current > 1000) {
        eyeCheckRef.current = now
        setAiPulse(p => p + 1)   // keeps the AI status dot honest
        if (aiDirtyRef.current && Date.now() - aiLastEditRef.current > 4000 && lastSceneRef.current.includes(' ⑂ ')) {
          aiDirtyRef.current = false
          const cur = lastSceneRef.current
          const m = cur.match(/· v(\d+)$/)
          const next = m ? cur.replace(/· v\d+$/, `· v${+m[1] + 1}`) : `${cur} · v2`
          lastSceneRef.current = next
          saveSceneAs(next).then(ok => { if (ok) showToast(`eye: ${next.split(' ⑂ ')[1]} saved`, 'success') })
        }
      }

      // Hook-initiated room transition: worldData.__loadScene = 'SceneName' — the
      // door that actually leads somewhere (Zelda rooms from inside a running scene)
      const nextScene = sim.worldData['__loadScene']
      if (typeof nextScene === 'string') {
        delete sim.worldData['__loadScene']
        loadSceneRef.current?.(nextScene)
      }

      // Game saves: __save_game {slot, data} persists; __load_game {slot} answers
      // into worldData.game_save = { slot, data } for the hook to consume
      const saveReq = sim.worldData['__save_game'] as { slot?: string; data?: unknown } | undefined
      if (saveReq && typeof saveReq.slot === 'string') {
        delete sim.worldData['__save_game']
        fetch('/api/engine/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: saveReq.slot, data: saveReq.data ?? null }),
        }).catch(() => {})
      }
      const loadReq = sim.worldData['__load_game'] as { slot?: string } | undefined
      if (loadReq && typeof loadReq.slot === 'string') {
        delete sim.worldData['__load_game']
        fetch(`/api/engine/save?slot=${encodeURIComponent(loadReq.slot)}`)
          .then(r => r.json())
          .then(j => {
            const s = simulationRef.current
            if (s) s.worldData['game_save'] = { slot: loadReq.slot, data: j?.data ?? null }
          })
          .catch(() => {})
      }

      // Update HUD overlay from worldData (cached element lookups, no per-frame DOM queries)
      const hudData = sim.worldData['hud'] as HudElement[] | undefined
      const hudContainer = hudContainerRef.current
      if (hudContainer) {
        if (hudData && Array.isArray(hudData)) {
          const cache = hudElementCacheRef.current
          const seen = new Set<string>()
          for (const elem of hudData) {
            if (!elem.id || elem.visible === false) continue
            seen.add(elem.id)
            let el = cache.get(elem.id)
            if (!el || !el.isConnected) {
              el = document.createElement('div')
              el.setAttribute('data-hud-id', elem.id)
              el.style.position = 'absolute'
              hudContainer.appendChild(el)
              cache.set(elem.id, el)
            }
            el.style.left = elem.x ?? ''
            el.style.top = elem.y ?? ''
            el.style.right = elem.right ?? ''
            el.style.bottom = elem.bottom ?? ''
            el.style.color = elem.color ?? '#fff'
            el.style.fontSize = elem.fontSize ?? '16px'

            if (elem.type === 'text') {
              el.textContent = elem.text ?? ''
            } else if (elem.type === 'bar') {
              const pct = elem.max ? Math.min(100, ((elem.value ?? 0) / elem.max) * 100) : 0
              // Reuse fill child if it exists
              let fill = el.firstChild as HTMLElement | null
              if (!fill || !fill.style) {
                el.innerHTML = ''
                el.style.width = elem.width ?? '100px'
                el.style.height = '12px'
                el.style.backgroundColor = 'rgba(255,255,255,0.2)'
                el.style.borderRadius = '2px'
                el.style.overflow = 'hidden'
                fill = document.createElement('div')
                fill.style.height = '100%'
                fill.style.backgroundColor = elem.barColor ?? elem.color ?? '#0f0'
                fill.style.transition = 'width 0.15s'
                el.appendChild(fill)
              }
              fill.style.width = `${pct}%`
            } else if (elem.type === 'image') {
              if (el.tagName !== 'IMG') {
                const img = document.createElement('img') as HTMLImageElement
                img.setAttribute('data-hud-id', elem.id)
                img.style.position = 'absolute'
                el.replaceWith(img)
                el = img
                cache.set(elem.id, el)
              }
              (el as HTMLImageElement).src = elem.src ?? ''
              el.style.width = elem.imgWidth ?? ''
              el.style.height = elem.imgHeight ?? ''
              el.style.left = elem.x ?? ''
              el.style.top = elem.y ?? ''
              el.style.right = elem.right ?? ''
              el.style.bottom = elem.bottom ?? ''
            }
          }
          // Remove stale elements using cache (no DOM query)
          for (const [id, el] of cache) {
            if (!seen.has(id)) {
              el.remove()
              cache.delete(id)
            }
          }
        } else if (hudElementCacheRef.current.size > 0) {
          hudContainer.innerHTML = ''
          hudElementCacheRef.current.clear()
        }
      }

      // Paint field shapes into colorData so base pass renders them
      sim.paintFieldShapes()

      renderer.uploadColorData(sim.world.colorData)
      renderer.uploadStateData(sim.world.stateData)
      renderer.uploadEffectData(sim.world.effectData)

      // Run GPU state update shader (if active)
      if (renderer.hasStateUpdate()) {
        const stateTime = now / 1000 - startTimeRef.current
        renderer.runStateUpdate(stateTime, dt / 1000)
        // Async readback — don't block the frame. State syncs next frame.
        renderer.readbackState(sim.world.stateData).catch(() => {})
      }

      // World uniforms ("the whiteboard") — hooks write worldData.gpuUniforms,
      // every visual/interaction shader reads it via uni(i) / uni4(i)
      const gpuUni = sim.worldData['gpuUniforms']
      if (Array.isArray(gpuUni)) renderer.updateWorldUniforms(gpuUni as number[])

      const camera = cameraRef.current
      const time = now / 1000 - startTimeRef.current

      // Camera follow mode — lerp toward target field position
      const follow = cameraFollowRef.current
      if (follow) {
        const targetField = sim.fields.get(follow.targetFieldId)
        if (targetField) {
          const targetX = targetField.transform.x + follow.offsetX
          const targetY = targetField.transform.y + follow.offsetY
          const dx = targetX - camera.x
          const dy = targetY - camera.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > follow.deadZone) {
            const s = 1 - Math.pow(1 - follow.smoothing, dt * 60)
            camera.x += dx * s
            camera.y += dy * s
          }
        }
      }

      // Build effect list — mask texture clips to painted cells only
      const fieldEffects: FieldEffectData[] = []
      const fullBounds: [number, number, number, number] = [0, 0, gridSize, gridSize]
      for (const field of sim.fields.values()) {
        const bounds = sim.getFieldBounds(field.id)

        if (!bounds || field.effects.length === 0) continue

        const effectBounds: [number, number, number, number] = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
        for (const effect of field.effects) {
          const programKey = `${field.id}_${effect.id}`
          if (!renderer.hasFieldEffect(programKey)) continue
          fieldEffects.push({
            fieldId: field.id,
            programKey,
            bounds: effectBounds,
            transform: [field.transform.x, field.transform.y, field.transform.rotation, field.transform.scale],
            params: [field.color[0], field.color[1], field.color[2], field.color[3]],
            blend: effect.blend,
            feedback: effect.feedback,
          })
        }
      }


      // --- Interaction effects (merged into field pipeline) ---
      if (sim.interactionEffects.length > 0) {
        const activePairs = sim.getActiveInteractionPairs()

        for (const { effect, fieldA, fieldB } of activePairs) {
          // Per-pair program key (fixes wildcard mask overwrite bug)
          const pairKey = `ix_${effect.id}_${fieldA.id}_${fieldB.id}`

          // Lazy compile (wrap interaction GLSL → fieldEffect)
          if (!renderer.hasFieldEffect(pairKey)) {
            const wrappedWgsl = wrapInteractionWgsl(effect.wgsl)
            // Fire-and-forget async compile — will be ready next frame
            renderer.compileFieldEffect(pairKey, pairKey, wrappedWgsl, getModCode())
              .then(result => { if (!result.success) console.warn(`Interaction effect ${effect.id} compile error:`, result.error) })
            continue
          }

          // Upload cached overlap mask if available (computed at 250ms intervals)
          const overlapMask = cachedOverlapMasksRef.current.get(pairKey)
          if (overlapMask) {
            renderer.uploadFieldMask(pairKey, overlapMask)
          }

          // Compute union bounds of both fields (expanded by spread) — the interaction
          // shader runs in this region, NOT the full 512x512 grid.
          const spread = effect.spread || 0
          const boundsA = sim.getFieldBounds(fieldA.id)
          const boundsB = sim.getFieldBounds(fieldB.id)
          const ixBounds: [number, number, number, number] = boundsA && boundsB
            ? [
                Math.max(0, Math.min(boundsA.minX, boundsB.minX) - spread),
                Math.max(0, Math.min(boundsA.minY, boundsB.minY) - spread),
                Math.min(gridSize, Math.max(boundsA.maxX, boundsB.maxX) + spread),
                Math.min(gridSize, Math.max(boundsA.maxY, boundsB.maxY) + spread),
              ]
            : fullBounds

          fieldEffects.push({
            fieldId: pairKey,
            programKey: pairKey,
            bounds: ixBounds,
            transform: [
              (fieldA.transform.x + fieldB.transform.x) / 2,
              (fieldA.transform.y + fieldB.transform.y) / 2,
              0, 1
            ],
            params: [fieldA.color[0], fieldB.color[0], 0, 0],
            blend: effect.blend,
            fieldAColor: fieldA.color,
            fieldBColor: fieldB.color,
            fieldATransform: [fieldA.transform.x, fieldA.transform.y, fieldA.transform.rotation, fieldA.transform.scale],
            fieldBTransform: [fieldB.transform.x, fieldB.transform.y, fieldB.transform.rotation, fieldB.transform.scale],
            precedence: effect.precedence,
          })

          // Process interaction hooks (throttled per-effect)
          if (effect.hooks && effect.hooks.length > 0) {
            const hookKey = `ix_hook_${effect.id}`
            const lastHookTime = (sim.worldData[hookKey] as number) || 0
            const minCooldown = Math.min(...effect.hooks.map(h => h.cooldown ?? 1.0))
            if (time - lastHookTime >= minCooldown) {
              sim.worldData[hookKey] = time
              for (const hook of effect.hooks) {
                const hookCooldownKey = `${hookKey}_${hook.type}`
                const lastThisHook = (sim.worldData[hookCooldownKey] as number) || 0
                if (time - lastThisHook < (hook.cooldown ?? 1.0)) continue
                sim.worldData[hookCooldownKey] = time

                const targets: string[] = []
                if (hook.target === 'A' || hook.target === 'both' || !hook.target) targets.push(fieldA.id)
                if (hook.target === 'B' || hook.target === 'both' || !hook.target) targets.push(fieldB.id)

                switch (hook.type) {
                  case 'memory':
                    for (const fid of targets) {
                      sim.addMemory(fid, {
                        timestamp: new Date().toISOString(),
                        type: 'collision',
                        content: hook.message || `Interaction: ${effect.description}`,
                        sourceFieldId: fid === fieldA.id ? fieldB.id : fieldA.id,
                      })
                    }
                    break
                  case 'modify_property':
                    if (hook.property) {
                      for (const fid of targets) {
                        const f = sim.fields.get(fid)
                        if (f) f.properties.set(hook.property, hook.value)
                      }
                    }
                    break
                  case 'apply_force':
                    for (const fid of targets) {
                      sim.applyForce(fid, hook.fx ?? 0, hook.fy ?? 0)
                    }
                    break
                  case 'webhook':
                    if (hook.url) {
                      fetch(hook.url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          effectId: effect.id,
                          fieldA: fieldA.id,
                          fieldB: fieldB.id,
                          time,
                        }),
                      }).catch(() => {})
                    }
                    break
                }
              }
            }
          }
        }

        // Clean up stale interaction programs (reuse Set to avoid per-frame allocation)
        const activePairKeys = _reusableKeySet
        activePairKeys.clear()
        for (const p of activePairs) {
          activePairKeys.add(`ix_${p.effect.id}_${p.fieldA.id}_${p.fieldB.id}`)
        }
        for (const key of renderer.getFieldEffectKeys()) {
          if (key.startsWith('ix_') && !activePairKeys.has(key)) {
            renderer.removeFieldEffect(key)
            renderer.removeFieldMask(key)
          }
        }
      }

      // ─── Superimposed fields — pack fields with visualType for uber-shader ───
      // Compute camera viewport in grid coords for CPU-side frustum culling
      const canvas = canvasRef.current
      let vpMinX = -Infinity, vpMinY = -Infinity, vpMaxX = Infinity, vpMaxY = Infinity
      if (canvas) {
        const dpr = (window.devicePixelRatio || 1) * renderer.renderScale
        const aspect = (canvas.clientWidth * dpr) / (canvas.clientHeight * dpr)
        const gridRange = gridSize / camera.zoom
        const halfW = gridRange * Math.max(aspect, 1.0) * 0.5
        const halfH = gridRange * Math.max(1.0 / aspect, 1.0) * 0.5
        vpMinX = camera.x - halfW
        vpMaxX = camera.x + halfW
        vpMinY = camera.y - halfH
        vpMaxY = camera.y + halfH
      }

      const superFields: SuperFieldGPU[] = []
      const superFieldOrder: string[] = []  // Maps GPU array index → fieldId
      // Sort fields by renderOrder (lower = rendered first = behind)
      const sortedFields = Array.from(sim.fields.values())
        .filter(f => f.visualType !== undefined)
        .sort((a, b) => (a.renderOrder || 0) - (b.renderOrder || 0))
      for (const field of sortedFields) {
        const t = field.transform
        const shapeType = field.shapeType === 'rect' ? 1 : field.shapeType === 'screen' ? 2 : 0
        const dim1 = shapeType === 2 ? (field.w || sim.gridSize) : shapeType === 1 ? (field.w || 20) : (field.radius || 10)
        const dim2 = shapeType === 2 ? (field.h || sim.gridSize) : shapeType === 1 ? (field.h || 20) : 0

        // Viewport culling — skip fields entirely outside the camera view
        const s = Math.max(t.scale, 0.001)
        let hx: number, hy: number
        if (shapeType === 1 || shapeType === 2) {
          // Rotated rect/screen AABB
          const ac = Math.abs(Math.cos(t.rotation))
          const as_ = Math.abs(Math.sin(t.rotation))
          hx = (dim1 * 0.5 * ac + dim2 * 0.5 * as_) * s
          hy = (dim1 * 0.5 * as_ + dim2 * 0.5 * ac) * s
        } else {
          hx = dim1 * s
          hy = dim1 * s
        }
        // Skip viewport culling when GPU step hooks are active — culling changes
        // field indices which breaks the stepStateBuffer index mapping (velocity
        // accumulated for field N would be read by field N-1 after a cull shift).
        if (!renderer.hasStepHooks()) {
          if (t.x + hx < vpMinX || t.x - hx > vpMaxX ||
              t.y + hy < vpMinY || t.y - hy > vpMaxY) {
            continue // entirely off-screen
          }
        }

        const vp = field.visualParams || [0, 0, 0, 0]
        // Resolve render target name → ID (-1 = screen, 0-5 = target index)
        const rtName = field.properties.get('renderTarget') as string | undefined
        const renderTargetId = rtName ? renderer.resolveRenderTarget(rtName) : (field.noHit ? -2 : -1)
        superFieldOrder.push(field.id)
        superFields.push({
          // When step hooks are active, the GPU shader ignores these x/y values and
          // restores its own persistent position from stepStates.flags.zw instead.
          posScaleRot: [t.x, t.y, t.scale, t.rotation],
          shapeDims: [shapeType, dim1, dim2, renderTargetId],
          color: field.color,
          visualAndParams: [field.visualType!, vp[0], vp[1], vp[2]],
          extraParams: [
            vp[3],
            field.properties.get('bidirectionalBehind') ? 1 : 0,
            (field.properties.get('lighting') as number) ?? 0,
            (field.properties.get('specular') as number) ?? 0,
          ],
          pos3D: [t.z || 0, t.rotX || 0, t.rotY || 0, field.properties.get('superimpose') ? 1 : 0],
        })
      }

      // Upload per-field step state ONLY for newly added fields — the GPU owns
      // stepStateBuffer once initialized. Uploading every frame destroys the GPU's
      // accumulated velocity (the orbit hook's mix() damping never builds up).
      if (renderer.hasStepHooks() && superFields.length > 0) {
        for (let i = 0; i < superFieldOrder.length; i++) {
          const fieldId = superFieldOrder[i]
          if (stepStateInitializedRef.current.has(fieldId)) continue
          const field = sim.fields.get(fieldId)
          if (!field) continue
          const t = field.transform
          renderer.uploadStepState(
            i,
            [t.vx, t.vy, t.vz || 0, t.vr],
            [
              (field.properties.get('state0') as number) ?? 0,
              (field.properties.get('state1') as number) ?? 0,
              (field.properties.get('state2') as number) ?? 0,
              (field.properties.get('state3') as number) ?? 0,
            ],
            [
              (field.properties.get('state4') as number) ?? 0,
              (field.properties.get('state5') as number) ?? 0,
              (field.properties.get('state6') as number) ?? 0,
              (field.properties.get('state7') as number) ?? 0,
            ],
            [field.color[3] > 0 ? 1 : 0, 0, 0, 0],  // alive, age (GPU tracks), tag0, tag1
          )
          stepStateInitializedRef.current.add(fieldId)
        }
      }

      // Trigger lazy compilation of superimposed pipeline. The 3D pipeline
      // only compiles when actually in 3D mode — eagerly compiling it in 2D
      // doubles every scene switch's compile cost and, if a visual is broken,
      // spams a failing recompile every frame.
      if (superFields.length > 0) {
        renderer.isSuperReady()
        if (renderModeRef.current === '3d') renderer.isSuper3DReady()
      }

      // Compile GPU step hooks when dirty
      if (sim.gpuStepHooksDirty) {
        sim.gpuStepHooksDirty = false
        renderer.invalidateStepHooks()
        // Reset step state initialization so new hooks get fresh state
        stepStateInitializedRef.current.clear()
        if (sim.gpuStepHooks.size > 0) {
          renderer.compileStepHookPipeline(sim.getSortedGpuStepHooks()).then(result => {
            if (!result.ok) {
              console.warn('[GPU StepHook] Compilation failed:', result.error)
            }
          })
        } else {
          renderer.clearStepHookPipeline()
        }
      }

      // Store field order for pixel-perfect hit testing
      sim.superFieldOrder = superFieldOrder

      // Map interaction pairs (field name → field name) to GPU indices (idx → idx)
      // Rebuild name→ID lookup only when field count changes (avoids per-frame Map allocation)
      const fieldCount = sim.fields.size
      if (fieldCount !== lastFieldCountRef.current) {
        lastFieldCountRef.current = fieldCount
        const m = nameToIdRef.current
        m.clear()
        for (const field of sim.fields.values()) {
          m.set(field.name, field.id)
        }
      }
      const nameToId = nameToIdRef.current
      const activeInteractions: { fieldIdxA: number; fieldIdxB: number; interactionType: number; propagationType?: number }[] = []
      if (sim.interactionPairs && sim.interactionPairs.length > 0) {
        for (const pair of sim.interactionPairs) {
          const idA = nameToId.get(pair.fieldA) || pair.fieldA
          const idB = nameToId.get(pair.fieldB) || pair.fieldB
          const idxA = superFieldOrder.indexOf(idA)
          const idxB = superFieldOrder.indexOf(idB)
          if (idxA >= 0 && idxB >= 0) {
            activeInteractions.push({ fieldIdxA: idxA, fieldIdxB: idxB, interactionType: pair.interactionTypeId, propagationType: pair.propagationTypeId })
          }
        }
      }

      // Apply post-processing settings from worldData if set
      const ppData = sim.worldData['postProcess'] as Partial<typeof renderer.postProcessSettings> | undefined
      if (ppData) {
        renderer.setPostProcess(ppData)
      }

      // Process particle emission requests from worldData
      const emitParticle = sim.worldData['__emit_particles'] as { x: number; y: number; count: number; color?: [number, number, number]; velX?: number; velY?: number; spread?: number; size?: number; life?: number } | undefined
      if (emitParticle) {
        renderer.emitParticles(emitParticle.x, emitParticle.y, emitParticle.count, emitParticle)
        lastParticleRef.current = now
        delete sim.worldData['__emit_particles']
      }

      const mode3D = renderModeRef.current === '3d' ? camera3DRef.current : undefined
      const stepHookData = renderer.hasStepHooks() ? { dt, worldData: sim.worldData } : undefined

      // ── Lossless frame memoization ──
      // Every visual is a pure function of (uv, time, params, uniforms). If no
      // visible visual animates with time and none of the inputs changed, the
      // last frame is still pixel-identical — skip the GPU entirely.
      // Conservative bail-outs: 3D mode, GPU hooks, legacy effects, interactions,
      // projectiles/particles, state shaders, or a pipeline mid-compile.
      let skipRender = false
      if (!mode3D && !stepHookData && renderer.superReady &&
          fieldEffects.length === 0 && activeInteractions.length === 0 &&
          sim.projectiles.length === 0 && !renderer.hasStateUpdate() &&
          now - lastParticleRef.current > 6000) {
        let animated = false
        for (const f of sim.fields.values()) {
          if (typeof f.visualType === 'number' && renderer.visualAnimated(f.visualType)) { animated = true; break }
        }
        if (!animated) {
          const parts: (string | number)[] = [
            renderer.compilationId, camera.x, camera.y, camera.zoom,
            canvasRef.current?.width ?? 0, canvasRef.current?.height ?? 0,
          ]
          for (const f of sim.fields.values()) {
            const tr = f.transform
            parts.push(f.id, tr.x, tr.y, tr.rotation, tr.scale,
              f.visualType ?? -1, String(f.color), String(f.visualParams ?? ''), f.renderOrder ?? 0)
          }
          const gu = sim.worldData['gpuUniforms']
          if (Array.isArray(gu)) parts.push(gu.join(','))
          const pp = sim.worldData['postProcess']
          if (pp) parts.push(JSON.stringify(pp))
          const fp = parts.join('|')
          if (fp === frameFingerprintRef.current) skipRender = true
          else frameFingerprintRef.current = fp
        } else {
          frameFingerprintRef.current = ''
        }
      } else {
        frameFingerprintRef.current = ''
      }

      if (!skipRender) {
        renderer.render(camera, camera.zoom, time, fieldEffects, superFields, activeInteractions, mode3D ? { pos: mode3D.pos, pitch: mode3D.pitch, yaw: mode3D.yaw, fov: mode3D.fov } : undefined, stepHookData)
      }

      // Trigger async readback of hit ID map for pixel-perfect hit testing
      if (superFields.length > 0) {
        renderer.readbackHitMap()
        // Update simulation with latest hit map and grid-to-pixel converters
        sim.superHitMap = renderer.hitMap
        sim.superHitMapWidth = renderer.hitMapWidth
        sim.superHitMapHeight = renderer.hitMapHeight

        const canvas = canvasRef.current
        if (canvas) {
          // use the real buffer dims the renderer set this frame — dpr may be
          // capped by the renderer's pixel budget (effectiveDpr)
          const bw = canvas.width
          const bh = canvas.height
          const aspect = bw / bh
          const gridRange = sim.gridSize / camera.zoom

          // Grid → buffer pixel (inverse of shader's pixel → grid transform)
          // Shader: gridCoord.y = camera.y + (0.5 - uv.y) * gridRange  (note: Y is flipped)
          // Inverse: uv.y = 0.5 - (gridY - camera.y) / gridRange
          //          pixel.y = (1.0 - uv.y) * bh  ... wait, shader does uv = 1 - pixel/res
          // Shader: uv.y = 1 - (pixel.y + 0.5) / bh
          //         gridCoord.y = camera.y + (0.5 - uv.y) * gridRange
          //                     = camera.y + (0.5 - 1 + (pixel.y+0.5)/bh) * gridRange
          //                     = camera.y + ((pixel.y+0.5)/bh - 0.5) * gridRange
          // Inverse: pixel.y = ((gridY - camera.y) / gridRange + 0.5) * bh - 0.5
          if (aspect > 1) {
            sim._gridToPixelX = (gx: number) => ((gx - camera.x) / (gridRange * aspect) + 0.5) * bw
            sim._gridToPixelY = (gy: number) => ((gy - camera.y) / gridRange + 0.5) * bh
          } else {
            sim._gridToPixelX = (gx: number) => ((gx - camera.x) / gridRange + 0.5) * bw
            sim._gridToPixelY = (gy: number) => ((gy - camera.y) / (gridRange / aspect) + 0.5) * bh
          }
        }
      }

      // GPU step hook readback — sync GPU positions to CPU for hit testing only.
      // The GPU shader persists positions in stepStates.flags.zw and ignores CPU-packed
      // positions, so this readback doesn't affect rendering — only CPU hit detection.
      if (renderer.hasStepHooks() && superFields.length > 0) {
        renderer.readbackSuperFields(superFields.length)
        const readback = renderer.consumeSuperFieldReadback()
        if (readback) {
          for (let i = 0; i < superFieldOrder.length; i++) {
            const field = sim.fields.get(superFieldOrder[i])
            if (!field) continue
            const off = i * 24
            field.transform.x = readback[off + 0]
            field.transform.y = readback[off + 1]
          }
        }
      }

      // Per-field presence map: render each field individually, readback pixel presence (throttled)
      // This is the "field renders to pixels → pixels return superimposition data" pipeline
      if (fieldEffects.length > 0 && now - lastPresenceRef.current > 250) {
        lastPresenceRef.current = now
        try {
          const presenceMaps = renderer.renderFieldPresenceMaps(time, fieldEffects)
          // Clear stale presence data for fields no longer rendering
          for (const fieldId of sim.fieldPresence.keys()) {
            if (!presenceMaps.has(fieldId)) {
              sim.fieldPresence.delete(fieldId)
            }
          }
          // Store new presence data
          for (const [fieldId, presence] of presenceMaps) {
            sim.fieldPresence.set(fieldId, presence)
          }

          // Pre-compute overlap masks for interaction effects (expensive dilation runs here at ~4fps, not 60fps)
          if (sim.interactionEffects.length > 0) {
            const activePairs = sim.getActiveInteractionPairs()
            const newMasks = new Map<string, Uint8Array>()
            for (const { effect, fieldA, fieldB } of activePairs) {
              const pairKey = `ix_${effect.id}_${fieldA.id}_${fieldB.id}`
              const presA = sim.fieldPresence.get(fieldA.id)
              const presB = sim.fieldPresence.get(fieldB.id)
              const presACount = presA ? presA.reduce((s: number, v: number) => s + (v > 0 ? 1 : 0), 0) : 0
              const presBCount = presB ? presB.reduce((s: number, v: number) => s + (v > 0 ? 1 : 0), 0) : 0
              const mask = sim.computePixelOverlapMask(fieldA.id, fieldB.id, effect.spread)
              const maskCount = mask ? mask.reduce((s: number, v: number) => s + (v > 0 ? 1 : 0), 0) : 0
              console.log(`[IX MASK] ${fieldA.name} (${presACount}px) x ${fieldB.name} (${presBCount}px) → mask=${maskCount}px spread=${effect.spread} pos=(${fieldA.transform.x.toFixed(0)},${fieldA.transform.y.toFixed(0)}) vs (${fieldB.transform.x.toFixed(0)},${fieldB.transform.y.toFixed(0)})`)
              if (mask) {
                newMasks.set(pairKey, mask)
              }
            }
            cachedOverlapMasksRef.current = newMasks
          }
        } catch (e) {
          console.warn('[Presence] readback failed:', e)
        }
      }

      // Sample rendered pixels per field (throttled to once per second, async)
      // Scenes with many fields can set worldData.noPixelSampling to skip this —
      // the per-field GPU readback loop stalls a frame (visible black flash) at scale.
      // Readback stalls the pipe once per second (the 'black flash'). It exists
      // for agents in the workshop — play sessions and player spaces default OFF
      // unless a world explicitly asks (noPixelSampling: false).
      const samplingOn = sim.worldData['noPixelSampling'] === false ||
        (!playScene && !spaceId && !sim.worldData['noPixelSampling'])
      if (now - lastSampleTimeRef.current > 1000 && samplingOn) {
        lastSampleTimeRef.current = now
        // Fire async sampling — results land next cycle
        ;(async () => {
          const samples = new Map<string, { width: number; height: number; pixels: number[] }>()
          for (const field of sim.fields.values()) {
            const bounds = sim.getFieldBounds(field.id)
            if (!bounds) continue
            const sample = await renderer.sampleRenderedRegion(
              camera, camera.zoom,
              bounds.minX, bounds.minY,
              bounds.maxX - bounds.minX, bounds.maxY - bounds.minY,
              16
            )
            if (sample) samples.set(field.id, sample)
          }
          renderedSamplesRef.current = samples
        // Expose pixel samples to step hooks via worldData
        const pixelData: Record<string, { width: number; height: number; avgColor: [number, number, number]; brightness: number }> = {}
        for (const [fid, s] of samples) {
          let rSum = 0, gSum = 0, bSum = 0
          const px = s.pixels
          const count = px.length / 4
          for (let i = 0; i < px.length; i += 4) {
            rSum += px[i]; gSum += px[i+1]; bSum += px[i+2]
          }
          pixelData[fid] = {
            width: s.width, height: s.height,
            avgColor: [rSum/count/255, gSum/count/255, bSum/count/255],
            brightness: (rSum + gSum + bSum) / (count * 3 * 255),
          }
        }
        sim.worldData['fieldPixels'] = pixelData
        })().catch(() => {})
      }

      animFrameRef.current = requestAnimationFrame(frame)
    }

    animFrameRef.current = requestAnimationFrame(frame)
    } // end initEngine

    initEngine()

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameRef.current)
      renderer.destroy()
      audioRef.current.destroy()
      rendererRef.current = null
      simulationRef.current = null
      inputRef.current = null
    }
  }, [])

  // Load saved scenes list on mount
  // Scene tabs appear as soon as a scene is saved — from this tab, another
  // tab, or a CLI/agent POST — without a browser reload: poll the (cheap)
  // list endpoint and also refresh on window focus.
  useEffect(() => {
    refreshSceneList()
    const interval = setInterval(refreshSceneList, 4000)
    window.addEventListener('focus', refreshSceneList)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', refreshSceneList)
    }
  }, [refreshSceneList])

  // Agent activity panels
  const [dialogLog, setDialogLog] = useState<DialogEntry[]>([])
  const [terminalLog, setTerminalLog] = useState<TerminalEntry[]>([])
  const [agentConnected, setAgentConnected] = useState(false)

  // SSE subscription to agent command channel
  useEffect(() => {
    let es: EventSource | null = null
    let retryTimeout: ReturnType<typeof setTimeout>

    function connect() {
      if (playScene) return   // play sessions are local-only — no shared queue
      const sseUrl = spaceId
        ? `/api/engine/agent?spaceId=${encodeURIComponent(spaceId)}`
        : '/api/engine/agent'
      es = new EventSource(sseUrl)

      es.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data)
          lastSSEMsgRef.current = Date.now()
          // the EYE: any mutating AI traffic marks the branch dirty; a settled
          // burst becomes a version (cut in the frame loop after 4s of quiet)
          if (data && data.type && data.type !== 'connected' && data.type !== 'ping') {
            aiLastEditRef.current = Date.now()
            aiDirtyRef.current = true
          }

          if (data.type === 'ping') return
          if (data.type === 'connected') {
            setAgentConnected(true)
            return
          }

          const cmd = data.command
          if (!cmd) return

          const sim = simulationRef.current
          const renderer = rendererRef.current
          const input = inputRef.current
          if (!sim || !renderer || !input) return

          // Resolve field by name when fieldId is missing, or when fieldId doesn't match any actual field ID (agents often send names as fieldId)
          if (cmd.type !== 'create_field' && cmd.type !== 'set_world_data' && cmd.type !== 'set_world_params') {
            const nameToResolve = cmd.fieldId && !sim.fields.has(cmd.fieldId) ? cmd.fieldId : (!cmd.fieldId ? cmd.name : null)
            if (nameToResolve) {
              for (const [id, f] of sim.fields) {
                if (f.name === nameToResolve) {
                  cmd.fieldId = id
                  break
                }
              }
            }
          }

          // Helper to push terminal entries
          const pushTerminal = (type: string, fieldId: string | undefined, summary: string, detail?: string, author?: string) => {
            const field = fieldId ? sim.fields.get(fieldId) : undefined
            setTerminalLog(prev => [...prev.slice(-99), {
              type,
              fieldName: field?.name || fieldId || '?',
              fieldColor: field?.color || [0.5, 0.5, 0.5, 1],
              summary,
              detail,
              author: author || '',
              timestamp: Date.now(),
            }])
          }

          // Extract author from command for terminal identity
          const cmdAuthor = (cmd.author || cmd.fromFieldId || '') as string

          switch (cmd.type) {
            case 'select': {
              const field = sim.fields.get(cmd.fieldId)
              if (field) {
                setBrush(prev => ({ ...prev, activeFieldId: cmd.fieldId }))
              }
              break
            }

            case 'generate': {
              const targetFieldId = cmd.fieldId || Array.from(sim.fields.keys())[0]
              if (!targetFieldId) break

              const field = sim.fields.get(targetFieldId)
              if (field) {
                setBrush(prev => ({ ...prev, activeFieldId: targetFieldId }))
              }

              pushTerminal('generate', targetFieldId, `"${cmd.prompt}"`)

              setGeneration({ loading: true, error: null, targetFieldId })
              try {
                const bounds = sim.getFieldBounds(targetFieldId)
                const res = await fetch('/api/engine/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ prompt: cmd.prompt, bounds, fieldId: targetFieldId }),
                })
                const genData = await res.json()

                if (!res.ok) {
                  setGeneration({ loading: false, error: genData.error || 'Generation failed', targetFieldId })
                  break
                }

                const shaderCode = genData.wgsl || genData.glsl
                if (!shaderCode || typeof shaderCode !== 'string') {
                  setGeneration({ loading: false, error: 'No shader code in response', targetFieldId })
                  break
                }
                const effectId = genEffectId()
                const programKey = `${targetFieldId}_${effectId}`
                const result = await renderer.compileFieldEffect(programKey, targetFieldId, shaderCode, getModCode())
                if (result.success) {
                  const effect: FieldEffect = {
                    id: effectId,
                    author: 'ai_generate',
                    wgsl: shaderCode,
                    description: genData.description || 'AI generated',
                    blend: 'alpha',
                    order: 10,
                  }
                  sim.addFieldEffect(targetFieldId, effect)
                  setGeneration({ loading: false, error: null, targetFieldId: null })
                  syncFields()
                  pushTerminal('generate', targetFieldId, 'complete', shaderCode)
                } else {
                  setGeneration({ loading: false, error: `Shader compile error: ${result.error}`, targetFieldId })
                }
              } catch (err) {
                setGeneration({
                  loading: false,
                  error: err instanceof Error ? err.message : 'Network error',
                  targetFieldId,
                })
              }
              break
            }

            case 'inject_wgsl':
            case 'inject_glsl': {
              // Backward-compatible: translates to add_effect. If same author has an
              // existing effect, replaces it.
              const shaderCode = cmd.wgsl || cmd.glsl
              if (!shaderCode || typeof shaderCode !== 'string') {
                pushTerminal('inject_wgsl', undefined, 'ERROR: wgsl or glsl string required')
                break
              }
              const allFieldIds = Array.from(sim.fields.keys())
              const targetId = cmd.fieldId || allFieldIds[0]
              if (!targetId) {
                pushTerminal('inject_wgsl', undefined, 'ERROR: no fields exist')
                break
              }

              // Consent check: fields can only code themselves
              const fromField = (cmd as Record<string, unknown>).fromFieldId as string | undefined
              if (fromField && fromField !== targetId) {
                const targetField = sim.fields.get(targetId)
                pushTerminal('inject_wgsl', fromField, `BLOCKED: cannot code '${targetField?.name || targetId}' — send a field_message proposing your shader instead`)
                break
              }

              setBrush(prev => ({ ...prev, activeFieldId: targetId }))

              const field = sim.fields.get(targetId)
              if (!field) break

              // Remove existing effects from same author (backward compat: author = fromField or 'agent')
              const author = fromField || 'agent'
              const existingEffects = field.effects.filter(e => e.author === author)
              for (const e of existingEffects) {
                const pk = `${targetId}_${e.id}`
                renderer.removeFieldEffect(pk)
                sim.removeFieldEffect(targetId, e.id)
              }

              const effectId = genEffectId()
              const programKey = `${targetId}_${effectId}`
              const result = await renderer.compileFieldEffect(programKey, targetId, shaderCode, getModCode())

              if (result.success) {
                const effect: FieldEffect = {
                  id: effectId,
                  author,
                  wgsl: shaderCode,
                  description: cmd.description || 'Injected by agent',
                  blend: 'alpha',
                  order: 10,
                  feedback: !!cmd.feedback,
                }
                sim.addFieldEffect(targetId, effect)
                syncFields()
                pushTerminal('inject_wgsl', targetId, cmd.description || 'shader injected', shaderCode)
              } else {
                pushTerminal('inject_wgsl', targetId, `COMPILE ERROR: ${result.error?.substring(0, 100)}`)
              }
              break
            }

            case 'add_effect': {
              const targetId = cmd.fieldId
              if (!targetId) {
                pushTerminal('add_effect', undefined, 'ERROR: fieldId required')
                break
              }
              const field = sim.fields.get(targetId)
              if (!field) {
                pushTerminal('add_effect', targetId, `ERROR: field '${targetId}' not found — create_field first`)
                break
              }
              // Accept wgsl/glsl at top level, as 'shader', or nested inside cmd.effect
              const shaderSrc = cmd.wgsl || cmd.glsl || cmd.shader
                || (cmd.effect && typeof cmd.effect === 'object' ? (cmd.effect.wgsl || cmd.effect.glsl) : undefined)
              if (cmd.effect && typeof cmd.effect === 'object') {
                cmd.blend = cmd.blend || cmd.effect.blend
                cmd.author = cmd.author || cmd.effect.author
                cmd.description = cmd.description || cmd.effect.description
              }
              if (!shaderSrc || typeof shaderSrc !== 'string') {
                pushTerminal('add_effect', targetId, 'ERROR: wgsl string required')
                break
              }

              const effectId = genEffectId()
              const programKey = `${targetId}_${effectId}`
              // Accept blend mode from 'blend' or 'effectType' (agents sometimes use effectType for blend)
              const rawBlend = cmd.blend || cmd.effectType
              const blend = (rawBlend === 'additive' || rawBlend === 'multiply') ? rawBlend : 'alpha'
              const result = await renderer.compileFieldEffect(programKey, targetId, shaderSrc, getModCode())

              if (result.success) {
                const effect: FieldEffect = {
                  id: effectId,
                  author: cmd.author || cmd.fromFieldId || 'agent',
                  wgsl: shaderSrc,
                  description: cmd.description || 'effect added',
                  blend,
                  order: cmd.order ?? (field.effects.length + 1) * 10,
                  feedback: !!cmd.feedback,
                }
                sim.addFieldEffect(targetId, effect)
                syncFields()
                pushTerminal('add_effect', targetId, `${effect.description} (${blend}${cmd.feedback ? ' +feedback' : ''})`, shaderSrc, cmdAuthor)
              } else {
                // Compile error — write to field memory and worldData so agents can see it
                const errMsg = result.error?.substring(0, 200) || 'unknown error'
                sim.addMemory(targetId, {
                  timestamp: new Date().toISOString(),
                  type: 'effect_added',
                  content: `COMPILE ERROR: ${errMsg}`,
                  sourceFieldId: null,
                })
                sim.worldData['last_compile_error'] = {
                  fieldId: targetId,
                  error: errMsg,
                  timestamp: Date.now(),
                }
                pushTerminal('add_effect', targetId, `COMPILE ERROR: ${errMsg}`, undefined, cmdAuthor)
              }
              break
            }

            case 'remove_effect': {
              const targetId = cmd.fieldId
              const effectId = cmd.effectId
              if (!targetId || !effectId) {
                pushTerminal('remove_effect', targetId, 'ERROR: fieldId and effectId required')
                break
              }
              const programKey = `${targetId}_${effectId}`
              renderer.removeFieldEffect(programKey)
              sim.removeFieldEffect(targetId, effectId)
              syncFields()
              pushTerminal('remove_effect', targetId, `removed ${effectId}`)
              break
            }

            case 'update_effect': {
              // Atomic swap: remove old effect by effectId, compile + add new one in one step
              const targetId = cmd.fieldId
              const effectId = cmd.effectId
              const updateShader = cmd.wgsl || cmd.glsl
              if (!targetId || !effectId || !updateShader) {
                pushTerminal('update_effect', targetId, 'ERROR: fieldId, effectId, and wgsl required')
                break
              }
              const field = sim.fields.get(targetId)
              if (!field) { pushTerminal('update_effect', targetId, 'ERROR: field not found'); break }
              const oldEffect = field.effects.find(e => e.id === effectId)
              if (!oldEffect) { pushTerminal('update_effect', targetId, `ERROR: effect ${effectId} not found`); break }

              const programKey = `${targetId}_${effectId}`
              const result = await renderer.compileFieldEffect(programKey, targetId, updateShader, getModCode())
              if (result.success) {
                // Update in place — no gap
                oldEffect.wgsl = updateShader
                if (cmd.description) oldEffect.description = cmd.description
                if (cmd.blend) oldEffect.blend = cmd.blend
                if (cmd.feedback !== undefined) oldEffect.feedback = !!cmd.feedback
                syncFields()
                pushTerminal('update_effect', targetId, `updated ${effectId}: ${cmd.description || oldEffect.description}`, updateShader, cmdAuthor)
              } else {
                const errMsg = result.error?.substring(0, 200) || 'unknown error'
                sim.worldData['last_compile_error'] = { fieldId: targetId, effectId, error: errMsg, timestamp: Date.now() }
                pushTerminal('update_effect', targetId, `COMPILE ERROR (kept old): ${errMsg}`, undefined, cmdAuthor)
              }
              break
            }

            case 'update_step_hook': {
              // JS step hooks blocked from bridge API — use GPU step hooks instead
              pushTerminal('update_step_hook', cmd.author, 'ERROR: JS step hooks are admin-only. Use add_gpu_step_hook for sandboxed GPU hooks.', undefined, cmdAuthor)
              break
            }

            case 'clear_effect': {
              const clearTargetId = cmd.fieldId || undefined
              if (clearTargetId) {
                renderer.removeAllFieldEffects(clearTargetId)
                const field = sim.fields.get(clearTargetId)
                if (field) {
                  field.effects = []
                }
                syncFields()
              } else {
                for (const field of sim.fields.values()) {
                  renderer.removeAllFieldEffects(field.id)
                  field.effects = []
                }
                syncFields()
              }
              setGeneration({ loading: false, error: null, targetFieldId: null })
              break
            }

            case 'clear_all':
              for (const field of sim.fields.values()) {
                renderer.removeAllFieldEffects(field.id)
              }
              sim.clearAll()
              for (const field of sim.fields.values()) {
                field.effects = []
              }
              updateSelectionMask(null)
              setGeneration({ loading: false, error: null, targetFieldId: null })
              syncFields()
              break

            case 'reset':
              // Nuclear reset — remove ALL fields, effects, everything
              for (const field of sim.fields.values()) {
                renderer.removeAllFieldEffects(field.id)
              }
              // Clean up ix_* interaction effect programs
              for (const key of Array.from(renderer.getFieldEffectKeys())) {
                if (key.startsWith('ix_')) {
                  renderer.removeFieldEffect(key)
                  renderer.removeFieldMask(key)
                }
              }
              sim.clearAll()
              sim.fields.clear()
              sim.interactionRules = []
              sim.interactionEffects = []
              sim.customCommands.clear()
              sim.tweens.clear()
              sim.timers.clear()
              sim.collisionCallbacks.clear()
              sim.tagIndex.clear()
              sim.gameState = ''
              sim.gameStates.clear()
              sim.interactionPairs = []
              sim.worldData = {}
              sim.stepHooks.clear()
              cameraFollowRef.current = null
              cachedOverlapMasksRef.current = new Map()
              renderer.clearRegistries()

              updateSelectionMask(null)
              setGeneration({ loading: false, error: null, targetFieldId: null })
              syncFields()
              pushTerminal('reset', undefined, 'Full reset — all fields and rules deleted')
              break

            case 'create_field': {
              // Accept id, fieldId, or fall back to name, then auto-generate
              const id = cmd.id || cmd.fieldId || cmd.name || genFieldId()
              const hue = DEFAULT_HUES[sim.fields.size % DEFAULT_HUES.length]
              const color = cmd.color || hueToRgba(hue)
              const name = cmd.name || `Field ${sim.fields.size + 1}`

              sim.createField(id, name, color, cmd.parentFieldId as string | undefined)

              if (cmd.x !== undefined && cmd.y !== undefined) {
                sim.setPosition(id, cmd.x as number, cmd.y as number)
              }
              // 3D position
              if (cmd.z !== undefined) {
                const f = sim.fields.get(id)
                if (f) f.transform.z = cmd.z as number
              }
              if (cmd.rotX !== undefined || cmd.rotY !== undefined) {
                const f = sim.fields.get(id)
                if (f) {
                  if (cmd.rotX !== undefined) f.transform.rotX = cmd.rotX as number
                  if (cmd.rotY !== undefined) f.transform.rotY = cmd.rotY as number
                }
              }

              // Store shape properties on the field
              const newField = sim.fields.get(id)
              if (newField) {
                // Accept shape as string ('rect'/'circle') or object ({type:'rect', width, height})
                const shapeRaw = cmd.shape || cmd.shapeType
                if (typeof shapeRaw === 'string') {
                  newField.shapeType = shapeRaw as 'circle' | 'rect' | 'screen'
                } else if (shapeRaw && typeof shapeRaw === 'object') {
                  const so = shapeRaw as Record<string, unknown>
                  if (so.type) newField.shapeType = so.type as 'circle' | 'rect' | 'screen'
                  if (so.width !== undefined) newField.w = so.width as number
                  if (so.height !== undefined) newField.h = so.height as number
                  if (so.radius !== undefined) newField.radius = so.radius as number
                }
                // Also accept top-level w/h/radius
                if (cmd.radius !== undefined) newField.radius = cmd.radius as number
                if (cmd.w !== undefined) newField.w = cmd.w as number
                if (cmd.h !== undefined) newField.h = cmd.h as number
                if (cmd.width !== undefined) newField.w = cmd.width as number
                if (cmd.height !== undefined) newField.h = cmd.height as number
                // Visual type for superimposed rendering
                if (cmd.visualType !== undefined) {
                  const vt = cmd.visualType
                  if (typeof vt === 'string') {
                    const resolved = renderer.resolveVisualType(vt)
                    if (resolved !== undefined) {
                      newField.visualType = resolved
                      // Persist the name — numeric IDs shift between sessions
                      newField.visualTypeName = vt
                    }
                  } else if (typeof vt === 'number') {
                    newField.visualType = vt
                  }
                }
                if (cmd.visualParams) {
                  newField.visualParams = cmd.visualParams as [number, number, number, number]
                }
                // Render target assignment
                if (cmd.renderTarget) {
                  newField.properties.set('renderTarget', cmd.renderTarget as string)
                }
                // Sample targets — list of render target names this field reads from
                if (cmd.sampleTargets) {
                  newField.properties.set('sampleTargets', cmd.sampleTargets as string[])
                }
                // Render order for layer stacking
                if (cmd.renderOrder !== undefined) {
                  newField.renderOrder = typeof cmd.renderOrder === 'number' ? cmd.renderOrder : 0
                }
                // NoHit — field renders but doesn't capture mouse clicks
                if (cmd.noHit) {
                  newField.noHit = true
                }
              }

              setBrush(prev => ({ ...prev, activeFieldId: id }))
              syncFields()
              const parentLabel = cmd.parentFieldId ? ` parent=${cmd.parentFieldId}` : ''
              pushTerminal('create_field', id, `'${name}'${parentLabel}`, undefined, cmdAuthor)
              break
            }

            case 'set_tool':
              setBrush(prev => ({ ...prev, tool: cmd.tool as BrushState['tool'] }))
              break

            case 'field_message': {
              const fromField = sim.fields.get(cmd.fromFieldId)
              const toField = sim.fields.get(cmd.toFieldId)
              const fromName = fromField?.name || cmd.fromFieldId
              const toName = toField?.name || cmd.toFieldId
              setDialogLog(prev => [...prev.slice(-99), {
                from: fromName,
                to: toName,
                fromColor: fromField?.color || [0.5, 0.5, 0.5, 1],
                content: cmd.content,
                data: cmd.data,
                timestamp: Date.now(),
              }])
              sim.addMemory(cmd.fromFieldId, {
                timestamp: new Date().toISOString(),
                type: 'message_sent',
                content: `Sent to ${toName}: "${cmd.content}"`,
                sourceFieldId: cmd.toFieldId,
                data: cmd.data,
              })
              sim.addMemory(cmd.toFieldId, {
                timestamp: new Date().toISOString(),
                type: 'message_received',
                content: `From ${fromName}: "${cmd.content}"`,
                sourceFieldId: cmd.fromFieldId,
                data: cmd.data,
              })
              syncFields()
              break
            }

            case 'move': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              field.transform.x += cmd.dx
              field.transform.y += cmd.dy
              syncFields()
              pushTerminal('move', cmd.fieldId, `(${cmd.dx}, ${cmd.dy})`)
              break
            }

            case 'delete_field': {
              const delField = sim.fields.get(cmd.fieldId)
              if (!delField) {
                pushTerminal('delete_field', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const delName = delField.name
              renderer.removeAllFieldEffects(cmd.fieldId)
              sim.removeField(cmd.fieldId)
              syncFields()
              pushTerminal('delete_field', cmd.fieldId, `'${delName}' deleted`)
              break
            }

            case 'set_parent': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) {
                pushTerminal('set_parent', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const success = sim.setParent(cmd.fieldId, cmd.parentFieldId as string | undefined)
              if (success) {
                syncFields()
                pushTerminal('set_parent', cmd.fieldId, cmd.parentFieldId ? `parent=${cmd.parentFieldId}` : 'parent cleared')
              } else {
                pushTerminal('set_parent', cmd.fieldId, `ERROR: invalid parent (not found, cycle, or depth limit exceeded)`)
              }
              break
            }

            case 'set_position': {
              const posField = sim.fields.get(cmd.fieldId)
              if (!posField) break
              sim.setPosition(cmd.fieldId, cmd.x, cmd.y)
              if (cmd.z !== undefined) posField.transform.z = cmd.z as number
              if (cmd.rotX !== undefined) posField.transform.rotX = cmd.rotX as number
              if (cmd.rotY !== undefined) posField.transform.rotY = cmd.rotY as number
              syncFields()
              pushTerminal('set_position', cmd.fieldId, `(${cmd.x}, ${cmd.y}${cmd.z !== undefined ? `, z=${cmd.z}` : ''})`)
              break
            }

            case 'set_color': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              if (Array.isArray(cmd.color) && cmd.color.length >= 3) {
                field.color = [cmd.color[0], cmd.color[1], cmd.color[2], cmd.color[3] ?? 1.0]
              }
              syncFields()
              pushTerminal('set_color', cmd.fieldId, `[${field.color.map((c: number) => c.toFixed(2)).join(', ')}]`)
              break
            }

            case 'set_scale': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              field.transform.scale = (cmd.scale as number) || 1.0
              syncFields()
              pushTerminal('set_scale', cmd.fieldId, `scale=${field.transform.scale.toFixed(2)}`)
              break
            }

            case 'set_order': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              field.renderOrder = typeof cmd.order === 'number' ? cmd.order : 0
              syncFields()
              pushTerminal('set_order', cmd.fieldId, `order=${field.renderOrder}`)
              break
            }

            case 'set_shape': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              const shapeVal = ((cmd as Record<string, unknown>).shape || (cmd as Record<string, unknown>).shapeType) as 'circle' | 'rect' | 'screen' | undefined
              if (shapeVal) field.shapeType = shapeVal
              if ((cmd as Record<string, unknown>).radius !== undefined) field.radius = (cmd as Record<string, unknown>).radius as number
              if ((cmd as Record<string, unknown>).w !== undefined) field.w = (cmd as Record<string, unknown>).w as number
              if ((cmd as Record<string, unknown>).h !== undefined) field.h = (cmd as Record<string, unknown>).h as number
              syncFields()
              const shapeDesc = field.shapeType === 'circle' ? `circle r=${field.radius}` : field.shapeType === 'screen' ? `screen ${field.w}x${field.h}` : `rect ${field.w}x${field.h}`
              pushTerminal('set_shape', cmd.fieldId, shapeDesc)
              break
            }

            case 'set_name': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              const oldName = field.name
              field.name = (cmd.name as string) || field.name
              syncFields()
              pushTerminal('set_name', cmd.fieldId, `"${oldName}" -> "${field.name}"`)
              break
            }


            case 'set_property': {
              const propField = sim.fields.get(cmd.fieldId)
              if (!propField) {
                pushTerminal('set_property', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const key = cmd.key as string
              const value = cmd.value
              if (!key) {
                pushTerminal('set_property', cmd.fieldId, 'ERROR: key required')
                break
              }
              propField.properties.set(key, value)
              syncFields()
              pushTerminal('set_property', cmd.fieldId, `${key} = ${JSON.stringify(value)}`)
              break
            }

            case 'get_properties': {
              const gpField = sim.fields.get(cmd.fieldId)
              if (!gpField) {
                pushTerminal('get_properties', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const props = Object.fromEntries(gpField.properties)
              pushTerminal('get_properties', cmd.fieldId, JSON.stringify(props).substring(0, 200))
              break
            }

            case 'set_world_params': {
              if (!cmd.params || typeof cmd.params !== 'object') break
              sim.setWorldParams(cmd.params)
              if (cmd.params.gravity || cmd.params.friction || cmd.params.collisionForce) {
                if (!sim.running) {
                  sim.running = true
                  setRunning(true)
                }
              }
              syncFields()
              pushTerminal('set_world_params', undefined, JSON.stringify(cmd.params))
              break
            }

            case 'apply_force': {
              sim.applyForce(cmd.fieldId, cmd.fx, cmd.fy)
              if (!sim.running) {
                sim.running = true
                setRunning(true)
              }
              syncFields()
              pushTerminal('apply_force', cmd.fieldId, `(${cmd.fx}, ${cmd.fy})`)
              break
            }

            case 'set_world_data': {
              const wdKeys = (cmd.data && typeof cmd.data === 'object') ? Object.keys(cmd.data) : []
              // Apply to sim.worldData
              if (cmd.data && typeof cmd.data === 'object') {
                Object.assign(sim.worldData, cmd.data)
              }
              // Pipe narrative channel messages into dialog panel
              const narr = cmd.data?.narrative as { channel?: Array<{ author: string; text: string; time?: number }> } | undefined
              if (narr?.channel) {
                const prevLen = (sim.worldData as Record<string, unknown>).__narrativeLen as number || 0
                const newMsgs = narr.channel.slice(prevLen)
                for (const msg of newMsgs) {
                  setDialogLog(prev => [...prev.slice(-99), {
                    from: msg.author || '?',
                    to: 'all',
                    fromColor: msg.author === 'Alpha' ? [0.9, 0.3, 0.1, 1] as [number, number, number, number]
                      : msg.author === 'Beta' ? [0.1, 0.6, 0.9, 1] as [number, number, number, number]
                      : msg.author === 'Gamma' ? [0.2, 0.9, 0.4, 1] as [number, number, number, number]
                      : [0.7, 0.7, 0.7, 1] as [number, number, number, number],
                    content: msg.text,
                    timestamp: Date.now(),
                  }])
                }
                ;(sim.worldData as Record<string, unknown>).__narrativeLen = narr.channel.length
              }
              pushTerminal('set_world_data', cmd.fieldId, wdKeys.join(', ') || '(no data)')
              break
            }

            case 'define_interaction': {
              // Route: if cmd.wgsl is present, this is a superimposed interaction (a + b = c)
              if (cmd.wgsl) {
                const name = cmd.name as string
                const wgsl = cmd.wgsl as string
                const fieldA = cmd.fieldA as string
                const fieldB = cmd.fieldB as string
                if (!name) { pushTerminal('define_interaction', '', 'ERROR: name required'); break }
                if (!fieldA || !fieldB) { pushTerminal('define_interaction', name, 'ERROR: fieldA and fieldB required'); break }
                const expectedFn = `interaction_${name}`
                if (!wgsl.includes(expectedFn)) {
                  pushTerminal('define_interaction', name, `ERROR: WGSL must define fn ${expectedFn}(uvA: vec2f, uvB: vec2f, colorA: vec4f, colorB: vec4f, time: f32) -> vec4f`)
                  break
                }
                const result = renderer.registerInteraction(name, wgsl)
                // Resolve optional propagation type
                const propagationName = cmd.propagation as string | undefined
                const propagationTypeId = propagationName ? renderer.resolvePropagation(propagationName) : undefined
                if (!sim.interactionPairs) sim.interactionPairs = []
                sim.interactionPairs = sim.interactionPairs.filter((p: { name: string }) => p.name !== name)
                sim.interactionPairs.push({ name, fieldA, fieldB, interactionTypeId: result.id, propagationTypeId })
                const propLabel = propagationName ? ` propagation: ${propagationName}` : ''
                pushTerminal('define_interaction', name, `${fieldA} + ${fieldB} = ${name} (type ${result.id})${propLabel}`, undefined, cmdAuthor)
                break
              }
              // Legacy: interaction rule system
              const rule = cmd.rule
              if (!rule || !rule.trigger || !rule.effect) {
                pushTerminal('define_interaction', (rule as Record<string, unknown>)?.definedBy as string, 'ERROR: missing trigger or effect')
                break
              }
              const ruleId = sim.addInteractionRule({
                id: (rule as Record<string, unknown>).id as string || '',
                definedBy: rule.definedBy || 'unknown',
                trigger: rule.trigger,
                triggerDistance: rule.triggerDistance,
                fieldA: rule.fieldA,
                fieldB: rule.fieldB,
                effect: rule.effect,
                effectParams: rule.effectParams || {},
                description: rule.description,
              })
              if (!sim.running) {
                sim.running = true
                setRunning(true)
              }
              syncFields()
              pushTerminal('define_interaction', rule.definedBy, rule.description || `${rule.trigger} → ${rule.effect}`, `rule_id: ${ruleId}`)
              break
            }

            case 'remove_interaction': {
              if (cmd.ruleId) {
                sim.removeInteractionRule(cmd.ruleId)
                syncFields()
                pushTerminal('remove_interaction', undefined, cmd.ruleId)
              }
              break
            }

            case 'add_interaction_effect': {
              const ixWgsl = ((cmd as Record<string, unknown>).wgsl || (cmd as Record<string, unknown>).glsl) as string
              if (!ixWgsl) {
                pushTerminal('add_interaction_effect', (cmd as Record<string, unknown>).author as string, 'ERROR: wgsl required')
                break
              }
              // Validate the wrapped WGSL before adding
              const wrappedWgsl = wrapInteractionWgsl(ixWgsl)
              const testKey = `ix_validate_${Date.now()}`
              const compileResult = await renderer.compileFieldEffect(testKey, testKey, wrappedWgsl, getModCode())
              if (!compileResult.success) {
                pushTerminal('add_interaction_effect', (cmd as Record<string, unknown>).author as string, `WGSL error: ${compileResult.error}`)
                renderer.removeFieldEffect(testKey)
                renderer.removeFieldMask(testKey)
                break
              }
              // Clean up validation program — real programs are compiled per-pair in the frame loop
              renderer.removeFieldEffect(testKey)
              renderer.removeFieldMask(testKey)

              const effectId = sim.addInteractionEffect({
                author: (cmd as Record<string, unknown>).author as string || 'unknown',
                fieldA: (cmd as Record<string, unknown>).fieldA as string || null,
                fieldB: (cmd as Record<string, unknown>).fieldB as string || null,
                wgsl: ixWgsl,
                description: (cmd as Record<string, unknown>).description as string || '',
                blend: ((cmd as Record<string, unknown>).blend as 'alpha' | 'additive' | 'multiply') || 'alpha',
                spread: (cmd as Record<string, unknown>).spread as number || 0,
                order: (cmd as Record<string, unknown>).order as number || 0,
                precedence: !!(cmd as Record<string, unknown>).precedence,
                hooks: ((cmd as Record<string, unknown>).hooks as InteractionEffect['hooks'] || [])
                  ?.filter(h => h.type !== 'webhook') || undefined,
              })
              const fieldALabel = (cmd as Record<string, unknown>).fieldA as string || 'any'
              const fieldBLabel = (cmd as Record<string, unknown>).fieldB as string || 'any'
              pushTerminal('add_interaction_effect', (cmd as Record<string, unknown>).author as string,
                (cmd as Record<string, unknown>).description as string || `${fieldALabel} × ${fieldBLabel}`,
                `id: ${effectId}`, cmdAuthor)
              syncFields()
              break
            }

            case 'remove_interaction_effect': {
              const effectId = (cmd as Record<string, unknown>).effectId as string
              if (effectId) {
                sim.removeInteractionEffect(effectId)
                // Clean up any compiled per-pair programs for this effect
                for (const key of Array.from(renderer.getFieldEffectKeys())) {
                  if (key.startsWith(`ix_${effectId}_`)) {
                    renderer.removeFieldEffect(key)
                    renderer.removeFieldMask(key)
                  }
                }
                syncFields()
                pushTerminal('remove_interaction_effect', undefined, effectId)
              }
              break
            }

            case 'define_command': {
              const cmdDef = cmd.command
              if (!cmdDef || !cmdDef.name || !cmdDef.macro || cmdDef.macro.length === 0) {
                pushTerminal('define_command', cmdDef?.definedBy, 'ERROR: name and macro required')
                break
              }
              sim.addCustomCommand({
                name: cmdDef.name,
                definedBy: cmdDef.definedBy || 'unknown',
                description: cmdDef.description || '',
                macro: cmdDef.macro,
              })
              pushTerminal('define_command', cmdDef.definedBy, `"${cmdDef.name}" (${cmdDef.macro.length} steps)`)
              break
            }

            case 'execute_command': {
              const customCmd = sim.getCustomCommand(cmd.name)
              pushTerminal('execute_command', customCmd?.definedBy, `"${cmd.name}" — ${customCmd ? `${customCmd.macro.length} steps (expanded by bridge)` : 'unknown command'}`)
              break
            }

            case 'add_step_hook':
            case 'remove_step_hook': {
              // JS step hooks blocked from bridge API — use GPU step hooks instead
              pushTerminal(cmd.type, cmd.author, 'ERROR: JS step hooks are admin-only. Use add_gpu_step_hook for sandboxed GPU hooks.', undefined, cmdAuthor)
              break
            }

            case 'add_gpu_step_hook': {
              if (!cmd.hookId && cmd.name) cmd.hookId = cmd.name
              const wgsl = cmd.wgsl as string
              if (!cmd.hookId || !wgsl) {
                pushTerminal('add_gpu_step_hook', cmd.author, 'ERROR: hookId and wgsl required', undefined, cmdAuthor)
                break
              }
              const gpuErr = sim.addGpuStepHook(cmd.hookId, cmd.author || 'unknown', cmd.description || '', wgsl, cmd.order as number | undefined)
              if (!gpuErr) {
                if (!sim.running) { sim.running = true; setRunning(true) }
                pushTerminal('add_gpu_step_hook', cmd.author, `"${cmd.hookId}": ${cmd.description || 'GPU step hook added'}`, wgsl, cmdAuthor)
              } else {
                pushTerminal('add_gpu_step_hook', cmd.author, `ERROR for "${cmd.hookId}": ${gpuErr}`, wgsl, cmdAuthor)
              }
              syncFields()
              break
            }

            case 'remove_gpu_step_hook': {
              if (cmd.hookId) {
                sim.removeGpuStepHook(cmd.hookId)
                pushTerminal('remove_gpu_step_hook', undefined, `removed GPU hook ${cmd.hookId}`)
              }
              break
            }

            case 'add_state_shader': {
              // GPU state update shader — runs each frame via render-to-texture ping-pong
              // Agent provides cellUpdate(coord, state, color, time, dt) function
              const stateShader = (cmd.wgsl || cmd.glsl) as string
              if (stateShader) {
                const stateResult = await renderer.compileStateUpdate(stateShader, getModCode())
                if (stateResult.success) {
                  pushTerminal('add_state_shader', cmd.fieldId, cmd.description || 'state update shader active', stateShader, cmd.author as string)
                } else {
                  pushTerminal('add_state_shader', cmd.fieldId, `STATE SHADER COMPILE ERROR: ${stateResult.error?.substring(0, 100)}`)
                  sim.worldData['last_compile_error'] = {
                    type: 'state_shader',
                    error: stateResult.error,
                    timestamp: Date.now()
                  }
                }
              }
              break
            }

            case 'remove_state_shader': {
              renderer.removeStateUpdate()
              pushTerminal('remove_state_shader', undefined, 'state update shader removed')
              break
            }

            case 'clone_field': {
              const sourceField = sim.fields.get(cmd.fieldId)
              if (!sourceField) {
                pushTerminal('clone_field', cmd.fieldId, 'ERROR: source field not found')
                break
              }
              const cloneId = genFieldId()
              const cloneName = (cmd.name as string) || `${sourceField.name} (clone)`
              const cloneColor = (cmd.color as [number, number, number, number]) || [...sourceField.color] as [number, number, number, number]

              sim.createField(cloneId, cloneName, cloneColor)
              
              // Copy position with optional offset
              const offsetX = (cmd.offsetX as number) || 30
              const offsetY = (cmd.offsetY as number) || 0
              sim.setPosition(cloneId, sourceField.transform.x + offsetX, sourceField.transform.y + offsetY)
              
              // Clone effects
              for (const effect of sourceField.effects) {
                const newEffectId = genEffectId()
                const programKey = `${cloneId}_${newEffectId}`
                const result = await renderer.compileFieldEffect(programKey, cloneId, effect.wgsl, getModCode())
                if (result.success) {
                  sim.addFieldEffect(cloneId, {
                    id: newEffectId,
                    author: effect.author,
                    wgsl: effect.wgsl,
                    description: effect.description,
                    blend: effect.blend,
                    order: effect.order,
                    feedback: effect.feedback,
                  })
                }
              }
              
              syncFields()
              pushTerminal('clone_field', cmd.fieldId, `cloned as '${cloneName}' (id: ${cloneId})`)
              break
            }

            case 'list_fields': {
              const fieldList = Array.from(sim.fields.values()).map(f => {
                return `${f.name} [${f.id}] at (${f.transform.x.toFixed(0)},${f.transform.y.toFixed(0)}) effects=${f.effects.length}`
              })
              pushTerminal('list_fields', undefined, `${sim.fields.size} fields`, fieldList.join('\n'))
              break
            }

            // --- Lightweight effect commands (no field creation) ---
            case 'spawn_effect': {
              const ex = cmd.x as number, ey = cmd.y as number
              const et = (cmd.effectType as number) || 1
              const ec = (cmd.color as number) || 0.5
              const es2 = (cmd.size as number) || 2
              const ei = (cmd.intensity as number) || 1.0
              if (cmd.offsets && Array.isArray(cmd.offsets)) {
                sim.stampEffectShape(ex, ey, cmd.offsets as [number, number][], et, ec, 1.0, ei)
              } else {
                sim.stampEffectCircle(ex, ey, es2, et, ec, 1.0, ei)
              }
              break
            }

            case 'spawn_projectile': {
              const px = cmd.x as number, py = cmd.y as number
              const pvx = (cmd.vx as number) || 0, pvy = (cmd.vy as number) || 0
              const pt = (cmd.effectType as number) || 1
              const pc = (cmd.color as number) || 0.5
              const ps = (cmd.size as number) || 2
              const pi = (cmd.intensity as number) || 1.0
              const pl = (cmd.lifetime as number) || 3.0
              sim.spawnProjectile(px, py, pvx, pvy, pt, pc, ps, pi, pl)
              break
            }

            case 'clear_effects': {
              const cx = cmd.x as number, cy = cmd.y as number
              const cr = (cmd.radius as number) || 50
              sim.clearEffects(cx, cy, cr)
              break
            }

            // --- WGSL Mod commands ---
            case 'register_wgsl_mod':
            case 'register_glsl_mod': {
              const modId = cmd.id as string
              const modCode = cmd.code as string
              if (!modId || !modCode) {
                pushTerminal('register_wgsl_mod', undefined, 'ERROR: id and code required')
                break
              }
              wgslModsRef.current.set(modId, { id: modId, code: modCode })
              pushTerminal('register_wgsl_mod', undefined, `Registered mod "${modId}" (${modCode.length} chars)`)
              break
            }

            case 'remove_wgsl_mod':
            case 'remove_glsl_mod': {
              const modId = cmd.id as string
              if (!modId) {
                pushTerminal('remove_wgsl_mod', undefined, 'ERROR: id required')
                break
              }
              const existed = wgslModsRef.current.delete(modId)
              pushTerminal('remove_wgsl_mod', undefined, existed ? `Removed mod "${modId}"` : `Mod "${modId}" not found`)
              break
            }

            case 'sample_region': {
              const srX = cmd.x as number ?? 256
              const srY = cmd.y as number ?? 256
              const srRadius = Math.min(cmd.radius as number ?? 16, 64) // cap at 64
              const srResult = sim.sampleRegion(srX, srY, srRadius)
              pushTerminal('sample_region', undefined, `(${srX},${srY}) r=${srRadius}: ${srResult.uniqueFieldIds.length} fields, avg=(${srResult.avgColor.map(c => c.toFixed(2)).join(',')})`)
              break
            }

            // ─── Game Engine Commands ───

            case 'set_camera': {
              if (cmd.follow) {
                cameraFollowRef.current = {
                  targetFieldId: cmd.follow as string,
                  smoothing: (cmd.smoothing as number) ?? 0.1,
                  offsetX: (cmd.offsetX as number) ?? 0,
                  offsetY: (cmd.offsetY as number) ?? 0,
                  deadZone: (cmd.deadZone as number) ?? 5,
                }
                pushTerminal('set_camera', cmd.follow as string, `following, smoothing=${cameraFollowRef.current.smoothing}`)
              } else if (cmd.follow === null || cmd.follow === false) {
                cameraFollowRef.current = null
                pushTerminal('set_camera', undefined, 'follow disabled')
              }
              if (cmd.x !== undefined && cmd.y !== undefined) {
                cameraRef.current.x = cmd.x as number
                cameraRef.current.y = cmd.y as number
              }
              if (cmd.zoom !== undefined) {
                cameraRef.current.zoom = Math.max(0.1, Math.min(10, cmd.zoom as number))
              }
              break
            }

            case 'save_scene': {
              const sceneName = cmd.name as string
              if (!sceneName) { pushTerminal('save_scene', undefined, 'ERROR: name required'); break }
              const sceneData = {
                name: sceneName,
                fields: sim.generateSnapshots(),
                worldParams: sim.getWorldParams(),
                worldData: { ...sim.worldData },
                stepHooks: sim.getStepHookSnapshots(),
                interactionRules: [...sim.interactionRules],
                interactionEffects: [...sim.interactionEffects],
                // Quarantined visuals are not persisted — a broken shader must not
            // circulate through the store forever, costing every fresh session
            // an isolation sweep. A fixed re-register clears the flag.
            visualTypes: renderer ? renderer.getAllVisualTypes().filter(vt => !vt.broken).map(vt => ({ name: vt.name, wgsl: vt.wgsl })) : [],
                modules: renderer ? renderer.getAllModules().map(m => ({ name: m.name, wgsl: m.wgsl })) : [],
                timestamp: Date.now(),
              }
              try {
                await fetch('/api/engine/scene', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'save', name: sceneName, scene: sceneData }),
                })
                pushTerminal('save_scene', undefined, `"${sceneName}" saved (${sceneData.fields.length} fields)`)
              } catch { pushTerminal('save_scene', undefined, `ERROR: failed to save "${sceneName}"`) }
              break
            }

            case 'load_scene': {
              const sceneName = cmd.name as string
              if (!sceneName) { pushTerminal('load_scene', undefined, 'ERROR: name required'); break }
              try {
                const resp = await fetch(`/api/engine/scene?name=${encodeURIComponent(sceneName)}`)
                const { scene } = await resp.json()
                if (!scene) { pushTerminal('load_scene', undefined, `ERROR: scene "${sceneName}" not found`); break }

                // Clear current state
                for (const field of sim.fields.values()) {
                  renderer.removeAllFieldEffects(field.id)
                }
                for (const key of Array.from(renderer.getFieldEffectKeys())) {
                  if (key.startsWith('ix_')) { renderer.removeFieldEffect(key); renderer.removeFieldMask(key) }
                }
                sim.clearAll()
                sim.fields.clear()
                sim.interactionRules = []
                sim.interactionEffects = []
                sim.stepHooks.clear()
                sim.tweens.clear()
                sim.timers.clear()
                sim.collisionCallbacks.clear()
                cachedOverlapMasksRef.current = new Map()

                // a loaded scene starts framed whole, not wherever the camera
                // was. CONTAIN, not cover: zoom = 1 shows the full grid on the
                // short axis at any resolution (see the fit effect above).
                cameraRef.current = { x: gridSize / 2, y: gridSize / 2, zoom: 1 }

                // Restore visual types and modules first
                if (scene.visualTypes) {
                  for (const vt of scene.visualTypes) {
                    renderer.registerVisualType(vt.name, vt.wgsl)
                  }
                }
                if (scene.modules) {
                  for (const m of scene.modules) {
                    renderer.registerModule(m.name, m.wgsl)
                  }
                }

                // Restore scene
                sim.restoreFromSnapshots(scene.fields || [])
                // Name is authoritative — resolve visual types against this
                // session's registry (numeric IDs shift between sessions)
                for (const field of sim.fields.values()) {
                  if (field.visualTypeName) {
                    const runtimeId = renderer.resolveVisualType(field.visualTypeName)
                    if (runtimeId !== undefined) field.visualType = runtimeId
                  }
                }
                if (scene.worldParams) sim.setWorldParams(scene.worldParams)
                if (scene.worldData) Object.assign(sim.worldData, scene.worldData)
                // Transient input state must never arrive via a scene
                for (const k of Object.keys(sim.worldData)) {
                  if (k.startsWith('key_') || k.startsWith('mouse_')) delete sim.worldData[k]
                }
                if (scene.interactionRules) sim.interactionRules = scene.interactionRules
                if (scene.interactionEffects) {
                  for (const ie of scene.interactionEffects) sim.addInteractionEffect(ie)
                }
                if (scene.stepHooks) {
                  for (const h of scene.stepHooks) sim.addStepHook(h.id, h.author, h.description, h.code)
                  // A scene with logic should boot running (game cartridges)
                  if (scene.stepHooks.length > 0 && !sim.running) {
                    sim.running = true
                    setRunning(true)
                  }
                }

                // Recompile effects
                for (const field of sim.fields.values()) {
                  for (const effect of field.effects) {
                    const programKey = `${field.id}_${effect.id}`
                    await renderer.compileFieldEffect(programKey, field.id, effect.wgsl, getModCode())
                  }
                }

                updateSelectionMask(null)
                syncFields()
                pushTerminal('load_scene', undefined, `"${sceneName}" loaded (${scene.fields?.length || 0} fields)`)
              } catch { pushTerminal('load_scene', undefined, `ERROR: failed to load "${sceneName}"`) }
              break
            }

            case 'list_scenes': {
              try {
                const resp = await fetch('/api/engine/scene?action=list')
                const { scenes } = await resp.json()
                pushTerminal('list_scenes', undefined, `${(scenes as string[])?.length || 0} scenes`, (scenes as string[])?.join(', ') || 'none')
              } catch { pushTerminal('list_scenes', undefined, 'ERROR: failed to list scenes') }
              break
            }

            case 'delete_scene': {
              const sceneName = cmd.name as string
              if (!sceneName) { pushTerminal('delete_scene', undefined, 'ERROR: name required'); break }
              try {
                await fetch('/api/engine/scene', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: sceneName }),
                })
                pushTerminal('delete_scene', undefined, `"${sceneName}" deleted`)
              } catch { pushTerminal('delete_scene', undefined, `ERROR: failed to delete "${sceneName}"`) }
              break
            }

            case 'play_sound': {
              const audio = audioRef.current
              if (cmd.id && audio.hasSound(cmd.id as string)) {
                audio.play(cmd.id as string, (cmd.volume as number) ?? 1.0, (cmd.pitch as number) ?? 1.0)
                pushTerminal('play_sound', undefined, `"${cmd.id}"`)
              } else if (cmd.frequency) {
                audio.beep(cmd.frequency as number, (cmd.duration as number) ?? 0.2, (cmd.volume as number) ?? 0.5, (cmd.type as OscillatorType) ?? 'sine')
                pushTerminal('play_sound', undefined, `beep ${cmd.frequency}Hz`)
              } else {
                pushTerminal('play_sound', undefined, 'ERROR: id or frequency required')
              }
              break
            }

            case 'load_sound': {
              if (!cmd.id || !cmd.url) { pushTerminal('load_sound', undefined, 'ERROR: id and url required'); break }
              const loaded = await audioRef.current.loadSound(cmd.id as string, cmd.url as string)
              pushTerminal('load_sound', undefined, loaded ? `"${cmd.id}" loaded` : `ERROR: failed to load "${cmd.id}"`)
              break
            }

            case 'set_volume': {
              audioRef.current.setVolume((cmd.volume as number) ?? 1.0)
              pushTerminal('set_volume', undefined, `${audioRef.current.getVolume().toFixed(2)}`)
              break
            }

            case 'set_game_state': {
              const stateName = cmd.state as string
              if (!stateName) { pushTerminal('set_game_state', undefined, 'ERROR: state required'); break }
              sim.setGameState(stateName)
              pushTerminal('set_game_state', undefined, `→ "${stateName}"`)
              break
            }

            case 'define_game_state': {
              const stateName = cmd.name as string
              if (!stateName) { pushTerminal('define_game_state', undefined, 'ERROR: name required'); break }
              sim.defineGameState(stateName, {
                name: stateName,
                onEnter: cmd.onEnter as string | undefined,
                onExit: cmd.onExit as string | undefined,
                pausePhysics: !!(cmd.pausePhysics),
              })
              pushTerminal('define_game_state', undefined, `"${stateName}" defined${cmd.pausePhysics ? ' (pauses physics)' : ''}`)
              break
            }

            case 'add_tag': {
              const fieldId = cmd.fieldId as string
              const tags = cmd.tags as string[]
              if (!fieldId || !tags?.length) { pushTerminal('add_tag', cmd.fieldId, 'ERROR: fieldId and tags required'); break }
              sim.addTag(fieldId, tags)
              syncFields()
              pushTerminal('add_tag', fieldId, tags.join(', '))
              break
            }

            case 'remove_tag': {
              const fieldId = cmd.fieldId as string
              const tags = cmd.tags as string[]
              if (!fieldId || !tags?.length) { pushTerminal('remove_tag', cmd.fieldId, 'ERROR: fieldId and tags required'); break }
              sim.removeTag(fieldId, tags)
              syncFields()
              pushTerminal('remove_tag', fieldId, tags.join(', '))
              break
            }

            case 'set_visual': {
              const fieldId = cmd.fieldId as string
              if (!fieldId) { pushTerminal('set_visual', '', 'ERROR: fieldId required'); break }
              const field = sim.fields.get(fieldId)
              if (!field) { pushTerminal('set_visual', fieldId, 'ERROR: field not found'); break }
              const vt = cmd.visualType
              if (vt !== undefined) {
                if (typeof vt === 'string') {
                  const resolved = renderer.resolveVisualType(vt)
                  if (resolved !== undefined) {
                    field.visualType = resolved
                    field.visualTypeName = vt
                  }
                } else if (typeof vt === 'number') {
                  field.visualType = vt
                } else if (vt === null) {
                  field.visualType = undefined
                  field.visualTypeName = undefined
                }
              }
              if (cmd.visualParams !== undefined) {
                field.visualParams = cmd.visualParams as [number, number, number, number]
              }
              if (cmd.renderTarget !== undefined) {
                if (cmd.renderTarget === null) {
                  field.properties.delete('renderTarget')
                } else {
                  field.properties.set('renderTarget', cmd.renderTarget as string)
                }
              }
              if (cmd.sampleTargets !== undefined) {
                if (cmd.sampleTargets === null) {
                  field.properties.delete('sampleTargets')
                } else {
                  field.properties.set('sampleTargets', cmd.sampleTargets as string[])
                }
              }
              if (cmd.renderOrder !== undefined) {
                field.renderOrder = typeof cmd.renderOrder === 'number' ? cmd.renderOrder : 0
              }
              syncFields()
              pushTerminal('set_visual', fieldId, `type=${field.visualType} order=${field.renderOrder ?? 0}`, undefined, cmdAuthor)
              break
            }

            case 'define_visual': {
              const name = cmd.name as string
              const wgsl = cmd.wgsl as string
              if (!name) { pushTerminal('define_visual', '', 'ERROR: name required'); break }
              if (!wgsl) { pushTerminal('define_visual', name, 'ERROR: wgsl required'); break }
              // Validate function name matches
              const expectedFn = `visual_${name}`
              if (!wgsl.includes(expectedFn)) {
                pushTerminal('define_visual', name, `ERROR: WGSL must define fn ${expectedFn}(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f`)
                break
              }
              const result = renderer.registerVisualType(name, wgsl)
              pushTerminal('define_visual', name, `registered as type ${result.id}`, undefined, cmdAuthor)
              // Force-compile uber-shader and report result back to server
              const dvCommandId = data.id as string | undefined
              ;(async () => {
                const compileStatus = await renderer.compileSuperPipeline()
                const compileErr = compileStatus.error
                const curSim = simulationRef.current
                if (compileErr) {
                  if (curSim) {
                    curSim.worldData['last_compile_error'] = {
                      type: 'uber_shader',
                      visualName: name,
                      error: compileErr,
                      timestamp: Date.now(),
                    }
                  }
                  pushTerminal('define_visual', name, `COMPILE ERROR: ${compileErr.substring(0, 200)}`)
                  showToast(`Shader "${name}" failed to compile`, 'error')
                } else if (curSim && curSim.worldData['last_compile_error']) {
                  delete curSim.worldData['last_compile_error']
                }
                // Send compile result back to server for bridge API response
                if (dvCommandId) {
                  try {
                    await fetch('/api/engine/compile-result', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        commandId: dvCommandId,
                        result: compileErr
                          ? { ok: false, error: compileErr }
                          : { ok: true, visualName: name, typeId: result.id },
                      }),
                    })
                  } catch { /* best-effort */ }
                }
              })()
              break
            }

            case 'undo_visual': {
              const name = cmd.name as string
              if (!name) { pushTerminal('undo_visual', '', 'ERROR: name required'); break }
              // undo_visual arrives as define_visual from bridge (with restored WGSL)
              // This case handles direct SSE delivery if ever sent raw
              pushTerminal('undo_visual', name, 'no WGSL — use define_visual path')
              break
            }

            case 'define_propagation': {
              const name = cmd.name as string
              const wgsl = cmd.wgsl as string
              if (!name) { pushTerminal('define_propagation', '', 'ERROR: name required'); break }
              if (!wgsl) { pushTerminal('define_propagation', name, 'ERROR: wgsl required'); break }
              const expectedFn = `propagation_${name}`
              if (!wgsl.includes(expectedFn)) {
                pushTerminal('define_propagation', name, `ERROR: WGSL must define fn ${expectedFn}(srcColor: vec4f, offset: vec2f, dist: f32, time: f32) -> vec4f`)
                break
              }
              const result = renderer.registerPropagation(name, wgsl)
              pushTerminal('define_propagation', name, `registered as type ${result.id}`, undefined, cmdAuthor)
              break
            }

            case 'define_module': {
              const name = cmd.name as string
              const wgsl = cmd.wgsl as string
              if (!name) { pushTerminal('define_module', '', 'ERROR: name required'); break }
              if (!wgsl) { pushTerminal('define_module', name, 'ERROR: wgsl required'); break }
              const expectedFn = `mod_${name}`
              if (!wgsl.includes(expectedFn)) {
                pushTerminal('define_module', name, `ERROR: WGSL must define fn ${expectedFn}(...)`)
                break
              }
              renderer.registerModule(name, wgsl)
              pushTerminal('define_module', name, 'registered', undefined, cmdAuthor)
              break
            }

            case 'create_render_target': {
              const name = cmd.name as string
              if (!name) { pushTerminal('create_render_target', '', 'ERROR: name required'); break }
              const result = renderer.createRenderTarget(name)
              if (result.error) {
                pushTerminal('create_render_target', name, `ERROR: ${result.error}`)
              } else {
                pushTerminal('create_render_target', name, `created (id=${result.id})`, undefined, cmdAuthor)
              }
              break
            }

            case 'destroy_render_target': {
              const name = cmd.name as string
              if (!name) { pushTerminal('destroy_render_target', '', 'ERROR: name required'); break }
              renderer.destroyRenderTarget(name)
              pushTerminal('destroy_render_target', name, 'destroyed', undefined, cmdAuthor)
              break
            }

            case 'add_timer': {
              const timerId = cmd.id as string || cmd.timerId as string
              const hookId = cmd.hookId as string
              const delay = cmd.delay as number
              if (!timerId || !hookId || !delay) { pushTerminal('add_timer', undefined, 'ERROR: id, hookId, and delay required'); break }
              sim.addTimer(timerId, hookId, delay, !!(cmd.repeat))
              if (!sim.running) { sim.running = true; setRunning(true) }
              pushTerminal('add_timer', undefined, `"${timerId}" → hook "${hookId}" after ${delay}s${cmd.repeat ? ' (repeat)' : ''}`)
              break
            }

            case 'remove_timer': {
              const timerId = cmd.id as string || cmd.timerId as string
              if (!timerId) { pushTerminal('remove_timer', undefined, 'ERROR: id required'); break }
              sim.removeTimer(timerId)
              pushTerminal('remove_timer', undefined, `"${timerId}" removed`)
              break
            }

            case 'fire_event': {
              const eventName = cmd.event as string || cmd.name as string
              if (!eventName) { pushTerminal('fire_event', undefined, 'ERROR: event/name required'); break }
              sim.fireEvent(eventName, cmd.data as Record<string, unknown> | undefined)
              pushTerminal('fire_event', undefined, `"${eventName}"`)
              break
            }

            case 'add_collision_callback': {
              const cbId = cmd.id as string
              if (!cbId) { pushTerminal('add_collision_callback', undefined, 'ERROR: id required'); break }
              sim.addCollisionCallback({
                id: cbId,
                matchA: (cmd.matchA as { fieldId?: string; tag?: string }) || {},
                matchB: (cmd.matchB as { fieldId?: string; tag?: string }) || {},
                onEnter: cmd.onEnter as string | undefined,
                onExit: cmd.onExit as string | undefined,
                onStay: cmd.onStay as string | undefined,
              })
              if (!sim.running) { sim.running = true; setRunning(true) }
              pushTerminal('add_collision_callback', undefined, `"${cbId}" registered`)
              break
            }

            case 'remove_collision_callback': {
              const cbId = cmd.id as string
              if (!cbId) { pushTerminal('remove_collision_callback', undefined, 'ERROR: id required'); break }
              sim.removeCollisionCallback(cbId)
              pushTerminal('remove_collision_callback', undefined, `"${cbId}" removed`)
              break
            }

            case 'tween': {
              const tweenId = cmd.id as string || `tween_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              const fieldId = cmd.fieldId as string
              const property = cmd.property as string
              const to = cmd.to as number
              const duration = cmd.duration as number
              if (!fieldId || !property || to === undefined || !duration) {
                pushTerminal('tween', cmd.fieldId, 'ERROR: fieldId, property, to, and duration required')
                break
              }
              sim.addTween(tweenId, fieldId, property, to, duration, (cmd.easing as 'linear' | 'easeIn' | 'easeOut' | 'easeInOut') || 'linear', cmd.onComplete as string | undefined)
              if (!sim.running) { sim.running = true; setRunning(true) }
              pushTerminal('tween', fieldId, `${property} → ${to} over ${duration}s (${cmd.easing || 'linear'})`)
              break
            }

            case 'cancel_tween': {
              const tweenId = cmd.id as string
              if (!tweenId) { pushTerminal('cancel_tween', undefined, 'ERROR: id required'); break }
              sim.cancelTween(tweenId)
              pushTerminal('cancel_tween', undefined, `"${tweenId}" cancelled`)
              break
            }

            case 'status':
              pushTerminal('status', undefined, `fields=${sim.fields.size} running=${sim.running} effects=${sim.getFieldsWithEffects().length} rules=${sim.interactionRules.length} projectiles=${sim.projectiles.length} mods=${wgslModsRef.current.size} tweens=${sim.tweens.size} timers=${sim.timers.size} gameState=${sim.gameState || 'none'}`)
              break
          }
        } catch (err) {
          console.error('Agent command error:', err)
        }
      }

      es.onerror = () => {
        setAgentConnected(false)
        es?.close()
        // Retry in 5s
        retryTimeout = setTimeout(connect, 5000)
      }
      lastSSEMsgRef.current = Date.now()
    }

    connect()

    // Watchdog: the server pings every 15s — 40s of silence means the stream
    // died without an error event (HMR orphan, dropped socket). Reconnect.
    const watchdog = setInterval(() => {
      if (Date.now() - lastSSEMsgRef.current > 40_000) {
        setAgentConnected(false)
        try { es?.close() } catch { /* already dead */ }
        lastSSEMsgRef.current = Date.now()
        connect()
      }
    }, 10_000)

    return () => {
      clearTimeout(retryTimeout)
      clearInterval(watchdog)
      es?.close()
      setAgentConnected(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Intentionally empty — refs handle the mutable state

  // Periodic state sync — push field snapshots to server every 2s
  // For space mode: only the owner syncs state back to the DB
  useEffect(() => {
    // Visitors in a space don't sync state back
    if (spaceId && !isOwner) return

    const interval = setInterval(async () => {
      if (playScene) return   // play sessions never write back
      // A hidden tab is paused — it must not renew the writer lease with frozen state
      if (document.hidden) return
      const sim = simulationRef.current
      if (!sim || sim.fields.size === 0) return
      try {
        // Enrich worldData with cell presence samples for agents
        sim.worldData['cellSample'] = {
          center: sim.getCellInfo(256, 256),
          fieldSamples: Object.fromEntries(
            Array.from(sim.fields.values()).map(f => [
              f.id,
              sim.getCellInfo(Math.round(f.transform.x), Math.round(f.transform.y))
            ])
          ),
        }

        const renderer = rendererRef.current
        // Transient input state (keys, mouse) must never persist — a synced
        // held-down key becomes a stuck ghost key in every restored session
        const syncWorldData = Object.fromEntries(
          Object.entries(sim.worldData).filter(([k]) => !k.startsWith('key_') && !k.startsWith('mouse_'))
        )
        const syncRes = await fetch('/api/engine/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientIdRef.current,
            takeover: takeoverRef.current,
            fields: sim.generateSnapshots(),
            worldParams: sim.getWorldParams(),
            stepHooks: sim.getStepHookSnapshots(),
            worldData: syncWorldData,
            renderedSamples: Object.fromEntries(renderedSamplesRef.current),
            interactionEffects: sim.interactionEffects,
            // Quarantined visuals are not persisted — a broken shader must not
            // circulate through the store forever, costing every fresh session
            // an isolation sweep. A fixed re-register clears the flag.
            visualTypes: renderer ? renderer.getAllVisualTypes().filter(vt => !vt.broken).map(vt => ({ name: vt.name, wgsl: vt.wgsl })) : [],
            modules: renderer ? renderer.getAllModules().map(m => ({ name: m.name, wgsl: m.wgsl })) : [],
            // Space-scoped sync
            ...(spaceId ? { spaceId } : {}),
          }),
        })
        if (syncRes.status === 409) {
          setWorldLocked(true)
        } else if (syncRes.ok) {
          takeoverRef.current = false
          setWorldLocked(false)
        }
      } catch { /* best-effort */ }
    }, 2000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, isOwner])

  // Auto-save removed — scenes are saved manually via Save button

  // Cradle bridge — when worldData.cradleBridge is truthy, poll the Mirror
  // cradle viewer (localhost:3334) and drive any field named "Cradle*":
  // visualParams = [vocabulary, thread activity, champion pulse, dream mode],
  // field name = the Cradle's latest utterance. Data-plane only.
  useEffect(() => {
    let prevStats: { threadConnections?: number; lifetimeChampions?: number } | null = null
    const interval = setInterval(async () => {
      const sim = simulationRef.current
      if (!sim || !sim.worldData['cradleBridge']) return
      const fields = Array.from(sim.fields.values()).filter(f => f.name?.startsWith('Cradle'))
      if (fields.length === 0) return
      // Champion pulse decays between polls
      const vp = fields[0].visualParams || [0.6, 0.6, 0, 0]
      const next: [number, number, number, number] = [vp[0] || 0.6, vp[1] || 0.6, Math.max(0, (vp[2] || 0) - 0.35), vp[3] || 0]
      let utterance: string | null = null
      try {
        const stats = await fetch('http://localhost:3334/api/stats').then(r => r.json())
        next[0] = Math.min(1, (stats.vocabulary || 0) / 24000)
        next[1] = prevStats
          ? Math.min(1.5, 0.35 + Math.max(0, stats.threadConnections - (prevStats.threadConnections || 0)) / 60)
          : 0.6
        if (prevStats && stats.lifetimeChampions > (prevStats.lifetimeChampions || 0)) next[2] = 1.0
        prevStats = stats
        const speaks = await fetch('http://localhost:3334/api/speaks?n=1').then(r => r.json())
        const sp = speaks.speaks?.[speaks.speaks.length - 1]
        if (sp?.text) {
          utterance = sp.text.slice(0, 40)
          next[3] = (sp.mode === 'dream' || sp.mode === 'meaning') ? 1.0 : 0.0
        }
      } catch { /* cradle offline — the body keeps its last weather */ }
      for (const f of fields) {
        f.visualParams = [...next] as [number, number, number, number]
        // The window's label speaks; the body keeps its own name
        if (utterance && !f.name?.startsWith('Cradle Body')) f.name = 'Cradle: ' + utterance
      }
    }, 6000)
    return () => clearInterval(interval)
  }, [])

  // Periodic snapshot — export canvas as PNG, save to disk for Claude Code
  useEffect(() => {
    const SNAPSHOT_INTERVAL = 30000 // every 30 seconds
    const interval = setInterval(async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const dataUrl = canvas.toDataURL('image/png')
        if (!dataUrl || dataUrl === 'data:,') return
        await fetch('/api/engine/save-snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl }),
        })
      } catch { /* best-effort */ }
    }, SNAPSHOT_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  const selectedField = selection.selectedFieldId ? fields.get(selection.selectedFieldId) : null

  // Portal visual WGSL (swirling vortex shader)
  const PORTAL_WGSL = `fn visual_portal(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let pol = polar(uv);
  let swirl = pol.y + pol.x * 3.0 - time * 2.0;
  let spiralCount = 3.0 + p.x * 3.0;
  let spiral = 0.5 + 0.5 * sin(swirl * spiralCount);
  let tunnel = exp(-pol.x * 2.0);
  let n = fbm(uv * 4.0 + time * 0.3, 3);
  let rimVal = ring(uv, 0.7, 0.15);
  let c = col.rgb * spiral * (0.5 + n * 0.5) + col.rgb * rimVal * 2.0;
  let centerMask = tunnel * 0.6;
  let finalC = mix(c, behind.rgb, centerMask * behind.a);
  return vec4f(finalC, a * col.a);
}`

  // Create a portal field linking to a child space
  const handleCreatePortal = useCallback((childSlug: string, childName: string) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim || !renderer) return

    // Register portal visual type (idempotent — reuses existing ID if already registered)
    const { id: portalVtId } = renderer.registerVisualType('portal', PORTAL_WGSL)

    const id = genFieldId()
    const portalColor: [number, number, number, number] = [0.133, 0.827, 0.933, 1.0]
    sim.createField(id, `Portal to ${childName}`, portalColor)

    const camera = cameraRef.current
    sim.setPosition(id, Math.round(camera.x), Math.round(camera.y))

    const field = sim.fields.get(id)
    if (field) {
      field.shapeType = 'circle'
      field.radius = 30
      field.visualType = portalVtId
      field.visualTypeName = 'portal'
      field.visualParams = [0.5, 0, 0, 0]
      field.properties.set('portalTarget', childSlug)
      field.properties.set('portalType', 'space')
    }

    syncFields()
  }, [syncFields])

  return (
    <div className={`fixed inset-0 overflow-hidden flex ${playScene ? "bg-[#060404]" : "bg-background"}`}>
      {/* Canvas + fields panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden min-h-0">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ cursor: 'grab' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={e => e.preventDefault()}
            onPointerLeave={() => { setPixelInfo(null); if (pixelInfoTimeout.current) clearTimeout(pixelInfoTimeout.current) }}
          />

          {spaceId && (
            <button
              onClick={() => setChromeVisible(v => !v)}
              className="absolute bottom-3 right-3 z-40 px-2.5 py-1.5 rounded-lg text-xs font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            >
              {chromeVisible ? 'hide tools' : '\u2699 tools'}
            </button>
          )}

          {gpuFailed && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0c0a09]">
              <div className="text-center font-mono px-6">
                <div className="font-serif text-3xl text-amber-50/90 mb-3">the windows are dark</div>
                <div className="text-sm text-[#c9b896] max-w-md">
                  these worlds run on WebGPU, and this browser isn&apos;t offering it.
                  <br /><br />
                  Chrome or Edge (any recent), or Safari 26+, will light them up.
                </div>
              </div>
            </div>
          )}

          {/* HUD overlay — positioned absolutely over the canvas, pointer-events disabled */}
          <div
            ref={hudContainerRef}
            className="absolute inset-0 pointer-events-none z-10 font-mono"
            style={{ fontFamily: 'monospace' }}
          />

          {/* Mandatory world instructions + branch + AI status — top right, every world */}
          <div className="absolute top-3 right-3 z-40 flex flex-col items-end gap-1.5">
            <button
              onClick={() => setInstrOpen(v => !v)}
              className="px-2.5 py-1.5 rounded-lg text-[10px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            >
              ? INSTRUCTIONS
            </button>
            <button
              onClick={handleBranch}
              className="px-2.5 py-1.5 rounded-lg text-[10px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              title={me ? 'fork this world as your branch — the eye versions every AI edit' : 'sign in to branch this world'}
            >
              ⑂ BRANCH
            </button>
            {/* version scroller — appears when riding a branch */}
            {lastSceneRef.current.includes(' ⑂ ') && (() => {
              const cur = lastSceneRef.current
              const m = cur.match(/· v(\d+)$/)
              const n = m ? +m[1] : 1
              const at = (k: number) => cur.replace(/· v\d+$/, `· v${k}`)
              return (
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70">
                  <button className="hover:text-white px-1" disabled={n <= 1} onClick={() => handleLoadScene(at(n - 1))}>◂</button>
                  <span className="tracking-[0.1em]">v{n}</span>
                  <button className="hover:text-white px-1" onClick={() => handleLoadScene(at(n + 1))}>▸</button>
                </div>
              )
            })()}
            <button
              onClick={async () => {
                setPlugOpen(v => !v)
                if (!plugToken && spaceSlug) {
                  setPlugBusy(true)
                  try {
                    const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/token`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: 'AI agent' }),
                    })
                    const d = await r.json()
                    if (r.ok) setPlugToken(d.token)
                  } finally { setPlugBusy(false) }
                }
              }}
              className="px-2.5 py-1.5 rounded-lg text-[10px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            >
              ⚡ CONNECT AI
            </button>
            {/* the AI, honestly: unplugged / live / processing */}
            {(() => {
              void aiPulse
              const busy = agentConnected && Date.now() - aiLastEditRef.current < 2500
              return (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] tracking-[0.2em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/50">
                  <span className={`inline-block w-2 h-2 rounded-full ${busy ? 'bg-amber-400 animate-pulse' : agentConnected ? 'bg-emerald-400' : 'bg-white/25'}`} />
                  {busy ? 'AI PROCESSING' : agentConnected ? 'AI LIVE' : 'AI UNPLUGGED'}
                </div>
              )
            })()}
          </div>
          {instrOpen && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setInstrOpen(false); setInstrEdit(false) }}>
              <div
                className="max-w-md w-[90%] max-h-[70%] overflow-y-auto rounded-xl border border-white/15 bg-black/85 backdrop-blur p-5 font-mono text-[13px] leading-relaxed text-white/85"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] tracking-[0.25em] text-white/50">INSTRUCTIONS</div>
                  <div className="flex items-center gap-2">
                    {(isOwner || !spaceId) && !instrEdit && (
                      <button
                        className="text-[10px] tracking-[0.15em] text-white/50 hover:text-white border border-white/15 rounded px-2 py-0.5 transition-colors"
                        onClick={() => { setInstrDraft(String(simulationRef.current?.worldData?.instructions || '')); setInstrEdit(true) }}
                      >
                        EDIT
                      </button>
                    )}
                    <button
                      aria-label="Close instructions"
                      className="w-6 h-6 rounded text-white/60 hover:text-white hover:bg-white/10 text-[13px] leading-none transition-colors"
                      onClick={() => { setInstrOpen(false); setInstrEdit(false) }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {instrEdit ? (
                  <>
                    <textarea
                      value={instrDraft}
                      onChange={e => setInstrDraft(e.target.value)}
                      rows={10}
                      className="w-full bg-black/60 border border-white/15 rounded-lg p-3 text-[13px] font-mono text-white/85 outline-none focus:border-white/35"
                      placeholder={'Key entry first, one per line:\nWASD — move · SPACE — dash · CLICK — select\n\nThen the point: what the player is trying to do, and what winning is.'}
                    />
                    <div className="flex gap-2 mt-3 justify-end">
                      <button className="text-[10px] tracking-[0.15em] text-white/50 hover:text-white px-2 py-1" onClick={() => setInstrEdit(false)}>CANCEL</button>
                      <button
                        className="text-[10px] tracking-[0.15em] bg-white/10 hover:bg-white/20 border border-white/20 rounded px-3 py-1 transition-colors"
                        onClick={() => { const s = simulationRef.current; if (s) s.worldData.instructions = instrDraft; setInstrEdit(false) }}
                      >
                        SAVE
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="whitespace-pre-line">
                    {String(simulationRef.current?.worldData?.instructions || 'No instructions written for this world yet.')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CONNECT AI — the plug box: everything an agent needs to edit this branch */}
          {plugOpen && (() => {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            const tok = plugToken || (spaceSlug ? (plugBusy ? '…minting…' : '(minting failed — are you the owner?)') : '<your ENGINE_AGENT_TOKEN — branch-scoped tokens land with the registry>')
            const briefing = `Connect to my cartridge.cafe world${lastSceneRef.current ? ` branch "${lastSceneRef.current}"` : ''}:
POST commands to ${origin}/api/engine/bridge
header: Authorization: Bearer ${tok}
Full docs: GET ${origin}/api/engine/guide (markdown; instructions are MANDATORY — key entry + the point).
GET the bridge URL returns world state. Fields are INVISIBLE until given a visualType.
The eye versions your edits automatically after each settled burst — just build.`
            return (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPlugOpen(false)}>
                <div className="max-w-lg w-[92%] rounded-xl border border-white/15 bg-black/85 backdrop-blur p-5 font-mono text-[12px] leading-relaxed text-white/85" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[11px] tracking-[0.25em] text-white/50">⚡ CONNECT YOUR AI</div>
                    <div className="flex items-center gap-1.5 text-[9px] tracking-[0.2em] text-white/50">
                      <span className={`inline-block w-2 h-2 rounded-full ${agentConnected ? 'bg-emerald-400' : 'bg-white/25'}`} />
                      {agentConnected ? 'LIVE' : 'WAITING'}
                    </div>
                  </div>
                  <p className="text-white/60 mb-3 text-[11px]">Paste this to any AI (Claude, or anything that can speak HTTP). It will build in this world; the eye will version every settled edit.</p>
                  <pre className="whitespace-pre-wrap bg-black/60 border border-white/10 rounded-lg p-3 text-[11px] text-emerald-200/90 select-all">{briefing}</pre>
                  <div className="flex gap-2 mt-3 justify-end">
                    <button
                      className="text-[10px] tracking-[0.15em] bg-white/10 hover:bg-white/20 border border-white/20 rounded px-3 py-1 transition-colors"
                      onClick={() => { navigator.clipboard?.writeText(briefing); showToast('briefing copied', 'success') }}
                    >
                      COPY
                    </button>
                    <button className="text-[10px] tracking-[0.15em] text-white/50 hover:text-white px-2 py-1" onClick={() => setPlugOpen(false)}>CLOSE</button>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Virtual touch controls — writes the same worldData.key_* the keyboard
              does, so every cartridge gains touch support unchanged. Touch-only. */}
          <TouchControls simRef={simulationRef} />

          {/* Space breadcrumb — shown when in a child space */}
          {spaceSlug && <SpaceBreadcrumb spaceSlug={spaceSlug} />}

          {/* Space management overlay — owner only */}
          {isOwner && spaceSlug && spaceId && (
            <SpaceManagementOverlay
              spaceSlug={spaceSlug}
              spaceId={spaceId}
              onCreatePortal={handleCreatePortal}
            />
          )}

          {/* Pixel hover tooltip */}
          {pixelInfo && !playScene && (
            <div
              className="fixed z-50 pointer-events-none bg-black/85 text-white text-[10px] font-mono px-2 py-1 rounded border border-white/20 whitespace-nowrap"
              style={{ left: pixelInfo.screenX + 14, top: pixelInfo.screenY - 10 }}
            >
              <div>({pixelInfo.gridX}, {pixelInfo.gridY})</div>
              <div className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm border border-white/30"
                  style={{ backgroundColor: `rgba(${pixelInfo.r},${pixelInfo.g},${pixelInfo.b},${pixelInfo.a / 255})` }}
                />
                rgba({pixelInfo.r},{pixelInfo.g},{pixelInfo.b},{pixelInfo.a})
              </div>
              {pixelInfo.fields.length > 0 && (
                <div className="text-accent">{pixelInfo.fields.join(', ')}</div>
              )}
            </div>
          )}

          {/* Info overlay */}
          {chromeVisible && (
          <div className="absolute top-3 left-3 text-[10px] text-muted font-mono flex items-center gap-2">
            <span className="pointer-events-none">
              {gridSize}x{gridSize} | zoom: {cameraRef.current.zoom.toFixed(1)}x
              {selectedField && <span> | selected: {selectedField.name}</span>}
              {agentConnected && <span className="text-accent"> | agent live</span>}
            </span>
            {worldLocked && (
              <span className="flex items-center gap-2 px-2 py-0.5 rounded bg-error/20 border border-error/40 text-error text-[10px] font-bold">
                READ-ONLY — another session is writing this world
                <button
                  onClick={() => { takeoverRef.current = true }}
                  className="underline hover:text-foreground"
                  title="Claim the writer lease for this tab"
                >
                  take over
                </button>
              </span>
            )}
            <button
              onClick={async () => {
                const sim = simulationRef.current
                const renderer = rendererRef.current
                if (!sim || !renderer) return

                for (const field of sim.fields.values()) {
                  renderer.removeAllFieldEffects(field.id)
                }
                sim.clearAll()
                sim.fields.clear()
                sim.interactionRules = []
                sim.customCommands.clear()

                updateSelectionMask(null)
                syncFields()
                fetch('/api/engine/agent', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (document.cookie.match(/token=([^;]*)/)?.[1] || '') },
                  body: JSON.stringify({ type: 'reset' }),
                }).catch(() => {})
              }}
              className="px-2 py-1 bg-error/20 text-error border border-error/30 rounded text-[10px] font-bold hover:bg-error/40 transition-colors"
            >
              RESET MATCH
            </button>
          </div>

          )}
          {/* (prompt input moved to sidebar) */}
        </div>

        {/* Field list panel — scrollable under the canvas */}
        {chromeVisible && (
        <div className="h-40 flex-shrink-0 border-t border-border bg-background/95 overflow-y-auto">
          <div className="px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted font-mono">{fields.size} fields</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleSaveScene}
                  className="text-[10px] font-mono px-2 py-0.5 bg-success/20 text-success border border-success/30 rounded hover:bg-success/40 transition-colors"
                >
                  Save Scene
                </button>
                {brush.activeFieldId && fields.has(brush.activeFieldId) && (
                  <button
                    onClick={() => handleSaveToLibrary(brush.activeFieldId!)}
                    className="text-[10px] font-mono px-2 py-0.5 bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/40 transition-colors"
                  >
                    Save to Library
                  </button>
                )}
              </div>
            </div>
            {savedScenes.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {savedScenes.map(name => (
                  <div key={name} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-surface/50 border border-border rounded text-[10px] font-mono group">
                    <button
                      onClick={() => handleLoadScene(name)}
                      className="text-foreground hover:text-accent transition-colors truncate max-w-[120px]"
                      title={`Load scene "${name}"`}
                    >
                      {name}
                    </button>
                    <button
                      onClick={() => handleDeleteScene(name)}
                      className="text-muted hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                      title={`Delete scene "${name}"`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1">
              {Array.from(fields.values()).sort((a, b) => (a.renderOrder || 0) - (b.renderOrder || 0)).map(f => (
                <div
                  key={f.id}
                  onClick={() => {
                    setBrush(prev => ({ ...prev, activeFieldId: f.id }))
                    updateSelectionMask(f.id)
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors ${
                    brush.activeFieldId === f.id
                      ? 'bg-accent/20 border border-accent/40'
                      : 'bg-surface/50 border border-border hover:border-muted'
                  }`}
                >
                  <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{
                    backgroundColor: `rgba(${Math.round(f.color[0]*255)},${Math.round(f.color[1]*255)},${Math.round(f.color[2]*255)},${f.color[3]})`
                  }} />
                  <span className="text-foreground truncate">{f.name}</span>
                  {f.properties.get('portalType') === 'space' && (
                    <span className="text-purple flex-shrink-0" title={`Portal to ${f.properties.get('portalTarget')}`}>P</span>
                  )}
                  <span className="text-muted ml-auto flex-shrink-0">
                    {f.effects.length > 0 ? `${f.effects.length}fx` : '—'}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteField(f.id) }}
                    className="text-error/50 hover:text-error text-xs ml-1 flex-shrink-0"
                    title={`Delete ${f.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Designer sidebar */}
      {chromeVisible && (
      <div className="w-96 flex-shrink-0 flex flex-col border-l border-border bg-background overflow-hidden">
        {/* Inspector Panel */}
        <div className="flex-shrink-0 overflow-y-auto" style={{ maxHeight: '50%' }}>
          <div className="px-3 py-2 text-[10px] font-mono text-muted border-b border-border flex-shrink-0 flex items-center justify-between">
            <span>Inspector</span>
            {brush.activeFieldId && fields.has(brush.activeFieldId) && (
              <span className="text-accent">{fields.get(brush.activeFieldId)!.name}</span>
            )}
          </div>
          <div className="px-3 py-2">
            {(() => {
              const inspField = brush.activeFieldId ? fields.get(brush.activeFieldId) : null
              if (!inspField) return <div className="text-[10px] text-muted font-mono py-4 text-center">Click a field to inspect</div>
              const sim = simulationRef.current
              return (
                <div className="space-y-2 text-[10px] font-mono">
                  {/* Name */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Name</span>
                    <input
                      type="text"
                      value={inspField.name}
                      onChange={(e) => {
                        if (sim) {
                          const f = sim.fields.get(inspField.id)
                          if (f) { f.name = e.target.value; syncFields() }
                        }
                      }}
                      className="flex-1 bg-surface/50 border border-border rounded px-1.5 py-0.5 text-foreground text-[10px] font-mono"
                    />
                  </div>
                  {/* Color */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Color</span>
                    <span className="inline-block w-4 h-4 rounded border border-border flex-shrink-0" style={{
                      backgroundColor: `rgba(${Math.round(inspField.color[0]*255)},${Math.round(inspField.color[1]*255)},${Math.round(inspField.color[2]*255)},${inspField.color[3]})`
                    }} />
                    <span className="text-muted">
                      ({Math.round(inspField.color[0]*255)}, {Math.round(inspField.color[1]*255)}, {Math.round(inspField.color[2]*255)}, {inspField.color[3].toFixed(2)})
                    </span>
                  </div>
                  {/* Position */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Pos</span>
                    <span className="text-foreground">({Math.round(inspField.transform.x)}, {Math.round(inspField.transform.y)})</span>
                    <span className="text-muted ml-2">scale: {inspField.transform.scale.toFixed(2)}</span>
                  </div>
                  {/* Render Order */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Order</span>
                    <button
                      onClick={() => {
                        if (sim) {
                          const f = sim.fields.get(inspField.id)
                          if (f) { f.renderOrder = (f.renderOrder || 0) - 1; syncFields() }
                        }
                      }}
                      className="px-1 py-0.5 bg-surface/50 border border-border rounded hover:bg-surface text-foreground"
                    >-</button>
                    <span className="text-foreground w-6 text-center">{inspField.renderOrder || 0}</span>
                    <button
                      onClick={() => {
                        if (sim) {
                          const f = sim.fields.get(inspField.id)
                          if (f) { f.renderOrder = (f.renderOrder || 0) + 1; syncFields() }
                        }
                      }}
                      className="px-1 py-0.5 bg-surface/50 border border-border rounded hover:bg-surface text-foreground"
                    >+</button>
                    <span className="text-muted ml-1">(lower = behind)</span>
                  </div>
                  {/* Shape */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Shape</span>
                    <span className="text-foreground">
                      {inspField.shapeType === 'rect'
                        ? `rect ${inspField.w || 0}x${inspField.h || 0}`
                        : inspField.shapeType === 'screen'
                        ? `screen ${inspField.w || 0}x${inspField.h || 0}`
                        : `circle r=${inspField.radius || 0}`
                      }
                    </span>
                  </div>
                  {/* Visual type */}
                  {inspField.visualType !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted w-12 flex-shrink-0">Visual</span>
                      <span className="text-accent">{inspField.visualType}</span>
                      {inspField.visualParams && (
                        <span className="text-muted">params: [{inspField.visualParams.join(', ')}]</span>
                      )}
                    </div>
                  )}
                  {/* Tags */}
                  {inspField.tags && inspField.tags.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted w-12 flex-shrink-0">Tags</span>
                      <span className="text-foreground">{inspField.tags.join(', ')}</span>
                    </div>
                  )}
                  {/* Effects */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-muted">Effects ({inspField.effects.length})</span>
                      {inspField.effects.length > 0 && (
                        <button
                          onClick={() => handleClearEffect(inspField.id)}
                          className="text-error/60 hover:text-error"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    {inspField.effects.length === 0 && (
                      <div className="text-muted/50 pl-2">No effects</div>
                    )}
                    {inspField.effects.map(fx => (
                      <div key={fx.id} className="flex items-center gap-1 pl-2 py-0.5">
                        <span className="text-foreground truncate flex-1">{fx.description || fx.id}</span>
                        <span className="text-muted flex-shrink-0">{fx.blend}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Interactions Panel */}
        <div className="flex-shrink-0 border-t border-border overflow-y-auto" style={{ maxHeight: '25%' }}>
          <div className="px-3 py-2 text-[10px] font-mono text-muted border-b border-border">
            Interactions
          </div>
          <div className="px-3 py-2">
            {(() => {
              const sim = simulationRef.current
              if (!sim) return null
              const activeId = brush.activeFieldId
              const rules = sim.interactionRules.filter(r =>
                !activeId || r.fieldA === activeId || r.fieldB === activeId || !r.fieldA || !r.fieldB
              )
              const pairs = sim.interactionPairs.filter(p =>
                !activeId || p.fieldA === activeId || p.fieldB === activeId
              )
              const effects = sim.interactionEffects.filter(e =>
                !activeId || e.fieldA === activeId || e.fieldB === activeId || !e.fieldA || !e.fieldB
              )
              const total = rules.length + pairs.length + effects.length
              if (total === 0) return (
                <div className="text-[10px] text-muted font-mono py-2 text-center">No interactions</div>
              )
              return (
                <div className="space-y-1 text-[10px] font-mono">
                  {pairs.map((p, i) => {
                    const nameA = sim.fields.get(p.fieldA)?.name || p.fieldA
                    const nameB = sim.fields.get(p.fieldB)?.name || p.fieldB
                    return (
                      <div key={`pair-${i}`} className="flex items-center gap-1 text-foreground">
                        <span className="text-accent">{nameA}</span>
                        <span className="text-muted">↔</span>
                        <span className="text-accent">{nameB}</span>
                        <span className="text-muted ml-auto">{p.name}</span>
                      </div>
                    )
                  })}
                  {rules.map(r => (
                    <div key={r.id} className="flex items-center gap-1 text-foreground">
                      <span className="text-accent">{r.fieldA ? (sim.fields.get(r.fieldA)?.name || r.fieldA) : '*'}</span>
                      <span className="text-muted">→</span>
                      <span className="text-accent">{r.fieldB ? (sim.fields.get(r.fieldB)?.name || r.fieldB) : '*'}</span>
                      <span className="text-muted ml-auto">{r.trigger}: {r.effect}</span>
                    </div>
                  ))}
                  {effects.map(e => (
                    <div key={e.id} className="flex items-center gap-1 text-foreground">
                      <span className="text-accent">{e.fieldA ? (sim.fields.get(e.fieldA)?.name || e.fieldA) : '*'}</span>
                      <span className="text-muted">↔</span>
                      <span className="text-accent">{e.fieldB ? (sim.fields.get(e.fieldB)?.name || e.fieldB) : '*'}</span>
                      <span className="text-muted ml-auto">{e.description || 'shader'}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>

        {/* AI Prompt Panel — scoped to selected field */}
        <div className="flex-shrink-0 border-t border-border">
          <div className="px-3 py-2 text-[10px] font-mono text-muted border-b border-border">
            {brush.activeFieldId && fields.has(brush.activeFieldId)
              ? `AI Prompt — ${fields.get(brush.activeFieldId)!.name}`
              : 'AI Prompt — global'
            }
          </div>
          <div className="px-3 py-2">
            <input
              type="text"
              className="w-full bg-surface/50 border border-border text-foreground text-[10px] font-mono px-2 py-1.5 rounded"
              placeholder={brush.activeFieldId ? `Edit ${fields.get(brush.activeFieldId)?.name || 'field'}...` : 'Type a prompt...'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  const sim = simulationRef.current
                  if (sim) {
                    sim.worldData['user_prompt'] = e.currentTarget.value
                    sim.worldData['user_prompt_time'] = Date.now()
                    if (brush.activeFieldId) {
                      sim.worldData['user_prompt_field'] = brush.activeFieldId
                    } else {
                      delete sim.worldData['user_prompt_field']
                    }
                  }
                  e.currentTarget.value = ''
                }
              }}
            />
          </div>
        </div>

        {/* Terminal (collapsible) */}
        <div className="flex-1 border-t border-border flex flex-col min-h-0 overflow-hidden">
          <button
            onClick={() => setTerminalOpen(prev => !prev)}
            className="px-3 py-2 text-[10px] font-mono text-muted border-b border-border flex-shrink-0 flex items-center justify-between hover:bg-surface/30 transition-colors cursor-pointer w-full text-left"
          >
            <span>Terminal <span className="text-accent">{terminalLog.length}</span></span>
            <span>{terminalOpen ? '▼' : '▶'}</span>
          </button>
          {terminalOpen && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <AgentTerminalPanel entries={terminalLog} />
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
/** Virtual touch controls — a left thumb-stick (arrows + WASD) and two action
 *  buttons (A = space, B = enter) writing the same worldData.key_* the keyboard
 *  writes, so every existing cartridge gains touch support unchanged.
 *  Renders only on touch devices; the stick nub is moved via style (no re-renders). */
function TouchControls({ simRef }: { simRef: { current: FieldSimulation | null } }) {
  const [isTouch] = useState(() =>
    typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0))
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const nubRef = useRef<HTMLDivElement>(null)

  const setKeys = useCallback((dx: number, dy: number) => {
    const wd = simRef.current?.worldData
    if (!wd) return
    const TH = 14
    const L = dx < -TH, R = dx > TH, U = dy < -TH, D = dy > TH
    wd.key_left = L; wd.key_a = L
    wd.key_right = R; wd.key_d = R
    wd.key_up = U; wd.key_w = U
    wd.key_down = D; wd.key_s = D
  }, [simRef])

  const stickDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    originRef.current = { x: e.clientX, y: e.clientY }
  }, [])
  const stickMove = useCallback((e: React.PointerEvent) => {
    const o = originRef.current
    if (!o) return
    const dx = Math.max(-40, Math.min(40, e.clientX - o.x))
    const dy = Math.max(-40, Math.min(40, e.clientY - o.y))
    if (nubRef.current) nubRef.current.style.transform = `translate(${dx}px, ${dy}px)`
    setKeys(dx, dy)
  }, [setKeys])
  const stickUp = useCallback(() => {
    originRef.current = null
    if (nubRef.current) nubRef.current.style.transform = 'translate(0px, 0px)'
    setKeys(0, 0)
  }, [setKeys])

  const btn = useCallback((key: string, down: boolean) => (e: React.PointerEvent) => {
    e.preventDefault()
    const wd = simRef.current?.worldData
    if (wd) wd[key] = down
  }, [simRef])

  if (!isTouch) return null
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none select-none" style={{ touchAction: 'none' }}>
      <div
        className="absolute bottom-8 left-8 w-28 h-28 rounded-full border border-white/20 bg-white/5 backdrop-blur-sm pointer-events-auto"
        style={{ touchAction: 'none' }}
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
      >
        <div
          ref={nubRef}
          className="absolute left-1/2 top-1/2 -ml-6 -mt-6 w-12 h-12 rounded-full bg-white/20 border border-white/30 transition-transform duration-75"
        />
      </div>
      <div className="absolute bottom-10 right-8 flex gap-4 pointer-events-auto">
        <button
          className="w-16 h-16 rounded-full border border-white/25 bg-white/10 text-white/70 text-sm font-mono active:bg-white/25"
          style={{ touchAction: 'none' }}
          onPointerDown={btn('key_space', true)}
          onPointerUp={btn('key_space', false)}
          onPointerCancel={btn('key_space', false)}
        >A</button>
        <button
          className="w-16 h-16 rounded-full border border-white/25 bg-white/10 text-white/70 text-sm font-mono active:bg-white/25"
          style={{ touchAction: 'none' }}
          onPointerDown={btn('key_enter', true)}
          onPointerUp={btn('key_enter', false)}
          onPointerCancel={btn('key_enter', false)}
        >B</button>
      </div>
    </div>
  )
}
