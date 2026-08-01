// mod-finder — THE SERVER BROWSER (Istrolid's multiplayer list). The local scene
// between the shipyard and a room: you see the live rooms the engine polled into
// `wd.__lobby`, pick which fleet you bring, and click a room (or NEW SERVER) to
// join. It owns ONE hook fragment (`FINDER_SRC`, aliased as `SRC` so build.mjs's
// scene switch picks it up) plus a couple of PURE helpers the unit test drives
// directly. It draws NOTHING with a raw pushEnt — only the shared chrome widgets
// (panel/listRow/button/topBar/cornerPads), so the browser reads like every other
// PENTARCH page (STRUCTURE §9, the chrome law).
//
// CONTRACT §3 namespaces this fragment reads/writes:
//   wd.__lobby      (read)  finder rooms `[{room,players,capacity,started,mode,name,official}]`
//   wd.__fleet      (read)  up to 3 saved berth designs `[tree|null, …]`
//   wd.__pickBerth  (r/w)   which fleet slots to bring `[bool,bool,bool]` (self-init)
//   wd.__joinRoom   (write) room name → engine opens the arena socket
//   wd.__sendDesign (write) the WHOLE berth set carried into input frames on join
//   wd.__scene      (write) tab/pad nav back to menu/designer
//   wd.__finderLayout (write) the computed row/button geometry, for tests + any HUD
//
// The pseudocode: render the rooms Istrolid-style (Official above Community,
// `<mode> <Name>` naming, player counts, a started flag), a NEW SERVER button,
// and a berth picker; click a room → wd.__joinRoom + wd.__sendDesign; all
// translucent over the live starfield the shader already draws behind chrome.

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS — the unit-tested brain of the fragment. Same logic the hook runs,
// callable off plain objects so the browser's rules are proven without a render.
// The FINDER_SRC string mirrors these inline (build.mjs inlines only SRC, never
// these exports — like mod-battle's pure helpers).
// ─────────────────────────────────────────────────────────────────────────────

/** roomLabel(r) — the Istrolid `<mode> <Name>` server name. Falls back to the
 *  raw room id when a friendly name is absent; a missing mode is simply dropped. */
export function roomLabel(r) {
  if (!r) return ''
  const name = (r.name != null ? r.name : (r.room != null ? r.room : ''))
  const mode = r.mode != null ? String(r.mode) : ''
  return (mode ? mode + ' ' : '') + String(name)
}

/** sortRooms(lobby) — Official servers first, then Community, each keeping poll
 *  order. Non-array / empty → []. Pure (returns a fresh array). */
export function sortRooms(lobby) {
  const L = Array.isArray(lobby) ? lobby.slice() : []
  return L
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ((b.r && b.r.official ? 1 : 0) - (a.r && a.r.official ? 1 : 0)) || (a.i - b.i))
    .map((x) => x.r)
}

/** berthSet(fleet, pick, fallbackTree) — the WHOLE berth set to carry on join:
 *  every non-null fleet slot whose `pick[i]` is not explicitly false, deep-copied.
 *  When nothing is picked/saved, falls back to a single-design set from the live
 *  design tree (so you always bring at least one ship). CONTRACT: __sendDesign is
 *  a set of trees, never one tree. */
export function berthSet(fleet, pick, fallbackTree) {
  const F = Array.isArray(fleet) ? fleet : []
  const P = Array.isArray(pick) ? pick : null
  const set = []
  for (let i = 0; i < F.length; i++) {
    if (F[i] && (!P || P[i] !== false)) set.push(F[i].map((t) => ({ ...t })))
  }
  if (!set.length) {
    const t = Array.isArray(fallbackTree) && fallbackTree.length
      ? fallbackTree
      : [{ parent: -1, edge: -1, part: 1 }]
    set.push(t.map((x) => ({ ...x })))
  }
  return set
}

// ── stable button ids (all disjoint from chrome's 0-5 tabs, 10-11 pads) ──────
export const ID_NEWSERVER = 6
export const ID_BERTH0 = 7        // 7,8,9 — the three fleet slots in the picker
export const ID_ROW0 = 12         // 12..17 — up to 6 visible room rows
export const MAX_ROWS = 6

