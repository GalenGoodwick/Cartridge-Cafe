import { config } from 'dotenv'
config({ path: '.env.local' })
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { encode } from 'next-auth/jwt'
const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const gal = await prisma.user.findUnique({ where: { email: 'galen.goodwick@gmail.com' } })
const jwt = await encode({ token: { sub: gal.id, id: gal.id, email: 'galen.goodwick@gmail.com', name: 'Galen' }, secret: process.env.NEXTAUTH_SECRET })
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'] })
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } })
await ctx.addCookies([{ name: 'next-auth.session-token', value: jwt, domain: 'localhost', path: '/' }])
const page = await ctx.newPage()
page.on('websocket', ws => console.log('WS →', ws.url()))
page.on('console', m => { const t = m.text(); if (/arena|error|joined|state/i.test(t)) console.log('console:', t.slice(0, 160)) })
await page.goto('http://localhost:3000/space/base-platformer-2d?room=dbg', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
const snap = await page.evaluate(async () => {
  const r = await fetch('/api/spaces/e2e-arena-ground/snapshot').catch(() => null)
  if (!r || !r.ok) return 'no snapshot route'
  const d = await r.json().catch(() => null)
  const wd = d?.snapshot?.worldData ?? d?.worldData
  return wd ? { mpManifest: wd.mpManifest, arenaUrl: wd.arenaUrl, keys: Object.keys(wd).slice(0, 20) } : 'no wd'
})
console.log('tab-visible worldData:', JSON.stringify(snap).slice(0, 300))
await browser.close()
await prisma.$disconnect(); await pool.end()
