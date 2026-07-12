// ESPER v3 — the 5 Espers demake, isometric, on the full node graph.
//
//   ISOMETRIC   the board is drawn in a squashed 3/4 projection; stone rises as
//               prisms, forest as elevated canopies, characters stand on the board.
//   NODES       movement is the original's graph: hex CENTERS, edge MIDPOINTS and
//               CORNERS — click a node, the esper BFS-pathfinds and walks it.
//               Every node shows as a dot; your reachable neighbors ring and pulse.
//               You can hug walls along vertex/midpoint chains, like the real game.
//   EFFECTS     the original's effect-controller pattern (visual/mechanical split),
//               plugged: FIRE (damage, loud — nearby enemies stir), PSYCHIC
//               (calms and suppresses a mind), SHADOW (the step). SHIFT cycles the
//               readied effect; CLICK an enemy casts it; SPACE always shadow-steps.
//   STEALTH     kite-quantized cones, hex line-of-sight, forest cover, 3-strike
//               alarm, capture = room reset. Key → sealed door → chest, three
//               rooms inside ONE scene tab.
//
//   Save+load: node esper-cartridge.mjs   (then reload /engine, pick ESPER)

const S = 30
const SQ3 = Math.sqrt(3)
const X0 = 70, Y0 = 66
const ISY = 0.56, IYOFF = 112            // iso: screen.y = plan.y * ISY + IYOFF - h
const H_STONE = 22, H_TREE = 32

const MAPS = {
  1: { name: 'Glade', rows: [
    '#########',
    '#..b..f.#',
    '#.f...f.#',
    '#...f...a',
    '#.~~.f..#',
    '#~~~....#',
    '#..s....#',
    '#########',
  ]},
  2: { name: 'Hollow', rows: [
    '#########',
    '#..##..k#',
    '#.f..#..#',
    'a...f...#',
    '#.##..f.#',
    '#...#...#',
    '#.f.....#',
    '#########',
  ]},
  3: { name: 'Keep', rows: [
    '#########',
    '#...c...#',
    '#.#...#.#',
    '#..f.f..#',
    '#.#...#.#',
    '#.......#',
    '####b####',
    '#########',
  ]},
}
const ROOM_ENEMIES = {
  1: [ { kind: 'guard', path: [[1, 3], [7, 3]], range: 3, half: 0.70, speed: 30, hp: 1 } ],
  2: [ { kind: 'guard', path: [[2, 6], [7, 6]], range: 3, half: 0.70, speed: 27, hp: 1 },
       { kind: 'sentry', path: [[5, 3]], range: 4, half: 0.55, spin: 0.5, hp: 2 } ],
  3: [ { kind: 'guard', path: [[2, 5], [6, 5]], range: 3, half: 0.70, speed: 30, hp: 1 },
       { kind: 'guard', path: [[1, 3], [7, 3]], range: 3, half: 0.70, speed: 27, hp: 1 } ],
}

// ── the effect controllers, the original's shape: visual / mechanical split ──
const EFFECTS = [
  { id: 'fire',    name: 'Fire',    visual: { rayColor: [2.4, 0.5, 0.3], burst: 1.4 },
    mechanical: { damage: 1, stun: 0, calm: 0, loud: 1 }, charges: 2, rangeHex: 3 },
  { id: 'psychic', name: 'Psychic', visual: { rayColor: [0.5, 1.1, 2.2], burst: 0.9 },
    mechanical: { damage: 0, stun: 3, calm: 1, loud: 0 }, charges: 3, rangeHex: 3 },
]

// ── build: land tables, props, and the FULL node graph per room ──
const colRowToAxial = (c, w) => [c, w - (c >> 1)]
const axPx = (q, r) => [X0 + S * 1.5 * q, Y0 + S * (SQ3 / 2 * q + SQ3 * r)]
const LANDCODE = { '.': 0, f: 1, '#': 2, '~': 3, s: 0, a: 0, b: 0, k: 0, c: 0 }
const polar = (cx, cy, rad, deg) => [cx + rad * Math.cos(deg * Math.PI / 180), cy + rad * Math.sin(deg * Math.PI / 180)]

const rooms = {}
for (const [id, m] of Object.entries(MAPS)) {
  const land = [], props = {}, hexes = []
  m.rows.forEach((row, w) => row.split('').forEach((ch, c) => {
    const [q, r] = colRowToAxial(c, w)
    const l = LANDCODE[ch] ?? 0
    land.push({ q, r, l })
    hexes.push({ q, r, l, px: axPx(q, r) })
    if ('sabkc'.includes(ch)) props[ch] = { q, r, px: axPx(q, r) }
  }))
  // node graph: centers + edge midpoints + vertices; adjacency along kite borders
  const nodes = [], byKey = new Map()
  const put = (x, y, kind) => {
    const key = Math.round(x * 2) + ':' + Math.round(y * 2)
    if (byKey.has(key)) return byKey.get(key)
    const n = { i: nodes.length, x: +x.toFixed(1), y: +y.toFixed(1), k: kind, adj: [], cov: 0 }
    nodes.push(n); byKey.set(key, n)
    return n
  }
  const link = (a, b) => { if (!a.adj.includes(b.i)) a.adj.push(b.i); if (!b.adj.includes(a.i)) b.adj.push(a.i) }
  for (const h of hexes) {
    if (h.l === 2 || h.l === 3) continue                      // stone/water own no nodes
    const C = put(h.px[0], h.px[1], 0)
    for (let d = 0; d < 6; d++) {
      const [mx, my] = polar(h.px[0], h.px[1], S * 0.866, 30 + 60 * d)
      const [vax, vay] = polar(h.px[0], h.px[1], S, 60 * d)
      const [vbx, vby] = polar(h.px[0], h.px[1], S, 60 * (d + 1))
      const M = put(mx, my, 1), VA = put(vax, vay, 2), VB = put(vbx, vby, 2)
      link(C, M); link(M, VA); link(M, VB)
    }
  }
  for (const n of nodes) {                                    // forest cover per node
    n.cov = hexes.some(h => h.l === 1 && Math.hypot(h.px[0] - n.x, h.px[1] - n.y) < S * 1.05) ? 1 : 0
  }
  rooms[id] = { id: +id, name: m.name, land, props, hexes,
    enemies: ROOM_ENEMIES[id],
    nodes: nodes.map(n => ({ x: n.x, y: n.y, a: n.adj, c: n.cov })) }
}
const DOORS = [
  { room: 1, hex: rooms[1].props.a, to: 2, spawn: rooms[2].props.a, gated: false },
  { room: 1, hex: rooms[1].props.b, to: 3, spawn: rooms[3].props.b, gated: true },
  { room: 2, hex: rooms[2].props.a, to: 1, spawn: rooms[1].props.a, gated: false },
  { room: 3, hex: rooms[3].props.b, to: 1, spawn: rooms[1].props.b, gated: false },
]

