// CPU preview for growHumanoid — a single figure is ~17 elements, so this
// renders in a couple of seconds. Same honest-eye contract as grow-preview.
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { sdElement, smin } from './grow-building.mjs'
import { growHumanoid, validateHumanoid } from './grow-humanoid.mjs'

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')))
const SEED = Number(args.seed ?? 1)
const OUT = args.out ?? 'figure'
const YAW = Number(args.yaw ?? 25) * Math.PI / 180
const W = Number(args.w ?? 560), H = Number(args.h ?? 640)

const fig = growHumanoid({ seed: SEED, height: 2.2 })
const errs = validateHumanoid(fig)
for (const e of errs) console.log('canon:', e)
console.log('meta:', JSON.stringify(Object.fromEntries(Object.entries(fig.meta).filter(([k]) => k !== 'resolved' && k !== 'levels').map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1000) / 1000 : v]))))

function sdScene(p0) {
  // turntable: rotate the RAY into figure space (figure stays at x=0 for mirrorX)
  const p = [p0[0] * Math.cos(YAW) - p0[2] * Math.sin(YAW), p0[1], p0[0] * Math.sin(YAW) + p0[2] * Math.cos(YAW)]
  let d = p[1]
  for (const e of fig.statics) d = smin(d, sdElement(e, p), e.tissue || 0)
  return d
}

const norm = (v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l] }
const RO = [0, 1.25, -4.2], TA = [0, 1.1, 0], FOV = 0.62
const fw = norm([TA[0] - RO[0], TA[1] - RO[1], TA[2] - RO[2]])
const rt = norm([-fw[2], 0, fw[0]])
const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]]
const SUN = norm([-0.45, 0.7, -0.4])
const buf = Buffer.alloc(W * H * 3)
const t0 = Date.now()
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
  const u = (px / W * 2 - 1) * (W / H), v = -(py / H * 2 - 1)
  const rd = norm([fw[0] + FOV * (u * rt[0] + v * up[0]), fw[1] + FOV * (u * rt[1] + v * up[1]), fw[2] + FOV * (u * rt[2] + v * up[2])])
  let t = 0.02, hit = -1
  for (let i = 0; i < 128; i++) {
    const p = [RO[0] + rd[0] * t, RO[1] + rd[1] * t, RO[2] + rd[2] * t]
    const h = sdScene(p)
    if (h < 0.0012 * t) { hit = t; break }
    t += Math.max(h * 0.9, 0.002)
    if (t > 20) break
  }
  let col
  if (hit < 0) col = [0.12, 0.13, 0.19]
  else {
    const p = [RO[0] + rd[0] * hit, RO[1] + rd[1] * hit, RO[2] + rd[2] * hit]
    const e = 0.0015
    const n = norm([
      sdScene([p[0] + e, p[1], p[2]]) - sdScene([p[0] - e, p[1], p[2]]),
      sdScene([p[0], p[1] + e, p[2]]) - sdScene([p[0], p[1] - e, p[2]]),
      sdScene([p[0], p[1], p[2] + e]) - sdScene([p[0], p[1], p[2] - e]),
    ])
    const dif = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2])
    const ao1 = Math.min(1, sdScene([p[0] + n[0] * 0.12, p[1] + n[1] * 0.12, p[2] + n[2] * 0.12]) / 0.12)
    const ao = 0.45 + 0.55 * Math.max(0, ao1)
    const isGround = p[1] < 0.01 && n[1] > 0.95
    const alb = isGround ? 0.4 : 0.9
    const c = alb * (0.22 * (0.5 + 0.5 * n[1]) + 0.85 * dif) * ao
    col = [c, c * 1.02, c * 1.1]
  }
  const o = (py * W + px) * 3
  const dth = (((px * 7 + py * 13) % 17) / 17 - 0.5) * 1.6
  buf[o] = Math.max(0, Math.min(255, Math.pow(Math.max(0, col[0]), 1 / 2.2) * 255 + dth))
  buf[o + 1] = Math.max(0, Math.min(255, Math.pow(Math.max(0, col[1]), 1 / 2.2) * 255 + dth))
  buf[o + 2] = Math.max(0, Math.min(255, Math.pow(Math.max(0, col[2]), 1 / 2.2) * 255 + dth))
}
console.log('render', Date.now() - t0, 'ms')
writeFileSync(`${OUT}.ppm`, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), buf]))
execSync(`sips -s format png ${OUT}.ppm --out ${OUT}.png`, { stdio: 'ignore' })
console.log('wrote', OUT + '.png')
