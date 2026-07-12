'use client'

import { useState, useRef, useCallback, useEffect, createContext, useContext } from 'react'

interface DockstarProps {
  userInitial: string
  dockedPostId: string | null
  dropZoneRefs: React.MutableRefObject<Map<string, HTMLElement>>
  onDock: (postId: string) => void
  onUndock: () => void
  onUndockIdea?: () => void
  onDragStateChange?: (isDragging: boolean, nearestDrop: string | null) => void
  onDragPositionChange?: (pos: { x: number; y: number } | null) => void
  // Flash gold on miss-tap
  flashDocks?: boolean
  // External drag trigger — sidebar sets this to initiate drag from its position
  externalDragStart?: { x: number; y: number } | null
  onExternalDragHandled?: () => void
  // Subspace mode — dockstar becomes back arrow
  isSubspace?: boolean
  onExitSubspace?: () => void
  /** Custom accent color (hex) for orb. Defaults to cyan (#22d3ee). */
  accentColor?: string
  /** Double-tap the orb to toggle spatial view */
  onToggleSpatial?: () => void
  /** Whether spatial view is active — centers the orb on screen */
  isSpatial?: boolean
  /** Rotation angle (degrees) for the arrow in spatial mode */
  spatialRotation?: number
}

export default function Dockstar({
  userInitial,
  dockedPostId,
  dropZoneRefs,
  onDock,
  onUndock,
  onUndockIdea,
  onDragStateChange,
  flashDocks,
  externalDragStart,
  onExternalDragHandled,
  isSubspace,
  onExitSubspace,
  accentColor,
  onToggleSpatial,
  isSpatial,
  spatialRotation = 0,
  onDragPositionChange,
}: DockstarProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [nearestDrop, setNearestDrop] = useState<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const hasDraggedRef = useRef(false)
  const lastTapRef = useRef(0)

  // Notify parent of drag state
  useEffect(() => {
    onDragStateChange?.(isDragging, nearestDrop)
  }, [isDragging, nearestDrop, onDragStateChange])

  // Notify parent of drag position for ring expansion
  useEffect(() => {
    onDragPositionChange?.(isDragging ? dragPos : null)
  }, [isDragging, dragPos, onDragPositionChange])

  // Find nearest drop zone
  const findNearestDropZone = useCallback(
    (x: number, y: number): { id: string; distance: number } | null => {
      let nearest: { id: string; distance: number } | null = null
      dropZoneRefs.current.forEach((el, id) => {
        const rect = el.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const dist = Math.hypot(x - cx, y - cy)
        if (dist < 80 && (!nearest || dist < nearest.distance)) {
          nearest = { id, distance: dist }
        }
      })
      return nearest
    },
    [dropZoneRefs]
  )

  // External drag trigger — DropCircle initiates drag from its position
  // Uses ref to avoid cleanup removing listeners mid-drag when deps change
  const externalDragRef = useRef(externalDragStart)
  useEffect(() => {
    // Only trigger when externalDragStart goes from null → value
    if (!externalDragStart || externalDragStart === externalDragRef.current) return
    externalDragRef.current = externalDragStart
    setIsDragging(true)
    setDragPos(externalDragStart)
    onExternalDragHandled?.()

    const onMove = (e: PointerEvent) => {
      e.preventDefault()
      setDragPos({ x: e.clientX, y: e.clientY })
      const nearest = findNearestDropZone(e.clientX, e.clientY)
      setNearestDrop(nearest?.id || null)
    }
    const onUp = (e: PointerEvent) => {
      const nearest = findNearestDropZone(e.clientX, e.clientY)
      if (nearest) {
        onDock(nearest.id)
      } else if (dockedPostId?.startsWith('idea:') && onUndockIdea) {
        onUndockIdea()
      } else {
        onUndock()
      }
      setIsDragging(false)
      setDragPos(null)
      setNearestDrop(null)
      externalDragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // No cleanup — onUp handles listener removal. listenersActive check via ref prevents stale handlers.
  }, [externalDragStart, onExternalDragHandled, findNearestDropZone, onDock, onUndock, onUndockIdea, dockedPostId])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      dragStartRef.current = { x: e.clientX, y: e.clientY }
      hasDraggedRef.current = false
      setDragPos({ x: e.clientX, y: e.clientY })
    },
    []
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current) return
      e.preventDefault()
      // Check drag threshold (5px) before entering drag mode
      if (!hasDraggedRef.current) {
        const dx = e.clientX - dragStartRef.current.x
        const dy = e.clientY - dragStartRef.current.y
        if (Math.hypot(dx, dy) < 5) return
        hasDraggedRef.current = true
        setIsDragging(true)
      }
      setDragPos({ x: e.clientX, y: e.clientY })
      const nearest = findNearestDropZone(e.clientX, e.clientY)
      setNearestDrop(nearest?.id || null)
    },
    [findNearestDropZone]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current) return
      dragStartRef.current = null

      if (!hasDraggedRef.current) {
        // When docked, tap undocks. When undocked, tap toggles spatial view.
        if (dockedPostId) {
          onUndock()
        } else if (onToggleSpatial) {
          onToggleSpatial()
        }
        setDragPos(null)
        return
      }

      const nearest = findNearestDropZone(e.clientX, e.clientY)
      if (nearest) {
        onDock(nearest.id)
      } else if (dockedPostId?.startsWith('idea:') && onUndockIdea) {
        onUndockIdea()
      } else if (dockedPostId) {
        onUndock()
      }
      setIsDragging(false)
      setDragPos(null)
      setNearestDrop(null)
    },
    [findNearestDropZone, onDock, onUndock, onUndockIdea, dockedPostId, onToggleSpatial]
  )

  // Determine orb position — one orb, three states: home, dragging, sidebar
  const isAtHome = !isDragging && !dockedPostId
  const isDockedToIdea = dockedPostId?.startsWith('idea:') ?? false
  let orbStyle: React.CSSProperties

  if (isDragging && dragPos) {
    // Snap to DropCircle center when near one
    let snapX = dragPos.x, snapY = dragPos.y
    if (nearestDrop) {
      const el = dropZoneRefs.current.get(nearestDrop)
      if (el) {
        const rect = el.getBoundingClientRect()
        snapX = rect.left + rect.width / 2
        snapY = rect.top + rect.height / 2
      }
    }
    orbStyle = { position: 'fixed', left: snapX - 20, top: snapY - 20, right: 'auto', transition: nearestDrop ? 'left 0.15s ease-out, top 0.15s ease-out' : 'none' }
  } else if (dockedPostId) {
    // Docked — aligned with right edge of max-w-2xl content area
    orbStyle = { position: 'fixed', top: 8, right: 'max(4px, calc(50% - 336px + 4px))', left: 'auto', transition: 'all 0.3s ease-out' }
  } else if (isSpatial) {
    // Spatial view — center of screen
    orbStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', transition: 'all 0.4s ease-out' }
  } else {
    // Home — inline in header, no fixed positioning needed
    orbStyle = {}
  }

  return (
    <>
      {/* The single orb — inline at home, fixed when dragging/docked */}
      <div
        data-dockstar
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`${isAtHome && !isSpatial ? 'relative' : 'fixed'} z-[9999] select-none touch-none shrink-0 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={orbStyle}
      >
        <div
          className={`flex items-center justify-center rounded-full border-2 select-none transition-all duration-150 w-10 h-10 ${!accentColor ? (isSubspace ? 'bg-accent/15 border-accent/60 hover:border-accent hover:bg-accent/25 shadow-[0_0_8px_rgba(34,211,238,0.2)]' : isDragging ? 'bg-accent text-header border-accent shadow-[0_0_24px_rgba(34,211,238,0.6)]' : dockedPostId ? 'bg-accent text-header border-accent shadow-[0_0_12px_rgba(34,211,238,0.4)]' : 'bg-accent text-header border-accent shadow-[0_0_12px_rgba(34,211,238,0.4)] hover:shadow-[0_0_20px_rgba(34,211,238,0.5)]') : 'text-header'} ${isAtHome && !isSubspace && !accentColor ? 'animate-pulse-slow' : ''} ${flashDocks ? 'animate-flash-gold' : ''}`}
          style={accentColor ? {
            backgroundColor: accentColor,
            borderColor: accentColor,
            boxShadow: isDragging
              ? `0 0 24px ${accentColor}99`
              : isAtHome && !isSubspace
              ? `0 0 0 0 ${accentColor}4d`
              : `0 0 12px ${accentColor}66`,
            ...(isAtHome && !isSubspace ? {
              animation: 'pulse-slow-custom 3s ease-in-out infinite',
            } : {}),
          } : undefined}
        >
          {isSubspace ? (
            <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 19.5L3.75 12l7.5-7.5" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 19.5L12 12l7.5-7.5" /></svg>
          ) : isSpatial ? (
            <svg className="w-6 h-6 fill-header" viewBox="0 0 24 24" style={{ transform: `rotate(${spatialRotation}deg)`, transformOrigin: 'center' }}><path d="M12 2l4.5 11h-3.5v9h-2v-9H7.5z" /></svg>
          ) : (
            <svg className="w-6 h-6 fill-header" viewBox="0 0 24 24"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z" /></svg>
          )}
        </div>
        {isDragging && (
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-muted whitespace-nowrap font-mono">
            drop to dock
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse-slow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.3); }
          50% { box-shadow: 0 0 0 8px rgba(34, 211, 238, 0); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 3s ease-in-out infinite;
        }
        @keyframes pulse-slow-custom {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.06); }
        }
        @keyframes flash-gold {
          0% { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.7), 0 0 16px rgba(245, 158, 11, 0.4); border-color: #f59e0b; }
          100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0), 0 0 0 rgba(245, 158, 11, 0); }
        }
        .animate-flash-gold {
          animation: flash-gold 0.6s ease-out forwards;
        }
        @keyframes dock-pulse {
          0%, 85%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); border-color: inherit; }
          90% { box-shadow: 0 0 6px 1px rgba(245, 158, 11, 0.3); border-color: rgba(245, 158, 11, 0.5); }
        }
        .animate-dock-pulse {
          animation: dock-pulse 4s ease-in-out infinite;
        }
      `}</style>
    </>
  )
}

