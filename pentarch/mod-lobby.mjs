// mod-lobby — THE WAR ROOM (Istrolid battleroom). The in-room scene between a
// FINDER join and the BATTLE: the seat list, the ★HOST (lowest seat), the
// host-only DRAWN START button, per-room QUICKCHAT (latched number keys → canned
// lines in PW.chat), and a host mode/map picker — all laid TRANSLUCENT over the
// live map (capture circles), never a dead text screen (STRUCTURE §UI REFERENCE).
//
// This is a lib node: it exports a hook FRAGMENT string (`SRC`, aliased
// `LOBBY_SRC` — the MAP contract name) that build.mjs pastes into the DISPATCH
// under `SC === 'lobby'`, plus PURE helpers the unit test proves without a render.
// The fragment reads only PRELUDE globals (wd, PW, SC, MY_SEAT, PX/PY/DOWN, and
// the chrome helpers topBar/cornerPads/panel/button/buttonAt/listRow) + the
// interpolated CFG below — it declares no module names by reference (they aren't
// in scope inside the assembled hook), so every constant is baked in as a literal.
//
// CONTRACT touchpoints:
//   §2  IN_ROOM ⇒ wd.players present; MY_SEAT = gpuUniforms[15]; latch() consumes
//       the monotonic input counters (chat_n) off the acting player's frame.
//   §3  PW = wd.__pw : authoritative room state {scene,host,chat,started,mode,…}.
//       Host START sets PW.started + PW.scene='battle' (and mirrors wd.__started).
//   §4  entity codes: capture ring 200+owner · UI button 300+id · panel 320.
//   §9  every control is DRAWN (chrome buttonAt/listRow), panels are translucent.

// ── canned quickchat lines (number keys 1-9 → a line) ────────────────────────
export const QUICKCHAT = [
  'Attack!', 'Fall back', 'Group up', 'Nice!', 'Good game',
  'On my way', 'Help here', 'Hold', 'Go go go',
]

// ── game modes the host can pick (v1 FFA list; teams are a later node) ────────
export const MODES = ['1v1', '2v2', '3v3', 'FFA']

// ── stable button ids — chosen to avoid chrome's reserved ids (topBar 0..5,
//    cornerPads 10/11, palette 12..16) AND to keep every button code in the
//    [300,320) band (id ≤ 19) so the shader decodes them as buttons, never as a
//    panel(320)/banner(321). Seat rows share one id (they are non-interactive in
//    v1 — each row still pushes a distinct entity at its own position). ─────────
export const START_ID = 6
export const MODE_ID = [7, 8, 9, 18]   // one id per MODES entry (≤ 4)
export const MAP_ID = 19               // host map-cycle button
export const SEAT_ID = 17              // shared across seat rows

// ── layout (letterbox-square uv, +y up, [-1,1]) ──────────────────────────────
export const LOBBY = {
  panelX: -0.42, panelY: 0.12, panelHW: 0.50, panelHH: 0.66,  // the battleroom panel
  seatX: -0.72, seatY0: 0.56, seatDY: -0.15, seatHW: 0.30,     // seat list column
  modeX0: -0.86, modeY: -0.34, modeDX: 0.20, modeHW: 0.085,    // host mode grid
  mapX: 0.02, mapY: -0.34, mapHW: 0.12,                        // host map cycle
  startX: 0.62, startY: -0.55, startHW: 0.20,                  // host START button
  chatX: -0.72, chatY0: -0.52, chatDY: -0.10, chatHW: 0.36,    // chat log rows (bottom-left)
  ringN: 3,                                                    // capture circles on the live map
}

// the config baked into the hook string (the fragment runs in the assembled
// hook where the module's own names are NOT in scope — everything is a literal).
const CFG = { L: LOBBY, START_ID, MODE_ID, MAP_ID, SEAT_ID, QC: QUICKCHAT, MODES }

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS — the unit-tested brain, callable off plain data so the mechanic
// is proven without a render. The hook fragment mirrors these inline.
// ─────────────────────────────────────────────────────────────────────────────

/** hostSeat(players) — the HOST is the lowest occupied seat (Istrolid's rule).
 *  Returns the seat number, or -1 for an empty room. */
export function hostSeat(players) {
  if (!Array.isArray(players) || !players.length) return -1
  let h = Infinity
  for (const p of players) { const s = p && p.seat != null ? (p.seat | 0) : Infinity; if (s < h) h = s }
  return Number.isFinite(h) ? h : -1
}

/** seatList(players) — the occupied seats, ascending (the render order). */
export function seatList(players) {
  if (!Array.isArray(players)) return []
  return players.map((p) => (p && p.seat != null ? (p.seat | 0) : 0)).sort((a, b) => a - b)
}

/** cannedLine(key) — the quickchat line for number key 1..9 (out of range → ''). */
export function cannedLine(key) {
  const k = (key | 0)
  return (k >= 1 && k <= QUICKCHAT.length) ? QUICKCHAT[k - 1] : ''
}

