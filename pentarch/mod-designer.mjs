// mod-designer — the SHIPYARD scene, assembled from its mechanic slices. Five
// mechanic nodes co-own this one module (the clobber-serialized file): each
// declares its own `F.<name>` hook-fragment (a String.raw block, wrapped in its
// own `{ }` so locals never collide) and its own pure helpers for the unit test.
// `build.mjs` reads only `SRC` (the concatenated fragments) into the DISPATCH;
// the exported pure helpers are test-only (build never inlines them).
//
//   F.ghost    sy-ghost    freeEdges → ghost; click ghost → blank tile
//   F.palette  sy-palette  category tabs; fill/replace selected tile's part
//   F.grammar  sy-grammar  holes()/classify() → sealed shapes → payouts   ← THIS SLICE
//   F.delete   sy-delete   double-click delete; contact-BFS re-root
//   F.stats    sy-stats    MASS/SPD/HP/DPS/PWR; brownout; APPLIES F.grammar's D.payout
//
// Geometry (layout/holes/classify/…) is inlined into PRELUDE by build.mjs, so
// the fragments call it by name. `holes` is imported here only for the pure
// test helper below.
import { holes } from './penta-holes.mjs'
import { layout, freeEdges, contacts, attachPose } from './penta-core.mjs'
import { statOf, partOf, PALETTE, CATEGORIES } from './parts.mjs'

// Ordered fragment registry — each mechanic node adds exactly its own key.
const F = {}

// ─────────────────────────────────────────────────────────────────────────────
// sy-ghost — GHOST PREVIEW + BLANK PLACEMENT (the shipyard CANVAS).
//
// Runs FIRST of the shipyard slices: it owns the live canvas the other slices
// dress. Each tick it lays out the design (geometry's layout — the frozen 38-test
// source of truth), fits a view scale so the whole hull sits inside the letterbox
// square (published on wd.__S, the tile radius the shader reads via uni(7)), and:
//   • PUSHES every placed tile (codes 0..5, z = rotation, +100 = the SELECTED
//     tile's bright halo — the live shader's decode) so the ship is visible.
//   • PUSHES a translucent GHOST (codes 60..68, z = legal(1), rotation packed in
//     fract(code)) at every FREE edge whose placement does NOT overlap — the SAT
//     oracle of geometry.freeEdges(). Only legal edges get a ghost (pseudocode:
//     "ghost at legal edges"), so the preview never lies about where a tile fits.
//   • HOVER = the nearest legal ghost to the cursor (uv distance < GHOST_R).
//     SELECT = the nearest tile (uv distance < TILE_R) — the D.sel every other
//     slice keys off (sy-palette fills it, sy-stats reads it, sy-delete cuts it).
//   • CLICK (rising edge of the pointer): a tile under the cursor SELECTS it (and
//     stamps D.lastClick for sy-delete's double-click); else a hovered ghost GROWS
//     a fresh BLANK (part 0) there and selects it. Tile-select wins over placement
//     so you can always re-pick a buried tile.
//
// sy-ghost uses its OWN pointer edge id ('ghost-click') so sy-delete can read the
// same physical click through a different edge latch without stealing it.
F.ghost = String.raw`{
  if (!D || !Array.isArray(D.tree) || !D.tree.length) { if (D) D.tree = [{ parent: -1, edge: -1, part: 1 }] }
  const _tree = D.tree
  const _lay = layout(_tree)
  const _tiles = _lay.tiles
  // ── view fit: centre on the hull, scale so it fills the letterbox square ──
  let _cx = 0, _cy = 0
  for (const _t of _tiles) { _cx += _t.cx; _cy += _t.cy }
  _cx /= _tiles.length; _cy /= _tiles.length
  let _ex = 1
  for (const _t of _tiles) _ex = Math.max(_ex, Math.hypot(_t.cx - _cx, _t.cy - _cy) + 1.2)
  const _S = Math.min(0.12, 0.80 / _ex)
  wd.__S = _S
  const _prj = (x, y) => ({ x: (x - _cx) * _S, y: (y - _cy) * _S })
  // ── legal ghosts (free edges whose placement does not overlap) ──
  const _ghosts = freeEdges(_tiles).filter(g => g.legal)
  // ── HOVER (nearest legal ghost) + SELECT (nearest tile), in the canvas band ──
  const _sel = (D.sel != null) ? (D.sel | 0) : 0
  let _hover = -1, _hd = 0.10, _tSel = -1, _td = 0.09
  const _canvas = (PY == null) ? false : (PY > -0.55)     // above the bottom palette strip
  if (PX != null && _canvas) {
    for (let _k = 0; _k < _ghosts.length; _k++) {
      const _p = _prj(_ghosts[_k].ghost.cx, _ghosts[_k].ghost.cy)
      const _d = Math.hypot(_p.x - PX, _p.y - PY)
      if (_d < _hd) { _hd = _d; _hover = _k }
    }
    for (let _i = 0; _i < _tiles.length; _i++) {
      const _p = _prj(_tiles[_i].cx, _tiles[_i].cy)
      const _d = Math.hypot(_p.x - PX, _p.y - PY)
      if (_d < _td) { _td = _d; _tSel = _i }
    }
  }
  // ── CLICK: select a tile, else grow a blank at the hovered ghost ──
  if (edgeTap('ghost-click', DOWN) && PX != null && _canvas) {
    if (_tSel >= 0) {
      D.lastClick = { tile: _tSel, at: (wd.__t || 0) }     // sy-delete reads this for double-click
      D.sel = _tSel
      wd.__play_sound = [{ frequency: 340, duration: 0.05, volume: 0.08, type: 'sine' }]
    } else if (_hover >= 0) {
      const _g = _ghosts[_hover]
      D.tree.push({ parent: _g.i, edge: _g.e, part: 0 })    // grow a BLANK
      D.sel = D.tree.length - 1
      if (D.rev != null) D.rev++
      wd.__play_sound = [{ frequency: 700, duration: 0.05, volume: 0.10, type: 'sine' }, { frequency: 980, duration: 0.06, volume: 0.07, type: 'sine' }]
    }
  }
  // ── PUBLISH the canvas: tiles first, then the ghosts over them ──
  const _selNow = (D.sel != null) ? (D.sel | 0) : _sel
  for (let _i = 0; _i < _tiles.length; _i++) {
    const _p = _prj(_tiles[_i].cx, _tiles[_i].cy)
    const _code = (_tiles[_i].part | 0) + (_i === _selNow ? 100 : 0)   // +100 = selected halo (shader)
    pushEnt(_p.x, _p.y, _tiles[_i].th, _code)
  }
  const _TAU = Math.PI * 2
  for (let _k = 0; _k < _ghosts.length; _k++) {
    const _p = _prj(_ghosts[_k].ghost.cx, _ghosts[_k].ghost.cy)
    let _r01 = ((_ghosts[_k].ghost.th % _TAU) + _TAU) % _TAU / _TAU
    if (_r01 >= 1) _r01 = 0                                 // keep floor(code)=60
    pushEnt(_p.x, _p.y, 1, 60 + _r01)                       // z = legal(1); rotation in fract(code)
  }
}`

