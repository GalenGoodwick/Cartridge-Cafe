const wd = sim.worldData
wd.__resets = ['__b2']

// ── BLANK 2D — the dimension substrate (DESIGN-multiplayer-worldbuilding §7).
// A WORKING 2D world with nothing in it: input plumbed (keys AND touch — this
// blank is mobile-ready from birth), a camera that follows, a render loop, one
// avatar dot proving it all runs. No physics, no goals, no level — that's what
// forks are for. Fork this, and everything you add is yours.

if (!wd.__b2 || wd.__b2.v !== 1) wd.__b2 = {
  v: 1, t: 0,
  x: 256, y: 256,            // the avatar — the proof the world is alive
  camX: 256, camY: 256,
  px: 0, py: 0, ptr: 0,      // pointer state (touch drag = mobile movement)
}
const G = wd.__b2
const step = Math.min(dt, 1 / 30)
G.t += step

// ── input: arrows/WASD… ──
const inp = wd.input || { moveX: 0, moveY: 0, pointer: {} }
const SPEED = 220
G.x += (inp.moveX || 0) * SPEED * step
G.y -= (inp.moveY || 0) * SPEED * step   // engine y is screen-down; moveY up = negative

// ── …and TOUCH: drag anywhere, the dot follows (the mobile contract) ──
const p = inp.pointer || {}
if (p.down && typeof p.x === 'number') {
  G.px = p.x; G.py = p.y; G.ptr = 1
  const ddx = p.x - G.x, ddy = p.y - G.y
  const dd = Math.hypot(ddx, ddy)
  if (dd > 4) { G.x += (ddx / dd) * Math.min(dd * 4, 420) * step; G.y += (ddy / dd) * Math.min(dd * 4, 420) * step }
} else G.ptr = 0

// ── the world has edges (forks re-shape or remove them) ──
G.x = Math.max(8, Math.min(504, G.x))
G.y = Math.max(8, Math.min(504, G.y))

// ── camera: eases after the avatar — replace with your own framing ──
G.camX += (G.x - G.camX) * (1 - Math.exp(-4 * step))
G.camY += (G.y - G.camY) * (1 - Math.exp(-4 * step))

// pin the canvas field
for (const f of sim.fields.values()) {
  if ((f.name || '') === 'Blank2D') { const T = f.transform; T.x = 256; T.y = 256; T.vx = 0; T.vy = 0 }
}

// ── publish the whiteboard: [t, avatarX, avatarY, camX, camY, ptrDown] ──
const U = new Array(8).fill(0)
U[0] = G.t; U[1] = G.x; U[2] = G.y; U[3] = G.camX; U[4] = G.camY; U[5] = G.ptr
wd.gpuUniforms = U

wd.hud = [
  { id: 'b2_hud', type: 'text', x: '2%', y: '2%',
    text: 'BLANK 2D · move: arrows/WASD or drag · this world is a starting point — FORK IT',
    fontSize: '13px', color: '#ffd9a0' },
]
