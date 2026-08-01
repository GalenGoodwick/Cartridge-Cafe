const PORT = 9222
let tgt; for (let i = 0; i < 30; i++) { try { const l = await (await fetch(`http://localhost:${PORT}/json/list`)).json(); tgt = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (tgt) break } catch (_) {} await new Promise(r => setTimeout(r, 300)) }
const ws = new WebSocket(tgt.webSocketDebuggerUrl); let id = 0; const pend = new Map()
const send = (m, p = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p })) })
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id) } }
await new Promise(r => { ws.onopen = r })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const mouse = (type, x, y, b) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: b })
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); Deno.writeFileSync(`/tmp/yard-${n}.png`, Uint8Array.from(atob(r.data), c => c.charCodeAt(0))) }
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'https://cartridge.cafe/space/pentarch' })
await sleep(9000)
await send('Runtime.evaluate', { expression: `(()=>{const b=[...document.querySelectorAll('button,div,span')].find(e=>/\\bPLAY\\b/.test((e.textContent||'').trim())&&(e.textContent||'').trim().length<12);if(b)b.click();return !!b})()` })
await sleep(2000)
// canvas geometry: world uv → page px. Canvas is square, centered; find it
const rect = (await send('Runtime.evaluate', { expression: `(()=>{const c=document.querySelector('canvas');const r=c.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`, returnByValue: true })).result.value
const R = JSON.parse(rect)
const px = (ux, uy) => ({ x: R.x + (ux + 1) / 2 * R.w, y: R.y + (uy + 1) / 2 * R.h })
const clickUV = async (ux, uy) => { const p = px(ux, uy); await mouse('mouseMoved', p.x, p.y, 0); await sleep(400); await mouse('mousePressed', p.x, p.y, 1); await sleep(90); await mouse('mouseReleased', p.x, p.y, 0); await sleep(400) }
// 1) hover right of the base tile → ghost
const h = px(0.24, 0)
await mouse('mouseMoved', h.x, h.y, 0); await sleep(900); await shot('ghost')
// 2) click the ghost → blank appears (selected)
await clickUV(0.24, 0)
// 3) set it to GUN via palette (3rd pentagon at x=0.0, y=0.86)
await clickUV(0.0, 0.86)
// 4) grow two more: hover+click further edges
await clickUV(0.42, -0.14)
await clickUV(0.28, -0.34)
// set ENGINE on the latest
await clickUV(0.26, 0.86)
await sleep(600); await shot('grown')
console.log('done')
ws.close()