// ─────────────────────────────────────────────────────────────────────────────
// FINDER_SRC — the HOOK FRAGMENT. Runs when SC==='finder'. Wrapped in its own
// `{ }` so its locals never collide with a sibling scene. Reads PRELUDE globals
// by name (wd, SC, PX/PY/DOWN, edgeTap, sound) and calls the inlined chrome
// widgets (panel/listRow/button/buttonAt/topBar/cornerPads). Degrades to just the
// chrome + NEW SERVER when wd.__lobby is empty — never throws.
// ─────────────────────────────────────────────────────────────────────────────
export const FINDER_SRC = String.raw`{
  // pointer → letterbox-square uv (PRELUDE already resolved it); a click is the
  // rising edge of the pointer so a single tap fires exactly once.
  const _px = (typeof PX === 'number') ? PX : 999;
  const _py = (typeof PY === 'number') ? PY : 999;
  const _clk = (typeof edgeTap === 'function') ? edgeTap('finder-click', !!DOWN) : false;

  // which fleet berths to bring (self-init: everything saved is brought).
  if (!Array.isArray(wd.__pickBerth)) wd.__pickBerth = [true, true, true];
  const _fleet = Array.isArray(wd.__fleet) ? wd.__fleet : [];
  // build the WHOLE berth set to carry on join (mirrors exported berthSet()).
  const _buildSet = () => {
    const set = [];
    for (let i = 0; i < _fleet.length; i++) {
      if (_fleet[i] && wd.__pickBerth[i] !== false) set.push(_fleet[i].map((t) => ({ ...t })));
    }
    if (!set.length) {
      const t = (D && Array.isArray(D.tree) && D.tree.length) ? D.tree : [{ parent: -1, edge: -1, part: 1 }];
      set.push(t.map((x) => ({ ...x })));
    }
    return set;
  };

  // ── persistent chrome (drawn every scene): tabs + corner pads ──────────────
  if (typeof topBar === 'function') {
    const _tab = topBar('finder', _px, _py, _clk);
    if (_tab === 'menu') wd.__scene = 'menu';
    else if (_tab === 'room' && wd.__pw) wd.__scene = 'room';   // only meaningful once in a room
  }
  if (typeof cornerPads === 'function') {
    const _pad = cornerPads(_px, _py, _clk);
    if (_pad === 'design' || _pad === 'fleet') wd.__scene = 'designer';
  }

  // ── layout constants (letterbox-square coords, +y up) ──────────────────────
  // chrome rows are 2:1 (height = hw·0.5), so ROW_DY must clear 2·(hw·0.5)=ROW_HW
  // or hit-boxes overlap and a click lands on two rows. ROW_DY > ROW_HW keeps each
  // row's hit zone disjoint — the browser never joins the wrong server.
  const ROW_X = -0.34, ROW_HW = 0.22;
  const NS_X = -0.34, NS_Y = 0.66, NS_HW = 0.28;
  const ROW0_Y = 0.44, ROW_DY = 0.24, HDR_GAP = 0.075;
  const PANEL_HW = 0.52;

  // translucent left panel behind the browser (drawn first → buttons composite over it).
  if (typeof panel === 'function') panel(ROW_X, 0.10, PANEL_HW, 0.66);
  // right column: Players / berth picker panel.
  if (typeof panel === 'function') panel(0.60, 0.18, 0.30, 0.52);

  // ── NEW SERVER (host a fresh room) ─────────────────────────────────────────
  const _layout = { newServer: { cx: NS_X, cy: NS_Y, hw: NS_HW }, rows: [] };
  if (typeof buttonAt === 'function' && buttonAt(${ID_NEWSERVER}, NS_X, NS_Y, NS_HW, _px, _py, _clk)) {
    wd.__joinRoom = 'new';
    wd.__newServer = true;
    wd.__sendDesign = _buildSet();
    if (typeof sound === 'function') sound('newserver');
  }

  // ── the room list: Official above Community, poll order within each ─────────
  const _rooms = (Array.isArray(wd.__lobby) ? wd.__lobby.slice() : [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ((b.r && b.r.official ? 1 : 0) - (a.r && a.r.official ? 1 : 0)) || (a.i - b.i))
    .map((x) => x.r);

  let _y = ROW0_Y;
  let _prevOff = null;
  let _drawn = 0;
  for (let k = 0; k < _rooms.length && _drawn < ${MAX_ROWS}; k++) {
    const r = _rooms[k] || {};
    const off = !!r.official;
    // section header (a thin non-interactive panel) when the section changes.
    if (off !== _prevOff) {
      if (typeof panel === 'function') panel(ROW_X, _y, ROW_HW, 0.024);
      _y -= HDR_GAP;
      _prevOff = off;
    }
    const _id = ${ID_ROW0} + _drawn;
    const _cy = _y;
    // a started room shades to the "active" state so it reads as in-progress.
    if (typeof listRow === 'function' && listRow(_id, ROW_X, _cy, ROW_HW, !!r.started, _px, _py, _clk)) {
      wd.__joinRoom = (r.room != null ? r.room : (r.name != null ? r.name : ''));
      wd.__newServer = false;
      wd.__sendDesign = _buildSet();
      if (typeof sound === 'function') sound('join');
    }
    _layout.rows.push({
      room: (r.room != null ? r.room : (r.name != null ? r.name : '')),
      label: ((r.mode != null ? String(r.mode) + ' ' : '') + String(r.name != null ? r.name : (r.room != null ? r.room : ''))),
      players: (r.players | 0), capacity: (r.capacity | 0), started: !!r.started, official: off,
      cx: ROW_X, cy: _cy, hw: ROW_HW,
    });
    _y -= ROW_DY;
    _drawn++;
  }

  // ── berth picker: which saved fleet slots you bring (toggle inclusion) ──────
  for (let s = 0; s < 3; s++) {
    const _saved = !!_fleet[s];
    const _on = _saved && wd.__pickBerth[s] !== false;
    const _bx = 0.60, _by = 0.30 - s * 0.15, _bhw = 0.11;
    if (typeof buttonAt === 'function' && buttonAt(${ID_BERTH0} + s, _bx, _by, _bhw, _px, _py, _clk, _on)) {
      if (_saved) wd.__pickBerth[s] = wd.__pickBerth[s] === false ? true : false;   // toggle
    }
  }

  wd.__finderLayout = _layout;
}`

// build.mjs's scene switch reads `SRC` (CONTRACT §1); FINDER_SRC is the map's
// declared export name. Alias so both the assembler and the work-graph agree.
export const SRC = FINDER_SRC
