// death-fx (node: death-fx) — ember death bursts (the pixelburst idea in 3D).
// Fragment run after combat. On each death event, emit ember bits (kind 5) that
// arc up, fall under gravity, and cool out; pushed to __vf.pop. Renderer colors
// kind 5 as ember by heat.
export function deathfx(sim, dt) {
  const wd = sim.worldData
  const V = wd.__vf
  const step = Math.min(dt, 1 / 30)
  if (!V.bits) V.bits = []
  if (V.deaths) {
    for (const d of V.deaths) {
      for (let i = 0; i < 22; i++) {
        const a = i * 0.618 * 6.283, up = 1.6 + (i % 5) * 0.5, out = 1.0 + (i % 7) * 0.28
        V.bits.push({ x: d.x, y: d.y, z: d.z, dx: Math.cos(a) * out, dy: up, dz: Math.sin(a) * out, age: 0, life: 0.6 + (i % 4) * 0.12 })
      }
    }
    V.deaths = []
  }
  const alive = []
  for (const p of V.bits) {
    p.age += step
    if (p.age >= p.life) continue
    p.dy -= 7.0 * step
    p.x += p.dx * step; p.y += p.dy * step; p.z += p.dz * step
    if (p.y < 0.05) { p.y = 0.05; p.dy = 0 }
    alive.push(p)
    V.pop.push(p.x, p.y, p.z, 5.0, Math.max(0, 1 - p.age / p.life), 0, 0, 0)
  }
  V.bits = alive
}
