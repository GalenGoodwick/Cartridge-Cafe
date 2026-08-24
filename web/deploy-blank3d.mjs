// deploy: BLANK 3D — the 3D fork-tree root (task #2). A WORKING first-person
// substrate with nothing in it: analytic-ray ground + sky + one monolith for
// orientation, WASD/arrow movement + touch, the slot anatomy, chrome-safe hint.
// 3D here = the engine's real 3D path: a raymarched visual on the 2D superpath.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import crypto from 'crypto'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'

const VISUAL = `fn visual_blank3d(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // BLANK 3D — the dimension substrate seen in first person. ANALYTIC eyes
  // (no march loops): a ground plane, a sky, one monolith. Camera rides the
  // whiteboard: u0,u1 = position on the plane · u2 = yaw · u3 = walk-bob.
  let px = uni(0); let py = uni(1); let yaw = uni(2); let bob = uni(3);
  let ro = vec3f(px, 13.0 + bob, py);
  // screen ray: uv is the canvas (-1..1, y up after flip); slight down-pitch
  let su = vec2f(uv.x, -uv.y);
  let cy = cos(yaw); let sy = sin(yaw);
  let fwd = vec3f(sy, -0.10, cy);
  let right = vec3f(cy, 0.0, -sy);
  let up = normalize(cross(right, fwd));
  let rd = normalize(fwd + right * su.x * 0.9 + up * su.y * 0.62);

  // ── sky: quiet dusk with one sun-ember low in the east ──
  var c = mix(vec3f(0.05, 0.045, 0.08), vec3f(0.015, 0.015, 0.03), clamp(rd.y * 2.5 + 0.4, 0.0, 1.0));
  let sunD = max(0.0, dot(rd, normalize(vec3f(0.7, 0.06, 0.3))));
  c += vec3f(0.9, 0.45, 0.18) * pow(sunD, 48.0) * 0.8 + vec3f(0.5, 0.25, 0.1) * pow(sunD, 8.0) * 0.15;

  // ── the ground plane (y=0): analytic hit, grid etched into the dark ──
  if (rd.y < -0.001) {
    let t = -ro.y / rd.y;
    let hp = ro + rd * t;
    if (t < 900.0) {
      let g = abs(fract(hp.xz / 64.0) - 0.5) * 2.0;
      let line = 1.0 - smoothstep(0.0, 0.06 + t * 0.0004, min(g.x, g.y));
      var ground = vec3f(0.030, 0.026, 0.034) + vec3f(0.10, 0.085, 0.06) * line * 0.55;
      // the world has edges: the ground glows where the walkable plane ends
      let edge = min(min(hp.x, 512.0 - hp.x), min(hp.z, 512.0 - hp.z));
      ground += vec3f(0.9, 0.45, 0.15) * smoothstep(10.0, 0.0, abs(edge)) * 0.5;
      // outside the plane there is no floor — the void
      if (hp.x < 0.0 || hp.x > 512.0 || hp.z < 0.0 || hp.z > 512.0) { ground = vec3f(0.008, 0.008, 0.014); }
      let fog = exp(-t * 0.0045);
      c = mix(c, ground, fog);
    }
  }

  // ── the monolith at the center (256,256): analytic slab, the one landmark ──
  {
    let mc = vec2f(256.0, 256.0);
    // ray vs infinite vertical cylinder r=16 (analytic), capped at h=90
    let oc = ro.xz - mc;
    let a = dot(rd.xz, rd.xz);
    let b = 2.0 * dot(oc, rd.xz);
    let cc = dot(oc, oc) - 16.0 * 16.0;
    let disc = b * b - 4.0 * a * cc;
    if (disc > 0.0 && a > 0.0001) {
      let t = (-b - sqrt(disc)) / (2.0 * a);
      if (t > 0.0) {
        let hy = ro.y + rd.y * t;
        if (hy > 0.0 && hy < 90.0) {
          let n = normalize(vec3f((ro.xz + rd.xz * t - mc).x, 0.0, (ro.xz + rd.xz * t - mc).y));
          let lit = 0.5 + 0.5 * max(0.0, dot(n, normalize(vec3f(0.7, 0.0, 0.3))));
          var mcol = vec3f(0.10, 0.095, 0.12) * lit + vec3f(0.02);
          // the monolith breathes a faint ember line at its heart
          mcol += vec3f(0.9, 0.5, 0.2) * smoothstep(3.0, 0.0, abs(hy - 45.0 - sin(time * 1.5) * 4.0)) * 0.5;
          let fog = exp(-t * 0.004);
          c = mix(c, mcol, fog);
        }
      }
    }
  }
  return vec4f(c, 1.0);
}`