// ─────────────────────────────────────────────────────────────────────────────
// sy-grammar — negative-space SHAPE GRAMMAR → payouts.
//
// The tech tree IS topology. Each tick we re-derive the enclosed holes of the
// live design (geometry's holes()/classify() — the frozen, 38-test source of
// truth: diamond / moon / star / bay), count sealed shapes, and:
//   • diamond → +15% HP each        (structural lattice)
//   • moon    → +3 PWR each         (resonance chamber)
//   • star    → arms the SUPER-WEAPON (intact pentagram; disarms if broken)
//   • bay     → hangar (carries a sub-unit)
// Payouts are published on `D.payout` — sy-stats APPLIES them; we never touch
// the stat sums. A *newly* sealed shape flashes (tinted by shape) and rings the
// seal fanfare (rarest new seal wins the flash: star>moon>bay>diamond). Deleting
// a tile re-opens the void: because we recompute from the live tiles every tick,
// D.sealed / D.payout simply drop — no bespoke un-seal path.
//
// A "construction crack" pays nothing: geometry only ever returns the four
// payout shapes for a genuinely enclosed loop, so anything it does NOT name a
// payout shape (the 'gap' bucket) is ignored here.
F.grammar = String.raw`{
  const _tree = (D && Array.isArray(D.tree) && D.tree.length) ? D.tree : [{ parent: -1, edge: -1, part: 1 }]
  const _lay = layout(_tree)
  const _hs = holes(_lay.tiles)
  const _sealed = { diamond: 0, moon: 0, star: 0, bay: 0 }
  for (const _h of _hs) if (_sealed[_h.shape] !== undefined) _sealed[_h.shape]++
  const _prev = D.sealed || {}
  const _rank = { star: 3, moon: 2, bay: 1, diamond: 0 }
  let _flash = null
  for (const _s in _sealed) {
    if (_sealed[_s] > (_prev[_s] | 0) && (_flash === null || _rank[_s] > _rank[_flash])) _flash = _s
  }
  if (_flash) {
    D.flash = 1.2
    D.flashKind = _flash
    wd.__play_sound = [
      { frequency: _flash === 'star' ? 1320 : _flash === 'moon' ? 880 : 660, duration: 0.4, volume: 0.22, type: 'sine' },
      { frequency: _flash === 'star' ? 1980 : 1320, duration: 0.5, volume: 0.12, type: 'sine' },
    ]
  }
  D.sealed = _sealed
  D.holesL = _hs
  D.payout = {
    hpMul: 1 + 0.15 * _sealed.diamond,   // sy-stats: sHp = round(sHp * hpMul)
    pwrAdd: 3 * _sealed.moon,            // sy-stats: sPwr += pwrAdd
    superWeapon: _sealed.star > 0,       // battle: intact star arms the lance
    star: _sealed.star,
    hangar: _sealed.bay,                 // battle: bay carries a sub-unit
  }
}`

