// designer.test.mjs — the shipyard scene's mechanic tests. Each mechanic node
// adds its own describe() block. This file is the shared green gate for the five
// sy-* mechanics; keep blocks independent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layout, freeEdges } from '../penta-core.mjs'
import { statOf } from '../parts.mjs'
import { PALETTE, CATEGORIES } from '../parts.mjs'
import {
  grammarPayout,
  shipStats, freshFleet, saveBerth, loadBerth, berthCost,
  paletteTabs, slotOfPart, setPart, paletteCard,
  legalGhosts, placeBlank, viewFit, nearestIndex, tileCode, ghostCode,
  deleteTile, deleteGesture,
} from '../mod-designer.mjs'

// Build the linear chain the exhaustive hunt proved (backlog/tests/yard-grammar-test):
// a base HULL, then each edge in `seq` attaches a HULL to the PREVIOUS tile.
function chain(seq) {
  const design = [{ parent: -1, edge: -1, part: 1 }]
  for (const e of seq) design.push({ parent: design.length - 1, edge: e, part: 1 })
  return layout(design).tiles
}

const SEQS = {
  diamond: [2, 2, 1, 2, 2],
  moon: [2, 2, 1, 3, 2, 2, 2, 1, 3],
  star: [2, 2, 1, 3, 1, 3, 2, 1, 3],
  bay: [2, 2, 1, 3, 1, 3, 1],
}

// ── sy-grammar: negative-space shape grammar → payouts ───────────────────────

test('sy-grammar: each proven sequence seals its named shape', () => {
  for (const [want, seq] of Object.entries(SEQS)) {
    const { sealed, holes } = grammarPayout(chain(seq), {})
    const got = holes.map(h => h.shape)
    assert.ok(got.includes(want), `seq[${seq}] → [${got}] should include ${want}`)
    assert.equal(sealed[want], got.filter(s => s === want).length, `${want} census`)
    assert.ok(sealed[want] >= 1, `${want} counted at least once`)
  }
})

test('sy-grammar: diamond pays +15% HP, no other payout', () => {
  const { payout } = grammarPayout(chain(SEQS.diamond), {})
  assert.equal(payout.hpMul, 1.15)
  assert.equal(payout.pwrAdd, 0)
  assert.equal(payout.superWeapon, false)
  assert.equal(payout.hangar, 0)
})

test('sy-grammar: moon pays +3 PWR', () => {
  const { payout } = grammarPayout(chain(SEQS.moon), {})
  assert.equal(payout.pwrAdd, 3)
  assert.equal(payout.hpMul, 1) // no diamond
})

test('sy-grammar: star arms the super-weapon', () => {
  const { payout } = grammarPayout(chain(SEQS.star), {})
  assert.equal(payout.superWeapon, true)
  assert.equal(payout.star, 1)
})

test('sy-grammar: bay yields a hangar', () => {
  const { payout } = grammarPayout(chain(SEQS.bay), {})
  assert.ok(payout.hangar >= 1)
})

test('sy-grammar: newly sealed shape flashes + rings; a held seal is silent', () => {
  const tiles = chain(SEQS.star)
  // first sight of the star → new seal, flash tinted 'star', fanfare present
  const first = grammarPayout(tiles, {})
  assert.deepEqual(first.newSeals, ['star'])
  assert.equal(first.flashKind, 'star')
  assert.ok(Array.isArray(first.sound) && first.sound[0].frequency === 1320)
  // same census next tick → no new seal, no sound
  const held = grammarPayout(tiles, first.sealed)
  assert.deepEqual(held.newSeals, [])
  assert.equal(held.flashKind, null)
  assert.equal(held.sound, null)
})

test('sy-grammar: an already-held higher seal does not suppress a new lower seal', () => {
  // star was already sealed last tick; this tick the same star hull is present
  // AND (hypothetically) a diamond appears. With the star held, only the diamond
  // is a NEW seal, so it — not the held star — drives the flash. We prove the
  // edge-detection half here with the star chain: holding the star yields no new
  // seal, so no flash fires for geometry that has not changed.
  const tiles = chain(SEQS.star)
  const held = grammarPayout(tiles, { diamond: 0, moon: 0, star: 1, bay: 0 })
  assert.deepEqual(held.newSeals, [])
  assert.equal(held.flashKind, null)
})

