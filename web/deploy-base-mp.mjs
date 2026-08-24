// deploy: the PLATFORMER 2D BASE goes multiplayer (task #9 rung 2).
// Through the REAL pipeline (world token → bridge commands):
//  · player slot → per-seat platformer physics, ARENA-authoritative
//  · net slot    → the manifest charter (lobby: solo stays local)
//  · mp_avatars  → a superimposed visual layer drawing every seat from pop()
//  · worldData   → mpManifest {lobby:true} + spawn law
// Solo visits are UNTOUCHED (lobby). Crews share /space/base-platformer-2d?room=<name>.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import crypto from 'crypto'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'
const SLUG = 'base-platformer-2d'

const PLAYER_NODE = `// ── PLAYER (networked) — the ARENA runs this branch: one platformer
// body per seat, driven by each player's input frame (wd.players).
// Solo play never enters here (no wd.players locally) — the base's own
// engine (base2d_core) stays the single-player truth.
const wd = sim.worldData
if (Array.isArray(wd.players)) {
  const M = wd.__mpP || (wd.__mpP = {})
  const G = 1300, RUN = 900, MAXVX = 260, JUMP = 470, RAD = 14
  for (const p of wd.players) {
    const k = 's' + p.seat
    const b = M[k] || (M[k] = { x: p.seat * 70 - 100, y: RAD, vx: 0, vy: 0, j: false })
    const dir = ((p.key_d || p.key_arrowright) ? 1 : 0) - ((p.key_a || p.key_arrowleft) ? 1 : 0)
    b.vx += dir * RUN * dt
    b.vx *= (dir === 0 ? Math.max(0, 1 - 8 * dt) : Math.max(0, 1 - 1.5 * dt))
    b.vx = Math.max(-MAXVX, Math.min(MAXVX, b.vx))
    const jumpHeld = !!(p.key_w || p.key_space || p.key_arrowup)
    const grounded = b.y <= RAD + 0.5
    if (jumpHeld && !b.j && grounded) b.vy = JUMP
    b.j = jumpHeld
    if (!grounded || b.vy > 0) b.vy -= G * dt
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (b.y < RAD) { b.y = RAD; b.vy = 0 }
  }
  // avatars ride the population channel (code 9) APPENDED after the base's
  // own foes — pop(i) = (x, y, seat, 9) for the mp_avatars layer
  const P = Array.isArray(wd.gpuPopulation) ? wd.gpuPopulation : []
  const seats = new Set(wd.players.map(p => 's' + p.seat))
  for (const k of Object.keys(M)) { if (!seats.has(k)) delete M[k] }   // left players vanish
  for (const p of wd.players) { const b = M['s' + p.seat]; P.push(b.x, b.y, p.seat, 9) }
  wd.gpuPopulation = P
}
`

const NET_NODE = `// ── NET — this world's shared-state charter.
// mpManifest lives in worldData (set at deploy): {type:'shared',
// capacity:6, lobby:true} — SOLO play runs locally (the lobby flag);
// a crew shares a room via /space/base-platformer-2d?room=<name>.
// Server truth: per-seat bodies (player node) + the population channel.
// Local cosmetic: snow, sky, the idle campfire doggo.
`

const AVATAR_WGSL = `fn visual_mpavatars(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // same camera law as the base layer: wp = cam + su * HALF (su = y-up uv)
  let su = vec2f(uv.x, -uv.y);
  let camX = uni(8); let camY = uni(9);
  let HALF = 300.0;
  let wp = vec2f(camX + su.x * HALF, camY + su.y * HALF);
  var a = 0.0;
  var col = vec3f(0.0);
  let n = popCount();
  for (var i = 0; i < n; i = i + 1) {
    let e = pop(i);
    if (abs(e.w - 9.0) > 0.5) { continue; }   // only mp avatars (code 9)
    let d = distance(wp, e.xy);
    let r = 14.0;
    let body = smoothstep(r, r * 0.55, d);
    let glow = smoothstep(r * 2.6, r * 0.8, d) * 0.35;
    let g = max(body, glow);
    if (g > a) {
      a = g;
      let hue = 0.06 + e.z * 0.14;
      col = hsv2rgb(vec3f(hue, 0.72, 1.0)) * (0.6 + 0.4 * body);
    }
  }
  return vec4f(col, a * 0.95);
}`

// a fresh build key for the base (revoked after)
const world = await prisma.playerSpace.findUnique({ where: { slug: SLUG }, select: { id: true } })
const rawKey = 'uc_st_' + crypto.randomBytes(16).toString('hex')
const tok = await prisma.spaceToken.create({ data: {
  name: 'mp-deploy', spaceId: world.id,
  tokenHash: crypto.createHash('sha256').update(rawKey).digest('hex'),
  tokenPrefix: rawKey.slice(0, 12) + '...',
} })

const cmds = [
  { type: 'define_visual', name: 'mpavatars', wgsl: AVATAR_WGSL },
  { type: 'create_field', fieldId: 'mp_avatars', name: 'mp avatars', visualType: 'mpavatars' },
  { type: 'update_step_hook', hookId: 'player', description: 'per-seat platformer bodies (arena authority)', code: PLAYER_NODE },
  { type: 'update_step_hook', hookId: 'net', description: 'shared-state charter', code: NET_NODE },
  { type: 'set_world_data', data: { mpManifest: { type: 'shared', capacity: 6, lobby: true } } },
]
const r = await fetch(`${BASE}/api/engine/bridge`, {
  method: 'POST', headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ commands: cmds }),
})
const d = await r.json()
const errs = (d.results ?? []).filter(x => x.error)
console.log(`deploy: ${r.status} ${errs.length ? 'ERRORS ' + JSON.stringify(errs) : '✓ all landed'}`)

// readback-verify (the deploy law): the snapshot carries what we sent
const after = await prisma.playerSpace.findUnique({ where: { slug: SLUG }, select: { snapshot: true } })
const s = after.snapshot
console.log(`readback: mpManifest=${JSON.stringify(s.worldData?.mpManifest)} · mp_avatars field=${(s.fields ?? []).some(f => f.id === 'mp_avatars') ? '✓' : 'MISSING'} · player node networked=${(s.stepHooks ?? []).find(h => h.id === 'player')?.code.includes('wd.players') ? '✓' : 'MISSING'}`)

await prisma.spaceToken.update({ where: { id: tok.id }, data: { revokedAt: new Date() } })
console.log('deploy key revoked')
await prisma.$disconnect(); await pool.end()
