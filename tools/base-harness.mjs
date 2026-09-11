// BASE HARNESS (base-matrix P3) — the killer proof: for EVERY removable entry
// in a base's manifest, carve it (plus its declared dependents) out of a copy
// of the snapshot, then run the LOCAL eye with input + state trace and assert
// the world still WORKS: renders bright, hooks clean, input still answered.
// One green row per subsystem or the base does not ship.
//
//   node tools/base-harness.mjs <uc_st_token> [baseUrl] [proofDir]
//
// A carve here is snapshot surgery on a copy — exactly what a fork IS (a
// snapshot copy + hygiene) — so each row is the fork-and-remove experiment
// without minting worlds. Artifacts: per-row PNG + report JSON in proofDir.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const eye = await import(join(here, '../mcp/local-eye.mjs'))
const { makeClient } = await import(join(here, '../mcp/bridge-client.mjs'))
const { shapeSnapshot } = await import(join(here, '../mcp/probe-format.mjs'))

const TOKEN = process.argv[2]
const BASE = process.argv[3] || 'https://cartridge.cafe'
const PROOFS = process.argv[4] || join(here, '../proofs/base-harness')
if (!TOKEN) { console.error('usage: node tools/base-harness.mjs <uc_st_token> [baseUrl] [proofDir]'); process.exit(2) }

// ── carve: remove a set of manifest ids from a snapshot copy ──
function carve(snap, manifest, ids) {
  const gone = new Set(ids)
  const kindOf = new Map(manifest.entries.map(e => [e.id, e.kind]))
  const out = JSON.parse(JSON.stringify(snap))
  out.stepHooks = out.stepHooks.filter(h => !(gone.has(String(h.hookId ?? h.id)) && kindOf.get(String(h.hookId ?? h.id)) === 'hook'))
  out.fields = out.fields.filter(f => !(gone.has(String(f.id ?? f.name)) && kindOf.get(String(f.id ?? f.name)) === 'field'))
  out.visualTypes = out.visualTypes.filter(v => !(gone.has(String(v.name)) && kindOf.get(String(v.name)) === 'visual'))
  out.modules = (out.modules ?? []).filter(m => !(gone.has(String(m.name)) && kindOf.get(String(m.name)) === 'module'))
  return out
}

function carveSet(manifest, id) {
  const out = new Set([id]); let grew = true
  while (grew) { grew = false
    for (const e of manifest.entries) {
      if (out.has(e.id)) continue
      if ((e.deps ?? []).some(d => out.has(d))) { out.add(e.id); grew = true }
    } }
  return [...out]
}

// ── verdicts on an eye report ──
function judge(r, { needInput, probe }) {
  const fails = []
  if (!r || r.ok === false) fails.push('eye failed: ' + JSON.stringify(r?.errors ?? r?.error ?? 'unknown').slice(0, 120))
  if ((r?.errors ?? []).length) fails.push('compile errors: ' + JSON.stringify(r.errors).slice(0, 160))
  if ((r?.hookErrors ?? []).length) fails.push('hook errors: ' + JSON.stringify(r.hookErrors).slice(0, 160))
  if ((r?.meanLum ?? 0) < 18) fails.push(`too dark (meanLum ${r?.meanLum}) — never-dark law`)
  if ((r?.coveragePct ?? 0) < 60) fails.push(`coverage ${r?.coveragePct}% — world mostly blank`)
  if (needInput) {
    // STATE IS THE TRUTH (base-matrix law): the pixel-centroid inputReport
    // cannot see a small avatar move in a busy frame. The manifest declares
    // its probe: which traced key must move, and by how much, under the drive.
    const tr = r?.stateTrace ?? []
    if (probe?.moveKey && tr.length >= 2) {
      const vals = tr.map(s => s?.[probe.moveKey]).filter(v => typeof v === 'number')
      const delta = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0
      if (delta < (probe.minDelta ?? 20)) fails.push(`input dead: ${probe.moveKey} moved ${delta.toFixed(1)} < ${probe.minDelta ?? 20} under the drive`)
    } else if (r?.inputReport && r.inputReport.respondsToInput === false) {
      fails.push('no input response (pixel heuristic — declare manifest.probe for state truth)')
    }
  }
  if (!(r?.stateTrace ?? []).length) fails.push('no state trace — hooks not ticking')
  return fails
}