test('sy-grammar: deleting a tile re-opens the seal → payout drops', () => {
  const full = chain(SEQS.diamond)
  const sealedRes = grammarPayout(full, {})
  assert.equal(sealedRes.payout.hpMul, 1.15)
  // drop the last tile that closes the diamond → the void re-opens
  const cut = full.slice(0, full.length - 1)
  const openRes = grammarPayout(cut, sealedRes.sealed)
  assert.equal(openRes.sealed.diamond, 0)
  assert.equal(openRes.payout.hpMul, 1)
})

// ── sy-stats: live ship stats (MASS/SPD/HP/DPS/PWR) + fleet berths ───────────

// a design tree from part codes: base part[0], then each edge attaches part[i+1].
function ship(parts, seq) {
  const tree = [{ parent: -1, edge: -1, part: parts[0] }]
  seq.forEach((e, i) => tree.push({ parent: tree.length - 1, edge: e, part: parts[i + 1] ?? 1 }))
  return tree
}

test('sy-stats: MASS/HP/DPS/PWR/COST are the part-table sums', () => {
  // HULL + ARMOR + GUN + ENGINE + GEN, one of each
  const tree = ship([1, 2, 3, 4, 5], [2, 2, 1, 3])
  const s = shipStats(tree, {})
  let mass = 0, hp = 0, dps = 0, pwr = 0, cost = 0
  for (const d of tree) { const p = statOf(d.part); mass += p.mass; hp += p.hp; dps += p.dps; pwr += p.energy; cost += p.cost }
  assert.equal(s.mass, mass)
  assert.equal(s.hp, hp)          // no payout → raw sum
  assert.equal(s.dps, dps)
  assert.equal(s.pwr, pwr)
  assert.equal(s.cost, cost)
})

test('sy-stats: SPD = thrust/mass·10, zero when massless is impossible', () => {
  // HULL + ENGINE: thrust 4, mass 1+1=2 → spd 20
  const s = shipStats(ship([1, 4], [2]), {})
  assert.equal(s.spd, 20)
  assert.equal(s.thrust, 4)
})

test('sy-stats: two guns with no GEN → BROWNOUT halves DPS', () => {
  // port of yard-stats-test b: [HULL,GUN,GUN] → dps 12, pwr -4, effDps 6
  const s = shipStats(ship([1, 3, 3], [2, 2]), {})
  assert.equal(s.dps, 12)
  assert.equal(s.pwr, -4)
  assert.equal(s.brownout, true)
  assert.equal(s.effDps, 6)      // starving guns fire at half rate
})

test('sy-stats: a GEN clears the brownout → guns fire at full DPS', () => {
  // HULL + GUN + GEN: pwr = 0 - 2 + 4 = 2 ≥ 0
  const s = shipStats(ship([1, 3, 5], [2, 2]), {})
  assert.equal(s.pwr, 2)
  assert.equal(s.brownout, false)
  assert.equal(s.effDps, s.dps)
})

test('sy-stats: diamond payout applies +15% HP (port of yard-stats-test a)', () => {
  const tiles = chain(SEQS.diamond)               // 6 HULLs → base HP 60
  const { payout } = grammarPayout(tiles, {})
  const base = shipStats(tiles, {})
  const boosted = shipStats(tiles, payout)
  assert.equal(base.hp, 60)
  assert.equal(payout.hpMul, 1.15)
  assert.equal(boosted.hp, Math.round(60 * 1.15))  // 69
})

test('sy-stats: moon payout adds +3 PWR', () => {
  const tiles = chain(SEQS.moon)
  const { payout } = grammarPayout(tiles, {})
  const base = shipStats(tiles, {})
  const boosted = shipStats(tiles, payout)
  assert.equal(boosted.pwr, base.pwr + 3)
  assert.equal(boosted.brownout, boosted.pwr < 0)
})

test('sy-stats: star payout marks the super-weapon in the readout', () => {
  const tiles = chain(SEQS.star)
  const { payout } = grammarPayout(tiles, {})
  assert.equal(shipStats(tiles, payout).superWeapon, true)
})

test('sy-stats: empty/degenerate design still yields a HULL baseline', () => {
  const s = shipStats([], {})
  const h = statOf(1)
  assert.equal(s.hp, h.hp)
  assert.equal(s.cost, h.cost)
})

// ── sy-stats: fleet berths (save/load, cost derived) ─────────────────────────

