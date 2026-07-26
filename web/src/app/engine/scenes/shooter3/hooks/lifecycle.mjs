// lifecycle (node: lifecycle) — game reset on death. Run after combat. When the
// player's HP hits 0 (combat sets game=1), hold a beat, then respawn: restore
// HP/ammo/score/position, clear bolts + embers, wipe enemies so they respawn.
// Owns the death→reset transition; writes gameState (row 14) for the HUD.
export function lifecycle(sim, dt) {
  const wd = sim.worldData
  const V = wd.__vf
  const step = Math.min(dt, 1 / 30)
  if ((V.hp != null && V.hp <= 0) || V.game === 1) {
    V.dead = (V.dead || 0) + step
    if (V.dead > 2.2) {                 // ~2.2s on the death screen, then respawn
      V.hp = 1.0; V.score = 0; V.ammo = 24
      V.px = 0; V.py = 1.7; V.pz = -6; V.yaw = 0; V.pitch = 0; V.vy = 0; V.ground = 1
      V.en = null; V.bolts = []; V.bits = []; V.hits = []
      V.dead = 0; V.game = 0
    }
  } else {
    V.dead = 0
  }
  const u = wd.gpuUniforms
  if (u) { u[14] = V.game || 0; u[22] = V.dead || 0 }   // 14 gameState · 22 death-fade (HUD)
}
