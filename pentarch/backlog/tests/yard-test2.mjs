const clicks = JSON.parse(Deno.readTextFileSync('/tmp/yard-clicks.json'))
let tgt; for (let i = 0; i < 30; i++) { try { const l = await (await fetch('http://localhost:9222/json/list')).json(); tgt = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (tgt) break } catch (_) {} await new Promise(r => setTimeout(r, 300)) }
const ws = new WebSocket(tgt.webSocketDebuggerUrl); let id = 0; const pend = new Map()
const send = (m, p = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p })) })
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id) } }
await new Promise(r => { ws.onopen = r })
const sleep = ms => new Promise(r => setTimeout(r, ms))
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'https://cartridge.cafe/space/pentarch' })
await sleep(9000)
await send('Runtime.evaluate', { expression: `(()=>{const b=[...document.querySelectorAll('button,div,span')].find(e=>/\\bPLAY\\b/.test((e.textContent||'').trim())&&(e.textContent||'').trim().length<12);if(b)b.click();return !!b})()` })
await sleep(2000)
const rect = JSON.parse((await send('Runtime.evaluate', { expression: `(()=>{const c=document.querySelector('canvas');const r=c.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`, returnByValue: true })).result.value)
// uv maps onto the CENTERED SQUARE of the canvas (the engine letterboxes)
const side = Math.min(rect.w, rect.h), cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2
const px = (ux, uy) => ({ x: cx + ux * side / 2, y: cy + uy * side / 2 })
const mouse = (type, x, y, b) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: b })
for (const [ux, uy] of clicks) {
  const p = px(ux, uy)
  await mouse('mouseMoved', p.x, p.y, 0); await sleep(350)
  await mouse('mousePressed', p.x, p.y, 1); await sleep(80); await mouse('mouseReleased', p.x, p.y, 0); await sleep(350)
}
await sleep(600)
const r = await send('Page.captureScreenshot', { format: 'png' })
Deno.writeFileSync('/tmp/yard-final.png', Uint8Array.from(atob(r.data), c => c.charCodeAt(0)))
console.log('done — /tmp/yard-final.png')
ws.close()