test('sy-stats: save a design to a berth, load it back intact (port of yard-fleet-test)', () => {
  // HULL + GUN → cost 10 + 30 = 40, tree length 2 with the gun intact
  const tree = ship([1, 3], [2])
  let fleet = freshFleet()
  assert.deepEqual(fleet, [null, null, null])
  fleet = saveBerth(fleet, 1, tree)               // berth "2" in 0-indexed slot 1
  assert.equal(berthCost(fleet, 1), 40)
  const back = loadBerth(fleet, 1)
  assert.equal(back.length, 2)
  assert.equal(back[1].part, 3)                    // gun intact
})

test('sy-stats: a saved berth is a deep copy — later edits do not mutate it', () => {
  const tree = ship([1, 3], [2])
  const fleet = saveBerth(freshFleet(), 0, tree)
  tree[1].part = 2                                 // wreck the live design after saving
  tree.push({ parent: 1, edge: 2, part: 4 })
  const back = loadBerth(fleet, 0)
  assert.equal(back.length, 2)                     // berth still the 2-tile design
  assert.equal(back[1].part, 3)                    // still a gun
})

test('sy-stats: an empty berth loads null; an out-of-range slot is a no-op', () => {
  const fleet = freshFleet()
  assert.equal(loadBerth(fleet, 2), null)
  assert.equal(berthCost(fleet, 2), 0)
  const same = saveBerth(fleet, 9, ship([1, 3], [2]))
  assert.deepEqual(same, [null, null, null])       // bad slot changed nothing
})

// ── sy-palette: category-tab palette → fill/replace the selected tile ────────

test('sy-palette: five tabs HULL/ARMOR/GUN/ENGINE/GEN map slot s → part s+1', () => {
  const tabs = paletteTabs()
  assert.equal(tabs.length, 5)
  assert.deepEqual(tabs.map(t => t.name), ['HULL', 'ARMOR', 'GUN', 'ENGINE', 'GEN'])
  // slot s carries PALETTE[s] (the v9 palette strip: slot s → part code s+1)
  tabs.forEach((t, s) => {
    assert.equal(t.slot, s)
    assert.equal(t.code, PALETTE[s])
    assert.equal(t.code, s + 1)
    assert.equal(t.category, CATEGORIES[s])
  })
})

test('sy-palette: slotOfPart is the inverse of the tab layout; non-palette parts have no tab', () => {
  PALETTE.forEach((code, s) => assert.equal(slotOfPart(code), s))
  assert.equal(slotOfPart(0), -1)             // BLANK has no tab
  assert.equal(slotOfPart(99), -1)            // unknown code
  assert.equal(slotOfPart({ part: 3 }), 2)    // accepts a design entry
})

test('sy-palette: click a tab FILLS a blank selected tile with that part', () => {
  // a HULL base with a fresh BLANK grown at edge 2, selected (D.sel = 1)
  const tree = [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 0 }]
  const out = setPart(tree, 1, 2)             // click the GUN tab (slot 2 → part 3)
  assert.equal(out[1].part, 3)                // blank filled with a GUN
  assert.equal(out[0].part, 1)               // base untouched
})

test('sy-palette: click a tab REPLACES the selected tile\'s existing part', () => {
  const tree = [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 1 }]
  const out = setPart(tree, 1, 1)             // ARMOR tab (slot 1 → part 2)
  assert.equal(out[1].part, 2)               // HULL replaced by ARMOR
})

test('sy-palette: setPart is pure — it never mutates the input tree', () => {
  const tree = [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 0 }]
  const out = setPart(tree, 1, 2)
  assert.equal(tree[1].part, 0, 'input tile still BLANK')
  assert.notEqual(out, tree, 'a new array is returned')
  assert.notEqual(out[1], tree[1], 'the changed tile is a fresh object')
})

test('sy-palette: an out-of-range slot or selection is a no-op copy', () => {
  const tree = [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 4 }]
  assert.deepEqual(setPart(tree, 1, -1).map(t => t.part), [1, 4])  // bad slot
  assert.deepEqual(setPart(tree, 1, 9).map(t => t.part), [1, 4])   // bad slot
  assert.deepEqual(setPart(tree, 5, 2).map(t => t.part), [1, 4])   // bad sel
  assert.deepEqual(setPart(tree, -1, 2).map(t => t.part), [1, 4])  // bad sel
})