// ─────────────────────────────────────────────────────────────────────────────
// sy-stats — the LIVE SHIP STATS + FLEET BERTHS (Istrolid's right panel).
//
// Runs LAST of the shipyard slices, so F.grammar has already published this
// tick's `D.payout` (the ladder's HP/PWR bonuses). We read the live design,
// sum the part STATs (statOf, inlined from parts.mjs), APPLY the payout, and
// publish the whole readout on `D.stats` for the chrome stat-card + any HUD:
//
//   MASS = Σ mass            SPD  = thrust/mass · 10     (0 if massless)
//   HP   = round(Σhp · hpMul)   ← diamond payout (+15% each)
//   DPS  = Σ dps             PWR  = Σ energy + pwrAdd     ← moon payout (+3 each)
//   BROWNOUT = PWR < 0  →  guns starve: effDps = round(DPS · 0.5)
//
// FLEET: the two-key berth store the finder carries into battle. `wd.__fleet`
// is up to three saved designs (CONTRACT §3, `[tree,…]`). Number keys 1/2/3
// pick the active berth `D.slot`; S saves the live design there (deep-copied so
// later edits don't mutate the berth); L loads it back. Each is a rising-edge
// tap (edgeTap) so a held key fires once. Berth cost is derived, never stored —
// battle recomputes spawn cost from the tree via the same statOf sum.
F.stats = String.raw`{
  const _tree = (D && Array.isArray(D.tree) && D.tree.length) ? D.tree : [{ parent: -1, edge: -1, part: 1 }]
  let _mass = 0, _hp = 0, _dps = 0, _thr = 0, _pwr = 0, _cost = 0
  for (const _d of _tree) {
    const _s = statOf(_d.part)
    _mass += _s.mass; _hp += _s.hp; _dps += _s.dps; _thr += _s.thrust; _pwr += _s.energy; _cost += _s.cost
  }
  const _po = D.payout || {}
  _hp = Math.round(_hp * (_po.hpMul || 1))     // diamond: structural lattice
  _pwr = _pwr + (_po.pwrAdd || 0)              // moon: resonance chamber
  const _brownout = _pwr < 0
  const _spd = _mass > 0 ? (_thr / _mass * 10) : 0
  const _effDps = _brownout ? Math.round(_dps * 0.5) : _dps   // starving guns fire at half rate
  D.stats = {
    mass: _mass, hp: _hp, dps: _dps, thrust: _thr, pwr: _pwr, cost: _cost,
    spd: _spd, brownout: _brownout, effDps: _effDps,
    superWeapon: !!_po.superWeapon, hangar: _po.hangar || 0,
  }
  // ── FLEET BERTHS: 1/2/3 pick a berth · S saves the live design · L loads ──
  if (!Array.isArray(wd.__fleet)) wd.__fleet = [null, null, null]
  if (D.slot == null) D.slot = 0
  for (let _k = 0; _k < 3; _k++) {
    if (typeof edgeTap === 'function' && edgeTap('berth' + _k, !!wd['key_' + (_k + 1)])) {
      D.slot = _k
      wd.__play_sound = [{ frequency: 380 + _k * 60, duration: 0.06, volume: 0.1, type: 'sine' }]
    }
  }
  if (typeof edgeTap === 'function' && edgeTap('berth-save', !!wd.key_s)) {
    wd.__fleet[D.slot] = _tree.map(t => ({ ...t }))
    D.flash = 0.8; D.flashKind = 'diamond'
    wd.__play_sound = [{ frequency: 660, duration: 0.1, volume: 0.14, type: 'sine' }, { frequency: 990, duration: 0.14, volume: 0.1, type: 'sine' }]
  }
  if (typeof edgeTap === 'function' && edgeTap('berth-load', !!wd.key_l) && wd.__fleet[D.slot]) {
    D.tree = wd.__fleet[D.slot].map(t => ({ ...t }))
    D.sel = 0; D.lastClick = null
    wd.__play_sound = [{ frequency: 520, duration: 0.12, volume: 0.12, type: 'sine' }]
  }
  // the live stat card (Istrolid right panel) via shared chrome — drawn once here
  if (typeof statCard === 'function') statCard(0.80, 0.30, 5)
}`

