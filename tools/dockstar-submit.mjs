// DOCKSTAR SUBMISSION (workbench W2 ritual) — run at ship time:
//
//   node tools/dockstar-submit.mjs <uc_st_token> [--publish]
//
// 1. Prints THE TWO CHARTS: primitive-side accounting (born → fate) and
//    node-side green status.
// 2. Refuses locally if triage is incomplete (mirror of the server gate).
// 3. Proves each node GREEN: compiles, ticks solo without throwing, and the
//    full spine runs 240 ticks with zero hook errors; the eye renders bright
//    with a state trace; the manifest probe (if declared) must move.
// 4. Submits the evidence (validate_world), calls complete_build, and with
//    --publish calls publish_world — the server re-computes triage-complete
//    itself, so this script can't vouch for a dirty bay.

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const { makeClient } = await import(join(here, '../mcp/bridge-client.mjs'))
const eye = await import(join(here, '../mcp/local-eye.mjs'))
const { shapeSnapshot } = await import(join(here, '../mcp/probe-format.mjs'))

const TOKEN = process.argv[2]
const PUBLISH = process.argv.includes('--publish')
if (!TOKEN) { console.error('usage: node tools/dockstar-submit.mjs <uc_st_token> [--publish]'); process.exit(2) }

const c = makeClient({ base: process.env.CAFE_BASE || 'https://cartridge.cafe', token: TOKEN, timeoutMs: 120000 })
const { text } = await c.bridgeGet()
const raw = JSON.parse(text)
const wd = raw.worldData || {}
const bay = wd.dockstarBay
if (!bay?.born) { console.error('RED: not a dockstar world (no worldData.dockstarBay)'); process.exit(1) }

const hookId = h => String(h.hookId ?? h.id)
const isPrim = id => id.startsWith('prim-')
const nodes = raw.stepHooks.map(hookId).filter(id => !isPrim(id))
const presentPrims = [
  ...raw.stepHooks.map(hookId).filter(isPrim),
  ...(raw.fields || []).map(f => String(f.id ?? f.name)).filter(isPrim),
]
const ledger = Array.isArray(wd.triage) ? wd.triage : []
const fate = new Map()
for (const e of ledger) fate.set(e.prim, e)

// ── CHART 1: primitive-side accounting ──
console.log('\n═ PRIMITIVE ACCOUNTING (born → fate) ═')
let dirty = 0
for (const p of bay.born) {
  const here2 = presentPrims.includes(p.id)
  const f = fate.get(p.id)
  let line
  if (here2) { line = '⏳ IN BAY (untriaged)'; dirty++ }
  else if (f?.fate === 'moved') line = `→ moved into "${f.to}"`
  else if (f?.fate === 'deleted') line = `✂ deleted — ${f.reason || ''}`
  else { line = '❌ VANISHED with no ledger entry (accounting bypassed)'; dirty++ }
  console.log(`  ${p.id.padEnd(24)} ${line}`)
}
const moved = [...fate.values()].filter(e => e.fate === 'moved').length
const deleted = [...fate.values()].filter(e => e.fate === 'deleted').length
console.log(`  ── born ${bay.born.length} · moved ${moved} · deleted ${deleted} · dirty ${dirty}`)
if (dirty) { console.error('\nRED: triage incomplete — the bay must be EMPTY and every fate on the ledger.'); process.exit(1) }

// ── THE VISUAL GATE (FIRST — Galen's law, Sep 15): two real-tab shots,
// portrait + wide, judged for visible content. The GPU eye cannot see
// aspect bugs; this can. Requires --url <world play url>. ──
const results = []
{
  const urlArg = process.argv.indexOf('--url')
  const playUrl = urlArg > -1 ? process.argv[urlArg + 1] : null
  if (!playUrl) {
    console.log('\n═ VISUAL GATE ═\n  ⚠ no --url given — visual-gate will be UNAVAILABLE and completion will refuse')
    results.push({ check: 'visual-gate', status: 'unavailable', environment: 'real-tab', details: ['no real-tab capture — pass --url and rerun'] })
  } else {
    const { execFileSync } = await import('node:child_process')
    const { readFileSync: rf } = await import('node:fs')
    const zlib = await import('node:zlib')
    const judge = (path) => {   // decode PNG (node zlib) → mean luminance + variance
      const d = rf(path); let pos = 8, w = 0, hh = 0, idat = Buffer.alloc(0)
      while (pos < d.length) {
        const len = d.readUInt32BE(pos); const typ = d.toString('ascii', pos + 4, pos + 8)
        if (typ === 'IHDR') { w = d.readUInt32BE(pos + 8); hh = d.readUInt32BE(pos + 12) }
        if (typ === 'IDAT') idat = Buffer.concat([idat, d.subarray(pos + 8, pos + 8 + len)])
        pos += 12 + len
      }
      const raw2 = zlib.inflateSync(idat)
      const stride = w * 4 + 1
      let sum = 0, sumSq = 0, n = 0
      for (let y = 0; y < hh; y += 4) {
        let prev = 0
        for (let x = 0; x < w; x += 4) {   // sparse sample; filters approximated by skipping filter byte rows conservatively
          const i = y * stride + 1 + x * 4
          if (i + 2 >= raw2.length) break
          const l = Math.max(raw2[i], raw2[i + 1], raw2[i + 2]); sum += l; sumSq += l * l; n++
          prev = l
        }
      }
      const mean = sum / Math.max(1, n)
      const varc = sumSq / Math.max(1, n) - mean * mean
      return { mean, sd: Math.sqrt(Math.max(0, varc)) }
    }
    console.log('\n═ VISUAL GATE (first) ═')
    let ok = true
    for (const [label, size] of [['portrait', '480x900'], ['wide', '1600x1000']]) {
      const out = `/tmp/visual-gate-${label}.png`
      try {
        execFileSync('node', ['scripts/world-tab-shot.mjs', playUrl, out, size, '14000'], { cwd: here + '/../web', timeout: 180000 })
        const j = judge(out)
        const pass = j.mean > 14 && j.sd > 8   // visible + non-uniform (not a blank/black wash)
        ok = ok && pass
        console.log(`  ${pass ? '✅' : '❌'} ${label} ${size}: lum ${j.mean.toFixed(1)} sd ${j.sd.toFixed(1)} → ${out}`)
      } catch (e) { ok = false; console.log(`  ❌ ${label}: capture failed — ${String(e.message).slice(0, 80)}`) }
    }
    results.push({ check: 'visual-gate', status: ok ? 'passed' : 'failed', environment: 'real-tab', details: ['portrait+wide real-tab shots judged for visible non-uniform content'] })
    if (!ok) { console.error('\nRED — the FIRST gate failed: the world is not visibly correct in a real tab. Nothing else was run.'); process.exit(1) }
  }
}