const num = v => (Math.round(v * 100) / 100).toFixed(2)
const landWGSL = Object.values(rooms).map(rm =>
  `  if (room == ${rm.id}) {\n` + rm.land.filter(h => h.l > 0).map(h =>
    `    if (q == ${h.q} && r == ${h.r}) { return ${h.l}; }`).join('\n') + `\n    return 0;\n  }`
).join('\n')

const coneWGSL = Object.values(rooms).map(rm =>
  rm.enemies.map((e, i) => `
  if (room == ${rm.id}) {
    let st = uni(${15 + i * 4});
    if (st > -0.5 && st < 2.5) {
      let eo = vec2f(uni(${12 + i * 4}), uni(${13 + i * 4}));
      let oh = px_hex(eo);
      let hd = hex_dist(oh, gh);
      if (hd >= 1 && hd <= ${e.range}) {
        let kang = (floor((atan2(glp.y, glp.x) + 3.14159265) / 1.04719755) + 0.5) * 1.04719755 - 3.14159265;
        let kc = gc + vec2f(cos(kang), sin(kang)) * (ES * 0.55);
        let dd = kc - hex_px(oh);
        var diff = atan2(dd.y, dd.x) - uni(${14 + i * 4});
        diff = abs(atan2(sin(diff), cos(diff)));
        if (diff < ${num(e.half)} && length(dd) < ${num((e.range + 0.4) * S * SQ3)} && hex_los(oh, gh, room) > 0.5) {
          var cc = vec3f(0.10, 0.13, 0.15);
          if (st > 0.5) { cc = vec3f(0.30, 0.13, 0.40); }
          if (st > 1.5) { cc = vec3f(0.55, 0.06, 0.08); }
          col += cc * (1.0 - f32(hd) / ${num(e.range + 1)}) * (0.55 + 0.20 * sin(time * 3.0 + f32(${i})));
        }
      }
    }
  }`).join('\n')
).join('\n')

