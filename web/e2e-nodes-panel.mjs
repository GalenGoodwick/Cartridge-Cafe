// eye: the ⬢ NODES dock panel (rung 4). Seed a world with a held hook node
// (2 revs + a bad one), a shader node, and a feed → owner opens the panel,
// sees the roster, expands, REVERTS v1 → server snapshot actually reverts.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { encode } from 'next-auth/jwt'
import { chromium } from 'playwright'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'
const SHOT = '/private/tmp/claude-501/-Users-galengoodwick/e3a3eea1-70f6-4618-9bf9-e748009eec87/scratchpad'

const gal = await prisma.user.findUnique({ where: { email: 'galen.goodwick@gmail.com' } })
const token = await encode({ token: { sub: gal.id, id: gal.id, email: 'galen.goodwick@gmail.com', name: 'Galen' }, secret: process.env.NEXTAUTH_SECRET })
const cookie = { name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/' }

const now = Date.now()
const world = await prisma.playerSpace.create({ data: {
  slug: 'e2e-nodes-panel', name: 'E2E NODES PANEL', ownerId: gal.id, isPublic: false,
  snapshot: {
    fields: [], interactionRules: [], interactionEffects: [], modules: [],
    visualTypes: [{ name: 'aurora', wgsl: 'fn v2() {}' }],
    stepHooks: [{ id: 'physics', author: 'crew-ai', description: '', code: 'sim.p = 2' }],
    worldData: {
      __nodes: { physics: { id: 'physics', rev: 3, holder: 'f'.repeat(16), heldAt: now - 60_000 } },
      __nodeHist: {
        physics: [
          { rev: 1, code: 'sim.p = 1', at: now - 3600_000, by: 'crew-ai-hash', note: 'first tide' },
          { rev: 2, code: 'sim.p = "broken"', at: now - 1800_000, by: 'crew-ai-hash', bad: true },
          { rev: 3, code: 'sim.p = 2', at: now - 60_000, by: 'crew-ai-hash', note: 'v3 live' },
        ],
        'visual:aurora': [
          { rev: 1, code: 'fn v1() {}', at: now - 3600_000, by: 'crew-ai-hash' },
          { rev: 2, code: 'fn v2() {}', at: now - 60_000, by: 'crew-ai-hash' },
        ],
      },
    },
  },
} })
// a feed line for physics (EngineSlot is the game-slot table)
await prisma.engineSlot.upsert({
  where: { slot: 'nodefeed:' + world.id + ':physics' },
  create: { slot: 'nodefeed:' + world.id + ':physics', data: [{ at: now - 50_000, by: 'crew-ai-hash', kind: 'undock', text: 'submitted: tide pull v3' }] },
  update: { data: [{ at: now - 50_000, by: 'crew-ai-hash', kind: 'undock', text: 'submitted: tide pull v3' }] },
}).catch(e => console.log('feed seed failed:', e.message?.slice(0, 80)))

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addCookies([cookie])
const page = await ctx.newPage()
await page.goto(`${BASE}/space/${world.slug}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
await page.getByRole('button', { name: /✎ EDIT/ }).click({ timeout: 15000 })
await page.waitForTimeout(600)
const gotIt = page.getByRole('button', { name: /GOT IT/ })
if (await gotIt.isVisible().catch(() => false)) { await gotIt.click(); await page.waitForTimeout(300) }
const nodesBtn = page.getByRole('button', { name: '⬢ NODES' })
console.log(`NODES button: ${await nodesBtn.isVisible().catch(() => false) ? '✓' : 'FAIL'}`)
await nodesBtn.click()
await page.waitForTimeout(1200)
const body = await page.textContent('body')
console.log(`roster shows physics: ${body.includes('physics') ? '✓' : 'FAIL'}`)
console.log(`roster shows visual:aurora: ${body.includes('visual:aurora') ? '✓' : 'FAIL'}`)
console.log(`hold chip HELD: ${body.includes('HELD') ? '✓' : 'FAIL'}`)
await page.getByRole('button', { name: /physics/ }).first().click()
await page.waitForTimeout(800)
const body2 = await page.textContent('body')
console.log(`history: bad rev marked: ${body2.includes('marked bad') ? '✓' : 'FAIL'}`)
console.log(`feed line: ${body2.includes('tide pull v3') ? '✓' : '(feed slot may not have written)'}`)
await page.screenshot({ path: `${SHOT}/nodes-panel.png` })
// REVERT v1
const revertBtns = page.getByRole('button', { name: /↩ revert/ })
const nRev = await revertBtns.count()
console.log(`revert buttons: ${nRev >= 1 ? '✓ ' + nRev : 'FAIL 0'}`)
if (nRev) {
  await revertBtns.first().click()
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${SHOT}/nodes-panel-reverted.png` })
}
await browser.close()

const after = await prisma.playerSpace.findUnique({ where: { id: world.id }, select: { snapshot: true } })
const hook = after.snapshot.stepHooks.find(h => h.id === 'physics')
console.log(`server code reverted to v1: ${hook?.code === 'sim.p = 1' ? '✓' : 'FAIL — ' + hook?.code}`)
const hist = after.snapshot.worldData.__nodeHist.physics
console.log(`history append-only (revert landed forward): ${hist.length >= 4 ? '✓ ' + hist.length + ' revs' : 'FAIL ' + hist.length}`)

await prisma.playerSpace.delete({ where: { id: world.id } })
console.log('cleaned')
await prisma.$disconnect(); await pool.end()
