import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
await ctx.route('**/api/engine/player-icon', r => r.fulfill({ json: { icon: null, signedIn: false } }))
const T = (n, ok) => console.log(`${ok ? '✓' : '✗'} ${n}`)
const p = await ctx.newPage()
// MAIN URL carries no w
await p.goto('http://localhost:3000/grid?w=CINDERFELL&ui=main', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForSelector('[data-grid-commons]', { timeout: 30000 }); await p.waitForTimeout(2500)
T('MAIN URL drops ?w', await p.evaluate(() => !new URL(location.href).searchParams.get('w')))
// leave main → the parked game returns to the URL
await p.evaluate(() => document.querySelector('button[aria-label="ui selector"]')?.click()); await p.waitForTimeout(500)
await p.evaluate(() => { [...document.querySelectorAll('button')].find(x => /GAMES/.test(x.textContent) && x.textContent.includes('browse'))?.click() }); await p.waitForTimeout(800)
T('leaving MAIN restores ?w=CINDERFELL', await p.evaluate(() => new URL(location.href).searchParams.get('w') === 'CINDERFELL'))
// ?chat=1 arrival opens the commons
await p.goto('http://localhost:3000/grid?ui=main&chat=1', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
T('?chat=1 → commons window open (param cleaned)', await p.evaluate(() =>
  /THE COMMONS/.test(document.body.innerText) && !new URL(location.href).searchParams.get('chat')))
// dockstar layers OVER the commons and closing returns to it
await p.evaluate(() => document.querySelector('button[aria-label="ui selector"]')?.click()); await p.waitForTimeout(500)
const layered = await p.evaluate(() => ({
  menu: document.body.innerText.includes('CARTRIDGE.CAFE') || !!document.querySelector('.cafe-sign'),
  commonsStill: /THE COMMONS/.test(document.body.innerText),
}))
await p.evaluate(() => document.querySelector('button[aria-label="ui selector"]')?.click()); await p.waitForTimeout(400)
T('dockstar menu layers over commons (commons survives)', layered.menu && layered.commonsStill &&
  await p.evaluate(() => /THE COMMONS — THE ROOM|THE COMMONS/.test(document.body.innerText)))
await b.close(); console.log('MAIN POLISH EYE COMPLETE')