// ─────────────────────────────────────────────────────────────────────────────
// sy-palette — the category-tab PALETTE (Istrolid's parts strip).
//
// Five tabs HULL/ARMOR/GUN/ENGINE/GEN (parts.mjs PALETTE, slot s → part s+1).
// The strip + its highlight + hit-test are chrome's shared `palette()` widget, so
// every scene's palette reads identically. The ACTIVE tab mirrors the CURRENTLY
// SELECTED tile's part (sy-ghost owns D.sel). A tab click FILLS the selected tile
// (a fresh BLANK) or REPLACES its part — the same D.tree[D.sel].part = slot+1 the
// v9 designer did, region-gated to the bottom strip so it never fights the canvas
// ghost/select. Hovering a tab floats its stat-card (chrome's `statCard`).
//
// Clicking the tab that already matches the tile's part is a no-op (chrome's
// palette() returns null for the active tab) — re-picking the same part changes
// nothing. A blank tile (part 0) has no active tab, so any tab fills it.
F.palette = String.raw`{
  const _sel = (D && D.sel != null) ? (D.sel | 0) : 0
  const _cur = (D && Array.isArray(D.tree) && D.tree[_sel]) ? D.tree[_sel].part : 0
  const _active = (_cur >= 1 && _cur <= 5) ? _cur - 1 : -1
  // pointer → letterbox-square uv; a discrete click is the rising edge of the button
  let _px = 999, _py = 999
  if (wd.mouse_x != null && typeof toUV === 'function') { const _p = toUV(wd.mouse_x, wd.mouse_y); _px = _p.x; _py = _p.y }
  const _clk = (typeof edgeTap === 'function') ? edgeTap('pal-click', !!wd.mouse_down) : false
  // chrome draws the strip + highlight and returns the clicked tab (or null)
  const _hit = (typeof palette === 'function') ? palette(_active, _px, _py, _clk) : null
  if (_hit != null && D && Array.isArray(D.tree) && D.tree[_sel] && _hit >= 0 && _hit < 5) {
    D.tree[_sel].part = _hit + 1                        // FILL / REPLACE the selected tile
    if (D.rev != null) D.rev++
    wd.__play_sound = [{ frequency: 500 + _hit * 90, duration: 0.08, volume: 0.12, type: 'sine' }]
  }
  // HOVER stat-card: which tab is the pointer over? (chrome owns the layout/hit-test)
  if (wd.mouse_x != null && typeof CH === 'object' && typeof chHit === 'function' && typeof statCard === 'function') {
    let _hov = -1
    for (let _s = 0; _s < CH.palX.length; _s++) {
      if (chHit(CH.palX[_s], CH.palY, CH.palHW, CH.palHW * 0.5, _px, _py)) _hov = _s
    }
    if (_hov >= 0) statCard(CH.palX[_hov], CH.palY + 0.20, 5)
  }
}`

