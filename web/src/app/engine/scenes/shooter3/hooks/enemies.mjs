// enemies (node: enemies) — the baddie AI. A step-hook FRAGMENT run after
// movement. Spawns demons in the rooms, seeks the player, faces them, advances
// the gait phase with speed, and telegraphs + strikes in range.
//
// POPULATION CONTRACT (SPEC): each enemy = TWO entries pushed to the shared
// sim.worldData.__vf.pop (vf-integrate clears it each frame and flushes to
// wd.gpuPopulation): (x, y=0, z, kind=1) , (hp01, gaitPhase, yaw, atkFlag).
// Reads the player at __vf.px/__vf.pz (movement owns those). Sets __vf.hits for
// combat: an entry per striking enemy so combat can damage the player.

export function enemies(sim, dt) {
  const wd = sim.worldData
  if (!wd.__vf) wd.__vf = {}
  const V = wd.__vf
  const step = Math.min(dt, 1 / 30)
  if (!V.en) {
    V.en = [                                   // spawn in nave + side chamber
      { x: 1.5, z: 5, ph: 0.0, hp: 1, atk: 0 },
      { x: -2.0, z: 8, ph: 1.5, hp: 1, atk: 0 },
      { x: 2.5, z: -1, ph: 3.0, hp: 1, atk: 0 },
      { x: 7.5, z: 0, ph: 0.7, hp: 1, atk: 0 },
    ]
  }
  const px = V.px ?? 0, pz = V.pz ?? -6
  if (!V.pop) V.pop = []
  V.hits = []
  const ATK = 1.7                              // strike range
  for (const e of V.en) {
    if (e.hp <= 0) continue
    const dx = px - e.x, dz = pz - e.z
    const dist = Math.hypot(dx, dz) || 0.0001
    const yaw = Math.atan2(dx, dz)             // face the player (heading +z)
    if (dist > ATK) {
      const sp = 1.8
      e.x += (dx / dist) * sp * step
      e.z += (dz / dist) * sp * step
      e.ph += (sp / 1.2) * step                // planted-foot gait advances with speed
      e.atk = Math.max(0, e.atk - step * 1.5)
    } else {
      e.atk += step                            // wind up then strike
      e.ph += 0.4 * step
      if (e.atk >= 1.0) { V.hits.push({ dmg: 0.12, x: e.x, z: e.z }); e.atk = 0.2 }
    }
    V.pop.push(e.x, 0.0, e.z, 1.0, e.hp, e.ph, yaw, e.atk > 0.5 ? 1 : 0)
  }
}
