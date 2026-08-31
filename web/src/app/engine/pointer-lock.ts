// engine/pointer-lock.ts — THE POINTER-LOCK NODE (Galen: "carve pointer lock
// into a node — it keeps breaking"). ONE cohesive place owns the whole
// mouse-look lock lifecycle, instead of it being smeared across a ref, two
// effects, and a block inside handlePointerDown (which is how it kept
// regressing). What lives here:
//   · the relative-delta capture (movementX/Y → worldData.mouse_dx/dy) while locked
//   · the cursor hide on lock
//   · the click-to-lock GATE: never on the entry click (the one that swapped the
//     world in) — only a deliberate click ≥600ms later
//   · the SWALLOW of that engaging click, so re-capturing the cursor never fires a
//     game press (the "misfire" — a mouse-look world shooting the instant you re-lock)
//   · THE SAFARI PATH: Safari/WebKit refuses pointer lock unless the element is in
//     FULLSCREEN. So we try the plain lock (Chrome/Firefox get it, staying in the
//     grid frame); on refusal we go fullscreen on the frame, then lock once there.
'use client'

import { useEffect, useRef, type RefObject, type MutableRefObject } from 'react'
import type { FieldSimulation } from './simulation'

type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

/** Installs the mouse-look pointer-lock lifecycle on the canvas. Returns
 *  `lockSwallow` — a ref FieldEngine reads to skip the game press on the click
 *  that engaged the lock (capture-phase, so it's set before the React handler runs). */
export function usePointerLock(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  simulationRef: RefObject<FieldSimulation | null>,
  swapAtRef: MutableRefObject<number>,
  fullscreenTargetRef?: RefObject<HTMLElement | null>,
): MutableRefObject<boolean> {
  const lockSwallow = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const isLocked = () => document.pointerLockElement === canvas
    const mouseLook = () => !!simulationRef.current?.worldData['__mouseLook']

    // relative deltas while locked → worldData.mouse_dx/dy (world-sandbox exposes
    // them as input.lookX/lookY). Untouched for non-mouse-look worlds (never locked).
    const onMove = (e: MouseEvent) => {
      if (!isLocked()) return
      const sim = simulationRef.current
      if (!sim) return
      sim.worldData['mouse_dx'] = ((sim.worldData['mouse_dx'] as number) || 0) + e.movementX
      sim.worldData['mouse_dy'] = ((sim.worldData['mouse_dy'] as number) || 0) + e.movementY
    }
    const onLockChange = () => { canvas.style.cursor = isLocked() ? 'none' : 'grab' }

    // ── THE SAFARI PATH ──
    const lockNow = () => { try { canvas.requestPointerLock() } catch (e) { console.warn('[cafe] pointer lock refused:', (e as Error).message) } }
    let awaitingFs = false
    const fullscreenThenLock = () => {
      if (isLocked()) return
      if (document.fullscreenElement) { lockNow(); return }   // already fullscreen — just lock
      if (awaitingFs) return
      awaitingFs = true
      const target = (fullscreenTargetRef?.current ?? canvas) as FsEl
      const onFs = () => {
        document.removeEventListener('fullscreenchange', onFs)
        awaitingFs = false
        if (document.fullscreenElement) lockNow()
      }
      document.addEventListener('fullscreenchange', onFs)
      try {
        const p = target.requestFullscreen?.() ?? target.webkitRequestFullscreen?.()
        if (p && typeof (p as Promise<void>).catch === 'function') {
          (p as Promise<void>).catch(() => { document.removeEventListener('fullscreenchange', onFs); awaitingFs = false })
        }
      } catch { document.removeEventListener('fullscreenchange', onFs); awaitingFs = false }
    }

    // engage: true iff THIS click should take the lock (mouse-look world, not
    // already locked, ≥600ms past the world swap — never the entry click).
    const engage = (): boolean => {
      if (!mouseLook() || isLocked()) return false
      if (performance.now() - swapAtRef.current < 600) return false
      // Chrome returns a promise that REJECTS on failure → fullscreen fallback.
      // Safari returns nothing and fires pointerlockerror (onErr, below).
      const req = (canvas.requestPointerLock as (() => Promise<void> | void))?.()
      if (req && typeof (req as Promise<void>).then === 'function') {
        (req as Promise<void>).catch(() => fullscreenThenLock())
      }
      return true
    }

    // capture-phase — fires BEFORE React's onPointerDown, so FieldEngine's
    // handler reads lockSwallow and skips the game press for the engaging click.
    const onDown = () => { if (engage()) lockSwallow.current = true }
    const onUp = () => { lockSwallow.current = false }
    const onErr = () => {
      // the browser refused the direct lock. If it's a mouse-look world (Safari),
      // retry through fullscreen — the one path Safari accepts.
      if (mouseLook()) { console.warn('[cafe] pointerlockerror — retrying via fullscreen (Safari path)'); fullscreenThenLock() }
      else console.warn('[cafe] pointerlockerror — the browser refused the cursor bind')
    }

    canvas.addEventListener('pointerdown', onDown, true)
    canvas.addEventListener('pointerup', onUp, true)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onErr)
    return () => {
      canvas.removeEventListener('pointerdown', onDown, true)
      canvas.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onErr)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return lockSwallow
}