// ─────────────────────────────────────────────────────────────────────────────
// sy-delete — ROUTE-AWARE DELETE (Galen's rule: ships re-touch, so connectivity
// is the CONTACT GRAPH, not the build tree).
//
// GESTURE (owns its OWN pointer latch 'del-click', so it reads the same physical
// click sy-ghost selects on without stealing it): a click on a NON-BASE tile
// deletes it when a modifier is held (ctrl / ⌘ / X / a delete-mode toggle) OR it
// is the SECOND click on that same tile within 0.4 s (double-click). Otherwise the
// click just ARMS a double-click (D.__del = {tile, at}). Tile 0 (the base) is
// never deletable — deleting the root would have no hull to re-root to.
//
// THE CUT (why it's route-aware): removing a tile could split the build TREE, but
// the ship's tiles are physically flush wherever their edges coincide — a curled
// hull is a RING. We drop the tile, take geometry's `contacts` over the survivors
// (parent links AND re-touch), and BFS from the base to rebuild a fresh spanning
// tree: anything still routed to the base through ANY flush contact survives (a
// ring survives a cut); anything truly disconnected SHEARS OFF (orphans). Parts
// ride along on the re-rooted tiles. Because sy-grammar recomputes holes from the
// live tiles every tick, the re-opened void's payout simply drops — no un-seal
// path. Runs BEFORE sy-stats so the same tick reflects the smaller hull.
F.delete = String.raw`{
  const _tree = (D && Array.isArray(D.tree) && D.tree.length) ? D.tree : null
  if (_tree) {
    const _tiles = layout(_tree).tiles
    // recompute the tile under the cursor (same view + radius as sy-ghost's select)
    let _cx = 0, _cy = 0
    for (const _t of _tiles) { _cx += _t.cx; _cy += _t.cy }
    _cx /= _tiles.length; _cy /= _tiles.length
    let _ex = 1
    for (const _t of _tiles) _ex = Math.max(_ex, Math.hypot(_t.cx - _cx, _t.cy - _cy) + 1.2)
    const _S = Math.min(0.12, 0.80 / _ex)
    let _tSel = -1, _td = 0.09
    const _canvas = (PY == null) ? false : (PY > -0.55)     // above the palette strip
    if (PX != null && _canvas) {
      for (let _i = 0; _i < _tiles.length; _i++) {
        const _d = Math.hypot((_tiles[_i].cx - _cx) * _S - PX, (_tiles[_i].cy - _cy) * _S - PY)
        if (_d < _td) { _td = _d; _tSel = _i }
      }
    }
    const _clk = edgeTap('del-click', DOWN)                 // delete's OWN click latch
    if (_clk && _tSel > 0) {                                 // tile 0 (the base) is never deletable
      const _now = (wd.__t || 0)
      const _mod = !!(wd.key_control || wd.key_ctrl || wd.key_meta || wd.key_x || (D && D.delMode))
      const _dl = D.__del
      const _dbl = !!(_dl && _dl.tile === _tSel && (_now - _dl.at) < 0.4)
      if (_mod || _dbl) {
        // ── route-aware cut: BFS from the base, re-rooting the survivors' tree.
        // attachPose reorients a re-rooted tile (its shared edge becomes edge 0),
        // so we pick each parent edge by MATCHING the child's position against the
        // RECONSTRUCTED parent pose — a fresh layout() then reproduces the hull. ──
        const _kset = new Set()
        for (let _i = 0; _i < _tiles.length; _i++) if (_i !== _tSel) _kset.add(_i)
        const _adj = {}
        for (const _i of _kset) _adj[_i] = []
        for (const _c of contacts(_tiles)) {
          if (!_kset.has(_c.i) || !_kset.has(_c.j)) continue
          _adj[_c.i].push(_c.j); _adj[_c.j].push(_c.i)
        }
        const _nt = [{ parent: -1, edge: -1, part: _tiles[0].part }]
        const _nix = { 0: 0 }
        const _pose = { 0: { cx: _tiles[0].cx, cy: _tiles[0].cy, th: _tiles[0].th } }
        const _q = [0]
        while (_q.length) {
          const _i = _q.shift()
          for (const _j of (_adj[_i] || [])) {
            if (_nix[_j] != null) continue
            let _be = -1
            for (let _e = 0; _e < 5; _e++) {
              const _p = attachPose(_pose[_i], _e)
              if (Math.hypot(_p.cx - _tiles[_j].cx, _p.cy - _tiles[_j].cy) < 1e-6) { _be = _e; _pose[_j] = _p; break }
            }
            if (_be < 0) continue
            _nix[_j] = _nt.length
            _nt.push({ parent: _nix[_i], edge: _be, part: _tiles[_j].part })
            _q.push(_j)
          }
        }
        const _orphans = _kset.size - _nt.length             // survivors that sheared off (nt includes the base)
        D.tree = _nt; D.sel = 0; D.__del = null
        if (D.rev != null) D.rev++
        wd.__play_sound = _orphans > 0
          ? [{ frequency: 180, duration: 0.2, volume: 0.14, type: 'triangle' }, { frequency: 220, duration: 0.12, volume: 0.12, type: 'triangle' }]
          : [{ frequency: 220, duration: 0.12, volume: 0.14, type: 'triangle' }]
      } else {
        D.__del = { tile: _tSel, at: _now }                  // arm a double-click
      }
    }
  }
}`

// The composed scene hook: fragments run in Istrolid order. Missing slices
// (other nodes not yet built) contribute nothing — the scene degrades, never
// throws. build.mjs wraps this whole string in its own `{ }` in the DISPATCH.
export const SRC = ['ghost', 'palette', 'grammar', 'delete', 'stats']
  .map(k => F[k] || '')
  .join('\n')

// Also expose the raw fragment registry so a later assembler / integrate node
// can compose or introspect individual slices.
export const FRAGMENTS = F

// ── sy-grammar pure helper (the unit-tested brain of F.grammar) ──────────────
// Same logic as the hook fragment, callable off the built tiles. Returns the
// sealed-shape census, the newly-sealed shapes, the payout block sy-stats
// consumes, and the flash/sound the fanfare uses.
const RANK = { star: 3, moon: 2, bay: 1, diamond: 0 }
function sealTone(shape) {
  return [
    { frequency: shape === 'star' ? 1320 : shape === 'moon' ? 880 : 660, duration: 0.4, volume: 0.22, type: 'sine' },
    { frequency: shape === 'star' ? 1980 : 1320, duration: 0.5, volume: 0.12, type: 'sine' },
  ]
}

/** grammarPayout(tiles, prevSealed) — classify the design's enclosed holes and
 *  derive payouts + seal events. `tiles` come from layout(design).tiles;
 *  `prevSealed` is last tick's census ({diamond,moon,star,bay}) for edge
 *  detection (pass {} on the first tick). */
