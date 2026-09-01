#!/usr/bin/env node
// cartridge-cafe-eye — THE LOCAL EYE, ready-made.
//
//   npx -y cartridge-cafe-mcp cartridge-cafe-eye     (or: npx cartridge-cafe-eye)
//
// Starts the SAME render service the cafe's cloud runs — on YOUR machine, on
// your GPU (Metal on a Mac via Deno WebGPU; software rasterizer elsewhere).
// Any AI on this machine can then render a world snapshot locally instead of
// burning cloud compute on the ~30s-cold Railway eye:
//
//   POST http://127.0.0.1:<port>/render
//   Authorization: Bearer <secret printed below>
//   { "state": { fields, visualTypes, modules, worldData, stepHooks }, "size": 256 }
//
// Get the snapshot from the bridge (GET /api/engine/bridge with your world
// token) — data over the wire, pixels born at home. The MCP (cartridge-cafe-mcp
// ≥0.5.0) does all of this automatically inside render_probe; this bin is the
// same eye for AIs that speak plain HTTP instead of MCP.
//
// Requires Deno (https://deno.land — `brew install deno` / `curl -fsSL
// https://deno.land/install.sh | sh`). Without it we say so and exit — we never
// silently fall back to the cloud from here.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageRenderService } from './local-eye.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DENO_CANDIDATES = [
  process.env.CAFE_DENO,
  process.env.DENO_PATH,
  '/opt/homebrew/bin/deno',
  '/usr/local/bin/deno',
  '/usr/bin/deno',
  process.env.HOME && path.join(process.env.HOME, '.deno', 'bin', 'deno'),
].filter(Boolean)
const deno = DENO_CANDIDATES.find((p) => existsSync(p))

// staged out of node_modules when needed — Deno rejects jsr:/npm: imports there
const server = stageRenderService([
  path.join(__dirname, 'render-service', 'server.mjs'),
  path.join(__dirname, '..', 'render-service', 'server.mjs'),
].find((p) => existsSync(p)))

if (!deno) {
  console.error('✖ deno not found — the eye renders through Deno WebGPU.')
  console.error('  Install it (https://deno.land):  brew install deno')
  console.error('  or: curl -fsSL https://deno.land/install.sh | sh')
  process.exit(1)
}
if (!server) {
  console.error('✖ render-service/server.mjs not found next to this bin — reinstall cartridge-cafe-mcp.')
  process.exit(1)
}

const PORT = parseInt(process.env.PORT || '8080', 10)
const SECRET = process.env.RENDER_SECRET || randomBytes(18).toString('hex')

console.log(`▸ cartridge.cafe LOCAL EYE`)
console.log(`  url:     http://127.0.0.1:${PORT}`)
console.log(`  secret:  ${SECRET}`)
console.log(`  render:  POST /render  {"state":{...},"size":256}  (Authorization: Bearer <secret>)`)
console.log(`  clip:    POST /clip    {"state":{...},"frames":150,"fps":30}  → mp4`)
console.log(`  health:  GET  /health`)
console.log(`  Snapshot source: GET https://cartridge.cafe/api/engine/bridge  (Bearer <your world token>)`)
console.log('')

const child = spawn(deno, [
  'run', '--allow-net', '--allow-env', '--allow-read', '--allow-ffi', '--allow-sys',
  '--unstable-webgpu', server,
], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(PORT), RENDER_SECRET: SECRET },
  cwd: path.dirname(server),
})
const bail = (sig) => () => { try { child.kill(sig) } catch { /* gone */ } process.exit(0) }
process.on('SIGINT', bail('SIGINT'))
process.on('SIGTERM', bail('SIGTERM'))
child.on('exit', (code) => process.exit(code ?? 0))
