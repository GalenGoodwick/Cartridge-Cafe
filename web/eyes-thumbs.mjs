// eyes-thumbs — the Eye walks every world and brings back its face.
// Each bubble on the door shows a real screenshot of the world inside it.
// House worlds with living WGSL miniatures are skipped — animation beats stills.
// Run: node eyes-thumbs.mjs        (re-run any time worlds change)

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'public', 'thumbs')
mkdirSync(OUT, { recursive: true })

// these already have hand-built animated miniatures in the door shader
const STYLED = new Set(['FABRIC', 'ORRERY', 'GARNET', 'ONE DAY', 'SAIL', 'SOLSTICE', 'TIDERUNNER', 'SIGNAL'])

const [sc, sp] = await Promise.all([
  fetch('http://localhost:3000/api/engine/scene?action=list').then(r => r.json()),
  fetch('http://localhost:3000/api/spaces/browse').then(r => r.json()).catch(() => ({ spaces: [] })),
])
const targets = []
for (const n of sc.scenes || []) {
  if (n === 'CAFE' || n === 'SUB-MAIN' || n.includes(' ⑂ ') || STYLED.has(n)) continue
  targets.push({ name: n, url: 'http://localhost:3000/play/' + encodeURIComponent(n) })
}
for (const s of sp.spaces || []) {
  if (s.blank) continue
  targets.push({ name: (s.name || s.slug).toUpperCase(), url: 'http://localhost:3000/space/' + s.slug })
}
console.log('capturing', targets.length, 'worlds:', targets.map(t => t.name).join(' · '))

const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
for (const t of targets) {
  // desktop viewport: below 820px the SupportGate shows "bigger table" instead
  // of the world. Capture full-desktop, then crop the centered square down.
  const p = await b.newPage({ viewport: { width: 1100, height: 800 } })
  try {
    await p.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await p.waitForTimeout(7000)   // let the world wake up and settle
    const full = await p.screenshot({ type: 'png' })
    // center-crop to a square, then downscale to 160px — the door atlas only
    // samples 64px, so anything bigger is dead weight on first paint.
    const buf = await sharp(full)
      .extract({ left: (1100 - 800) / 2, top: 0, width: 800, height: 800 })
      .resize(160, 160, { fit: 'cover' }).jpeg({ quality: 78 }).toBuffer()
    writeFileSync(join(OUT, t.name + '.jpg'), buf)
    console.log('  ✓', t.name, (buf.length / 1024).toFixed(1) + 'KB')
  } catch (e) {
    console.log('  ✗', t.name, String(e).slice(0, 80))
  }
  await p.close()
}
await b.close()
console.log('faces stored in public/thumbs/')
