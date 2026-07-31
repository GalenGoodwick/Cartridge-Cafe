// engine/TouchControls.tsx — carved out of FieldEngine.tsx
// (DESIGN-fieldengine-carve.md, Phase 2). Pure move, byte-identical body.
'use client'

import { useRef, useCallback, useState } from 'react'
import type { FieldSimulation } from './simulation'

/** Virtual touch controls — a left thumb-stick (arrows + WASD) and two action
 *  buttons (A = space, B = enter) writing the same worldData.key_* the keyboard
 *  writes, so every existing cartridge gains touch support unchanged.
 *  Renders only on touch devices; the stick nub is moved via style (no re-renders). */
export function TouchControls({ simRef }: { simRef: { current: FieldSimulation | null } }) {
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