const mkSim = () => {
  let s = 7; const rand = () => (s = (s * 1664525 + 1013904223) >>> 0, s / 2 ** 32)
  const fields = new Map((raw.fields ?? []).map(f => [f.id, {
    id: f.id, name: f.name, shapeType: f.shapeType, w: f.w, h: f.h, radius: f.radius,
    transform: { ...(f.transform || {}) }, properties: { ...(f.properties || {}) },
  }]))
  return { rand, fields, worldData: { input: { moveX: 0, moveY: 0, pointer: {} } } }
}
const compiled = new Map()
for (const h of raw.stepHooks) {
  try { compiled.set(hookId(h), new Function('sim', 'dt', h.code)) }
  catch (e) { compiled.set(hookId(h), e) }
}

console.log('\n═ NODE-SIDE GREEN ═')
for (const id of nodes) {
  const fn = compiled.get(id)
  let status = 'passed', detail = ''
  if (typeof fn !== 'function') { status = 'failed'; detail = 'does not compile: ' + fn?.message }
  else {
    try { const solo = mkSim(); for (let i = 0; i < 10; i++) fn(solo, 1 / 60) }
    catch (e) { status = 'failed'; detail = 'throws ticking solo: ' + e.message }
  }
  results.push({ check: `node-green:${id}`, status, environment: 'dockstar-submit', details: detail ? [detail] : [] })
  console.log(`  ${status === 'passed' ? '✅' : '❌'} ${id}${detail ? '  (' + detail + ')' : ''}`)
}
// full spine, together
{
  const sim = mkSim(); let err = null
  try { for (let i = 0; i < 240; i++) for (const id of nodes) { const f = compiled.get(id); if (typeof f === 'function') f(sim, 1 / 60) } }
  catch (e) { err = e.message }
  console.log(`  ${err ? '❌' : '✅'} full spine ×240 ticks${err ? '  (' + err + ')' : ''}`)
  if (err) results.push({ check: 'node-green:spine', status: 'failed', environment: 'dockstar-submit', details: [err] })
}

// ── the eye: bright frame + probe movement → render/input evidence ──
const snap = shapeSnapshot(raw)
const probe = snap.worldData?.baseManifest?.probe || wd.probe || null
const r = await eye.renderLocal(snap, { input: probe?.drive, ticks: 240, trace: true, size: 256, inputStart: 1 })
const tr = r?.stateTrace ?? []
const key = probe?.moveKey
const vals = key ? tr.map(s2 => s2?.[key]).filter(v => typeof v === 'number') : []
const delta = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0
const bright = (r?.meanLum ?? 0) >= 18 && !(r?.errors ?? []).length && !(r?.hookErrors ?? []).length
console.log(`  ${bright ? '✅' : '❌'} eye: lum ${r?.meanLum} · errors ${(r?.errors ?? []).length} · hookErrors ${(r?.hookErrors ?? []).length}`)
results.push({ check: 'render-frame', status: bright ? 'passed' : 'failed', environment: 'local-eye', details: [`lum ${r?.meanLum}`] })
if (key) {
  const ok = delta >= (probe.minDelta ?? 20)
  console.log(`  ${ok ? '✅' : '❌'} probe: ${key} moved ${delta.toFixed(1)} (need ≥ ${probe.minDelta ?? 20})`)
  results.push({ check: 'input-response', status: ok ? 'passed' : 'failed', environment: 'playthrough', details: [`${key} Δ${delta.toFixed(1)}`] })
}

const anyRed = results.some(x => x.status === 'failed')
if (anyRed) { console.error('\nRED — fix the nodes above; nothing was submitted.'); process.exit(1) }

// ── submit evidence → complete → (publish) ──
const v = await c.bridgeSend([{ type: 'validate_world', results }])
const ev = (v.results || [])[0] || {}
console.log(`\nvalidate_world: stage ${ev.stage} · ready ${ev.ready} · outstanding ${(ev.outstanding || []).length}`)
const done = await c.bridgeSend([{ type: 'complete_build', results }])
const d = (done.results || [])[0] || {}
console.log(`complete_build: ${d.ok ? 'ok' : ''} ready ${d.ready}${d.refused ? ' — REFUSED: ' + (d.hint || '') : ''}`)
if (d.refused) process.exit(1)
if (PUBLISH) {
  const pub = await c.bridgeSend([{ type: 'publish_world' }])
  const p = (pub.results || [])[0] || {}
  console.log(`publish_world: ${p.ok ? 'PUBLISHED' : 'refused — ' + (p.error || JSON.stringify(p).slice(0, 200))}`)
  process.exit(p.ok ? 0 : 1)
}
console.log('\nALL GREEN — rerun with --publish to ship.')
process.exit(0)
