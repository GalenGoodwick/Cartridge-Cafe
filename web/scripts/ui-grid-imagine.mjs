#!/usr/bin/env node
// IMAGINE — the drag machinery driven by the AI's own placement map (Galen:
// "this is so YOU have an imaginative framework to transition this to what it
// needs to be"). Loads the live page, MOVES every real DOM percher to its
// imagined home (the same reparent-to-body mechanics as design-mode drag),
// and screenshots the result: the imagination as real pixels, gate-checked.
//
//   node scripts/ui-grid-imagine.mjs <url|slug> [outPng] [--wait ms]
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const target = process.argv[2] || 'base-mobile'
const url = target.startsWith('http') ? target : `https://cartridge.cafe/space/${target}`
const out = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'imagined.png'
const argOf = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const waitMs = Number(argOf('--wait') || 14000)

// ── THE IMAGINED PLACEMENT — what goes within what, sensically:
//    topbar = IDENTITY (◂ + title) left · DOCK right
//    right rail = SESSION (the PLAY/INSTRUCTIONS/EDIT stack), top
//    bottombar = CONSOLE trigger left (BUILDERBOX) · SOCIAL right (done: FOLLOW+SHARE)
const IMAGINATION = [
  { match: /^◂/,            slot: { vx: 0.004, vy: 0.006 },              note: 'identity: back, topbar far-left' },
  { match: /·\s*Galen|main · live/, slot: { vx: 0.045, vy: 0.006 },      note: 'identity: title beside back' },
  { match: /DOCK IN/,       slot: { vx: 0.86, vy: 0.008, alignRight: true }, note: 'membership: topbar right' },
  { match: /PLAY/,          slot: { vx: 0.995, vy: 0.08, alignRight: true }, note: 'session stack: rail top' },
  { match: /BUILDERBOX/,    slot: { vx: 0.004, vy: 0.995, alignBottom: true }, note: 'console trigger: bottombar left' },
]

const { chromium } = await import(pathToFileURL(join(WEB, 'node_modules', 'playwright', 'index.mjs')).href)
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(waitMs)

const moved = await page.evaluate((IM) => {
  const els = []
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (!(cs.position === 'fixed' || cs.position === 'absolute' || el.hasAttribute('data-cc-chrome'))) continue
    const r = el.getBoundingClientRect()
    if (r.width < 12 || r.height < 12 || r.width > innerWidth * 0.7 || r.height > innerHeight * 0.7) continue
    const label = (el.innerText || '').trim().split('\n')[0]
    if (!label) continue
    els.push({ el, label, r })
  }
  const done = []
  for (const rule of IM) {
    const re = new RegExp(rule.match)
    const cands = els.filter(e => re.test(e.label) && !done.some(d => d.el === e.el))
    const hit = cands.sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height)[0]   // SMALLEST match wins
    if (!hit) { done.push({ label: '(no match: ' + rule.match + ')', note: rule.note, el: null }); continue }
    const { el, r } = hit
    // the drag machinery, driven by imagination: reparent to body, place at slot
    const w = r.width, h = r.height
    el.style.width = w + 'px'
    document.body.appendChild(el)
    let x = rule.slot.vx * innerWidth
    if (rule.slot.alignRight) x -= w
    let y = rule.slot.vy * innerHeight
    if (rule.slot.alignBottom) y -= h
    el.style.position = 'fixed'
    el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px'
    el.style.right = 'auto'; el.style.bottom = 'auto'
    el.style.transform = 'none'; el.style.margin = '0'; el.style.zIndex = '70'
    done.push({ label: hit.label, note: rule.note, at: `${Math.round(x)},${Math.round(y)} ${Math.round(w)}×${Math.round(h)}`, el: null })
  }
  return done.map(d => ({ label: d.label, note: d.note, at: d.at }))
}, IMAGINATION.map(r => ({ ...r, match: r.match.source })))

await page.waitForTimeout(400)
await page.screenshot({ path: out })
await browser.close()
console.log(JSON.stringify({ moved, png: out }, null, 1))
