try {
  const wd = sim.worldData
  // ── the SCENE is data — five entities, each {pos, kind, yaw, scale, id} ──
  if (!wd.__ents) {
    wd.__ents = [
      { pos: [-2.2, 0, 0.3], kind: 0, yaw: 0, scale: 1.0, id: 0 },
      { pos: [0.0, 0, 1.6], kind: 1, yaw: 0.6, scale: 0.95, id: 1 },
      { pos: [2.2, 0, 0.2], kind: 2, yaw: 0, scale: 1.1, id: 2 },
      { pos: [-0.9, 0, -1.3], kind: 1, yaw: 2.1, scale: 0.6, id: 3 },
      { pos: [1.1, 0, -1.1], kind: 0, yaw: 0, scale: 0.7, id: 4 },
    ]
    wd.__ang = 0.35; wd.__sel = -1; wd.__label = 'A/D or ←/→ to orbit · CLICK an object to select it'
  }
  const E = wd.__ents
  // orbit
  if (wd.key_a || wd.key_left) wd.__ang -= 0.035
  if (wd.key_d || wd.key_right) wd.__ang += 0.035

  // ── camera basis (IDENTICAL to the shader's, so screen math agrees) ──
  const ang = wd.__ang, rad = 6.2, K = 1.15
  const ro = [Math.sin(ang) * rad, 1.7, -Math.cos(ang) * rad]
  const ta = [0, 0.2, 0]
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
  const fwd = norm(sub(ta, ro))
  const rgt = norm(cross([0, 1, 0], fwd))
  const up = cross(fwd, rgt)
  // FORWARD-PROJECT a world point → screen uv (the inverse of the shader's ray gen)
  const project = (C) => {
    const d = sub(C, ro); const zf = dot(d, fwd)
    if (zf <= 0.01) return null                        // behind camera
    return { x: (dot(d, rgt) / zf) / K, y: (dot(d, up) / zf) / K, z: zf }
  }
  // uv → screen %: uv.x −1..1 → 0..100% ; uv.y +up maps to screen-UP → low %
  const toPct = (uv) => ({ x: (uv.x + 1) * 50, y: (1 - uv.y) * 50 })

  // ── PICK on click edge: nearest projected entity to the cursor ──
  const down = wd.mouse_down === true
  if (down && !wd.__wasDown) {
    const mx = (typeof wd.mouse_x === 'number') ? wd.mouse_x : 256
    const my = (typeof wd.mouse_y === 'number') ? wd.mouse_y : 256
    const cx = mx / 256 - 1, cy = -(my / 256 - 1)         // cursor in uv (screen-up = +y)
    let best = -1, bd = 0.22                              // pick radius in uv
    for (const e of E) {
      const uv = project(e.pos); if (!uv) continue
      const r = 0.16 * e.scale / Math.max(uv.z, 0.5)      // apparent radius shrinks with depth
      const d2 = Math.hypot(uv.x - cx, uv.y - cy)
      if (d2 < Math.max(bd, r) && d2 < bd + r) { if (best < 0 || uv.z < wd.__pickz) { best = e.id; bd = d2; wd.__pickz = uv.z } }
    }
    wd.__sel = best
    if (best >= 0) {
      const e = E.find(x => x.id === best)
      wd.__label = 'PICKED entity #' + best + '  ·  kind ' + e.kind + ' (' + ['sphere', 'box', 'tree'][e.kind] + ')'
      wd.__clicks = [{ at: wd.__t || 0, entity: best, kind: e.kind }]   // the inspect channel
      wd.__play_sound = [{ frequency: 620, duration: 0.06, volume: 0.1, type: 'sine' }]
    } else { wd.__label = '(clicked empty space)' }
  }
  wd.__wasDown = down
  wd.__t = (wd.__t || 0) + dt

  // ── publish the population (what the shader raymarches) + uniforms ──
  const pop = []
  for (const e of E) pop.push(e.pos[0], e.pos[1], e.pos[2], e.kind, e.yaw, e.scale, e.id, 0)
  wd.gpuPopulation = pop
  const uni = []; for (let i = 0; i < 64; i++) uni[i] = 0
  uni[0] = wd.__ang; uni[1] = wd.__sel
  wd.gpuUniforms = uni

  // ── PUBLISH the entity list for the ENGINE'S inspect toggle — the universal
  //    contract: a field's sub-entities, projected to SCREEN space (grid 0..512,
  //    the same space as mouse_x/mouse_y), so inspect can name what you clicked
  //    without knowing the camera. This is the "make sub-entities inspectable"
  //    keystone, light cut: identity in data, the engine reads it. ──
  const ents = []
  for (const e of E) {
    const uv = project(e.pos); if (!uv) continue
    const worldR = (e.kind === 2 ? 0.75 : 0.5) * e.scale        // rough on-screen size
    const rGrid = Math.max(30, Math.min(95, (worldR / (K * Math.max(uv.z, 0.5))) * 256 * 1.5))
    ents.push({ id: e.id, kind: e.kind, label: ['sphere', 'box', 'tree'][e.kind] || 'entity', sx: (uv.x + 1) * 256, sy: (1 - uv.y) * 256, r: rGrid, z: uv.z })
  }
  wd.__entities = ents

  // ── HUD: instructions + the pick readout + a '+' marker at each entity's
  //    projected screen position (so you can SEE the hook's model line up
  //    with the rendered pixels — proof the projection is honest) ──
  const hud = [
    { id: 'title', type: 'text', x: '3%', y: '5%', text: 'ENTITY PICK — geometry is DATA (5 rows in a buffer); a click casts the ray against that data and returns an ID', fontSize: '12px', color: '#cfe0f5' },
    { id: 'lbl', type: 'text', x: '3%', y: '9%', text: wd.__label, fontSize: '15px', color: wd.__sel >= 0 ? '#ffe066' : '#9fd8ff' },
  ]
  for (const e of E) {
    const uv = project(e.pos); if (!uv) continue
    const p = toPct(uv)
    hud.push({ id: 'm' + e.id, type: 'text', x: p.x.toFixed(1) + '%', y: p.y.toFixed(1) + '%', text: e.id === wd.__sel ? '◉' : '+', fontSize: '13px', color: e.id === wd.__sel ? '#ffcf3a' : '#8fb0d8' })
  }
  wd.hud = hud
  if (!wd.__resets) wd.__resets = ['__ents', '__ang', '__sel']
} catch (e) {
  sim.worldData.hud = [{ id: 'err', type: 'text', x: '3%', y: '50%', text: 'ERR: ' + String((e && e.message) || e).slice(0, 80), fontSize: '12px', color: '#ff8a7a' }]
}
