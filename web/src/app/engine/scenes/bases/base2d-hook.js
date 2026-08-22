const wd = sim.worldData
if (wd.__cf) { delete wd.__cf }
wd.__resets = ['__dg', '__trig']
if (wd.__fresh) { delete wd.__fresh }

// ── THE TERRAIN — mirrored exactly from mod_cf_h in cf_lib. One truth. ──
const sm01 = t => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c) }
const mixN = (a, b, m) => a + (b - a) * m
// THE FLAT BASE — one truth with mod_cf_h in cf_lib: level design begins where
// this stops returning zero. Fork the base, shape this, ship your fell.
const terrainH = x => 0
const iceAt = x => 0
const dH = x => (terrainH(x + 2) - terrainH(x - 2)) * 0.25
const DOORS = [620, 1520, 2290, 3390, 4250]

// frost gloomies per stretch of the fell: [x, floatOff, patrolRange, patrolSpeed]
// the foe SYSTEM stays (patrol, decay, bounce-kill) — the ROSTER is yours to
// design. Add [x, floatOff, patrolRange, patrolSpeed] entries per level.
const FOES = [[], [], [], [], []]
const buildFoes = lv => (FOES[lv] || []).map((f, i) => ({ x0: f[0], off: f[1], rng: f[2], sp: f[3], ph: i * 2.13, x: f[0], st: 1 }))

if (!wd.__dg || wd.__dg.v !== 2) wd.__dg = {
  v: 2, t: 0, lv: 0,
  x: 0, y: terrainH(0) + 20, vx: 0, vy: 0, roll: 0, grounded: 0, airT: 0,
  camX: 0, camY: 40, intro: 0,
  lit: [0, 0, 0, 0, 0], litAnim: [0, 0, 0, 0, 0], dawn: 0, warmth: 0, dawnSung: false,
  grab: 0, ax: 0, ay: 0, sx: 0, sy: 0, ptrWasDown: false,
  stoke: 0, landP: 0, squishA: 0, flings: 0, door: 0, doorSung: false,
  foes: buildFoes(0),
  gustT: 3, gustA: 0, gustSign: -1, gustLife: 0, wind: 0,
}
const G = wd.__dg
const step = Math.min(dt, 1 / 30)
G.t += step
G.intro = Math.min(1, G.intro + step * 0.5)
const snd = []

// chapters stripped — a fork defines its own (sim.defineChapters([...]))

// ── wind: a slow body + gusts that arrive like weather (kept from cinderfell) ──
G.gustT -= step
if (G.gustT <= 0) {
  G.gustT = 7 + (Math.sin(G.t * 7.13) * 0.5 + 0.5) * 9
  G.gustA = 120 + (Math.sin(G.t * 3.7) * 0.5 + 0.5) * 90
  G.gustSign = Math.sin(G.t * 1.93) > 0.25 ? 1 : -1
  G.gustLife = 2.6
}
G.gustLife = Math.max(0, (G.gustLife || 0) - step)
const gustEnv = sm01(G.gustLife / 0.6) * sm01((2.6 - G.gustLife) / 0.6)
G.wind = Math.sin(G.t * 0.10) * 26 + Math.sin(G.t * 0.043 + 2) * 20 + G.gustSign * G.gustA * gustEnv

// ── pointer → world space (camera at camX,camY; screen half-width 300, y flips) ──
const ptr = (wd.input && wd.input.pointer) || {}
const pDown = ptr.down !== undefined ? !!ptr.down : !!wd.mouse_down
const pgx = ptr.x !== undefined ? ptr.x : (wd.mouse_x || 256)
const pgy = ptr.y !== undefined ? ptr.y : (wd.mouse_y || 256)
const pwx = G.camX + (pgx / 256 - 1) * 300
const pwy = G.camY - (pgy / 256 - 1) * 300
const pPressed = ptr.pressed || (pDown && !G.ptrWasDown)
G.ptrWasDown = pDown

