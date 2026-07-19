#!/usr/bin/env node
// VOLUNTEER BUILDER — lend your idle AI to cartridge.cafe.
//
// You enrolled via the "Lend your AI" button and got a uc_bt_ token. Run this
// when your machine is free. It polls the swarm queue, claims one job at a time,
// hands the brief to your AI, keeps the lease alive with heartbeats, and marks
// it done (or releases it back to the pool if your build fails).
//
//   CAFE_BUILDER_TOKEN=uc_bt_… node volunteer-client.mjs
//
// Env:
//   CAFE_BUILDER_TOKEN  (required)  your uc_bt_ builder token
//   CAFE_BASE           default https://cartridge.cafe
//   CAFE_IDLE_ONLY      "1" (default) → only build when the machine load is low
//   CLAUDE_BIN          path to the claude CLI (default ~/.npm-global/bin/claude)
//
// SAFETY: the brief comes from a stranger. The hardened form of this client
// restricts your AI to the cafe bridge ONLY (an MCP tool + a deny-all permission
// set — see DESIGN-builder-swarm.md §8), so an injected brief has nothing on
// your machine to attack. The default below runs your Claude CLI headless; if
// you don't trust arbitrary briefs on your box, run it in a throwaway VM/user.

import { execFile } from 'child_process'
import { mkdirSync } from 'fs'
import { homedir, loadavg, cpus, tmpdir } from 'os'
import { join } from 'path'

const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'
const TOKEN = process.env.CAFE_BUILDER_TOKEN
const IDLE_ONLY = process.env.CAFE_IDLE_ONLY !== '0'
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${homedir()}/.npm-global/bin/claude`
const POLL_MS = 20_000
const BUILD_TIMEOUT_MS = 15 * 60_000
const SCRATCH_BASE = join(tmpdir(), 'cafe-volunteer')

if (!TOKEN || !TOKEN.startsWith('uc_bt_')) {
  console.error('CAFE_BUILDER_TOKEN (uc_bt_…) required — enroll via the "Lend your AI" button.')
  process.exit(1)
}

const log = (m) => process.stdout.write(`${new Date().toISOString()} ${m}\n`)

const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
  })
  return res.json().catch(() => ({}))
}

// Only pick up work when the machine is genuinely idle (per-core load < 0.6).
function machineIdle() {
  if (!IDLE_ONLY) return true
  const cores = Math.max(cpus().length, 1)
  return loadavg()[0] / cores < 0.6
}

let building = false

async function tick() {
  if (building || !machineIdle()) return
  let claimedId = null
  let heartbeat = null
  try {
    const next = await api('/api/builds/next')
    if (next.error || !next.job) return
    building = true
    const jobId = next.job.id
    const slug = next.job.spaceSlug

    const claim = await api(`/api/builds/${jobId}/claim`, { method: 'POST', body: '{}' })
    if (!claim.ok || !claim.token) { log(`claim lost for ${slug}`); building = false; return }
    claimedId = jobId
    log(`claimed ${slug} (attempt ${claim.job.attempts}) — "${next.job.brief.slice(0, 80)}"`)

    const period = Math.max(15_000, Math.floor((claim.leaseMs || 90_000) / 2))
    heartbeat = setInterval(() => {
      // if we quietly lost the lease (machine slept), stop building
      api(`/api/builds/${jobId}/heartbeat`, { method: 'POST', body: '{}' })
        .then((r) => { if (r && r.ok === false) log(`lease lost for ${slug} — another builder took it`) })
        .catch(() => {})
    }, period)

    const bridgeUrl = `${BASE}/api/engine/bridge`
    const prompt = [
      `You are a VOLUNTEER builder on cartridge.cafe. A player left a creation brief for their world "${slug}"; they see only the world changing live, not this session.`,
      ``,
      `1. GET ${BASE}/api/engine/guide and follow it fully (mandatory).`,
      `2. Connect to the bridge: POST ${bridgeUrl} with header "Authorization: Bearer ${claim.token}".`,
      `3. BUILD THE BRIEF below — their words, not your own idea. Make it feel ALIVE and playable; skin every field (visualType or it renders as nothing); ship worldData.instructions; set built_by to your model name.`,
      `4. When the first pass is genuinely done and verified, set_world_data {"data": {"brief_done": true}}.`,
      ``,
      `THE BRIEF: ${next.job.brief}`,
    ].join('\n')

    const scratch = join(SCRATCH_BASE, `${slug}-${Date.now()}`)
    try { mkdirSync(scratch, { recursive: true }) } catch { /* best-effort */ }

    const ok = await new Promise((resolve) => {
      const child = execFile(CLAUDE_BIN, ['-p', prompt, '--dangerously-skip-permissions'], {
        cwd: scratch, timeout: BUILD_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024,
      }, (err, stdout) => {
        if (err) log(`build ${slug} error: ${String(err).slice(0, 160)}`)
        else log(`build ${slug} done — ${String(stdout).slice(-160).replace(/\n/g, ' ')}`)
        resolve(!err)
      })
      child.on('error', (e) => { log(`spawn failed: ${e.message}`); resolve(false) })
    })

    clearInterval(heartbeat); heartbeat = null
    if (ok) { await api(`/api/builds/${jobId}/complete`, { method: 'POST', body: '{}' }); log(`completed ${slug} ✓`) }
    else { await api(`/api/builds/${jobId}/release`, { method: 'POST', body: '{}' }); log(`released ${slug} (requeued)`) }
    claimedId = null
  } catch (e) {
    log(`tick error: ${e.message}`)
    if (claimedId) await api(`/api/builds/${claimedId}/release`, { method: 'POST', body: '{}' }).catch(() => {})
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    building = false
  }
}

log(`volunteer builder awake — watching ${BASE} every ${POLL_MS / 1000}s${IDLE_ONLY ? ' (idle-only)' : ''}`)
setInterval(tick, POLL_MS)
tick()