// Context for glow state
interface GlowState {
  nearestDrop: string | null
  isDragging: boolean
}

export const DockstarGlowContext = createContext<GlowState>({
  nearestDrop: null,
  isDragging: false,
})

export function useDropZoneGlow(id: string) {
  const { nearestDrop, isDragging } = useContext(DockstarGlowContext)
  return isDragging && nearestDrop === id
}

// Drop circle for posts
interface DropCircleProps {
  id: string
  isActive: boolean
  isDocked: boolean
  userInitial?: string
  registerRef: (id: string, el: HTMLElement | null) => void
  onClick?: () => void
  onDragUndock?: (x: number, y: number) => void
  flashDocks?: boolean
  faded?: boolean
  glowDrag?: boolean
  /** Custom accent color (hex). Defaults to cyan (#22d3ee / accent). */
  accentColor?: string
  /** Custom icon to replace the default compass. */
  icon?: 'chat' | 'flame' | 'document' | 'people' | 'default'
}

export function DropCircle({ id, isActive, isDocked, userInitial, registerRef, onClick, onDragUndock, flashDocks, faded, glowDrag, accentColor, icon }: DropCircleProps) {
  const ref = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const hasDraggedRef = useRef(false)

  useEffect(() => {
    registerRef(id, ref.current)
    return () => registerRef(id, null)
  }, [id, registerRef])

  return (
    <div className="relative shrink-0">
      <div
        ref={ref}
        data-dockpoint
        onClick={(e) => {
          if (isDocked && onDragUndock) return // handled by pointer events
          if (glowDrag || isActive) return // during Dockstar drag, skip clicks
          e.preventDefault(); e.stopPropagation(); (document.activeElement as HTMLElement)?.blur(); if (onClick) onClick()
        }}
        onPointerDown={isDocked && onDragUndock ? (e) => {
          e.preventDefault()
          e.stopPropagation()
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          dragStartRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
          hasDraggedRef.current = false
        } : undefined}
        onPointerMove={isDocked && onDragUndock ? (e) => {
          if (!dragStartRef.current || hasDraggedRef.current) return
          const dx = e.clientX - dragStartRef.current.x
          const dy = e.clientY - dragStartRef.current.y
          if (Math.hypot(dx, dy) >= 5) {
            hasDraggedRef.current = true
            ;(e.currentTarget as HTMLElement).releasePointerCapture(dragStartRef.current.pointerId)
            onDragUndock!(e.clientX, e.clientY)
            dragStartRef.current = null
          }
        } : undefined}
        onPointerUp={isDocked && onDragUndock ? (e) => {
          if (dragStartRef.current && !hasDraggedRef.current) {
            ;(document.activeElement as HTMLElement)?.blur()
            onClick?.()
          }
          dragStartRef.current = null
        } : undefined}
        className={`rounded-full border-2 flex items-center justify-center select-none touch-none transition-all duration-200 ${accentColor ? 'w-10 h-10 cursor-pointer' : isDocked ? (faded ? 'w-10 h-10 bg-accent/30 border-accent/40 text-header/50 cursor-pointer' : 'w-10 h-10 bg-accent border-accent text-header shadow-[0_0_12px_rgba(34,211,238,0.4)] cursor-pointer') : isActive ? 'w-10 h-10 border-accent bg-accent/20 scale-110 shadow-[0_0_12px_rgba(34,211,238,0.4)]' : glowDrag ? 'w-10 h-10 border-[#f59e0b]/60 bg-[#f59e0b]/10 shadow-[0_0_8px_rgba(245,158,11,0.3)]' : 'w-10 h-10 border-accent/50 bg-accent/5 hover:border-accent hover:bg-accent/10'} ${flashDocks ? 'animate-flash-gold' : ''}`}
        style={accentColor ? (isDocked ? {
          borderColor: accentColor,
          backgroundColor: accentColor,
          boxShadow: `0 0 12px ${accentColor}66`,
        } : {
          borderColor: `${accentColor}80`,
          backgroundColor: `${accentColor}0d`,
        }) : undefined}
      >
        {(() => {
          const strokeCls = `w-5 h-5 transition-colors ${isDocked ? (faded ? 'fill-none stroke-header/50' : 'fill-none stroke-header') : !accentColor && (flashDocks || glowDrag) ? 'fill-none stroke-[#f59e0b]' : !accentColor && isActive ? 'fill-none stroke-accent' : !accentColor ? 'fill-none stroke-accent/40' : 'fill-none'}`
          const strokeStyle = !isDocked && accentColor ? { stroke: `${accentColor}66` } : undefined
          const fillCls = isDocked
            ? `w-5 h-5 ${faded ? 'fill-header/50' : 'fill-header'}`
            : `w-5 h-5 transition-colors ${!accentColor && (flashDocks || glowDrag) ? 'fill-[#f59e0b]' : !accentColor && isActive ? 'fill-accent' : !accentColor ? 'fill-accent/40' : ''}`
          const fillStyle = !isDocked && accentColor ? { fill: `${accentColor}66` } : undefined
          if (icon === 'chat') return (
            <svg className={strokeCls} viewBox="0 0 24 24" strokeWidth={1.8} style={strokeStyle}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
          )
          if (icon === 'flame') return (
            <svg className={strokeCls} viewBox="0 0 24 24" strokeWidth={1.5} style={strokeStyle}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.047 8.287 8.287 0 009 9.601a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.468 5.99 5.99 0 00-1.925 3.547 5.975 5.975 0 01-2.133-1.001A3.75 3.75 0 0012 18z" />
            </svg>
          )
          if (icon === 'document') return (
            <svg className={strokeCls} viewBox="0 0 24 24" strokeWidth={1.5} style={strokeStyle}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
            </svg>
          )
          if (icon === 'people') return (
            <svg className={strokeCls} viewBox="0 0 24 24" strokeWidth={1.5} style={strokeStyle}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          )
          // Default compass
          return <svg className={fillCls} viewBox="0 0 24 24" style={fillStyle}><path d="M4 4l7.07 17 2.51-7.39L21 11.07z" /></svg>
        })()}
      </div>
    </div>
  )
}

