#!/usr/bin/env node
// THE CODIFIER — the owner's drags become declarations (Galen: "design mode
// toggles me clicking and dragging elements so I can show you what I want").
// Reads worldData.chrome_placement (written by design-mode drops, synced by
// the owner tab), divides each drop rect by ITS recorded window, and emits
// vx/vy BAND declarations — the human's absolute gesture generalized to every
// viewport. Output is a REVIEWABLE patch for ui-grid-doc.ts, never an auto-edit.
//
//   node scripts/ui-grid-codify.mjs --key uc_st_… [--pad 0.008]
import { execFileSync } from 'child_process'

const argOf = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const key = argOf('--key')
if (!key) { console.error('need --key <uc_st_ world key>'); process.exit(2) }
const pad = Number(argOf('--pad') || 0.008)
const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'

const st = await fetch(`${BASE}/api/engine/bridge`, { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json())
const placement = st?.worldData?.chrome_placement
if (!placement || typeof placement !== 'object' || !Object.keys(placement).length) {
  console.log(JSON.stringify({ drops: 0, note: 'no chrome_placement yet — the owner has not dragged (design mode → drag → drops persist)' }, null, 1))
  process.exit(0)
}

const r3 = (v) => Math.round(v * 1000) / 1000
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const regions = []
for (const [label, p] of Object.entries(placement)) {
  const d = p
  if (!d || typeof d.x !== 'number' || !d.win?.w) continue
  const vx0 = clamp01(d.x / d.win.w - pad), vx1 = clamp01((d.x + d.w) / d.win.w + pad)
  const vy0 = clamp01(d.y / d.win.h - pad), vy1 = clamp01((d.y + d.h) / d.win.h + pad)
  regions.push({
    label,
    at: new Date(d.at || 0).toISOString(),
    absolute: { x: d.x, y: d.y, w: d.w, h: d.h, window: d.win },
    band: { vx: [r3(vx0), r3(vx1)], vy: [r3(vy0), r3(vy1)] },
    declaration: {
      id: 'chrome.' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24),
      layer: 'cafe',
      anchor: { vx: [r3(vx0), r3(vx1)], vy: [r3(vy0), r3(vy1)] },
      z: 41,
    },
  })
}

// gate the imagined layout before proposing it — never hand back a colliding design
let gate = 'not checked'
try {
  const { mkdtempSync } = await import('fs')
  const { join, dirname } = await import('path')
  const { tmpdir } = await import('os')
  const { fileURLToPath, pathToFileURL } = await import('url')
  const HERE = dirname(fileURLToPath(import.meta.url))
  const tmp = mkdtempSync(join(tmpdir(), 'codify-'))
  execFileSync(join(HERE, '..', 'node_modules', '.bin', 'esbuild'),
    [join(HERE, '..', 'src/app/engine/ui-grid.ts'), '--format=esm', `--outfile=${join(tmp, 'ui-grid.mjs')}`], { stdio: 'pipe' })
  const { solveUiGrid, uiGridOverlaps } = await import(pathToFileURL(join(tmp, 'ui-grid.mjs')).href)
  const doc = { regions: regions.map(r => r.declaration) }
  const win = regions[0].absolute.window
  const solved = solveUiGrid(doc, { mode: 'view', role: 'visitor', worldState: 'done', window: { w: win.w, h: win.h } })
  const overlaps = uiGridOverlaps(doc, solved)
  gate = overlaps.length === 0 ? 'PASS — the dragged layout is collision-free' : overlaps
} catch { /* gate best-effort */ }

console.log(JSON.stringify({
  drops: regions.length,
  overlap_gate: gate,
  codified: regions,
  apply: 'review the declarations above → merge the bands into ui-grid-doc.ts (tenant regions), ship, eye-verify',
}, null, 1))
