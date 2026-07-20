#!/usr/bin/env node
// oracle.mjs — the eyes the headless daemon lacks.
//
// The build agent runs in a plain Node process: no GPU, no browser, so it never
// sees whether its shaders compile or its world renders. This launches a REAL
// headless Chrome with WebGPU, loads a world, and reports back what the AI can't
// see: compile errors, GPU faults, quarantines, a screenshot, and per-frame
// MOTION (so "everything is vibrating" becomes a measured fact, not a guess).
//
// Usage:
//   node oracle.mjs <url> [--frames N] [--shot path.png] [--json]
//   node oracle.mjs https://cartridge.cafe/space/stadium --frames 8

import { chromium } from 'playwright-core'
import sharp from 'sharp'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = process.argv.slice(2)
const url = args.find(a => !a.startsWith('--'))
if (!url) { console.error('usage: node oracle.mjs <url> [--frames N] [--shot path]'); process.exit(1) }
const nFrames = Number((args.find(a => a.startsWith('--frames=')) || '').split('=')[1]) ||
  (args.includes('--frames') ? Number(args[args.indexOf('--frames') + 1]) : 8)
const shot = (args.find(a => a.startsWith('--shot=')) || '').split('=')[1] ||
  (args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null)
const asJson = args.includes('--json')

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1000, height: 750 } })
const console_ = []
page.on('console', m => console_.push(m.text()))
page.on('pageerror', e => console_.push('PAGEERROR ' + e.message))

const report = { url, gpu: false, compiled: false, errors: [], quarantines: [], gpuLost: false, motion: null }
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)                    // load + compile + settle
  report.gpu = await page.evaluate(() => !!navigator.gpu)

  // per-frame MOTION: screenshot the canvas (the compositor captures WebGPU;
  // drawImage does not — the drawing buffer isn't preserved), decode to a tiny
  // grayscale grid with sharp, and read a ROW-BRIGHTNESS profile. If the whole
  // scene bounces vertically, the profile's centre-of-mass shifts frame to frame.
  const box = await page.evaluate(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })
  const profiles = []
  for (let f = 0; f < nFrames; f++) {
    const buf = await page.screenshot(box && box.width > 10 ? { clip: box } : {})
    const { data, info } = await sharp(buf).greyscale().resize(48, 96, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
    const rows = new Array(info.height).fill(0)
    for (let y = 0; y < info.height; y++) { let sum = 0; for (let x = 0; x < info.width; x++) sum += data[y * info.width + x]; rows[y] = sum }
    profiles.push(rows)
    await page.waitForTimeout(110)
  }
  // centre-of-mass per frame → vertical bounce amplitude (in 0..96 rows)
  if (profiles.length >= 2) {
    const com = profiles.map(r => { let s = 0, w = 0; for (let y = 0; y < r.length; y++) { s += y * r[y]; w += r[y] } return w ? s / w : 0 })
    const min = Math.min(...com), max = Math.max(...com)
    // frame-to-frame total pixel change (blank if content is static)
    const deltas = []
    for (let i = 1; i < profiles.length; i++) { let dd = 0; for (let y = 0; y < profiles[i].length; y++) dd += Math.abs(profiles[i][y] - profiles[i - 1][y]); deltas.push(dd) }
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length
    report.motion = { verticalBounceRows: +(max - min).toFixed(2), comSeries: com.map(v => +v.toFixed(1)), avgFrameDelta: Math.round(avgDelta) }
  }
} catch (e) {
  report.errors.push('NAV ' + e.message)
}

for (const l of console_) {
  if (/\[Super\] Pipeline compiled/i.test(l)) report.compiled = true
  if (/gpu.?lost|device.?lost/i.test(l)) report.gpuLost = true
  if (/\[quarantine\]|quarantined/i.test(l)) report.quarantines.push(l.slice(0, 160))
  if (/error|cannot read|undefined is not|failed to compile|WGSL/i.test(l) && !/401|Failed to load resource/i.test(l)) report.errors.push(l.slice(0, 200))
}
if (shot) await page.screenshot({ path: shot })
await browser.close()

if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0) }
console.log('ORACLE', url)
console.log('  gpu:', report.gpu, '| compiled:', report.compiled, '| gpu-lost:', report.gpuLost)
console.log('  errors:', report.errors.length ? report.errors.slice(0, 6) : 'none')
console.log('  quarantines:', report.quarantines.length ? report.quarantines : 'none')
if (report.motion) console.log('  MOTION: verticalBounce =', report.motion.verticalBounceRows, 'rows (of 96) | comSeries =', report.motion.comSeries.join(','), '| avgFrameDelta =', report.motion.avgFrameDelta)
