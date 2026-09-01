#!/usr/bin/env node
// cartridge-cafe-eye — THE LOCAL EYE, ready-made. Two modes:
//
// ONE-SHOT PROBE (the zero-setup path — fetch + render + PNG in one command):
//   npx -y --package=cartridge-cafe-mcp cartridge-cafe-eye probe <world-token> \
//       [--out probe.png] [--size 256] [--input auto] [--ticks N]
//   Pulls the world's snapshot from the bridge with your uc_st_ token, renders
//   it on THIS machine's GPU, writes the PNG, prints the pixel report as JSON.
//   No payload assembly, no server to manage. Exit 0 = rendered.
//
// SERVER (a standing localhost eye any client can POST to):
//   npx -y --package=cartridge-cafe-mcp cartridge-cafe-eye
//   POST http://127.0.0.1:<port>/render  (Authorization: Bearer <printed secret>)
//   { "state": { fields, visualTypes, modules, worldData, stepHooks }, "size": 256 }
//   Snapshot source: GET /api/engine/bridge with your world token.
//
// Same renderer the cafe's cloud runs — pixels born at home, no cloud burn.
// The MCP (cartridge-cafe-mcp ≥0.5.0) does all of this automatically inside
// render_probe; this bin is the same eye for AIs that speak plain HTTP.
//
// Requires Deno (https://deno.land — `brew install deno` / `curl -fsSL
// https://deno.land/install.sh | sh`). Without it we say so and exit — we never
// silently fall back to the cloud from here.

import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageRenderService, renderLocal } from './local-eye.mjs'
import { makeClient } from './bridge-client.mjs'
import { enrichReport, shapeSnapshot } from './probe-format.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── ONE-SHOT PROBE ───────────────────────────────────────────────────────────
if (process.argv[2] === 'probe') {
  const args = process.argv.slice(3)
  const token = args.find((a) => !a.startsWith('--'))
  const opt = (name, dflt) => {
    const i = args.indexOf('--' + name)
    return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt
  }
  if (!token) {
    console.error('usage: cartridge-cafe-eye probe <world-token uc_st_…> [--out probe.png] [--size 256] [--input auto|run-right|tap-action|sweep-cursor] [--ticks N] [--url https://cartridge.cafe]')
    process.exit(2)
  }
  const base = opt('url', process.env.CAFE_BASE || 'https://cartridge.cafe')
  const out = opt('out', 'probe.png')
  try {
    const bridge = makeClient({ base, token, timeoutMs: 30_000, headers: { Origin: base } })
    const { status, text: body } = await bridge.bridgeGet()
    let j; try { j = JSON.parse(body) } catch { j = null }
    if (!j || j.error) { console.error(`✖ bridge GET ${status}: ${j?.error || body.slice(0, 200)}`); process.exit(1) }
    const snap = shapeSnapshot(j)
    if (!snap || !snap.fields.length) { console.error('✖ nothing to render — the world has no fields yet'); process.exit(1) }
    const opts = { size: Number(opt('size', 256)) }
    const input = opt('input', null); if (input) opts.input = input
    const ticks = opt('ticks', null); if (ticks) opts.ticks = Number(ticks)
    const r = await renderLocal(snap, opts)
    enrichReport(r)
    const { image, png, ...report } = r
    const img = image || png
    if (typeof img === 'string' && img.length) {
      writeFileSync(out, Buffer.from(img.replace(/^data:image\/png;base64,/, ''), 'base64'))
      report.png = out
    }
    report.eye = 'local (this machine)'
    console.log(JSON.stringify(report, null, 2))
    process.exit(r.ok ? 0 : 1)
  } catch (e) {
    console.error('✖ probe failed:', e?.message || e)
    process.exit(1)
  }
}

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