const WORLD = /* wgsl */`
const ES: f32 = ${num(S)};
const EX0: f32 = ${num(X0)};
const EY0: f32 = ${num(Y0)};
const ISY: f32 = ${num(ISY)};
const IYOFF: f32 = ${num(IYOFF)};
const ZOOM: f32 = 2.0;

fn hex_px(h: vec2i) -> vec2f {
  return vec2f(EX0 + ES * 1.5 * f32(h.x), EY0 + ES * (0.8660254 * f32(h.x) + 1.7320508 * f32(h.y)));
}
fn px_hex(p: vec2f) -> vec2i {
  let qf = (0.6666667 * (p.x - EX0)) / ES;
  let rf = (-0.3333333 * (p.x - EX0) + 0.5773503 * (p.y - EY0)) / ES;
  let sf = -qf - rf;
  var q = round(qf); var r = round(rf); var s = round(sf);
  let dq = abs(q - qf); let dr = abs(r - rf); let ds = abs(s - sf);
  if (dq > dr && dq > ds) { q = -r - s; } else if (dr > ds) { r = -q - s; }
  return vec2i(i32(q), i32(r));
}
fn hex_dist(a: vec2i, b: vec2i) -> i32 {
  let dq = b.x - a.x; let dr = b.y - a.y;
  return (abs(dq) + abs(dr) + abs(dq + dr)) / 2;
}
fn esp_land(room: i32, q: i32, r: i32) -> i32 {
${landWGSL}
  return 9;
}
fn hex_los(a: vec2i, b: vec2i, room: i32) -> f32 {
  let pa = hex_px(a); let pb = hex_px(b);
  let n = hex_dist(a, b);
  if (n <= 1) { return 1.0; }
  for (var i = 1; i < 8; i++) {
    if (i >= n) { break; }
    let h = px_hex(mix(pa, pb, f32(i) / f32(n)));
    if (all(h == a) || all(h == b)) { continue; }
    let l = esp_land(room, h.x, h.y);
    if (l == 1 || l == 2 || l == 9) { return 0.0; }
  }
  return 1.0;
}
// screen → board plan at height h (the iso inverse)
fn iso_plan(p: vec2f, h: f32) -> vec2f { return vec2f(p.x, (p.y - IYOFF + h) / ISY); }
// board plan → screen (for placing characters/props)
fn iso_scr(g: vec2f, h: f32) -> vec2f { return vec2f(g.x, g.y * ISY + IYOFF - h); }

fn visual_esper(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  // camera: zoomed in, eased onto the esper (hook publishes cam at uni 26,27)
  let cam = vec2f(uni(26), uni(27));
  let p = cam + ((uv + vec2f(1.0)) * 256.0 - vec2f(256.0)) / ZOOM;
  let t = time;
  let room = i32(uni(0) + 0.5);

  // ── ground plane ──
  let g = iso_plan(p, 0.0);
  let gh = px_hex(g);
  let gc = hex_px(gh);
  let glp = g - gc;
  let gland = esp_land(room, gh.x, gh.y);
  let grad = length(glp);

  var ga = vec3f(0.035, 0.060, 0.045); var gb = vec3f(0.062, 0.102, 0.066);
  if (room == 2) { ga = vec3f(0.024, 0.028, 0.040); gb = vec3f(0.046, 0.052, 0.068); }
  if (room == 3) { ga = vec3f(0.052, 0.044, 0.038); gb = vec3f(0.088, 0.075, 0.060); }
  var col = mix(ga, gb, fbm3(g * 0.05) * 0.7 + vnoise(g * 0.2) * 0.3);

  // beyond the level lies nothing — the board ends, the dark begins
  if (gland == 9) {
    col = vec3f(0.010, 0.014, 0.022) * (0.6 + 0.4 * fbm3(g * 0.012 + vec2f(t * 0.01, 0.0)));
  } else {
    // lattice: hex borders + kite spokes, faint
    let spoke = abs(fract(atan2(glp.y, glp.x) / 1.0471976 + 0.5) - 0.5);
    col += vec3f(0.010, 0.016, 0.018) * smoothstep(0.05, 0.0, spoke) * step(grad, ES * 0.82);
    var second = 1.0e9;
    for (var d = 0; d < 6; d++) {
      var nb = vec2i(0, 0);
      if (d == 0) { nb = vec2i(1, 0); } else if (d == 1) { nb = vec2i(1, -1); }
      else if (d == 2) { nb = vec2i(0, -1); } else if (d == 3) { nb = vec2i(-1, 0); }
      else if (d == 4) { nb = vec2i(-1, 1); } else { nb = vec2i(0, 1); }
      second = min(second, length(g - hex_px(gh + nb)));
    }
    col += vec3f(0.018, 0.028, 0.030) * smoothstep(3.5, 0.0, second - grad);
  }

  if (gland == 3) {
    let wv = vnoise(g * 0.08 + vec2f(t * 0.25, t * 0.18));
    col = mix(vec3f(0.045, 0.10, 0.15), vec3f(0.085, 0.18, 0.23), wv);
    col += vec3f(0.10) * smoothstep(0.75, 0.95, vnoise(g * 0.12 + vec2f(-t * 0.2, t * 0.1)));
  }

  // ── vision cones on the ground (kite-quantized, hex LOS) ──
  if (gland == 0 || gland == 1) {
${coneWGSL}
  }

  // ── movement nodes, typed: centers (large) · edge midpoints (mid) · corners (small) ──
  if (gland == 0 || gland == 1) {
    let ndC = grad;
    var ndM = 1.0e9;
    var ndV = 1.0e9;
    for (var d = 0; d < 6; d++) {
      let a0 = 1.0471976 * f32(d);
      ndV = min(ndV, length(glp - vec2f(cos(a0), sin(a0)) * ES));
      let a1 = a0 + 0.5235988;
      ndM = min(ndM, length(glp - vec2f(cos(a1), sin(a1)) * (ES * 0.866)));
    }
    col += vec3f(0.10, 0.17, 0.17) * smoothstep(2.8, 1.3, ndC);
    col += vec3f(0.060, 0.105, 0.105) * smoothstep(2.1, 0.9, ndM);
    col += vec3f(0.042, 0.072, 0.072) * smoothstep(1.7, 0.7, ndV);
    // cursor hover: nearby nodes glow so a click has a visible target
    let mw = vec2f(uni(36), uni(37));
    let ndAll = min(ndC, min(ndM, ndV));
    if (length(g - mw) < 10.0) {
      col += vec3f(0.14, 0.34, 0.34) * smoothstep(2.8, 1.0, ndAll);
    }
    // reachable ring: nodes within one graph step of the esper
    let hero = vec2f(uni(1), uni(2));
    if (ndAll < 2.0 && length(g - hero) < ES * 1.15 && length(g - hero) > 3.0) {
      col += vec3f(0.10, 0.30, 0.30) * (0.65 + 0.35 * sin(t * 3.5));
    }
  }

  // ── armed effect: the attack zone telegraph (kite-triangle shading, like the game) ──
  if (uni(38) > 0.0 && (gland == 0 || gland == 1)) {
    let hz = px_hex(vec2f(uni(1), uni(2)));
    let hzd = hex_dist(hz, gh);
    var zc = vec3f(2.4, 0.5, 0.3);
    if (uni(25) > 0.5) { zc = vec3f(0.5, 1.1, 2.2); }
    if (hzd >= 1 && hzd <= 3 && hex_los(hz, gh, room) > 0.5) {
      let kang2 = (floor((atan2(glp.y, glp.x) + 3.14159265) / 1.04719755) + 0.5) * 1.04719755 - 3.14159265;
      let kc2 = gc + vec2f(cos(kang2), sin(kang2)) * (ES * 0.55);
      let kt = 0.5 + 0.5 * sin(t * 5.0 + length(kc2 - vec2f(uni(1), uni(2))) * 0.06);
      col += zc * 0.085 * uni(38) * (0.6 + 0.4 * kt);
      let spk2 = abs(fract(atan2(glp.y, glp.x) / 1.0471976 + 0.5) - 0.5);
      col += zc * 0.05 * uni(38) * smoothstep(0.04, 0.0, spk2);
    }
  }

  // ── effect burst zone + animated pixel sparks at the target ──
  if (uni(28) > 0.01) {
    let tgt = vec2f(uni(31), uni(32));
    if (hex_dist(px_hex(tgt), gh) <= 1 && (gland == 0 || gland == 1)) {
      col += vec3f(uni(33), uni(34), uni(35)) * 0.22 * uni(28);
    }
    let bs = iso_scr(tgt, 10.0);
    for (var si = 0; si < 12; si++) {
      let hsh = hash22(vec2f(f32(si) * 3.7, uni(39)));
      let sa = hsh.x * 6.2831853;
      let sp2 = bs + vec2f(cos(sa), sin(sa) * 0.6) * (1.0 - uni(28)) * (16.0 + hsh.y * 26.0);
      if (length(floor(p / 2.0) * 2.0 - floor(sp2 / 2.0) * 2.0) < 1.4) {
        col += vec3f(uni(33), uni(34), uni(35)) * uni(28) * 2.5;
      }
    }
  }

  // ── the effect ray + burst (visual controllers) ──
  if (uni(28) > 0.01) {
    let a = iso_scr(vec2f(uni(29), uni(30)), 12.0);
    let b = iso_scr(vec2f(uni(31), uni(32)), 12.0);
    let ab = b - a;
    let tt = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.001), 0.0, 1.0);
    let dl = length(p - (a + ab * tt));
    let rc = vec3f(uni(33), uni(34), uni(35));
    col += rc * uni(28) * exp(-dl * 0.55);
    col += rc * uni(28) * 1.6 * exp(-length(p - b) * 0.10);        // burst at the target
  }

  // ── quest props on the ground ──
  if (room == 2 && uni(10) < 0.5) {
    let kp = p - iso_scr(vec2f(${num(rooms[2].props.k.px[0])}, ${num(rooms[2].props.k.px[1])}), 8.0);
    let kd = sdBox(rotate(kp, 0.785), vec2f(5.0, 5.0));
    col += vec3f(2.2, 1.6, 0.4) * (0.7 + 0.3 * sin(t * 4.0)) * exp(-max(kd, 0.0) * 0.22);
  }
  if (room == 3) {
    let cp = p - iso_scr(vec2f(${num(rooms[3].props.c.px[0])}, ${num(rooms[3].props.c.px[1])}), 8.0);
    let cd = sdBox(cp, vec2f(12.0, 8.0));
    if (cd < 0.0) {
      col = mix(vec3f(0.26, 0.15, 0.06), vec3f(0.42, 0.26, 0.10), step(cp.y, -2.0));
      if (uni(11) > 0.5) { col += vec3f(1.8, 1.3, 0.4); }
    }
    col += vec3f(3.0, 2.3, 1.0) * uni(8) * exp(-length(cp) * 0.012);
  }
${DOORS.map(d => `  if (room == ${d.room}) {
    let dp = length(p - iso_scr(vec2f(${num(d.hex.px[0])}, ${num(d.hex.px[1])}), 0.0));
    var dc = vec3f(0.2, 0.9, 1.0);
    ${d.gated ? 'if (uni(10) < 0.5) { dc = vec3f(1.0, 0.15, 0.1); }' : ''}
    col += dc * 0.45 * (0.5 + 0.3 * sin(t * 2.0)) * exp(-max(dp - ES * 0.35, 0.0) * 0.16);
  }`).join('\n')}

  // ── iso extrusion: stone prisms and forest canopies rise off the board ──
  // sides first (sampled down the column), then tops — later writes win
  for (var hs = 0; hs < 4; hs++) {
    let hh = f32(hs) * ${num(H_STONE / 4)} + 3.0;
    let gs = iso_plan(p, hh);
    let sh = px_hex(gs);
    if (esp_land(room, sh.x, sh.y) == 2) {
      let rk = fbm3(gs * 0.09 + f32(sh.x + sh.y));
      col = mix(vec3f(0.055, 0.055, 0.065), vec3f(0.115, 0.11, 0.105), rk) * (0.55 + 0.45 * hh / ${num(H_STONE)});
    }
  }
  {
    let gt = iso_plan(p, ${num(H_STONE)});
    let th = px_hex(gt);
    if (esp_land(room, th.x, th.y) == 2) {
      let tc = hex_px(th);
      let trad = length(gt - tc);
      let rk = fbm3(gt * 0.08);
      col = mix(vec3f(0.10, 0.10, 0.115), vec3f(0.185, 0.175, 0.165), rk);
      col *= 0.78 + 0.45 * smoothstep(ES, 0.0, trad);               // domed top, lit
      col += vec3f(0.03, 0.035, 0.045) * smoothstep(3.0, 0.0, abs(trad - ES * 0.80));
    }
  }
  {
    // trunks
    let gk = iso_plan(p, 6.0);
    let kh = px_hex(gk);
    if (esp_land(room, kh.x, kh.y) == 1 && length(gk - hex_px(kh)) < 3.5) {
      col = vec3f(0.09, 0.06, 0.035);
    }
    // canopies
    let gf = iso_plan(p, ${num(H_TREE)});
    let fh = px_hex(gf);
    if (esp_land(room, fh.x, fh.y) == 1) {
      let fc2 = hex_px(fh);
      let frad = length(gf - fc2);
      if (frad < ES * 0.92) {
        let leaf = fbm3(gf * 0.11 + vec2f(f32(fh.x) * 3.1, f32(fh.y) * 5.7) + vec2f(sin(t * 0.7 + f32(fh.y)) * 0.8, 0.0));
        var fc = mix(vec3f(0.020, 0.060, 0.028), vec3f(0.080, 0.155, 0.062), leaf);
        if (room == 2) { fc = mix(vec3f(0.032, 0.048, 0.068), vec3f(0.080, 0.105, 0.135), leaf); }
        fc *= 0.60 + 0.55 * smoothstep(ES * 0.9, ES * 0.1, length(gf - fc2 + vec2f(6.0, 6.0)));  // NW crown light
        col = fc;
      }
    }
  }

  // ── characters: billboards standing on the board ──
${[0, 1, 2].map(i => `  {
    let st = uni(${15 + i * 4});
    if (st > -0.5 && st < 2.5) {
      let ep = p - iso_scr(vec2f(uni(${12 + i * 4}), uni(${13 + i * 4})), 9.0);
      let ed = length(ep) - 7.5;
      if (ed < 2.0) {
        var bc = vec3f(0.30, 0.34, 0.38);
        if (st > 0.5) { bc = vec3f(0.55, 0.28, 0.78); }
        if (st > 1.5) { bc = vec3f(1.7, 0.14, 0.18); }
        if (ed < 0.0) {
          col = mix(bc, bc * 0.42, smoothstep(-7.5, 0.0, ed));
          let fd = vec2f(cos(uni(${14 + i * 4})), sin(uni(${14 + i * 4})) * ISY);
          if (length(ep - normalize(fd) * 4.8) < 2.4) { col = vec3f(1.0, 0.95, 0.85); }
        } else if (st > 0.5) { col = mix(col, bc, 0.7 * (0.5 + 0.5 * sin(t * 8.0))); }
      }
      // ground contact shadow
      let sp = length(p - iso_scr(vec2f(uni(${12 + i * 4}), uni(${13 + i * 4})), 0.0));
      col *= 1.0 - 0.35 * smoothstep(7.0, 2.0, sp);
    }
  }`).join('\n')}
  {
    let hp = p - iso_scr(vec2f(uni(1), uni(2)), 9.0);
    let hd = length(hp) - 7.5;
    let sp = length(p - iso_scr(vec2f(uni(1), uni(2)), 0.0));
    col *= 1.0 - 0.35 * smoothstep(7.0, 2.0, sp);
    if (hd < 0.0) {
      var hc = mix(vec3f(0.07, 0.26, 0.28), vec3f(0.21, 0.58, 0.60), smoothstep(-7.5, -1.6, hd));
      if (hd > -1.6) { hc *= 0.4; }
      if (uni(5) > 0.0) { hc += vec3f(0.15, 0.25, 0.7) * (0.5 + 0.5 * sin(t * 12.0)); }
      let dir = vec2f(cos(uni(3)), sin(uni(3)) * ISY);
      if (length(hp - normalize(dir) * 4.8) < 2.3) { hc = vec3f(0.95, 0.9, 0.75); }
      col = mix(hc, col, max(uni(4) * 0.55, min(uni(5), 1.0) * 0.6));
    }
  }

  // vignettes: alert pulse, capture flash
  var anyAlert = uni(7) > 2.5;
  if (uni(15) > 1.5 && uni(15) < 2.5) { anyAlert = true; }
  if (uni(19) > 1.5 && uni(19) < 2.5) { anyAlert = true; }
  if (uni(23) > 1.5 && uni(23) < 2.5) { anyAlert = true; }
  if (anyAlert) { col += vec3f(0.5, 0.02, 0.03) * (0.5 + 0.5 * sin(t * 6.0)) * smoothstep(0.55, 1.0, length(uv)); }
  col += vec3f(1.2, 0.0, 0.0) * uni(24) * smoothstep(0.45, 1.0, length(uv));

  return vec4f(col, 1.0);
}`