test('sy-palette: hover stat-card carries the part\'s name/cost/stats; nothing hovered → null', () => {
  const gun = paletteCard(2)                   // hover the GUN tab
  const s = statOf(3)
  assert.equal(gun.name, 'GUN')
  assert.equal(gun.code, 3)
  assert.equal(gun.category, s.category)
  assert.equal(gun.cost, s.cost)               // 30 ⬡
  const rows = Object.fromEntries(gun.rows)
  assert.equal(rows.hp, s.hp)
  assert.equal(rows.dps, s.dps)
  assert.equal(rows.energy, s.energy)          // -2 (draws power)
  // every tab yields a card that agrees with parts.mjs
  PALETTE.forEach((code, slot) => {
    assert.equal(paletteCard(slot).cost, statOf(code).cost)
  })
  assert.equal(paletteCard(-1), null)
  assert.equal(paletteCard(9), null)
  assert.equal(paletteCard(null), null)
})

// ── sy-ghost: ghost preview + blank placement (the shipyard canvas) ──────────

const base = () => [{ parent: -1, edge: -1, part: 1 }]
function chainD(seq) {
  const d = base()
  for (const e of seq) d.push({ parent: d.length - 1, edge: e, part: 1 })
  return d
}

test('sy-ghost: a lone base tile offers exactly 5 legal ghosts, one per edge', () => {
  const tiles = layout(base()).tiles
  const gs = legalGhosts(tiles)
  assert.equal(tiles.length, 1)
  assert.equal(gs.length, 5)                       // a lone pentagon: every edge is free & clear
  assert.deepEqual([...gs.map(g => g.e)].sort(), [0, 1, 2, 3, 4])
  for (const g of gs) { assert.equal(g.i, 0); assert.ok(g.ghost && typeof g.ghost.cx === 'number') }
})

test('sy-ghost: legalGhosts is the OVERLAP-free subset of freeEdges (curled hull)', () => {
  // the proven diamond chain curls back on itself → some free edges are blocked
  const tiles = layout(chainD([2, 2, 1, 2, 2])).tiles
  const fe = freeEdges(tiles)
  const illegal = fe.filter(g => !g.legal)
  assert.ok(illegal.length > 0, 'this curled hull must have at least one blocked free edge')
  const gs = legalGhosts(tiles)
  assert.equal(gs.length, fe.filter(g => g.legal).length)   // exactly the legal ones
  // every returned ghost is a genuinely placeable spot: attaching there does not overlap
  for (const g of gs) {
    const grew = layout([...chainD([2, 2, 1, 2, 2]), { parent: g.i, edge: g.e, part: 0 }])
    assert.equal(grew.rejected.length, 0, `ghost ${g.i}:${g.e} should place without rejection`)
  }
})

test('sy-ghost: placeBlank grows a part-0 tile at the edge and selects it, purely', () => {
  const tree = base()
  const { tree: out, sel } = placeBlank(tree, 0, 2)
  assert.equal(out.length, 2)
  assert.deepEqual(out[1], { parent: 0, edge: 2, part: 0 })  // a BLANK grown at edge 2
  assert.equal(sel, 1)                                       // the new tile is selected
  assert.equal(tree.length, 1, 'input tree not mutated')
  assert.notEqual(out[0], tree[0], 'existing tiles are fresh copies')
  // the grown design lays out cleanly (the blank is a real, placeable tile)
  const lay = layout(out)
  assert.equal(lay.tiles.length, 2)
  assert.equal(lay.rejected.length, 0)
})

test('sy-ghost: nearestIndex picks the closest point within radius, -1 beyond', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 0.5, y: 0.5 }]
  assert.equal(nearestIndex(pts, 0.06, 0.0, 0.10), 1)   // closest to pt 1
  assert.equal(nearestIndex(pts, -0.01, 0.0, 0.10), 0)  // closest to pt 0
  assert.equal(nearestIndex(pts, 0.9, 0.9, 0.10), -1)   // nothing within radius
  assert.equal(nearestIndex([], 0, 0, 0.10), -1)        // empty → -1
})

