// push the panorama player hook with the durable dev-deploy identity
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import crypto from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const w = await prisma.playerSpace.findUnique({ where: { slug: 'e2e-territory' }, select: { id: true } })
await prisma.engineSlot.deleteMany({ where: { slot: 'build-lock:' + w.id } })

// ONE durable deploy identity (the node-gate lesson: a fresh token per script
// makes you a stranger to your own held nodes)
const KEYFILE = '.dev-deploy-key'
let raw
if (existsSync(KEYFILE)) raw = readFileSync(KEYFILE, 'utf-8').trim()
else { raw = 'uc_st_' + crypto.randomBytes(16).toString('hex'); writeFileSync(KEYFILE, raw) }
const hash = crypto.createHash('sha256').update(raw).digest('hex')
const exists = await prisma.spaceToken.findUnique({ where: { tokenHash: hash } })
if (!exists) await prisma.spaceToken.create({ data: { name: 'dev-deploy', spaceId: w.id, tokenHash: hash, tokenPrefix: raw.slice(0, 12) + '...' } })

const PLAYER = `// player — journey the 2048×768 panorama
const wd = sim.worldData
if (!wd.__tj2) { wd.__tj2 = { x: 300, y: 384 } }
const G = wd.__tj2
const step = Math.min(dt, 1/30)
const SP = 520
G.x += (((wd.key_d||wd.key_arrowright)?1:0) - ((wd.key_a||wd.key_arrowleft)?1:0)) * SP * step
G.y += (((wd.key_s||wd.key_arrowdown)?1:0) - ((wd.key_w||wd.key_arrowup)?1:0)) * SP * step
G.x = Math.max(24, Math.min(2024, G.x))
G.y = Math.max(24, Math.min(744, G.y))
for (const f of sim.fields.values()) {
  if (f.id === 'wanderer') { f.transform.x = G.x; f.transform.y = G.y; f.transform.vx = 0; f.transform.vy = 0 }
}
wd.__camera = { x: G.x, y: G.y }
const region = G.x < 700 ? 'THE PINEWOOD' : (G.x < 1000 ? 'THE CROSSROADS' : (G.x < 1700 ? 'THE DUNES' : 'THE GREAT WATER'))
wd.ui = { rev: 2, root: [ { id: 'pos', kind: 'panel', anchor: { gx: 6, gy: 506 }, align: 'bl', w: 240,
  children: [ { kind: 'text', fontSize: 12, text: region }, { kind: 'text', fontSize: 10, color: 'rgba(255,255,255,0.5)', text: Math.round(G.x) + ', ' + Math.round(G.y) + '  of  2048 x 768  ·  WASD' } ] } ] }
`
const r = await fetch('http://localhost:3000/api/engine/bridge', {
  method: 'POST', headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ commands: [{ type: 'update_step_hook', hookId: 'player', code: PLAYER, description: 'panorama journey' }] }),
})
const d = await r.json()
console.log('push:', JSON.stringify((d.results ?? [])[0]?.error ?? 'ok').slice(0, 140))
const after = await prisma.playerSpace.findUnique({ where: { slug: 'e2e-territory' }, select: { snapshot: true } })
console.log('player panorama live:', after.snapshot.stepHooks.find(h => h.id === 'player')?.code.includes('__tj2') ? '✓' : 'STILL OLD')
await prisma.$disconnect(); await pool.end()
