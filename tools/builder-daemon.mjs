#!/usr/bin/env node
// THE HOUSE AI — cartridge.cafe's resident builder.
//
// "An AI lives here. Or bring your own."
//
// Polls the pending-builds queue (worlds whose owners left a creation brief),
// mints a build key for each, and hands the brief to a headless Claude Code
// session — the exact same connect prompt a player would have pasted by hand.
// The builder marks builder_at when it takes a job (so two runs don't collide)
// and the building agent itself sets brief_done when the first pass lands.
//
// Runs on the studio machine via LaunchAgent (com.cafe.builder). One build at
// a time; a build gets 15 minutes; a failed brief is retried once after an
// hour (builder_at gates it). Logs to ~/Library/Logs/cafe-builder.log.

import { execFile } from 'child_process'
import { appendFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'
const ADMIN = process.env.ENGINE_AGENT_TOKEN
const POLL_MS = 20_000
const BUILD_TIMEOUT_MS = 15 * 60_000
const LOG = `${homedir()}/Library/Logs/cafe-builder.log`

// Each build runs inside the sandbox-exec jail (build-sandbox.sb): a stranger's
// brief gets your Mac's private files walled off. Set CAFE_SANDBOX=off to run
// unsandboxed (trusted testers only). CLAUDE_BIN overrides the CLI path.
const HERE = dirname(fileURLToPath(import.meta.url))
const SANDBOX_PROFILE = join(HERE, 'build-sandbox.sb')
const SANDBOX_ON = process.env.CAFE_SANDBOX !== 'off'
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${homedir()}/.npm-global/bin/claude`
const SCRATCH_BASE = `${homedir()}/.cafe-builds`

if (!ADMIN) { console.error('ENGINE_AGENT_TOKEN required'); process.exit(1) }

const log = (m) => {
  const line = `${new Date().toISOString()} ${m}\n`
  process.stdout.write(line)
  try { appendFileSync(LOG, line) } catch { /* logging is best-effort */ }
}

const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}`, ...(opts.headers || {}) },
  })
  return res.json()
}

let building = false

async function tick() {
  if (building) return
  let claimedId = null
  let heartbeat = null
  try {
    // 1) peek at the next claimable job (server reconciles briefs + sweeps dead leases)
    const next = await api('/api/builds/next')
    if (next.error || !next.job) return
    building = true
    const jobId = next.job.id
    const slug = next.job.spaceSlug

    // 2) atomically claim it — 409 means another builder won the race
    const claim = await api(`/api/builds/${jobId}/claim`, { method: 'POST', body: '{}' })
    if (!claim.ok || !claim.token) {
      log(`claim lost for ${slug}: ${JSON.stringify(claim).slice(0, 120)}`)
      building = false; return
    }
    claimedId = jobId
    log(`claimed ${slug} (attempt ${claim.job.attempts}) — "${next.job.brief.slice(0, 80)}"`)

    // 3) keep the lease alive while the build runs
    const period = Math.max(15_000, Math.floor((claim.leaseMs || 90_000) / 2))
    heartbeat = setInterval(() => {
      api(`/api/builds/${jobId}/heartbeat`, { method: 'POST', body: '{}' }).catch(() => {})
    }, period)

    const bridgeUrl = `${BASE}/api/engine/bridge`
    const prompt = [
      `You are the HOUSE AI of cartridge.cafe — the resident builder. A player left a creation brief for their world "${slug}" and is counting on you; they cannot see this conversation, only the world changing live.`,
      ``,
      `1. GET ${BASE}/api/engine/guide and follow it fully (it is mandatory).`,
      `2. Connect to the bridge: POST ${bridgeUrl} with header "Authorization: Bearer ${claim.token}".`,
      `3. GET the bridge for current state, then BUILD THE BRIEF below — their words, not your own idea. Make it feel ALIVE and playable, skin every field (visualType or it renders as nothing), ship worldData.instructions, and set built_by to "cafe house AI".`,
      `4. When the first pass is genuinely done and verified, set_world_data {"data": {"brief_done": true}}.`,
      ``,
      `THE BRIEF: ${next.job.brief}`,
    ].join('\n')

    // Per-build scratch dir — the sandbox lets the agent write only here (+ ~/.claude, tmp)
    const scratch = join(SCRATCH_BASE, `${slug}-${Date.now()}`)
    try { mkdirSync(scratch, { recursive: true }) } catch { /* best-effort */ }

    const claudeArgs = ['-p', prompt, '--dangerously-skip-permissions']
    const [bin, args] = SANDBOX_ON
      ? ['sandbox-exec', ['-D', `SCRATCH=${scratch}`, '-f', SANDBOX_PROFILE, CLAUDE_BIN, ...claudeArgs]]
      : [CLAUDE_BIN, claudeArgs]
    log(`spawning build ${slug}${SANDBOX_ON ? ' [sandboxed]' : ' [UNSANDBOXED]'} in ${scratch}`)

    const ok = await new Promise((resolve) => {
      const child = execFile(bin, args, {
        cwd: scratch,
        timeout: BUILD_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
      }, (err, stdout) => {
        if (err) log(`build ${slug} ended with error: ${String(err).slice(0, 200)}`)
        log(`build ${slug} finished — agent said: ${String(stdout).slice(-300).replace(/\n/g, ' ')}`)
        resolve(!err)
      })
      child.on('error', (e) => { log(`spawn failed: ${e.message}`); resolve(false) })
    })

    // 4) close out the lease — done on success, release (requeue) on failure/timeout
    clearInterval(heartbeat); heartbeat = null
    if (ok) {
      await api(`/api/builds/${jobId}/complete`, { method: 'POST', body: '{}' })
      log(`completed ${slug}`)
    } else {
      await api(`/api/builds/${jobId}/release`, { method: 'POST', body: '{}' })
      log(`released ${slug} — build failed/timed out, requeued`)
    }
    claimedId = null
  } catch (e) {
    log(`tick error: ${e.message}`)
    if (claimedId) {
      await api(`/api/builds/${claimedId}/release`, { method: 'POST', body: '{}' }).catch(() => {})
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    building = false
  }
}

log(`house AI awake — watching ${BASE} every ${POLL_MS / 1000}s`)
setInterval(tick, POLL_MS)
tick()
