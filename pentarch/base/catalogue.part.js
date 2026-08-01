  // ── penta math (inlined from the tested core) ──
  const AP = 1 / (2 * Math.tan(Math.PI / 5)), CR = 1 / (2 * Math.sin(Math.PI / 5)), ST = 2 * Math.PI / 5
  const ena = (t, e) => t.th + Math.PI / 2 + (e + 0.5) * ST
  // ce = which of the CHILD's edges mates onto the parent edge (0 = canonical, today's
  // behaviour). A flush contact is only fully described by BOTH edges — recording just
  // the parent edge scrambled re-rooted subtrees after route-aware deletes.
  const attach = (t, e, ce = 0) => { const n = ena(t, e); return { cx: t.cx + 2 * AP * Math.cos(n), cy: t.cy + 2 * AP * Math.sin(n), th: n + Math.PI / 2 - Math.PI / 5 - ce * ST } }
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
  //    The designer + the battle both read this. NAME/COST/STAT below are thin
  //    shims over it so the working v9 code is unchanged (values are identical). ──
  const PARTS = [
    { code: 0, name: 'BLANK', category: 'BLANK', cost: 0, hp: 6, color: [0.30, 0.36, 0.46], stat: { mass: 0.5, hp: 4, dps: 0, thrust: 0, energy: 0 } },
    { code: 1, name: 'HULL', category: 'HULL', cost: 10, hp: 14, color: [0.36, 0.50, 0.65], stat: { mass: 1, hp: 10, dps: 0, thrust: 0, energy: 0 } },
    { code: 2, name: 'ARMOR', category: 'ARMOR', cost: 18, hp: 40, color: [0.54, 0.58, 0.65], stat: { mass: 2, hp: 30, dps: 0, thrust: 0, energy: 0 } },
    { code: 3, name: 'GUN', category: 'GUNS', cost: 30, hp: 12, color: [1.00, 0.48, 0.42], stat: { mass: 1.5, hp: 8, dps: 6, thrust: 0, energy: -2 } },
    { code: 4, name: 'ENGINE', category: 'DRIVE', cost: 22, hp: 12, color: [0.48, 0.86, 1.00], stat: { mass: 1, hp: 8, dps: 0, thrust: 4, energy: -1 } },
    { code: 5, name: 'GEN', category: 'POWER', cost: 26, hp: 10, color: [0.62, 1.00, 0.54], stat: { mass: 1, hp: 6, dps: 0, thrust: 0, energy: 4 } },
    { code: 6, name: 'JET', category: 'DRIVE', cost: 14, hp: 10, color: [0.62, 0.92, 1.00], stat: { mass: 0.7, hp: 6, dps: 0, thrust: 1.5, energy: -0.5 } },
    { code: 7, name: 'GYRO', category: 'DRIVE', cost: 16, hp: 10, color: [0.80, 0.78, 1.00], stat: { mass: 1, hp: 6, dps: 0, thrust: 0, energy: -1 } },
    { code: 8, name: 'BATTERY', category: 'POWER', cost: 20, hp: 10, color: [0.95, 1.00, 0.55], stat: { mass: 1.2, hp: 6, dps: 0, thrust: 0, energy: 0 } },
    { code: 9, name: 'FIXED', category: 'GUNS', cost: 18, hp: 12, color: [1.00, 0.66, 0.42], stat: { mass: 1.2, hp: 8, dps: 4, thrust: 0, energy: -1.5 } },
  ]
  // V2 systems spec / facing / palette-variant rings (mirror of the ENG copy —
  // same numbers; the designer scope needs its own view of them)
  const V2SPEC = {
    3: { turret: true, weapon: { range: 6, damage: 3, energyPerShot: 5, cooldown: 0.5 } },
    4: { thrust: 10, drain: 2 },
    5: { gen: 4 },
    6: { thrust: 4, drain: 0.5 },
    7: { torque: 6, drain: 1 },
    8: { batCap: 20, batRate: 15 },
    9: { fixed: true, weapon: { range: 5, damage: 2, energyPerShot: 3, cooldown: 0.4 } },
  }
  const ORIENTABLE = { 4: 1, 6: 1, 9: 1 }
  const PALCYCLE = { 3: [3, 9], 4: [4, 6, 7], 5: [5, 8] }
  const PALETTE = [1, 2, 3, 4, 5]
  const CATEGORIES = ['HULL', 'ARMOR', 'GUNS', 'DRIVE', 'POWER']
  const partOf = (part) => { if (part && typeof part === 'object') part = part.part; if (typeof part === 'string') { const up = part.toUpperCase(); const bn = PARTS.find(p => p.name === up); if (bn) return bn; part = Number(part) } return PARTS[part | 0] || PARTS[0] }
  const statOf = (part) => { const p = partOf(part); return { mass: p.stat.mass, hp: p.stat.hp, dps: p.stat.dps, thrust: p.stat.thrust, energy: p.stat.energy, durability: p.hp, cost: p.cost, name: p.name, category: p.category, code: p.code } }
  const NAME = PARTS.map((p) => p.name)
  const COST = Object.fromEntries(PARTS.map((p) => [p.code, p.cost]))
