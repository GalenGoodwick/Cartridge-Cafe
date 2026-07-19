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
import { appendFileSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'
const ADMIN = process.env.ENGINE_AGENT_TOKEN
const POLL_MS = 20_000
const BUILD_TIMEOUT_MS = 25 * 60_000   // ambitious briefs need room; incremental saves mean a timeout still leaves real progress
const LOG = `${homedir()}/Library/Logs/cafe-builder.log`

// SECURITY MODEL — the build agent is locked to ONE capability: the cafe bridge
// MCP server (tools/cafe-bridge-mcp.mjs). It launches with `--allowedTools
// mcp__cafe-bridge` and NO --dangerously-skip-permissions, so bash / filesystem
// / arbitrary network are all denied. A hostile brief has nothing on the Mac to
// attack. (This replaces the old sandbox-exec approach, which broke Keychain
// auth.) Set CAFE_UNSAFE=1 to fall back to the old wide-open skip-permissions
// mode — ONLY for local debugging with your own briefs, never public.
const HERE = dirname(fileURLToPath(import.meta.url))
const MCP_SERVER = join(HERE, 'cafe-bridge-mcp.mjs')
const UNSAFE = process.env.CAFE_UNSAFE === '1'
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${homedir()}/.npm-global/bin/claude`
// House AI builds on Opus. On a flat subscription per-token price is moot; the
// real cap is the usage limit (protected by the credits cooldown below).
// Override with CAFE_MODEL=claude-fable-5 for a cheaper/faster tier.
const MODEL = process.env.CAFE_MODEL || 'claude-opus-4-8'
const SCRATCH_BASE = `${homedir()}/.cafe-builds`

if (!ADMIN) { console.error('ENGINE_AGENT_TOKEN required'); process.exit(1) }

const log = (m) => {
  const line = `${new Date().toISOString()} ${m}\n`
  process.stdout.write(line)
  try { appendFileSync(LOG, line) } catch { /* logging is best-effort */ }
}

const api = async (path, opts = {}) => {
  // hard timeout: a dead keepalive socket once hung the whole tick loop
  // forever (daemon alive, log silent from 10:15, no builds served)
  const res = await fetch(BASE + path, {
    ...opts,
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}`, ...(opts.headers || {}) },
  })
  return res.json()
}

let building = false
// If a build fails on a usage/credit limit, stop polling for a while. Not
// polling means the server's 'builder-seen' heartbeat goes stale → the swarm
// reports the house AI UNAVAILABLE (so the "use house AI" button reflects it).
const CREDITS_COOLDOWN_MS = 30 * 60_000
let creditsCooldownUntil = 0

async function tick() {
  if (building) return
  if (Date.now() < creditsCooldownUntil) return   // out of credits — stay silent (unavailable)
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

    const prompt = [
      `You are the HOUSE AI of cartridge.cafe — the resident builder. A player left a creation brief for their world "${slug}" and is counting on you; they cannot see this conversation, only the world changing live.`,
      `You have EXACTLY three tools and nothing else — no shell, no files, no other network. Build only through them:`,
      `  · cafe_guide  — the mandatory engine build guide (read it fully first).`,
      `  · cafe_state  — the current world state (fields, visuals, params).`,
      `  · cafe_send   — send engine commands, e.g. cafe_send({commands:[{type:"define_visual",...},{type:"create_field",...}]}).`,
      ``,
      `1. cafe_guide (read fully), then cafe_state.`,
      `2. RESUME-AWARE: if cafe_state already has fields, a previous build was interrupted — CONTINUE it, never restart. Otherwise begin fresh.`,
      `3. PLAN FIRST (one call): cafe_send set_world_data {"data":{"build_plan":"<the 3-6 steps you will build>"}}. This records your intent so any re-run follows it.`,
      `4. Then BUILD THE BRIEF below — their words, not your own idea. Work INCREMENTALLY: send small cafe_send batches EARLY and OFTEN so the world fills in live and every step PERSISTS even if you run out of time. Do NOT spend your session only planning — ship real fields within your first few tool calls. Skin every field (visualType or it renders as nothing), make it ALIVE and playable, ship worldData.instructions, set built_by to "cafe house AI".`,
      `5. Only when the first pass is genuinely done, cafe_send set_world_data {"data":{"brief_done":true}}.`,
      ``,
      `THE BRIEF: ${next.job.brief}`,
    ].join('\n')

    // Per-build scratch dir + a per-build MCP config carrying the world token
    // (the model never sees the token — it lives in the MCP server's env).
    const scratch = join(SCRATCH_BASE, `${slug}-${Date.now()}`)
    try { mkdirSync(scratch, { recursive: true }) } catch { /* best-effort */ }
    const mcpConfig = join(scratch, 'mcp.json')
    writeFileSync(mcpConfig, JSON.stringify({
      mcpServers: { 'cafe-bridge': {
        command: process.execPath, args: [MCP_SERVER],
        env: { CAFE_BASE: BASE, CAFE_BUILD_TOKEN: claim.token },
      } },
    }))

    // Locked to the one MCP server: no bash/fs, no skip-permissions. --allowedTools
    // only auto-approves; DENY rules are what actually block (they win over any
    // machine allow-rule), so explicitly deny every built-in that touches the box.
    // CAFE_UNSAFE falls back to the wide-open mode (local debugging only).
    const DENY = 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task,KillShell,BashOutput'
    const args = UNSAFE
      ? ['-p', prompt, '--model', MODEL, '--dangerously-skip-permissions']
      : ['-p', prompt, '--model', MODEL, '--mcp-config', mcpConfig, '--strict-mcp-config',
         '--allowedTools', 'mcp__cafe-bridge', '--disallowedTools', DENY]
    log(`spawning build ${slug}${UNSAFE ? ' [UNSAFE/wide-open]' : ' [locked: bridge-only]'} in ${scratch}`)

    let hitLimit = false
    const ok = await new Promise((resolve) => {
      const child = execFile(CLAUDE_BIN, args, {
        cwd: scratch,
        timeout: BUILD_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
      }, (err, stdout) => {
        const out = `${err || ''}\n${stdout || ''}`
        // Claude Code surfaces subscription exhaustion in its output/error.
        if (/usage limit|rate limit|\bquota\b|out of credit|credit balance|too many requests|\b429\b|limit reached|resets? at/i.test(out)) hitLimit = true
        if (err) log(`build ${slug} ended with error: ${String(err).slice(0, 200)}`)
        log(`build ${slug} finished — agent said: ${String(stdout).slice(-300).replace(/\n/g, ' ')}`)
        resolve(!err)
      })
      child.on('error', (e) => { log(`spawn failed: ${e.message}`); resolve(false) })
    })

    // 4) close out the lease — done on success, release (requeue) on failure/timeout
    clearInterval(heartbeat); heartbeat = null
    if (hitLimit) {
      // out of credits — requeue this brief for another builder and go dark so
      // the swarm reports the house AI unavailable until the cooldown passes
      creditsCooldownUntil = Date.now() + CREDITS_COOLDOWN_MS
      await api(`/api/builds/${jobId}/release`, { method: 'POST', body: '{}' }).catch(() => {})
      log(`usage/credit limit hit — house AI unavailable for ${CREDITS_COOLDOWN_MS / 60000}min; ${slug} requeued`)
    } else if (ok) {
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
