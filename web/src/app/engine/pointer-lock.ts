// engine/pointer-lock.ts — THE POINTER-LOCK NODE (rebuilt clean, Galen: "delete
// the pointer lock code and redo as a node"). ONE self-contained place owns the
// whole mouse-look cursor-bind lifecycle — nothing else touches pointer lock.
//
// WHAT WAS DELETED, AND WHY: the prior version carried a Safari FULLSCREEN DETOUR
// (requestFullscreen → then requestPointerLock), a WebKit concession from before
// Safari 26 could lock the pointer in-page. That detour WAS the "deregisters right
// after" bug: it grabbed the lock while forcing the frame fullscreen, so the next
// fullscreen-exit — Esc, the transition itself, or any stray fullscreenchange —
// dropped the cursor a beat later. Modern Safari (26+) locks in-page like every
// other browser, so the detour is gone and with it the storm-guards (fsTried,
// awaitingFs, the fullscreenchange dance) it needed to not loop.
//
// WHAT THIS NODE DOES, and nothing more:
//   · engage the lock on a deliberate canvas click in a mouse-look world
//   · NEVER on the click that CARRIED the entry — the swap gate; else re-locking
//     misfires a game press the instant the world swaps in
//   · SWALLOW that engaging click (lockSwallow) so it doesn't also fire gameplay
//   · a COOLDOWN RETRY: a browser that refuses a too-soon re-lock (Chrome's ~1.25s
//     post-Esc cooldown; Safari's shorter post-release beat) gets ONE auto-retry,
//     so exit→re-enter still ends in a bound cursor without a second click
//   · relative mouse deltas → worldData.mouse_dx/dy while locked (input.lookX/Y)
//   · cursor hidden while locked, 'grab' when free
'use client'

import { useEffect, useRef, type RefObject, type MutableRefObject } from 'react'
import type { FieldSimulation } from './simulation'

/** Installs the mouse-look pointer-lock lifecycle on the canvas. Returns
 *  `lockSwallow` — a ref FieldEngine reads to skip the game press on the click
 *  that engaged the lock (capture-phase, so it's set before the React handler runs). */
export function usePointerLock(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  simulationRef: RefObject<FieldSimulation | null>,
  swapAtRef: MutableRefObject<number>,
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

    // THE COOLDOWN RETRY: a browser refuses a re-lock for a short window after an
    // Esc release (Chrome ~1.25s; Safari a shorter beat). A click in that window
    // used to die silently (the "dead click on exit→re-enter"). ONE retry re-requests
    // the plain lock if the player is still a mouse-look world, unlocked, and visible.
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const armRetry = () => {
      if (retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (!isLocked() && mouseLook() && document.visibilityState === 'visible') lockNow()
      }, 700)
    }

    // request the plain in-page lock. Modern browsers return a promise that rejects
    // on refusal (cooldown) → arm the retry. Older WebKit returned void and instead
    // fires pointerlockerror (onErr) → same retry. No fullscreen, ever.
    const lockNow = () => {
      try {
        const req = (canvas.requestPointerLock as () => Promise<void> | void)()
        if (req && typeof (req as Promise<void>).then === 'function') {
          (req as Promise<void>).catch(() => armRetry())
        }
      } catch { armRetry() }
    }

    // engage: true iff THIS click should take the lock — a mouse-look world, not
    // already locked, and past the swap gate. The gate only has to skip the click
    // that CARRIED the entry (its bubble lands within a frame of the swap stamp);
    // 250ms covers it while freeing the player's first real click.
    const engage = (): boolean => {
      if (!mouseLook() || isLocked()) return false
      if (performance.now() - swapAtRef.current < 250) return false
      lockNow()
      return true
    }

    // capture-phase — fires BEFORE React's onPointerDown, so FieldEngine reads
    // lockSwallow and skips the game press for the engaging click.
    const onDown = () => { if (engage()) lockSwallow.current = true }
    const onUp = () => { lockSwallow.current = false }
    const onErr = () => { if (mouseLook() && !isLocked()) armRetry() }

    canvas.addEventListener('pointerdown', onDown, true)
    canvas.addEventListener('pointerup', onUp, true)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onErr)
    return () => {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
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
