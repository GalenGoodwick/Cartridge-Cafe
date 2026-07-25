// movement (node: movement) — v2. WASD + mouse-look + jump. A step-hook FRAGMENT
// run FIRST each frame. Owns player + camera on the whiteboard:
//   rows 1,2,3 = x,y,z · row 4 = yaw · row 5 = pitch · uni4(60)=ro,fov · uni4(61)=target
//
// v2 controls (standard FPS): MOUSE looks (yaw+pitch by pointer delta), W/S walk,
// A/D STRAFE, SPACE jumps (gravity + ground). Fire moved to click (projectiles).
// Collision: coarse walkable mask mirroring veilfire/rooms.wgsl extents, wall-slid.
// (KNOWN: columns/dais aren't blockers yet — the clip fix is a rooms+movement mod.)

const R = 0.4
// solids that must BLOCK the player — mirrors rooms.wgsl's colonnade (two rows at
// x=±3.2, columns every 4 in z, r=0.4). One truth, two callers; the principled
// version is rooms exporting a JS collision fn (next mod). Dais step-up (floor
// height) is a separate movement feature — TODO.
function blocked(x, z) {
  const cr = 0.4 + R
  for (const cx of [-3.2, 3.2]) {
    for (const cz of [-8, -4, 0, 4, 8]) {
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < cr * cr) return true
    }
  }
  return false
}
function walkable(x, z) {
  const nave = x >= -4 + R && x <= 4 - R && z >= -9 + R && z <= 9 - R
  const side = x >= 5 + R && x <= 11 - R && z >= -3.5 + R && z <= 3.5 - R
  const door = x >= 3.3 && x <= 5.7 && z >= -1.5 + R && z <= 1.5 - R
  return (nave || side || door) && !blocked(x, z)
}

export function movement(sim, dt) {
  const wd = sim.worldData
  if (!wd.__vf) wd.__vf = {}
  const V = wd.__vf
  if (V.mv !== 2) { V.px = 0; V.py = 1.7; V.pz = -6; V.yaw = 0; V.pitch = 0; V.vy = 0; V.ground = 1; V.lx = null; V.ly = null; V.mv = 2 }
  const step = Math.min(dt, 1 / 30)
  const inp = wd.input || {}
  const ptr = inp.pointer || {}

  // MOUSE-LOOK — yaw + pitch by pointer delta (absolute pointer, so we diff frames)
  if (V.lx == null) { V.lx = ptr.x != null ? ptr.x : 256; V.ly = ptr.y != null ? ptr.y : 256 }
  const px = ptr.x != null ? ptr.x : V.lx, py = ptr.y != null ? ptr.y : V.ly
  const sens = 0.006
  V.yaw += (px - V.lx) * sens
  V.pitch = Math.max(-1.2, Math.min(1.2, V.pitch - (py - V.ly) * sens))
  V.lx = px; V.ly = py

  // MOVE — W/S forward along yaw, A/D strafe along the right vector
  const fx = Math.sin(V.yaw), fz = Math.cos(V.yaw)
  const rx = Math.cos(V.yaw), rz = -Math.sin(V.yaw)
  const spd = 5.5, mF = inp.moveY || 0, mS = inp.moveX || 0
  const dx = (fx * mF + rx * mS) * spd * step
  const dz = (fz * mF + rz * mS) * spd * step
  let nx = V.px, nz = V.pz
  if (walkable(V.px + dx, V.pz)) nx = V.px + dx
  if (walkable(nx, V.pz + dz)) nz = V.pz + dz
  V.px = nx; V.pz = nz

  // JUMP — Space (input.action edge) when grounded; gravity pulls back to eye height
  if (inp.action && V.ground) { V.vy = 4.4; V.ground = 0 }
  V.vy -= 12.0 * step
  V.py += V.vy * step
  if (V.py <= 1.7) { V.py = 1.7; V.vy = 0; V.ground = 1 }

  // CAMERA — first-person eye; look dir folds pitch in
  const cp = Math.cos(V.pitch), sp = Math.sin(V.pitch)
  const ta = [V.px + fx * cp * 2.0, V.py + sp * 2.0, V.pz + fz * cp * 2.0]
  const u = Array.isArray(wd.gpuUniforms) ? wd.gpuUniforms : new Array(256).fill(0)
  while (u.length < 256) u.push(0)
  u[1] = V.px; u[2] = V.py; u[3] = V.pz; u[4] = V.yaw; u[5] = V.pitch
  u[240] = V.px; u[241] = V.py; u[242] = V.pz; u[243] = 1.2
  u[244] = ta[0]; u[245] = ta[1]; u[246] = ta[2]; u[247] = 0
  wd.gpuUniforms = u
}
