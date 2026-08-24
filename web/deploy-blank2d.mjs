// deploy: BLANK 2D — the 2D fork-tree root (task #1), rebuilt on everything
// this stretch landed: born with its slots, chrome-safe UI-SYSTEM hint (the
// legacy wd.hud line is what killed v1), touch-ready, __base card.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import crypto from 'crypto'
import { readFileSync } from 'fs'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'

// the seed sources are the bootstrap record (cafe-worlds-via-bridge law)
const VISUAL = readFileSync('src/app/engine/scenes/bases/blank2d-visual.wgsl', 'utf-8')
let PLAYER = readFileSync('src/app/engine/scenes/bases/blank2d-hook.js', 'utf-8')
// v1's killer was this legacy wd.hud block — the hint now lives in the hud
// SLOT via THE UI SYSTEM (chrome-safe by construction)
PLAYER = PLAYER.replace(/wd\.hud = \[[\s\S]*?\]\n/, '// (the hint HUD lives in the hud slot — THE UI SYSTEM)\n')

const HUD = `// ── HUD — THE UI SYSTEM (chrome-safe: the engine keeps this out
// from under the cafe's plate/pills automatically).
const wd = sim.worldData
wd.ui = { rev: 1, root: [
  { id: 'hint', kind: 'panel', anchor: { gx: 6, gy: 506 }, align: 'bl', w: '64%',
    children: [ { kind: 'text', fontSize: 11, wrap: true,
      text: 'BLANK 2D · move: arrows/WASD or drag · fork this — everything you add is yours' } ] },
] }
`
const CHARTER = (id, desc) => `// ── ${id.toUpperCase()} — blank slot: ${desc}.\n// Build WITHIN this node: dock_node {"id":"${id}"}, replace this body, undock.\n// It hot-swaps live — no reload, ever.\n`

const gal = await prisma.user.findUnique({ where: { email: 'galen.goodwick@gmail.com' } })
await prisma.playerSpace.deleteMany({ where: { slug: 'blank-2d' } })
const world = await prisma.playerSpace.create({ data: { slug: 'blank-2d', name: 'BLANK 2D', ownerId: gal.id, isPublic: true, snapshot: {} } })
const raw = 'uc_st_' + crypto.randomBytes(16).toString('hex')
const tok = await prisma.spaceToken.create({ data: { name: 'blank2d-deploy', spaceId: world.id, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.slice(0, 12) + '...' } })
const bridge = (commands) => fetch(`${BASE}/api/engine/bridge`, {
  method: 'POST', headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ commands }),
}).then(r => r.json())

// the card TYPE comes from the registry vocabulary (mandatory)
const types = await bridge([{ type: 'card_types' }])
const vocab = types.results?.[0]?.types ?? []
let typeId = vocab.find(t => /base|substrate|blank/i.test(t.id || t.label || ''))?.id
if (!typeId) {
  const prop = await bridge([{ type: 'propose_card_type', label: 'BASE', desc: 'an engine substrate with no level — fork it and build' }])
  typeId = prop.results?.[0]?.id ?? prop.results?.[0]?.type_id ?? 'base'
}
console.log('card type:', typeId, `(vocab ${vocab.length})`)

const d = await bridge([
  { type: 'define_visual', name: 'blank2d', wgsl: VISUAL },
  { type: 'create_field', fieldId: 'blank2d_f', name: 'Blank2D', visualType: 'blank2d' },
  { type: 'add_step_hook', hookId: 'player', description: 'input + avatar + camera — the living substrate', code: PLAYER },
  { type: 'add_step_hook', hookId: 'world', description: 'the stage', code: CHARTER('world', 'terrain, physics, weather — the rules of matter') },
  { type: 'add_step_hook', hookId: 'entities', description: 'what lives here', code: CHARTER('entities', 'spawns, rosters, behavior — one sub-node per kind') },
  { type: 'add_step_hook', hookId: 'rules', description: 'the game of it', code: CHARTER('rules', 'goals, scoring, win/lose') },
  { type: 'add_step_hook', hookId: 'hud', description: 'the display layer (UI SYSTEM)', code: HUD },
  { type: 'add_step_hook', hookId: 'net', description: 'shared state', code: CHARTER('net', 'mpManifest + what syncs when crews play') },
  { type: 'set_card', cardType: typeId, tags: ['2d', 'blank', 'mobile'] },
  { type: 'set_world_data', data: {
    __base: true, forkable: true,
    vision: 'the 2D dimension itself, made playable: a quiet coordinate space, one breathing avatar, input that already works on desktop and touch. Nothing else — the emptiness IS the invitation.',
    instructions: 'move with arrows/WASD, or touch-drag anywhere. This is a starting point: FORK IT and everything you add is yours. Your world begins where this one stops.',
    brief_done: true,
  } },
])
const errs = (d.results ?? []).filter(x => x.error)
console.log(`deploy: ${errs.length ? 'ERRORS ' + JSON.stringify(errs).slice(0, 400) : '✓ all landed'}`)

const after = await prisma.playerSpace.findUnique({ where: { slug: 'blank-2d' }, select: { snapshot: true } })
const s = after.snapshot
console.log(`readback: hooks=[${(s.stepHooks ?? []).map(h => h.id).join(',')}] · __base=${s.worldData?.__base} · card=${JSON.stringify(s.worldData?.card ?? null)}`)

await prisma.spaceToken.update({ where: { id: tok.id }, data: { revokedAt: new Date() } })
console.log('deploy key revoked · /space/blank-2d')
await prisma.$disconnect(); await pool.end()
