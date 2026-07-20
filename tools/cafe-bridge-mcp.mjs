#!/usr/bin/env node
// Cafe bridge MCP server — the ONLY capability a locked-down build agent gets.
//
// A build agent launched with `--allowedTools mcp__cafe-bridge` (and NO
// --dangerously-skip-permissions) can reach exactly these three tools and
// nothing else: no bash, no filesystem, no arbitrary network. So a hostile
// creation brief has nothing on the machine to attack — the worst it can do is
// build a weird world, which the owner can roll back.
//
// The world token + base URL arrive via env (CAFE_BASE, CAFE_BUILD_TOKEN) and
// are used INSIDE the tools — the model never sees the token.
//
// Minimal stdio JSON-RPC (MCP): newline-delimited messages on stdin/stdout.

import { createInterface } from 'readline'

const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'
const TOKEN = process.env.CAFE_BUILD_TOKEN || ''

const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const ok = (id, result) => write({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } })

const TOOLS = [
  {
    name: 'cafe_guide',
    description: 'GET the mandatory engine build guide (markdown). Read it fully before building anything.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cafe_state',
    description: 'GET the current world state from the bridge (fields, visual types, world data, params).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cafe_describe',
    description: 'A fast, no-GPU structural x-ray of your world: fieldCount, each field (visualType, skinned=does its visual actually exist, x/y, onScreen), which visualTypes are renderable, stepHook ids, worldData keys, and a WARNINGS list naming exact mistakes ("field X has no visual", "field Y off-screen at (0,0)"). Cheaper than cafe_state and cafe_probe — call it to sanity-check structure the instant something looks wrong.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cafe_source',
    description: 'READ/SEARCH the real engine source (read-only). PREFER {search:"opSmooth"} — greps ALL source and returns matching file:line snippets in ONE call, so you find the one function/param you need instead of reading whole files. {path:"api/engine/bridge/route.ts"} → a whole file (the authoritative command+param list); page big files with {path,from,to}. No arg → lists files. Do not guess params — search for them.',
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, path: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' } } },
  },
  {
    name: 'cafe_send',
    description: 'POST engine build commands to the bridge. Pass {"commands":[ ... ]} (an array of engine command OBJECTS like define_visual / create_field / set_world_data), or a single command object. Do NOT JSON-stringify the commands array — pass it as real JSON.',
    inputSchema: { type: 'object', properties: { commands: {} }, additionalProperties: true },
  },
  {
    name: 'cafe_probe',
    description: 'SEE your world — render it headless on a real GPU and get back what you built. Returns a pixel-state report (meanLum, coveragePct, visible, bbox + centeredX/Y, offscreenHint, quadrantLum, dominantColors), any WGSL compile errors (exact line), hookErrors (step-hook throws), a motion profile (travel/vibrating/diverging/settling from ticking the hooks), AND the rendered IMAGE. This is your EYES: a headless build agent otherwise never knows if a shader compiled, a field is off-screen, or the world is just black. CALL IT after cafe_send and BEFORE brief_done — if it reports errors/blank/off-screen, fix and re-probe until it renders. Optional {name} picks which visual to render (default: the first field\'s), {ticks} how many hook steps to evolve (default 45; 0 = static).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, ticks: { type: 'number' } } },
  },
]

/** Models sometimes JSON-stringify nested values. Coax a value back to JSON. */
function coax(v) {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (t.startsWith('[') || t.startsWith('{')) { try { return JSON.parse(t) } catch { /* leave as string */ } }
  return v
}

