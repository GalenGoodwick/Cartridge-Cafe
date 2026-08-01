try {
  const wd = sim.worldData
  // ── penta math (inlined from the tested core) ──
  const AP = 1 / (2 * Math.tan(Math.PI / 5)), CR = 1 / (2 * Math.sin(Math.PI / 5)), ST = 2 * Math.PI / 5
  const ena = (t, e) => t.th + Math.PI / 2 + (e + 0.5) * ST
  const attach = (t, e) => { const n = ena(t, e); return { cx: t.cx + 2 * AP * Math.cos(n), cy: t.cy + 2 * AP * Math.sin(n), th: n + Math.PI / 2 - Math.PI / 5 } }
  const verts = (t) => { const o = []; for (let k = 0; k < 5; k++) { const a = t.th + Math.PI / 2 + k * ST; o.push({ x: t.cx + CR * Math.cos(a), y: t.cy + CR * Math.sin(a) }) } return o }
  const shrink = (t) => verts(t).map(v => ({ x: v.x + (t.cx - v.x) * 1e-4, y: v.y + (t.cy - v.y) * 1e-4 }))
  const axes = (vs) => { const o = []; for (let i = 0; i < 5; i++) { const a = vs[i], b = vs[(i + 1) % 5]; const nx = -(b.y - a.y), ny = b.x - a.x, L = Math.hypot(nx, ny); o.push({ x: nx / L, y: ny / L }) } return o }
  const overlaps = (t1, t2) => {
    if (Math.hypot(t1.cx - t2.cx, t1.cy - t2.cy) > 2 * CR) return false
    const v1 = shrink(t1), v2 = shrink(t2)
    for (const ax of axes(v1).concat(axes(v2))) {
      let a1 = Infinity, b1 = -Infinity, a2 = Infinity, b2 = -Infinity
      for (const v of v1) { const p = v.x * ax.x + v.y * ax.y; if (p < a1) a1 = p; if (p > b1) b1 = p }
      for (const v of v2) { const p = v.x * ax.x + v.y * ax.y; if (p < a2) a2 = p; if (p > b2) b2 = p }
      if (b1 < a2 || b2 < a1) return false
    }
    return true
  }
  // ── THE MODULE CATALOGUE (parts.mjs, inlined) — the single source of truth for
  //    what a tile IS: cost, battle durability, design-stat, colour, category.
  //    The designer + the battle both read this. NAME/COST/STAT/HPB below are thin
  //    shims over it so existing v9 code is unchanged (values are identical). ──
  const PARTS = [
    { code: 0, name: 'BLANK', category: 'BLANK', cost: 0, hp: 6, color: [0.30, 0.36, 0.46], stat: { mass: 0.5, hp: 4, dps: 0, thrust: 0, energy: 0 } },
    { code: 1, name: 'HULL', category: 'HULL', cost: 10, hp: 14, color: [0.36, 0.50, 0.65], stat: { mass: 1, hp: 10, dps: 0, thrust: 0, energy: 0 } },
    { code: 2, name: 'ARMOR', category: 'ARMOR', cost: 18, hp: 40, color: [0.54, 0.58, 0.65], stat: { mass: 2, hp: 30, dps: 0, thrust: 0, energy: 0 } },
    { code: 3, name: 'GUN', category: 'GUNS', cost: 30, hp: 12, color: [1.00, 0.48, 0.42], stat: { mass: 1.5, hp: 8, dps: 6, thrust: 0, energy: -2 } },
    { code: 4, name: 'ENGINE', category: 'DRIVE', cost: 22, hp: 12, color: [0.48, 0.86, 1.00], stat: { mass: 1, hp: 8, dps: 0, thrust: 4, energy: -1 } },
    { code: 5, name: 'GEN', category: 'POWER', cost: 26, hp: 10, color: [0.62, 1.00, 0.54], stat: { mass: 1, hp: 6, dps: 0, thrust: 0, energy: 4 } },
  ]
  const PALETTE = [1, 2, 3, 4, 5]
  const CATEGORIES = ['HULL', 'ARMOR', 'GUNS', 'DRIVE', 'POWER']
  const partOf = (part) => { if (part && typeof part === 'object') part = part.part; if (typeof part === 'string') { const up = part.toUpperCase(); const bn = PARTS.find(p => p.name === up); if (bn) return bn; part = Number(part) } return PARTS[part | 0] || PARTS[0] }
  const statOf = (part) => { const p = partOf(part); return { mass: p.stat.mass, hp: p.stat.hp, dps: p.stat.dps, thrust: p.stat.thrust, energy: p.stat.energy, durability: p.hp, cost: p.cost, name: p.name, category: p.category, code: p.code } }
  const NAME = PARTS.map((p) => p.name)
  const COST = Object.fromEntries(PARTS.map((p) => [p.code, p.cost]))

  // ═══ IN A ROOM: war room → battle (the hook is the server authority) ═══
  const players = wd.players
  if (Array.isArray(players)) {
    if (!wd.__pw) wd.__pw = { designs: {}, ships: {}, t: 0, pts: [{ x: 0, y: -0.62 }, { x: -0.58, y: 0.42 }, { x: 0.58, y: 0.42 }], own: [0, 0, 0], inc: {} }
    const W = wd.__pw
    W.t += dt
    const cl2 = (v, a, b) => Math.max(a, Math.min(b, v))
    // designs arrive riding the input stream
    for (const p of players) {
      if (p.seat == null || W.designs[p.seat]) continue
      if (typeof p.design === 'string' && p.design.length < 9000) {
        try { const tr = JSON.parse(p.design); if (Array.isArray(tr) && tr.length >= 1 && tr.length <= 60) W.designs[p.seat] = tr } catch (e) {}
      }
    }
    const seats = players.map(p => p.seat).filter(s => s != null).sort((a, b) => a - b)
    const host = seats[0]
    if (!wd.__started) {
      // ── WAR ROOM: seats, readiness, host START ──
      for (const p of players) {
        if (p.seat !== host) continue
        const ux2 = (typeof p.mouse_x === 'number' ? p.mouse_x : 256) / 256 - 1
        const uy2 = (typeof p.mouse_y === 'number' ? p.mouse_y : 256) / 256 - 1
        if (sim.edge('start' + p.seat, !!p.mouse_down) && Math.abs(ux2) < 0.34 && Math.abs(uy2 - 0.55) < 0.12) {
          wd.__started = true
          wd.__play_sound = [{ frequency: 440, duration: 0.3, volume: 0.2, type: 'sine' }, { frequency: 660, duration: 0.4, volume: 0.16, type: 'sine' }, { frequency: 880, duration: 0.5, volume: 0.12, type: 'sine' }]
        }
      }
      const out2 = []
      const u2 = []; u2[0] = W.t; for (let i = 0; i < 16; i++) if (u2[i] == null) u2[i] = 0
      wd.gpuUniforms = u2
      wd.gpuPopulation = out2
      wd.hud = [
        { id: 'wr', type: 'text', x: '50%', y: '18%', text: '⚔ WAR ROOM', fontSize: '18px', color: '#cfe0f5' },
        ...seats.map((s, i) => ({ id: 'seat' + s, type: 'text', x: '50%', y: (28 + i * 6) + '%', text: 'CMDR ' + (s + 1) + (s === host ? ' ★HOST' : '') + (W.designs[s] ? '  — hull ready (' + W.designs[s].length + ' tiles)' : '  — no hull (default scout)'), fontSize: '13px', color: '#9fd8ff' })),
        { id: 'st', type: 'text', x: '50%', y: '76%', text: host != null ? ('[  START BATTLE  ] — CMDR ' + (host + 1) + ' decides') : '', fontSize: '15px', color: '#ffe9a8' },
      ]
      return
    }
    // ── BATTLE (stub v1: designed hulls sail + capture; guns next) ──
    const seated2 = new Set(seats)
    for (const p of players) {
      const s = p.seat; if (s == null) continue
      if (!W.ships[s]) {
        const tr = W.designs[s] || [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 4 }]
        const tl = [{ cx: 0, cy: 0, th: 0 }]
        for (let i = 1; i < tr.length; i++) { const d2 = tr[i]; if (tl[d2.parent]) tl.push(attach(tl[d2.parent], d2.edge)) }
        let cx2 = 0, cy2 = 0; for (const t2 of tl) { cx2 += t2.cx; cy2 += t2.cy } cx2 /= tl.length; cy2 /= tl.length
        const HPB = Object.fromEntries(PARTS.map((p) => [p.code, p.hp]))   // battle durability, from the catalogue
        let mass = 0, thr = 0
        const tiles2 = tl.map((t2, i) => { const part = tr[i] ? tr[i].part : 1; mass += part === 2 ? 2 : 1; if (part === 4) thr += 4; return { dx: (t2.cx - cx2) * 0.11, dy: (t2.cy - cy2) * 0.11, th: t2.th, part, hp: HPB[part] || 10 } })
        W.ships[s] = { x: (s % 2 ? 0.8 : -0.8), y: s < 2 ? 0.8 : -0.8, vx: 0, vy: 0, a: 0, tiles: tiles2, spd: cl2(0.35 + (thr / Math.max(mass, 1)) * 0.25, 0.2, 1.4) }
      }
      const sh = W.ships[s]
      const tx = (typeof p.mouse_x === 'number' ? p.mouse_x : 256) / 256 - 1
      const ty = (typeof p.mouse_y === 'number' ? p.mouse_y : 256) / 256 - 1
      const dx = tx - sh.x, dy = ty - sh.y, d3 = Math.hypot(dx, dy) + 1e-4
      sh.vx = sh.vx * 0.88 + (dx / d3) * Math.min(1, d3 * 5) * 0.02 * sh.spd * 8
      sh.vy = sh.vy * 0.88 + (dy / d3) * Math.min(1, d3 * 5) * 0.02 * sh.spd * 8
      sh.x = cl2(sh.x + sh.vx * dt * 6, -0.95, 0.95); sh.y = cl2(sh.y + sh.vy * dt * 6, -0.95, 0.95)
      if (Math.hypot(sh.vx, sh.vy) > 0.01) sh.a = Math.atan2(sh.vy, sh.vx) - Math.PI / 2
    }
    for (const s of Object.keys(W.ships)) if (!seated2.has(+s)) delete W.ships[s]
    const RC = 0.16
    for (let i = 0; i < 3; i++) {
      const pt = W.pts[i]
      const inR = []
      for (const s of Object.keys(W.ships)) { const sh = W.ships[s]; if (Math.hypot(sh.x - pt.x, sh.y - pt.y) < RC) inR.push(+s) }
      if (inR.length === 1) W.own[i] = inR[0] + 1
      else if (inR.length > 1) W.own[i] = 0
      if (W.own[i] > 0) W.inc[W.own[i] - 1] = (W.inc[W.own[i] - 1] || 0) + dt * 2
    }
    const out3 = []
    for (let i = 0; i < 3; i++) out3.push(W.pts[i].x, W.pts[i].y, 0.16, 200 + W.own[i])
    for (const s of Object.keys(W.ships)) {
      const sh = W.ships[s]
      const ca = Math.cos(sh.a), sa = Math.sin(sh.a)
      for (const t2 of sh.tiles) {
        if (t2.hp <= 0) continue
        out3.push(sh.x + t2.dx * ca - t2.dy * sa, sh.y + t2.dx * sa + t2.dy * ca, t2.th + sh.a, t2.part + ((+s) + 2) * 100)
      }
    }
    wd.gpuPopulation = out3
    const u3 = []; u3[0] = W.t; u3[7] = 0.11; for (let i = 0; i < 16; i++) if (u3[i] == null) u3[i] = 0
    wd.gpuUniforms = u3
    const board = Object.keys(W.inc).map(s => ({ s: +s, v: Math.floor(W.inc[s]) })).sort((a, b) => b.v - a.v).slice(0, 4)
    wd.hud = [
      { id: 'bt', type: 'text', x: '3%', y: '5%', text: 'PENTARCH — hold the rings', fontSize: '13px', color: '#cfe0f5' },
      ...board.map((b, i) => ({ id: 'bs' + i, type: 'text', x: '3%', y: (9 + i * 4) + '%', text: 'CMDR ' + (b.s + 1) + ' — ' + b.v + '⬡', fontSize: '12px', color: '#9fd8ff' })),
    ]
    return
  }
  if (!wd.__pd) wd.__pd = { tree: [{ parent: -1, edge: -1, part: 1 }], sel: 0, rev: 0, t: 0 }
  const D = wd.__pd
  D.t += Math.min(dt, 1 / 30)

  // layout (cached per rev)
  if (D.rev !== D.layoutRev) {
    const tiles = [{ cx: 0, cy: 0, th: 0 }]
    for (let i = 1; i < D.tree.length; i++) { const d = D.tree[i]; tiles.push(attach(tiles[d.parent], d.edge)) }
    // contacts → used edges
    const used = new Set()
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      if (Math.hypot(tiles[i].cx - tiles[j].cx, tiles[i].cy - tiles[j].cy) > 2 * AP + 0.01) continue
      for (let ei = 0; ei < 5; ei++) for (let ej = 0; ej < 5; ej++) {
        const na = ena(tiles[i], ei), nb = ena(tiles[j], ej)
        const ma = { x: tiles[i].cx + AP * Math.cos(na), y: tiles[i].cy + AP * Math.sin(na) }
        const mb = { x: tiles[j].cx + AP * Math.cos(nb), y: tiles[j].cy + AP * Math.sin(nb) }
        if (Math.hypot(ma.x - mb.x, ma.y - mb.y) < 1e-3) { used.add(i + ':' + ei); used.add(j + ':' + ej) }
      }
    }
    // legal ghosts
    const ghosts = []
    for (let i = 0; i < tiles.length; i++) for (let e = 0; e < 5; e++) {
      if (used.has(i + ':' + e)) continue
      const g = attach(tiles[i], e)
      let bad = false
      for (const t of tiles) if (overlaps(g, t)) { bad = true; break }
      if (!bad) ghosts.push({ i, e, g })
    }
    // voids: coincident vertices, 360 - n·108 in (1°,108°)
    const pts = []
    tiles.forEach((t, i) => verts(t).forEach(v => pts.push({ i, x: v.x, y: v.y })))
    const voids = []
    const seen = new Set()
    for (let a = 0; a < pts.length; a++) {
      if (seen.has(a)) continue
      const cl = [pts[a]]; seen.add(a)
      for (let b = a + 1; b < pts.length; b++) { if (!seen.has(b) && Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) < 1e-3) { cl.push(pts[b]); seen.add(b) } }
      const gap = 360 - 108 * cl.length
      if (cl.length >= 2 && gap > 1 && gap < 108) {
        let dx = 0, dy = 0
        for (const p of cl) { const t = tiles[p.i]; dx += t.cx - p.x; dy += t.cy - p.y }
        const L = Math.hypot(dx, dy) || 1
        voids.push({ x: pts[a].x - dx / L * 0.22, y: pts[a].y - dy / L * 0.22 })
      }
    }
    // ── ENCLOSED HOLES: the shape grammar (diamond/moon/star/bay) ──
    const segs = []
    for (let i = 0; i < tiles.length; i++) for (let e = 0; e < 5; e++) {
      if (used.has(i + ':' + e)) continue
      const vs = verts(tiles[i])
      segs.push({ a: vs[e], b: vs[(e + 1) % 5], used: false })
    }
    const q = (v) => Math.round(v * 2000) / 2000
    const kk = (p) => q(p.x) + ',' + q(p.y)
    const byS = {}
    for (const s of segs) { const k = kk(s.a); (byS[k] = byS[k] || []).push(s) }
    const holesL = []
    for (const s0 of segs) {
      if (s0.used) continue
      const loop = []; let cur = s0
      for (let g = 0; g < segs.length + 2; g++) {
        cur.used = true; loop.push(cur)
        const nx = (byS[kk(cur.b)] || []).filter(s => !s.used)
        if (!nx.length) break
        if (nx.length === 1) { cur = nx[0]; continue }
        // planar face-walk: take the FIRST outgoing edge counterclockwise from
        // the reversed incoming direction — closes loops through vertex pinches
        const back = Math.atan2(cur.b.y - cur.a.y, cur.b.x - cur.a.x) + Math.PI
        let best = null, bt = Infinity
        for (const n of nx) {
          const oD = Math.atan2(n.b.y - n.a.y, n.b.x - n.a.x)
          let d2 = (oD - back) % (2 * Math.PI); if (d2 < 1e-9) d2 += 2 * Math.PI
          if (d2 < bt) { bt = d2; best = n }
        }
        cur = best
      }
      if (loop.length < 3 || kk(loop[loop.length - 1].b) !== kk(loop[0].a)) continue
      const poly = loop.map(s => s.a)
      let A2 = 0
      for (let i = 0; i < poly.length; i++) { const p = poly[i], r2 = poly[(i + 1) % poly.length]; A2 += p.x * r2.y - r2.x * p.y }
      if (A2 / 2 >= -1e-6) continue
      const pp = poly.slice().reverse()
      const n2 = pp.length
      let area = Math.abs(A2 / 2), hx = 0, hy = 0, spikes = 0, reflex = 0
      for (const p of pp) { hx += p.x; hy += p.y } hx /= n2; hy /= n2
      for (let i = 0; i < n2; i++) {
        const p0 = pp[(i + n2 - 1) % n2], p1 = pp[i], p2 = pp[(i + 1) % n2]
        const a1 = Math.atan2(p0.y - p1.y, p0.x - p1.x), a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x)
        const deg = ((a1 - a2 + Math.PI * 4) % (2 * Math.PI)) * 180 / Math.PI
        if (deg < 100) spikes++
        if (deg > 185) reflex++
      }
      let shape = 'gap'                                   // residual crack: no payout
      if (spikes >= 4 && reflex >= 4 && area >= 1.2 && area <= 3.6 && n2 <= 14) shape = 'star'
      else if (spikes === 2 && reflex >= 1 && area >= 2.0 && area <= 4.6) shape = 'moon'
      else if (area < 0.75 && n2 <= 6 && spikes >= 1) shape = 'diamond'
      else if (area >= 0.9 && spikes <= 3) shape = 'bay'
      let rMax = 0
      for (const p of pp) rMax = Math.max(rMax, Math.hypot(p.x - hx, p.y - hy))
      holesL.push({ shape, x: hx, y: hy, area, r: rMax, poly: pp })
    }
    const nowShapes = {}
    for (const hh of holesL) { if (hh.shape !== 'gap') nowShapes[hh.shape] = (nowShapes[hh.shape] || 0) + 1 }
    const before = D.sealed || {}
    for (const s2 of Object.keys(nowShapes)) {
      if ((before[s2] || 0) < nowShapes[s2]) {
        D.flash = 1.2
        D.flashKind = s2
        wd.__play_sound = [{ frequency: s2 === 'star' ? 1320 : s2 === 'moon' ? 880 : 660, duration: 0.4, volume: 0.22, type: 'sine' }, { frequency: s2 === 'star' ? 1980 : 1320, duration: 0.5, volume: 0.12, type: 'sine' }]
      }
    }
    D.sealed = nowShapes          // deletion re-opens: sealed mirrors the LIVE holes
    D.holesL = holesL
    // ── UNIFY: a void is ONE region. Wedges on a sealed hole belong to it;
    //    the rest merge by proximity into single open-pinch markers. ──
    {
      const open = voids.filter(v => !holesL.some(hh => Math.hypot(hh.x - v.x, hh.y - v.y) < (hh.r || 0.6) + 0.35))
      const merged = []
      for (const v of open) {
        const g = merged.find(m => Math.hypot(m.x - v.x, m.y - v.y) < 0.95)
        if (g) { g.x = (g.x * g.n + v.x) / (g.n + 1); g.y = (g.y * g.n + v.y) / (g.n + 1); g.n++ }
        else merged.push({ x: v.x, y: v.y, n: 1 })
      }
      D.voidsL = merged
    }
    D.tilesL = tiles; D.ghostsL = ghosts; D.layoutRev = D.rev
  }
  const tiles = D.tilesL, ghosts = D.ghostsL, voids = D.voidsL

  // ── view transform: fit the hull ──
  let mx = 0, my = 0, ex = 1
  for (const t of tiles) { mx += t.cx; my += t.cy }
  mx /= tiles.length; my /= tiles.length
  for (const t of tiles) ex = Math.max(ex, Math.hypot(t.cx - mx, t.cy - my) + 1.2)
  const S = Math.min(0.12, 0.80 / ex)
  const toUV = (x, y) => ({ x: (x - mx) * S, y: (y - my) * S })

  // ── input ──
  const ptr = (wd.input && wd.input.pointer) || {}
  const mxp = (typeof ptr.x === 'number') ? ptr.x : wd.mouse_x
  const myp = (typeof ptr.y === 'number') ? ptr.y : wd.mouse_y
  const ux = (typeof mxp === 'number') ? mxp / 256 - 1 : null
  const uy = (typeof myp === 'number') ? myp / 256 - 1 : null
  const click = sim.edge('yard-click', !!ptr.down || wd.mouse_down === true)

  // hover: nearest legal ghost (in uv space)
  let hover = -1, hd = 0.10
  if (ux != null && uy < 0.74) for (let k = 0; k < ghosts.length; k++) {
    const p = toUV(ghosts[k].g.cx, ghosts[k].g.cy)
    const d = Math.hypot(p.x - ux, p.y - uy)
    if (d < hd) { hd = d; hover = k }
  }
  // nearest tile (for select)
  let tSel = -1, td = 0.09
  if (ux != null) for (let i = 0; i < tiles.length; i++) {
    const p = toUV(tiles[i].cx, tiles[i].cy)
    const d = Math.hypot(p.x - ux, p.y - uy)
    if (d < td) { td = d; tSel = i }
  }

  if (click && ux != null) {
    if (D.screen === 'finder') {
      // SERVER FINDER: rows of live rooms + NEW SERVER + BACK
      const rooms = (wd.__lobby && wd.__lobby.rooms) || []
      const rowY = (i) => -0.45 + i * 0.14
      let hit = -1
      for (let i = 0; i < rooms.length && i < 7; i++) if (Math.abs(uy - rowY(i)) < 0.06 && Math.abs(ux) < 0.6) hit = i
      const newY = rowY(Math.min(rooms.length, 7)) 
      if (Math.abs(uy - newY) < 0.06 && Math.abs(ux) < 0.6) hit = 98
      if (uy > 0.8) hit = 99
      if (hit === 99) { D.screen = 'design' }
      else if (hit === 98) { wd.__sendDesign = JSON.stringify(D.tree); wd.__joinRoom = 'srv-' + Math.floor(sim.rand() * 9000 + 1000) }
      else if (hit >= 0) { wd.__sendDesign = JSON.stringify(D.tree); wd.__joinRoom = rooms[hit].room }
      if (wd.__joinRoom) wd.__play_sound = [{ frequency: 700, duration: 0.15, volume: 0.15, type: 'sine' }]
    } else if (ux > 0.68 && uy < -0.78) {                     // ⚔ BATTLE pad (top-right)
      D.screen = 'finder'
      wd.__play_sound = [{ frequency: 560, duration: 0.1, volume: 0.12, type: 'sine' }]
    } else if (uy > 0.76) {                                        // palette strip
      const s = Math.round((ux + 0.52) / 0.26)
      if (s === 5) {                                          // the DELETE toggle pad
        D.delMode = !D.delMode
        wd.__play_sound = [{ frequency: D.delMode ? 260 : 420, duration: 0.1, volume: 0.14, type: 'triangle' }]
      } else if (s >= 0 && s <= 4 && D.sel >= 0 && !D.delMode) {
        D.tree[D.sel].part = s + 1
        wd.__play_sound = [{ frequency: 500 + s * 90, duration: 0.08, volume: 0.12, type: 'sine' }]
      }
    } else if (tSel >= 0 && tSel !== 0 && (D.delMode || wd.key_control || wd.key_ctrl || wd.key_meta || wd.key_x || (D.lastClick && D.lastClick.tile === tSel && (D.t - D.lastClick.at) < 0.4))) {
      // ROUTE-AWARE DELETE (Galen): ships re-touch, so connectivity is the
      // CONTACT GRAPH, not the build tree. Remove the tile; keep everything
      // still routed to the base through any flush contact; re-root the tree.
      const surv = []
      for (let i = 0; i < tiles.length; i++) if (i !== tSel) surv.push(i)
      // contacts among survivors (flush edge midpoints coincide)
      const adj = {}
      for (const i of surv) adj[i] = []
      for (let a2 = 0; a2 < surv.length; a2++) for (let b2 = a2 + 1; b2 < surv.length; b2++) {
        const i = surv[a2], j = surv[b2]
        if (Math.hypot(tiles[i].cx - tiles[j].cx, tiles[i].cy - tiles[j].cy) > 2 * AP + 0.01) continue
        for (let ei = 0; ei < 5; ei++) for (let ej = 0; ej < 5; ej++) {
          const na = ena(tiles[i], ei), nb = ena(tiles[j], ej)
          const ma = { x: tiles[i].cx + AP * Math.cos(na), y: tiles[i].cy + AP * Math.sin(na) }
          const mb = { x: tiles[j].cx + AP * Math.cos(nb), y: tiles[j].cy + AP * Math.sin(nb) }
          if (Math.hypot(ma.x - mb.x, ma.y - mb.y) < 1e-3) { adj[i].push({ j, ei }); adj[j].push({ j: i, ei: ej }) }
        }
      }
      // BFS from base over contacts → reachable + a fresh spanning tree
      const newIdx = { 0: 0 }
      const nt = [{ parent: -1, edge: -1, part: D.tree[0].part }]
      const qq = [0]
      while (qq.length) {
        const i = qq.shift()
        for (const { j, ei } of (adj[i] || [])) {
          if (newIdx[j] != null) continue
          newIdx[j] = nt.length
          nt.push({ parent: newIdx[i], edge: ei, part: D.tree[j].part })
          qq.push(j)
        }
      }
      const orphans = surv.length - (nt.length)
      D.tree = nt; D.sel = 0; D.rev++; D.lastClick = null
      if (orphans > 0) wd.__play_sound = [{ frequency: 180, duration: 0.2, volume: 0.14, type: 'triangle' }]
      wd.__play_sound = [{ frequency: 220, duration: 0.12, volume: 0.14, type: 'triangle' }]
    } else if (tSel >= 0) {                                 // select a tile (double-click deletes)
      D.lastClick = { tile: tSel, at: D.t }
      D.sel = tSel
      wd.__play_sound = [{ frequency: 340, duration: 0.05, volume: 0.08, type: 'sine' }]
    } else if (hover >= 0) {                                // grow a BLANK at the ghost
      D.tree.push({ parent: ghosts[hover].i, edge: ghosts[hover].e, part: 0 })
      D.sel = D.tree.length - 1
      D.rev++
      wd.__play_sound = [{ frequency: 700, duration: 0.05, volume: 0.10, type: 'sine' }, { frequency: 980, duration: 0.06, volume: 0.07, type: 'sine' }]
    }
  }
  if (sim.edge('yard-reset', !!wd.key_r)) { wd.__pd = null; return }
  // ── FLEET SLOTS: 1/2/3 pick a berth · S saves the design there · L loads ──
  if (!wd.fleet) wd.fleet = {}
  if (D.slot == null) D.slot = 1
  for (const k of [1, 2, 3]) if (sim.edge('slot' + k, !!wd['key_' + k])) { D.slot = k; wd.__play_sound = [{ frequency: 380 + k * 60, duration: 0.06, volume: 0.1, type: 'sine' }] }
  if (sim.edge('yard-save', !!wd.key_s)) {
    let sc = 0; for (const d2 of D.tree) sc += COST[d2.part] || 0
    wd.fleet[D.slot] = { tree: D.tree.map(t => ({ ...t })), cost: sc, savedAt: D.t }
    D.flash = 0.8; D.flashKind = 'diamond'
    wd.__play_sound = [{ frequency: 660, duration: 0.1, volume: 0.14, type: 'sine' }, { frequency: 990, duration: 0.14, volume: 0.1, type: 'sine' }]
  }
  if (sim.edge('yard-load', !!wd.key_l) && wd.fleet[D.slot]) {
    D.tree = wd.fleet[D.slot].tree.map(t => ({ ...t })); D.sel = 0; D.rev++; D.lastClick = null
    wd.__play_sound = [{ frequency: 520, duration: 0.12, volume: 0.12, type: 'sine' }]
  }

  // ── publish ──
  const out = []
  for (let i = 0; i < tiles.length; i++) {
    const p = toUV(tiles[i].cx, tiles[i].cy)
    out.push(p.x, p.y, tiles[i].th, (D.tree[i].part) + (i === D.sel ? 100 : 0))
  }
  if (hover >= 0) { const p = toUV(ghosts[hover].g.cx, ghosts[hover].g.cy); out.push(p.x, p.y, ghosts[hover].g.th, 60) }
  for (const v of voids) { const p = toUV(v.x, v.y); out.push(p.x, p.y, 0, 70) }
  const SHO = { diamond: 76, moon: 77, star: 78, bay: 79, gap: 80 }
  for (const hh of (D.holesL || [])) {
    const code = SHO[hh.shape] || 80
    const pp2 = (hh.poly || []).map(v => ({ x: hh.x + (v.x - hh.x) * 0.68, y: hh.y + (v.y - hh.y) * 0.68 }))   // INSET: the figure floats within the void, its own lines
    for (let i = 0; i < pp2.length; i++) {
      const a = pp2[i], b = pp2[(i + 1) % pp2.length]
      const m = toUV((a.x + b.x) / 2, (a.y + b.y) / 2)
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const hl = Math.min(0.49, Math.hypot(b.x - a.x, b.y - a.y) / 2 * S)
      out.push(m.x, m.y, ang, code + hl)
    }
    const c = toUV(hh.x, hh.y)
    out.push(c.x, c.y, 0, SHO[hh.shape] === 80 ? 75 : (hh.shape === 'star' ? 73 : hh.shape === 'moon' ? 72 : hh.shape === 'bay' ? 74 : 71))
  }

  wd.gpuPopulation = out
  let cost = 0; for (const d of D.tree) cost += COST[d.part] || 0
  // ── SHIP STATS: the design's meaning. Parts: [mass, hp, dps, thrust, power] ──
  const STAT = Object.fromEntries(PARTS.map((p) => [p.code, [p.stat.mass, p.stat.hp, p.stat.dps, p.stat.thrust, p.stat.energy]]))   // [mass,hp,dps,thrust,energy], from the catalogue
  let sMass = 0, sHp = 0, sDps = 0, sThr = 0, sPwr = 0
  for (const d of D.tree) { const st = STAT[d.part] || STAT[0]; sMass += st[0]; sHp += st[1]; sDps += st[2]; sThr += st[3]; sPwr += st[4] }
  // ── the ladder pays out: sealed geometry IS the tech tree ──
  const nSh = { diamond: 0, moon: 0, star: 0, bay: 0 }
  for (const hh of (D.holesL || [])) { if (hh.shape !== 'gap') nSh[hh.shape] = (nSh[hh.shape] || 0) + 1 }
  sHp = Math.round(sHp * (1 + 0.15 * nSh.diamond))          // diamond: structural lattice +15% HP each
  if (nSh.moon) sPwr = Math.round(sPwr + 3 * nSh.moon)      // moon: resonance chamber +3 power each
  const brownout = sPwr < 0
  const spd = sMass > 0 ? (sThr / sMass * 10) : 0
  const effDps = brownout ? Math.round(sDps * 0.5) : sDps   // starving guns fire at half rate
  D.flash = Math.max(0, (D.flash || 0) - dt * 1.4)
  const u = []
  u[0] = D.t; u[7] = S
  u[11] = D.flash || 0
  u[12] = D.flashKind === 'star' ? 3 : D.flashKind === 'moon' ? 2 : 1
  u[13] = D.delMode ? 1 : 0
  if (ux != null) { u[8] = ux; u[9] = uy; u[10] = 1 } else { u[10] = 0 }
  for (let i = 0; i < 16; i++) if (u[i] == null) u[i] = 0
  wd.gpuUniforms = u
  const selName = NAME[D.tree[D.sel] ? D.tree[D.sel].part : 1]
  wd.hud = [
    { id: 'yt', type: 'text', x: '3%', y: '5%', text: 'PENTARCH SHIPYARD', fontSize: '14px', color: '#cfe0f5' },
    { id: 'yb', type: 'text', x: '88%', y: '6%', text: '⚔ BATTLE', fontSize: '14px', color: '#ffb08a' },
    { id: 'yc', type: 'text', x: '3%', y: '9%', text: 'COST ' + cost + '  ·  TILES ' + tiles.length + '  ·  VOIDS ' + (D.holesL ? D.holesL.filter(hh => hh.shape !== 'gap').length : 0) + ((D.voidsL && D.voidsL.length) ? '  ·  pinches ' + D.voidsL.length : ''), fontSize: '12px', color: '#9fd8ff' },
    { id: 'yfl', type: 'text', x: '3%', y: '29%', text: 'FLEET  ' + [1, 2, 3].map(k => (k === D.slot ? '[' : ' ') + k + (wd.fleet && wd.fleet[k] ? ':' + wd.fleet[k].cost : ':—') + (k === D.slot ? ']' : ' ')).join(' ') + '   S save · L load', fontSize: '11px', color: '#8fb0d8' },
    { id: 'ydm', type: 'text', x: '80%', y: '93%', text: D.delMode ? '⌫ DELETE MODE — click tiles to remove' : '', fontSize: '12px', color: '#ff8a7a' },
    { id: 'ys', type: 'text', x: '3%', y: '13%', text: 'SELECTED: ' + selName + '  (click palette to set)', fontSize: '11px', color: '#ffd479' },
    { id: 'yst', type: 'text', x: '3%', y: '21%', text: 'MASS ' + sMass.toFixed(1) + ' · SPD ' + spd.toFixed(1) + ' · HP ' + sHp + (nSh.diamond ? ' (+' + (nSh.diamond * 15) + '%◇)' : '') + ' · DPS ' + effDps + ' · PWR ' + (sPwr >= 0 ? '+' : '') + sPwr + (brownout ? ' ⚠ BROWNOUT — guns at half; add GEN' : ''), fontSize: '12px', color: brownout ? '#ffb08a' : '#9fd8ff' },
    { id: 'ysw', type: 'text', x: '3%', y: '25%', text: (nSh.star ? '★ SUPER WEAPON SLOT ARMED  ' : '') + (nSh.bay ? '◎ HANGAR BAY ×' + nSh.bay : ''), fontSize: '12px', color: '#ffe9a8' },
    { id: 'yz', type: 'text', x: '3%', y: '17%', text: (D.holesL && D.holesL.filter(hh => hh.shape !== 'gap').length) ? ('SEALED: ' + D.holesL.filter(hh => hh.shape !== 'gap').map(h => h.shape.toUpperCase()).join(' · ')) : '', fontSize: '12px', color: '#ffe9a8' },
    { id: 'yh', type: 'text', x: '3%', y: '93%', text: 'click → grow/select · double-click → delete · R restarts', fontSize: '11px', color: '#7b8daa' },
    { id: 'p1', type: 'text', x: '24%', y: '97%', text: 'HULL', fontSize: '10px', color: '#8fb0d8' },
    { id: 'p2', type: 'text', x: '37%', y: '97%', text: 'ARMOR', fontSize: '10px', color: '#a8b0bd' },
    { id: 'p3', type: 'text', x: '50%', y: '97%', text: 'GUN', fontSize: '10px', color: '#ff9d94' },
    { id: 'p4', type: 'text', x: '62%', y: '97%', text: 'ENGINE', fontSize: '10px', color: '#9fdfff' },
    { id: 'p5', type: 'text', x: '75%', y: '97%', text: 'GEN', fontSize: '10px', color: '#b5ffa8' },
  ]
  if (D.screen === 'finder') {
    const rooms = (wd.__lobby && wd.__lobby.rooms) || []
    wd.hud = [
      { id: 'f0', type: 'text', x: '50%', y: '14%', text: '⚔ SERVER FINDER', fontSize: '17px', color: '#cfe0f5' },
      ...rooms.slice(0, 7).map((r, i) => ({ id: 'fr' + i, type: 'text', x: '50%', y: (27 + i * 7) + '%', text: '▸ ' + r.room + '   ' + r.players + '/' + r.capacity + (r.started ? '  · IN BATTLE' : '  · in lobby'), fontSize: '14px', color: r.started ? '#7b8daa' : '#9fd8ff' })),
      { id: 'fn', type: 'text', x: '50%', y: (27 + Math.min(rooms.length, 7) * 7) + '%', text: '★ NEW SERVER', fontSize: '14px', color: '#ffe9a8' },
      { id: 'fb', type: 'text', x: '50%', y: '92%', text: '← back to the dock', fontSize: '12px', color: '#7b8daa' },
      { id: 'fh', type: 'text', x: '50%', y: '20%', text: rooms.length ? 'click a server to take a seat — your hull sails with you' : 'no live servers — start one', fontSize: '11px', color: '#7b8daa' },
    ]
    wd.gpuPopulation = []
  }
} catch (e) { }
