import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3000)
// tabs present?
const tabs = await p.evaluate(() => [...document.querySelectorAll('button')].map(x=>x.textContent?.trim()).filter(t=>/LIVE EDITING|FREE GAMES|PREMIUM|SEARCH/.test(t||'')))
console.log('TABS:', tabs.join(' · '))
// search tab filters
await p.click('button:has-text("⌕ SEARCH")'); await p.waitForTimeout(300)
await p.fill('input[placeholder="filter games…"]', 'star'); await p.waitForTimeout(300)
const filtered = await p.evaluate(() => [...document.querySelectorAll('button')].filter(x=>/STARFIELD|CINDERFELL/.test(x.textContent||'')).map(x=>x.textContent?.slice(0,12)))
console.log('SEARCH "star" →', JSON.stringify(filtered))
// ENGINE set: cup → ENGINE; frame yields the right strip; dock present
await p.click('[aria-label="ui selector"]'); await p.waitForTimeout(300)
await p.getByText('builderbox · connect your AI', { exact: false }).click(); await p.waitForTimeout(700)
const eng = await p.evaluate(() => {
  const cv = document.querySelector('canvas'); const r = cv.getBoundingClientRect()
  const dock = [...document.querySelectorAll('div')].some(d => /⚙ ENGINE/.test(d.textContent||'') && d.getBoundingClientRect().width < 300)
  return { canvasRight: Math.round(r.right), winW: window.innerWidth, dock }
})
console.log('ENGINE:', JSON.stringify(eng), eng.winW - eng.canvasRight > 200 ? '(frame yielded the strip ✓)' : '✗')
// BUILDERBOX cmd is REAL — the console panel opens
await p.click('button:has-text("⌁ BUILDERBOX")'); await p.waitForTimeout(1200)
const box = await p.evaluate(() => /BUILDERBOX|BUILD LOG|world chat/i.test(document.body.innerText))
console.log('BUILDERBOX panel opened:', box ? '✓' : '✗')
// CONNECT prompt overlay + copy
await p.click('button:has-text("⚿ CONNECT AI")'); await p.waitForTimeout(400)
const prompt = await p.evaluate(() => /Paste this into your working AI/.test(document.body.innerText))
console.log('CONNECT prompt overlay:', prompt ? '✓' : '✗')
// ACCOUNT tile exists in dockstar menu
await p.keyboard.press('Escape').catch(()=>{})
await p.evaluate(() => (document.querySelector('.fixed.z-\\[127\\]')));
await p.click('[aria-label="ui selector"]'); await p.waitForTimeout(300)
const acct = await p.evaluate(() => /ACCOUNT/.test(document.body.innerText) && /sign in · my worlds/.test(document.body.innerText))
console.log('ACCOUNT in dockstar menu:', acct ? '✓' : '✗')
await b.close(); console.log('ENGINE DOCK EYE COMPLETE')