// ── grab (dragstart) · stretch (drag) · fling (dragend) ──
// press ANYWHERE grabs the pup; the stretch is relative to where you pressed,
// so no precision aiming at a small bouncy dog is ever needed
const RAD = 14, MAXSTRETCH = 150, FLINGK = 6.8
if (pPressed && !G.grab) {
  G.grab = 1; G.ax = G.x; G.ay = G.y; G.px0 = pwx; G.py0 = pwy; G.vx = 0; G.vy = 0
  snd.push({ frequency: 300, duration: 0.06, volume: 0.10, type: 'triangle' })
}
if (G.grab) {
  if (pDown) {
    let sx = pwx - G.px0, sy = pwy - G.py0
    const sl = Math.hypot(sx, sy)
    if (sl > MAXSTRETCH) { sx *= MAXSTRETCH / sl; sy *= MAXSTRETCH / sl }
    G.sx = sx; G.sy = sy
    G.x = G.ax + sx; G.y = G.ay + sy
  } else {
    // dragend: fling from the LAST dragged stretch — release events can
    // arrive without coordinates, so never recompute from the pointer here
    G.grab = 0
    G.x = G.ax; G.y = G.ay
    if (Math.hypot(G.sx, G.sy) > 16) {
      G.vx = -G.sx * FLINGK; G.vy = -G.sy * FLINGK
      G.flings++
      const pw = Math.min(1, Math.hypot(G.sx, G.sy) / MAXSTRETCH)
      snd.push({ frequency: 160 + pw * 180, duration: 0.18, volume: 0.20, type: 'triangle' })
    } else { G.vx = 0; G.vy = 0 }
    G.sx = 0; G.sy = 0
  }
}

// ── physics: semi-implicit Euler vs the height field (kept; bouncier for a rubbery pup) ──
const GRAV = 780, REST = 0.5, VMAX = 1150
if (!G.grab) {
  G.vy -= GRAV * step
  G.vx += (G.wind - G.vx) * (G.grounded ? 0.05 : 0.12) * step
  if (G.vx > VMAX) G.vx = VMAX; else if (G.vx < -VMAX) G.vx = -VMAX
  if (G.vy > 1400) G.vy = 1400; else if (G.vy < -1400) G.vy = -1400
  G.x += G.vx * step
  G.y += G.vy * step

  const h = terrainH(G.x)
  G.grounded = 0
  const pen = (h + RAD) - G.y
  if (pen > 0) {
    const s = dH(G.x)
    const inv = 1 / Math.sqrt(1 + s * s)
    const nx = -s * inv, ny = inv
    G.x += nx * pen * ny; G.y += ny * pen
    const vn = G.vx * nx + G.vy * ny
    if (vn < 0) {
      const impact = -vn
      G.vx -= nx * vn * (1 + REST); G.vy -= ny * vn * (1 + REST)
      if (impact > 120 && G.airT > 0.15) {
        G.landP = Math.min(1, impact / 480)
        G.squishA = Math.atan2(ny, nx)
        snd.push({ frequency: 60 + Math.min(50, impact * 0.07), duration: 0.14, volume: Math.min(0.28, impact / 1500), type: 'sine' })
      }
    }
    const tx = ny, ty = -nx
    let vt = G.vx * tx + G.vy * ty
    const mu = mixN(2.6, 0.12, iceAt(G.x))
    vt *= Math.exp(-mu * step)
    const vn2 = G.vx * nx + G.vy * ny
    G.vx = tx * vt + nx * vn2; G.vy = ty * vt + ny * vn2
    G.grounded = 1
    G.airT = 0
  } else { G.airT += step }
  G.roll += (G.vx / RAD) * step
}
G.landP = Math.max(0, G.landP - step * 2.5)

// ── frost gloomies: patrol, decay, and get bounced into ──
let alive = 0
for (const e of G.foes) {
  if (e.st >= 1) {
    e.ph += step * e.sp
    e.x = e.x0 + Math.sin(e.ph) * e.rng
    e.y = terrainH(e.x) + 13 + e.off + (e.off > 0 ? Math.sin(G.t * 2 + e.ph) * 8 : 0)
    alive++
  } else if (e.st > 0) { e.st -= step * 2 }
}
if (!G.grab) {
  for (const e of G.foes) {
    if (e.st < 1) continue
    const ddx = G.x - e.x, ddy = G.y - e.y
    const dd = Math.hypot(ddx, ddy)
    if (dd < RAD + 13) {
      const spd = Math.hypot(G.vx, G.vy)
      const nx = ddx / (dd || 1), ny = ddy / (dd || 1)
      if (spd > 90) {
        e.st = 0.999
        const vn = G.vx * nx + G.vy * ny
        if (vn < 0) { G.vx -= 1.6 * vn * nx; G.vy -= 1.6 * vn * ny }
        G.vy += 90
        G.landP = Math.max(G.landP, 0.6)
        G.squishA = Math.atan2(ny, nx)
        snd.push({ frequency: 660, duration: 0.10, volume: 0.18, type: 'square' })
        snd.push({ frequency: 990, duration: 0.16, volume: 0.12, type: 'sine' })
      } else {
        G.x = e.x + nx * (RAD + 13); G.y = e.y + ny * (RAD + 13)
      }
    }
  }
}