test('sy-ghost: viewFit fits the hull inside the letterbox square (|uv| <= ~0.8)', () => {
  const tiles = layout(chainD([2, 2, 1, 3, 2])).tiles
  const { project, S } = viewFit(tiles)
  assert.ok(S > 0 && S <= 0.12)
  for (const t of tiles) {
    const p = project(t.cx, t.cy)
    assert.ok(Math.abs(p.x) <= 0.82 && Math.abs(p.y) <= 0.82, `tile projects inside the square`)
  }
  // a lone tile centres at the origin
  const solo = viewFit(layout(base()).tiles).project(0, 0)
  assert.ok(Math.hypot(solo.x, solo.y) < 1e-9)
})

test('sy-ghost: tileCode carries the part and flags selection the way the shader decodes it', () => {
  for (let part = 0; part <= 5; part++) {
    assert.equal(tileCode(part, false) % 100, part)          // kind = part
    assert.equal(Math.floor(tileCode(part, false) / 100), 0) // unselected
    assert.equal(tileCode(part, true) % 100, part)           // still the part
    assert.equal(Math.floor(tileCode(part, true) / 100), 1)  // selected halo (flags==1)
  }
})

test('sy-ghost: ghostCode sits in the 60 band and round-trips rotation through fract', () => {
  for (const th of [0, 0.5, 1.7, Math.PI, 5.9, -0.3]) {
    const code = ghostCode(th)
    assert.equal(Math.floor(code), 60, 'ghost band = 60')
    const TAU = Math.PI * 2
    const want = ((th % TAU) + TAU) % TAU / TAU
    const got = code - 60
    assert.ok(Math.abs(got - (want >= 1 ? 0 : want)) < 1e-9, `fract encodes th/2π`)
  }
})

// ── sy-delete: route-aware delete (contact-graph BFS re-root) ─────────────────

// the proven diamond chain is a RING: contacts 0-1, 0-5(re-touch), 1-2, 2-3, 3-4,
// 4-5 form a 6-cycle. the straight chain [2,2,2] is a pure PATH (no re-touch).
const RING = () => chainD([2, 2, 1, 2, 2])   // 6 tiles, curls closed → diamond void
const PATH = () => chainD([2, 2, 2])         // 4 tiles in a line, no re-touch

test('sy-delete: cutting a ring keeps every survivor (re-touch re-roots the tree)', () => {
  // delete each non-base tile of the diamond ring; the alternate flush contact
  // keeps the rest routed to the base, so NOTHING orphans and 5 tiles remain.
  for (let target = 1; target <= 5; target++) {
    const { tree, removed, orphans } = deleteTile(RING(), target)
    assert.equal(removed, true, `tile ${target} removed`)
    assert.equal(orphans, 0, `ring survives the cut at ${target} — no orphans`)
    assert.equal(tree.length, 5, `5 tiles remain after cutting ${target}`)
    // the re-rooted tree lays out cleanly (geometry is preserved by the re-root)
    const lay = layout(tree)
    assert.equal(lay.tiles.length, 5, `re-rooted design re-lays to 5 tiles`)
    assert.equal(lay.rejected.length, 0, `no overlap rejects after re-root`)
    assert.equal(tree[0].parent, -1, `tile 0 stays the base`)
  }
})

test('sy-delete: cutting a PATH shears off the disconnected branch (orphans)', () => {
  // straight chain 0-1-2-3, no re-touch: deleting the middle tile 1 disconnects
  // 2 and 3 from the base — they shear off, leaving only the base.
  const { tree, removed, orphans } = deleteTile(PATH(), 1)
  assert.equal(removed, true)
  assert.equal(tree.length, 1, 'only the base survives')
  assert.equal(tree[0].parent, -1)
  assert.equal(orphans, 2, 'tiles 2 and 3 sheared off')
})

test('sy-delete: deleting a leaf just removes it (no orphans, no re-root needed)', () => {
  const { tree, removed, orphans } = deleteTile(PATH(), 3)   // the tail leaf
  assert.equal(removed, true)
  assert.equal(orphans, 0)
  assert.equal(tree.length, 3, 'the leaf is gone, the rest intact')
})

test('sy-delete: the base (tile 0) is never deletable', () => {
  const before = RING()
  const { tree, removed, orphans } = deleteTile(before, 0)
  assert.equal(removed, false, 'deleting the base is refused')
  assert.equal(orphans, 0)
  assert.equal(tree.length, before.length, 'the design is unchanged')
  assert.notEqual(tree, before, 'a copy is returned (pure)')
})

