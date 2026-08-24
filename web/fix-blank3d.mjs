// fix BLANK 3D: right-side-up eyes + no monolith (Galen: a blank is a blank)
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import crypto from 'crypto'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'
const w = await prisma.playerSpace.findUnique({ where: { slug: 'blank-3d' }, select: { id: true } })
await prisma.engineSlot.deleteMany({ where: { slot: 'build-lock:' + w.id } })
const raw = 'uc_st_' + crypto.randomBytes(16).toString('hex')
const tok = await prisma.spaceToken.create({ data: { name: 'blank3d-fix', spaceId: w.id, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.slice(0, 12) + '...' } })

const VISUAL = `fn visual_blank3d(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // BLANK 3D — the dimension substrate in first person. ANALYTIC eyes:
  // a ground plane, a sky, nothing else — the emptiness IS the invitation.
  // Camera on the whiteboard: u0,u1 = position · u2 = yaw · u3 = walk-bob.
  let px = uni(0); let py = uni(1); let yaw = uni(2); let bob = uni(3);
  let ro = vec3f(px, 13.0 + bob, py);
  let cy = cos(yaw); let sy = sin(yaw);
  let fwd = vec3f(sy, -0.10, cy);
  let right = vec3f(cy, 0.0, -sy);
  let up = normalize(cross(right, fwd));
  let rd = normalize(fwd + right * uv.x * 0.9 + up * uv.y * 0.62);

  // sky: quiet dusk, one sun-ember low in the east
  var c = mix(vec3f(0.05, 0.045, 0.08), vec3f(0.015, 0.015, 0.03), clamp(rd.y * 2.5 + 0.4, 0.0, 1.0));
  let sunD = max(0.0, dot(rd, normalize(vec3f(0.7, 0.06, 0.3))));
  c += vec3f(0.9, 0.45, 0.18) * pow(sunD, 48.0) * 0.8 + vec3f(0.5, 0.25, 0.1) * pow(sunD, 8.0) * 0.15;

  // the ground plane (y=0): analytic hit, grid etched into the dark
  if (rd.y < -0.001) {
    let t = -ro.y / rd.y;
    let hp = ro + rd * t;
    if (t < 900.0) {
      let g = abs(fract(hp.xz / 64.0) - 0.5) * 2.0;
      let line = 1.0 - smoothstep(0.0, 0.06 + t * 0.0004, min(g.x, g.y));
      var ground = vec3f(0.030, 0.026, 0.034) + vec3f(0.10, 0.085, 0.06) * line * 0.55;
      let edge = min(min(hp.x, 512.0 - hp.x), min(hp.z, 512.0 - hp.z));
      ground += vec3f(0.9, 0.45, 0.15) * smoothstep(10.0, 0.0, abs(edge)) * 0.5;
      if (hp.x < 0.0 || hp.x > 512.0 || hp.z < 0.0 || hp.z > 512.0) { ground = vec3f(0.008, 0.008, 0.014); }
      let fog = exp(-t * 0.0045);
      c = mix(c, ground, fog);
    }
  }
  return vec4f(c, 1.0);
}`

const HUD = `// ── HUD — THE UI SYSTEM (chrome-safe).
const wd = sim.worldData
wd.ui = { rev: 2, root: [
  { id: 'hint', kind: 'panel', anchor: { gx: 6, gy: 506 }, align: 'bl', w: '62%',
    children: [ { kind: 'text', fontSize: 11, wrap: true,
      text: 'BLANK 3D · walk W/S · turn A/D · or drag · one empty plane under one sky — fork this and raise your world on it' } ] },
] }
`
const r = await fetch(`${BASE}/api/engine/bridge`, {
  method: 'POST', headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ commands: [
    { type: 'define_visual', name: 'blank3d', wgsl: VISUAL },
    { type: 'update_step_hook', hookId: 'hud', code: HUD, description: 'the display layer (UI SYSTEM)' },
    { type: 'set_world_data', data: {
      vision: 'the 3D dimension itself, made walkable: one empty plane, one sky, and a first-person body that already works on keys and touch. Nothing stands here yet — the emptiness is the invitation.',
      instructions: 'walk with W/S, turn with A/D (arrows work; on touch, drag to turn and walk). Find the edge of the plane. Then FORK THIS and raise your world on it.',
    } },
  ] }),
})
const d = await r.json()
if (!r.ok || d.error) { console.log('REFUSED:', r.status, d.error); process.exit(1) }
console.log('fix:', (d.results ?? []).filter(x => x.error).length ? 'ERRORS ' + JSON.stringify(d.results).slice(0, 300) : '✓ landed')
const after = await prisma.playerSpace.findUnique({ where: { slug: 'blank-3d' }, select: { snapshot: true } })
console.log('readback: monolith gone:', after.snapshot.visualTypes.find(v => v.name === 'blank3d')?.wgsl.includes('cylinder') ? 'NO' : '✓', '· flip gone:', after.snapshot.visualTypes.find(v => v.name === 'blank3d')?.wgsl.includes('-uv.y') ? 'NO' : '✓')
await prisma.spaceToken.update({ where: { id: tok.id }, data: { revokedAt: new Date() } })
await prisma.$disconnect(); await pool.end()
