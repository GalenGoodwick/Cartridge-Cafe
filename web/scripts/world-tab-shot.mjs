// WORLD TAB SHOT — photograph what a REAL browser tab shows for any world at
// any window size (the viewport-scope instrument; same playwright+WebGPU
// pattern as the *-tab-eye family). Usage:
//   node scripts/world-tab-shot.mjs <url> <out.png> [WxH] [waitMs]
import { chromium } from 'playwright'
const [url, out, size = '1600x1000', wait = '12000'] = process.argv.slice(2)
if (!url || !out) { console.error('usage: node scripts/world-tab-shot.mjs <url> <out.png> [WxH] [waitMs]'); process.exit(2) }
const [width, height] = size.split('x').map(Number)
// --headed: swiftshader has no WebGPU — a REAL Chrome window (Metal) for the
// seconds of capture is the only honest eye on this machine
const HEADED = process.argv.includes('--headed')
const b = await chromium.launch(HEADED
  ? { headless: false, channel: 'chrome', args: ['--enable-unsafe-webgpu', '--window-position=40,40'] }
  : { args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
const p = await ctx.newPage()
// the error channel the bridge doesn't have yet (#16): every console line
p.on('console', m => { const t = m.text(); if (/error|fail|wgsl|shader|tint|compil/i.test(t)) console.log('[console]', t.slice(0, 500)) })
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))
await p.goto(url, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(4000)
// THE FRONT DOOR (the blind-instrument lesson): dismiss consent, enter play,
// and PROVE the canvas is alive before any judgment — a capture that never
// entered the world must say so, not pose as a verdict.
try { await p.click('text=GOT IT', { timeout: 2500 }) } catch {}
try { await p.click('text=CLICK TO PLAY', { timeout: 4000 }) } catch {}
await p.waitForTimeout(Number(wait))
const alive = await p.evaluate(() => {
  const c = document.querySelector('canvas')
  if (!c) return { ok: false, why: 'no canvas' }
  try {
    const s2 = document.createElement('canvas'); s2.width = 64; s2.height = 64
    const g = s2.getContext('2d'); g.drawImage(c, 0, 0, 64, 64)
    const d = g.getImageData(0, 0, 64, 64).data
    let sum = 0; for (let i = 0; i < d.length; i += 4) sum += Math.max(d[i], d[i + 1], d[i + 2])
    return { ok: sum / (d.length / 4) > 10, mean: +(sum / (d.length / 4)).toFixed(1) }
  } catch (e) { return { ok: false, why: 'canvas unreadable: ' + e.message } }
})
await p.screenshot({ path: out })
await b.close()
console.log('captured', out, `${width}x${height}`, '| canvas', JSON.stringify(alive))
if (!alive.ok) { console.error('BLIND CAPTURE — the world never rendered in this tab; no judgment may rest on this frame.'); process.exit(3) }
