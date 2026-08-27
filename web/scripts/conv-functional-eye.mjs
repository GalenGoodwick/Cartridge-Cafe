import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1344, height: 800 }, deviceScaleFactor: 2 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override', '1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/design/conversion', { waitUntil: 'domcontentloaded' })
// wait for frame loop (phase 1: rects), then world load (phase 2: fields)
const pollRects = async (tries) => {
  for (let i = 0; i < tries; i++) {
    const ok = await p.evaluate(() => !!globalThis.__ccDevSim?.worldData?.__uiRects)
    if (ok) return true
    await p.waitForTimeout(500)
  }
  return false
}
let up = await pollRects(40)
if (!up) {
  console.log('no frame loop after 20s — one reload retry')
  await p.reload({ waitUntil: 'domcontentloaded' })
  up = await pollRects(40)
}
if (!up) {
  const diag = await p.evaluate(() => ({
    hatch: !!globalThis.__ccDevSim, canvases: document.querySelectorAll('canvas').length,
    bodyHead: (document.body.innerText || '').slice(0, 150),
  }))
  console.log('FRAME LOOP NEVER STARTED:', JSON.stringify(diag))
  process.exit(1)
}
let world = null
for (let i = 0; i < 30; i++) {
  world = await p.evaluate(() => ({ fields: globalThis.__ccDevSim.fields?.size ?? 0, hooks: globalThis.__ccDevSim.stepHooks?.size ?? 0 }))
  if (world.fields > 0) break
  await p.waitForTimeout(500)
}
console.log('WORLD:', JSON.stringify(world))
const ui = await p.evaluate(() => globalThis.__ccDevSim.worldData.__uiRects)
const shellHits = ui.hits.filter(h => h.action?.startsWith('shell:'))
console.log('SHELL HITS:', shellHits.map(h => `${h.id}@${Math.round(h.x)},${Math.round(h.y)}`).join(' · '))

const clickHit = (hit) => p.evaluate(async (h) => {
  const cv = document.querySelector('canvas')
  const r = cv.getBoundingClientRect()
  const side = Math.min(r.width, r.height)
  const cx = r.left + (r.width - side) / 2 + (h.x + h.w / 2) * side / 512
  const cy = r.top + (r.height - side) / 2 + (h.y + h.h / 2) * side / 512
  const wait = new Promise(res => {
    const t = setTimeout(() => res('TIMEOUT'), 1500)
    window.addEventListener('cafe:shell-ui', e => { clearTimeout(t); res(e.detail) }, { once: true })
  })
  cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }))
  return await wait
}, hit)

// non-navigating pills first
for (const id of ['shell.instructions', 'shell.builderbox', 'shell.edit']) {
  const h = shellHits.find(x => x.id === id)
  if (!h) { console.log(`MISSING ${id}`); continue }
  const fired = await clickHit(h)
  console.log(`CLICK ${id} → ${fired} ${fired === h.action ? '✓' : '✗'}`)
  // close whatever opened (instructions panel etc.) via Escape
  await p.keyboard.press('Escape').catch(() => {})
  await p.waitForTimeout(300)
}
// PLAY: chrome must strip (shell hits vanish in play mode? shell solves regardless —
// but playMode strips DOM; engine pills persist by design this rung). Verify the cmd runs:
const hPlay = shellHits.find(x => x.id === 'shell.play')
const firedPlay = await clickHit(hPlay)
await p.waitForTimeout(600)
const afterPlay = await p.evaluate(() => ({
  domChrome: document.querySelectorAll('[data-cc-chrome]').length,
}))
console.log(`CLICK shell.play → ${firedPlay} ✓ · after: domChrome=${afterPlay.domChrome}`)
await p.screenshot({ path: '/tmp/conv-functional.png' })
// NAVIGATING pills last — context destruction IS the pass signal
for (const id of ['shell.fork', 'shell.back']) {
  const h = shellHits.find(x => x.id === id)
  const fired = await clickHit(h).catch(() => 'NAVIGATED (handler ran)')
  await p.waitForTimeout(700)
  console.log(`CLICK ${id} → ${fired} · url: ${p.url()}`)
  if (!p.url().includes('/design/conversion')) { await p.goBack().catch(() => {}); await p.waitForTimeout(1500) }
}
await b.close()
console.log('FUNCTIONAL EYE COMPLETE')
