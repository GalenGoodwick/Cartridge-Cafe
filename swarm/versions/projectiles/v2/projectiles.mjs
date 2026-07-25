// projectiles (node: projectiles) — fire + travel + expire. Fragment run after
// enemies. Fires on click/space from the player along yaw; bolts (kind 3) fly
// straight, expire by life; pushed to __vf.pop for the renderer + kept in
// __vf.bolts for combat's hit-test. Owns ammo (row 7) + muzzle flash (row 15).
export function projectiles(sim, dt) {
  const wd = sim.worldData
  const V = wd.__vf
  const step = Math.min(dt, 1 / 30)
  if (!V.bolts) V.bolts = []
  if (V.ammo == null) V.ammo = 24
  if (V.reload == null) V.reload = 0
  V.reload = Math.max(0, V.reload - step)
  const inp = wd.input || {}
  const firing = !!(inp.pointer && inp.pointer.pressed)   // click to fire (Space is jump now)
  if (firing && V.reload <= 0 && V.ammo > 0) {
    const yaw = V.yaw || 0
    const fx = Math.sin(yaw), fz = Math.cos(yaw)
    V.bolts.push({ x: (V.px || 0) + fx * 0.4, y: 1.55, z: (V.pz || 0) + fz * 0.4, dx: fx * 22, dz: fz * 22, life: 1.4 })
    V.ammo -= 1; V.reload = 0.13; V.muzzle = 1.0
  }
  V.muzzle = Math.max(0, (V.muzzle || 0) - step * 6)
  const alive = []
  for (const b of V.bolts) {
    b.life -= step
    if (b.life <= 0) continue
    b.x += b.dx * step; b.z += b.dz * step
    alive.push(b)
    V.pop.push(b.x, b.y, b.z, 3.0, Math.max(0, Math.min(1, b.life / 1.4)), 0, 0, 0)
  }
  V.bolts = alive
  const u = wd.gpuUniforms
  if (u) { u[7] = V.ammo; u[15] = V.muzzle }
}
