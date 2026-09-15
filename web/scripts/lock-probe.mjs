// pointer-lock path probe — WebKit (Safari engine): click the world, capture
// every [cafe] console line so we see WHICH branch of pointer-lock.ts fires.
import { webkit } from 'playwright'
const b = await webkit.launch()
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const logs = []
p.on('console', m => { const t = m.text(); if (/cafe|pointer|lock|fullscreen/i.test(t)) logs.push(t) })
await p.goto('https://cartridge.cafe/grid?w=space%3Aveilfire-3d&ui=games&ph=play', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6000)
try { await p.click('text=GOT IT', { timeout: 2000 }) } catch {}
try { await p.click('text=CLICK TO PLAY', { timeout: 4000 }) } catch {}
await p.waitForTimeout(5000)
// the deliberate in-world click that should engage the lock
const c = await p.$('canvas')
if (c) { const bb = await c.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2) }
await p.waitForTimeout(2500)
const locked = await p.evaluate(() => ({ locked: !!document.pointerLockElement, fs: !!document.fullscreenElement, mouseLook: true }))
console.log('STATE:', JSON.stringify(locked))
console.log('LOGS:'); for (const l of logs.slice(-12)) console.log(' ', l)
await b.close()
