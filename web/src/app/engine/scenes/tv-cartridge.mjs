// TV — the call-shader proof. One CRT, four channels; every channel is a callable
// shader word (ch_static, ch_plasma, ch_pong, ch_boids), and two of them are fed by
// REAL algorithms running statefully in the hook (Pong plays itself; a boids flock
// murmurates). The screen doesn't know what a channel contains — it just calls it.
// This is the seed of the stdlib: package these as define_module words and any
// world can put a television in a room with three lines.
//
//   CLICK or SPACE — change the channel (static burst between programs)
//   Whiteboard: uni0 channel · uni1 switch-static · uni3-8 pong · uni10..41 boids
//   Save+load: node tv-cartridge.mjs   (then reload /engine, pick TV)

const NB = 16   // boids

const WORLD = /* wgsl */`
// ── the channel words: each is a callable shader — signature (q: -1..1 screen, t) ──

fn ch_static(q: vec2f, t: f32) -> vec3f {
  let n = hash21(floor(q * vec2f(160.0, 120.0)) + floor(t * 60.0) * 7.3);
  var v = 0.25 + 0.75 * n;
  // rolling tear bar
  let bar = fract(q.y * 0.5 - t * 0.35);
  if (bar < 0.06) { v *= 0.45; }
  return vec3f(v);
}

fn ch_plasma(q: vec2f, t: f32) -> vec3f {
  var v = sin(q.x * 6.0 + t * 1.2);
  v += sin((q.y * 5.0 + t) * 0.8);
  v += sin((q.x + q.y) * 4.0 + t * 0.7);
  v += sin(length(q * 5.0) - t * 1.5);
  v *= 0.25;
  return vec3f(0.5 + 0.5 * sin(6.2831 * v), 0.5 + 0.5 * sin(6.2831 * v + 2.1), 0.5 + 0.5 * sin(6.2831 * v + 4.2));
}

fn ch_pong(q: vec2f, t: f32) -> vec3f {
  var col = vec3f(0.02, 0.03, 0.02);
  // net
  if (abs(q.x) < 0.012 && fract(q.y * 5.0) < 0.55) { col = vec3f(0.35); }
  // paddles (hook-simulated)
  if (abs(q.x + 0.85) < 0.03 && abs(q.y - uni(5)) < 0.16) { col = vec3f(1.4); }
  if (abs(q.x - 0.85) < 0.03 && abs(q.y - uni(6)) < 0.16) { col = vec3f(1.4); }
  // ball
  if (abs(q.x - uni(3)) < 0.035 && abs(q.y - uni(4)) < 0.045) { col = vec3f(1.8); }
  // score pips
  for (var i = 0; i < 5; i++) {
    if (f32(i) < uni(7) && length(q - vec2f(-0.5 + f32(i) * 0.08, -0.85)) < 0.022) { col = vec3f(1.0); }
    if (f32(i) < uni(8) && length(q - vec2f(0.5 - f32(i) * 0.08, -0.85)) < 0.022) { col = vec3f(1.0); }
  }
  return col;
}

fn ch_boids(q: vec2f, t: f32) -> vec3f {
  var col = mix(vec3f(0.03, 0.05, 0.10), vec3f(0.10, 0.14, 0.22), q.y * -0.5 + 0.5);
  // moon
  col += vec3f(0.5, 0.5, 0.42) * exp(-length(q - vec2f(0.55, -0.55)) * 9.0);
  // the flock (hook-simulated)
  for (var i = 0; i < ${NB}; i++) {
    let b = vec2f(uni(10 + i * 2), uni(11 + i * 2));
    let d = length(q - b);
    if (d < 0.028) { col = vec3f(0.02); }                    // bird body
    col += vec3f(0.05, 0.05, 0.04) * exp(-d * 40.0);         // faint presence
  }
  return col;
}

fn visual_tv_set(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let p = (uv + vec2f(1.0)) * 256.0;
  let t = time;

  // the room: dark, lit by the set
  var col = vec3f(0.012, 0.011, 0.015) * (1.0 + 0.35 * fbm3(p * 0.01));

  let C = vec2f(256.0, 238.0);
  let half = vec2f(172.0, 122.0);
  let dBez = sdRoundedBox(p - C, half + vec2f(22.0, 26.0), 14.0);
  let dScr = sdRoundedBox(p - C, half, 10.0);

  // glow spill on the room
  let flick = 0.94 + 0.06 * sin(t * 47.0) * sin(t * 31.0);
  col += vec3f(0.10, 0.12, 0.16) * flick * exp(-max(dBez, 0.0) * 0.02);

  // bezel: warm plastic with a highlight
  if (dBez < 0.0 && dScr >= 0.0) {
    col = mix(vec3f(0.10, 0.085, 0.07), vec3f(0.16, 0.14, 0.12), fbm3(p * 0.15) * 0.5);
    col *= 0.8 + 0.4 * smoothstep(20.0, -30.0, p.y - (C.y - half.y));
    // channel knob
    let kd = length(p - (C + vec2f(half.x + 8.0, half.y + 14.0)));
    if (kd < 7.0) {
      col = vec3f(0.05);
      let ka = 6.2831 * uni(0) / 4.0 - 1.57;
      if (length(p - (C + vec2f(half.x + 8.0, half.y + 14.0)) - vec2f(cos(ka), sin(ka)) * 4.0) < 1.6) { col = vec3f(0.7); }
    }
  }

  // the screen: barrel-distorted, phosphor, scanlines — a CRT calling a channel
  if (dScr < 0.0) {
    var q = (p - C) / half;                                   // -1..1
    q *= 1.0 + 0.10 * dot(q, q);                              // barrel
    if (abs(q.x) > 1.0 || abs(q.y) > 1.0) {
      col = vec3f(0.0);                                       // over-scan black
    } else {
      // ── THE CALL: channel word by number ──
      let ch = i32(uni(0) + 0.5);
      var scr: vec3f;
      if (ch == 0) { scr = ch_static(q, t); }
      else if (ch == 1) { scr = ch_plasma(q, t); }
      else if (ch == 2) { scr = ch_pong(q, t); }
      else { scr = ch_boids(q, t); }

      // switch burst: static bleeds over the program
      if (uni(1) > 0.01) { scr = mix(scr, ch_static(q, t * 3.0), min(uni(1) * 1.4, 1.0)); }

      // CRT dress: phosphor triads, scanlines, corner falloff, flicker
      let px = i32(p.x * 3.0) % 3;
      var mask = vec3f(0.85);
      if (px == 0) { mask = vec3f(1.25, 0.72, 0.72); }
      else if (px == 1) { mask = vec3f(0.72, 1.25, 0.72); }
      else { mask = vec3f(0.72, 0.72, 1.25); }
      scr *= mask;
      scr *= 0.82 + 0.18 * sin(p.y * 3.14159);                // scanlines
      scr *= flick;
      scr *= 1.0 - 0.45 * pow(length(q), 4.0);                // corner falloff
      col = scr * 1.35;                                       // HDR — bloom catches the tube
    }
  }

  // set shadow on the floor
  col *= 1.0 - 0.3 * smoothstep(30.0, 0.0, abs(p.y - (C.y + half.y + 40.0))) * smoothstep(half.x + 40.0, half.x - 20.0, abs(p.x - C.x));

  return vec4f(col, 1.0);
}`