export function grammarPayout(tiles, prevSealed = {}) {
  const hs = holes(tiles)
  const sealed = { diamond: 0, moon: 0, star: 0, bay: 0 }
  for (const h of hs) if (sealed[h.shape] !== undefined) sealed[h.shape]++

  const newSeals = []
  for (const s of ['diamond', 'moon', 'star', 'bay']) {
    if (sealed[s] > (prevSealed[s] | 0)) newSeals.push(s)
  }
  let flashKind = null
  for (const s of newSeals) if (flashKind === null || RANK[s] > RANK[flashKind]) flashKind = s

  return {
    holes: hs,
    sealed,
    newSeals,
    flashKind,
    sound: flashKind ? sealTone(flashKind) : null,
    payout: {
      hpMul: 1 + 0.15 * sealed.diamond,
      pwrAdd: 3 * sealed.moon,
      superWeapon: sealed.star > 0,
      star: sealed.star,
      hangar: sealed.bay,
    },
  }
}

// ── sy-stats pure helpers (the unit-tested brain of F.stats) ─────────────────
// Same maths as the hook fragment, callable off a design tree (or the placed
// tiles from layout — either carries `.part`). Keep these in lockstep with
// F.stats above; the test pins both against parts.mjs.

/** shipStats(parts, payout) — sum the part STATs of a design and apply the
 *  shape-grammar payout (F.grammar's D.payout: {hpMul,pwrAdd,superWeapon,hangar}).
 *  `parts` is any array of entries with a `.part` (a design tree or layout tiles).
 *  → {mass,hp,dps,thrust,pwr,cost,spd,brownout,effDps,superWeapon,hangar}. */
export function shipStats(parts, payout = {}) {
  const t = (Array.isArray(parts) && parts.length) ? parts : [{ part: 1 }]
  let mass = 0, hp = 0, dps = 0, thrust = 0, pwr = 0, cost = 0
  for (const d of t) {
    const s = statOf(d.part)
    mass += s.mass; hp += s.hp; dps += s.dps; thrust += s.thrust; pwr += s.energy; cost += s.cost
  }
  hp = Math.round(hp * (payout.hpMul || 1))     // diamond: structural lattice +15% each
  pwr = pwr + (payout.pwrAdd || 0)              // moon: resonance chamber +3 each
  const brownout = pwr < 0
  const spd = mass > 0 ? (thrust / mass * 10) : 0
  const effDps = brownout ? Math.round(dps * 0.5) : dps   // starving guns fire at half
  return {
    mass, hp, dps, thrust, pwr, cost,
    spd, brownout, effDps,
    superWeapon: !!payout.superWeapon,
    hangar: payout.hangar || 0,
  }
}

/** A fresh 3-berth fleet (all empty). `wd.__fleet` shape (CONTRACT §3). */
export function freshFleet() {
  return [null, null, null]
}

/** saveBerth(fleet, slot, tree) — store a DEEP COPY of the design in berth `slot`
 *  (0..2) so later edits to the live design don't mutate the saved berth.
 *  Returns the (new) fleet array; a bad slot is a no-op. */
export function saveBerth(fleet, slot, tree) {
  const f = Array.isArray(fleet) ? fleet.slice() : freshFleet()
  while (f.length < 3) f.push(null)
  if (slot < 0 || slot > 2 || !Array.isArray(tree)) return f
  f[slot] = tree.map(t => ({ ...t }))
  return f
}

/** loadBerth(fleet, slot) — a DEEP COPY of berth `slot`'s design, or null if
 *  empty / out of range. The copy means loading twice yields independent trees. */
export function loadBerth(fleet, slot) {
  if (!Array.isArray(fleet) || slot < 0 || slot > 2 || !fleet[slot]) return null
  return fleet[slot].map(t => ({ ...t }))
}

/** berthCost(fleet, slot) — the ⬡ a berth's design costs to spawn (derived from
 *  the tree, never stored), so battle and the fleet summary agree. 0 if empty. */
export function berthCost(fleet, slot) {
  const tree = loadBerth(fleet, slot)
  return tree ? shipStats(tree).cost : 0
}

// ── sy-palette pure helpers (the unit-tested brain of F.palette) ──────────────
// The category-tab palette: five tabs (HULL/ARMOR/GUN/ENGINE/GEN), one per
// PALETTE part (slot s → part code PALETTE[s] = s+1). A tab click FILLS the
// selected tile (or REPLACES its part); hovering a tab yields its stat-card.
// Kept in lockstep with F.palette above — the test pins both against parts.mjs.

/** paletteTabs() — the five palette tabs in slot order: their part code, part
 *  NAME (the tab label, HULL/ARMOR/GUN/ENGINE/GEN) and the CATEGORIES label the
 *  strip groups them under. Derived from parts.mjs, never hand-listed. */
export function paletteTabs() {
  return PALETTE.map((code, slot) => {
    const p = partOf(code)
    return { slot, code: p.code, name: p.name, category: CATEGORIES[slot] }
  })
}

