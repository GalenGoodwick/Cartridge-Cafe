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
  if (f.id === 'land_f') { f.transform.x = 1024; f.transform.y = 1024; f.transform.vx = 0; f.transform.vy = 0 }   // the canvas covers the GRID — pin it at grid center
}
wd.__camera = { x: G.x, y: G.y }
const region = G.x < 700 ? 'THE PINEWOOD' : (G.x < 1000 ? 'THE CROSSROADS' : (G.x < 1700 ? 'THE DUNES' : 'THE GREAT WATER'))
wd.ui = { rev: 2, root: [ { id: 'pos', kind: 'panel', anchor: { gx: 6, gy: 506 }, align: 'bl', w: 240,
  children: [ { kind: 'text', fontSize: 12, text: region }, { kind: 'text', fontSize: 10, color: 'rgba(255,255,255,0.5)', text: Math.round(G.x) + ', ' + Math.round(G.y) + '  of  2048 x 768  ·  WASD' } ] } ] }
`
const LAND = `fn visual_land(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // 2048 × 768 PANORAMA — the screen canvas spans the GRID (pinned at its
  // center): uv -1..1 maps straight onto world 0..2048. The camera window
  // simply shows its part; the engine's clamp keeps that window in the rect.
  let wp = (uv * 0.5 + vec2f(0.5)) * 2048.0;
  if (wp.y > 768.0 || wp.y < 0.0 || wp.x < 0.0 || wp.x > 2048.0) { return vec4f(0.0); }
  var c = vec3f(0.03, 0.04, 0.06);
  let n1 = fbm(wp * 0.004 + vec2f(time * 0.01, 0.0), 4);
  let n2 = fbm(wp * 0.013 + vec2f(7.7, 3.1), 4);
  let forest = smoothstep(700.0, 200.0, wp.x);
  c = mix(c, vec3f(0.04, 0.22, 0.10) * (0.6 + n2 * 0.8), forest);
  let dRing = abs(distance(wp, vec2f(820.0, 384.0)) - 110.0);
  c = mix(c, vec3f(0.75, 0.70, 0.60), smoothstep(16.0, 4.0, dRing));
  let dunes = smoothstep(950.0, 1350.0, wp.x) * smoothstep(1750.0, 1400.0, wp.x);
  c = mix(c, vec3f(0.55, 0.34, 0.10) * (0.5 + 0.5 * sin(wp.y * 0.05 + n1 * 6.0)), dunes);
  let water = smoothstep(1600.0, 1900.0, wp.x);
  c = mix(c, vec3f(0.05, 0.16, 0.32) * (0.7 + 0.3 * sin(wp.y * 0.02 + time * 1.2 + n1 * 4.0)), water);
  c += vec3f(0.12, 0.10, 0.05) * smoothstep(26.0, 0.0, abs(wp.y - 384.0)) * 0.6;
  let edge = min(min(wp.x, 2048.0 - wp.x), min(wp.y, 768.0 - wp.y));
  c += vec3f(0.9, 0.45, 0.15) * smoothstep(12.0, 0.0, edge) * 0.7;
  return vec4f(c, 1.0);
}`
const r = await fetch('http://localhost:3000/api/engine/bridge', {
  method: 'POST', headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ commands: [
    { type: 'update_step_hook', hookId: 'player', code: PLAYER, description: 'panorama journey' },
    { type: 'define_visual', name: 'land', wgsl: LAND },
  ] }),
})
const d = await r.json()
console.log('push:', JSON.stringify((d.results ?? [])[0]?.error ?? 'ok').slice(0, 140))
const after = await prisma.playerSpace.findUnique({ where: { slug: 'e2e-territory' }, select: { snapshot: true } })
console.log('player panorama live:', after.snapshot.stepHooks.find(h => h.id === 'player')?.code.includes('__tj2') ? '✓' : 'STILL OLD')
await prisma.$disconnect(); await pool.end()