// ─────────────────────────────────────────────────────────────────────────────
// The hook runs the ALGORITHMS the channels display: Pong plays itself; boids flock.
const HOOK = `
try {
  const wd = sim.worldData
  const NB = ${NB}
  if (!wd.__tv || wd.__tv.v !== 1) {
    wd.__tv = { v: 1, ch: 1, sw: 0, held: 0, sHeld: 0,
      pong: { bx: 0, by: 0, vx: 0.9, vy: 0.5, pa: 0, pb: 0, sa: 0, sb: 0 },
      boids: Array.from({ length: NB }, (_, i) => ({ x: Math.sin(i * 2.1) * 0.5, y: Math.cos(i * 1.7) * 0.5, vx: 0.2, vy: 0.1 })),
      tgt: { x: 0, y: 0, t: 0 } }
  }
  const G = wd.__tv
  const pdt = Math.min(dt, 0.05)

  // channel change: click anywhere or space
  const want = (wd.mouse_down && !G.held) || (wd.key_space && !G.sHeld)
  if (wd.mouse_down) G.held = 1; else G.held = 0
  if (wd.key_space) G.sHeld = 1; else G.sHeld = 0
  if (want) {
    G.ch = (G.ch + 1) % 4
    G.sw = 1
    wd.__play_sound = [
      { frequency: 1200, duration: 0.03, volume: 0.25, type: 'square' },
      { frequency: 90, duration: 0.15, volume: 0.2, type: 'sawtooth' },
    ]
  }
  G.sw = Math.max(0, G.sw - 2.2 * pdt)

  // ── ALGORITHM 1: Pong plays itself ──
  const P = G.pong
  P.bx += P.vx * pdt; P.by += P.vy * pdt
  if (P.by > 0.92 || P.by < -0.92) { P.vy = -P.vy; P.by = Math.sign(P.by) * 0.92 }
  const chase = (pad, ty) => pad + Math.max(-1.3 * pdt, Math.min(1.3 * pdt, ty - pad))
  P.pa = chase(P.pa, P.vx < 0 ? P.by : P.by * 0.3)
  P.pb = chase(P.pb, P.vx > 0 ? P.by : P.by * 0.3)
  if (P.bx < -0.82 && Math.abs(P.by - P.pa) < 0.19 && P.vx < 0) { P.vx = -P.vx * 1.04; P.vy += (P.by - P.pa) * 2.0; P.bx = -0.82 }
  if (P.bx > 0.82 && Math.abs(P.by - P.pb) < 0.19 && P.vx > 0) { P.vx = -P.vx * 1.04; P.vy += (P.by - P.pb) * 2.0; P.bx = 0.82 }
  if (Math.abs(P.bx) > 1.05) {
    if (P.bx > 0) P.sa = Math.min(5, P.sa + 1); else P.sb = Math.min(5, P.sb + 1)
    if (P.sa >= 5 || P.sb >= 5) { P.sa = 0; P.sb = 0 }
    P.bx = 0; P.by = 0; P.vx = Math.sign(-P.bx || (Math.random() < 0.5 ? 1 : -1)) * 0.9; P.vy = 0.5
    if (G.ch === 2) wd.__play_sound = { frequency: 220, duration: 0.12, volume: 0.25, type: 'square' }
  }
  const spd = Math.hypot(P.vx, P.vy)
  if (spd > 2.2) { P.vx *= 2.2 / spd; P.vy *= 2.2 / spd }

  // ── ALGORITHM 2: boids murmuration ──
  G.tgt.t -= pdt
  if (G.tgt.t <= 0) { G.tgt = { x: (Math.sin(Date.now ? 0 : 0) || Math.sin(G.sw * 7 + P.bx * 13)) * 0.6, y: Math.sin(P.by * 11 + G.ch * 3) * 0.5, t: 2.5 } }
  let cx = 0, cy = 0
  for (const b of G.boids) { cx += b.x; cy += b.y }
  cx /= NB; cy /= NB
  for (const b of G.boids) {
    // cohesion + target + separation + alignment-lite
    b.vx += ((cx - b.x) * 0.4 + (G.tgt.x - b.x) * 0.5) * pdt
    b.vy += ((cy - b.y) * 0.4 + (G.tgt.y - b.y) * 0.5) * pdt
    for (const o of G.boids) {
      if (o === b) continue
      const dx = b.x - o.x, dy = b.y - o.y
      const d2 = dx * dx + dy * dy
      if (d2 < 0.008 && d2 > 1e-6) { b.vx += dx / d2 * 0.0022 * pdt * 60; b.vy += dy / d2 * 0.0022 * pdt * 60 }
    }
    const sp = Math.hypot(b.vx, b.vy) || 1
    const want2 = 0.55
    b.vx *= 1 + (want2 - sp) / sp * 0.08
    b.vy *= 1 + (want2 - sp) / sp * 0.08
    b.x += b.vx * pdt; b.y += b.vy * pdt
    if (Math.abs(b.x) > 0.95) { b.vx -= Math.sign(b.x) * 1.5 * pdt }
    if (Math.abs(b.y) > 0.9) { b.vy -= Math.sign(b.y) * 1.5 * pdt }
  }

  const u = [G.ch, G.sw, 0, P.bx, P.by, P.pa, P.pb, P.sa, P.sb, 0]
  for (const b of G.boids) u.push(b.x, b.y)
  wd.gpuUniforms = u
  wd.hud = [
    { id: 'tv_ch', type: 'text', x: '14px', y: '12px', text: 'CH ' + (G.ch + 1) + '  \\u00b7  ' + ['STATIC', 'PLASMA', 'PONG', 'BOIDS'][G.ch], color: '#c9b370', fontSize: '13px' },
    { id: 'tv_hint', type: 'text', x: '14px', bottom: '12px', text: 'click / space: change channel', color: '#6f8f8a', fontSize: '12px' },
  ]
} catch (e) { /* keep the sim alive */ }
`

const scene = {
  name: 'TV',
  fields: [
    {
      id: 'tv_f', name: 'Television', color: [0.1, 0.1, 0.12, 1],
      effects: [], memory: [], proximity: [], properties: {},
      transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
      shapeType: 'rect', w: 512, h: 512,
      visualTypeName: 'tv_set', noHit: true, noCollide: true,
    },
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: "A CRT running callable channels.\nCLICK or SPACE \u2014 change the channel: static, plasma, self-playing Pong, a boids murmuration.\nThe last two are real algorithms living in the hook; the tube just calls them.",
    postProcess: { bloomIntensity: 0.55, bloomThreshold: 0.65, exposure: 1.0, vignetteStrength: 0.4, vignetteRadius: 0.72 },
  },
  stepHooks: [{ id: 'tv_core', author: 'fable', description: 'TV: channel input + the algorithms the channels display (self-playing Pong, boids murmuration).', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'tv_set', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'TV', scene }),
})
console.log('TV saved:', res.status, await res.text())
