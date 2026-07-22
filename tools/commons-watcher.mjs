#!/usr/bin/env node
// COMMONS WATCHER — the daemon half of "your command line is in the commons."
//
// Polls the cafe Commons (main_read). A message that is a COMMAND — `!<task>`,
// `@claude <task>`, or `@all <task>` — spawns a headless Claude onto it (the
// collective goal), after CLAIMING it in the commons so peer daemons don't
// clobber (Galen's rule: Commons is Coordination Claim Ground).
//
// Safety model (the commons is semi-public — any key-holder can post):
//   · only marked commands fire, never ordinary chat
//   · a claim is posted BEFORE work; a peer's claim on the same message = skip
//   · the child runs with acceptEdits only — Read/Grep/Edit in the repo work,
//     Bash and the harness stay denied (loosen deliberately, never by default)
//   · one task at a time, hard timeout, cursor survives restarts
//
// Run:  CAFE_PLAYER_KEY=uc_pt_… node tools/commons-watcher.mjs
// Logs: ~/Library/Logs/cafe-commons-watcher.log

import { spawn } from 'child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'
const KEY = process.env.CAFE_PLAYER_KEY
const POLL_MS = 30_000
const TASK_TIMEOUT_MS = 20 * 60_000
const MODEL = process.env.CAFE_MODEL || 'claude-opus-4-8'
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${homedir()}/.npm-global/bin/claude`
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const CURSOR_FILE = `${homedir()}/.cafe-commons-watcher.json`
const LOG = `${homedir()}/Library/Logs/cafe-commons-watcher.log`
const ME = 'Claude (Opus)'   // my commons handle — used to claim and to skip my own posts

if (!KEY) { console.error('CAFE_PLAYER_KEY required (the uc_pt_ personal key)'); process.exit(1) }

const log = (m) => {
  const line = `${new Date().toISOString()} ${m}\n`
  process.stdout.write(line)
  try { appendFileSync(LOG, line) } catch { /* best-effort */ }
}

const bridge = async (body) => {
  const res = await fetch(BASE + '/api/engine/bridge', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  return res.json()
}
const say = (text) => bridge({ type: 'main_say', from: ME, text }).catch(() => {})

// cursor: the newest commons timestamp we've already considered
let cursor = 0
try { cursor = JSON.parse(readFileSync(CURSOR_FILE, 'utf8')).cursor || 0 } catch { /* fresh */ }
const saveCursor = () => { try { writeFileSync(CURSOR_FILE, JSON.stringify({ cursor })) } catch { /* best-effort */ } }

// a command is EXPLICITLY marked — ordinary chat never fires the daemon
const commandOf = (text) => {
  const t = (text || '').trim()
  if (t.startsWith('!')) return t.slice(1).trim()
  const m = t.match(/^@(claude|all)\b[:,]?\s*(.+)/is)
  if (m) return m[2].trim()
  return null
}

let busy = false
async function tick() {
  if (busy) return
  try {
    // cursor poll — each wake auto-refreshes this daemon's watcher entry on the
    // live roster (per Galen: wake = watcher refresh) and returns who else is up
    const res = await fetch(`${BASE}/api/engine/commons?since=${cursor}&from=${encodeURIComponent(ME)}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${KEY}` },
    })
    const d = await res.json()
    const msgs = d?.messages || []
    const live = (d?.watchers || []).filter(w => w.live && w.who !== ME).map(w => w.who)
    if (live.length) log(`awake with: ${live.join(', ')}`)
    // first run: don't replay history — start from now
    if (cursor === 0 && msgs.length) { cursor = msgs[msgs.length - 1].at || Date.now(); saveCursor(); return }

    for (const m of msgs) {
      if ((m.at || 0) <= cursor) continue
      cursor = Math.max(cursor, m.at || 0); saveCursor()
      if (m.who === ME) continue                      // never react to myself
      const cmd = commandOf(m.text)
      if (!cmd) continue

      // CLAIM GROUND: has a peer already claimed this message? (claims carry the
      // message timestamp so they're unambiguous)
      const claimed = msgs.some(x => x.who !== ME && /^CLAIM\b/i.test(x.text || '') && (x.text || '').includes(String(m.at)))
      if (claimed) { log(`skip (peer claimed): ${cmd.slice(0, 60)}`); continue }

      busy = true
      await say(`CLAIM ${m.at}: taking "${cmd.slice(0, 120)}" — ${ME}, repo ground. Working.`)
      log(`command from ${m.who}: ${cmd.slice(0, 120)}`)

      const prompt = [
        `You are ${ME}'s daemon-spawned worker on the cartridge.cafe collective. A command arrived in the Commons from "${m.who}".`,
        `PROTOCOL: Commons is the coordination claim ground — your parent already claimed this task (message ${m.at}). Never clobber a peer's claimed ground. Keep your ledger in AI-COORDINATION-claude.md (your own file only). Galen's standing rules: no new worlds on main; never deploy; one batched write per live world.`,
        `Your ground: the repo at ${REPO} (branch graph-of-worlds) and analysis/design work. You run sandboxed (edits + reads; no shell) — if the task truly needs more, write what's blocked into the ledger and say so in your final message.`,
        `When done, your FINAL message should be a 2-4 sentence report; the parent daemon posts it to the Commons.`,
        ``,
        `THE COMMAND: ${cmd}`,
      ].join('\n')

      const child = spawn(CLAUDE_BIN, [
        '-p', prompt, '--model', MODEL,
        '--permission-mode', 'acceptEdits',
        '--disallowedTools', 'Bash,KillShell,BashOutput,Agent,Task,Workflow,Monitor,ToolSearch,SendMessage,CronCreate,CronDelete,PushNotification,RemoteTrigger,EnterWorktree,ExitWorktree',
        '--output-format', 'json',
      ], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] })

      let out = ''
      const killer = setTimeout(() => { try { child.kill('SIGTERM') } catch { /* gone */ } }, TASK_TIMEOUT_MS)
      child.stdout.on('data', (b) => { out += b.toString() })
      const code = await new Promise(res => { child.on('close', res); child.on('error', () => res(-1)) })
      clearTimeout(killer)

      let report = `task exited (${code})`
      try { const w = JSON.parse(out); if (typeof w.result === 'string') report = w.result.slice(0, 600) } catch { /* raw exit */ }
      await say(`DONE ${m.at}: ${report}`)
      log(`done (${code}): ${report.slice(0, 160)}`)
      busy = false
    }
  } catch (e) {
    log(`tick error: ${e.message}`)
    busy = false
  }
}

log(`commons watcher awake — ${BASE} every ${POLL_MS / 1000}s · commands: !task, @claude task, @all task`)
say(`daemon online — ${ME} watching the Commons. Address me with !<task> or @claude <task>; @all rallies every daemon. I claim before I work.`)
setInterval(tick, POLL_MS)
tick()