async function callTool(name, args) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }
  if (name === 'cafe_guide') {
    // The full guide (~74k chars) blows the headless per-tool-result token cap, so
    // a locked agent never sees it and resorts to probing. Cap to a safe head and
    // point the rest at cafe_source (which pages the same file).
    const r = await fetch(`${BASE}/api/engine/guide`)
    const md = await r.text()
    const CAP = 52_000   // trimmed guide is ~46.5k — fits whole, well under the ~74k tool-result limit
    if (md.length <= CAP) return md
    return md.slice(0, CAP) +
      `\n\n---\n[guide truncated at ${CAP} chars — read the rest with ` +
      `cafe_source({path:"engine/AI_ENGINE_GUIDE.md", from:<line>}), or read the ` +
      `real engine source directly via cafe_source (start: api/engine/bridge/route.ts).]`
  }
  if (name === 'cafe_source') {
    const a = args || {}
    const q = a.search ? `?search=${encodeURIComponent(a.search)}`
      : a.path ? `?path=${encodeURIComponent(a.path)}` +
        (a.from != null ? `&from=${a.from}` : '') + (a.to != null ? `&to=${a.to}` : '')
      : ''
    const r = await fetch(`${BASE}/api/engine/source${q}`)
    return await r.text()
  }
  if (name === 'cafe_state') {
    const r = await fetch(`${BASE}/api/engine/bridge`, { headers: H })
    return await r.text()
  }
  if (name === 'cafe_describe') {
    const r = await fetch(`${BASE}/api/engine/bridge?action=describe`, { headers: H })
    return await r.text()
  }
  if (name === 'cafe_send') {
    // accept {commands:[...]}, a bare array, a single command object, OR any of
    // those where the model JSON-stringified the array/object (a common slip).
    const a = coax(args) || {}
    let cmds = coax(a.commands)
    const body =
        Array.isArray(cmds) && cmds.length ? { commands: cmds }
      : Array.isArray(a) ? { commands: a }
      : (cmds && typeof cmds === 'object' && cmds.type) ? { commands: [cmds] }
      : a.type ? { commands: [a] }                       // whole arg is one command
      : Array.isArray(cmds) ? { commands: cmds }         // empty array → surface bridge's own error
      : { commands: [] }
    const r = await fetch(`${BASE}/api/engine/bridge`, { method: 'POST', headers: H, body: JSON.stringify(body) })
    return await r.text()
  }
  if (name === 'cafe_probe') {
    // The eyes a headless agent lacks: pull the world state, render it on a real
    // GPU via the Deno probe (co-located — this server runs on the GPU host), and
    // hand back the struct + errors + motion + the IMAGE. Runs in the trusted
    // SERVER (Node, full access); the agent still only sees tool results.
    const a = args || {}
    const os = await import('os'), fs = await import('fs'), path = await import('path'), cp = await import('child_process')
    const state = await (await fetch(`${BASE}/api/engine/bridge`, { headers: H })).text()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-probe-'))
    const stateFile = path.join(dir, 'state.json'), pngFile = path.join(dir, 'out.png')
    fs.writeFileSync(stateFile, state)
    const HERE = path.dirname(new URL(import.meta.url).pathname)
    const DENO = process.env.DENO_BIN || '/opt/homebrew/bin/deno'
    const cli = ['run', '-A', '--unstable-webgpu', path.join(HERE, 'render-probe.mjs'), '--state', stateFile, '--out', pngFile]
    if (a.name) cli.push('--name', String(a.name))
    if (a.ticks != null) cli.push('--ticks', String(a.ticks))
    const run = cp.spawnSync(DENO, cli, { encoding: 'utf8', timeout: 45_000, maxBuffer: 16 * 1024 * 1024 })
    const lastLine = (run.stdout || '').trim().split('\n').filter(Boolean).pop() || ''
    let struct; try { struct = JSON.parse(lastLine) } catch { struct = { ok: false, error: 'probe produced no JSON', stderr: (run.stderr || '').slice(0, 600) } }
    const content = [{ type: 'text', text: JSON.stringify(struct) }]
    if (struct.ok && fs.existsSync(pngFile)) {
      try {
        const sharp = (await import('sharp')).default
        const buf = await sharp(pngFile).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 78 }).toBuffer()
        content.push({ type: 'image', data: buf.toString('base64'), mimeType: 'image/jpeg' })
      } catch {
        content.push({ type: 'image', data: fs.readFileSync(pngFile).toString('base64'), mimeType: 'image/png' })
      }
    }
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* temp */ }
    return { __content: content }
  }
  throw new Error(`unknown tool: ${name}`)
}

const rl = createInterface({ input: process.stdin })
rl.on('close', () => process.exit(0))   // client (claude) ended the session
rl.on('line', async (raw) => {
  const line = raw.trim()
  if (!line) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const { id, method, params } = msg
  if (method === 'initialize') {
    ok(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'cafe-bridge', version: '1.0.0' },
    })
  } else if (method === 'tools/list') {
    ok(id, { tools: TOOLS })
  } else if (method === 'tools/call') {
    try {
      const res = await callTool(params?.name, params?.arguments || {})
      // a tool may return a ready content array (cafe_probe: text + image) or plain text
      if (res && typeof res === 'object' && Array.isArray(res.__content)) ok(id, { content: res.__content })
      else ok(id, { content: [{ type: 'text', text: String(res).slice(0, 200_000) }] })
    } catch (e) {
      ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true })
    }
  } else if (id != null) {
    fail(id, -32601, `method not found: ${method}`)
  }
  // notifications (no id, e.g. notifications/initialized) need no response
})
