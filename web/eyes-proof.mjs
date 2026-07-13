// PROOF choreography: keep ONE live tab on the PROOF world and graft laws into it
// over HTTP between screenshots. The world never reloads — it accumulates law.
import { chromium } from 'playwright'

const TOKEN = 'engine-b81795bb76b3bdfc192da23275fce7e8'
const OUT = process.argv[2] || '/tmp'
const bridge = body => fetch('http://localhost:3000/api/engine/bridge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(body),
}).then(r => r.json())

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
await page.goto('http://localhost:3000/engine', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await page.getByText('PROOF', { exact: true }).first().click({ timeout: 5000 })
await page.waitForTimeout(4500)
await page.screenshot({ path: `${OUT}/proof-0-lawless.png` })
console.log('shot 0: lawless drift')

await bridge({ type: 'set_world_data', data: { __graft: { name: 'gravity-well', law: { type: 'attract', x: 170, y: 210, g: 65, desc: 'motes fall toward the well' } } } })
await page.waitForTimeout(5000)
await page.screenshot({ path: `${OUT}/proof-1-well.png` })
console.log('shot 1: + gravity-well')

await bridge({ type: 'set_world_data', data: { __graft: { name: 'east-wind', law: { type: 'wind', ax: 26, ay: -5, desc: 'a current carries everything east' } } } })
await page.waitForTimeout(2500)
await bridge({ type: 'set_world_data', data: { __graft: { name: 'the-hunter', law: { type: 'predator', speed: 75, desc: 'something red hunts the motes' } } } })
await page.waitForTimeout(4500)
await page.screenshot({ path: `${OUT}/proof-2-three-laws.png` })
console.log('shot 2: + east-wind + the-hunter (three laws superposed)')

await bridge({ type: 'set_world_data', data: { __ungraft: { name: 'gravity-well' } } })
await page.waitForTimeout(4500)
await page.screenshot({ path: `${OUT}/proof-3-well-repealed.png` })
console.log('shot 3: gravity-well repealed — wind and hunter remain')

await browser.close()
console.log('done — same running world, four constitutions')
