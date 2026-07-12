// TERRARIUM — an artificial-life ecosystem cartridge.
// Grazers (walker rig, planted gait) forage glowing moss; a serpent predator
// hunts them. Energy budgets drive everything: eating, fleeing, starvation,
// reproduction. Offspring inherit speed + body tint with mutation — lineages
// are visible as color families. Selection pressure, live.
// No input needed: it's a terrarium. Watch the arena field's name for stats.

const MODULES = /* wgsl */`
fn mod_seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(p - a - ab * h);
}
fn mod_cap(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  return mod_seg(p, a, b) - r;
}
fn mod_gait(phc: f32, duty: f32, len: f32, lift: f32) -> vec2f {
  let cyc = fract(phc);
  if (cyc < duty) {
    let t = cyc / duty;
    return vec2f(len - 2.0 * len * t, 0.0);
  }
  let t = (cyc - duty) / (1.0 - duty);
  let e = t * t * (3.0 - 2.0 * t);
  return vec2f(-len + 2.0 * len * e, -sin(t * 3.14159) * lift);
}
fn mod_ramp(dark: vec3f, base: vec3f, lite: vec3f, t: f32) -> vec3f {
  let lo = clamp(t * 2.0, 0.0, 1.0);
  let hi = clamp(t * 2.0 - 1.0, 0.0, 1.0);
  return mix(mix(dark, base, lo), lite, hi);
}`

const ARENA = /* wgsl */`
fn visual_terra_arena(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  var c = vec3f(0.040, 0.050, 0.058);
  let h = fbm(uv * 3.0 + vec2f(2.7, 1.3), 4);
  let h2 = fbm(uv * 3.0 + vec2f(2.76, 1.26), 4);
  c += vec3f(0.028, 0.036, 0.026) * h;
  c += vec3f(0.020, 0.024, 0.016) * clamp((h2 - h) * 12.0, 0.0, 1.0);
  let m = fbm(uv * 5.0 - vec2f(1.1, 3.3), 3);
  c = mix(c, vec3f(0.040, 0.078, 0.048), smoothstep(0.55, 0.75, m) * 0.65);
  let cl = fbm(uv * 1.8 + vec2f(time * 0.010, time * 0.004), 3);
  c *= 0.82 + 0.30 * smoothstep(0.35, 0.75, cl);
  let rdir = normalize(vec2f(0.55, 0.83));
  let across = uv.x * rdir.y - uv.y * rdir.x;
  let along = dot(uv, rdir);
  let ray = pow(max(fbm(vec2f(across * 7.0, along * 1.1 - time * 0.04), 3), 0.0), 3.0);
  c += vec3f(0.28, 0.31, 0.24) * ray * smoothstep(1.2, -0.9, along) * 0.5;
  let g = uv * 40.0;
  let cell = floor(g);
  let hh = hash21(cell);
  if (hh > 0.9984) {
    let fp = fract(g) - 0.5;
    let tw = 0.5 + 0.5 * sin(time * (1.0 + hh * 3.0) + hh * 40.0);
    c += vec3f(0.5, 0.7, 0.4) * exp(-dot(fp, fp) * 30.0) * tw * 0.7;
  }
  c *= 1.0 - 0.30 * dot(uv * 0.8, uv * 0.8);
  return vec4f(c, 1.0);
}`

// params: [fullness01, seed, 0, 1]
const MOSS = /* wgsl */`
fn visual_terra_moss(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let full = clamp(p.x, 0.0, 1.0);
  if (full < 0.03) { return vec4f(0.0); }
  let d = length(uv);
  let wob = 0.75 + 0.35 * fbm(uv * 3.5 + vec2f(p.y * 9.0, 0.0), 3);
  let r = (0.22 + 0.62 * full) * wob;
  let body = smoothstep(r, r - 0.28, d);
  if (body < 0.01) { return vec4f(0.0); }
  var c = mix(vec3f(0.05, 0.22, 0.12), vec3f(0.16, 0.55, 0.30), body);
  let pulse = 0.85 + 0.15 * sin(time * 1.3 + p.y * 20.0);
  c += vec3f(0.25, 0.85, 0.45) * exp(-d * d / max(r * r, 0.01) * 2.5) * 0.5 * pulse * full;
  let sp = fbm(uv * 9.0 + vec2f(p.y * 31.0, time * 0.05), 3);
  c += vec3f(0.4, 1.0, 0.6) * step(0.72, sp) * 0.35 * full;
  return vec4f(c, body * (0.55 + 0.45 * full));
}`

