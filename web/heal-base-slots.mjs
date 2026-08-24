// heal: seed the blank placeholder slots onto the PLATFORMER 2D BASE (dev) —
// every fork from now on is born with its anatomy named and its sandbox alive.
// Mirrors placeholder-nodes.ts (hooks + __nodes registration + history rev 1).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const SLOTS = [
  ['player', 'input + the player avatar — reading keys/touch, moving the body'],
  ['world', 'the stage — terrain, physics, weather, the rules of matter'],
  ['entities', 'everything that lives in the world — spawns, rosters, behavior'],
  ['rules', 'the game of it — goals, scoring, win/lose, rounds'],
  ['hud', 'what the player sees about the game — score, prompts, state'],
  ['net', 'shared state — what this world syncs when crews play together'],
]
const codeFor = (id, desc) => `// ── ${id.toUpperCase()} — blank slot: ${desc}.\n// Build WITHIN this node: dock_node {"id":"${id}"}, replace this body, undock.\n// It hot-swaps live — no reload, ever.\n`

const world = await prisma.playerSpace.findUnique({ where: { slug: 'base-platformer-2d' }, select: { id: true, snapshot: true } })
if (!world) { console.log('base not found'); process.exit(1) }
const snap = world.snapshot
snap.stepHooks ??= []
const wd = (snap.worldData ??= {})
const nodes = (wd.__nodes ??= {})
const hist = (wd.__nodeHist ??= {})
const now = Date.now()
let added = 0
for (const [id, desc] of SLOTS) {
  if (snap.stepHooks.some(h => h.id === id)) { console.log(`exists: ${id}`); continue }
  const code = codeFor(id, desc)
  snap.stepHooks.push({ id, author: 'the-house', description: desc, code })
  nodes[id] ??= { id, rev: 1, auto: true, order: Object.keys(nodes).length }
  ;(hist[id] ??= []).push({ rev: 1, code, at: now, by: 'house-seed', note: 'blank slot — born with the world' })
  added++
}
if (added) {
  await prisma.playerSpace.update({ where: { id: world.id }, data: { snapshot: snap } })
  console.log(`seeded ${added} slots onto base-platformer-2d (hooks now: ${snap.stepHooks.length})`)
} else console.log('nothing to add')
await prisma.$disconnect(); await pool.end()
