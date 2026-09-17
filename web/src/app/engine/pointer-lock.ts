// engine/pointer-lock.ts — THE POINTER-LOCK NODE (Galen: "carve pointer lock
// into a node — it keeps breaking"). ONE cohesive place owns the whole
// mouse-look lock lifecycle, instead of it being smeared across a ref, two
// effects, and a block inside handlePointerDown (which is how it kept
// regressing). What lives here:
//   · the relative-delta capture (movementX/Y → worldData.mouse_dx/dy) while locked
//   · the cursor hide on lock
//   · the click-to-lock GATE: never on the click that carried the entry (the one
//     that swapped the world in) — any deliberate click ≥250ms later engages
//   · the SWALLOW of that engaging click, so re-capturing the cursor never fires a
//     game press (the "misfire" — a mouse-look world shooting the instant you re-lock)
//   · the COOLDOWN RETRY: a refused lock (Chrome's ~1.25s post-Esc cooldown) arms
//     one ~1.4s retry, so a too-soon click still ends in a bound cursor
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
    // The fullscreen detour is a SAFARI-ONLY concession (WebKit refuses pointer
    // lock outside fullscreen). Chrome/Firefox lock in-frame; forcing THEM into
    // fullscreen on a transient refusal (e.g. Chrome's ~1.25s post-Esc cooldown,
    // which rejects a too-soon re-lock) is the "click-to-lock broke again" bug —
    // it slammed the frame fullscreen and stormed. On non-WebKit we just log and
    // let the next deliberate click re-request the plain lock once the cooldown ends.
    const isWebKit = /apple/i.test(navigator.vendor || '')

    // relative deltas while locked → worldData.mouse_dx/dy (world-sandbox exposes
    // them as input.lookX/lookY). Untouched for non-mouse-look worlds (never locked).
    const onMove = (e: MouseEvent) => {
      if (!isLocked()) return
      const sim = simulationRef.current
      if (!sim) return
      sim.worldData['mouse_dx'] = ((sim.worldData['mouse_dx'] as number) || 0) + e.movementX
      sim.worldData['mouse_dy'] = ((sim.worldData['mouse_dy'] as number) || 0) + e.movementY
    }
    const onLockChange = () => { canvas.style.cursor = isLocked() ? 'none' : 'grab'; if (isLocked()) fsTried = false }

    // ── THE SAFARI PATH ──
    // ONE-SHOT guard: a lock that keeps failing (headless, a browser mid-cooldown
    // after Esc, a policy block) used to storm — onErr → fullscreenThenLock →
    // (already fullscreen) → lockNow → error → onErr, forever. fsTried caps the
    // whole fullscreen-retry cycle at a single attempt per engaging click; it's
    // reset on pointerup and on a successful lock, so the NEXT deliberate click
    // gets a fresh try.
    let fsTried = false
    const lockNow = () => { try { canvas.requestPointerLock() } catch (e) { console.warn('[cafe] pointer lock refused:', (e as Error).message) } }
    let awaitingFs = false
    const fullscreenThenLock = () => {
      if (isLocked()) return
      if (fsTried) return               // already spent this click's one fullscreen retry — don't loop
      if (document.fullscreenElement) { fsTried = true; lockNow(); return }   // already fullscreen — one lock shot
      if (awaitingFs) return
      awaitingFs = true
      fsTried = true
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

    // THE COOLDOWN RETRY (Galen: "I just want the click to work when I enter
    // the game, or exit/enter, or enter from any way"): Chrome rejects a
    // re-lock for ~1.25s after an Esc unlock — a click in that window used to
    // fail SILENTLY (the dead click on exit→re-enter). A refused request now
    // arms ONE retry ~1.4s out; if the player is still here (mouse-look world,
    // unlocked, page visible) the lock takes without needing another click.
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const armRetry = () => {
      if (retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (!isLocked() && mouseLook() && document.visibilityState === 'visible') lockNow()
      }, 1400)
    }

    // engage: true iff THIS click should take the lock (mouse-look world, not
    // already locked). The swap gate only needs to swallow the click that
    // CARRIED the entry — that click's own bubble lands within a frame of the
    // swap stamp. The old 600ms gate also ate the player's first deliberate
    // click after entering (the "click doesn't work when I enter" bug); 250ms
    // covers the entering click and frees the human's first real one.
    const engage = (): boolean => {
      if (!mouseLook() || isLocked()) return false
      if (performance.now() - swapAtRef.current < 250) return false
      // Chrome returns a promise that REJECTS on failure → cooldown retry.
      // Safari returns nothing and fires pointerlockerror (onErr, below).
      const req = (canvas.requestPointerLock as (() => Promise<void> | void))?.()
      if (req && typeof (req as Promise<void>).then === 'function') {
        (req as Promise<void>).catch((e: Error) => {
          if (isWebKit) fullscreenThenLock()
          else { console.warn('[cafe] pointer lock refused — auto-retrying:', e?.message); armRetry() }
        })
      }
      return true
    }

    // capture-phase — fires BEFORE React's onPointerDown, so FieldEngine's
    // handler reads lockSwallow and skips the game press for the engaging click.
    const onDown = () => { fsTried = false; if (engage()) lockSwallow.current = true }
    const onUp = () => { lockSwallow.current = false }
    const onErr = () => {
      // the browser refused the direct lock. WebKit gets the fullscreen retry
      // (its lock needs fullscreen); Chrome/Firefox get the one-shot cooldown
      // retry — never storm, never force-fullscreen.
      if (!mouseLook()) { console.warn('[cafe] pointerlockerror — the browser refused the cursor bind'); return }
      if (isWebKit) { console.warn('[cafe] pointerlockerror — retrying via fullscreen (Safari path)'); fullscreenThenLock() }
      else armRetry()
    }

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
