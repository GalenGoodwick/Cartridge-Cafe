// CPU preview renderer for grow-building — the honest eye: SEE your building
// at full res locally BEFORE any bridge write (probes lie at 256px). Marches the SAME cell-scheme
// math the emitted WGSL runs, with the SAME camera convention as mod_vf3_ray
// (cross(fw,+Y): screen-right = world -x). Writes PPM -> sips -> PNG.
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { growArcade, growGable, sdGraphCellScheme } from './grow-building.mjs'

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')))
const SEED = Number(args.seed ?? 7)
const OUT = args.out ?? 'preview'
const Wpx = Number(args.w ?? 768), Hpx = Number(args.h ?? 432)

export const GOTHIC_ARCADE = {
  seed: SEED,
  plot: { z0: -2, z1: 38 },
  line: { x: 8.6 },
  bay: { width: [3.98, 4.02] },
  column: { slenderness: [7, 10], taper: [0.78, 0.86] },
  spring: { ratio: [1.15, 1.45] },
  arch: { pointiness: [0.78, 0.95], rRatio: [0.55, 0.75] },
  spandrel: { ratio: [0.28, 0.42] },
  cornice: { rRatio: [0.55, 0.75] },
  wall: { thickness: [0.10, 0.14] },
  buttress: { rhythm: 2, depthRatio: [0.5, 0.65], taper: [0.5, 0.65] },
  pinnacle: { hRatio: [0.45, 0.7] },
  tissue: { ratio: [0.45, 0.7] },
}
export const GOTHIC_GABLE = {
  seed: SEED + 100, line: { z: 39 }, plot: { width: 21 },
  steps: 4, heightRatio: [0.55, 0.66], stepShrink: [1.0, 1.4],
  thicknessRatio: [0.094, 0.096], pinnacleRatio: [0.5, 0.8], spireRatio: [0.28, 0.4],
}

const arcade = growArcade(GOTHIC_ARCADE)
const gable = growGable(GOTHIC_GABLE)
console.log('arcade:', JSON.stringify(Object.fromEntries(Object.entries(arcade.meta).filter(([k]) => k !== 'resolved').map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v]))))
console.log('gable meta:', JSON.stringify(Object.fromEntries(Object.entries(gable.meta).filter(([k]) => k !== 'resolved').map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v]))))

// scene: ground + mirrored arcades + gable (same composition VEILFIRE will use)
function sdScene(p) {
  let d = p[1]
  const q = [Math.abs(p[0]), p[1], p[2]]
  d = Math.min(d, sdGraphCellScheme(arcade, q))
  d = Math.min(d, sdGraphCellScheme(gable, p))
  return d
}

// camera — VEILFIRE's exact convention
const RO = [0, 4.5, -14], TA = [0, 4.8, 20], FOV = 0.85
const norm = (v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l] }
const fw = norm([TA[0] - RO[0], TA[1] - RO[1], TA[2] - RO[2]])
const rt = norm([fw[1] * 0 - fw[2] * 1, fw[2] * 0 - fw[0] * 0, fw[0] * 1 - fw[1] * 0]) // cross(fw,(0,1,0))
const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]]

const SUN = norm([-0.35, 0.62, -0.45])
const buf = Buffer.alloc(Wpx * Hpx * 3)
const t0 = Date.now()
for (let py = 0; py < Hpx; py++) {
  for (let px = 0; px < Wpx; px++) {
    const u = (px / Wpx * 2 - 1) * (Wpx / Hpx)
    const v = -(py / Hpx * 2 - 1)
    const rd = norm([fw[0] + FOV * (u * rt[0] + v * up[0]), fw[1] + FOV * (u * rt[1] + v * up[1]), fw[2] + FOV * (u * rt[2] + v * up[2])])
    let t = 0.02, hit = -1
    for (let i = 0; i < 110; i++) {
      const p = [RO[0] + rd[0] * t, RO[1] + rd[1] * t, RO[2] + rd[2] * t]
      const h = sdScene(p)
      if (h < 0.002 * t) { hit = t; break }
      t += Math.max(h * 0.9, 0.003)
      if (t > 90) break
    }
    let col
    if (hit < 0) {
      const g = Math.max(0, rd[1])
      col = [0.09 + 0.05 * (1 - g), 0.10 + 0.06 * (1 - g), 0.16 + 0.08 * (1 - g)]
    } else {
      const p = [RO[0] + rd[0] * hit, RO[1] + rd[1] * hit, RO[2] + rd[2] * hit]
      const e = 0.002 * Math.max(hit, 1)
      const n = norm([
        sdScene([p[0] + e, p[1], p[2]]) - sdScene([p[0] - e, p[1], p[2]]),
        sdScene([p[0], p[1] + e, p[2]]) - sdScene([p[0], p[1] - e, p[2]]),
        sdScene([p[0], p[1], p[2] + e]) - sdScene([p[0], p[1], p[2] - e]),
      ])
      const dif = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2])
      // cheap AO: two probes along the normal
      const ao1 = Math.min(1, sdScene([p[0] + n[0] * 0.3, p[1] + n[1] * 0.3, p[2] + n[2] * 0.3]) / 0.3)
      const ao2 = Math.min(1, sdScene([p[0] + n[0] * 0.9, p[1] + n[1] * 0.9, p[2] + n[2] * 0.9]) / 0.9)
      const ao = Math.max(0, Math.min(1, 0.35 + 0.65 * (0.5 * ao1 + 0.5 * ao2)))
      const sky = 0.5 + 0.5 * n[1]
      const isGround = p[1] < 0.02 && n[1] > 0.95
      const alb = isGround ? 0.45 : 0.92
      let c = alb * (0.20 * sky + 0.85 * dif) * ao
      const fog = Math.exp(-hit * 0.016)
      col = [c * 1.0 * fog + 0.10 * (1 - fog), c * 1.02 * fog + 0.11 * (1 - fog), c * 1.1 * fog + 0.17 * (1 - fog)]
    }
    const o = (py * Wpx + px) * 3
    buf[o] = Math.min(255, Math.pow(Math.max(0, col[0]), 1 / 2.2) * 255)
    buf[o + 1] = Math.min(255, Math.pow(Math.max(0, col[1]), 1 / 2.2) * 255)
    buf[o + 2] = Math.min(255, Math.pow(Math.max(0, col[2]), 1 / 2.2) * 255)
  }
}
console.log('render', Date.now() - t0, 'ms')
const ppm = Buffer.concat([Buffer.from(`P6\n${Wpx} ${Hpx}\n255\n`), buf])
writeFileSync(`${OUT}.ppm`, ppm)
try {
  execSync(`sips -s format png ${OUT}.ppm --out ${OUT}.png`, { stdio: 'ignore' })
  console.log('wrote', OUT + '.png')
} catch {
  console.log('wrote', OUT + '.ppm (no sips on this platform — any image viewer opens PPM)')
}