// ── level structure (doors/beacons/chapters) stripped — the base is FLAT.
// Bounds only: the fell still has edges and a floor rescue.
const doorX = 0
const doorOpen = false
if (!G.grab) {
  if (G.x < -120) { G.x = -120; G.vx = Math.max(0, G.vx) }
  if (G.x > 4600) { G.x = 4600; G.vx = Math.min(0, G.vx) }
  if (G.y < -400) { G.y = terrainH(G.x) + RAD + 2; G.vy = 0 }
}

// ── dawn rises with the lit beacons ──
let litCount = 0
for (let i = 0; i < 5; i++) {
  if (G.lit[i]) litCount++
  G.litAnim[i] = mixN(G.litAnim[i], G.lit[i], 1 - Math.exp(-2.2 * step))
}
G.warmth = mixN(G.warmth, litCount / 5, 1 - Math.exp(-0.8 * step))
const finale = litCount === 5
G.dawn = mixN(G.dawn, finale ? 1 : 0, 1 - Math.exp(-0.28 * step))
if (finale && !G.dawnSung) {
  G.dawnSung = true
  snd.push({ frequency: 196, duration: 2.2, volume: 0.2, type: 'sine' })
  snd.push({ frequency: 294, duration: 2.2, volume: 0.16, type: 'sine' })
  snd.push({ frequency: 392, duration: 2.6, volume: 0.14, type: 'sine' })
  snd.push({ frequency: 588, duration: 3.0, volume: 0.10, type: 'sine' })
}

// ── styling signals for the shader ──
const spd = Math.hypot(G.vx, G.vy)
G.stoke = mixN(G.stoke, sm01((spd - 250) / 400), 1 - Math.exp(-4 * step))
const heat = 0.5 + G.stoke * 0.3
let scaleAlong = 1 + Math.min(spd / 1400, 0.30)
let scaleAng = Math.atan2(G.vy, G.vx)
if (G.landP > 0.05) { scaleAlong = 1 - 0.45 * G.landP; scaleAng = G.squishA }
if (G.grab) { scaleAlong = 1; scaleAng = 0 }
if (Math.abs(G.vx) > 25) G.face = Math.sign(G.vx)
if (G.face === undefined) G.face = 1
const hungry = (G.lv < 5 && alive > 0 && Math.abs(G.x - doorX) < 140) ? 1 : 0

// ── camera: terrain-weighted, leads the motion (kept from cinderfell) ──
const lookX = G.x + G.vx * 0.30
const lookY = mixN(G.y, terrainH(G.x), 0.72) + 85
G.camX += (Math.max(-40, Math.min(4520, lookX)) - G.camX) * (1 - Math.exp(-3.2 * step))
G.camY += (lookY - G.camY) * (1 - Math.exp(-2.6 * step))

// pin the canvas field
for (const f of sim.fields.values()) {
  if ((f.name || '') === 'Base2D') { const T = f.transform; T.x = 256; T.y = 256; T.vx = 0; T.vy = 0 }
}

// ── publish the whiteboard ──
const U = new Array(40).fill(0)
U[0] = G.t; U[1] = G.x; U[2] = G.y; U[3] = G.roll
U[4] = G.vx; U[5] = G.vy; U[6] = G.grounded; U[7] = heat
U[8] = G.camX; U[9] = G.camY; U[10] = G.wind; U[11] = G.dawn
U[12] = G.warmth
for (let i = 0; i < 5; i++) U[13 + i] = G.litAnim[i]
U[18] = 0; U[19] = G.landP; U[20] = G.stoke
U[21] = finale ? 1 : 0; U[22] = iceAt(G.x); U[23] = hungry
U[24] = G.intro
U[25] = G.grab; U[26] = G.ax; U[27] = G.ay
U[28] = G.grab ? Math.min(1, Math.hypot(G.sx, G.sy) / MAXSTRETCH) : 0
U[29] = doorX; U[30] = G.door; U[31] = alive
U[32] = G.lv; U[33] = G.flings; U[34] = G.face
U[35] = scaleAng; U[36] = scaleAlong
U[37] = pwx; U[38] = pwy
wd.gpuUniforms = U

const P = []
for (const e of G.foes) { if (e.st > 0) P.push(e.x, e.y, e.ph, e.st) }
wd.gpuPopulation = P

wd.hud = [
  { id: 'base_hud', type: 'text', x: '2%', y: '2%',
    text: 'PLATFORMER 2D BASE · run ←→ · jump W/space · grab+fling with the pointer · FLINGS ' + G.flings,
    fontSize: '13px', color: '#ffd9a0' },
]
if (snd.length) wd.__play_sound = snd
