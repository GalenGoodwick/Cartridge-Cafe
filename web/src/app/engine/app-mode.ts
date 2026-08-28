'use client'

// THE MODE (Galen, Aug 28) — "the whole website is toggled from engine mode to
// play mode. this means main too. The path into a world changes what UI you get
// depending on the toggle. The toggle itself is on main."
//
//   PLAY   — the site is a console: playable products; entering a world gives
//            you JUST the game. No edit controls anywhere. The default.
//   ENGINE — the site is a workshop: buildable worlds; entering a world gives
//            you the full engine (edit controls, tools). DESKTOP ONLY — the
//            engine is desktop-only, so a phone tapping ENGINE gets a notice.
//
// ONE persisted state, read site-wide via a custom event + storage sync (no
// context wrapper needed). PLAY is the default for everyone.
import { useEffect, useState } from 'react'

export type AppMode = 'play' | 'engine'
const KEY = 'cc-mode'
const EVENT = 'cc:mode'

export function getAppMode(): AppMode {
  try { return localStorage.getItem(KEY) === 'engine' ? 'engine' : 'play' } catch { return 'play' }
}

export function setAppMode(m: AppMode): void {
  try { localStorage.setItem(KEY, m) } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: m })) } catch { /* ssr */ }
}

/** A coarse-pointer device can never enter ENGINE (the engine is desktop-only). */
export function isMobileDevice(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

/** Read + set the site mode. `ready` is false until the client has read the
 *  stored value, so callers can hold a neutral frame instead of flashing PLAY
 *  then ENGINE. `mobile` locks ENGINE out (setMode('engine') is a no-op that
 *  returns false so the caller can show the desktop-only notice). */
export function useAppMode(): { mode: AppMode; ready: boolean; mobile: boolean; setMode: (m: AppMode) => boolean } {
  const [mode, setMode] = useState<AppMode>('play')
  const [ready, setReady] = useState(false)
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    setMode(getAppMode()); setMobile(isMobileDevice()); setReady(true)
    const on = (e: Event) => setMode((e as CustomEvent).detail as AppMode)
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setMode(getAppMode()) }
    window.addEventListener(EVENT, on)
    window.addEventListener('storage', onStorage)   // cross-tab
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', onStorage) }
  }, [])
  const set = (m: AppMode): boolean => {
    if (m === 'engine' && isMobileDevice()) return false   // engine is desktop-only
    setAppMode(m)
    return true
  }
  return { mode: mobile ? 'play' : mode, ready, mobile, setMode: set }
}