/** slotOfPart(part) — which palette tab (0..4) a part sits in, or -1 for a part
 *  that has no tab (e.g. a BLANK 0). Drives the ACTIVE-tab highlight. Accepts a
 *  code or a design entry {part}. */
export function slotOfPart(part) {
  const code = (part && typeof part === 'object') ? part.part : part
  return PALETTE.indexOf(code | 0)
}

/** setPart(tree, sel, slot) — FILL/REPLACE: return a NEW design tree with the
 *  selected tile's part set to palette slot `slot`'s part code. A no-op copy when
 *  `slot` or `sel` is out of range. Never throws, never mutates the input (the
 *  live hook mutates D.tree in place; this pure form copies so tests stay clean). */
export function setPart(tree, sel, slot) {
  const t = (Array.isArray(tree) ? tree : []).map(d => ({ ...d }))
  if (slot == null || slot < 0 || slot >= PALETTE.length) return t
  if (sel == null || sel < 0 || sel >= t.length) return t
  t[sel] = { ...t[sel], part: PALETTE[slot] }
  return t
}

/** paletteCard(slot) — the hover stat-card for a palette tab: the part's name,
 *  category, ⬡ cost and the design-stat rows Istrolid's tooltip shows
 *  (hp/mass/dps/thrust/energy). null when nothing is hovered / no such tab. */
export function paletteCard(slot) {
  if (slot == null || slot < 0 || slot >= PALETTE.length) return null
  const s = statOf(PALETTE[slot])
  return {
    slot, code: s.code, name: s.name, category: s.category, cost: s.cost,
    rows: [
      ['hp', s.hp], ['mass', s.mass], ['dps', s.dps],
      ['thrust', s.thrust], ['energy', s.energy],
    ],
  }
}

// ── sy-ghost pure helpers (the unit-tested brain of F.ghost) ──────────────────
// The canvas logic, callable off a design tree independent of the view/pointer.
// Kept in lockstep with F.ghost above; the test pins them against geometry.

/** legalGhosts(tiles) — the placeable ghost slots: every FREE edge whose attached
 *  pentagon does NOT overlap an existing tile (geometry's SAT oracle). Returns
 *  [{i, e, ghost:{cx,cy,th}}] — the same list F.ghost previews and grows blanks
 *  into. Illegal (overlapping) free edges are dropped, so a ghost never lies. */
export function legalGhosts(tiles) {
  return freeEdges(tiles).filter(g => g.legal).map(g => ({ i: g.i, e: g.e, ghost: g.ghost }))
}

/** placeBlank(tree, i, e) — grow a fresh BLANK (part 0) across tile `i`'s edge `e`
 *  and select it. Returns { tree, sel } with a NEW tree (the input is not mutated;
 *  the live hook mutates D.tree in place, this pure form copies for clean tests).
 *  `sel` is the new tile's index (the last entry). */
export function placeBlank(tree, i, e) {
  const t = (Array.isArray(tree) ? tree : []).map(d => ({ ...d }))
  t.push({ parent: i, edge: e, part: 0 })
  return { tree: t, sel: t.length - 1 }
}

/** viewFit(tiles) — the designer's world→uv transform: centre on the hull and
 *  scale (wd.__S) so it fits the letterbox square. Returns { cx, cy, S, project }
 *  where project(x,y) → {x,y} in uv (the space the shader + pointer share). */
export function viewFit(tiles) {
  const ts = (Array.isArray(tiles) && tiles.length) ? tiles : [{ cx: 0, cy: 0 }]
  let cx = 0, cy = 0
  for (const t of ts) { cx += t.cx; cy += t.cy }
  cx /= ts.length; cy /= ts.length
  let ex = 1
  for (const t of ts) ex = Math.max(ex, Math.hypot(t.cx - cx, t.cy - cy) + 1.2)
  const S = Math.min(0.12, 0.80 / ex)
  return { cx, cy, S, project: (x, y) => ({ x: (x - cx) * S, y: (y - cy) * S }) }
}

/** nearestIndex(pts, ux, uy, maxD) — index of the point [{x,y}] closest to
 *  (ux,uy) within `maxD`, or -1 if none is inside the radius. Drives hover
 *  (nearest ghost) and select (nearest tile). */
export function nearestIndex(pts, ux, uy, maxD) {
  let best = -1, bd = maxD
  for (let k = 0; k < pts.length; k++) {
    const d = Math.hypot(pts[k].x - ux, pts[k].y - uy)
    if (d < bd) { bd = d; best = k }
  }
  return best
}

/** tileCode(part, selected) — the pop `code` for a designer tile: the part index
 *  (0..5), +100 when it is the SELECTED tile (the live shader reads floor(code/100)
 *  == 1 as the bright halo; code % 100 stays the part). */
