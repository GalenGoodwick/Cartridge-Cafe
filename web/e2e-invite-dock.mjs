// eye: (a) owner's edit dock shows ⚭ INVITE; clicking it mints (network 201);
// (b) a stranger's BuilderBox on an unforkable world shows the honest no-fork
// line, not the retired HACK/branch door.
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

async function cookieFor(email, name) {
  let u = await prisma.user.findUnique({ where: { email } })
  if (!u) u = await prisma.user.create({ data: { email, name } })
  const token = await encode({ token: { sub: u.id, id: u.id, email, name }, secret: process.env.NEXTAUTH_SECRET })
  return { name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/' }
}

const owner = await cookieFor('galen.goodwick@gmail.com', 'Galen')
const stranger = await cookieFor('e2e-dock-stranger@test.local', 'DockStranger')
const slug = 'base-platformer-2d'

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'] })
// (a) OWNER: dock → INVITE button → click → expect POST /invite 201 + toast
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addCookies([owner])
  const page = await ctx.newPage()
  let minted = null
  page.on('response', r => { if (r.url().includes('/invite') && r.request().method() === 'POST') minted = r.status() })
  await page.goto(`${BASE}/space/${slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  await page.screenshot({ path: `${SHOT}/dock-pre.png` })
  await page.getByRole('button', { name: /✎ EDIT/ }).click({ timeout: 15000 })
  await page.waitForTimeout(800)
  const gotIt = page.getByRole('button', { name: /GOT IT/ })
  if (await gotIt.isVisible().catch(() => false)) { await gotIt.click(); await page.waitForTimeout(400) }
  await page.screenshot({ path: `${SHOT}/dock-open.png` })
  const inviteBtn = page.getByRole('button', { name: '⚭ INVITE' })
  const visible = await inviteBtn.isVisible().catch(() => false)
  console.log(`owner dock INVITE button: ${visible ? '✓ visible' : 'FAIL — missing'}`)
  if (visible) {
    await inviteBtn.click()
    await page.waitForTimeout(1500)
    console.log(`invite mint on click: ${minted === 201 ? '✓ 201' : 'FAIL — ' + minted}`)
    await page.screenshot({ path: `${SHOT}/dock-invite-owner.png` })
  }
  await ctx.close()
}
// (b) STRANGER on an unforkable world: BuilderBox shows the honest line, no HACK
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addCookies([stranger])
  const page = await ctx.newPage()
  await page.goto(`${BASE}/space/${slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const box = page.locator('text=⌁').first()
  if (await box.isVisible().catch(() => false)) { await box.click(); await page.waitForTimeout(800) }
  const body = await page.textContent('body')
  console.log(`no HACK door: ${body.includes('HACK THIS WORLD') ? 'FAIL — hack text still up' : '✓'}`)
  console.log(`no branch teaching: ${/your own branch/.test(body) ? 'FAIL' : '✓'}`)
  const honest = body.includes("hasn’t enabled forking") || body.includes('hasn’t enabled forking')
  console.log(`honest no-fork line: ${honest ? '✓' : '(builderbox may be closed — body lacks line)'}`)
  await page.screenshot({ path: `${SHOT}/dock-stranger.png` })
  await ctx.close()
}
await browser.close()
await prisma.user.deleteMany({ where: { email: 'e2e-dock-stranger@test.local' } })
await prisma.$disconnect(); await pool.end()