// ─────────────────────────────────────────────────────────────────────────────
// Whiteboard: 0 room · 1,2 heroPlan · 3 face · 4 covered · 5 shadowT · 6 charges
//   7 alarm · 8 flare · 9 exposed · 10 hasKey · 11 chest · 12+4i enemy(x,y,f,st)
//   24 hurt · 25 readied-effect id · 26,27 (spare)
//   28 rayT · 29,30 rayFrom · 31,32 rayTo · 33-35 rayColor
const HOOK = `
try {
  const wd = sim.worldData
  const ROOMS = ${JSON.stringify(Object.fromEntries(Object.entries(rooms).map(([k, r]) => [k, { land: r.land, enemies: r.enemies, name: r.name, nodes: r.nodes }])))}
  const DOORS = ${JSON.stringify(DOORS.map(d => ({ room: d.room, q: d.hex.q, r: d.hex.r, px: d.hex.px, to: d.to, sq: d.spawn.q, sr: d.spawn.r, spx: d.spawn.px, gated: d.gated })))}
  const EFFECTS = ${JSON.stringify(EFFECTS)}
  const KEYPX = ${JSON.stringify(rooms[2].props.k.px)}
  const CHESTPX = ${JSON.stringify(rooms[3].props.c.px)}
  const STARTPX = ${JSON.stringify(rooms[1].props.s.px)}
  const S = ${S}, X0 = ${X0}, Y0 = ${Y0}, SQ3 = Math.sqrt(3), ISY = ${ISY}, IYOFF = ${IYOFF}

  const hexPx = (q, r) => [X0 + S * 1.5 * q, Y0 + S * (SQ3 / 2 * q + SQ3 * r)]
  const pxHex = (x, y) => {
    const qf = (2 / 3 * (x - X0)) / S, rf = (-1 / 3 * (x - X0) + SQ3 / 3 * (y - Y0)) / S, sf = -qf - rf
    let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf)
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf)
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s
    return [q, r]
  }
  const hexDist = (a, b) => (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + Math.abs(b[0] + b[1] - a[0] - a[1])) / 2
  const landAt = (room, q, r) => { const h = ROOMS[room].land.find(h => h.q === q && h.r === r); return h ? h.l : 2 }
  const losClear = (room, a, b) => {
    const n = hexDist(a, b)
    if (n <= 1) return true
    const pa = hexPx(a[0], a[1]), pb = hexPx(b[0], b[1])
    for (let i = 1; i < n; i++) {
      const t = i / n
      const h = pxHex(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t)
      if ((h[0] === a[0] && h[1] === a[1]) || (h[0] === b[0] && h[1] === b[1])) continue
      const l = landAt(room, h[0], h[1])
      if (l === 1 || l === 2) return false
    }
    return true
  }

  if (!wd.__eq || wd.__eq.v !== 4) {
    wd.__eq = { v: 4, loaded: 0, room: 1, node: -1, path: [], moveT: 1, fx: STARTPX[0], fy: STARTPX[1], x: STARTPX[0], y: STARTPX[1],
      face: 0.5, hasKey: 0, chest: 0, alarm: 0, hurt: 0, flare: 0, shadow: 0, charges: 3,
      wins: 0, kills: 0, casts: 0, en: null, eff: 0, effCh: EFFECTS.map(e => e.charges), zoneT: 0,
      camx: STARTPX[0], camy: STARTPX[1] * ${ISY} + ${IYOFF} - 9,
      ray: { t: 0, ax: 0, ay: 0, bx: 0, by: 0, c: [1, 1, 1] },
      mHeld: 0, spaceHeld: 0, shiftHeld: 0 }
  }
  const G = wd.__eq
  const pdt = Math.min(dt, 0.05)
  const NODES = ROOMS[G.room].nodes

  if (!G.loaded) { G.loaded = 1; wd.__load_game = { slot: 'esper' } }
  const sv = wd.game_save
  if (sv && sv.slot === 'esper') { delete wd.game_save; if (sv.data) { G.hasKey = sv.data.hasKey || 0; G.chest = sv.data.chest || 0; G.wins = sv.data.wins || 0 } }

  const nearestNode = (x, y, maxD) => {
    let best = -1, bd = maxD * maxD
    for (let i = 0; i < NODES.length; i++) {
      const d = (NODES[i].x - x) ** 2 + (NODES[i].y - y) ** 2
      if (d < bd) { bd = d; best = i }
    }
    return best
  }
  if (G.node < 0) G.node = nearestNode(G.x, G.y, 60)

  const gateBlocked = i => {
    for (const d of DOORS) {
      if (d.room !== G.room || !d.gated) continue
      if (!G.hasKey && Math.hypot(NODES[i].x - d.px[0], NODES[i].y - d.px[1]) < S * 0.95) return true
    }
    return false
  }
  const bfsPath = target => {
    if (target < 0 || target === G.node) return []
    const prev = new Array(NODES.length).fill(-2)
    prev[G.node] = -1
    const qq = [G.node]
    while (qq.length) {
      const c = qq.shift()
      if (c === target) break
      for (const nb of NODES[c].a) {
        if (prev[nb] !== -2 || gateBlocked(nb)) continue
        prev[nb] = c; qq.push(nb)
      }
    }
    if (prev[target] === -2) return []
    const path = []
    for (let c = target; c !== -1; c = prev[c]) path.unshift(c)
    path.shift()
    return path.slice(0, 24)
  }

  const initEnemies = room => ROOMS[room].enemies.map(e => {
    const p0 = hexPx(...(() => { const [c, w] = e.path[0]; return [c, w - (c >> 1)] })())
    return { x: p0[0], y: p0[1], f: 0.5, st: 0, sus: 0, wp: 0, lost: 0, hp: e.hp, stun: 0,
      pts: e.path.map(([c, w]) => hexPx(c, w - (c >> 1))) }
  })
  if (!G.en) G.en = initEnemies(G.room)

  const bg = sim.fields.get('eq_bg')
  if (bg) { bg.transform.x = 256; bg.transform.y = 256; bg.transform.vx = 0; bg.transform.vy = 0 }
  const hero = sim.fields.get('eq_hero')
  if (hero) {
    hero.transform.x = G.x
    hero.transform.y = G.y * ISY + IYOFF - 9
    hero.transform.vx = 0; hero.transform.vy = 0
  }

  const sfx = s => { wd.__play_sound = s }
  const roomSwap = (to, spx) => {
    G.room = to; G.x = spx[0]; G.y = spx[1]; G.node = -1; G.path = []; G.moveT = 1
    G.en = initEnemies(to); G.alarm = 0
    G.effCh = EFFECTS.map(e => e.charges); G.charges = 3
    wd.__save_game = { slot: 'esper', data: { hasKey: G.hasKey, chest: G.chest, wins: G.wins } }
    sfx({ frequency: 520, duration: 0.12, volume: 0.3, type: 'triangle' })
  }
  const reset = () => {
    const d0 = DOORS.find(d => d.room === G.room)
    const at = G.room === 1 ? STARTPX : (d0 ? d0.px : STARTPX)
    G.x = at[0]; G.y = at[1]; G.node = -1; G.path = []; G.moveT = 1
    G.charges = 3; G.shadow = 0; G.alarm = 0; G.hurt = 1
    G.effCh = EFFECTS.map(e => e.charges)
    G.en = initEnemies(G.room)
    sfx([{ frequency: 220, duration: 0.15, volume: 0.4, type: 'sawtooth' },
         { frequency: 110, duration: 0.30, volume: 0.4, type: 'sawtooth' }])
  }

  // ── SHIFT arms an effect and telegraphs its zone (the game's targeting read) ──
  if (wd.key_shift && !G.shiftHeld) {
    G.shiftHeld = 1
    if (G.zoneT <= 0) { G.zoneT = 2.5 }                       // first press: show zone
    else { G.eff = (G.eff + 1) % EFFECTS.length; G.zoneT = 2.5 }   // again: cycle
    sfx({ frequency: 440 + G.eff * 140, duration: 0.06, volume: 0.2, type: 'sine' })
  }
  if (!wd.key_shift) G.shiftHeld = 0
  G.zoneT = Math.max(0, G.zoneT - pdt * (G.zoneT > 0 ? 0.55 : 0))

  // ── CLICK (through the camera): adjacent-and-behind enemy → silent kill;
  //    enemy in the armed zone → cast; otherwise path to the node ──
  if (wd.mouse_down && !G.mHeld) {
    G.mHeld = 1
    const mx0 = wd.mouse_x, my0 = wd.mouse_y
    if (typeof mx0 === 'number') {
      const mx = G.camx + (mx0 - 256) / 2
      const my = G.camy + (my0 - 256) / 2
      const gpy = (my - IYOFF) / ISY
      let hitE = -1
      for (let i = 0; i < G.en.length; i++) {
        const e = G.en[i]
        if (e.st < 0) continue
        const sxp = e.x, syp = e.y * ISY + IYOFF - 9
        if ((mx - sxp) ** 2 + (my - syp) ** 2 < 170) { hitE = i; break }
      }
      if (hitE >= 0) {
        const e = G.en[hitE]
        const eh = pxHex(e.x, e.y), hh = pxHex(G.x, G.y)
        let rel = Math.atan2(G.y - e.y, G.x - e.x) - e.f
        rel = Math.atan2(Math.sin(rel), Math.cos(rel))
        const eff = EFFECTS[G.eff]
        if (e.st < 2 && hexDist(eh, hh) <= 1 && Math.abs(rel) > 1.6) {
          e.st = -1; G.kills++; G.casts++
          G.ray = { t: 1, ax: G.x, ay: G.y, bx: e.x, by: e.y, c: [0.5, 0.3, 0.9] }
          sfx({ frequency: 90, duration: 0.22, volume: 0.45, type: 'triangle' })
        } else if (G.effCh[G.eff] > 0 && hexDist(eh, hh) <= eff.rangeHex && losClear(G.room, hh, eh)) {
          G.effCh[G.eff]--; G.casts++; G.zoneT = 0
          G.ray = { t: 1, ax: G.x, ay: G.y, bx: e.x, by: e.y, c: eff.visual.rayColor }
          sfx({ frequency: eff.id === 'fire' ? 200 : 620, duration: 0.2, volume: 0.4, type: eff.id === 'fire' ? 'sawtooth' : 'sine' })
          if (eff.mechanical.damage) { e.hp -= eff.mechanical.damage; if (e.hp <= 0) { e.st = -1; G.kills++ } }
          if (eff.mechanical.calm) { e.sus = 0; e.st = Math.min(e.st, 0) }
          if (eff.mechanical.stun) e.stun = eff.mechanical.stun
          if (eff.mechanical.loud) {
            for (const o of G.en) {
              if (o === e || o.st < 0) continue
              if (hexDist(pxHex(o.x, o.y), eh) <= 3) { o.sus = Math.min(1, o.sus + 0.6); o.f = Math.atan2(e.y - o.y, e.x - o.x); if (o.st === 0) o.st = 1 }
            }
          }
        } else {
          sfx({ frequency: 160, duration: 0.1, volume: 0.25, type: 'square' })
        }
      } else {
        const tn = nearestNode(mx, gpy, S * 0.8)
        if (tn >= 0 && !gateBlocked(tn)) {
          const path = bfsPath(tn)
          if (path.length) { G.path = path; if (G.moveT >= 1) { G.fx = G.x; G.fy = G.y } }
        }
      }
    }
  }
  if (!wd.mouse_down) G.mHeld = 0

  // ── walk the path node by node ──
  if (G.moveT >= 1 && G.path.length) {
    const nx = G.path.shift()
    G.fx = G.x; G.fy = G.y
    G.node = nx; G.moveT = 0
    G.face = Math.atan2(NODES[nx].y - G.fy, NODES[nx].x - G.fx)
  }
  if (G.moveT < 1) {
    G.moveT = Math.min(1, G.moveT + pdt * 3.4)
    const e2 = G.moveT * G.moveT * (3 - 2 * G.moveT)
    G.x = G.fx + (NODES[G.node].x - G.fx) * e2
    G.y = G.fy + (NODES[G.node].y - G.fy) * e2
  }

  // ── SPACE: shadow step (the shadow controller) ──
  if (wd.key_space && !G.spaceHeld) {
    G.spaceHeld = 1
    if (G.charges > 0) {
      let best = -1, bs = -2
      for (const nb of NODES[G.node] ? NODES[G.node].a : []) {
        for (const nb2 of NODES[nb].a) {
          if (gateBlocked(nb2)) continue
          const a = Math.atan2(NODES[nb2].y - G.y, NODES[nb2].x - G.x)
          const sc = Math.cos(a - G.face)
          if (sc > bs) { bs = sc; best = nb2 }
        }
      }
      if (best >= 0 && bs > 0.3) {
        G.charges--; G.shadow = 1.2
        G.node = best; G.x = NODES[best].x; G.y = NODES[best].y; G.path = []; G.moveT = 1
        sfx({ frequency: 340, duration: 0.18, volume: 0.3, type: 'sine' })
      }
    }
  }
  if (!wd.key_space) G.spaceHeld = 0
  G.shadow = Math.max(0, G.shadow - pdt)

  // ── doors trigger continuously — reaching the door hex is enough to leave ──
  for (const d of DOORS) {
    if (d.room !== G.room) continue
    if (Math.hypot(G.x - d.px[0], G.y - d.px[1]) < S * 0.95 && !(d.gated && !G.hasKey)) { roomSwap(d.to, d.spx); break }
  }
  // ── arrivals: key, chest (node-scoped) ──
  if (G.moveT >= 1) {
    if (G.room === 2 && !G.hasKey && Math.hypot(G.x - KEYPX[0], G.y - KEYPX[1]) < S * 0.6) {
      G.hasKey = 1
      sfx([{ frequency: 660, duration: 0.09, volume: 0.35, type: 'sine' }, { frequency: 990, duration: 0.16, volume: 0.3, type: 'sine' }])
      wd.__save_game = { slot: 'esper', data: { hasKey: 1, chest: G.chest, wins: G.wins } }
    }
    if (G.room === 3 && !G.chest && Math.hypot(G.x - CHESTPX[0], G.y - CHESTPX[1]) < S * 1.1) {
      G.chest = 1; G.flare = 1; G.wins++
      sfx([{ frequency: 523, duration: 0.12, volume: 0.35, type: 'triangle' }, { frequency: 659, duration: 0.12, volume: 0.35, type: 'triangle' },
           { frequency: 784, duration: 0.12, volume: 0.35, type: 'triangle' }, { frequency: 1046, duration: 0.3, volume: 0.4, type: 'triangle' }])
      wd.__save_game = { slot: 'esper', data: { hasKey: G.hasKey, chest: 1, wins: G.wins } }
    }
  }

  // ── enemies ──
  const cfgs = ROOMS[G.room].enemies
  const covered = NODES[G.node] ? NODES[G.node].c === 1 : false
  let exposed = 0
  for (let i = 0; i < G.en.length; i++) {
    const cfg = cfgs[i], e = G.en[i]
    if (e.st < 0) continue
    if (e.stun > 0) { e.stun -= pdt; continue }
    const eh = pxHex(e.x, e.y), hh = pxHex(G.x, G.y)
    const dist = hexDist(eh, hh)

    let seen = false
    if (G.shadow <= 0 && !covered && dist >= 1 && dist <= cfg.range) {
      let rel = Math.atan2(G.y - e.y, G.x - e.x) - e.f
      rel = Math.atan2(Math.sin(rel), Math.cos(rel))
      if (Math.abs(rel) < cfg.half) seen = losClear(G.room, eh, hh)
    }
    if (seen) exposed = 1

    if (e.st < 2) {
      if (seen) {
        e.sus += pdt * (cfg.kind === 'sentry' ? 1.6 : 0.9)
        e.f = Math.atan2(G.y - e.y, G.x - e.x)
        if (e.sus >= 1) {
          e.st = 2; e.lost = 0; G.alarm++
          sfx([{ frequency: 740, duration: 0.1, volume: 0.4, type: 'square' }, { frequency: 740, duration: 0.1, volume: 0.35, type: 'square' }])
        } else if (e.st === 0 && e.sus > 0.15) e.st = 1
      } else {
        e.sus = Math.max(0, e.sus - pdt * 0.5)
        if (e.sus < 0.1) e.st = 0
        if (cfg.kind === 'sentry') e.f += cfg.spin * pdt
        else {
          const tgt = e.pts[e.wp]
          const dx = tgt[0] - e.x, dy = tgt[1] - e.y
          const d = Math.hypot(dx, dy)
          if (d < 3) e.wp = (e.wp + 1) % e.pts.length
          else { e.x += dx / d * cfg.speed * pdt; e.y += dy / d * cfg.speed * pdt; e.f = Math.atan2(dy, dx) }
        }
      }
    } else {
      if (seen) e.lost = 0; else e.lost += pdt
      if (cfg.kind !== 'sentry') {
        const dx = G.x - e.x, dy = G.y - e.y
        const d = Math.hypot(dx, dy) || 1
        e.x += dx / d * 58 * pdt; e.y += dy / d * 58 * pdt; e.f = Math.atan2(dy, dx)
        if (d < 11) { reset(); break }
      }
      if (e.lost > 2.5 && G.alarm < 3) { e.st = 1; e.sus = 0.5 }
    }
  }

  G.hurt = Math.max(0, G.hurt - 2.0 * pdt)
  G.flare = Math.max(0, G.flare - 0.6 * pdt)
  G.ray.t = Math.max(0, G.ray.t - 2.2 * pdt)

  // camera eases onto the esper (screen space, matches the shader's iso_scr)
  const tcx = G.x, tcy = G.y * ISY + IYOFF - 9
  G.camx += (tcx - G.camx) * Math.min(1, 4 * pdt)
  G.camy += (tcy - G.camy) * Math.min(1, 4 * pdt)

  // cursor in world coords, for node hover
  let mwx = -999, mwy = -999
  if (typeof wd.mouse_x === 'number') {
    mwx = G.camx + (wd.mouse_x - 256) / 2
    mwy = (G.camy + (wd.mouse_y - 256) / 2 - IYOFF) / ISY
  }

  const u = [G.room, G.x, G.y, G.face, covered ? 1 : 0, G.shadow, G.charges, G.alarm, G.flare, exposed, G.hasKey, G.chest]
  for (let i = 0; i < 3; i++) {
    const e = G.en[i]
    if (e && e.st >= 0) u.push(e.x, e.y, e.f, e.st); else u.push(0, 0, 0, -1)
  }
  u.push(G.hurt, G.eff, G.camx, G.camy, G.ray.t, G.ray.ax, G.ray.ay, G.ray.bx, G.ray.by, G.ray.c[0], G.ray.c[1], G.ray.c[2], mwx, mwy, G.zoneT, G.casts * 7.13)
  wd.gpuUniforms = u

  wd.hud = [
    { id: 'eq_room', type: 'text', x: '14px', y: '12px', text: ROOMS[G.room].name.toUpperCase(), color: '#9fe8d8', fontSize: '13px' },
    { id: 'eq_ch', type: 'text', x: '14px', y: '32px', text: '\\u25c8'.repeat(G.charges) + '\\u25c7'.repeat(Math.max(0, 3 - G.charges)) + '  shadow', color: '#7fd4ff', fontSize: '14px' },
    { id: 'eq_eff', type: 'text', x: '14px', y: '52px', text: EFFECTS[G.eff].name.toUpperCase() + ' \\u00d7' + G.effCh[G.eff] + '  \\u00b7 shift: arm/cycle \\u00b7 click enemy: cast \\u00b7 behind+close: silent kill', color: G.eff === 0 ? '#ff8866' : '#88bbff', fontSize: '12px' },
    { id: 'eq_al', type: 'bar', right: '14px', y: '16px', value: G.alarm, max: 3, color: '#cc2244' },
    { id: 'eq_q', type: 'text', x: '14px', bottom: '12px', color: '#c9b370', fontSize: '13px',
      text: G.chest ? 'the treasure is yours (' + G.wins + ')' : (G.hasKey ? 'the north door is open' : 'find the key in the Hollow — east door') },
  ]
  if (hero) hero.name = 'Esper — ' + G.wins + ' treasures, ' + G.kills + ' kills'
} catch (e) { /* keep the sim alive */ }
`