export function tileCode(part, selected) {
  return (part | 0) + (selected ? 100 : 0)
}

/** ghostCode(th) — the pop `code` for a ghost outline: 60 (the ghost band) with
 *  the tile rotation packed into the fractional part as th/2π (the shader unpacks
 *  fract(code)·2π). floor(ghostCode) is always 60. */
export function ghostCode(th) {
  const TAU = Math.PI * 2
  let r01 = ((th % TAU) + TAU) % TAU / TAU
  if (r01 >= 1) r01 = 0
  return 60 + r01
}

// ── sy-delete pure helpers (the unit-tested brain of F.delete) ────────────────
// Kept in lockstep with F.delete above; the test pins them against geometry's
// contacts()/layout(). The hook mutates D.tree in place — these pure forms copy.

/** deleteTile(tree, target) — ROUTE-AWARE delete. Remove tile `target` and rebuild
 *  the design by BFS from the base (tile 0) over the SURVIVORS' contact graph
 *  (geometry's `contacts` — parent links AND re-touch), so a hull that curled into
 *  a RING survives a single cut, while a genuinely disconnected branch SHEARS off.
 *  Parts ride the re-rooted tiles. The base (index 0) is never deletable and an
 *  out-of-range target is a no-op copy. Returns
 *    { tree, sel:0, removed, orphans }
 *  where `orphans` is how many survivors sheared off (unreachable from the base). */
export function deleteTile(tree, target) {
  const src = (Array.isArray(tree) && tree.length) ? tree : [{ parent: -1, edge: -1, part: 1 }]
  // the base is the ship's root — deleting it would leave nothing to re-root to.
  if (target == null || target <= 0 || target >= src.length) {
    return { tree: src.map(d => ({ ...d })), sel: 0, removed: false, orphans: 0 }
  }
  const tiles = layout(src).tiles
  if (target >= tiles.length) {
    return { tree: src.map(d => ({ ...d })), sel: 0, removed: false, orphans: 0 }
  }
  const keep = new Set()
  for (let i = 0; i < tiles.length; i++) if (i !== target) keep.add(i)
  const adj = {}
  for (const i of keep) adj[i] = []
  for (const c of contacts(tiles)) {                 // connectivity only — parent links AND re-touch
    if (!keep.has(c.i) || !keep.has(c.j)) continue
    adj[c.i].push(c.j); adj[c.j].push(c.i)
  }
  // BFS from the base, rebuilding the tree. attachPose FORCES a child's shared
  // edge to its own edge 0 (reorienting th), so a re-rooted tile's edge indices
  // shift — we cannot reuse the original contact edge. Instead we pick each parent
  // edge by MATCHING the child's actual position against the RECONSTRUCTED parent
  // pose, so a fresh layout() reproduces the exact hull (positions are invariant;
  // th differs only by pentagon symmetry, 72°, which renders identically).
  const nt = [{ parent: -1, edge: -1, part: tiles[0].part }]
  const nix = { 0: 0 }
  const pose = { 0: { cx: tiles[0].cx, cy: tiles[0].cy, th: tiles[0].th } }
  const q = [0]
  while (q.length) {
    const i = q.shift()
    for (const j of (adj[i] || [])) {
      if (nix[j] != null) continue
      let be = -1
      for (let e = 0; e < 5; e++) {
        const p = attachPose(pose[i], e)
        if (Math.hypot(p.cx - tiles[j].cx, p.cy - tiles[j].cy) < 1e-6) { be = e; pose[j] = p; break }
      }
      if (be < 0) continue                            // no edge reproduces j (should not happen for a real contact)
      nix[j] = nt.length
      nt.push({ parent: nix[i], edge: be, part: tiles[j].part })
      q.push(j)
    }
  }
  const orphans = keep.size - nt.length   // survivors not reachable from the base (nt includes the base)
  return { tree: nt, sel: 0, removed: true, orphans }
}

/** deleteGesture(prev, ev) — the arm/fire decision for a delete click (the timing
 *  half of F.delete, factored out so it is unit-testable without the pointer).
 *  `prev` is the armed state (D.__del) or null; `ev` = {tile, mod, now, window?}.
 *  A click on a valid NON-BASE tile FIRES when a modifier is held OR it repeats the
 *  armed tile within `window` (default 0.4 s); otherwise it ARMS that tile. A click
 *  on the base / empty space (tile == null or <= 0) never fires and never re-arms.
 *  Returns { fire, next } — `next` is the new armed state to store back on D.__del. */
export function deleteGesture(prev, { tile, mod = false, now = 0, window = 0.4 }) {
  if (tile == null || tile <= 0) return { fire: false, next: prev || null }
  const dbl = !!(prev && prev.tile === tile && (now - prev.at) < window)
  if (mod || dbl) return { fire: true, next: null }
  return { fire: false, next: { tile, at: now } }
}