// grazer: walker rig, planted gait. params: [heading, phaseCycles, fear01, life01]
const GRAZER = /* wgsl */`
fn terra_grazer_sd(q: vec2f, hd: f32, ph: f32, fear: f32) -> f32 {
  let bob = sin(ph * 12.566) * 0.5;
  let hip = rotate(vec2f(-7.0, bob * 0.5), hd);
  let chest = rotate(vec2f(6.0, bob), hd);
  let head = rotate(vec2f(13.0, -3.0 + bob), hd);
  let wag = sin(ph * 5.65) * 1.4;
  let tail = rotate(vec2f(-15.0, -2.0 - bob + wag), hd);
  var d = mod_cap(q, hip, chest, 2.3);
  d = opSmoothUnion(d, mod_cap(q, chest, head, 1.3), 1.3);
  d = opSmoothUnion(d, length(q - head) - 2.4, 1.0);
  d = opSmoothUnion(d, length(q - (head + rotate(vec2f(2.5, 0.5), hd))) - 1.1, 0.9);
  d = opSmoothUnion(d, mod_cap(q, hip, tail, 0.8), 1.2);
  // ears fold back with fear
  let earA = head + rotate(vec2f(-0.6 - fear * 1.6, -3.2 + fear * 1.2), hd);
  let earB = head + rotate(vec2f(1.2 - fear * 1.6, -3.0 + fear * 1.2), hd);
  d = opSmoothUnion(d, mod_cap(q, head, earA, 0.5), 0.5);
  d = opSmoothUnion(d, mod_cap(q, head, earB, 0.45), 0.5);
  for (var i = 0; i < 4; i++) {
    let front = f32(i / 2);
    let baseL = mix(vec2f(-7.0, bob * 0.5), vec2f(6.0, bob), front);
    var offs = array<f32, 4>(0.0, 0.5, 0.25, 0.75);
    let g = mod_gait(ph + offs[i], 0.6, 4.5, 2.6);
    let fx = baseL.x + g.x;
    let footL = vec2f(fx, 10.0 + g.y);
    let kneeL = vec2f((baseL.x + fx) * 0.5 + 1.5, (baseL.y + footL.y) * 0.5 - 1.5);
    let base = rotate(baseL, hd);
    let knee = rotate(kneeL, hd);
    let foot = rotate(footL, hd);
    d = opSmoothUnion(d, mod_cap(q, base, knee, 0.95), 0.9);
    d = opSmoothUnion(d, mod_cap(q, knee, foot, 0.68), 0.7);
    d = opSmoothUnion(d, length(q - foot) - 0.85, 0.5);
  }
  return d;
}
fn visual_terra_grazer(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let life = clamp(p.w, 0.0, 1.0);
  if (life < 0.02) { return vec4f(0.0); }
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y; let fear = clamp(p.z, 0.0, 1.0);
  let d = terra_grazer_sd(c, hd, ph, fear);
  if (d > 3.0) {
    let ds = terra_grazer_sd(c - vec2f(3.5, 4.5), hd, ph, fear);
    return vec4f(vec3f(0.0), smoothstep(2.2, -1.2, ds) * 0.38 * life);
  }
  let e = 0.25;
  let dx = terra_grazer_sd(c + vec2f(e, 0.0), hd, ph, fear) - d;
  let dy = terra_grazer_sd(c + vec2f(0.0, e), hd, ph, fear) - d;
  let n = normalize(vec3f(-dx / e, -dy / e, 1.30));
  let L = normalize(vec3f(-0.5, -0.85, 0.55));
  var lum = clamp((dot(n, L) + 0.35) / 1.35, 0.0, 1.0) * 0.95 + 0.12;
  var color = mod_ramp(vec3f(0.20, 0.16, 0.08), vec3f(0.62, 0.55, 0.30), vec3f(0.96, 0.92, 0.68), clamp(lum, 0.0, 1.0));
  // heritable tint — the field's color carries the lineage
  color *= mix(vec3f(1.0), col.rgb * 1.6, 0.4);
  let bl = rotate(c, -hd);
  color *= 0.86 + 0.26 * fbm(bl * vec2f(0.9, 3.0) + vec2f(3.0, 7.0), 3);
  color += vec3f(1.2, 1.15, 1.0) * pow(max(dot(n, normalize(L + vec3f(0.0, 0.0, 1.0))), 0.0), 40.0) * 0.3;
  color *= 1.0 - 0.28 * smoothstep(-1.0, 0.0, d);
  color = mix(color, vec3f(1.0, 0.95, 0.9), fear * 0.12);
  let bobE = sin(ph * 12.566) * 0.5;
  let headE = rotate(vec2f(13.0, -3.0 + bobE), hd);
  let eyeP = headE + rotate(vec2f(1.0, -0.9), hd);
  color = mix(color, vec3f(0.05, 0.03, 0.01), smoothstep(0.70 + fear * 0.15, 0.42, length(c - eyeP)));
  color += vec3f(1.3) * smoothstep(0.42, 0.15, length(c - eyeP - vec2f(0.35, -0.35)));
  let alpha = smoothstep(0.15, -0.15, d) * life;
  return vec4f(color, alpha);
}`

