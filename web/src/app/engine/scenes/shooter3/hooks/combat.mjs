// combat (node: combat) — hit detection + health + score. Fragment run after
// projectiles. Player bolts vs demons (__vf.en) → damage/kill + score + death
// event; demon strikes (__vf.hits from enemies) → player HP down + hit-flash +
// shake; gameState → dead at 0. Pure sim; owns rows 6 (HP), 8 (score),
// 16 (hitFlash), 17 (shake), 14 (gameState).
export function combat(sim, dt) {
  const wd = sim.worldData
  const V = wd.__vf
  const step = Math.min(dt, 1 / 30)
  if (V.score == null) V.score = 0
  if (V.hp == null) V.hp = 1.0
  if (!V.deaths) V.deaths = []
  // player bolts vs demons
  if (V.bolts && V.en) {
    for (const b of V.bolts) {
      if (b.life <= 0) continue
      for (const e of V.en) {
        if (e.hp <= 0) continue
        const dx = b.x - e.x, dy = b.y - 1.0, dz = b.z - e.z
        if (dx * dx + dy * dy + dz * dz < 0.85 * 0.85) {
          e.hp -= 0.5; b.life = 0; V.hitFlash = 0.55
          if (e.hp <= 0) { V.score += 100; V.deaths.push({ x: e.x, y: 1.0, z: e.z }) }
          break
        }
      }
    }
  }
  // demon strikes vs player
  if (V.hits) for (const h of V.hits) { V.hp = Math.max(0, V.hp - h.dmg); V.hitFlash = 0.9; V.shake = 0.5 }
  V.hitFlash = Math.max(0, (V.hitFlash || 0) - step * 3)
  V.shake = Math.max(0, (V.shake || 0) - step * 2)
  V.game = V.hp <= 0 ? 1 : 0
  const u = wd.gpuUniforms
  if (u) { u[6] = V.hp; u[8] = V.score; u[16] = V.hitFlash; u[17] = V.shake; u[14] = V.game }
}
