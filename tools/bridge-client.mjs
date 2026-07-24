// bridge-client.mjs — THE shared HTTP client for everything that talks to the
// cafe from outside the browser: both MCP servers, the house builder daemon,
// and the volunteer client. One place for auth headers, JSON handling, command
// normalization, the claim-lock retry, and the request timeout.
//
// Lessons encoded here (do not remove):
//  · AbortSignal.timeout on EVERY request — a dead keepalive socket once hung
//    the builder daemon's tick loop forever (alive process, silent log).
//  · Models JSON-stringify nested values — coax() and normalizeCommands()
//    accept every malformed shape cafe_send has ever been handed.
//  · The bridge claim-lock (two builders, one world) returns
//    {buildLocked:true, until} — bridgeSend can wait it out instead of failing.

export const CAFE_BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'

/** Models sometimes JSON-stringify nested values. Coax a value back to JSON. */
export function coax(v) {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (t.startsWith('[') || t.startsWith('{')) { try { return JSON.parse(t) } catch { /* leave as string */ } }
  return v
}

/** Accept {commands:[...]}, a bare array, a single command object, OR any of
 *  those JSON-stringified (a common model slip) → always {commands:[...]}. */
export function normalizeCommands(args) {
  const a = coax(args) || {}
  const cmds = coax(a.commands)
  return Array.isArray(cmds) && cmds.length ? { commands: cmds }
    : Array.isArray(a) ? { commands: a }
    : (cmds && typeof cmds === 'object' && cmds.type) ? { commands: [cmds] }
    : a.type ? { commands: [a] }                       // whole arg is one command
    : Array.isArray(cmds) ? { commands: cmds }         // empty array → surface bridge's own error
    : { commands: [] }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {object} opts { base?, token?, timeoutMs?=15000, headers? }
 * token goes out as `Authorization: Bearer <token>` on every call when set.
 */
export function makeClient({ base = CAFE_BASE, token = '', timeoutMs = 15_000, headers = {} } = {}) {
  const H = (extra = {}) => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers, ...extra,
  })
  const raw = (path, opts = {}) => fetch(base + path, {
    ...opts,
    signal: opts.signal ?? AbortSignal.timeout(timeoutMs),
    headers: { ...H(), ...(opts.headers || {}) },
  })

  return {
    base, token,

    /** Parsed-JSON fetch; parse failure → {} (a tick loop must not die on a 502 page). */
    async json(path, opts = {}) {
      const res = await raw(path, opts)
      return res.json().catch(() => ({}))
    },

    /** Body text + status, for callers that relay raw responses. */
    async text(path, opts = {}) {
      const res = await raw(path, opts)
      return { status: res.status, text: await res.text() }
    },

    /** GET the bridge: full state, or pass 'describe' for the structural x-ray. */
    bridgeGet(action = '') {
      return this.text('/api/engine/bridge' + (action ? `?action=${action}` : ''))
    },

    /** POST commands to the bridge (normalized). retryLock waits out the
     *  two-builders-one-world claim-lock instead of failing the send. */
    async bridgeSend(commandsOrArgs, { retryLock = 0, normalize = true } = {}) {
      const body = JSON.stringify(normalize ? normalizeCommands(commandsOrArgs) : commandsOrArgs)
      for (let attempt = 0; ; attempt++) {
        const res = await raw('/api/engine/bridge', { method: 'POST', body })
        const out = await res.json().catch(() => ({ status: res.status }))
        if (!out?.buildLocked || attempt >= retryLock) return out
        const wait = Math.min(Math.max((out.until || 0) - Date.now() + 1000, 5_000), 25_000)
        await sleep(wait)
      }
    },

    /** The engine build guide (markdown). */
    async guide() {
      return (await this.text('/api/engine/guide')).text
    },
  }
}
