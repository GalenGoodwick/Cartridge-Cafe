  // layout — recomputed whenever the tree changes. A FUNCTION (not an inline if)
  // so it can run AGAIN after input mutates the tree (delete/grow), so the publish
  // never sees a stale, reindexed tile list.
  const doLayout = () => {
    const tiles = [{ cx: 0, cy: 0, th: D.rootTh || 0 }]
    for (let i = 1; i < D.tree.length; i++) { const d = D.tree[i]; tiles.push(attach(tiles[d.parent], d.edge, d.ce || 0)) }
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
  if (D.rev !== D.layoutRev) doLayout()
  let tiles = D.tilesL, ghosts = D.ghostsL, voids = D.voidsL

  // ── view transform: fit the hull (recomputed after a mutation, below) ──
  let mx = 0, my = 0, S = 0.12
  const computeView = () => {
    mx = 0; my = 0; let ex = 1
    for (const t of tiles) { mx += t.cx; my += t.cy }
    mx /= tiles.length; my /= tiles.length
    for (const t of tiles) ex = Math.max(ex, Math.hypot(t.cx - mx, t.cy - my) + 1.2)
    S = Math.min(0.12, 0.80 / ex)
  }
  computeView()
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

  // SPECIALS MENU — open by clicking a sealed shape (diamond/moon/bay/star);
  // while open, ANY click is consumed by the menu (pick an option, or close by
  // clicking elsewhere) — never falls through to select/delete/deselect.
  if (D.specialsMenu && click && ux != null) {
    const opts2 = ENG.SPECIALS[D.specialsMenu.kind] || []
    let picked = null
    for (let oi = 0; oi < opts2.length; oi++) {
      const oy = D.specialsMenu.uy + 0.10 + oi * 0.09
      if (Math.abs(ux - D.specialsMenu.ux) < 0.26 && Math.abs(uy - oy) < 0.04) picked = opts2[oi].id
    }
    if (picked) {
      D.shapeChoices = D.shapeChoices || {}
      D.shapeChoices[D.specialsMenu.key] = picked
      wd.__play_sound = [{ frequency: 620, duration: 0.08, volume: 0.12, type: 'sine' }]
    }
    D.specialsMenu = null
  } else if (click && ux != null) {
    if (uy > 0.76) {                                        // palette strip
      const s = Math.round((ux + 0.52) / 0.26)
      if (s === 5) {                                          // the DELETE toggle pad
        D.delMode = !D.delMode
        wd.__play_sound = [{ frequency: D.delMode ? 260 : 420, duration: 0.1, volume: 0.14, type: 'triangle' }]
      } else if (s >= 0 && s <= 4 && D.sel === 0 && !D.delMode) {
        wd.__play_sound = [{ frequency: 140, duration: 0.12, volume: 0.12, type: 'triangle' }]   // the HELM is not a slot
      } else if (s >= 0 && s <= 4 && D.sel === -1 && !D.delMode) {
        // nothing selected — arm the BRUSH only, so the next ghost click places it
        const ring = PALCYCLE[s + 1] || [s + 1]
        const at = ring.indexOf(D.brush)
        D.brush = at >= 0 ? ring[(at + 1) % ring.length] : (s + 1)
        wd.__play_sound = [{ frequency: 500 + s * 90, duration: 0.08, volume: 0.12, type: 'sine' }]
      } else if (s >= 0 && s <= 4 && D.sel > 0 && !D.delMode) {
        // V2: re-clicking the same slot CYCLES its variants (GUN→FIXED,
        // ENGINE→JET→GYRO, GEN→BATTERY); a different slot sets its base part
        pushU()
        const ring = PALCYCLE[s + 1] || [s + 1]
        const at = ring.indexOf(D.tree[D.sel].part)
        D.tree[D.sel].part = at >= 0 ? ring[(at + 1) % ring.length] : (s + 1)
        D.brush = D.tree[D.sel].part                          // this part becomes the BRUSH: click ghosts to place it
        wd.__play_sound = [{ frequency: 500 + s * 90 + (at >= 0 ? 120 : 0), duration: 0.08, volume: 0.12, type: 'sine' }]
      }
    } else if (tSel > 0 && tSel === D.sel && !D.delMode && !wd.key_control && !wd.key_ctrl && !wd.key_meta && !wd.key_x
      && !(D.lastClick && D.lastClick.tile === tSel && (D.t - D.lastClick.at) < 0.4)) {
      // CLICK THE SELECTION SPOT ITSELF (the tile you already have selected) to
      // CYCLE its variant — same ring as re-clicking its palette slot, but right
      // on the ship. Checked BEFORE plain re-select, so engaging the selected
      // tile cycles it — but a FAST re-click (the existing double-click-delete
      // window) still deletes; only a slower, deliberate re-click cycles.
      pushU()
      const cur = D.tree[tSel].part
      let ring = null
      for (const k of Object.keys(PALCYCLE)) if (PALCYCLE[k].includes(cur)) { ring = PALCYCLE[k]; break }
      if (ring) { const at = ring.indexOf(cur); D.tree[tSel].part = ring[(at + 1) % ring.length] }
      D.brush = D.tree[tSel].part
      D.lastClick = { tile: tSel, at: D.t }
      wd.__play_sound = [{ frequency: 560 + (ring ? 120 : 0), duration: 0.07, volume: 0.11, type: 'sine' }]
    } else if (tSel >= 0 && tSel !== 0 && (D.delMode || wd.key_control || wd.key_ctrl || wd.key_meta || wd.key_x || (D.lastClick && D.lastClick.tile === tSel && (D.t - D.lastClick.at) < 0.4))) {
      // ROUTE-AWARE DELETE (Galen): ships re-touch, so connectivity is the
      // CONTACT GRAPH, not the build tree. Remove the tile; keep everything
      // still routed to the base through any flush contact; re-root the tree.
      pushU()
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
          // record BOTH edges — parent side (ei) AND child side (ej). Rebuilding with
          // only ei snapped re-rooted tiles to canonical rotation → scrambled geometry
          // → broken contacts → the NEXT delete ate whole linked arcs.
          if (Math.hypot(ma.x - mb.x, ma.y - mb.y) < 1e-3) { adj[i].push({ j, ei, ej }); adj[j].push({ j: i, ei: ej, ej: ei }) }
        }
      }
      // BFS from base over contacts → reachable + a fresh spanning tree (edge + ce
      // reproduce the EXACT survivor geometry — proved: 25/25 flush, reversible, 1e-14)
      const newIdx = { 0: 0 }
      const nt = [{ parent: -1, edge: -1, part: D.tree[0].part, o: D.tree[0].o || 0, m: D.tree[0].m || 0 }]
      const qq = [0]
      while (qq.length) {
        const i = qq.shift()
        for (const { j, ei, ej } of (adj[i] || [])) {
          if (newIdx[j] != null) continue
          newIdx[j] = nt.length
          nt.push({ parent: newIdx[i], edge: ei, ce: ej, part: D.tree[j].part, o: D.tree[j].o || 0, m: D.tree[j].m || 0 })
          qq.push(j)
        }
      }
      const orphans = surv.length - (nt.length)
      D.tree = nt; D.sel = 0; D.rev++; D.lastClick = null
      if (orphans > 0) wd.__play_sound = [{ frequency: 180, duration: 0.2, volume: 0.14, type: 'triangle' }]
      wd.__play_sound = [{ frequency: 220, duration: 0.12, volume: 0.14, type: 'triangle' }]
    } else if (tSel === 0 && D.lastClick && D.lastClick.tile === 0 && (D.t - D.lastClick.at) < 0.4) {
      // double-click the HELM = reset the yard (R belongs to the platform)
      wd.__play_sound = [{ frequency: 220, duration: 0.3, volume: 0.14, type: 'sawtooth' }]
      wd.__pd = null; return
    } else if (tSel >= 0) {                                 // select a tile (double-click deletes)
      D.lastClick = { tile: tSel, at: D.t }
      D.sel = tSel
      if (tSel > 0) D.brush = D.tree[tSel].part            // selecting a component makes it the BRUSH
      wd.__play_sound = [{ frequency: 340, duration: 0.05, volume: 0.08, type: 'sine' }]
    } else if (hover >= 0) {                                // grow at the ghost — the BRUSH's part (a
      // selected/last-placed component), BLANK if nothing has been picked yet
      pushU()
      D.tree.push({ parent: ghosts[hover].i, edge: ghosts[hover].e, part: D.brush || 0 })
      D.sel = D.tree.length - 1
      D.rev++
      wd.__play_sound = [{ frequency: 700, duration: 0.05, volume: 0.10, type: 'sine' }, { frequency: 980, duration: 0.06, volume: 0.07, type: 'sine' }]
    } else if ((() => {
      // SEALED SHAPE click — a sealed diamond/moon/bay/star opens the SPECIALS
      // menu (Galen: "clicking the diamond/etc opens up a side menu with things
      // to select to fill in"). Hit-test against the SAME shape centroids the
      // shader draws (hh.x,hh.y), a small radius since shapes sit tucked inside
      // gaps between tiles.
      for (const hh of (D.holesL || [])) {
        if (hh.shape === 'gap' || !(ENG.SPECIALS[hh.shape] || []).length) continue
        const p = toUV(hh.x, hh.y)
        if (Math.hypot(p.x - ux, p.y - uy) < 0.06) {
          D.specialsMenu = { key: ENG.holeKey({ cx: hh.x, cy: hh.y }), kind: hh.shape, ux: p.x, uy: p.y }
          wd.__play_sound = [{ frequency: 460, duration: 0.06, volume: 0.1, type: 'sine' }]
          return true
        }
      }
      return false
    })()) {
      // handled above (menu opened)
    } else {                                                 // click on NOTHING — deselect entirely
      D.sel = -1
      D.brush = null
      D.lastClick = null
      wd.__play_sound = [{ frequency: 260, duration: 0.05, volume: 0.06, type: 'sine' }]
    }
  }
  // NO hook-level R binding — R is the PLATFORM's game-reset (Galen's law).
  // We register the designer state in __resets instead: when the platform
  // reset fires (if enabled), the yard comes back fresh through THAT door.
  if (!wd.__resets) wd.__resets = ['__pd']
  // ── T: rotate the selected part's FACING (thrust dir / fixed barrel). Five
  //    stops, one per pentagon edge — orientation is destiny (phys envelope). ──
  if (sim.edge('core-flip', !!wd.key_t) && D.sel === 0 && D.tree.length === 1) {
    D.rootTh = D.rootTh ? 0 : Math.PI; D.rev++   // flip the lone HELM 180° (locks once you build)
    wd.__play_sound = [{ frequency: 480, duration: 0.08, volume: 0.1, type: 'sine' }]
  }
  if (sim.edge('rot-part', !!wd.key_t) && D.sel >= 0 && D.tree[D.sel] && ORIENTABLE[D.tree[D.sel].part]) {
    pushU()
    D.tree[D.sel].o = ((D.tree[D.sel].o || 0) + 1) % 5
    wd.__play_sound = [{ frequency: 430 + D.tree[D.sel].o * 45, duration: 0.06, volume: 0.1, type: 'sine' }]
  }
  // ── M: buy/cycle the MOUNT TIER on engines & guns — the arc of rotation.
  //    fixed → swivel ±36° → wide ±90° → ring 360°. Costs money AND weight;
  //    a gimballed engine vectors its thrust (the allocator aims it live). ──
  const MOUNTABLE = { 3: 1, 4: 1, 6: 1, 9: 1 }
  const TIERS = ['fixed', 'swivel', 'wide', 'ring']
  if (sim.edge('mount-tier', !!wd.key_m) && D.sel >= 0 && D.tree[D.sel] && MOUNTABLE[D.tree[D.sel].part]) {
    const cd = D.tree[D.sel]
    pushU()
    cd.m = ((cd.m || 0) + 1) % TIERS.length
    wd.__play_sound = [{ frequency: 300 + cd.m * 110, duration: 0.09, volume: 0.12, type: 'triangle' }]
  }
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
  // GUARD: if input just mutated the tree (delete/grow/load/undo bump D.rev), the
  // cached layout from the top of this tick is STALE — a shorter/longer, reindexed
  // tile list. Re-run it so the publish matches D.tree (else it reads .part of an
  // undefined tile → red error, and draws phantom tiles = "deleted more than one").
  if (D.rev !== D.layoutRev) { doLayout(); tiles = D.tilesL; ghosts = D.ghostsL; voids = D.voidsL; computeView(); hover = -1 }
  const out = []
  // facing digit rides IN the tile code (part + 10·edge): the shader draws the
  // nozzle/barrel itself — no pip dots. Turrets aim their barrel at the middle
  // of their free-edge run (the arc they earned).
  const feByTile = {}
  for (const f of ENG.freeEdgesV2(tiles)) (feByTile[f.i] = feByTile[f.i] || []).push(f.e)
  const faceOf = (i) => {
    const cd = D.tree[i]
    if (ORIENTABLE[cd.part]) return cd.o || 0
    if ((V2SPEC[cd.part] || {}).turret) { const fs = feByTile[i] || []; return fs.length ? fs[Math.floor(fs.length / 2)] : 0 }
    return 0
  }
  for (let i = 0; i < tiles.length; i++) {
    const p = toUV(tiles[i].cx, tiles[i].cy)
    // tile 0 is the CORE/HELM — a unique thing (+200 flag): the ship's one
    // irreplaceable tile; the engine's own law already kills the ship when it
    // dies (aliveTiles = reachable-from-0)
    out.push(p.x, p.y, tiles[i].th, (i === 0 ? 200 : (D.tree[i].part) + 10 * faceOf(i)) + (i === D.sel ? 100 : 0))
  }
  if (hover >= 0) { const p = toUV(ghosts[hover].g.cx, ghosts[hover].g.cy); out.push(p.x, p.y, ghosts[hover].g.th, 60) }
  // selected WEAPON: its TRUE attack cone — bought arc at true range (rays +
  // range dashes). What you buy is what you see.
  if (D.sel > 0 && D.tree[D.sel] && (V2SPEC[D.tree[D.sel].part] || {}).weapon) {
    const cdW = D.tree[D.sel]
    const wpn = V2SPEC[cdW.part].weapon
    const p0 = toUV(tiles[D.sel].cx, tiles[D.sel].cy)
    const face = tiles[D.sel].th + Math.PI / 2 + ((cdW.o || 0) + 0.5) * (2 * Math.PI / 5)
    const H = Math.max(0.07, (ENG.MOUNTS[['fixed', 'swivel', 'wide', 'ring'][cdW.m || 0]] || {}).half || 0)
    const rng = Math.min(1.9, wpn.range * S)
    const full = H >= Math.PI - 0.01
    if (!full) for (const bnd of [face - H, face + H]) {
      const hl = Math.min(0.49, rng / 2)
      out.push(p0.x + Math.cos(bnd) * hl, p0.y + Math.sin(bnd) * hl, bnd, 58 + hl / 0.5 * 0.55)
    }
    const nD = full ? 22 : Math.max(4, Math.ceil(H * 2 / 0.24))
    for (let di = 0; di < nD; di++) {
      const a7 = full ? (di / nD) * 2 * Math.PI : face - H + (di + 0.5) * (H * 2 / nD)
      out.push(p0.x, p0.y, a7, 59 + Math.min(0.99, rng / 2))
    }
  }
  const SHO = { diamond: 76, moon: 77, star: 78, bay: 79 }
  for (const hh of (D.holesL || [])) {
    if (hh.shape === 'gap') continue                        // NO YELLOW NODES — only real sealed shapes draw; loose pinches/gaps are gone
    const code = SHO[hh.shape]
    // INSET: erode the void polygon INWARD by a uniform buffer from its bounding
    // pentagon edges, so the figure sits CENTERED in the gap and stays clear of the
    // tiles — a crescent keeps its crescent shape (no scaling toward its off-centre
    // centroid, which distorted concave moons/stars). Offset each CCW edge inward
    // (interior on the left → inward normal (-dy,dx)) and intersect neighbours.
    const _poly = hh.poly || []
    const _b = Math.min(0.13, (hh.r || 0.4) * 0.42)   // buffer from the tile edge, world units (adapts to void size)
    let pp2 = _poly
    if (_poly.length >= 3) {
      const lines = []
      for (let k = 0; k < _poly.length; k++) {
        const a = _poly[k], c = _poly[(k + 1) % _poly.length]
        let dx = c.x - a.x, dy = c.y - a.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L
        lines.push({ px: a.x - dy * _b, py: a.y + dx * _b, dx, dy })
      }
      pp2 = []
      for (let k = 0; k < lines.length; k++) {
        const e0 = lines[(k - 1 + lines.length) % lines.length], e1 = lines[k]
        const det = e0.dx * e1.dy - e0.dy * e1.dx
        if (Math.abs(det) < 1e-9) { pp2.push({ x: (e0.px + e1.px) / 2, y: (e0.py + e1.py) / 2 }); continue }
        const s = ((e1.px - e0.px) * e1.dy - (e1.py - e0.py) * e1.dx) / det
        pp2.push({ x: e0.px + s * e0.dx, y: e0.py + s * e0.dy })
      }
    }
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

  // SPECIALS MENU — a drawn chrome panel + one button per option (harvested
  // from pentarch-stage/chrome.mjs; codes 320=PANEL, 300+id=BUTTON, matching
  // visual.wgsl's raw-code dispatch). Positioned right below the clicked shape.
  if (D.specialsMenu) {
    const opts3 = ENG.SPECIALS[D.specialsMenu.kind] || []
    const mux = D.specialsMenu.ux, muy = D.specialsMenu.uy
    const chPanel = (cx, cy, hw, hh2) => { const w = Math.max(0, Math.min(1, hw)), h = Math.max(0, Math.min(0.9999, hh2)); out.push(cx, cy, Math.round(w * 4096) + h, 320) }
    const chButton = (id, cx, cy, hw, state) => out.push(cx, cy, state, 300 + id + Math.max(0, Math.min(0.999, hw)))
    chPanel(mux, muy + 0.10 + (opts3.length - 1) * 0.045, 0.26, 0.055 * opts3.length + 0.03)
    const chosen = (D.shapeChoices || {})[D.specialsMenu.key]
    for (let oi = 0; oi < opts3.length; oi++) {
      const oy = muy + 0.10 + oi * 0.09
      chButton(oi, mux, oy, 0.24, chosen === opts3[oi].id ? 1 : 0.5)
    }
  }

  wd.gpuPopulation = out
  const TIERN = ['fixed', 'swivel', 'wide', 'ring']
  const CORE = { mass: 1.2, hp: 20, gen: 1, batCap: 10, batRate: 6, torque: 1.2 }   // the HELM: base power, a small battery, and helm authority (base turn)
  let cost = 0; for (let ci = 1; ci < D.tree.length; ci++) { const d = D.tree[ci]; cost += (COST[d.part] || 0) + (ENG.MOUNTS[TIERN[d.m || 0]] || {}).cost || 0 }
  // ── SHIP STATS: the design's meaning. Parts: [mass, hp, dps, thrust, power] ──
  const STAT = Object.fromEntries(PARTS.map((p) => [p.code, [p.stat.mass, p.stat.hp, p.stat.dps, p.stat.thrust, p.stat.energy]]))   // [mass,hp,dps,thrust,energy], from the catalogue
  let sMass = CORE.mass, sHp = CORE.hp, sDps = 0, sThr = 0, sPwr = CORE.gen
  for (let si = 1; si < D.tree.length; si++) { const st = STAT[D.tree[si].part] || STAT[0]; sMass += st[0]; sHp += st[1]; sDps += st[2]; sThr += st[3]; sPwr += st[4] }
  // ── the ladder pays out: sealed geometry IS the tech tree ──
  const nSh = { diamond: 0, moon: 0, star: 0, bay: 0 }
  for (const hh of (D.holesL || [])) { if (hh.shape !== 'gap') nSh[hh.shape] = (nSh[hh.shape] || 0) + 1 }
  sHp = Math.round(sHp * (1 + 0.15 * nSh.diamond))          // diamond: structural lattice +15% HP each
  if (nSh.moon) sPwr = Math.round(sPwr + 3 * nSh.moon)      // moon: resonance chamber +3 power each
  const brownout = sPwr < 0
  const spd = sMass > 0 ? (sThr / sMass * 10) : 0
  // ── V2 FLIGHT ENVELOPE + POWER GRID — the numbers T (rotate) visibly changes ──
  const pT = tiles.map((t, i) => { const cd = D.tree[i]; const sp = i === 0 ? {} : (V2SPEC[cd.part] || {}); const st = STAT[cd.part] || STAT[0]
    const mnt = ['fixed', 'swivel', 'wide', 'ring'][cd.m || 0]
    return { cx: t.cx, cy: t.cy, th: t.th, o: cd.o || 0, mount: mnt, mass: (i === 0 ? CORE.mass : st[0]) + (ENG.MOUNTS[mnt] || {}).mass || 0,
      part: i === 0 ? { torque: CORE.torque, drain: 0 } : (sp.thrust || sp.torque) ? { thrust: sp.thrust || 0, torque: sp.torque || 0, drain: sp.drain || 0 } : null } })
  const EV = ENG.envelope(pT)
  const vGrid = { gen: CORE.gen, batCap: CORE.batCap, batRate: CORE.batRate }; let vDrain = 0
  for (const cd of D.tree) { const sp = V2SPEC[cd.part] || {}; vGrid.gen += sp.gen || 0; vGrid.batCap += sp.batCap || 0; vGrid.batRate += sp.batRate || 0; vDrain += sp.drain || 0
    if (sp.weapon) vDrain += sp.weapon.energyPerShot / sp.weapon.cooldown * 0.35 }   // sustained-fire appetite share
  if (nSh.moon) vGrid.gen += 3 * nSh.moon                    // moons keep paying power in v2
  const vShort = Math.max(0, vDrain - vGrid.gen)
  const vBurst = vShort <= 0 ? '∞' : (vGrid.batRate > 0 ? (vGrid.batCap / Math.min(vShort, vGrid.batRate)).toFixed(0) + 's burst' : 'STARVED')
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
  const selName = D.sel === -1 ? 'none' + (D.brush ? ' (brush: ' + NAME[D.brush] + ')' : '') : D.sel === 0 ? 'CORE · THE HELM' : NAME[D.tree[D.sel] ? D.tree[D.sel].part : 1]
  wd.hud = [
    { id: 'yt', type: 'text', x: '3%', y: '5%', text: 'PENTARCH SHIPYARD', fontSize: '14px', color: '#cfe0f5' },
    { id: 'yc', type: 'text', x: '3%', y: '9%', text: 'COST ' + cost + '  ·  TILES ' + tiles.length + '  ·  SEALED ' + (D.holesL ? D.holesL.filter(hh => hh.shape !== 'gap').length : 0), fontSize: '12px', color: '#9fd8ff' },
    { id: 'yfl', type: 'text', x: '3%', y: '29%', text: 'FLEET  ' + [1, 2, 3].map(k => (k === D.slot ? '[' : ' ') + k + (wd.fleet && wd.fleet[k] ? ':' + wd.fleet[k].cost : ':—') + (k === D.slot ? ']' : ' ')).join(' ') + '   S save · L load', fontSize: '11px', color: '#8fb0d8' },
    { id: 'ydm', type: 'text', x: '80%', y: '93%', text: D.delMode ? '⌫ DELETE MODE — click tiles to remove' : '', fontSize: '12px', color: '#ff8a7a' },
    { id: 'ys', type: 'text', x: '3%', y: '13%', text: 'SELECTED: ' + selName + ((D.tree[D.sel] && { 3: 1, 4: 1, 6: 1, 9: 1 }[D.tree[D.sel].part]) ? ('  ·  mount ' + ['FIXED', 'SWIVEL ±36°', 'WIDE ±90°', 'RING 360°'][D.tree[D.sel].m || 0] + '  (M upgrades)') : '') , fontSize: '11px', color: '#ffd479' },
    { id: 'yst', type: 'text', x: '3%', y: '21%', text: 'MASS ' + sMass.toFixed(1) + ' · SPD ' + spd.toFixed(1) + ' · HP ' + sHp + (nSh.diamond ? ' (+' + (nSh.diamond * 15) + '%◇)' : '') + ' · DPS ' + effDps + ' · PWR ' + (sPwr >= 0 ? '+' : '') + sPwr + (brownout ? ' ⚠ BROWNOUT — guns at half; add GEN' : ''), fontSize: '12px', color: brownout ? '#ffb08a' : '#9fd8ff' },
    { id: 'ysw', type: 'text', x: '3%', y: '25%', text: (nSh.star ? '★ SUPER WEAPON SLOT ARMED  ' : '') + (nSh.bay ? '◎ HANGAR BAY ×' + nSh.bay : ''), fontSize: '12px', color: '#ffe9a8' },
    { id: 'yz', type: 'text', x: '3%', y: '17%', text: (D.holesL && D.holesL.filter(hh => hh.shape !== 'gap').length) ? ('SEALED: ' + D.holesL.filter(hh => hh.shape !== 'gap').map(h => h.shape.toUpperCase()).join(' · ')) : '', fontSize: '12px', color: '#ffe9a8' },
    { id: 'yv2', type: 'text', x: '3%', y: '33%', text: 'FLIGHT  spd ' + EV.vMax.toFixed(1) + ' · strafe ' + EV.aLat.toFixed(1) + ' · turn ' + EV.alpha.toFixed(1) + '     POWER  ' + vGrid.gen.toFixed(0) + ' gen − ' + vDrain.toFixed(1) + ' draw · ' + vBurst, fontSize: '11px', color: '#a8e8ff' },
    { id: 'yh', type: 'text', x: '3%', y: '93%', text: 'click → grow/select · dbl-click → delete · T rotate · M mount-arc · re-click palette = variant', fontSize: '11px', color: '#7b8daa' },
    { id: 'p1', type: 'text', x: '24%', y: '97%', text: 'HULL', fontSize: '10px', color: '#8fb0d8' },
    { id: 'p2', type: 'text', x: '37%', y: '97%', text: 'ARMOR', fontSize: '10px', color: '#a8b0bd' },
    { id: 'p3', type: 'text', x: '48%', y: '97%', text: 'GUN·FIX', fontSize: '10px', color: '#ff9d94' },
    { id: 'p4', type: 'text', x: '60%', y: '97%', text: 'ENG·JET·GYR', fontSize: '10px', color: '#9fdfff' },
    { id: 'p5', type: 'text', x: '74%', y: '97%', text: 'GEN·BAT', fontSize: '10px', color: '#b5ffa8' },
  ]
  if (D.specialsMenu) {
    const opts4 = ENG.SPECIALS[D.specialsMenu.kind] || []
    const mux2 = (D.specialsMenu.ux + 1) / 2 * 100, muy2 = (D.specialsMenu.uy + 1) / 2 * 100
    wd.hud.push({ id: 'ymt', type: 'text', x: (mux2 - 12).toFixed(1) + '%', y: (muy2 + 4).toFixed(1) + '%', text: D.specialsMenu.kind.toUpperCase() + ' — pick a special:', fontSize: '11px', color: '#ffe9a8' })
    for (let oi = 0; oi < opts4.length; oi++) {
      const o = opts4[oi], oy2 = (muy2 + 9 + oi * 4.5)
      wd.hud.push({ id: 'ymo' + oi, type: 'text', x: (mux2 - 11).toFixed(1) + '%', y: oy2.toFixed(1) + '%', text: o.name + ' — ' + o.desc, fontSize: '11px', color: '#cfe0f5' })
    }
  }