/** appendChat(chat, entry, cap=5) — push a chat entry, keeping only the last
 *  `cap` lines (the rolling log the lobby renders). Returns the array (mutated). */
export function appendChat(chat, entry, cap = 5) {
  const a = Array.isArray(chat) ? chat : []
  a.push(entry)
  while (a.length > cap) a.shift()
  return a
}

// ─────────────────────────────────────────────────────────────────────────────
// SRC — the HOOK FRAGMENT. Runs each tick while SC === 'lobby'. Reads PRELUDE
// globals + the interpolated CFG; degrades (renders nothing interactive) if no
// PW/room is live. build.mjs wraps this whole string in its own `{ }` block.
// ─────────────────────────────────────────────────────────────────────────────
export const SRC = String.raw`{
  const CFG = ${JSON.stringify(CFG)};
  const L = CFG.L, QC = CFG.QC, MODES = CFG.MODES;
  const START_ID = CFG.START_ID, MODE_ID = CFG.MODE_ID, MAP_ID = CFG.MAP_ID, SEAT_ID = CFG.SEAT_ID;

  const players = Array.isArray(wd.players) ? wd.players : [];
  // occupied seats ascending; host = lowest seat (Istrolid rule)
  const seats = players.map(function (p) { return (p && p.seat != null) ? (p.seat | 0) : 0; }).sort(function (a, b) { return a - b; });
  const host = seats.length ? seats[0] : -1;
  const iAmHost = (MY_SEAT === host);

  // room state defaults (PW is authoritative when in a room)
  if (PW) {
    if (!Array.isArray(PW.chat)) PW.chat = [];
    if (typeof PW.mode !== 'number') PW.mode = 0;
    if (typeof PW.mapSel !== 'number') PW.mapSel = 0;
  }

  // pointer + one discrete rising-edge click for every drawn control this tick
  const px = (PX == null ? -999 : PX), py = (PY == null ? -999 : PY);
  const clicked = edgeTap('lobbyClick', DOWN);

  // 1) the LIVE MAP behind the panel: capture circles (never a dead screen)
  for (let r = 0; r < L.ringN; r++) {
    const ang = r / L.ringN * 6.28318;
    pushEnt(Math.cos(ang) * 0.5, Math.sin(ang) * 0.35 + 0.08, r / Math.max(1, L.ringN), 200 + (r % 3));
  }

  // 2) persistent Istrolid chrome (top bar tabs + design/fleet corner pads)
  topBar('room', px, py, clicked);
  cornerPads(px, py, clicked);

  // 3) the translucent battleroom panel (overlay — map stays visible behind)
  panel(L.panelX, L.panelY, L.panelHW, L.panelHH);

  // 4) seat list — one drawn row per occupied seat, the host row highlighted
  for (let i = 0; i < seats.length && i < 6; i++) {
    const sy = L.seatY0 + i * L.seatDY;
    listRow(SEAT_ID, L.seatX, sy, L.seatHW, seats[i] === host, px, py, clicked);
  }

  // 5) host controls: mode grid + map cycle + the DRAWN START button
  if (iAmHost && PW) {
    for (let m = 0; m < MODES.length; m++) {
      const mx = L.modeX0 + m * L.modeDX;
      if (buttonAt(MODE_ID[m], mx, L.modeY, L.modeHW, px, py, clicked, PW.mode === m)) PW.mode = m;
    }
    if (buttonAt(MAP_ID, L.mapX, L.mapY, L.mapHW, px, py, clicked)) PW.mapSel = ((PW.mapSel | 0) + 1) % 3;
    if (buttonAt(START_ID, L.startX, L.startY, L.startHW, px, py, clicked)) {
      PW.started = true;
      PW.scene = 'battle';
      wd.__started = true;
      sound('start');
    }
  } else {
    // non-host / no room: START is drawn but idle (not interactive)
    button(START_ID, L.startX, L.startY, L.startHW, 0);
  }

  // 6) QUICKCHAT — a latched number key (chat_n counter on my player frame) posts
  //    the canned line for chat_key into the shared PW.chat log (rolling last 5).
  const dChat = latch('chat_n');
  if (dChat > 0 && PW) {
    const me = players[MY_SEAT] || {};
    let key = (me.chat_key | 0);
    if (key < 1) key = 1; if (key > QC.length) key = QC.length;
    PW.chat.push({ seat: MY_SEAT, msg: QC[key - 1] || '' });
    while (PW.chat.length > 5) PW.chat.shift();
  }

  // 7) chat log — draw the last 5 lines as translucent rows (bottom-left)
  if (PW && Array.isArray(PW.chat)) {
    const from = Math.max(0, PW.chat.length - 5);
    for (let c = from; c < PW.chat.length; c++) {
      panel(L.chatX, L.chatY0 + (c - from) * L.chatDY, L.chatHW, 0.035);
    }
  }
}`

// The MAP contract name (§ exports: LOBBY_SRC). build.mjs reads `SRC`; this alias
// keeps both the assembler and the swarm contract satisfied by one source.
export const LOBBY_SRC = SRC
