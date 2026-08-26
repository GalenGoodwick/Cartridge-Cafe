#!/usr/bin/env node
// THE UI-GRID EYE — one node, the whole loop (Galen, Aug 26: "you are
// splitting instead of thinking holistically — take the split code and write
// a node"). The scratch trio (DOM projection · solver proof · fit verdict)
// fused: ONE run sees REALITY (the live page's DOM chrome + canvas), solves
// the DECLARATION (the uiGrid doc), overlays both on one image, and computes
// the DELTA — which is, by definition, the remaining migration work.
//
//   node scripts/ui-grid-eye.mjs <url|slug> [outPng] [--doc path.json] [--wait ms]
//
// Output:
//   · <out>.png — live pixels + BLUE declared regions + AMBER measured DOM
//     chrome + RED same-layer overlaps, every box labeled with its data
//   · stdout JSON — the verdicts:
//       overlaps        declared same-layer collisions (ship gate: must be [])
//       gameFillPct     live canvas area / declared game region (pixels=game size?)
//       domOrphans      DOM chrome not inside ANY declared cafe region — the
//                       auto-derived migration TODO list
//       emptyRegions    declared regions with no DOM/canvas tenant yet
import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath, pathToFileURL } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')

// ── the SHIPPED solver, bundled at run (one truth — never a copy) ──
const tmp = mkdtempSync(join(tmpdir(), 'uigrid-'))
execFileSync(join(WEB, 'node_modules', '.bin', 'esbuild'),
  [join(WEB, 'src/app/engine/ui-grid.ts'), '--format=esm', `--outfile=${join(tmp, 'ui-grid.mjs')}`], { stdio: 'pipe' })
const { solveUiGrid, uiGridOverlaps } = await import(pathToFileURL(join(tmp, 'ui-grid.mjs')).href)

// ── args ──
const target = process.argv[2]
if (!target) { console.error('need <url|slug>'); process.exit(2) }
const url = target.startsWith('http') ? target : `https://cartridge.cafe/space/${target}`
const out = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'ui-grid-eye.png'
const argOf = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const waitMs = Number(argOf('--wait') || 14000)

// ── the DECLARATION: --doc file, or the platform default world-page doc ──
const DEFAULT_DOC = {
  regions: [
    { id: 'game.stage',       layer: 'game', anchor: { vx: [0, 1], vy: [0.055, 0.94] }, z: 0 },
    { id: 'chrome.topbar',    layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.055] },    z: 40 },
    { id: 'chrome.bottombar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.94, 1] },     z: 40 },
    { id: 'chrome.rail',      layer: 'cafe', anchor: { vx: [0.855, 1], vy: [0.055, 0.94] }, z: 41, when: { viewport: { minW: 700 } } },
    { id: 'console.builderbox', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.45, 1] }, z: 80, slip: { edge: 'bottom', trigger: 'console' } },
    { id: 'nav.site',           layer: 'cafe', anchor: { vx: [0, 0.7], vy: [0, 1] },  z: 81, slip: { edge: 'left', trigger: 'nav' } },
  ],
}
const doc = argOf('--doc') ? JSON.parse(readFileSync(argOf('--doc'), 'utf8')) : DEFAULT_DOC

// ── REALITY: load the live page, measure DOM chrome + canvas ──
const { chromium } = await import(pathToFileURL(join(WEB, 'node_modules', 'playwright', 'index.mjs')).href)
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(waitMs)

const reality = await page.evaluate(() => {
  const els = []
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const isCanvas = el.tagName === 'CANVAS'
    const fixedish = cs.position === 'fixed' || cs.position === 'absolute'
    if (!isCanvas && !fixedish && !el.hasAttribute('data-cc-chrome')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 12 || r.height < 12) continue
    // leaf-ish only: skip pure containers (a child with the same box carries the label)
    const label = (el.innerText || '').trim().split('\n')[0].slice(0, 26)
    if (!isCanvas && !label && el.children.length > 0) continue
    if (r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.95 && !isCanvas) continue  // page-size wrappers are noise
    els.push({ label: label || el.tagName.toLowerCase(), canvas: isCanvas,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      z: cs.zIndex === 'auto' ? 0 : Number(cs.zIndex) })
  }
  // dedupe identical boxes
  const m = new Map()
  for (const e of els) { const k = `${e.x},${e.y},${e.w},${e.h}`; if (!m.has(k) || e.label.length > m.get(k).label.length) m.set(k, e) }
  return { els: [...m.values()], win: { w: innerWidth, h: innerHeight } }
})

