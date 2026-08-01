// mod-debrief — THE DEBRIEF: the post-battle scene. Battle arrives here on a win
// (bt-win sets PW.scene='debrief'); the room lingers on a translucent SCOREBOARD
// over the still-live battlefield (chrome law §9: never a dead screen), and offers
// two exits:
//   REMATCH  (host only) → PW.scene='lobby'   — the whole room re-forms in the war
//                                                room with the same seats/designs.
//   LEAVE    (any player) → wd.__scene='finder' — this client drops back to the
//                                                 server browser (arena tears the
//                                                 socket down when __pw goes away).
//
// A tiny lib node (CONTRACT §8 debrief). It only draws chrome primitives (panel +
// buttonAt + the persistent topBar/cornerPads) and flips two scene vars — no
// geometry, no mechanics. `build.mjs` inlines `SRC` into the DISPATCH under
// `else if (SC==='debrief'){…}`; the fragment is wrapped in its own `{ }` so its
// locals never collide. Green is DERIVED by test/debrief.test.mjs against the
// assembled hook (harness), then attested `unit-tested`.
//
// Entity codes it emits (CONTRACT §4 / chrome §): PANEL 320 (scoreboard + rows),
// BUTTON 306 = REMATCH, BUTTON 307 = LEAVE. Button ids 6/7 are free of chrome's
// reserved ids (topBar 0-5 · design 10 · fleet 11 · palette 12-16), so they never
// clash in _BTN / the shader's 300..319 button band.

export const DEBRIEF_SRC = String.raw`{
  // shared room state (undefined only if we somehow reach debrief locally)
  const _pw = (typeof PW === 'object' && PW) ? PW : null;
  const _host = (_pw && typeof _pw.host === 'number') ? _pw.host : 0;
  const _isHost = (MY_SEAT === _host);
  // local pointer (uv, letterbox square) + a rising-edge click — UI nav is always
  // driven by THIS client's pointer, never the authoritative input frame.
  const _px = (PX == null ? 99 : PX), _py = (PY == null ? 99 : PY);
  const _click = edgeTap('debrief_ui', DOWN);

  // ── persistent chrome (drawn in every scene) ──
  const _tab = topBar('room', _px, _py, _click);
  if (_tab === 'menu') wd.__scene = 'menu';
  else if (_tab === 'finder') wd.__scene = 'finder';
  const _pad = cornerPads(_px, _py, _click);
  if (_pad === 'design') wd.__scene = 'designer';

  // ── the SCOREBOARD: a translucent overlay (battlefield stays live behind it) ──
  panel(0.0, 0.20, 0.52, 0.42);
  // one standings row per seat; the winner's row is highlighted (a brighter panel).
  const _seats = (_pw && Array.isArray(_pw.seats)) ? _pw.seats
               : (Array.isArray(wd.players) ? wd.players : [{ seat: 0 }]);
  const _winner = _pw ? _pw.winner : undefined;
  for (let _i = 0; _i < _seats.length && _i < 6; _i++) {
    const _s = _seats[_i] || {};
    const _key = (_s.seat != null ? _s.seat : _i);
    const _isWin = (_winner != null && _winner === _key);
    const _ry = 0.40 - _i * 0.115;
    panel(0.0, _ry, _isWin ? 0.46 : 0.42, 0.045);
  }

  // ── REMATCH (host only) → re-form the room in the lobby ──
  if (_isHost) {
    if (buttonAt(6, -0.22, -0.55, 0.18, _px, _py, _click) && _pw) {
      _pw.scene = 'lobby';
      _pw.started = false;
      _pw.bt = null;
      wd.__started = false;
      sound('rematch');
    }
  }

  // ── LEAVE (any player) → back to the server browser ──
  if (buttonAt(7, 0.22, -0.55, 0.18, _px, _py, _click)) {
    wd.__scene = 'finder';
    sound('leave');
  }
}`

// build.mjs consumes `SRC`; the swarm graph names this node's export DEBRIEF_SRC.
// One string, two names — build inlines SRC, the map tracks DEBRIEF_SRC.
export const SRC = DEBRIEF_SRC