// predator: serpent rig. params: [heading, phaseCycles, lungeAngle, lunge01]
const PRED = /* wgsl */`
fn terra_pred_sd(q: vec2f, hd: f32, ph: f32, ra: f32, lunge: f32) -> f32 {
  let head = rotate(vec2f(15.0, sin(ph * 8.8) * 1.2), hd);
  var d = length(q - head) - 2.8;
  var prev = head;
  for (var i = 1; i < 10; i++) {
    let fi = f32(i);
    let cur = rotate(vec2f(15.0 - fi * 3.3, sin(ph * 8.8 - fi * 0.85) * (1.6 + fi * 0.35)), hd);
    let r = max(2.4 - fi * 0.20, 0.5);
    let ab = cur - prev;
    let h = clamp(dot(q - prev, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
    d = opSmoothUnion(d, length(q - prev - ab * h) - r, 1.1);
    prev = cur;
  }
  if (lunge > 0.1) {
    let dir = vec2f(cos(ra), sin(ra));
    let tip = head + dir * (2.0 + 5.0 * lunge);
    let side = vec2f(-dir.y, dir.x);
    d = min(d, mod_cap(q, head + dir * 1.5, tip, 0.4));
    d = min(d, mod_cap(q, tip, tip + dir * 1.5 + side * 1.0, 0.3));
    d = min(d, mod_cap(q, tip, tip + dir * 1.5 - side * 1.0, 0.3));
  }
  return d;
}
fn visual_terra_pred(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let c = uv * 22.0;
  let hd = p.x; let ph = p.y; let ra = p.z; let lunge = clamp(p.w, 0.0, 1.0);
  let d = terra_pred_sd(c, hd, ph, ra, lunge);
  if (d > 3.0) {
    let ds = terra_pred_sd(c - vec2f(3.5, 4.5), hd, ph, ra, lunge);
    return vec4f(vec3f(0.0), smoothstep(2.2, -1.2, ds) * 0.40);
  }
  let e = 0.25;
  let dx = terra_pred_sd(c + vec2f(e, 0.0), hd, ph, ra, lunge) - d;
  let dy = terra_pred_sd(c + vec2f(0.0, e), hd, ph, ra, lunge) - d;
  let n = normalize(vec3f(-dx / e, -dy / e, 1.30));
  let L = normalize(vec3f(-0.5, -0.85, 0.55));
  var lum = clamp((dot(n, L) + 0.35) / 1.35, 0.0, 1.0) * 0.95 + 0.12;
  var color = mod_ramp(vec3f(0.22, 0.05, 0.06), vec3f(0.62, 0.16, 0.14), vec3f(1.0, 0.55, 0.38), clamp(lum, 0.0, 1.0));
  // dorsal banding
  color *= 0.80 + 0.25 * sin(length(c) * 1.4 + ph * 8.8);
  color += vec3f(1.4, 0.9, 0.7) * pow(max(dot(n, normalize(L + vec3f(0.0, 0.0, 1.0))), 0.0), 40.0) * 0.4;
  color *= 1.0 - 0.28 * smoothstep(-1.0, 0.0, d);
  color = mix(color, vec3f(1.3, 0.5, 0.3), lunge * 0.25);
  let headE = rotate(vec2f(15.0, sin(ph * 8.8) * 1.2), hd);
  let eyeP = headE + rotate(vec2f(1.1, -1.1), hd);
  color = mix(color, vec3f(0.9, 0.75, 0.1), smoothstep(0.70, 0.42, length(c - eyeP)));
  color = mix(color, vec3f(0.05, 0.02, 0.01), smoothstep(0.35, 0.18, length(c - eyeP)));
  let alpha = smoothstep(0.15, -0.15, d);
  return vec4f(color, alpha);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__terra || wd.__terra.v !== 3) wd.__terra = { v: 3, t: 0, g: {}, pred: { h: 0.5, ph: 0, cool: 3, hunger: 0.5 }, catches: 0, births: 0 }
  const G = wd.__terra
  G.t += dt
  let arena = null, pred = null
  const grazers = [], mosses = []
  for (const f of sim.fields.values()) {
    const n = f.name || ''
    if (n.startsWith('Grazer')) grazers.push(f)
    else if (n.startsWith('Moss')) mosses.push(f)
    else if (n.startsWith('Pred')) pred = f
    else if (n.startsWith('TERRARIUM')) arena = f
  }
  if (!pred || grazers.length === 0) { return }
  const T = f => f.transform
  const dist = (a, b) => Math.hypot(T(a).x - T(b).x, T(a).y - T(b).y)
  const STRIDE = 60, PSTRIDE = 46

  // ── moss regrows ──
  for (const m of mosses) {
    let full = m.properties.get('full')
    if (full === undefined) { full = 1; m.properties.set('seed', Math.random()) }
    full = Math.min(1, full + 0.022 * dt)
    m.properties.set('full', full)
    m.visualParams = [full, m.properties.get('seed') || 0, 0, 1]
  }

  // ── grazers ──
  let alive = 0
  for (let i = 0; i < grazers.length; i++) {
    const f = grazers[i]
    if (!G.g[f.name]) {
      // slots 0-3 start alive, rest wait to be born
      G.g[f.name] = { alive: i < 4, energy: 1.0, h: Math.random() * 6.28, ph: Math.random(),
                      speedT: 30 + Math.random() * 8, life: i < 4 ? 1 : 0, cool: 5 }
      if (i >= 4) { T(f).x = 20; T(f).y = 20 }
    }
    const S = G.g[f.name]
    if (!S.alive) {
      S.life = Math.max(0, S.life - dt * 1.5)
      f.visualParams = [S.h, S.ph, 0, S.life]
      continue
    }
    alive++
    S.life = Math.min(1, S.life + dt * 1.5)
    S.cool = Math.max(0, S.cool - dt)
    const pd = dist(f, pred)
    const afraid = pd < 105
    S.fear = (S.fear || 0) + ((afraid ? 1 : 0) - (S.fear || 0)) * Math.min(1, dt * 4)
    let speed = S.speedT
    if (afraid) {
      // flee directly away
      const fa = Math.atan2(T(f).y - T(pred).y, T(f).x - T(pred).x)
      let dh = fa - S.h
      while (dh > Math.PI) dh -= 6.28318
      while (dh < -Math.PI) dh += 6.28318
      S.h += dh * Math.min(1, dt * 5)
      speed = S.speedT * 1.7
    } else {
      // forage: head for the fullest nearby moss when hungry, else wander
      S.h += Math.sin(G.t * 0.5 + i * 2.7) * 0.8 * dt
      if (S.energy < 1.7) {
        let bm = null, bs = -1
        for (const m of mosses) {
          const full = m.properties.get('full') || 0
          const md = dist(f, m)
          const score = full * 120 - md * 0.4
          if (full > 0.1 && score > bs) { bs = score; bm = m }
        }
        if (bm) {
          const ma = Math.atan2(T(bm).y - T(f).y, T(bm).x - T(f).x)
          let dh = ma - S.h
          while (dh > Math.PI) dh -= 6.28318
          while (dh < -Math.PI) dh += 6.28318
          S.h += dh * Math.min(1, dt * 2.2)
          // graze when on the patch
          if (dist(f, bm) < 34) {
            speed = S.speedT * 0.25
            const full = bm.properties.get('full') || 0
            const bite = Math.min(full, 0.07 * dt)
            bm.properties.set('full', full - bite)
            S.energy += bite * 3.2
          }
        }
      }
    }
    // bounds
    if (T(f).x < 70 || T(f).x > 442 || T(f).y < 70 || T(f).y > 442) {
      const ca = Math.atan2(256 - T(f).y, 256 - T(f).x)
      let dh = ca - S.h
      while (dh > Math.PI) dh -= 6.28318
      while (dh < -Math.PI) dh += 6.28318
      S.h += dh * Math.min(1, dt * 3)
    }
    T(f).vx = Math.cos(S.h) * speed
    T(f).vy = Math.sin(S.h) * speed
    S.ph += (speed / STRIDE) * dt
    // metabolism
    S.energy -= (0.035 + speed * 0.0011) * dt
    if (S.energy <= 0) { S.alive = false; continue }
    // reproduce
    if (S.energy > 1.5 && S.cool <= 0) {
      const slot = grazers.find(x => G.g[x.name] && !G.g[x.name].alive && G.g[x.name].life <= 0)
      if (slot) {
        const C = G.g[slot.name]
        C.alive = true; C.life = 0; C.energy = 0.65
        C.h = S.h + 2.5
        C.ph = 0
        C.speedT = Math.max(22, Math.min(46, S.speedT + (Math.random() - 0.5) * 6))
        C.cool = 8
        T(slot).x = T(f).x + (Math.random() - 0.5) * 30
        T(slot).y = T(f).y + (Math.random() - 0.5) * 30
        // inherit tint with mutation — lineages become visible
        const pc = f.color || [0.62, 0.55, 0.30, 1]
        slot.color = [
          Math.max(0.15, Math.min(1, pc[0] + (Math.random() - 0.5) * 0.16)),
          Math.max(0.15, Math.min(1, pc[1] + (Math.random() - 0.5) * 0.16)),
          Math.max(0.15, Math.min(1, pc[2] + (Math.random() - 0.5) * 0.16)),
          1,
        ]
        S.energy = 0.7
        S.cool = 8
        G.births++
      }
    }
    f.visualParams = [S.h, S.ph, S.fear || 0, S.life]
  }

  // ── predator ──
  const P = G.pred
  P.cool = Math.max(0, P.cool - dt)
  P.hunger = Math.min(1, P.hunger + 0.030 * dt)
  let prey = null, pdist = 1e9
  for (const f of grazers) {
    const S = G.g[f.name]
    if (!S || !S.alive) continue
    const d = dist(f, pred)
    if (d < pdist) { pdist = d; prey = f }
  }
  let pspeed = 24 + P.hunger * 30
  let lunge = 0, ra = 0
  if (prey && P.cool <= 0) {
    ra = Math.atan2(T(prey).y - T(pred).y, T(prey).x - T(pred).x)
    let dh = ra - P.h
    while (dh > Math.PI) dh -= 6.28318
    while (dh < -Math.PI) dh += 6.28318
    P.h += dh * Math.min(1, dt * (1.2 + P.hunger * 1.8))
    if (pdist < 55) { lunge = Math.max(0, 1 - pdist / 55); pspeed *= 1.35 }
    if (pdist < 18) {
      const S = G.g[prey.name]
      S.alive = false
      P.hunger = 0
      P.cool = 7
      G.catches++
    }
  } else {
    P.h += Math.sin(G.t * 0.4 + 9.0) * 0.5 * dt
    pspeed = 14
  }
  if (T(pred).x < 80 || T(pred).x > 432 || T(pred).y < 80 || T(pred).y > 432) {
    const ca = Math.atan2(256 - T(pred).y, 256 - T(pred).x)
    let dh = ca - P.h
    while (dh > Math.PI) dh -= 6.28318
    while (dh < -Math.PI) dh += 6.28318
    P.h += dh * Math.min(1, dt * 2.5)
  }
  T(pred).vx = Math.cos(P.h) * pspeed
  T(pred).vy = Math.sin(P.h) * pspeed
  P.ph += (pspeed / PSTRIDE) * dt
  pred.visualParams = [P.h, P.ph, ra, lunge]

  // ── scoreboard ──
  if (arena) {
    const mossPct = Math.round(mosses.reduce((a, m) => a + (m.properties.get('full') || 0), 0) / Math.max(1, mosses.length) * 100)
    arena.name = 'TERRARIUM \\u00b7 ' + alive + ' grazers \\u00b7 moss ' + mossPct + '% \\u00b7 ' + G.births + ' born \\u00b7 ' + G.catches + ' taken'
  }
} catch (e) { /* keep the sim alive */ }
`