// ── the DECLARATION solved for THIS window ──
const state = { mode: 'view', role: 'visitor', worldState: 'done', window: reality.win }
const solved = solveUiGrid(doc, state)
const overlaps = uiGridOverlaps(doc, solved)

// ── THE DELTA — reality vs declaration ──
const gameRegions = solved.filter(r => r.layer === 'game')
const cafeRegions = solved.filter(r => r.layer === 'cafe')
const inside = (e, r) => e.x >= r.rect.x - 4 && e.y >= r.rect.y - 4 &&
  e.x + e.w <= r.rect.x + r.rect.w + 4 && e.y + e.h <= r.rect.y + r.rect.h + 4
const canvas = reality.els.filter(e => e.canvas).sort((a, b) => b.w * b.h - a.w * a.h)[0] || null
const chromeEls = reality.els.filter(e => !e.canvas)
const domOrphans = chromeEls.filter(e => !cafeRegions.some(r => inside(e, r)))
  .map(e => ({ label: e.label, at: `${e.x},${e.y} ${e.w}×${e.h}` }))
const emptyRegions = cafeRegions.filter(r => !r.slip && !chromeEls.some(e => inside(e, r))).map(r => r.id)
const gameArea = gameRegions.reduce((n, r) => n + r.rect.w * r.rect.h, 0)
const gameFillPct = canvas && gameArea ? Math.round(100 * (canvas.w * canvas.h) / gameArea) : 0

// ── ONE image: live pixels + declaration (blue/amber) + reality (pink) + red overlap zones ──
await page.evaluate(({ solved, chromeEls, canvasEl }) => {
  const cv = document.createElement('canvas')
  cv.width = innerWidth; cv.height = innerHeight
  cv.style.cssText = 'position:fixed;inset:0;z-index:999999;pointer-events:none'
  const g = cv.getContext('2d')
  g.font = '11px Menlo,monospace'
  const box = (x, y, w, h, col, tag, dash) => {
    g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash(dash ? [6, 4] : [])
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); g.setLineDash([])
    const tw = g.measureText(tag).width + 6
    g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(x, Math.max(0, y - 13), tw, 13)
    g.fillStyle = col; g.fillText(tag, x + 3, Math.max(10, y - 3))
  }
  for (const r of solved) box(r.rect.x, r.rect.y, r.rect.w, r.rect.h,
    r.layer === 'game' ? '#50c8ff' : '#ffbe3c', `⟨${r.id}⟩ z${r.z} ${r.rect.w}×${r.rect.h}`, true)
  for (const e of chromeEls) box(e.x, e.y, e.w, e.h, '#ff5ac8', `${e.label} z${e.z}`)
  if (canvasEl) box(canvasEl.x, canvasEl.y, canvasEl.w, canvasEl.h, '#7dffb0', `LIVE CANVAS ${canvasEl.w}×${canvasEl.h}`)
  document.body.appendChild(cv)
}, { solved, chromeEls, canvasEl: canvas })

await page.screenshot({ path: out })
await browser.close()

const verdict = {
  url, window: reality.win,
  overlap_gate: overlaps.length === 0 ? 'PASS' : overlaps,
  pixels_equals_game_size: gameFillPct >= 97 ? `YES (${gameFillPct}%)` : `NO — ${gameFillPct}% of declared game region`,
  dom_orphans: domOrphans,          // the migration TODO, auto-derived
  empty_regions: emptyRegions,      // declared homes awaiting tenants
  png: out,
}
console.log(JSON.stringify(verdict, null, 1))
