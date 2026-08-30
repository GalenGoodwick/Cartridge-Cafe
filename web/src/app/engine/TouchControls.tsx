// engine/TouchControls.tsx — carved out of FieldEngine.tsx
// (DESIGN-fieldengine-carve.md, Phase 2). Pure move, byte-identical body.
'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import type { FieldSimulation } from './simulation'
import { layoutTouchZones } from './touch-layout'

/** Virtual touch controls — a left thumb-stick (arrows + WASD) and two action
 *  buttons (A = space, B = enter) writing the same worldData.key_* the keyboard
 *  writes, so every existing cartridge gains touch support unchanged.
 *  Renders only on touch devices; the stick nub is moved via style (no re-renders). */
export function TouchControls({ simRef, frame, suppressed }: {
  simRef: { current: FieldSimulation | null }
  /** the world declared its OWN key: ui buttons — the generic controls stand down */
  suppressed?: boolean
  /** the contained frame's inset (the grid's viewport) — controls lay out
   *  INSIDE it instead of the window (Galen: "controls outside the grid").
   *  Absent = legacy full-window layout. NOTE: layout is still the generic
   *  stick+A/B; per-world PROGRAMMABLE controls are the named next rung. */
  frame?: { top: number; right: number; bottom: number; left: number } | null
}) {
  const [isTouch] = useState(() =>
    typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0))
  // OPT-IN (Galen, Aug 30: 'remove from mobile games as default but keep as an
  // accessible primitive'): the generic stick/A/B render ONLY when the world
  // declares worldData.touchControls = 'stick' (or true). The first-class path
  // is declared ui buttons (click:"key:<k>"); this is the legacy convenience.
  const [optedIn, setOptedIn] = useState(false)
  useEffect(() => {
    const iv = setInterval(() => {
      const tc = simRef.current?.worldData?.['touchControls']
      setOptedIn(tc === 'stick' || tc === true)
    }, 600)
    return () => clearInterval(iv)
  }, [simRef])
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const nubRef = useRef<HTMLDivElement>(null)
  // LAYOUT IS COMPUTED, not hand-placed (touch-layout.ts — collision-free by
  // construction, proven across the device matrix in its unit suite). The
  // Aug 23 phone test caught the old magic-px stick/buttons overlap.
  const dims = useCallback(() => {
    if (typeof window === 'undefined') return null
    return frame
      ? [Math.max(120, window.innerWidth - frame.left - frame.right), Math.max(120, window.innerHeight - frame.top - frame.bottom)] as const
      : [window.innerWidth, window.innerHeight] as const
  }, [frame])
  const [zones, setZones] = useState(() => { const d = dims(); return d ? layoutTouchZones(d[0], d[1]) : null })
  useEffect(() => {
    const onR = () => { const d = dims(); if (d) setZones(layoutTouchZones(d[0], d[1])) }
    onR()   // frame changes re-lay immediately (the eased resize fires resize events too)
    window.addEventListener('resize', onR)
    window.addEventListener('orientationchange', onR)
    return () => { window.removeEventListener('resize', onR); window.removeEventListener('orientationchange', onR) }
  }, [dims])

  // set a flag + bump its _n pulse counter on the rising edge — the keyboard
  // contract exactly, so input.pressed / hit() edges never miss a short tap
  const flag = useCallback((wd: Record<string, unknown>, key: string, on: boolean) => {
    if (on && wd[key] !== true) wd[key + '_n'] = ((wd[key + '_n'] as number) || 0) + 1
    wd[key] = on
  }, [])

  const setKeys = useCallback((dx: number, dy: number) => {
    const wd = simRef.current?.worldData
    if (!wd) return
    const TH = 14
    const L = dx < -TH, R = dx > TH, U = dy < -TH, D = dy > TH
    flag(wd, 'key_left', L); flag(wd, 'key_a', L)
    flag(wd, 'key_right', R); flag(wd, 'key_d', R)
    flag(wd, 'key_up', U); flag(wd, 'key_w', U)
    flag(wd, 'key_down', D); flag(wd, 'key_s', D)
  }, [simRef, flag])

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
    if (wd) flag(wd, key, down)
  }, [simRef, flag])

  if (!isTouch || !zones || suppressed || !optedIn) return null
  // a MINI frame (the grid's browse/engine shrink) is not a playfield — the
  // stick/buttons only ride a frame big enough to play in (Galen: "UI controls
  // are showing on mobile" over the shrunk grid)
  if (frame && typeof window !== 'undefined') {
    // PROPORTIONAL, not absolute px — a phone's full frame is only ~350px wide
    // and absolutely IS the playfield; a mini frame is small RELATIVE to the
    // window (the browse/engine shrink ≈40% tall).
    const fh = window.innerHeight - frame.top - frame.bottom
    if (fh < window.innerHeight * 0.55) return null
  }
  const Z = zones
  const btnKeys: Array<[string, string]> = [['key_space', 'A'], ['key_enter', 'B']]
  return (
    <div className={`${frame ? 'fixed' : 'absolute'} z-30 pointer-events-none select-none`}
      style={frame
        ? { touchAction: 'none', top: frame.top, right: frame.right, bottom: frame.bottom, left: frame.left }
        : { touchAction: 'none', inset: 0 }}>
      <div
        data-cc-chrome
        className="absolute rounded-full border border-white/20 bg-white/5 backdrop-blur-sm pointer-events-auto"
        style={{ touchAction: 'none', left: Z.stick.x, top: Z.stick.y, width: Z.stick.w, height: Z.stick.h }}
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
      >
        <div
          ref={nubRef}
          className="absolute rounded-full bg-white/20 border border-white/30 transition-transform duration-75"
          style={{ left: (Z.stick.w - Z.knob) / 2, top: (Z.stick.h - Z.knob) / 2, width: Z.knob, height: Z.knob }}
        />
      </div>
      {Z.buttons.map((b, i) => (
        <button
          key={btnKeys[i][1]}
          data-cc-chrome
          className="absolute rounded-full border border-white/25 bg-white/10 text-white/70 text-sm font-mono active:bg-white/25 pointer-events-auto"
          style={{ touchAction: 'none', left: b.x, top: b.y, width: b.w, height: b.h }}
          onPointerDown={btn(btnKeys[i][0], true)}
          onPointerUp={btn(btnKeys[i][0], false)}
          onPointerCancel={btn(btnKeys[i][0], false)}
        >{btnKeys[i][1]}</button>
      ))}
    </div>
  )
}
