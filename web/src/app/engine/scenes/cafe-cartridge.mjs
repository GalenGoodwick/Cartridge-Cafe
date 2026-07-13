// CAFE — the front door is a world. Seven cartridges float in the dark, each a
// living miniature of its game. Your cursor is a lens; hover blooms a portal;
// click steps through it. No webpage. Save+load: node cafe-cartridge.mjs

const WORLD = /* wgsl */`
fn cf_stars(p: vec2f, t: f32) -> vec3f {
  var c = vec3f(0.008, 0.007, 0.016);
  c += vec3f(0.05, 0.025, 0.09) * smoothstep(0.4, 0.9, fbm(p * 1.5 + vec2f(t * 0.004, 0.0), 4));
  for (var l = 0; l < 2; l++) {
    let fl = f32(l);
    let sp = p * (16.0 + fl * 26.0) + fl * 31.0;
    let cell = floor(sp);
    let h = hash21(cell);
    let fp = fract(sp) - 0.5;
    let tw = 0.5 + 0.5 * sin(t * (0.5 + h * 1.4) + h * 40.0);
    c += vec3f(0.8, 0.75, 0.95) * step(0.985, h) * smoothstep(0.24, 0.03, length(fp)) * tw * (1.1 - fl * 0.4);
  }
  return c;
}

fn visual_cf_world(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  let mp = vec2f(uni(4), uni(5));     // cursor (uv coords)
  let cam = vec2f(uni(0), uni(1));
  let zm = uni(2);

  // ── the room: stars seen through curved space (your cursor is a lens) ──
  var p = uv;
  let md = uv - mp;
  let mr2 = max(dot(md, md), 0.002);
  p -= md * (0.010 / mr2) * smoothstep(0.9, 0.2, length(md));
  var col = cf_stars(p, t);

  // warm hearth-light from below — this is a cafe, not a void
  col += vec3f(0.10, 0.055, 0.02) * pow(max(0.0, uv.y + 0.2), 2.0) * (0.8 + 0.2 * sin(t * 0.7));

  // ── the bubble universe: live positions, pressure-ranked, explorable ──
  for (var i = 0; i < i32(uni(3) + 0.5); i++) {
    let sv = uni(8 + i * 3);
    let st = i32(floor(sv));
    let hue = fract(sv);
    let ctr = vec2f((uni(6 + i * 3) - cam.x) * zm / 256.0, (uni(7 + i * 3) - cam.y) * zm / 256.0);
    let d = length(uv - ctr);
    let R = 0.098 * zm;
    let hov = smoothstep(R * 1.9, R * 1.1, length(mp - ctr));
    let rr = R * (1.0 + hov * 0.12);
    if (d < rr) {
      let q = (uv - ctr) / rr;                     // -1..1 inside the disc
      var g = vec3f(0.0);
      if (st == 0) {
        // FABRIC — a lens wandering through stars
        var pp = q * 2.0;
        let lc = vec2f(sin(t * 0.6) * 0.5, cos(t * 0.47) * 0.4);
        let ld = pp - lc;
        pp -= ld * (0.16 / max(dot(ld, ld), 0.02));
        g = cf_stars(pp * 1.6, t) * 2.2;
        g += vec3f(0.5, 0.9, 1.1) * exp(-dot(ld, ld) * 14.0) * 0.4;
      } else if (st == 1) {
        // ORRERY — three worlds around a coal
        g = vec3f(0.02, 0.015, 0.03);
        g += vec3f(3.0, 1.7, 0.5) * exp(-dot(q, q) * 30.0);
        for (var k = 1; k <= 3; k++) {
          let fk = f32(k);
          let a = t * (0.9 - fk * 0.18) + fk * 2.1;
          let pp = q - vec2f(cos(a), sin(a)) * (0.22 + fk * 0.17);
          var pc = vec3f(0.45, 0.5, 0.65);
          if (k == 2) { pc = vec3f(0.2, 0.45, 0.8); }
          if (k == 3) { pc = vec3f(0.8, 0.5, 0.25); }
          g += pc * exp(-dot(pp, pp) * 260.0) * 1.6;
        }
      } else if (st == 2) {
        // GARNET — the crystal
        let qa = rotate(q, t * 0.4);
        let cd = abs(qa.x) * 0.866 + abs(qa.y) * 0.5;
        let inside = smoothstep(0.62, 0.58, max(cd, abs(qa.y)));
        let facet = 0.6 + 0.4 * sin(qa.x * 9.0 + qa.y * 7.0 + t * 0.8);
        g = mix(vec3f(0.02, 0.01, 0.02), vec3f(0.75, 0.18, 0.25) * facet, inside);
        g += vec3f(1.6, 0.9, 0.7) * pow(max(0.0, facet - 0.75) * 4.0, 2.0) * inside;
      } else if (st == 3) {
        // ONE DAY — a sky that keeps its whole day
        let ph = fract(t * 0.05);
        let el = sin(ph * 6.28318) * 0.8;
        let day = smoothstep(-0.2, 0.4, el);
        g = mix(vec3f(0.02, 0.02, 0.06), vec3f(0.25, 0.5, 0.8), day * (0.5 - q.y * 0.5));
        g = mix(g, vec3f(0.9, 0.4, 0.15), smoothstep(0.3, 0.0, abs(el)) * max(0.0, -q.y + 0.2) * 0.9);
        let sun = vec2f(cos(ph * 6.28318 - 1.57) * 0.6, -el * 0.55 + 0.1);
        g += vec3f(3.0, 2.0, 0.9) * exp(-dot(q - sun, q - sun) * 60.0) * max(day, 0.15);
        if (q.y > 0.25) { g = mix(g, g * vec3f(0.5, 0.6, 0.8), 0.6); }   // the sea below
      } else if (st == 4) {
        // SAIL — one boat, one sea
        g = mix(vec3f(0.35, 0.5, 0.65), vec3f(0.05, 0.14, 0.2), smoothstep(-0.1, 0.5, q.y));
        let w = sin(q.x * 9.0 + t * 1.4) * 0.05;
        g = mix(g, vec3f(0.03, 0.10, 0.14), smoothstep(w + 0.02, w - 0.02, -q.y + 0.1) * 0.0 + smoothstep(w - 0.02, w + 0.06, q.y - 0.05));
        let sail = max(max(-(q.x + 0.05) * 3.0, q.y + 0.15), (q.x * 0.9 + q.y * 0.8) - 0.28);
        g = mix(g, vec3f(1.0, 0.96, 0.88), smoothstep(0.02, -0.02, sail));
      } else if (st == 5) {
        // SOLSTICE — a sun you carry over a valley
        g = vec3f(0.03, 0.04, 0.09);
        let sp = vec2f(sin(t * 0.5) * 0.45, -0.3 + cos(t * 0.5) * 0.12);
        g += vec3f(3.2, 2.2, 0.9) * exp(-dot(q - sp, q - sp) * 40.0);
        let hill = q.y - (0.25 + 0.15 * sin(q.x * 3.0 + 1.0));
        let lit = max(0.0, 1.0 - length(q - sp) * 1.4);
        g = mix(g, mix(vec3f(0.03, 0.05, 0.02), vec3f(0.15, 0.3, 0.08), lit), smoothstep(-0.02, 0.02, hill));
      } else if (st == 6) {
        // TIDERUNNER — wind over water
        let band = sin(q.y * 14.0 - t * 1.1 + sin(q.x * 4.0) * 0.7);
        g = mix(vec3f(0.05, 0.13, 0.17), vec3f(0.12, 0.25, 0.3), 0.5 + 0.5 * band);
        g += vec3f(0.8, 0.85, 0.85) * pow(max(0.0, band - 0.8) * 5.0, 2.0) * 0.4;
        let bt = q - vec2f(sin(t * 0.4) * 0.4, 0.0);
        g += vec3f(0.9, 0.85, 0.75) * exp(-dot(bt, bt) * 300.0) * 1.2;
      } else if (st == 7) {
        // SIGNAL — a television waiting for a word
        let sn = hash21(floor(q * 24.0) + floor(t * 9.0));
        g = vec3f(sn * 0.5);
        g += vec3f(0.3, 1.0, 0.45) * exp(-dot(q, q) * 8.0) * (0.28 + 0.14 * sin(t * 2.0));
        g *= 0.82 + 0.18 * sin(q.y * 60.0 - t * 8.0);
      } else {
        // a young world — a banded seed-planet in its own hue
        let cA = 0.5 + 0.5 * cos(6.2831 * (hue + vec3f(0.0, 0.33, 0.67)));
        g = cA * (0.22 + 0.5 * fbm3(q * 3.0 + vec2f(t * 0.08, f32(i) * 3.7)));
        g += cA * 0.4 * smoothstep(0.6, 1.0, 1.0 - abs(q.y * 2.2 + 0.3 * sin(q.x * 3.0 + t * 0.4)));
        let mn = q - vec2f(cos(t * 0.5 + f32(i) * 1.9), sin(t * 0.5 + f32(i) * 1.9) * 0.6) * 0.78;
        g += vec3f(0.85) * exp(-dot(mn, mn) * 260.0);
        g *= 0.85 + 0.3 * (1.0 - length(q));
      }
      // glass edge + hover bloom
      let edge = smoothstep(1.0, 0.86, length(q));
      col = mix(col, g, edge);
      col += vec3f(1.2, 0.85, 0.4) * exp(-pow((length(q) - 0.97) * 9.0, 2.0)) * (0.25 + hov * 1.3);
    } else {
      // halo when hovered
      col += vec3f(1.0, 0.7, 0.3) * exp(-pow((d - rr) * 22.0, 2.0)) * hov * 0.8;
    }
  }

  // the cursor itself — a soft ember
  col += vec3f(1.4, 0.9, 0.4) * exp(-dot(uv - mp, uv - mp) * 900.0) * 0.8;

  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.01); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(60.0)), 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  // a fresh session keeps the universe (positions are shared, live for all
  // players) but must drop per-session state: a stashed portalSig matches its
  // own frozen layout and would mute the doors forever, and a stashed
  // 'launched' latch would keep them mute after returning from a world.
  if (wd.__fresh) {
    delete wd.__fresh
    if (wd.__cu) {
      const R = wd.__cu
      R.portalSig = null; R.lastHover = -1; R.prevDown = false; R.kN = {}
      R.launched = 0; R.drag = 0; R.pollT = 0; R.sharedAt = 0
    }
  }
  // wake starts 0: a joining player adopts the shared universe at rest —
  // only real perturbations (a birth, a chant shift, a filter flip) wake it
  if (!wd.__cu || wd.__cu.v !== 1) wd.__cu = { v: 1, bubbles: {}, order: [], cam: { x: 256, y: 256, z: 1 },
    pollT: 0, wake: 0, mineKey: '', drag: 0, dx: 0, dy: 0, downX: 0, downY: 0, moved: 0, prevDown: false, lastHover: -1, kN: {} }
  const U = wd.__cu
  const dt2 = Math.min(dt, 0.05)
  // ── whose universe? MY WORLDS flips the door into a personal submain ──
  const MF = (typeof window !== 'undefined' && window.__cafeMine && window.__cafeMine.on) ? window.__cafeMine : null
  const mineKey = MF ? String(MF.ownerId || MF.who || '') : ''
  if (U.mineKey !== mineKey) { U.mineKey = mineKey; U.pollT = 0; U.wake = 10 }
  const STYLE_OF = { 'FABRIC': 0, 'ORRERY': 1, 'GARNET': 2, 'ONE DAY': 3, 'SAIL': 4, 'SOLSTICE': 5, 'TIDERUNNER': 6, 'SIGNAL': 7 }
  const hueOf = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 997; return (h % 100) / 100 }
  const angOf = n => { let h = 0; for (const c of n) h = (h * 37 + c.charCodeAt(0)) % 9973; return (h % 628) / 100 }

  // ── the universe breathes: poll the shelf; newborns arrive at the edge ──
  U.pollT -= dt2
  if (U.pollT <= 0) {
    U.pollT = 8
    ;(async () => {
      try {
        const now = Date.now()
        const [sc, sp, sl, uvr] = await Promise.all([
          fetch('/api/engine/scene?action=list').then(r => r.json()),
          fetch('/api/spaces/browse').then(r => r.json()).catch(() => ({ spaces: [] })),
          fetch('/api/engine/save?action=list').then(r => r.json()).catch(() => ({ slots: [] })),
          MF ? Promise.resolve(null) : fetch('/api/engine/save?slot=cafe%3Auniverse').then(r => r.json()).catch(() => null),
        ])
        const cellAt = {}
        for (const s of (sl.slots || [])) {
          if (s.slot.startsWith('cell:')) cellAt[s.slot.slice(5)] = s.savedAt
        }
        // one universe, every screen: the shared layout is truth; adopt any
        // arrangement newer than the one we last saw (including our own saves)
        const shared = (uvr && uvr.data && uvr.data.v === 1 && uvr.data.bubbles) ? uvr.data : null
        const adopt = (shared && shared.at > (U.sharedAt || 0)) ? shared : null
        if (adopt) U.sharedAt = adopt.at
        if (mineKey !== U.mineKey) return   // filter flipped mid-flight; stale poll
        const want = {}
        if (MF) {
          // personal submain: only worlds on this player's deed —
          // their brews (blank drafts included) and their branches, newest version each
          const best = {}
          for (const n of (sc.scenes || [])) {
            const f = n.indexOf(' \u2442 ')
            const vAt = n.lastIndexOf(' \u00b7 v')
            if (f < 0 || vAt < f) continue
            if (n.slice(f + 3, vAt) !== MF.who) continue
            const v = parseInt(n.slice(vAt + 4), 10) || 0
            const base = n.slice(0, vAt)
            if (!best[base] || v > best[base].v) best[base] = { v, scene: n, style: STYLE_OF[n.slice(0, f)] ?? 8 }
          }
          for (const base of Object.keys(best)) {
            want[base] = { launch: best[base].scene, style: best[base].style }
          }
          for (const s of (sp.spaces || [])) {
            if (!s.owner || s.owner.id !== MF.ownerId) continue
            const disp = (s.name || s.slug).toUpperCase()
            if (!want[disp]) want[disp] = { launch: 'space:' + s.slug, style: 8 }
          }
        } else {
          for (const n of (sc.scenes || [])) {
            if (n === 'CAFE' || n.includes('\u2402')) continue
            if (n.includes(' \u2442 ')) continue
            want[n] = { launch: n, style: STYLE_OF[n] ?? 8 }
          }
          for (const s of (sp.spaces || [])) {
            if (s.blank) continue
            const disp = (s.name || s.slug).toUpperCase()
            if (!want[disp]) want[disp] = { launch: 'space:' + s.slug, style: 8 }
          }
        }
        for (const n of Object.keys(want)) {
          if (!U.bubbles[n]) {
            const sb = shared && shared.bubbles[n]
            if (sb) {
              // this world already has its place in the shared universe
              U.bubbles[n] = { x: sb.x, y: sb.y, vx: 0, vy: 0, justPlaced: 1,
                born: sb.born || now, launch: want[n].launch, style: want[n].style, hue: hueOf(n), score: 2 }
            } else {
              // truly newborn — born around the heart; its true place is live:
              // packing pressure and participation sort it outward from here
              const a2 = angOf(n)
              U.bubbles[n] = { x: 256 + Math.cos(a2) * 26, y: 256 + Math.sin(a2) * 26 * 0.74, vx: 0, vy: 0,
                born: now, launch: want[n].launch, style: want[n].style, hue: hueOf(n), score: 2 }
              U.wake = 10   // a birth perturbs the whole field
            }
          }
          const B = U.bubbles[n]
          B.launch = want[n].launch
          if (adopt && adopt.bubbles[n]) {   // the shared arrangement wins
            const sb2 = adopt.bubbles[n]
            B.x = sb2.x; B.y = sb2.y; B.vx = 0; B.vy = 0
            if (sb2.born) B.born = sb2.born
          }
          // participation pressure: cell activity + birth heat
          const cellAge = cellAt[n] ? (now - cellAt[n]) / 60000 : 999
          const bornHeat = Math.max(0, 1 - (now - B.born) / 120000)
          const ns = 1 / (1 + cellAge / 20) + bornHeat
          // chant shifts perturb — but a bubble just placed from the shared
          // universe getting its first real score is not a shift, it's arrival
          if (!B.justPlaced && Math.abs(ns - B.score) > 0.03) U.wake = Math.max(U.wake, 7)
          delete B.justPlaced
          B.score = ns
        }
        for (const n of Object.keys(U.bubbles)) if (!want[n]) delete U.bubbles[n]
        U.order = Object.keys(U.bubbles).sort((a2, b2) => U.bubbles[b2].score - U.bubbles[a2].score).slice(0, 19)
        if (MF && U.order.length === 0 && !U.hintedEmpty && typeof window !== 'undefined') {
          U.hintedEmpty = true
          window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text: 'no worlds on your deed yet - brew yours', kind: 'hint' } }))
        }
        if (!MF) U.hintedEmpty = false
      } catch (e2) { /* shelf unreachable — the universe holds its shape */ }
    })()
  }

  // ── gravity with friction: everyone falls toward the middle, packing
  // pressure sorts them — the strongest chant sinks deepest. The sim only
  // runs while perturbed (a birth, a score shift); then friction locks it. ──
  if (U.wake > 0) {
    U.wake -= dt2
    const fr = Math.exp(-3.4 * dt2)
    for (let i = 0; i < U.order.length; i++) {
      const B = U.bubbles[U.order[i]]
      if (!B) continue
      const dx = 256 - B.x, dy = 256 - B.y
      const dd = Math.hypot(dx, dy)
      if (dd > 2) {
        const g = 26 * (0.5 + B.score * 2.2)   // participation breaks past friction
        B.vx += dx / dd * g * dt2
        B.vy += dy / dd * g * dt2
      }
      for (let j = i + 1; j < U.order.length; j++) {
        const C = U.bubbles[U.order[j]]
        if (!C) continue
        let sx = B.x - C.x, sy = B.y - C.y
        let sd = Math.hypot(sx, sy)
        if (sd < 0.5) { sx = Math.cos(angOf(U.order[i])); sy = Math.sin(angOf(U.order[i])); sd = 1 }
        if (sd < 56) {
          const push = (56 - sd) * 9 * dt2
          B.vx += sx / sd * push; B.vy += sy / sd * push
          C.vx -= sx / sd * push; C.vy -= sy / sd * push
        }
      }
      B.vx *= fr; B.vy *= fr
      B.x += B.vx * dt2; B.y += B.vy * dt2
    }
    if (U.wake <= 0) {   // friction locks them in place
      for (const n of U.order) { const B = U.bubbles[n]; if (B) { B.vx = 0; B.vy = 0 } }
      // the settled arrangement becomes everyone's: publish it to the shared
      // universe slot so every player (and every reload) sees this layout
      if (!MF && U.order.length > 0) {
        const at = Date.now()
        U.sharedAt = at
        const out = {}
        for (const n of U.order) {
          const B = U.bubbles[n]
          if (B) out[n] = { x: Math.round(B.x * 10) / 10, y: Math.round(B.y * 10) / 10, born: B.born }
        }
        fetch('/api/engine/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: 'cafe:universe', data: { v: 1, at, bubbles: out } }) }).catch(() => {})
      }
    }
  }

  // ── exploring: drag empty space to pan · Z/X to zoom ──
  const kE = k => { const n = wd['key_' + k + '_n'] || 0; const was = U.kN[k] || 0; U.kN[k] = n; return n > was }
  if (kE('z')) U.cam.z = Math.min(2.4, U.cam.z * 1.25)
  if (kE('x')) U.cam.z = Math.max(0.35, U.cam.z / 1.25)
  const hasM = wd.mouse_x !== undefined
  const mgx = wd.mouse_x ?? 256, mgy = wd.mouse_y ?? 256
  const down = !!wd.mouse_down
  // cursor in universe coords
  const cux = U.cam.x + (mgx - 256) / U.cam.z
  const cuy = U.cam.y + (mgy - 256) / U.cam.z
  let hovered = -1
  for (let i = 0; i < U.order.length; i++) {
    const B = U.bubbles[U.order[i]]
    if (B && Math.hypot(cux - B.x, cuy - B.y) < 30 / Math.max(U.cam.z, 0.001) * U.cam.z ? Math.hypot(cux - B.x, cuy - B.y) < 30 : false) hovered = i
  }
  if (down && !U.prevDown) { U.downX = mgx; U.downY = mgy; U.dx = mgx; U.dy = mgy; U.moved = 0; U.drag = hovered < 0 ? 1 : 0 }
  if (down && U.drag) {
    U.cam.x -= (mgx - U.dx) / U.cam.z
    U.cam.y -= (mgy - U.dy) / U.cam.z
    U.moved += Math.abs(mgx - U.dx) + Math.abs(mgy - U.dy)
  }
  U.dx = mgx; U.dy = mgy
  if (!down && U.prevDown) {
    if (hovered >= 0 && U.moved < 8 && typeof window !== 'undefined') {
      const B = U.bubbles[U.order[hovered]]
      if (B) {
        U.launched = 1   // stepping through: say nothing more — a late portals
                         // or hover dispatch would follow the player into the world
        window.dispatchEvent(new CustomEvent('cafe:launch', { detail: B.launch }))
      }
    }
    U.drag = 0
  }
  U.prevDown = down
  if (!U.launched && hovered !== U.lastHover && typeof window !== 'undefined') {
    U.lastHover = hovered
    window.dispatchEvent(new CustomEvent('cafe:hover', { detail: hovered >= 0 ? U.order[hovered] : null }))
  }

  // ── tell the shell where the doors are (uv space) — it pins the hover
  // tooltip and live head-counts there. Sent when cam or layout moves, and
  // re-announced every 2s regardless: the shell drops portal events during
  // scene changes, so a one-shot could be lost forever ──
  U.portalT = (U.portalT || 0) - dt2
  if (!U.launched && typeof window !== 'undefined') {
    let sig = ((U.cam.x * 10) | 0) + '|' + ((U.cam.y * 10) | 0) + '|' + ((U.cam.z * 100) | 0)
    for (const n of U.order) { const B = U.bubbles[n]; if (B) sig += '|' + n + ':' + ((B.x * 10) | 0) + ',' + ((B.y * 10) | 0) }
    if (sig !== U.portalSig || U.portalT <= 0) {
      U.portalSig = sig
      U.portalT = 2
      window.dispatchEvent(new CustomEvent('cafe:portals', {
        detail: U.order.map(n => {
          const B = U.bubbles[n]
          return B && { name: n, x: (B.x - U.cam.x) * U.cam.z / 256, y: (B.y - U.cam.y) * U.cam.z / 256, r: 0.098 * U.cam.z }
        }).filter(Boolean),
      }))
    }
  }

  // ── publish: cam, count, cursor(uv), then (x, y, style+hue) per bubble ──
  const u = [U.cam.x, U.cam.y, U.cam.z, U.order.length, (mgx - 256) / 256, (mgy - 256) / 256]
  for (const n of U.order) {
    const B = U.bubbles[n]
    u.push(B.x, B.y, B.style + Math.min(0.999, B.hue))
  }
  wd.gpuUniforms = u
} catch (e) { /* keep the door open */ }
`

const scene = {
  name: 'CAFE',
  fields: [
    {
      id: 'cf_world_f', name: 'CAFE',
      color: [0.01, 0.01, 0.03, 1],
      effects: [], memory: [], proximity: [], properties: {},
      transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
      shapeType: 'rect', w: 512, h: 512,
      visualTypeName: 'cf_world',
    },
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: { noPixelSampling: true },
  stepHooks: [{ id: 'cafe_door', author: 'fable', description: 'CAFE: hover-bloom portals, click to step through', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'cf_world', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/CAFE.json'), JSON.stringify(scene, null, 1))
console.log('CAFE bundled to public/cartridges/CAFE.json')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'CAFE', scene }),
})
console.log('CAFE saved:', res.status, await res.text())
