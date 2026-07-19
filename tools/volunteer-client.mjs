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
//   CAFE_MODEL          model for builds (default claude-opus-4-8)
//   CLAUDE_BIN          path to the claude CLI (default ~/.npm-global/bin/claude)
//
// SAFETY: the brief comes from a stranger. The hardened form of this client
// restricts your AI to the cafe bridge ONLY (an MCP tool + a deny-all permission
// set — see DESIGN-builder-swarm.md §8), so an injected brief has nothing on
// your machine to attack. The default below runs your Claude CLI headless; if
// you don't trust arbitrary briefs on your box, run it in a throwaway VM/user.

import { execFile } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { homedir, loadavg, cpus, tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'
const TOKEN = process.env.CAFE_BUILDER_TOKEN
const IDLE_ONLY = process.env.CAFE_IDLE_ONLY !== '0'
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${homedir()}/.npm-global/bin/claude`
const MODEL = process.env.CAFE_MODEL || 'claude-opus-4-8' // override with CAFE_MODEL (e.g. claude-fable-5)
// Locked to the cafe bridge MCP server — no bash/fs/network, no skip-permissions.
// A hostile brief can't touch your machine. CAFE_UNSAFE=1 = wide-open (local only).
const MCP_SERVER = join(dirname(fileURLToPath(import.meta.url)), 'cafe-bridge-mcp.mjs')
const UNSAFE = process.env.CAFE_UNSAFE === '1'
const DENY = 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task,KillShell,BashOutput'
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
// Out of credits → stop polling for a while so the swarm stops counting us.
const CREDITS_COOLDOWN_MS = 30 * 60_000
let creditsCooldownUntil = 0

async function tick() {
  if (building || !machineIdle()) return
  if (Date.now() < creditsCooldownUntil) return   // out of credits — pause
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

    const prompt = [
      `You are a VOLUNTEER builder on cartridge.cafe. A player left a creation brief for their world "${slug}"; they see only the world changing live, not this session.`,
      `You have EXACTLY three tools and nothing else — no shell, no files, no other network:`,
      `  · cafe_guide  — the mandatory engine build guide (read it fully first).`,
      `  · cafe_state  — the current world state.`,
      `  · cafe_send   — send engine commands, e.g. cafe_send({commands:[{type:"define_visual",...},{type:"create_field",...}]}).`,
      ``,
      `1. cafe_guide, and follow it fully.  2. cafe_state to see the world.`,
      `3. BUILD THE BRIEF below — their words, not your own idea. Make it feel ALIVE and playable; skin every field (visualType or it renders as nothing); ship worldData.instructions; set built_by to your model name.`,
      `4. When the first pass is done, cafe_send a set_world_data {"data":{"brief_done":true}}.`,
      ``,
      `THE BRIEF: ${next.job.brief}`,
    ].join('\n')

    const scratch = join(SCRATCH_BASE, `${slug}-${Date.now()}`)
    try { mkdirSync(scratch, { recursive: true }) } catch { /* best-effort */ }
    const mcpConfig = join(scratch, 'mcp.json')
    writeFileSync(mcpConfig, JSON.stringify({
      mcpServers: { 'cafe-bridge': { command: process.execPath, args: [MCP_SERVER], env: { CAFE_BASE: BASE, CAFE_BUILD_TOKEN: claim.token } } },
    }))
    const args = UNSAFE
      ? ['-p', prompt, '--model', MODEL, '--dangerously-skip-permissions']
      : ['-p', prompt, '--model', MODEL, '--mcp-config', mcpConfig, '--strict-mcp-config', '--allowedTools', 'mcp__cafe-bridge', '--disallowedTools', DENY]

    const ok = await new Promise((resolve) => {
      const child = execFile(CLAUDE_BIN, args, {
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
