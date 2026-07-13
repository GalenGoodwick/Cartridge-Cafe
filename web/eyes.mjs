// EYES — headless browser, WebGPU on, load a scene, screenshot the actual render.
// Usage: node eyes.mjs <sceneName> <outPath> [waitMs]
import { chromium } from 'playwright'

const [scene, out, waitMs] = [process.argv[2] || 'ESPER', process.argv[3] || '/tmp/eyes.png', +(process.argv[4] || 6000)]

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-dawn-features=allow_unsafe_apis'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
page.on('console', m => { const t = m.text(); if (/QUARANTIN|error|Error|WebGPU|GPU/i.test(t)) console.log('[console]', t.slice(0, 220)) })
await page.goto('http://localhost:3000/engine', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)

// click the scene tab by its visible name
try {
  await page.getByText(scene, { exact: true }).first().click({ timeout: 5000 })
  console.log(`clicked scene tab "${scene}"`)
} catch {
  console.log(`could not find scene tab "${scene}" — screenshotting whatever is up`)
}
await page.waitForTimeout(waitMs)
await page.screenshot({ path: out })
console.log('screenshot →', out)
await browser.close()
