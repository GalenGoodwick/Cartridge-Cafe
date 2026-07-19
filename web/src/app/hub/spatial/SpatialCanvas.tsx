'use client'

import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import type { UserspaceNode } from './useUserspace'
import { FieldRenderer } from '@/app/engine/renderer'
import type { FieldEffectData } from '@/app/engine/renderer'
import type { FieldSnapshot, SuperFieldGPU } from '@/app/engine/types'

// Spatial bounds — players can't go beyond this
const BOUNDS = { minX: -600, maxX: 600, minY: -400, maxY: 400 }

// Per-field layout metadata for the edit layout feature
interface SpatialFieldMeta {
  fieldId: string
  gridX: number          // position in engine grid space
  gridY: number
  scaleMultiplier: number // multiplier on field.transform.scale (default 1.0)
  depth: number           // parallax: 0 = static, higher = more movement (default 0)
}

// Frame positions in grid space
const FRAMES = [
  { id: '__nav_chants__', tab: 'chants' as const, label: 'Chants', color: '#22d3ee', x: -180, y: 0 },
  { id: '__nav_podiums__', tab: 'podiums' as const, label: 'Podiums', color: '#a78bfa', x: 0, y: 0 },
  { id: '__nav_groups__', tab: 'groups' as const, label: 'Groups', color: '#fbbf24', x: 180, y: 0 },
]

const FRAME_WIDTH = 140
const FRAME_HEIGHT = 260

// List mode layout
const LIST_COLS = 2
const LIST_CARD_W = 150
const LIST_CARD_H = 100
const LIST_GAP = 20

// Ring expansion constants
const RING_ATTRACT_RADIUS = 100
const RING_MAX_EXPAND = 30

interface SpatialCanvasProps {
  visible: boolean
  nodes: UserspaceNode[]
  selfUserId: string
  selfName: string
  selfColor: string
  followingIds: string[]
  onEnterSubspace: (userId: string, name: string, color: string) => void
  dropZoneRefs: React.MutableRefObject<Map<string, HTMLElement>>
  onRotate?: (degrees: number) => void
  framePreviews?: {
    chants: string[]
    podiums: string[]
    groups: string[]
  }
  onDockFrame?: (tab: 'chants' | 'podiums' | 'groups') => void
  remotePlayers?: { id: string; name: string; color: string; rx: number; ry: number; rotation: number }[]
  onCameraMove?: (x: number, y: number, rotation?: number) => void
  // List mode
  listItems?: { id: string; title: string; phase?: string; tier?: number }[]
  onDockItem?: (itemId: string) => void
  // Drag-to-dock ring expansion
  isDraggingDockstar?: boolean
  dragPosition?: { x: number; y: number } | null
  // Player mode
  onDockPlayer?: (id: string, name: string, color: string) => void
  hostNavState?: { dockedPostId: string | null; activeTab: string } | null
  onFollowHost?: () => void
  onBackFromSpatial?: () => void
  onSpatialStateChange?: (state: { mode: 'lobby' | 'list' | 'player'; listTab?: string | null; playerName?: string | null; canGoBack: boolean }) => void
  savedFields?: FieldSnapshot[]
  isAdmin?: boolean
  onRemoveSavedField?: (fieldId: string) => void
  onImportAllFields?: () => void
  fieldLibrary?: FieldSnapshot[]
  onLoadFromLibrary?: (fieldId: string) => void
  onRemoveFromLibrary?: (fieldId: string) => void
}

interface LayoutNode extends UserspaceNode {
  x: number
  y: number
  radius: number
  ring: 'self' | 'following' | 'other'
}

function clampCamera(pos: { x: number; y: number }) {
  return {
    x: Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, pos.x)),
    y: Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, pos.y)),
  }
}

export interface SpatialCanvasHandle {
  back: () => void
  enterPlayerMode: (id: string, name: string, color: string) => void
  resetToLobby: () => void
  dockFrame: (tab: 'chants' | 'podiums' | 'groups') => void
}