const DRIVE = [{ from: 0, to: 80, keys: ['d'] }, { from: 90, to: 110, keys: ['w'] }, { from: 120, to: 200, keys: ['a'] }]

async function main() {
  mkdirSync(PROOFS, { recursive: true })
  const c = makeClient({ base: BASE, token: TOKEN, timeoutMs: 120000 })
  const { text: body } = await c.bridgeGet()
  const snap = shapeSnapshot(JSON.parse(body))
  const manifest = snap.worldData?.baseManifest
  if (!manifest?.entries) { console.error('RED: world carries no worldData.baseManifest'); process.exit(1) }

  // ── P2: the manifest cannot lie about the snapshot (runtime twin of
  // web/src/lib/base-manifest.ts — keep the two in lockstep) ──
  const key = (k, id) => k + ':' + id
  const real = new Set([
    ...snap.stepHooks.map(h => key('hook', String(h.hookId ?? h.id))),
    ...snap.fields.map(f => key('field', String(f.id ?? f.name))),
    ...snap.visualTypes.map(v => key('visual', String(v.name))),
    ...(snap.modules ?? []).map(m => key('module', String(m.name))),
  ])
  const mapped = new Set(manifest.entries.map(e => key(e.kind, e.id)))
  const unmapped = [...real].filter(k => !mapped.has(k))
  const ghosts = [...mapped].filter(k => !real.has(k))
  console.log('\n═ P2 — manifest conformance ═')
  if (unmapped.length || ghosts.length) {
    for (const u of unmapped) console.log('  ❌ unmapped (in world, not in map):', u)
    for (const g of ghosts) console.log('  ❌ ghost (in map, not in world):', g)
    console.log('RED — the map lies; the base does not ship.')
    process.exit(1)
  }
  console.log(`  ✅ every piece mapped: ${manifest.entries.length} entries ↔ ${real.size} in the world · load-bearing: ${manifest.entries.filter(e => e.removable === 'load-bearing').length} · removable: ${manifest.entries.filter(e => e.removable === true).length}`)

  const rows = []
  const save = (name, r) => { if (r?.image) writeFileSync(join(PROOFS, name + '.png'), Buffer.from(r.image, 'base64')) }

  // Row 0: the INTACT base must pass everything first
  const probe = manifest.probe || null
  const drive = probe?.drive || DRIVE
  const full = await eye.renderLocal(snap, { input: drive, ticks: 220, trace: true, size: 256 })
  save('00-intact', full)
  const fullFails = judge(full, { needInput: true, probe })
  rows.push({ row: 'INTACT BASE', carved: [], pass: fullFails.length === 0, fails: fullFails, meanLum: full?.meanLum, trace: (full?.stateTrace ?? []).length })

  // One row per removable entry
  const removables = manifest.entries.filter(e => e.removable === true)
  for (const e of removables) {
    const ids = carveSet(manifest, e.id)
    const mod = carve(snap, manifest, ids)
    const r = await eye.renderLocal(mod, { input: drive, ticks: 220, trace: true, size: 256 })
    save('carve-' + e.id, r)
    const fails = judge(r, { needInput: true, probe })
    rows.push({ row: `carve ${e.id}`, carved: ids, pass: fails.length === 0, fails, meanLum: r?.meanLum, trace: (r?.stateTrace ?? []).length })
  }

  // Report
  const allPass = rows.every(r => r.pass)
  writeFileSync(join(PROOFS, 'report.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, rows }, null, 2))
  console.log('\n═ BASE HARNESS (P3) — carve-and-survive ═')
  for (const r of rows) {
    console.log(`${r.pass ? '  ✅' : '  ❌'} ${r.row.padEnd(20)} lum ${String(r.meanLum ?? '—').padStart(5)}  trace ${String(r.trace).padStart(3)}${r.carved.length > 1 ? '  (took: ' + r.carved.join(', ') + ')' : ''}`)
    for (const f of r.fails) console.log('       · ' + f)
  }
  console.log(allPass ? `\nALL GREEN — ${removables.length} subsystems carve clean. Proofs: ${PROOFS}` : '\nRED — the base does not ship.')
  process.exit(allPass ? 0 : 1)
}
main().catch(e => { console.error('harness crashed:', e.message); process.exit(2) })
