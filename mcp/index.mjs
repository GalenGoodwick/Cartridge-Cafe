#!/usr/bin/env node
// cartridge-cafe-mcp — the cafe's door, installed inside your AI's house.
//
// Tools for browsing the shelf, reading any world's source, brewing a world
// through the GUEST door (no account — three creations on the house), and
// building it over the bridge. Everything speaks to the live site.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { makeClient } from '../tools/bridge-client.mjs'

const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'
const bridgeFor = (tok) => makeClient({ base: BASE, token: tok, timeoutMs: 150_000, headers: { Origin: BASE } })

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

const H = (extra = {}) => ({ 'Content-Type': 'application/json', 'User-Agent': 'cartridge-mcp/1.0', Origin: BASE, cookie: cookies(), ...extra })
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

// The build discipline travels WITH the connection — an MCP client surfaces this
// to the AI on connect, so the guide + the eye + node conventions aren't optional.
const PROTOCOL = `You build live GPU worlds at cartridge.cafe. Follow this or you build blind:
1. read_guide FIRST — the contract for visuals (WGSL), step hooks (JS), fields, and every bridge command. Do not build before reading it.
2. brew_world (guest door, no account) for a build token, or use_world to resume one you own.
3. Build with the bridge tool in NODES: every field needs a visualType or it renders as NOTHING; put each subsystem in its own step-hook, never one monolith.
4. ENTER THE EYE — call render_probe after every change and LOOK at the image it returns. Headless you are blind: a shader that fails to compile renders as nothing with no error reaching you. Confirm real pixels + zero WGSL errors before you trust a build; never set brief_done until the eye shows what was asked.
5. Ship worldData.vision and worldData.instructions before you call it done. Sign in on the site later and your worlds transfer to you.`

const server = new McpServer({ name: 'cartridge-cafe', version: '0.2.0' }, { instructions: PROTOCOL })

server.tool(
  'read_guide',
  'The engine guide — MANDATORY reading before building. Contracts for visuals (WGSL), step hooks (JS), fields, and every bridge command.',
  {},
  async () => {
    return text(await bridgeFor('').guide())
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
      next: 'Read the guide (read_guide), then build with the bridge tool. EVERY field needs a visualType or it renders as nothing. render_probe after every change and LOOK at the image — a failed shader renders as nothing with no error. Ship worldData.vision + worldData.instructions before you call it done.',
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
    return text(await bridgeFor(tok).bridgeSend(command, { retryLock: 1, normalize: false }))
  },
)

server.tool(
  'world_state',
  'Read a world\'s FULL current source over the bridge — every field, every visual\'s complete WGSL, every step-hook\'s complete JS code, plus worldData, params, modules, and interaction rules. This is how you read back exactly what you (or a previous session) built and iterate on it. Defaults to your latest brewed world.',
  { token: z.string().optional() },
  async ({ token }) => {
    const tok = token || mine[mine.length - 1]?.token
    if (!tok) return text({ error: 'no world token — brew_world first, or pass one' })
    const st = await bridgeFor(tok).bridgeGet()
    let body; try { body = JSON.parse(st.text) } catch { body = { status: st.status } }
    return text(body)
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

server.tool(
  'render_probe',
  'THE EYE — render a world on a real cloud GPU and get back a pixel report PLUS the actual PNG. Call this after EVERY change and LOOK at the image. Report fields: errors (WGSL COMPILE errors with the exact line — fix that line), meanLum / coveragePct (coverage<1 ≈ a blank/black world — an unskinned field or a shader that did not compile), bbox / offscreenHint (mis-placed coords — build around 256,256), hookErrors (step-hook throws), motion, and — when input is set — inputReport.respondsToInput. Headless you are otherwise BLIND: a failed shader renders as NOTHING with no error. Defaults to your latest brewed world.',
  {
    input: z.string().optional().describe('Optional input preset to also press the controls: auto | run-right | tap-action | sweep-cursor'),
    token: z.string().optional().describe('World token. Defaults to your latest brewed world.'),
  },
  async ({ input, token }) => {
    const tok = token || mine[mine.length - 1]?.token
    if (!tok) return text({ error: 'no world token — brew_world first, or pass one' })
    const cmd = input ? { type: 'render_probe', input } : { type: 'render_probe' }
    const out = await bridgeFor(tok).bridgeSend(cmd, { normalize: false })
    const r = (out && out.results && out.results[0]) || out || {}
    const { image, ...report } = r
    const content = [{ type: 'text', text: JSON.stringify(report, null, 2) }]
    if (typeof image === 'string' && image.length) {
      content.push({ type: 'image', data: image.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' })
    } else {
      content.push({ type: 'text', text: '⚠ NO IMAGE — the eye is CLOSED: nothing rendered. Usually an unskinned field (needs a visualType) or a WGSL compile error above. Fix it and re-probe; do not trust this build.' })
    }
    return { content }
  },
)

server.tool(
  'use_world',
  'Resume editing a world you already own (brewed here, or on your account) — returns its build token (uc_st_) for the bridge, and adds it to my_worlds. Guest deeds are cookie-scoped to this machine. Get the slug from a browse_shelf play URL (/space/<slug>).',
  { slug: z.string().describe('The world slug, e.g. "lumenwake" from /space/lumenwake') },
  async ({ slug }) => {
    if (!(await ensureGuest())) return text({ error: 'could not open a session' })
    const t = await jfetch(`/api/spaces/${slug}/token`, { method: 'POST', body: JSON.stringify({ name: 'mcp' }) })
    if (!t.body?.token) return text({ error: t.body?.error || `could not get a token for "${slug}" — do you own it on this machine?` })
    const world = { name: slug, slug, token: t.body.token, viewUrl: `${BASE}/space/${slug}` }
    mine.push(world)
    return text({ ...world, next: 'Read world_state to see what is there, build with the bridge tool, and render_probe to SEE every change before you trust it.' })
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
