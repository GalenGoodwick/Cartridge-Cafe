// movement (node: movement) — WASD free-walk + wall collision + camera.
// A step-hook FRAGMENT: vf-integrate composes it into the one hook and calls it
// FIRST each frame. Owns the player + camera on the whiteboard:
//   rows 1,2,3 = player x,y,z · row 4 = yaw · uni4(60)=camera ro,fov · uni4(61)=target
// Shared state on sim.worldData.__vf (version-guarded — the PIXELBURST lesson).
//
// Controls: W/S (moveY) walk fwd/back along yaw; A/D (moveX) turn (tank); the
// pointer also turns (mouse-look). Camera is first-person at eye height for now
// (no player body yet) — pull `camBack` > 0 for 3rd-person once a body exists.
//
// Collision is a COARSE walkable mask mirroring veilfire/rooms.wgsl's documented
// extents (nave + side chamber joined by the doorway), inset by the player
// radius. Cheap, and it wall-SLIDES (resolve x and z independently). One truth:
// if rooms.wgsl extents change, update WALK here.

const R = 0.4                                   // player radius (inset from walls)
function walkable(x, z) {
  const nave = x >= -4 + R && x <= 4 - R && z >= -9 + R && z <= 9 - R
  const side = x >= 5 + R && x <= 11 - R && z >= -3.5 + R && z <= 3.5 - R
  const door = x >= 3.3 && x <= 5.7 && z >= -1.5 + R && z <= 1.5 - R
  return nave || side || door
}

export function movement(sim, dt) {
  const wd = sim.worldData
  if (!wd.__vf) wd.__vf = {}
  const V = wd.__vf
  if (V.mv !== 1) { V.px = 0; V.py = 1.7; V.pz = -6; V.yaw = 0; V.mv = 1 }   // spawn in the nave
  const step = Math.min(dt, 1 / 30)
  const inp = wd.input || {}
  const mvY = inp.moveY || 0            // forward/back
  const mvX = inp.moveX || 0            // turn (tank)

  // turn: A/D + optional mouse-look (pointer x-offset from screen center)
  let turn = -mvX * 2.4
  const ptr = inp.pointer || {}
  if (ptr.down) { turn += (ptr.x / 256 - 1) * 2.2 }
  V.yaw += turn * step

  // walk forward along yaw (x=sin, z=cos so yaw 0 faces +z, down the nave)
  const fx = Math.sin(V.yaw), fz = Math.cos(V.yaw)
  const spd = 5.5
  const dx = fx * mvY * spd * step
  const dz = fz * mvY * spd * step
  // resolve axes independently → wall-slide instead of sticking
  let nx = V.px, nz = V.pz
  if (walkable(V.px + dx, V.pz)) nx = V.px + dx
  if (walkable(nx, V.pz + dz)) nz = V.pz + dz
  V.px = nx; V.pz = nz; V.py = 1.7      // flat floor, fixed eye height

  // camera (first-person at eye; 3rd-person = pull ro back along -fwd by camBack)
  const camBack = 0.0
  const ro = [V.px - fx * camBack, V.py, V.pz - fz * camBack]
  const ta = [V.px + fx * 2.0, V.py - 0.05, V.pz + fz * 2.0]
  const u = Array.isArray(wd.gpuUniforms) ? wd.gpuUniforms : new Array(256).fill(0)
  while (u.length < 256) u.push(0)
  u[1] = V.px; u[2] = V.py; u[3] = V.pz; u[4] = V.yaw
  u[240] = ro[0]; u[241] = ro[1]; u[242] = ro[2]; u[243] = 1.2
  u[244] = ta[0]; u[245] = ta[1]; u[246] = ta[2]; u[247] = 0
  wd.gpuUniforms = u
}
