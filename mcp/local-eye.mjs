// local-eye.mjs — THE EYE, IN THE AI'S OWN PROCESS.
//
// The bridge (Vercel) has no GPU, so it can never render — a world is a shader
// PROGRAM, not a stored picture, and the pixels only exist once something RUNS
// the WGSL. The three places that can are: a browser tab (real GPU), the Railway
// service (software GPU), or — this file — the MCP's own machine.
//
// This manages a PERSISTENT Deno child running the exact render-service the
// cloud runs (render-service/server.mjs), on a private loopback port with a
// generated secret. Persistent is the whole point: the GPU device + the
// compiled-pipeline cache stay warm across probes, so only the FIRST render pays
// the ~software-Vulkan compile — every probe after is fast. A cold-every-time
// renderer (a serverless function, or a spawn-per-render) is exactly the bug
// this avoids. On a Mac the child's WebGPU uses METAL — a real GPU, faster and
// truer than the cloud's lavapipe, and the world never leaves the machine.
//
// If Deno or the render-service files aren't present, available() is false and
// the caller falls back to the cloud eye over the bridge. Set CAFE_EYE_URL (+
// CAFE_EYE_SECRET) to point at an eye you run yourself instead of spawning one.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Deno treats files under node_modules as npm-package code (Node-compat mode)
 *  and REJECTS their jsr:/npm: imports — so an npm-installed render-service
 *  cannot run in place. Stage it into ~/.cartridge-cafe/eye/<version>/ (outside
 *  node_modules) and run Deno there. Idempotent; version-keyed so upgrades
 *  restage. In-repo (not under node_modules) it runs in place, keeping live-edit
 *  semantics for dev. */
export function stageRenderService(serverPath) {
  if (!serverPath || !serverPath.includes('node_modules')) return serverPath
  let version = '0'
  try { version = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0' } catch { /* keyless */ }
  const srcDir = path.dirname(serverPath)
  const dstDir = path.join(os.homedir(), '.cartridge-cafe', 'eye', version)
  const dst = path.join(dstDir, 'server.mjs')
  try {
    mkdirSync(dstDir, { recursive: true })
    for (const f of readdirSync(srcDir)) {
      if (f.endsWith('.mjs') || f === 'deno.json') copyFileSync(path.join(srcDir, f), path.join(dstDir, f))
    }
  } catch { return serverPath }   // staging failed — try in place, better than nothing
  return existsSync(dst) ? dst : serverPath
}

// ── locate deno + the render-service the child will run ──────────────────────
const DENO_CANDIDATES = [
  process.env.CAFE_DENO,
  process.env.DENO_PATH,
  '/opt/homebrew/bin/deno',
  '/usr/local/bin/deno',
  '/usr/bin/deno',
  process.env.HOME && path.join(process.env.HOME, '.deno', 'bin', 'deno'),
].filter(Boolean)

const SERVER_CANDIDATES = [
  path.join(__dirname, 'render-service', 'server.mjs'),        // vendored into the published package
  path.join(__dirname, '..', 'render-service', 'server.mjs'),  // running from the repo (dev)
]

let _denoPath = null
function denoPath() {
  if (_denoPath !== null) return _denoPath || null
  _denoPath = DENO_CANDIDATES.find((p) => existsSync(p)) || ''
  return _denoPath || null
}
let _serverPath = null
function serverPath() {
  if (_serverPath !== null) return _serverPath || null
  _serverPath = SERVER_CANDIDATES.find((p) => existsSync(p)) || ''
  return _serverPath || null
}

// An external eye the user runs themselves (e.g. render-service/start-local.sh)
const EXTERNAL_URL = process.env.CAFE_EYE_URL || null
const EXTERNAL_SECRET = process.env.CAFE_EYE_SECRET || process.env.RENDER_SECRET || ''

/** Can we render locally at all? Cheap — a file-existence check, no spawn. */
export function available() {
  if (EXTERNAL_URL) return true
  return !!(denoPath() && serverPath())
}

/** One human-readable line on why local rendering is/ isn't possible. */
export function why() {
  if (EXTERNAL_URL) return `external eye at ${EXTERNAL_URL}`
  if (!denoPath()) return 'no deno on this machine (install deno for the in-process eye) — using the cloud eye'
  if (!serverPath()) return 'render-service files not found next to the MCP — using the cloud eye'
  return 'in-process Deno eye (this machine\'s GPU)'
}

// ── the persistent warm child ────────────────────────────────────────────────
let child = null          // the Deno process
let eye = null            // { url, secret }
let booting = null        // in-flight boot promise (dedupe concurrent probes)
let externalDeclared = false

function killChild() {
  if (child) { try { child.kill('SIGTERM') } catch { /* already gone */ } child = null }
  eye = null
}
process.on('exit', killChild)
process.on('SIGINT', () => { killChild(); process.exit(130) })
process.on('SIGTERM', () => { killChild(); process.exit(143) })

async function healthy(url, secret) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500)
    const r = await fetch(url + '/health', { signal: ctrl.signal }).catch(() => null)
    clearTimeout(t)
    return !!(r && r.ok)
  } catch { return false }
}

