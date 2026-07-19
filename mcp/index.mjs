#!/usr/bin/env node
// cartridge-cafe-mcp — the cafe's door, installed inside your AI's house.
//
// Tools for browsing the shelf, reading any world's source, brewing a world
// through the GUEST door (no account — three creations on the house), and
// building it over the bridge. Everything speaks to the live site.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'

// ── one guest session per server run: cookie jar + the worlds we brewed ──
const jar = {}
const cookies = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
const sip = (res) => {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [kv] = c.split(';')
    const i = kv.indexOf('=')
    jar[kv.slice(0, i)] = kv.slice(i + 1)
  }
}
const mine = []   // { name, slug, token, viewUrl }

const H = (extra = {}) => ({ 'Content-Type': 'application/json', Origin: BASE, cookie: cookies(), ...extra })
const jfetch = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { ...opts, headers: { ...H(), ...(opts.headers || {}) } })
  sip(res)
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

async function ensureGuest() {
  const s = await jfetch('/api/auth/session')
  if (s.body?.user) return true
  await jfetch('/api/auth/guest', { method: 'POST' })
  const csrf = (await jfetch('/api/auth/csrf')).body?.csrfToken
  await jfetch('/api/auth/callback/guest', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf, json: 'true' }),
  })
  const s2 = await jfetch('/api/auth/session')
  return !!s2.body?.user
}

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })

const server = new McpServer({ name: 'cartridge-cafe', version: '0.1.0' })

server.tool(
  'read_guide',
  'The engine guide — MANDATORY reading before building. Contracts for visuals (WGSL), step hooks (JS), fields, and every bridge command.',
  {},
  async () => {
    const r = await fetch(BASE + '/api/engine/guide')
    return text(await r.text())
  },
)

server.tool(
  'browse_shelf',
  "Every world on the cafe's shelf, with play URLs. Public worlds' full source is readable via read_world_source.",
  {},
  async () => {
    const r = await jfetch('/api/engine/scene?action=list')
    const scenes = r.body?.scenes || []
    const sp = await jfetch('/api/spaces/browse')
    const spaces = (sp.body?.spaces || []).map(s => ({ name: s.name || s.slug, play: `${BASE}/space/${s.slug}` }))
    return text({
      worlds: scenes.map(n => ({ name: n, play: `${BASE}/play/${encodeURIComponent(n)}` })),
      playerWorlds: spaces,
      note: 'Branches are named "BASE ⑂ handle · vN". Fork anything; a tournament decides canon.',
    })
  },
)

server.tool(
  'read_world_source',
  "A public world's complete source — WGSL visuals, step-hook code, fields, params. The shelf is a library, not a vault: learn techniques from working worlds.",
  { name: z.string().describe('World name exactly as it appears on the shelf') },
  async ({ name }) => {
    const r = await jfetch('/api/engine/library?world=' + encodeURIComponent(name))
    return text(r.body)
  },
)

server.tool(
  'brew_world',
  'Create YOUR OWN world through the guest door — no account needed. Returns a build token (uc_st_) for the bridge. Guests get three creations; editing is unlimited. Sign in on the site later and everything transfers to your account.',
  { name: z.string().describe('The world\'s name') },
  async ({ name }) => {
    if (!(await ensureGuest())) return text({ error: 'could not open a guest session' })
    const w = await jfetch('/api/spaces', { method: 'POST', body: JSON.stringify({ name }) })
    if (!w.body?.space) return text({ error: w.body?.error || `create failed (${w.status})` })
    const slug = w.body.space.slug
    const t = await jfetch(`/api/spaces/${slug}/token`, { method: 'POST', body: JSON.stringify({ name: 'mcp' }) })
    if (!t.body?.token) return text({ error: t.body?.error || 'token mint failed' })
    const world = { name, slug, token: t.body.token, viewUrl: `${BASE}/space/${slug}` }
    mine.push(world)
    return text({
      ...world,
      next: 'Read the guide (read_guide), then build with the bridge tool. EVERY field needs a visualType or it renders as nothing. Ship worldData.instructions before you call it done.',
    })
  },
)

server.tool(
  'bridge',
  'Send a command (or {"commands":[...]} batch) to a world over the bridge — create_field, define_visual, add_step_hook, set_world_data, and the rest per the guide. Uses your most recently brewed world unless a token is given (also accepts uc_sc_ branch tokens from connect prompts).',
  {
    command: z.record(z.any()).describe('The bridge command object'),
    token: z.string().optional().describe('World token (uc_st_/uc_sc_). Defaults to your latest brewed world.'),
  },
  async ({ command, token }) => {
    const tok = token || mine[mine.length - 1]?.token
    if (!tok) return text({ error: 'no world token — brew_world first, or pass one' })
    const r = await fetch(BASE + '/api/engine/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, Authorization: `Bearer ${tok}` },
      body: JSON.stringify(command),
    })
    return text(await r.json().catch(() => ({ status: r.status })))
  },
)

server.tool(
  'world_state',
  'Read a world\'s current state over the bridge — fields, visuals, hooks, worldData. Defaults to your latest brewed world.',
  { token: z.string().optional() },
  async ({ token }) => {
    const tok = token || mine[mine.length - 1]?.token
    if (!tok) return text({ error: 'no world token — brew_world first, or pass one' })
    const r = await fetch(BASE + '/api/engine/bridge', { headers: { Authorization: `Bearer ${tok}` } })
    return text(await r.json().catch(() => ({ status: r.status })))
  },
)

server.tool(
  'my_worlds',
  'The worlds you have brewed in this session, with their tokens and view URLs.',
  {},
  async () => text({
    worlds: mine,
    claim: 'These live under a guest deed. Sign in at ' + BASE + ' in a browser holding this machine\'s cookies and they transfer to the account permanently.',
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
