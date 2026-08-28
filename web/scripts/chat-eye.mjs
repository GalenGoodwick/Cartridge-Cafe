import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid?ui=engine', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.click('button:has-text("◉ CHAT")'); await p.waitForTimeout(600)
const chat = await p.evaluate(() => ({
  room: /THE ROOM/.test(document.body.innerText),
  say: [...document.querySelectorAll('button')].some(x => x.textContent === 'SAY'),
  noAiMode: !/AI NETWORK|CONNECT.*chat|vantage/i.test(document.body.innerText),
}))
console.log('CHAT overlay:', JSON.stringify(chat))
// the bar stays live under the chat
const cupOk = await p.evaluate(() => {
  const cup = document.querySelector('[aria-label="ui selector"]')
  const r = cup.getBoundingClientRect()
  const el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)
  return el === cup || cup.contains(el)
})
console.log('bar live under chat:', cupOk ? '✓' : '✗')
// dockstar closes chat + opens menu
await p.click('[aria-label="ui selector"]'); await p.waitForTimeout(400)
const after = await p.evaluate(() => ({ chatGone: !/THE ROOM/.test(document.body.innerText), menu: /GAMES/.test(document.body.innerText) && /ACCOUNT/.test(document.body.innerText) }))
console.log('dockstar wins:', JSON.stringify(after), after.chatGone && after.menu ? '✓' : '✗')
// tools: ai console present (fresh engine load — the menu pick above changed sets)
await p.goto('http://localhost:3131/grid?ui=engine', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2000)
await p.click('button:has-text("⚙ WORLD TOOLS")'); await p.waitForTimeout(500)
console.log('tools = AI CONSOLE:', await p.evaluate(() => /◈ AI CONSOLE/.test(document.body.innerText) && !/ATTRIBUTION/.test(document.body.innerText)) ? '✓ (no attribution)' : '✗')
await b.close(); console.log('CHAT EYE COMPLETE')
