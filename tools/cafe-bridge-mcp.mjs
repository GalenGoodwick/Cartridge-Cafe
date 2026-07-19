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
    name: 'cafe_send',
    description: 'POST engine build commands to the bridge. Pass {"commands":[ ... ]} (an array of engine command objects like define_visual / create_field / set_world_data), or a single command object.',
    inputSchema: { type: 'object', properties: { commands: {} }, additionalProperties: true },
  },
]

async function callTool(name, args) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }
  if (name === 'cafe_guide') {
    const r = await fetch(`${BASE}/api/engine/guide`)
    return await r.text()
  }
  if (name === 'cafe_state') {
    const r = await fetch(`${BASE}/api/engine/bridge`, { headers: H })
    return await r.text()
  }
  if (name === 'cafe_send') {
    // accept {commands:[...]}, a bare array, or a single command object
    const a = args || {}
    const body = Array.isArray(a.commands) ? { commands: a.commands }
      : Array.isArray(a) ? { commands: a }
      : a.type ? { commands: [a] }
      : { commands: a.commands ?? [] }
    const r = await fetch(`${BASE}/api/engine/bridge`, { method: 'POST', headers: H, body: JSON.stringify(body) })
    return await r.text()
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
      const text = await callTool(params?.name, params?.arguments || {})
      ok(id, { content: [{ type: 'text', text: String(text).slice(0, 200_000) }] })
    } catch (e) {
      ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true })
    }
  } else if (id != null) {
    fail(id, -32601, `method not found: ${method}`)
  }
  // notifications (no id, e.g. notifications/initialized) need no response
})