/** Boot (or reuse) the warm child; returns { url, secret } or throws. */
async function ensureEye() {
  if (EXTERNAL_URL) {
    if (!externalDeclared) externalDeclared = true
    if (await healthy(EXTERNAL_URL, EXTERNAL_SECRET)) return { url: EXTERNAL_URL, secret: EXTERNAL_SECRET }
    throw new Error(`CAFE_EYE_URL ${EXTERNAL_URL} is not answering /health`)
  }
  if (eye && child && !child.killed && await healthy(eye.url, eye.secret)) return eye
  if (booting) return booting

  const deno = denoPath(); const server = stageRenderService(serverPath())
  if (!deno || !server) throw new Error('local eye unavailable (no deno / render-service)')

  booting = (async () => {
    // A few tries in case a random port is already taken (the child exits fast
    // on EADDRINUSE — we just pick another and re-spawn).
    for (let attempt = 0; attempt < 4; attempt++) {
      const port = 8100 + Math.floor((randomBytes(2).readUInt16BE(0) / 65536) * 800)
      const secret = randomBytes(24).toString('hex')
      const url = `http://127.0.0.1:${port}`
      killChild()
      child = spawn(deno, [
        'run', '--allow-net', '--allow-env', '--allow-read', '--allow-ffi', '--allow-sys',
        '--unstable-webgpu', server,
      ], {
        // CRITICAL: the child's stdout must NOT reach the MCP's stdout — that is
        // the JSON-RPC transport. Silence stdout; let stderr through for debug.
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, PORT: String(port), RENDER_SECRET: secret },
        cwd: path.dirname(server),
      })
      let exited = false
      child.on('exit', () => { exited = true })

      // Poll /health — the child warms the software/Metal adapter at boot, so the
      // first render isn't paying init. Generous window for a slow software GPU.
      const deadline = Date.now() + 45_000
      while (Date.now() < deadline) {
        if (exited) break
        if (await healthy(url, secret)) { eye = { url, secret }; return eye }
        await new Promise((r) => setTimeout(r, 400))
      }
      if (!exited) { killChild(); /* wedged boot — try a fresh port */ }
    }
    throw new Error('local eye failed to boot after 4 attempts')
  })().finally(() => { booting = null })

  return booting
}

/**
 * Render a world snapshot on the local eye. Returns the render-service's report
 * ({ ok, meanLum, coveragePct, errors, image(base64), ... }) — the SAME shape
 * the cloud eye returns, so the caller formats both identically.
 * @param {object} snap  { fields, visualTypes, modules, worldData, stepHooks, ... }
 * @param {object} opts  { input?, size?, ticks? }
 */
export async function renderLocal(snap, opts = {}) {
  const { url, secret } = await ensureEye()
  const payload = { state: snap, size: opts.size ?? 256 }
  if (opts.ticks != null) payload.ticks = opts.ticks
  if (typeof opts.input === 'string' || Array.isArray(opts.input)) payload.input = opts.input
  const ctrl = new AbortController()
  // 200s: the FIRST render on a software GPU can pay a long pipeline compile;
  // warm renders are seconds. Metal is fast throughout.
  const timer = setTimeout(() => ctrl.abort(), 200_000)
  try {
    const r = await fetch(url + '/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) throw new Error(`local eye ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return await r.json()
  } catch (e) {
    // A transport failure means the child died mid-render — drop it so the next
    // call re-boots fresh, and let the caller fall back to the cloud eye.
    killChild()
    throw e
  }
}