// Nav drop circle for bottom bar
interface NavDropCircleProps {
  id: string
  label: string
  icon: React.ReactNode
  isActive: boolean
  registerRef: (id: string, el: HTMLElement | null) => void
  onClick?: () => void
  glowDrag?: boolean
  /** Custom default color (hex). Used when not active or glowing. */
  color?: string
  /** Presence players on this tab */
  players?: { id: string; name: string; color: string }[]
}

export function NavDropCircle({ id, label, icon, isActive, registerRef, onClick, glowDrag, color, players }: NavDropCircleProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    registerRef(id, ref.current)
    return () => registerRef(id, null)
  }, [id, registerRef])

  return (
    <div ref={ref} onClick={onClick} className={`relative flex items-center justify-center p-1 rounded-lg transition-all duration-200 ${onClick ? 'cursor-pointer' : ''} ${isActive ? 'scale-105' : ''}`} style={isActive ? { backgroundColor: `${color || '#22d3ee'}26`, boxShadow: `0 0 16px ${color || '#22d3ee'}4d` } : glowDrag ? { backgroundColor: '#f59e0b1a', boxShadow: '0 0 8px #f59e0b4d' } : undefined}>
      <div
        className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all duration-200`}
        style={isActive
          ? { borderColor: color || '#22d3ee', backgroundColor: `${color || '#22d3ee'}33`, color: color || '#22d3ee' }
          : glowDrag
          ? { borderColor: '#f59e0b99', backgroundColor: '#f59e0b1a', color: '#f59e0b' }
          : { borderColor: `${color || '#a78bfa'}66`, color: `${color || '#a78bfa'}b3` }
        }
      >
        {icon}
      </div>
      {players && players.length > 0 && players.slice(0, 6).map((p, i) => {
        const angle = (i * 137.5 + 30) * (Math.PI / 180)
        const r = 22
        return (
          <div
            key={p.id}
            className="absolute pointer-events-none"
            style={{
              left: `calc(50% + ${Math.cos(angle) * r}px - 5px)`,
              top: `calc(50% + ${Math.sin(angle) * r}px - 3.5px)`,
              filter: `drop-shadow(0 0 3px ${p.color}80)`,
              animation: `presence-drift ${2.5 + (i * 0.7) % 2}s ease-in-out infinite`,
              animationDelay: `${-(i * 1.3) % 3}s`,
            }}
            title={p.name}
          >
            <svg width="10" height="7" viewBox="0 0 20 14" fill="none">
              <path d="M10 0C4 0 0 7 0 7s4 7 10 7 10-7 10-7S16 0 10 0z" fill="#e2e8f0" stroke={p.color} strokeWidth="1.5" />
              <ellipse cx="10" cy="7" rx="3.5" ry="3.5" fill={p.color} />
              <ellipse cx="10" cy="7" rx="1.5" ry="1.5" fill="#020617" />
            </svg>
          </div>
        )
      })}
    </div>
  )
}