const PLAYER = `// ── PLAYER (first person) — this node owns the CAMERA-BODY.
// W/S (or up/down) walk along your gaze; A/D (or left/right) turn.
// TOUCH: drag horizontally to turn, vertically to walk (mobile-ready).
// The whiteboard carries the eyes: u0,u1 = position · u2 = yaw · u3 = bob.
const wd = sim.worldData
if (!wd.__b3 || wd.__b3.v !== 1) wd.__b3 = { v: 1, x: 256, y: 96, yaw: 0, t: 0, walk: 0, px: 0, py: 0, pd: false }
const G = wd.__b3
const step = Math.min(dt, 1/30)
G.t += step
const fwdIn = ((wd.key_w || wd.key_arrowup) ? 1 : 0) - ((wd.key_s || wd.key_arrowdown) ? 1 : 0)
const turnIn = ((wd.key_d || wd.key_arrowright) ? 1 : 0) - ((wd.key_a || wd.key_arrowleft) ? 1 : 0)
let fwd = fwdIn, turn = turnIn
const p = wd.input && wd.input.pointer ? wd.input.pointer : {}
if (p.down && typeof p.x === 'number') {
  if (!G.pd) { G.px = p.x; G.py = p.y }
  turn += Math.max(-1, Math.min(1, (p.x - G.px) * 0.02))
  fwd += Math.max(-1, Math.min(1, (G.py - p.y) * 0.02))
  G.pd = true
} else G.pd = false
G.yaw += turn * 1.9 * step
const SPEED = 120
G.x += Math.sin(G.yaw) * fwd * SPEED * step
G.y += Math.cos(G.yaw) * fwd * SPEED * step
G.x = Math.max(10, Math.min(502, G.x))
G.y = Math.max(10, Math.min(502, G.y))
G.walk = fwd !== 0 ? G.walk + step * 9 : 0
for (const f of sim.fields.values()) {
  if (f.name === 'Blank3D') { const T = f.transform; T.x = 256; T.y = 256; T.vx = 0; T.vy = 0 }
}
const U = new Array(8).fill(0)
U[0] = G.x; U[1] = G.y; U[2] = G.yaw; U[3] = Math.abs(Math.sin(G.walk)) * 1.6
wd.gpuUniforms = U
`

const HUD = `// ── HUD — THE UI SYSTEM (chrome-safe).
const wd = sim.worldData
wd.ui = { rev: 1, root: [
  { id: 'hint', kind: 'panel', anchor: { gx: 6, gy: 506 }, align: 'bl', w: '66%',
    children: [ { kind: 'text', fontSize: 11, wrap: true,
      text: 'BLANK 3D · walk W/S · turn A/D · or drag · one plane, one monolith — fork this and raise your world on it' } ] },
] }
`
const CHARTER = (id, desc) => `// ── ${id.toUpperCase()} — blank slot: ${desc}.\n// Build WITHIN this node: dock_node {"id":"${id}"}, replace this body, undock.\n`

const gal = await prisma.user.findUnique({ where: { email: 'galen.goodwick@gmail.com' } })
await prisma.playerSpace.deleteMany({ where: { slug: 'blank-3d' } })
const world = await prisma.playerSpace.create({ data: { slug: 'blank-3d', name: 'BLANK 3D', ownerId: gal.id, isPublic: true, snapshot: {} } })
const raw = 'uc_st_' + crypto.randomBytes(16).toString('hex')
const tok = await prisma.spaceToken.create({ data: { name: 'blank3d-deploy', spaceId: world.id, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.slice(0, 12) + '...' } })
const bridge = (commands) => fetch(`${BASE}/api/engine/bridge`, {
  method: 'POST', headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ commands }),
}).then(r => r.json())

const types = await bridge([{ type: 'card_types' }])
const typeId = (types.results?.[0]?.types ?? []).find(t => /base/i.test(t.id || t.label || ''))?.id ?? 'base'

const d = await bridge([
  { type: 'define_visual', name: 'blank3d', wgsl: VISUAL },
  { type: 'create_field', fieldId: 'blank3d_f', name: 'Blank3D', visualType: 'blank3d' },
  { type: 'add_step_hook', hookId: 'player', description: 'the first-person camera-body', code: PLAYER },
  { type: 'add_step_hook', hookId: 'world', description: 'the stage', code: CHARTER('world', 'the plane, weather, the rules of matter — shape the monolith into your architecture') },
  { type: 'add_step_hook', hookId: 'entities', description: 'what lives here', code: CHARTER('entities', 'spawns, rosters, behavior — one sub-node per kind') },
  { type: 'add_step_hook', hookId: 'rules', description: 'the game of it', code: CHARTER('rules', 'goals, scoring, win/lose') },
  { type: 'add_step_hook', hookId: 'hud', description: 'the display layer (UI SYSTEM)', code: HUD },
  { type: 'add_step_hook', hookId: 'net', description: 'shared state', code: CHARTER('net', 'mpManifest + what syncs when crews walk here together') },
  { type: 'set_card', cardType: typeId, tags: ['3d', 'blank', 'mobile'] },
  { type: 'set_world_data', data: {
    __base: true, forkable: true,
    vision: 'the 3D dimension itself, made walkable: one plane, one sky, one monolith, and a first-person body that already works on keys and touch. The emptiness is the invitation — everything you raise on this plane is yours.',
    instructions: 'walk with W/S, turn with A/D (arrows work; on touch, drag to turn and walk). Find the monolith. Find the edge of the plane. Then FORK THIS and build upward.',
    brief_done: true,
  } },
])
const errs = (d.results ?? []).filter(x => x.error)
console.log(`deploy: ${errs.length ? 'ERRORS ' + JSON.stringify(errs).slice(0, 300) : '✓ all landed'}`)
const after = await prisma.playerSpace.findUnique({ where: { slug: 'blank-3d' }, select: { snapshot: true } })
const s = after.snapshot
console.log(`readback: hooks=[${(s.stepHooks ?? []).map(h => h.id).join(',')}] · shapeType=${JSON.stringify(s.fields?.[0]?.shapeType)} · __base=${s.worldData?.__base} · card=${JSON.stringify(s.worldData?.card?.type)}`)
await prisma.spaceToken.update({ where: { id: tok.id }, data: { revokedAt: new Date() } })
console.log('deploy key revoked · /space/blank-3d')
await prisma.$disconnect(); await pool.end()
