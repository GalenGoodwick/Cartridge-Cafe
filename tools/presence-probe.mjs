#!/usr/bin/env node
// presence-probe.mjs — the TWO-CLIENT eyes for nested presence.
//
// The render-probe (render-service) sees shaders headless; it can NOT see live
// cursors, Socket.IO rooms, or the effect-churn that kept breaking main. This
// launches TWO real headless-WebGPU Chrome clients against a running dev server,
// drives one through the hub views, and reads each client's __ccPresenceDbg
// (room + who it currently sees) so we can PROVE, without a human, whether:
//   · cursors bleed across views (A still sees B after B leaves the shared view)
//   · main's own cursors survive navigation (A never loses sight of peers on main)
//
// Requires the Phase-0 instrumentation (window.__ccPresenceDbg) and a dev server
// on --base (default http://localhost:3000). Two clients reach the same Railway
// presence server, so they see each other.
//
//   node tools/presence-probe.mjs [--base http://localhost:3000] [--json]

import { createRequire } from 'module'
// playwright-core lives in web/node_modules — resolve it from there
const require = createRequire('/Users/galengoodwick/Documents/GitHub/cartridge-cafe/web/')
const { chromium } = require('playwright-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = process.argv.slice(2)
const base = (args.find(a => a.startsWith('--base=')) || '').split('=')[1] ||
  (args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3000')
const asJson = args.includes('--json')

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
})

// two ISOLATED contexts → separate localStorage → two distinct cc-pid players
const ctxA = await browser.newContext({ viewport: { width: 900, height: 700 } })
const ctxB = await browser.newContext({ viewport: { width: 900, height: 700 } })
const A = await ctxA.newPage()
const B = await ctxB.newPage()
const log = []
// count socket (re)connections per client — a NEW "[cursors] connecting" on
// navigation = the effect tore the socket down and rebuilt it (the churn that
// blinks cursors). Persistent-socket room-switch should produce ZERO extra.
const connects = { A: 0, B: 0 }
for (const [nm, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', e => log.push(`${nm} PAGEERROR ${e.message}`))
  p.on('console', m => { if (/\[cursors\] connecting to/.test(m.text())) connects[nm]++ })
}
const snapConnects = () => ({ A: connects.A, B: connects.B })

const dbg = (p) => p.evaluate(() => (window).__ccPresenceDbg || null)
// keep a client's cursor "active" (presence filters cursors idle > 60s)
const wiggle = async (p) => { for (let i = 0; i < 4; i++) { await p.mouse.move(300 + i * 40, 300 + i * 30); await p.waitForTimeout(120) } }
// drive hub nav via the SAME window flags + events the app's handlers set. The
// cartridge reads __cafePlayers/__cafeSub/__cafeMine, so setting them is faithful.
const launch = (p, detail) => p.evaluate(d => window.dispatchEvent(new CustomEvent('cafe:launch', { detail: d })), detail)
const toPlayers = (p) => launch(p, 'players:')                          // handler sets __cafePlayers
const toSubs = (p) => p.evaluate(() => { window.__cafePlayers = false; window.dispatchEvent(new CustomEvent('cafe:launch', { detail: 'SUB-MAIN' })) })
const toMain = (p) => p.evaluate(() => {   // what commons()/the Cafe button does
  window.__cafePlayers = false; window.__cafeSub = null; window.__cafeMine = { on: false }
  window.dispatchEvent(new CustomEvent('cafe:launch', { detail: 'CAFE' }))
})

// does A currently SEE B (B's id in A.others)?
const sees = (da, db) => !!(da && db && Array.isArray(da.others) && da.others.includes(db.me))

const steps = []
const record = async (label) => {
  await wiggle(A); await wiggle(B); await A.waitForTimeout(1200)
  const da = await dbg(A), db = await dbg(B)
  const row = { label, A_room: da?.room, B_room: db?.room, A_sees_B: sees(da, db), B_sees_A: sees(db, da), A_n: da?.n, B_n: db?.n, connects: snapConnects() }
  steps.push(row)
  if (!asJson) console.log(`${label.padEnd(28)} A[${row.A_room}] B[${row.B_room}]  A→B:${row.A_sees_B}  B→A:${row.B_sees_A}  reconnects{A:${row.connects.A} B:${row.connects.B}}`)
  return row
}

const report = { base, steps, log, ok: false }
try {
  await A.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await B.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await A.waitForTimeout(8000); await B.waitForTimeout(8000)   // load + WebGPU + presence connect

  await record('both on MAIN')                    // expect: both see each other
  await toPlayers(B); await record('B → PLAYER WORLDS')   // bleed if A still sees B
  await toPlayers(A); await record('both in PLAYER WORLDS')   // MUST see each other (co-presence)
  await toMain(A); await toMain(B); await record('both back on MAIN')
  await toSubs(A); await toSubs(B); await record('both in SUB-MAINS dir')  // MUST see each other
  await toMain(A); await toMain(B); await record('both back on MAIN again')

  // ── NESTING: A stays on main, B descends; A's /api/presence counts must carry
  // B's path so main's parent bubble docks an orb (rollup happens in the shader).
  const counts = (p) => p.evaluate(() => (window).__cafeCounts || {})
  const nest = []
  const nestStep = async (label, navB, wantPrefix) => {
    await navB(B); await wiggle(B)
    await A.waitForTimeout(8000)          // B beats immediately on nav; A polls every 6s
    const c = await counts(A)
    const hit = Object.keys(c).some(k => k === wantPrefix || k.startsWith(wantPrefix + '/'))
    nest.push({ label, wantPrefix, hit, keys: Object.keys(c).filter(k => k.startsWith('main')) })
    if (!asJson) console.log(`${label.padEnd(34)} A.counts has "${wantPrefix}"* : ${hit}`)
  }
  await nestStep('B in PLAYER WORLDS → main sees', toPlayers, 'main/players')
  await toMain(B)
  await nestStep('B in SUB-MAINS → main sees', toSubs, 'main/subs')
  report.nest = nest
  report.ok = true
} catch (e) {
  report.error = String(e && e.message || e)
} finally {
  await browser.close()
}

if (asJson) console.log(JSON.stringify(report, null, 2))
else {
  if (report.error) console.log('ERROR', report.error)
  if (log.length) console.log('\nconsole/errors:\n' + log.slice(0, 20).join('\n'))
  // verdicts
  const main0 = steps.find(s => s.label === 'both on MAIN')
  const bleed = steps.find(s => s.label === 'B → PLAYER WORLDS')
  console.log('\n── verdicts ──')
  console.log('baseline both-on-main see each other:', main0 ? (main0.A_sees_B && main0.B_sees_A) : 'n/a')
  console.log('BLEED (A still sees B after B→PLAYER WORLDS):', bleed ? bleed.A_sees_B : 'n/a', '  (want: false once scoped)')
}
process.exit(report.ok ? 0 : 1)
