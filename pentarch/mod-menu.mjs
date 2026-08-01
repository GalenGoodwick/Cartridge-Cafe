// mod-menu — THE MENU (the title scene). The DISPATCH `else` fall-through: when no
// scene is set (`wd.__scene` unset, no room), this fragment runs. It is the front
// door — the title plate, the one PLAY button that opens the DESIGNER, a summary of
// the saved berths, and the persistent Istrolid chrome (top bar + design/fleet
// corner pads) so the menu already looks like every other scene.
//
// It owns NO geometry and NO chrome primitives — it composes the shared helpers
// build.mjs inlines from chrome.mjs (topBar/cornerPads/panel/buttonAt), so the menu
// can never diverge from the house style (STRUCTURE §9 / CONTRACT §9). All it adds
// on top of chrome is: one title panel, one PLAY button, and the berth plates.
//
// State it reads/writes (CONTRACT §3):
//   reads  wd.__fleet        the saved berth designs (0..3) → the summary plates
//   writes wd.__scene        'designer' on PLAY / design-pad; 'finder' on the tab
//
// Export: build.mjs wires a scene by reading `mod.SRC`, so the canonical string is
// exported as BOTH `MENU_SRC` (this node's declared contract export) and `SRC`
// (what the assembler consumes) — the same String.raw block, no drift.

// stable button id for PLAY. chrome already spends 0..5 (top-bar tabs+readouts),
// 10..11 (corner pads) and 12..16 (palette) — 6 is free and menu-only.
const PLAY_ID = 6

export const MENU_SRC = String.raw`
{
  // ── pointer + a single rising-edge "click" this tick (off-screen when no pointer)
  const _px = (PX == null ? -9 : PX), _py = (PY == null ? -9 : PY);
  const _clk = (typeof edgeTap === 'function') ? edgeTap('menu-click', DOWN) : false;

  // ── persistent chrome: top bar (menu tab active) + design/fleet corner pads ──
  if (typeof topBar === 'function') {
    const _tab = topBar('menu', _px, _py, _clk);
    if (_tab === 'finder') wd.__scene = 'finder';
    else if (_tab === 'room') wd.__scene = 'finder';   // no direct room from the title
  }
  if (typeof cornerPads === 'function') {
    const _pad = cornerPads(_px, _py, _clk);
    if (_pad === 'design') wd.__scene = 'designer';    // the design pad also opens the yard
  }

  // ── title plate: a bright panel high-centre — the identity of the menu ──
  if (typeof panel === 'function') panel(0.0, 0.55, 0.5, 0.14);

  // ── PLAY: the one big button. hit → open the DESIGNER (CONTRACT §3 wd.__scene) ──
  if (typeof buttonAt === 'function') {
    if (buttonAt(${PLAY_ID}, 0.0, 0.12, 0.26, _px, _py, _clk)) {
      wd.__scene = 'designer';
      if (typeof sound === 'function') sound([{ frequency: 660, duration: 0.10, volume: 0.14, type: 'sine' }]);
    }
  }

  // ── berths summary: up to 3 saved-design plates under the title. A saved berth
  //    reads brighter (a filled panel); an empty slot is a faint placeholder. ──
  const _fleet = Array.isArray(wd.__fleet) ? wd.__fleet : [];
  const _berthX = [-0.30, 0.0, 0.30];
  for (let _b = 0; _b < 3; _b++) {
    const _saved = !!(_fleet[_b] && (Array.isArray(_fleet[_b]) ? _fleet[_b].length : _fleet[_b].tree));
    if (typeof panel === 'function') panel(_berthX[_b], -0.32, 0.12, _saved ? 0.10 : 0.07);
  }
}
`

// build.mjs consumes `SRC`; MENU_SRC is this node's declared contract export. Same
// string — one source of truth, no fork.
export const SRC = MENU_SRC
