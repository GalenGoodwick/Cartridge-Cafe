// QUIET WHEN IDLE — the one gate for every poll in the app (Galen, Oct 2: "make
// cost 0 when idle"). Every open tab used to keep the functions — and so the
// database — awake with its timers. Now: when the tab is hidden, or nobody has
// touched it for IDLE_MS, every GET to /api/ is answered here in the browser
// (503, an empty JSON object) and never leaves the machine. No function runs,
// Neon can suspend, the bill is zero. The first touch, key, wheel or scroll wakes
// it, and the next poll goes through. POSTs are never held (an action is a
// touch by definition). Installed once by <QuietWhenIdle/> in the root layout.

export const IDLE_MS = 5 * 60_000

let lastInput = Date.now()
let installed = false
const QUIET = () => new Response('{}', { status: 503, statusText: 'quiet: idle', headers: { 'content-type': 'application/json', 'x-quiet': '1' } })

export function awake(now = Date.now()): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
  return now - lastInput < IDLE_MS
}
export const touch = (): void => { lastInput = Date.now() }

const isPoll = (input: RequestInfo | URL, init?: RequestInit): boolean => {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'GET') return false
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return url.startsWith('/api/') || url.includes(location.origin + '/api/')
}

export function installQuiet(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const on = () => touch()
  for (const e of ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const) window.addEventListener(e, on, { passive: true })
  window.addEventListener('scroll', on, { passive: true, capture: true })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touch() })
  const real = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isPoll(input, init) && !awake()) return Promise.resolve(QUIET())
    return real(input, init)
  }) as typeof window.fetch
}
