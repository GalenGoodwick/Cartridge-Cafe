// LOCAL EYE — render a live cartridge.cafe world on THIS Mac's Metal GPU and
// screenshot it. The cloud probe is software (lavapipe) and aborts on heavy
// worlds (tideglass, veilfire); headless Chrome with Metal-backed WebGPU renders
// the real thing. Usage: node local-eye.mjs <slug-or-url> [outPng] [waitMs]
import { chromium } from 'playwright'

const arg = process.argv[2] || 'tideglass'
const url = arg.startsWith('http') ? arg : `https://cartridge.cafe/space/${arg}`
const OUT = process.argv[3] || '/private/tmp/claude-501/-Users-galengoodwick/55534f81-29a9-435b-bb34-4d479e9edccf/scratchpad/eye.png'
const WAIT = Number(process.argv[4] || 9000)

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })

const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200)) })
page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)))

// capture the engine's own fault/quarantine signals + the gate verdict
await page.addInitScript(() => {
  window.__eye = { faults: [], gate: null }
  window.addEventListener('cc:fault', e => window.__eye.faults.push(e.detail?.kind + ': ' + (e.detail?.message || '').slice(0, 120)))
})

console.log('→', url)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(WAIT)

const meta = await page.evaluate(() => ({
  gateVerdict: window.__ccGate?.verdict ?? null,
  hasCanvas: !!document.querySelector('canvas'),
  faults: window.__eye?.faults ?? [],
}))

// The EYE. A WebGPU swapchain reads back BLACK via drawImage, so never sample the
// live canvas — screenshot it (the compositor has the real pixels) and analyse THAT.
const canvasEl = await page.$('canvas')
await page.screenshot({ path: OUT })
let stats = null
if (canvasEl) {
  const buf = await canvasEl.screenshot()
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64')
  stats = await page.evaluate(async (u) => {
    const img = new Image(); await new Promise(r => { img.onload = r; img.onerror = r; img.src = u })
    const w = 96, h = 72, c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    let lum = 0, lit = 0
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      lum += L; if (L > 12) lit++
    }
    const n = d.length / 4
    return { meanLum: +(lum / n).toFixed(1), coveragePct: +(100 * lit / n).toFixed(1), size: img.width + 'x' + img.height }
  }, dataUrl)
}
const report = { ...meta, stats }
await browser.close()

console.log(JSON.stringify({ url, ...report, consoleErrors: errors.slice(0, 8), png: OUT }, null, 2))
