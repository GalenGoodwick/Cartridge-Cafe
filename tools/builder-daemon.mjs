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

import { spawn } from 'child_process'
import { appendFileSync, mkdirSync, writeFileSync, createWriteStream } from 'fs'
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

/** Mirror one live line into the world's durable BUILD CONSOLE slot so the
 *  player watches the AI think + act in real time (read-modify-write; races
 *  with the bridge's own mirror are last-write-wins and both cap the ring). */
async function consoleLine(spaceId, type, summary) {
  if (!spaceId) return
  try {
    const slot = 'build:console:' + spaceId
    const cur = await api(`/api/engine/save?slot=${encodeURIComponent(slot)}`)
    const prev = cur?.data && typeof cur.data === 'object' ? cur.data : {}
    let seq = prev.seq ?? 0
    const entries = Array.isArray(prev.entries) ? prev.entries : []
    entries.push({ type, name: '', summary: String(summary).slice(0, 1600), seq: ++seq, t: Date.now() })
    await api('/api/engine/save', { method: 'POST', body: JSON.stringify({ slot, data: { seq, entries: entries.slice(-120) } }) })
  } catch { /* the console is a courtesy */ }
}

// One live build child, killed with the daemon — an orphaned build keeps a valid
// world token and can interleave with the NEXT attempt on the same world (the
// one real build race). Dying clean closes it.
let activeChild = null
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try { if (activeChild) activeChild.kill('SIGTERM') } catch { /* gone */ }
    process.exit(0)
  })
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

    // FORWARD COMPACTION — a build session dies at the credit limit, and a fresh
    // one used to re-read the whole engine from scratch and never get to build.
    // A previous session leaves build_notes (engine facts it learned + what it
    // built + what's next) in worldData; inject them so this session resumes
    // where the last one stopped instead of re-researching.
    let priorNotes = ''
    try {
      const snap = await fetch(`${BASE}/api/spaces/${encodeURIComponent(slug)}/snapshot`).then(r => r.json())
      const bn = ((snap?.snapshot ?? snap)?.worldData ?? {}).build_notes
      if (bn && typeof bn === 'string') priorNotes = bn.slice(0, 6000)
    } catch { /* no notes yet — fresh build */ }
    if (priorNotes) log(`  resuming ${slug} with ${priorNotes.length} chars of prior build_notes`)

    // 3) keep the lease alive while the build runs
    const period = Math.max(15_000, Math.floor((claim.leaseMs || 90_000) / 2))
    heartbeat = setInterval(() => {
      api(`/api/builds/${jobId}/heartbeat`, { method: 'POST', body: '{}' }).catch(() => {})
    }, period)

    const prompt = [
      `You are the HOUSE AI of cartridge.cafe — the resident builder. A player left a creation brief for their world "${slug}" and is counting on you; they cannot see this conversation, only the world changing live.`,
      `You build ONLY through the four cafe tools (no shell, no editable files):`,
      `  · cafe_guide  — the engine build guide (read it first).`,
      `  · cafe_source — SEARCH/read the engine source (read-only). PREFER {search:"opSmooth"} — it greps ALL source and returns file:line snippets in ONE call, so you find the exact function/param instead of reading whole files (that wastes your window). {path:...,from,to} reads a specific span. The bridge route is the authoritative command+param list; engine/scenes/*.wgsl are the real WGSL/3D interface.`,
      `  · cafe_state  — the current world state (fields, visuals, params).`,
      `  · cafe_send   — send engine commands, e.g. cafe_send({commands:[{type:"define_visual",...},{type:"create_field",...}]}). Pass commands as a REAL JSON array, never a stringified one.`,
      `You ALSO have WebSearch + WebFetch (read-only) to research shader techniques and game mechanics when genuinely stuck — but this engine is WGSL with the strict signature fn visual_<name>(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f, so LEARN the technique and ADAPT it (Shadertoy is GLSL — never paste it raw). Look up briefly, then build; do not spend your window researching. cafe_source (the engine's own ~40 built-in visuals + example cartridges) is usually the better reference.`,
      ``,
      `NEVER use ToolSearch, Monitor, or plan mode — act immediately with the tools above.`,
      `DO NOT reverse-engineer the API by trial-and-error, and DO NOT read whole source files. If unsure what a command/param/function is, cafe_source({search:"<name>"}) — one grep returns the exact file:line. Probing and whole-file reads both waste your window.`,
      ``,
      `1. cafe_guide, then cafe_state. When a command's params are unclear, cafe_source the bridge route rather than guessing.`,
      `2. RESUME-AWARE: if cafe_state already has fields, a previous build was interrupted — CONTINUE it, never restart. Otherwise begin fresh. If PRIOR NOTES are given below, they are YOUR last session's hard-won research and progress — TRUST them and continue; do NOT re-read source you already noted.`,
      `3. FORWARD COMPACTION — you WILL likely hit a usage limit mid-build and a fresh session will take over with NO memory except what you wrote down. So EARLY (right after your first research) and after every milestone, cafe_send set_world_data {"data":{"build_notes":"<cumulative, concise: the engine facts you learned (shader signature, the raymarch/uni scaffold, coordinate rules), WHAT you've built so far, and the NEXT concrete steps>"}}. This is the ONLY thing that survives a crash — it's how your successor skips the research and finishes the world. Overwrite it with the full current picture each time; keep it under ~800 words. (Also set build_plan once.)`,
      `4. Then BUILD THE BRIEF below — their words, not your own idea. Work INCREMENTALLY: send small cafe_send batches EARLY and OFTEN so the world fills in live and every step PERSISTS even if you run out of time. Do NOT spend your session only planning — ship real fields within your first few tool calls. Skin every field (visualType or it renders as nothing), make it ALIVE and playable, ship worldData.instructions, set built_by to "cafe house AI".`,
      `5. EVERY field must carry a visualType — create_field {"visualType":"<a name you define_visual'd>"} or set_visual {"fieldId":"...","visualType":"..."} right after. A field without one renders as NOTHING; a world of them is a black screen.`,
      `   SHADER SHAPE: a visual is a PLAIN FUNCTION — fn visual_<name>(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f. NEVER a standalone @fragment/@vertex fn main shader (the bridge rejects those; they compile nowhere in this engine).`,
      `   COORDINATE SPACE: the world is a 512×512 grid, camera fixed at the CENTER (256,256). Build AROUND (256,256), never around (0,0), and NEVER use negative x/y — a world centered on origin renders off-screen in the corner (looks dark). A field's x,y is its center; size ~300-450 fills the view.`,
      `   PHYSICS: leave collisionForce at 0 (the default) for any world whose fields are stacked visual LAYERS (a full-screen backdrop with things on top). Overlapping fields with collisionForce>0 shove each other every frame and the whole world VIBRATES. Only set collisionForce for real physics worlds where separate bodies should bounce off each other.`,
      `6. Only when the first pass is genuinely done, cafe_send set_world_data {"data":{"brief_done":true}}. The bridge runs a RENDER CHECK: brief_done is REFUSED while no field has a registered visualType — fix the skins and finish properly.`,
      ``,
      priorNotes ? `PRIOR NOTES (from your last session before it hit the limit — resume from here, do NOT restart or re-research):\n${priorNotes}\n` : ``,
      `THE BRIEF: ${next.job.brief}`,
    ].filter(Boolean).join('\n')

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
    // deny the box AND the harness: streamed builds showed the agent burning its
    // whole window on ToolSearch (hunting for tools) and Monitor (wait loops)
    // instead of building — the cafe tools are everything it needs.
    // WebSearch/WebFetch are ALLOWED (read-only): the agent can research shader
    // techniques + game mechanics. Safe because bash/fs stay denied — there's
    // nothing on the box for a fetch to exfiltrate. Everything that touches the
    // machine or the harness stays blocked.
    const DENY = 'Bash,Edit,Write,Read,Glob,Grep,NotebookEdit,Task,KillShell,BashOutput,' +
      'ToolSearch,Monitor,Agent,TaskCreate,TaskUpdate,TaskList,TaskGet,TaskOutput,TaskStop,SendMessage,' +
      'EnterPlanMode,ExitPlanMode,EnterWorktree,ExitWorktree,Skill,Workflow,AskUserQuestion,Artifact,' +
      'ScheduleWakeup,CronCreate,CronDelete,CronList,PushNotification,RemoteTrigger,DesignSync'
    // stream-json: we SEE the build live (tool calls + thinking) instead of a
    // black box until exit — the blindness that made stalled builds undebuggable
    // and the player's console empty. Raw stream tees to scratch/build.log;
    // key events mirror into the world's durable BUILD CONSOLE.
    const args = UNSAFE
      ? ['-p', prompt, '--model', MODEL, '--dangerously-skip-permissions']
      : ['-p', prompt, '--model', MODEL, '--mcp-config', mcpConfig, '--strict-mcp-config',
         '--allowedTools', 'mcp__cafe-bridge,WebSearch,WebFetch', '--disallowedTools', DENY,
         '--output-format', 'stream-json', '--verbose']
    log(`spawning build ${slug}${UNSAFE ? ' [UNSAFE/wide-open]' : ' [locked: bridge-only]'} in ${scratch}`)
    const spaceId = claim.job?.spaceId || null
    void consoleLine(spaceId, 'agent', '🤖 house AI took the job — reading the guide')

    let hitLimit = false
    const ok = await new Promise((resolve) => {
      const child = spawn(CLAUDE_BIN, args, { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] })
      activeChild = child
      const rawLog = createWriteStream(join(scratch, 'build.log'), { flags: 'a' })
      const killer = setTimeout(() => { try { child.kill('SIGTERM') } catch { /* gone */ } }, BUILD_TIMEOUT_MS)
      let buf = ''
      let lastSaid = ''
      let lastThinkAt = 0
      child.stdout.on('data', (d) => {
        rawLog.write(d)
        buf += d.toString()
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
          if (!line.trim()) continue
          try {
            const ev = JSON.parse(line)
            // Limit detection ONLY from harness error events — never from the
            // agent's prose or tool results. The guide itself says "daily
            // creation quota", which the old any-line scan matched: every build
            // that READ the guide got falsely requeued as credit-limited.
            if ((ev.type === 'result' && ev.is_error) || ev.type === 'error' || (ev.type === 'system' && ev.subtype === 'error')) {
              const errText = String(ev.result ?? ev.error ?? ev.message ?? line)
              if (/usage limit|rate limit|\bquota\b|out of credit|credit balance|too many requests|\b429\b|limit reached|resets? at/i.test(errText)) hitLimit = true
            }
            if (ev.type === 'assistant' && ev.message?.content) {
              for (const c of ev.message.content) {
                if (c.type === 'tool_use') {
                  const tool = String(c.name || '').replace(/^mcp__cafe-bridge__/, '')
                  const n = tool === 'cafe_send' ? (Array.isArray(c.input?.commands) ? ` (${c.input.commands.length} cmds)` : '') : ''
                  log(`  [${slug}] tool: ${tool}${n}`)
                  if (tool !== 'cafe_send') void consoleLine(spaceId, 'agent', `⚙ ${tool}${n}`)   // cafe_send lands via the bridge mirror
                } else if (c.type === 'text' && c.text?.trim()) {
                  lastSaid = c.text.trim()
                  if (Date.now() - lastThinkAt > 12_000) {   // throttle thinking lines
                    lastThinkAt = Date.now()
                    void consoleLine(spaceId, 'agent', `💭 ${lastSaid.slice(0, 1500).replace(/\n/g, ' ')}`)
                  }
                }
              }
            } else if (ev.type === 'result') {
              if (ev.result) lastSaid = String(ev.result)
            }
          } catch { /* non-JSON line — keep streaming */ }
        }
      })
      child.stderr.on('data', (d) => { rawLog.write(d); if (/usage limit|rate limit|quota|429/i.test(String(d))) hitLimit = true })
      child.on('close', (code) => {
        activeChild = null
        clearTimeout(killer); rawLog.end()
        if (code !== 0) log(`build ${slug} ended with exit ${code}`)
        log(`build ${slug} finished — agent said: ${lastSaid.slice(-300).replace(/\n/g, ' ')}`)
        resolve(code === 0)
      })
      child.on('error', (e) => { clearTimeout(killer); log(`spawn failed: ${e.message}`); resolve(false) })
    })

    // 4) close out the lease — done on success, release (requeue) on failure/timeout
    clearInterval(heartbeat); heartbeat = null
    if (ok) {
      // a session that ran to a clean exit is DONE — complete it even if a limit
      // error surfaced along the way (the work is saved; don't phantom-requeue)
      await api(`/api/builds/${jobId}/complete`, { method: 'POST', body: '{}' })
      log(`completed ${slug}`)
    } else if (hitLimit) {
      // out of credits — requeue this brief for another builder and go dark so
      // the swarm reports the house AI unavailable until the cooldown passes
      creditsCooldownUntil = Date.now() + CREDITS_COOLDOWN_MS
      await api(`/api/builds/${jobId}/release`, { method: 'POST', body: '{}' }).catch(() => {})
      log(`usage/credit limit hit — house AI unavailable for ${CREDITS_COOLDOWN_MS / 60000}min; ${slug} requeued`)
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
