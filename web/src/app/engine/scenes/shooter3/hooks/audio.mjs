// audio (node: audio) — event-driven sfx flags. Fragment run last. Sets
// worldData.__play_sound on fire/hit/death edges (edge-guarded so it fires once
// per event). Music bed is left to the world author (no bundled asset here); a
// dread swell rides row 12. Harmless if the host ignores unknown sound names.
export function audio(sim, dt) {
  const wd = sim.worldData
  const V = wd.__vf
  // fire edge
  if ((V.muzzle || 0) > 0.9 && !V._af) { wd.__play_sound = { name: 'shot' }; V._af = 1 }
  else if ((V.muzzle || 0) < 0.3) V._af = 0
  // hit/death edge (a fresh hitFlash spike)
  if ((V.hitFlash || 0) > 0.8 && !V._ah) { wd.__play_sound = { name: 'impact' }; V._ah = 1 }
  else if ((V.hitFlash || 0) < 0.3) V._ah = 0
  // dread swells with nearby demons (fed to row 12 for the HUD vignette)
  let near = 0
  if (V.en) for (const e of V.en) { if (e.hp > 0 && Math.hypot((V.px || 0) - e.x, (V.pz || 0) - e.z) < 4.0) near++ }
  V.dread = Math.max(0, Math.min(1, near * 0.3))
  const u = wd.gpuUniforms
  if (u) u[12] = V.dread
}