const SpatialCanvas = forwardRef<SpatialCanvasHandle, SpatialCanvasProps>(function SpatialCanvas({
  visible,
  nodes,
  selfUserId,
  selfName,
  selfColor,
  followingIds,
  onEnterSubspace,
  dropZoneRefs,
  onRotate,
  framePreviews,
  onDockFrame,
  remotePlayers,
  onCameraMove,
  listItems,
  onDockItem,
  isDraggingDockstar,
  dragPosition,
  onDockPlayer,
  hostNavState,
  onFollowHost,
  onBackFromSpatial,
  onSpatialStateChange,
  savedFields,
  isAdmin,
  onRemoveSavedField,
  onImportAllFields,
  fieldLibrary,
  onLoadFromLibrary,
  onRemoveFromLibrary,
}: SpatialCanvasProps, ref: React.Ref<SpatialCanvasHandle>) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const webglCanvasRef = useRef<HTMLCanvasElement>(null)
  const fieldRendererRef = useRef<FieldRenderer | null>(null)
  const compiledFieldsRef = useRef<Set<string>>(new Set())
  const [rendererReady, setRendererReady] = useState(0) // bumped when init completes to kick render loop
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([])
  const [camera, setCamera] = useState({ x: 0, y: 0 })
  const animRef = useRef<number | null>(null)
  const cameraRef = useRef({ x: 0, y: 0 })
  const rotationRef = useRef(0)
  const holdRef = useRef<{ dx: number; dy: number; startTime: number; startX: number; startY: number } | null>(null)
  const glideTargetRef = useRef<{ x: number; y: number } | null>(null)
  const onRotateRef = useRef(onRotate)
  useEffect(() => { onRotateRef.current = onRotate }, [onRotate])
  const onCameraMoveRef = useRef(onCameraMove)
  useEffect(() => { onCameraMoveRef.current = onCameraMove }, [onCameraMove])

  // Edit layout mode state
  const [editMode, setEditMode] = useState(false)
  const [fieldLayout, setFieldLayout] = useState<SpatialFieldMeta[]>([])
  const [editSelectedId, setEditSelectedId] = useState<string | null>(null)
  const editDragRef = useRef<{ fieldId: string; startGridX: number; startGridY: number; startScreenX: number; startScreenY: number } | null>(null)

  // Spatial sub-mode state machine
  type NavEntry =
    | { mode: 'lobby' }
    | { mode: 'list'; tab: 'chants' | 'podiums' | 'groups' }
    | { mode: 'player'; player: { id: string; name: string; color: string } }
  const [spatialMode, setSpatialMode] = useState<'lobby' | 'list' | 'player'>('lobby')
  const [listTab, setListTab] = useState<'chants' | 'podiums' | 'groups' | null>(null)
  const [dockedPlayer, setDockedPlayer] = useState<{ id: string; name: string; color: string } | null>(null)
  const [navStack, setNavStack] = useState<NavEntry[]>([])

  // Track whether dockstar has been dragged away from center (prevents accidental self-dock)
  const hasDraggedAwayRef = useRef(false)

  // Player drop zone hidden elements
  const playerDropEls = useRef<Map<string, HTMLDivElement>>(new Map())

  // Reset state when spatial view is hidden, force redraw when shown
  useEffect(() => {
    if (!visible) {
      setSpatialMode('lobby')
      setListTab(null)
      setDockedPlayer(null)
      setNavStack([])
    } else {
      // Double-rAF: first frame the browser lays out the element, second frame we redraw
      requestAnimationFrame(() => requestAnimationFrame(() => setRenderTick(t => t + 1)))
    }
  }, [visible])

  // Library browser state
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryDetailId, setLibraryDetailId] = useState<string | null>(null)

  const filteredLibrary = useMemo(() => {
    if (!fieldLibrary) return []
    // Only show top-level fields (no parentFieldId) in the grid
    const topLevel = fieldLibrary.filter(f => !f.parentFieldId)
    if (!librarySearch.trim()) return topLevel
    const q = librarySearch.toLowerCase()
    return topLevel.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.effects.some(e => e.description.toLowerCase().includes(q) || e.author.toLowerCase().includes(q))
    )
  }, [fieldLibrary, librarySearch])

  const libraryDetailField = useMemo(() => {
    if (!libraryDetailId || !fieldLibrary) return null
    return fieldLibrary.find(f => f.id === libraryDetailId) || null
  }, [libraryDetailId, fieldLibrary])

  const libraryDetailChildren = useMemo(() => {
    if (!libraryDetailId || !fieldLibrary) return []
    return fieldLibrary.filter(f => f.parentFieldId === libraryDetailId)
  }, [libraryDetailId, fieldLibrary])

  // Escape key: close detail first, then overlay
  useEffect(() => {
    if (!libraryOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (libraryDetailId) {
          setLibraryDetailId(null)
        } else {
          setLibraryOpen(false)
          setLibrarySearch('')
        }
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [libraryOpen, libraryDetailId])

  // Track drag-away for self-dock: only allow self-dock after dragging 80px+ from center
  useEffect(() => {
    if (!isDraggingDockstar) {
      hasDraggedAwayRef.current = false
      return
    }
    if (dragPosition && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const cx = rect.width / 2
      const cy = rect.height / 2
      const dist = Math.hypot(dragPosition.x - cx, dragPosition.y - cy)
      if (dist > 80) {
        hasDraggedAwayRef.current = true
      }
    }
  }, [isDraggingDockstar, dragPosition])

  // Broadcast spatial state changes to parent for header display
  useEffect(() => {
    if (!visible) return
    onSpatialStateChange?.({
      mode: spatialMode,
      listTab,
      playerName: dockedPlayer?.name || null,
      canGoBack: navStack.length > 0,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, spatialMode, listTab, dockedPlayer, navStack.length, onSpatialStateChange])

  // Handle back navigation — restores full context from nav stack
  const handleBack = useCallback(() => {
    if (navStack.length > 0) {
      const prev = navStack[navStack.length - 1]
      setNavStack(s => s.slice(0, -1))
      setSpatialMode(prev.mode)
      if (prev.mode === 'lobby') {
        setListTab(null)
        setDockedPlayer(null)
      } else if (prev.mode === 'list') {
        setListTab(prev.tab)
        setDockedPlayer(null)
      } else if (prev.mode === 'player') {
        setDockedPlayer(prev.player)
      }
      // Reset camera on mode transition
      setCamera({ x: 0, y: 0 })
      cameraRef.current = { x: 0, y: 0 }
    } else {
      // Empty stack → exit spatial entirely
      onBackFromSpatial?.()
    }
  }, [navStack, onBackFromSpatial])

  // Build current NavEntry for pushing to stack
  const currentNavEntry = useCallback((): NavEntry => {
    if (spatialMode === 'list' && listTab) return { mode: 'list', tab: listTab }
    if (spatialMode === 'player' && dockedPlayer) return { mode: 'player', player: dockedPlayer }
    return { mode: 'lobby' }
  }, [spatialMode, listTab, dockedPlayer])

  // Handle frame dock → transition to list mode
  const handleFrameDock = useCallback((tab: 'chants' | 'podiums' | 'groups') => {
    setNavStack(s => [...s, currentNavEntry()])
    setSpatialMode('list')
    setListTab(tab)
    setCamera({ x: 0, y: 0 })
    cameraRef.current = { x: 0, y: 0 }
    onDockFrame?.(tab)
  }, [currentNavEntry, onDockFrame])

  // Handle entering player mode — supports nesting up to 5 deep
  const MAX_NEST_DEPTH = 5
  const [nestTooDeep, setNestTooDeep] = useState(false)
  const handlePlayerDock = useCallback((id: string, name: string, color: string) => {
    // Count how many player entries are in the stack
    const playerDepth = navStack.filter(e => e.mode === 'player').length + (spatialMode === 'player' ? 1 : 0)
    if (playerDepth >= MAX_NEST_DEPTH) {
      setNestTooDeep(true)
      setTimeout(() => setNestTooDeep(false), 3000)
      return
    }
    setNavStack(s => [...s, currentNavEntry()])
    setSpatialMode('player')
    setDockedPlayer({ id, name, color })
    setCamera({ x: 0, y: 0 })
    cameraRef.current = { x: 0, y: 0 }
  }, [currentNavEntry, navStack, spatialMode])

  // Reset all the way to lobby — used when host disconnects, content deleted, etc.
  const resetToLobby = useCallback(() => {
    setNavStack([])
    setSpatialMode('lobby')
    setListTab(null)
    setDockedPlayer(null)
    setCamera({ x: 0, y: 0 })
    cameraRef.current = { x: 0, y: 0 }
  }, [])

  // Expose handlers to parent via ref
  useImperativeHandle(ref, () => ({
    back: handleBack,
    enterPlayerMode: handlePlayerDock,
    resetToLobby,
    dockFrame: handleFrameDock,
  }), [handleBack, handlePlayerDock, resetToLobby, handleFrameDock])

  // Auto-reset to lobby if host disconnects while in player mode
  const prevHostNavRef = useRef(hostNavState)
  useEffect(() => {
    // When hostNavState goes from non-null to null while in player mode, reset fully to lobby
    if (spatialMode === 'player' && prevHostNavRef.current !== null && hostNavState === null) {
      resetToLobby()
    }
    prevHostNavRef.current = hostNavState
  }, [hostNavState, spatialMode, resetToLobby])

  // Auto-back to lobby if list items are deleted while in list mode
  const prevListItemsLen = useRef((listItems || []).length)
  useEffect(() => {
    const len = (listItems || []).length
    if (spatialMode === 'list' && prevListItemsLen.current > 0 && len === 0) {
      resetToLobby()
    }
    prevListItemsLen.current = len
  }, [listItems, spatialMode, resetToLobby])

  // Smoothed remote player positions (lerp toward target)
  const smoothPlayersRef = useRef<Map<string, { rx: number; ry: number; rotation: number }>>(new Map())

  // Keep cameraRef in sync + broadcast position with rotation
  useEffect(() => {
    cameraRef.current = camera
    onCameraMoveRef.current?.(camera.x, camera.y, rotationRef.current)
  }, [camera])

  // Layout nodes in radial pattern
  useEffect(() => {
    if (!visible) return

    const followingSet = new Set(followingIds)
    const followingNodes = nodes.filter(n => followingSet.has(n.userId))
    const otherNodes = nodes.filter(n => !followingSet.has(n.userId))

    const laid: LayoutNode[] = []

    const innerRadius = 120
    followingNodes.forEach((node, i) => {
      const angle = (i / Math.max(followingNodes.length, 1)) * Math.PI * 2 - Math.PI / 2
      laid.push({
        ...node,
        x: Math.cos(angle) * innerRadius,
        y: Math.sin(angle) * innerRadius,
        radius: 20 + Math.min(node.occupancy * 3, 20),
        ring: 'following',
      })
    })

    const outerRadius = 240
    otherNodes.forEach((node, i) => {
      const angle = (i / Math.max(otherNodes.length, 1)) * Math.PI * 2 - Math.PI / 2
      laid.push({
        ...node,
        x: Math.cos(angle) * outerRadius,
        y: Math.sin(angle) * outerRadius,
        radius: 16 + Math.min(node.occupancy * 2, 16),
        ring: 'other',
      })
    })

    setLayoutNodes(laid)
  }, [visible, nodes, followingIds])

  // Unified animation loop — hold mode (continuous) or glide mode (tap target)
  const startAnimation = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current)

    const animate = () => {
      const hold = holdRef.current
      const glide = glideTargetRef.current

      if (hold) {
        const dist = Math.hypot(hold.dx, hold.dy)
        if (dist > 1) {
          const speed = dist * 0.02
          const cur = cameraRef.current
          const next = clampCamera({ x: cur.x - (hold.dx / dist) * speed, y: cur.y - (hold.dy / dist) * speed })
          setCamera(next)
        }
        animRef.current = requestAnimationFrame(animate)
      } else if (glide) {
        const cur = cameraRef.current
        const dx = glide.x - cur.x
        const dy = glide.y - cur.y
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          setCamera(clampCamera({ x: glide.x, y: glide.y }))
          glideTargetRef.current = null
          animRef.current = null
          return
        }
        setCamera(clampCamera({ x: cur.x + dx * 0.08, y: cur.y + dy * 0.08 }))
        animRef.current = requestAnimationFrame(animate)
      } else {
        animRef.current = null
      }
    }

    animRef.current = requestAnimationFrame(animate)
  }, [])

  // Cleanup animation + WebGL renderer on unmount (the init effect only
  // destroys the renderer when the view is hidden or fields empty)
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      if (fieldRendererRef.current) {
        fieldRendererRef.current.destroy()
        fieldRendererRef.current = null
      }
    }
  }, [])

  // Re-render on window resize so lobby frames stay centered
  useEffect(() => {
    if (!visible) return
    const onResize = () => setRenderTick(t => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [visible])

  // Interpolation loop for smooth remote player movement
  const interpRef = useRef<number | null>(null)
  const [renderTick, setRenderTick] = useState(0)

  useEffect(() => {
    if (!visible || !remotePlayers || remotePlayers.length === 0) {
      if (interpRef.current) { cancelAnimationFrame(interpRef.current); interpRef.current = null }
      return
    }

    const tick = () => {
      let needsMore = false
      for (const player of remotePlayers) {
        const smooth = smoothPlayersRef.current.get(player.id)
        if (!smooth) continue
        if (Math.abs(player.rx - smooth.rx) > 0.001 ||
            Math.abs(player.ry - smooth.ry) > 0.001 ||
            Math.abs(((player.rotation - smooth.rotation + 540) % 360) - 180) > 0.5) {
          needsMore = true
          break
        }
      }
      if (needsMore) {
        setRenderTick(t => t + 1)
        interpRef.current = requestAnimationFrame(tick)
      } else {
        interpRef.current = null
      }
    }

    interpRef.current = requestAnimationFrame(tick)
    return () => { if (interpRef.current) { cancelAnimationFrame(interpRef.current); interpRef.current = null } }
  }, [visible, remotePlayers])

  // Coordinate conversion helpers (match shader COORD_MATH)
  const FIELD_RENDER_EXTENT = 32
  const ENGINE_GRID_SIZE = 512
  const PARALLAX_RATE = 0.001

  const gridToScreen = useCallback((gridX: number, gridY: number, canvasW: number, canvasH: number, cam: { x: number; y: number }) => {
    const webglCam = { x: ENGINE_GRID_SIZE / 2, y: ENGINE_GRID_SIZE / 2 }
    const gridRange = ENGINE_GRID_SIZE  // zoom = 1.0
    const aspect = canvasW / canvasH
    let screenX: number, screenY: number
    if (aspect > 1.0) {
      screenX = ((gridX - webglCam.x) / (gridRange * aspect) + 0.5) * canvasW
      screenY = ((webglCam.y - gridY) / gridRange + 0.5) * canvasH
    } else {
      screenX = ((gridX - webglCam.x) / gridRange + 0.5) * canvasW
      screenY = ((webglCam.y - gridY) / (gridRange / aspect) + 0.5) * canvasH
    }
    return { screenX, screenY }
  }, [])

  const screenToGridSpatial = useCallback((screenX: number, screenY: number, canvasW: number, canvasH: number, cam: { x: number; y: number }) => {
    const webglCam = { x: ENGINE_GRID_SIZE / 2, y: ENGINE_GRID_SIZE / 2 }
    const gridRange = ENGINE_GRID_SIZE
    const aspect = canvasW / canvasH
    let gridX: number, gridY: number
    if (aspect > 1.0) {
      gridX = webglCam.x + (screenX / canvasW - 0.5) * gridRange * aspect
      gridY = webglCam.y + (0.5 - screenY / canvasH) * gridRange
    } else {
      gridX = webglCam.x + (screenX / canvasW - 0.5) * gridRange
      gridY = webglCam.y + (0.5 - screenY / canvasH) * gridRange / aspect
    }
    return { gridX, gridY }
  }, [])

  // Initialize fieldLayout from localStorage or savedFields transforms
  useEffect(() => {
    if (!savedFields || savedFields.length === 0) {
      setFieldLayout([])
      return
    }
    try {
      const stored = localStorage.getItem('spatialFieldLayout')
      if (stored) {
        const parsed: SpatialFieldMeta[] = JSON.parse(stored)
        // Merge: keep stored entries for existing fields, add defaults for new fields
        const result: SpatialFieldMeta[] = []
        for (const field of savedFields) {
          const existing = parsed.find(m => m.fieldId === field.id)
          if (existing) {
            result.push(existing)
          } else {
            result.push({
              fieldId: field.id,
              gridX: field.transform.x,
              gridY: field.transform.y,
              scaleMultiplier: 1.0,
              depth: 0,
            })
          }
        }
        setFieldLayout(result)
        return
      }
    } catch { /* ignore parse errors */ }
    // No stored layout — initialize from field transforms
    setFieldLayout(savedFields.map(f => ({
      fieldId: f.id,
      gridX: f.transform.x,
      gridY: f.transform.y,
      scaleMultiplier: 1.0,
      depth: 0,
    })))
  }, [savedFields])

  // WebGL backdrop: initialize renderer, register visual types/modules, compile effects
  useEffect(() => {
    if (!visible || !savedFields || savedFields.length === 0) {
      if (fieldRendererRef.current) {
        fieldRendererRef.current.destroy()
        fieldRendererRef.current = null
        compiledFieldsRef.current.clear()
      }
      return
    }

    const webglCanvas = webglCanvasRef.current
    if (!webglCanvas) return

    let cancelled = false

    ;(async () => {
    // Init renderer if needed
    if (!fieldRendererRef.current) {
      const renderer = new FieldRenderer()
      const ok = await renderer.init(webglCanvas!)
      if (!ok || cancelled) return
      fieldRendererRef.current = renderer
    }

    const renderer = fieldRendererRef.current

    // Fetch visual types and modules from engine state
    try {
      const resp = await fetch('/api/engine/state')
      if (resp.ok && !cancelled) {
        const data = await resp.json()
        // Register visual types for uber-shader
        if (data.visualTypes && Array.isArray(data.visualTypes)) {
          for (const vt of data.visualTypes) {
            renderer.registerVisualType(vt.name, vt.wgsl)
          }
        }
        // Register shader modules
        if (data.modules && Array.isArray(data.modules)) {
          for (const mod of data.modules) {
            renderer.registerModule(mod.name, mod.wgsl)
          }
        }
      }
    } catch { /* engine state fetch failed, continue without visual types */ }

    if (cancelled) return

    // Compile per-field WGSL effects (for fields that have them)
    const newCompiled = new Set<string>()
    for (const field of savedFields) {
      for (const effect of field.effects) {
        const programKey = `${field.id}_${effect.id}`
        newCompiled.add(programKey)
        if (!compiledFieldsRef.current.has(programKey)) {
          await renderer.compileFieldEffect(programKey, field.id, effect.wgsl)
        }
      }
    }

    // Remove effects no longer present
    for (const key of compiledFieldsRef.current) {
      if (!newCompiled.has(key)) {
        renderer.removeFieldEffect(key)
      }
    }

    compiledFieldsRef.current = newCompiled

    // Signal render loop that renderer is ready
    if (!cancelled) setRendererReady(r => r + 1)
    })()

    return () => { cancelled = true }
  }, [visible, savedFields])

  // WebGL backdrop: render fields each frame (uber-shader + per-field effects)
  useEffect(() => {
    if (!visible || !fieldRendererRef.current || !savedFields || savedFields.length === 0) return

    const renderer = fieldRendererRef.current
    let rafId: number | null = null

    const renderFrame = () => {
      const time = performance.now() / 1000

      // Fixed camera at grid center (parallax applied per-field via position offsets)
      const webglCamera = { x: ENGINE_GRID_SIZE / 2, y: ENGINE_GRID_SIZE / 2 }

      // Pack fields into SuperFieldGPU for uber-shader rendering
      const superFields: SuperFieldGPU[] = []
      const fieldEffects: FieldEffectData[] = []

      for (const field of savedFields) {
        const meta = fieldLayout.find(m => m.fieldId === field.id)
        const gx = meta?.gridX ?? field.transform.x
        const gy = meta?.gridY ?? field.transform.y
        const scaleMul = meta?.scaleMultiplier ?? 1.0
        const depth = meta?.depth ?? 0
        const effectiveScale = field.transform.scale * scaleMul

        // Per-field parallax offset (read from ref so the rAF loop survives camera changes)
        const renderX = gx - cameraRef.current.x * depth * PARALLAX_RATE
        const renderY = gy + cameraRef.current.y * depth * PARALLAX_RATE

        // Pack as SuperFieldGPU if field has a visualType (uber-shader)
        if (field.visualType !== undefined) {
          // Resolve visual type by name to get this renderer's ID (IDs differ between renderer instances)
          const resolvedVT = field.visualTypeName
            ? (renderer.resolveVisualType(field.visualTypeName) ?? field.visualType)
            : field.visualType
          const shapeType = field.shapeType === 'rect' ? 1 : field.shapeType === 'screen' ? 2 : 0
          const dim1 = shapeType === 1 ? (field.w || 20) : (field.radius || 10)
          const dim2 = shapeType === 1 ? (field.h || 20) : 0
          const vp = field.visualParams || [0, 0, 0, 0]
          const props = field.properties || {}

          superFields.push({
            posScaleRot: [renderX, renderY, effectiveScale, field.transform.rotation],
            shapeDims: [shapeType, dim1, dim2, -1], // -1 = render to screen
            color: field.color,
            visualAndParams: [resolvedVT, vp[0], vp[1], vp[2]],
            extraParams: [
              vp[3] || 0,
              props.bidirectionalBehind ? 1 : 0,
              (props.lighting as number) ?? 0,
              (props.specular as number) ?? 0,
            ],
            pos3D: [0, 0, 0, 0],
          })
        }

        // Also build per-field effects for fields that have WGSL effects
        const bounds: [number, number, number, number] = [
          renderX - FIELD_RENDER_EXTENT * effectiveScale,
          renderY - FIELD_RENDER_EXTENT * effectiveScale,
          renderX + FIELD_RENDER_EXTENT * effectiveScale,
          renderY + FIELD_RENDER_EXTENT * effectiveScale,
        ]
        for (const effect of field.effects) {
          const programKey = `${field.id}_${effect.id}`
          fieldEffects.push({
            fieldId: field.id,
            programKey,
            bounds,
            transform: [renderX, renderY, field.transform.rotation, effectiveScale],
            params: [field.color[0], field.color[1], field.color[2], field.color[3]],
            blend: effect.blend,
          })
        }
      }

      // Use full render() with both superFields and fieldEffects
      if (superFields.length > 0 && renderer.isSuperReady()) {
        renderer.render(webglCamera, 1.0, time, fieldEffects, superFields)
      } else if (fieldEffects.length > 0) {
        renderer.renderEffectsOnly(webglCamera, 1.0, time, fieldEffects)
      } else {
        // Still call render to clear and show background
        renderer.render(webglCamera, 1.0, time, [], [])
      }

      rafId = requestAnimationFrame(renderFrame)
    }

    rafId = requestAnimationFrame(renderFrame)
    return () => { if (rafId) cancelAnimationFrame(rafId) }
  }, [visible, savedFields, fieldLayout, rendererReady])

  // Draw canvas
  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    // Only reallocate the backing buffer when size actually changes — this
    // effect runs every camera frame and buffer realloc is expensive
    const bufW = Math.round(rect.width * dpr)
    const bufH = Math.round(rect.height * dpr)
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW
      canvas.height = bufH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const cx = rect.width / 2 + camera.x
    const cy = rect.height / 2 + camera.y

    // Clear — transparent if WebGL backdrop is active, opaque otherwise
    if (savedFields && savedFields.length > 0) {
      ctx.clearRect(0, 0, rect.width, rect.height)
    } else {
      ctx.fillStyle = '#020617'
      ctx.fillRect(0, 0, rect.width, rect.height)
    }

    // Draw subtle grid — clipped to bounds
    const bLeft = cx + BOUNDS.minX
    const bRight = cx + BOUNDS.maxX
    const bTop = cy + BOUNDS.minY
    const bBottom = cy + BOUNDS.maxY
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 0.5
    const gridSize = 40
    const gridStartX = Math.ceil(BOUNDS.minX / gridSize) * gridSize
    const gridStartY = Math.ceil(BOUNDS.minY / gridSize) * gridSize
    for (let gx = gridStartX; gx <= BOUNDS.maxX; gx += gridSize) {
      const x = cx + gx
      if (x < 0 || x > rect.width) continue
      ctx.beginPath()
      ctx.moveTo(x, Math.max(0, bTop))
      ctx.lineTo(x, Math.min(rect.height, bBottom))
      ctx.stroke()
    }
    for (let gy = gridStartY; gy <= BOUNDS.maxY; gy += gridSize) {
      const y = cy + gy
      if (y < 0 || y > rect.height) continue
      ctx.beginPath()
      ctx.moveTo(Math.max(0, bLeft), y)
      ctx.lineTo(Math.min(rect.width, bRight), y)
      ctx.stroke()
    }

    // Draw boundary indicators
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 1
    ctx.setLineDash([8, 8])
    ctx.beginPath()
    ctx.rect(bLeft, bTop, bRight - bLeft, bBottom - bTop)
    ctx.stroke()
    ctx.setLineDash([])

    // Draw field outlines in edit mode
    if (editMode && savedFields && savedFields.length > 0) {
      for (const field of savedFields) {
        const meta = fieldLayout.find(m => m.fieldId === field.id)
        const gx = meta?.gridX ?? field.transform.x
        const gy = meta?.gridY ?? field.transform.y
        const scaleMul = meta?.scaleMultiplier ?? 1.0
        const depth = meta?.depth ?? 0
        const effectiveScale = field.transform.scale * scaleMul

        const halfExtent = FIELD_RENDER_EXTENT * effectiveScale
        const topLeft = gridToScreen(gx - halfExtent, gy + halfExtent, rect.width, rect.height, camera)
        const bottomRight = gridToScreen(gx + halfExtent, gy - halfExtent, rect.width, rect.height, camera)
        const w = bottomRight.screenX - topLeft.screenX
        const h = bottomRight.screenY - topLeft.screenY

        const isSelected = editSelectedId === field.id
        const fieldColor = `rgba(${Math.round(field.color[0]*255)},${Math.round(field.color[1]*255)},${Math.round(field.color[2]*255)},1)`

        if (isSelected) {
          // Solid outline for selected field
          ctx.strokeStyle = fieldColor
          ctx.lineWidth = 2
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.rect(topLeft.screenX, topLeft.screenY, w, h)
          ctx.stroke()

          // Corner handles (8x8 squares)
          const hs = 4
          const corners = [
            [topLeft.screenX, topLeft.screenY],
            [bottomRight.screenX, topLeft.screenY],
            [topLeft.screenX, bottomRight.screenY],
            [bottomRight.screenX, bottomRight.screenY],
          ]
          ctx.fillStyle = fieldColor
          for (const [cx2, cy2] of corners) {
            ctx.fillRect(cx2 - hs, cy2 - hs, hs * 2, hs * 2)
          }
        } else {
          // Dashed outline for non-selected fields
          ctx.strokeStyle = fieldColor
          ctx.lineWidth = 1
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          ctx.rect(topLeft.screenX, topLeft.screenY, w, h)
          ctx.stroke()
          ctx.setLineDash([])
        }

        // Name label above outline
        const centerScreen = gridToScreen(gx, gy + halfExtent, rect.width, rect.height, camera)
        ctx.fillStyle = fieldColor
        ctx.font = '10px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(field.name.slice(0, 20), centerScreen.screenX, topLeft.screenY - 4)

        // Depth/scale badges
        ctx.font = '9px monospace'
        ctx.textBaseline = 'top'
        ctx.fillStyle = '#94a3b8'
        const badgeY = bottomRight.screenY + 4
        ctx.textAlign = 'left'
        ctx.fillText(`s:${scaleMul.toFixed(1)}`, topLeft.screenX, badgeY)
        ctx.textAlign = 'right'
        ctx.fillText(`d:${depth.toFixed(1)}`, bottomRight.screenX, badgeY)
      }
    }

    // Draw other nodes (user subspaces)
    layoutNodes.forEach(node => {
      const nx = cx + node.x
      const ny = cy + node.y
      const isFollowing = node.ring === 'following'
      const alpha = isFollowing ? '60' : '30'
      const strokeAlpha = isFollowing ? 'cc' : '80'

      if (node.occupancy > 0) {
        ctx.beginPath()
        ctx.arc(nx, ny, node.radius + 6, 0, Math.PI * 2)
        ctx.fillStyle = node.hostColor + '15'
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(nx, ny, node.radius, 0, Math.PI * 2)
      ctx.fillStyle = node.hostColor + alpha
      ctx.fill()
      ctx.strokeStyle = node.hostColor + strokeAlpha
      ctx.lineWidth = isFollowing ? 2 : 1
      ctx.stroke()

      ctx.fillStyle = node.hostColor
      ctx.font = `${isFollowing ? 11 : 9}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(node.hostName[0]?.toUpperCase() || '?', nx, ny)

      ctx.fillStyle = isFollowing ? '#e2e8f0' : '#64748b'
      ctx.font = '9px monospace'
      ctx.fillText(node.hostName.slice(0, 12), nx, ny + node.radius + 12)

      if (node.occupancy > 0) {
        const bx = nx + node.radius * 0.7
        const by = ny - node.radius * 0.7
        ctx.beginPath()
        ctx.arc(bx, by, 8, 0, Math.PI * 2)
        ctx.fillStyle = '#0891b2'
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 8px monospace'
        ctx.fillText(String(node.occupancy), bx, by)
      }
    })

    // Draw remote players — same orb style as local dockstar, with lerp smoothing
    if (remotePlayers && remotePlayers.length > 0) {
      const boundsW = BOUNDS.maxX - BOUNDS.minX  // 1200
      const boundsH = BOUNDS.maxY - BOUNDS.minY  // 800
      const lerpFactor = 0.18  // smoothing at 60fps interpolation
      remotePlayers.forEach(player => {
        // Lerp toward target position
        const smooth = smoothPlayersRef.current.get(player.id) || { rx: player.rx, ry: player.ry, rotation: player.rotation }
        smooth.rx += (player.rx - smooth.rx) * lerpFactor
        smooth.ry += (player.ry - smooth.ry) * lerpFactor
        // Shortest-path rotation lerp
        let rotDelta = ((player.rotation - smooth.rotation + 540) % 360) - 180
        smooth.rotation += rotDelta * lerpFactor
        smoothPlayersRef.current.set(player.id, smooth)

        const playerCamX = BOUNDS.minX + smooth.rx * boundsW
        const playerCamY = BOUNDS.minY + smooth.ry * boundsH
        const screenX = rect.width / 2 + camera.x - playerCamX
        const screenY = rect.height / 2 + camera.y - playerCamY
        const rot = smooth.rotation * Math.PI / 180
        const orbR = 16  // slightly smaller than the 20px (w-10) local dockstar

        // Glow
        ctx.shadowColor = player.color + '66'
        ctx.shadowBlur = 10

        // Filled circle (like the dockstar orb)
        ctx.beginPath()
        ctx.arc(screenX, screenY, orbR, 0, Math.PI * 2)
        ctx.fillStyle = player.color
        ctx.fill()
        ctx.strokeStyle = player.color
        ctx.lineWidth = 2
        ctx.stroke()

        ctx.shadowBlur = 0

        // Arrow inside the orb, rotated to their facing direction
        // Matches dockstar SVG path "M12 2l4.5 11h-3.5v9h-2v-9H7.5z" scaled to orb
        ctx.save()
        ctx.translate(screenX, screenY)
        ctx.rotate(rot)
        const s = orbR / 12  // scale factor (SVG is 24x24, center at 12,12)
        ctx.beginPath()
        ctx.moveTo(0, -10 * s)           // tip
        ctx.lineTo(4.5 * s, 1 * s)      // right wing
        ctx.lineTo(1 * s, 1 * s)        // right notch
        ctx.lineTo(1 * s, 9 * s)        // right tail
        ctx.lineTo(-1 * s, 9 * s)       // left tail
        ctx.lineTo(-1 * s, 1 * s)       // left notch
        ctx.lineTo(-4.5 * s, 1 * s)     // left wing
        ctx.closePath()
        ctx.fillStyle = '#020617'
        ctx.fill()
        ctx.restore()

        // Name label below
        ctx.fillStyle = player.color
        ctx.font = '9px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(player.name.slice(0, 12), screenX, screenY + orbR + 4)

        // Ring expansion when dockstar is being dragged near this player
        if (isDraggingDockstar && dragPosition) {
          const dist = Math.hypot(dragPosition.x - screenX, dragPosition.y - screenY)
          if (dist < RING_ATTRACT_RADIUS) {
            const proximity = 1 - (dist / RING_ATTRACT_RADIUS)
            const ringRadius = orbR + 4 + proximity * RING_MAX_EXPAND
            ctx.beginPath()
            ctx.arc(screenX, screenY, ringRadius, 0, Math.PI * 2)
            ctx.strokeStyle = player.color + Math.round(proximity * 200).toString(16).padStart(2, '0')
            ctx.lineWidth = 2 + proximity * 2
            ctx.stroke()
          }
        }
      })
    }

    // Self-dock ring — appears at center when dockstar is dragged away, inviting return
    if (isDraggingDockstar && dragPosition && hasDraggedAwayRef.current) {
      const selfX = rect.width / 2
      const selfY = rect.height / 2
      const dist = Math.hypot(dragPosition.x - selfX, dragPosition.y - selfY)
      // Ring visible when player is outside it — grows with distance, shrinks as they return
      const ringAlpha = Math.min(dist / RING_ATTRACT_RADIUS, 1)
      const ringRadius = 20 + 4 + ringAlpha * RING_MAX_EXPAND
      ctx.beginPath()
      ctx.arc(selfX, selfY, ringRadius, 0, Math.PI * 2)
      ctx.strokeStyle = selfColor + Math.round(ringAlpha * 150).toString(16).padStart(2, '0')
      ctx.lineWidth = 1.5 + ringAlpha * 1.5
      ctx.stroke()
    }
  }, [visible, layoutNodes, camera, selfColor, selfName, remotePlayers, renderTick, isDraggingDockstar, dragPosition, savedFields, editMode, editSelectedId, fieldLayout, gridToScreen])

  // Rotate arrow toward a screen offset (dx, dy from center), shortest path
  const rotateArrow = useCallback((dx: number, dy: number) => {
    const targetAngle = Math.atan2(dx, -dy) * (180 / Math.PI)
    const currentRot = rotationRef.current
    const rawDelta = targetAngle - (((currentRot % 360) + 360) % 360)
    const shortDelta = ((rawDelta + 540) % 360) - 180
    const newRotation = currentRot + shortDelta
    rotationRef.current = newRotation
    onRotate?.(newRotation)
    // Broadcast rotation update
    onCameraMoveRef.current?.(cameraRef.current.x, cameraRef.current.y, newRotation)
  }, [onRotate])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Ignore if clicking on a frame element
    if ((e.target as HTMLElement).closest('[data-spatial-frame]')) return

    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()

    // Edit mode: click on empty space deselects
    if (editMode) {
      setEditSelectedId(null)
      return
    }

    // Normal mode: camera drag
    const dx = e.clientX - rect.left - rect.width / 2
    const dy = e.clientY - rect.top - rect.height / 2
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return

    glideTargetRef.current = null
    rotateArrow(dx, dy)
    holdRef.current = { dx, dy, startTime: Date.now(), startX: e.clientX, startY: e.clientY }
    startAnimation()
  }, [rotateArrow, startAnimation, editMode, savedFields, fieldLayout, camera, gridToScreen])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Normal mode: camera hold
    if (!holdRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dx = e.clientX - rect.left - rect.width / 2
    const dy = e.clientY - rect.top - rect.height / 2
    holdRef.current.dx = dx
    holdRef.current.dy = dy
    rotateArrow(dx, dy)
  }, [rotateArrow, editMode, camera, screenToGridSpatial])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const hold = holdRef.current
    holdRef.current = null

    if (!hold) return

    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const tapX = e.clientX - rect.left
    const tapY = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const isTap = Date.now() - hold.startTime < 300 &&
      Math.abs(e.clientX - hold.startX) < 10 &&
      Math.abs(e.clientY - hold.startY) < 10

    if (isTap) {
      // Check nodes (userspace hosts)
      const cx = centerX + cameraRef.current.x
      const cy = centerY + cameraRef.current.y
      for (const node of layoutNodes) {
        const nx = cx + node.x
        const ny = cy + node.y
        if (Math.hypot(tapX - nx, tapY - ny) <= node.radius) {
          if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null }
          onEnterSubspace(node.userId, node.hostName, node.hostColor)
          return
        }
      }

      // Check remote players (multiplayer cursors) → enter player mode
      if (remotePlayers && remotePlayers.length > 0) {
        const boundsW = BOUNDS.maxX - BOUNDS.minX
        const boundsH = BOUNDS.maxY - BOUNDS.minY
        const cam = cameraRef.current
        for (const player of remotePlayers) {
          const playerCamX = BOUNDS.minX + player.rx * boundsW
          const playerCamY = BOUNDS.minY + player.ry * boundsH
          const screenX = centerX + cam.x - playerCamX
          const screenY = centerY + cam.y - playerCamY
          if (Math.hypot(tapX - screenX, tapY - screenY) <= 20) {
            if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null }
            // Only call onDockPlayer — parent will call enterPlayerMode via ref
            // to avoid double nav stack push
            onDockPlayer?.(player.id, player.name, player.color)
            return
          }
        }
      }

      // Glide toward tap point
      const dx = tapX - centerX
      const dy = tapY - centerY
      glideTargetRef.current = clampCamera({
        x: cameraRef.current.x - dx,
        y: cameraRef.current.y - dy,
      })
      startAnimation()
    } else {
      if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null }
    }
  }, [layoutNodes, onEnterSubspace, startAnimation, remotePlayers, onDockPlayer, editMode, fieldLayout])

  // Wheel handler: adjust scaleMultiplier of selected field in edit mode
  useEffect(() => {
    if (!editMode || !editSelectedId) return
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      // Don't intercept scroll on admin panel or other interactive elements
      if ((e.target as HTMLElement).closest('[data-spatial-frame]')) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setFieldLayout(prev => {
        const updated = prev.map(m =>
          m.fieldId === editSelectedId
            ? { ...m, scaleMultiplier: Math.max(0.1, Math.min(10.0, m.scaleMultiplier + delta)) }
            : m
        )
        try { localStorage.setItem('spatialFieldLayout', JSON.stringify(updated)) } catch { /* ignore */ }
        return updated
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [editMode, editSelectedId])

  // Register DOM overlay drop zones for userspace nodes
  useEffect(() => {
    if (!visible || !containerRef.current) return
    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    const cx = rect.width / 2 + camera.x
    const cy = rect.height / 2 + camera.y

    layoutNodes.forEach(node => {
      const dropId = `userspace:${node.userId}`
      let el = dropZoneRefs.current.get(dropId) as HTMLElement | undefined
      if (!el) {
        el = document.createElement('div')
        el.style.position = 'absolute'
        el.style.width = `${node.radius * 2}px`
        el.style.height = `${node.radius * 2}px`
        el.style.pointerEvents = 'none'
        container.appendChild(el)
        dropZoneRefs.current.set(dropId, el)
      }
      el.style.left = `${cx + node.x - node.radius}px`
      el.style.top = `${cy + node.y - node.radius}px`
    })

    return () => {
      layoutNodes.forEach(node => {
        const dropId = `userspace:${node.userId}`
        const el = dropZoneRefs.current.get(dropId)
        if (el && el.parentNode === container) {
          container.removeChild(el)
        }
        dropZoneRefs.current.delete(dropId)
      })
    }
  }, [visible, layoutNodes, camera, dropZoneRefs])

  // Register remote player positions + self as dynamic drop zones when dragging
  const selfDropEl = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!visible || !containerRef.current || !isDraggingDockstar) {
      // Clean up player drop zones
      playerDropEls.current.forEach((el, id) => {
        if (el.parentNode) el.parentNode.removeChild(el)
        dropZoneRefs.current.delete(`player:${id}`)
      })
      playerDropEls.current.clear()
      // Clean up self drop zone
      if (selfDropEl.current?.parentNode) {
        selfDropEl.current.parentNode.removeChild(selfDropEl.current)
        selfDropEl.current = null
      }
      dropZoneRefs.current.delete(`player:${selfUserId}`)
      return
    }

    const container = containerRef.current
    const rect = container.getBoundingClientRect()

    // Register self drop zone at center — only after dockstar has been dragged away
    if (hasDraggedAwayRef.current) {
      if (!selfDropEl.current) {
        selfDropEl.current = document.createElement('div')
        selfDropEl.current.style.position = 'absolute'
        selfDropEl.current.style.width = '40px'
        selfDropEl.current.style.height = '40px'
        selfDropEl.current.style.pointerEvents = 'none'
        container.appendChild(selfDropEl.current)
      }
      selfDropEl.current.style.left = `${rect.width / 2 - 20}px`
      selfDropEl.current.style.top = `${rect.height / 2 - 20}px`
      dropZoneRefs.current.set(`player:${selfUserId}`, selfDropEl.current)
    }

    // Register remote player drop zones
    if (remotePlayers && remotePlayers.length > 0) {
      const boundsW = BOUNDS.maxX - BOUNDS.minX
      const boundsH = BOUNDS.maxY - BOUNDS.minY

      remotePlayers.forEach(player => {
        const playerCamX = BOUNDS.minX + player.rx * boundsW
        const playerCamY = BOUNDS.minY + player.ry * boundsH
        const screenX = rect.width / 2 + camera.x - playerCamX
        const screenY = rect.height / 2 + camera.y - playerCamY

        let el = playerDropEls.current.get(player.id)
        if (!el) {
          el = document.createElement('div')
          el.style.position = 'absolute'
          el.style.width = '40px'
          el.style.height = '40px'
          el.style.pointerEvents = 'none'
          container.appendChild(el)
          playerDropEls.current.set(player.id, el)
        }
        el.style.left = `${screenX - 20}px`
        el.style.top = `${screenY - 20}px`
        dropZoneRefs.current.set(`player:${player.id}`, el)
      })
    }

    return () => {
      playerDropEls.current.forEach((el, id) => {
        if (el.parentNode === container) container.removeChild(el)
        dropZoneRefs.current.delete(`player:${id}`)
      })
      playerDropEls.current.clear()
      if (selfDropEl.current?.parentNode === container) {
        container.removeChild(selfDropEl.current)
        selfDropEl.current = null
      }
      dropZoneRefs.current.delete(`player:${selfUserId}`)
    }
  }, [visible, isDraggingDockstar, remotePlayers, camera, dropZoneRefs, selfUserId])

  if (!visible) return null

  // Calculate screen positions for frames
  const screenCx = (typeof window !== 'undefined' ? window.innerWidth : 375) / 2 + camera.x
  const screenCy = (typeof window !== 'undefined' ? window.innerHeight : 812) / 2 + camera.y

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 ${libraryOpen ? 'z-[10000]' : 'z-30'}`}
      style={{ touchAction: 'none', display: visible ? 'block' : 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <canvas
        ref={webglCanvasRef}
        className="absolute inset-0 w-full h-full"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />

      {/* ── COMPOSE MODE: draggable field handles ── */}
      {editMode && savedFields && savedFields.length > 0 && containerRef.current && (() => {
        const rect = containerRef.current.getBoundingClientRect()
        return savedFields.map(field => {
          const meta = fieldLayout.find(m => m.fieldId === field.id)
          const gx = meta?.gridX ?? field.transform.x
          const gy = meta?.gridY ?? field.transform.y
          const scaleMul = meta?.scaleMultiplier ?? 1.0
          const effectiveScale = field.transform.scale * scaleMul
          const halfExtent = FIELD_RENDER_EXTENT * effectiveScale
          const topLeft = gridToScreen(gx - halfExtent, gy + halfExtent, rect.width, rect.height, camera)
          const bottomRight = gridToScreen(gx + halfExtent, gy - halfExtent, rect.width, rect.height, camera)
          const w = bottomRight.screenX - topLeft.screenX
          const h = bottomRight.screenY - topLeft.screenY
          const isSelected = editSelectedId === field.id
          const fieldColor = `rgba(${Math.round(field.color[0]*255)},${Math.round(field.color[1]*255)},${Math.round(field.color[2]*255)},1)`

          return (
            <div
              key={`handle-${field.id}`}
              data-spatial-frame
              className="absolute pointer-events-auto cursor-grab active:cursor-grabbing"
              style={{
                left: topLeft.screenX,
                top: topLeft.screenY,
                width: Math.max(w, 40),
                height: Math.max(h, 40),
                border: isSelected ? `2px solid ${fieldColor}` : `1px dashed ${fieldColor}88`,
                backgroundColor: isSelected ? `${fieldColor}15` : 'transparent',
                borderRadius: 4,
                zIndex: isSelected ? 51 : 50,
              }}
              onPointerDown={(e) => {
                e.stopPropagation()
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                setEditSelectedId(field.id)
                editDragRef.current = {
                  fieldId: field.id,
                  startGridX: gx,
                  startGridY: gy,
                  startScreenX: e.clientX,
                  startScreenY: e.clientY,
                }
              }}
              onPointerMove={(e) => {
                if (!editDragRef.current || editDragRef.current.fieldId !== field.id) return
                const startGrid = screenToGridSpatial(
                  editDragRef.current.startScreenX - rect.left,
                  editDragRef.current.startScreenY - rect.top,
                  rect.width, rect.height, camera
                )
                const curGrid = screenToGridSpatial(
                  e.clientX - rect.left,
                  e.clientY - rect.top,
                  rect.width, rect.height, camera
                )
                const newGridX = editDragRef.current.startGridX + (curGrid.gridX - startGrid.gridX)
                const newGridY = editDragRef.current.startGridY + (curGrid.gridY - startGrid.gridY)
                setFieldLayout(prev => prev.map(m =>
                  m.fieldId === editDragRef.current!.fieldId
                    ? { ...m, gridX: newGridX, gridY: newGridY }
                    : m
                ))
              }}
              onPointerUp={() => {
                if (editDragRef.current) {
                  editDragRef.current = null
                  try { localStorage.setItem('spatialFieldLayout', JSON.stringify(fieldLayout)) } catch { /* ignore */ }
                }
              }}
            >
              <div
                className="absolute -top-5 left-0 text-[12px] font-mono truncate max-w-[120px] px-1 rounded"
                style={{ color: fieldColor, backgroundColor: 'rgba(2,6,23,0.8)' }}
              >
                {field.name}
              </div>
            </div>
          )
        })
      })()}

      {/* ── LOBBY MODE: Floating Tab Frames ── */}
      {spatialMode === 'lobby' && FRAMES.map(frame => {
        const frameLeft = screenCx + frame.x - FRAME_WIDTH / 2
        const frameTop = screenCy + frame.y - FRAME_HEIGHT / 2
        const previews = framePreviews?.[frame.tab] || []

        return (
          <div
            key={frame.id}
            data-spatial-frame
            className="absolute pointer-events-auto"
            style={{
              left: frameLeft,
              top: frameTop,
              width: FRAME_WIDTH,
              height: FRAME_HEIGHT,
            }}
          >
            <div
              className="w-full h-full rounded-xl overflow-hidden flex flex-col"
              style={{
                backgroundColor: '#0f172a',
                border: `1.5px solid ${frame.color}40`,
                boxShadow: `0 0 20px ${frame.color}15`,
              }}
            >
              {/* Frame header */}
              <div
                className="px-3 py-2 flex items-center gap-2 shrink-0"
                style={{ borderBottom: `1px solid ${frame.color}30` }}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: frame.color }}
                />
                <span
                  className="text-[13px] font-mono uppercase tracking-wider"
                  style={{ color: frame.color }}
                >
                  {frame.label}
                </span>
              </div>

              {/* Preview cards */}
              <div className="flex-1 px-2 py-2 space-y-1.5 overflow-hidden">
                {previews.length > 0 ? previews.slice(0, 4).map((title, i) => (
                  <div
                    key={i}
                    className="px-2 py-1.5 rounded text-[12px] font-serif leading-tight truncate"
                    style={{
                      backgroundColor: `${frame.color}08`,
                      color: '#94a3b8',
                      borderLeft: `2px solid ${frame.color}40`,
                    }}
                  >
                    {title}
                  </div>
                )) : (
                  <div className="text-[12px] font-mono text-muted-light/30 text-center pt-4">
                    No items
                  </div>
                )}
              </div>

              {/* Dockport */}
              <div className="shrink-0 px-3 py-2 flex justify-center" style={{ borderTop: `1px solid ${frame.color}20` }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleFrameDock(frame.tab)
                  }}
                  className="w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all hover:scale-110"
                  style={{
                    borderColor: `${frame.color}80`,
                    backgroundColor: `${frame.color}20`,
                  }}
                >
                  <svg className="w-4 h-4" style={{ fill: frame.color }} viewBox="0 0 24 24">
                    <path d="M12 2l3 9h-2v11h-2V11H9z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {/* ── LIST MODE: Floating cards from tab ── */}
      {spatialMode === 'list' && listTab && (() => {
        const items = listItems || []
        const tabColor = FRAMES.find(f => f.tab === listTab)?.color || '#22d3ee'
        const tabLabel = FRAMES.find(f => f.tab === listTab)?.label || listTab

        if (items.length === 0) {
          return (
            <div
              data-spatial-frame
              className="absolute pointer-events-auto"
              style={{
                left: screenCx - 80,
                top: screenCy - 30,
                width: 160,
              }}
            >
              <div className="text-center text-[13px] font-mono text-muted-light/50 py-4">
                No {tabLabel.toLowerCase()} yet
              </div>
            </div>
          )
        }

        return items.map((item, i) => {
          const col = i % LIST_COLS
          const row = Math.floor(i / LIST_COLS)
          const totalW = LIST_COLS * LIST_CARD_W + (LIST_COLS - 1) * LIST_GAP
          const cardX = screenCx + col * (LIST_CARD_W + LIST_GAP) - totalW / 2
          const cardY = screenCy + row * (LIST_CARD_H + LIST_GAP) - 120

          return (
            <div
              key={item.id}
              data-spatial-frame
              className="absolute pointer-events-auto"
              style={{
                left: cardX,
                top: cardY,
                width: LIST_CARD_W,
                height: LIST_CARD_H,
              }}
            >
              <div
                className="w-full h-full rounded-lg overflow-hidden flex flex-col"
                style={{
                  backgroundColor: '#0f172a',
                  border: `1px solid ${tabColor}30`,
                  boxShadow: `0 0 12px ${tabColor}10`,
                }}
              >
                <div className="flex-1 px-2.5 py-2 min-w-0">
                  <div
                    className="text-[12px] font-serif leading-snug line-clamp-3"
                    style={{ color: '#cbd5e1' }}
                  >
                    {item.title}
                  </div>
                  {item.phase && (
                    <div
                      className="mt-1 text-[11px] font-mono uppercase tracking-wide"
                      style={{ color: `${tabColor}99` }}
                    >
                      {item.phase}{item.tier ? ` T${item.tier}` : ''}
                    </div>
                  )}
                </div>
                <div className="shrink-0 px-2 py-1.5 flex justify-end" style={{ borderTop: `1px solid ${tabColor}15` }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDockItem?.(item.id)
                    }}
                    className="w-6 h-6 rounded-full border flex items-center justify-center transition-all hover:scale-110"
                    style={{
                      borderColor: `${tabColor}60`,
                      backgroundColor: `${tabColor}15`,
                    }}
                  >
                    <svg className="w-3 h-3" style={{ fill: tabColor }} viewBox="0 0 24 24">
                      <path d="M12 2l3 9h-2v11h-2V11H9z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )
        })
      })()}

      {/* ── PLAYER MODE: Leader-follow panel — always visible, centered ── */}
      {spatialMode === 'player' && dockedPlayer && (
        <div
          data-spatial-frame
          className="absolute pointer-events-auto"
          style={{
            left: screenCx - 140,
            top: screenCy - 40,
            width: 280,
          }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: '#0f172aee',
              border: `1.5px solid ${dockedPlayer.color}40`,
              boxShadow: `0 0 20px ${dockedPlayer.color}15`,
            }}
          >
            <div className="px-3 py-2.5">
              {hostNavState?.dockedPostId ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-mono text-muted-light/50 uppercase tracking-wider mb-0.5">Viewing</div>
                    <div className="text-[13px] font-serif text-foreground/80 truncate">
                      {hostNavState.dockedPostId}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onFollowHost?.()
                    }}
                    className="shrink-0 px-2.5 py-1 rounded-md text-[12px] font-mono transition-all hover:scale-105"
                    style={{
                      backgroundColor: `${dockedPlayer.color}20`,
                      color: dockedPlayer.color,
                      border: `1px solid ${dockedPlayer.color}40`,
                    }}
                  >
                    Follow
                  </button>
                </div>
              ) : hostNavState?.activeTab ? (
                <div>
                  <div className="text-[12px] font-mono text-muted-light/50 uppercase tracking-wider mb-0.5">Browsing</div>
                  <div className="text-[13px] font-mono capitalize" style={{ color: dockedPlayer.color }}>
                    {hostNavState.activeTab}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: dockedPlayer.color }}
                  />
                  <span className="text-[13px] font-mono text-muted-light/50">
                    {dockedPlayer.name} is here
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Nest too deep toast */}
      {nestTooDeep && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="px-4 py-2 rounded-lg bg-error/90 text-white text-xs font-mono backdrop-blur-sm">
            Nesting too deep (max {MAX_NEST_DEPTH})
          </div>
        </div>
      )}

      {/* Subtle count label — bottom right */}
      <div className="absolute bottom-3 right-3 text-[12px] font-mono text-muted-light/30 pointer-events-none">
        {spatialMode === 'lobby' && `${layoutNodes.length} ${layoutNodes.length === 1 ? 'host' : 'hosts'}`}
        {spatialMode === 'list' && `${(listItems || []).length} ${listTab || 'items'}`}
      </div>

      {/* Admin: field backdrop manager with library */}
      {isAdmin && (
        <div className="absolute bottom-3 left-3 pointer-events-auto" data-spatial-frame>
          <div className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-lg p-3 max-w-[220px] max-h-[50vh] overflow-y-auto">

            {/* Compose mode toggle */}
            <button
              onClick={() => {
                setEditMode(m => !m)
                if (editMode) setEditSelectedId(null)
              }}
              className={`w-full text-[12px] font-mono py-1.5 px-2 rounded border transition-colors mb-2 flex items-center justify-center gap-1.5 ${
                editMode
                  ? 'border-warning/60 text-warning bg-warning/10'
                  : 'border-accent/40 text-accent hover:bg-accent/10'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {editMode ? (
                  <path d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                )}
              </svg>
              {editMode ? 'Exit Compose' : 'Compose'}
            </button>

            {/* Per-field controls when a field is selected in edit mode */}
            {editMode && editSelectedId && (() => {
              const selectedField = savedFields?.find(f => f.id === editSelectedId)
              const selectedMeta = fieldLayout.find(m => m.fieldId === editSelectedId)
              if (!selectedField || !selectedMeta) return null
              const fieldColor = `rgba(${Math.round(selectedField.color[0]*255)},${Math.round(selectedField.color[1]*255)},${Math.round(selectedField.color[2]*255)},1)`
              return (
                <div className="mb-2 p-2 rounded border border-border/50 bg-background/50">
                  <p className="text-[12px] font-mono truncate mb-1.5" style={{ color: fieldColor }}>
                    {selectedField.name}
                  </p>
                  <label className="flex items-center justify-between text-[12px] font-mono text-muted mb-1">
                    <span>Scale ({selectedMeta.scaleMultiplier.toFixed(1)})</span>
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="10"
                    step="0.1"
                    value={selectedMeta.scaleMultiplier}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setFieldLayout(prev => {
                        const updated = prev.map(m => m.fieldId === editSelectedId ? { ...m, scaleMultiplier: val } : m)
                        try { localStorage.setItem('spatialFieldLayout', JSON.stringify(updated)) } catch { /* ignore */ }
                        return updated
                      })
                    }}
                    className="w-full h-1 mb-2 accent-accent"
                  />
                  <label className="flex items-center justify-between text-[12px] font-mono text-muted mb-1">
                    <span>Depth ({selectedMeta.depth.toFixed(1)})</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.1"
                    value={selectedMeta.depth}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setFieldLayout(prev => {
                        const updated = prev.map(m => m.fieldId === editSelectedId ? { ...m, depth: val } : m)
                        try { localStorage.setItem('spatialFieldLayout', JSON.stringify(updated)) } catch { /* ignore */ }
                        return updated
                      })
                    }}
                    className="w-full h-1 mb-1 accent-accent"
                  />
                </div>
              )
            })()}

            {/* Active backdrop */}
            <p className="text-[12px] font-mono text-muted uppercase tracking-wider mb-1.5">Active Backdrop</p>
            {savedFields && savedFields.length > 0 ? (
              <div className="flex flex-col gap-1 mb-3">
                {savedFields.map(f => (
                  <div key={f.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span
                      className="truncate"
                      style={{ color: `rgba(${Math.round(f.color[0]*255)},${Math.round(f.color[1]*255)},${Math.round(f.color[2]*255)},1)` }}
                    >
                      {f.name}
                    </span>
                    <button
                      onClick={() => onRemoveSavedField?.(f.id)}
                      className="text-muted hover:text-error shrink-0"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted mb-3">No backdrop fields active.</p>
            )}

            {/* Library */}
            <div className="border-t border-border/50 pt-2 flex flex-col gap-1.5">
              <button
                onClick={() => { setLibraryOpen(true); setLibrarySearch(''); setLibraryDetailId(null) }}
                className="w-full text-[12px] font-mono py-1.5 px-2 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
              >
                Browse Library ({fieldLibrary?.length || 0})
              </button>
              <button
                onClick={onImportAllFields}
                className="w-full text-[12px] font-mono py-1 px-2 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
              >
                Import all from engine
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── LIBRARY BROWSER OVERLAY ── */}
      {libraryOpen && (
        <div
          data-spatial-frame
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto"
          style={{ backgroundColor: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(8px)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setLibraryOpen(false)
              setLibrarySearch('')
              setLibraryDetailId(null)
            }
          }}
        >
          <div
            className="relative w-full max-w-5xl mx-4 rounded-xl overflow-hidden flex flex-col"
            style={{ maxHeight: '90vh', backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30 shrink-0">
              <h2 className="text-sm font-mono text-foreground/90 whitespace-nowrap">Field Library</h2>
              <span className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                {fieldLibrary?.length || 0}
              </span>
              <input
                type="text"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Search fields..."
                className="flex-1 text-xs font-mono bg-background/50 border border-border/40 rounded px-2.5 py-1.5 text-foreground placeholder:text-muted/50 outline-none focus:border-accent/50"
                autoFocus
              />
              <button
                onClick={() => { setLibraryOpen(false); setLibrarySearch(''); setLibraryDetailId(null) }}
                className="text-muted hover:text-foreground transition-colors shrink-0 p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-1 min-h-0">
              {/* Grid area */}
              <div
                className={`flex-1 overflow-y-auto p-4 ${libraryDetailField ? 'hidden md:block' : ''}`}
              >
                {filteredLibrary.length === 0 ? (
                  <div className="text-center text-xs font-mono text-muted/50 py-12">
                    {librarySearch ? 'No fields match your search.' : 'No fields in library. Import from the engine.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredLibrary.map(f => {
                      const colorStr = `rgba(${Math.round(f.color[0]*255)},${Math.round(f.color[1]*255)},${Math.round(f.color[2]*255)},1)`
                      const isActive = savedFields?.some(sf => sf.id === f.id)
                      const isSelected = libraryDetailId === f.id
                      const blendModes = [...new Set(f.effects.map(e => e.blend))]
                      const childCount = fieldLibrary?.filter(c => c.parentFieldId === f.id).length || 0
                      return (
                        <button
                          key={f.id}
                          onClick={() => setLibraryDetailId(isSelected ? null : f.id)}
                          className="text-left rounded-lg p-3 border transition-all hover:border-accent/40"
                          style={{
                            backgroundColor: isSelected ? '#1e293b' : '#0f172a',
                            borderColor: isSelected ? colorStr : '#1e293b',
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div
                              className="w-3 h-3 rounded-sm shrink-0"
                              style={{ backgroundColor: colorStr }}
                            />
                            <span className="text-xs font-mono text-foreground/90 truncate">{f.name}</span>
                            {isActive && (
                              <span className="text-[11px] font-mono px-1 py-0.5 rounded bg-success/15 text-success shrink-0">Active</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[12px] font-mono text-muted">
                              {f.effects.length} effect{f.effects.length !== 1 ? 's' : ''}
                            </span>
                            {childCount > 0 && (
                              <span className="text-[12px] font-mono text-muted">
                                {childCount} child{childCount !== 1 ? 'ren' : ''}
                              </span>
                            )}
                            {blendModes.map(b => (
                              <span key={b} className="text-[11px] font-mono px-1 py-0.5 rounded bg-background/80 text-muted/70">
                                {b}
                              </span>
                            ))}
                          </div>
                          {f.effects[0]?.description && (
                            <p className="text-[12px] text-muted/60 line-clamp-2 leading-snug">
                              {f.effects[0].description}
                            </p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Detail panel */}
              {libraryDetailField && (
                <div
                  className="w-full md:w-80 md:max-w-xs border-l border-border/30 overflow-y-auto shrink-0 flex flex-col"
                  style={{ backgroundColor: '#0b1120' }}
                >
                  <div className="p-4 flex flex-col gap-3">
                    {/* Mobile back arrow */}
                    <button
                      onClick={() => setLibraryDetailId(null)}
                      className="md:hidden flex items-center gap-1.5 text-xs font-mono text-muted hover:text-foreground transition-colors mb-1"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M15 19l-7-7 7-7" />
                      </svg>
                      Back to grid
                    </button>

                    {/* Parent breadcrumb for child fields */}
                    {libraryDetailField.parentFieldId && (() => {
                      const parent = fieldLibrary?.find(f => f.id === libraryDetailField.parentFieldId)
                      if (!parent) return null
                      return (
                        <button
                          onClick={() => setLibraryDetailId(parent.id)}
                          className="flex items-center gap-1.5 text-[12px] font-mono text-muted hover:text-foreground transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M15 19l-7-7 7-7" />
                          </svg>
                          {parent.name}
                        </button>
                      )
                    })()}

                    {/* Field name + color */}
                    <div className="flex items-center gap-2">
                      <div
                        className="w-4 h-4 rounded-sm shrink-0"
                        style={{ backgroundColor: `rgba(${Math.round(libraryDetailField.color[0]*255)},${Math.round(libraryDetailField.color[1]*255)},${Math.round(libraryDetailField.color[2]*255)},1)` }}
                      />
                      <h3 className="text-sm font-mono text-foreground/90 truncate">{libraryDetailField.name}</h3>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-1.5">
                      {savedFields?.some(sf => sf.id === libraryDetailField.id) ? (
                        <div className="text-[12px] font-mono py-1.5 px-2 rounded border border-success/30 text-success/70 text-center">
                          Already Loaded
                        </div>
                      ) : (
                        <button
                          onClick={() => onLoadFromLibrary?.(libraryDetailField.id)}
                          className="text-[12px] font-mono py-1.5 px-2 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
                        >
                          Load to Backdrop
                        </button>
                      )}
                      <button
                        onClick={() => {
                          onRemoveFromLibrary?.(libraryDetailField.id)
                          setLibraryDetailId(null)
                        }}
                        className="text-[12px] font-mono py-1.5 px-2 rounded border border-error/30 text-error/70 hover:bg-error/10 transition-colors"
                      >
                        Remove from Library
                      </button>
                    </div>

                    {/* Color RGBA */}
                    <div>
                      <p className="text-[12px] font-mono text-muted uppercase tracking-wider mb-1">Color</p>
                      <p className="text-[13px] font-mono text-foreground/70">
                        rgba({libraryDetailField.color.map(c => c.toFixed(2)).join(', ')})
                      </p>
                    </div>

                    {/* Transform */}
                    <div>
                      <p className="text-[12px] font-mono text-muted uppercase tracking-wider mb-1">Transform</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] font-mono text-foreground/60">
                        <span>X: {libraryDetailField.transform.x.toFixed(1)}</span>
                        <span>Y: {libraryDetailField.transform.y.toFixed(1)}</span>
                        <span>Scale: {libraryDetailField.transform.scale.toFixed(2)}</span>
                        <span>Rot: {(libraryDetailField.transform.rotation * 180 / Math.PI).toFixed(1)}&deg;</span>
                      </div>
                    </div>

                    {/* Child fields */}
                    {libraryDetailChildren.length > 0 && (
                      <div>
                        <p className="text-[12px] font-mono text-muted uppercase tracking-wider mb-1.5">
                          Children ({libraryDetailChildren.length})
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {libraryDetailChildren.map(child => {
                            const childColor = `rgba(${Math.round(child.color[0]*255)},${Math.round(child.color[1]*255)},${Math.round(child.color[2]*255)},1)`
                            return (
                              <button
                                key={child.id}
                                onClick={() => setLibraryDetailId(child.id)}
                                className="flex items-center gap-2 text-left rounded border border-border/30 p-2 hover:border-accent/30 transition-colors bg-background/30"
                              >
                                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: childColor }} />
                                <span className="text-[12px] font-mono text-foreground/70 truncate">{child.name}</span>
                                <span className="text-[11px] font-mono text-muted ml-auto shrink-0">
                                  {child.effects.length} fx
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Effects */}
                    {libraryDetailField.effects.length > 0 && (
                      <div>
                        <p className="text-[12px] font-mono text-muted uppercase tracking-wider mb-1.5">
                          Effects ({libraryDetailField.effects.length})
                        </p>
                        <div className="flex flex-col gap-2">
                          {libraryDetailField.effects.map(effect => (
                            <div key={effect.id} className="rounded border border-border/30 p-2 bg-background/30">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[12px] font-mono text-foreground/70">{effect.author}</span>
                                <span className="text-[11px] font-mono px-1 py-0.5 rounded bg-accent/10 text-accent/70">
                                  {effect.blend}
                                </span>
                              </div>
                              {effect.description && (
                                <p className="text-[12px] text-muted/60 mb-1.5 leading-snug">{effect.description}</p>
                              )}
                              <pre className="text-[12px] font-mono text-foreground/40 bg-background/50 rounded p-1.5 overflow-x-auto max-h-24 leading-tight">
                                {(effect.wgsl || '').slice(0, 300)}{(effect.wgsl || '').length > 300 ? '...' : ''}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Memory log */}
                    {libraryDetailField.memory.length > 0 && (
                      <div>
                        <p className="text-[12px] font-mono text-muted uppercase tracking-wider mb-1.5">
                          Memory ({libraryDetailField.memory.length})
                        </p>
                        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                          {[...libraryDetailField.memory].reverse().slice(0, 20).map((entry, i) => (
                            <div key={i} className="text-[12px] font-mono text-foreground/40 leading-snug">
                              <span className="text-muted/40">{new Date(entry.timestamp).toLocaleTimeString()}</span>{' '}
                              <span className="text-accent/40">[{entry.type}]</span>{' '}
                              {entry.content}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default SpatialCanvas