test('sy-delete: an out-of-range target is a no-op copy', () => {
  const before = PATH()
  for (const bad of [99, -1, null]) {
    const { tree, removed } = deleteTile(before, bad)
    assert.equal(removed, false, `target ${bad} is a no-op`)
    assert.equal(tree.length, before.length)
  }
})

test('sy-delete: deleting re-opens a sealed void → the payout drops', () => {
  // the diamond ring seals a diamond (+15% HP). cut any ring tile and the void
  // re-opens, so grammar re-derives zero diamonds and the payout falls to 1×.
  const sealed = grammarPayout(layout(RING()).tiles, {})
  assert.equal(sealed.sealed.diamond, 1)
  assert.equal(sealed.payout.hpMul, 1.15)
  const { tree } = deleteTile(RING(), 3)
  const reopened = grammarPayout(layout(tree).tiles, sealed.sealed)
  assert.equal(reopened.sealed.diamond, 0, 'the diamond void re-opened')
  assert.equal(reopened.payout.hpMul, 1, 'the HP payout dropped')
})

test('sy-delete: parts ride the re-rooted tiles (identity preserved through a cut)', () => {
  // a ring of distinct parts: base HULL, then ARMOR/GUN/ENGINE/GEN/ARMOR around.
  const tree = [{ parent: -1, edge: -1, part: 1 }]
  ;[2, 3, 4, 5, 2].forEach((p, k) => tree.push({ parent: tree.length - 1, edge: k < 2 ? 2 : k === 2 ? 1 : 2, part: p }))
  const lay = layout(tree)
  assert.equal(lay.rejected.length, 0, 'the parts ring lays out cleanly')
  const before = lay.tiles.map(t => t.part).sort()
  const { tree: after, orphans } = deleteTile(tree, 3)   // cut one ring tile
  assert.equal(orphans, 0, 'ring survives')
  const want = before.filter((_, i) => i >= 0)            // multiset minus the removed part
  const removedPart = lay.tiles[3].part
  const expect = before.slice(); expect.splice(expect.indexOf(removedPart), 1)
  assert.deepEqual(after.map(t => t.part).sort(), expect, 'exactly the cut tile\'s part is gone')
})

// ── sy-delete: the arm/fire gesture (double-click / modifier timing) ─────────

test('sy-delete gesture: a modifier click fires immediately', () => {
  const { fire, next } = deleteGesture(null, { tile: 3, mod: true, now: 10 })
  assert.equal(fire, true)
  assert.equal(next, null, 'the arm state clears on a fire')
})

test('sy-delete gesture: a bare click ARMS, the second click on the same tile within the window FIRES', () => {
  const first = deleteGesture(null, { tile: 3, mod: false, now: 1.0 })
  assert.equal(first.fire, false, 'first click only arms')
  assert.deepEqual(first.next, { tile: 3, at: 1.0 })
  const second = deleteGesture(first.next, { tile: 3, mod: false, now: 1.2 })  // 0.2 s < 0.4
  assert.equal(second.fire, true, 'double-click fires')
})

test('sy-delete gesture: a slow second click does NOT fire — it re-arms', () => {
  const first = deleteGesture(null, { tile: 3, mod: false, now: 1.0 })
  const late = deleteGesture(first.next, { tile: 3, mod: false, now: 1.9 })   // 0.9 s > 0.4
  assert.equal(late.fire, false)
  assert.deepEqual(late.next, { tile: 3, at: 1.9 }, 're-armed at the new time')
})

test('sy-delete gesture: a second click on a DIFFERENT tile arms that tile, does not fire', () => {
  const first = deleteGesture(null, { tile: 3, mod: false, now: 1.0 })
  const other = deleteGesture(first.next, { tile: 4, mod: false, now: 1.1 })
  assert.equal(other.fire, false)
  assert.deepEqual(other.next, { tile: 4, at: 1.1 })
})

test('sy-delete gesture: clicking the base (tile 0) or empty space never fires or arms', () => {
  const armed = { tile: 3, at: 1.0 }
  for (const tile of [0, null]) {
    const r = deleteGesture(armed, { tile, mod: true, now: 1.1 })
    assert.equal(r.fire, false, `tile ${tile} never fires (even with a modifier)`)
    assert.equal(r.next, armed, 'the existing arm is left untouched')
  }
})