const field = (id, name, color, x, y, shape, visualTypeName, vp) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
  ...(vp ? { visualParams: vp } : {}),
})

const mossSpots = [[120, 120], [390, 110], [420, 300], [340, 430], [130, 400], [220, 250]]
const grazerTints = [
  [0.62, 0.55, 0.30, 1], [0.55, 0.60, 0.32, 1], [0.66, 0.48, 0.34, 1], [0.58, 0.56, 0.42, 1],
  [0.62, 0.55, 0.30, 1], [0.62, 0.55, 0.30, 1], [0.62, 0.55, 0.30, 1], [0.62, 0.55, 0.30, 1],
]
const scene = {
  name: 'TERRARIUM',
  fields: [
    field('terra_arena', 'TERRARIUM', [0.04, 0.05, 0.05, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'terra_arena'),
    ...mossSpots.map(([x, y], i) =>
      field(`terra_moss_${i + 1}`, `Moss ${i + 1}`, [0.16, 0.55, 0.30, 1], x, y, { shapeType: 'circle', radius: 48 }, 'terra_moss', [1, Math.random(), 0, 1])),
    ...Array.from({ length: 8 }, (_, i) =>
      field(`terra_grazer_${i + 1}`, `Grazer ${i + 1}`, grazerTints[i], 150 + (i % 4) * 70, 180 + Math.floor(i / 4) * 150, { shapeType: 'circle', radius: 58 }, 'terra_grazer', [0, 0, 0, i < 4 ? 1 : 0])),
    field('terra_pred', 'Pred', [0.62, 0.16, 0.14, 1], 440, 440, { shapeType: 'circle', radius: 85 }, 'terra_pred', [3.5, 0, 0, 0]),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.5, gravitationalConstant: 0 },
  worldData: {
    postProcess: { bloomIntensity: 0.20, bloomThreshold: 0.80, exposure: 1.06, vignetteStrength: 0.30, vignetteRadius: 0.8 },
  },
  stepHooks: [{ id: 'terra_core', author: 'fable', description: 'TERRARIUM ecology: forage, flee, starve, reproduce with heritable traits; predator hunts', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'terra_arena', wgsl: ARENA },
    { name: 'terra_moss', wgsl: MOSS },
    { name: 'terra_grazer', wgsl: GRAZER },
    { name: 'terra_pred', wgsl: PRED },
  ],
  modules: [{ name: 'terra_lib', wgsl: MODULES }],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'TERRARIUM', scene }),
})
console.log('TERRARIUM saved:', res.status, await res.text())