// ─────────────────────────────────────────────────────────────────────────────
const field = (id, name, color, x, y, shape, visualTypeName, flags = {}) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  ...(visualTypeName ? { visualTypeName } : {}),
  ...flags,
})

const startPx = rooms[1].props.s.px
const scene = {
  name: 'ESPER',
  fields: [
    field('eq_bg', 'Esper', [0.05, 0.08, 0.07, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'esper', { noHit: true, noCollide: true }),
    field('eq_hero', 'Esper Hero', [0.15, 0.45, 0.45, 0.0], startPx[0], startPx[1] * ISY + IYOFF, { shapeType: 'circle', radius: 8 }, undefined, { noHit: true }),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    postProcess: { bloomIntensity: 0.42, bloomThreshold: 0.72, exposure: 1.0, vignetteStrength: 0.34, vignetteRadius: 0.74 },
  },
  stepHooks: [{ id: 'eq_core', author: 'fable', description: 'ESPER v3: isometric hex-kite stealth — full c/m/v node graph with click-to-move BFS, effect controllers (fire/psychic/shadow), 3 rooms in one tab.', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'esper', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'ESPER', scene }),
})
console.log('ESPER v3 saved:', res.status, await res.text(),
  `(rooms: ${Object.values(rooms).map(r => r.name + ':' + r.nodes.length + ' nodes').join(', ')})`)
