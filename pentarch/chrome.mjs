// chrome — the PENTARCH Istrolid VISUAL SYSTEM: ONE look for every scene.
//
// A lib node (verified by unit test). It exports two source STRINGS that other
// nodes inline — never wiring itself into a live render directly:
//
//   CHROME_WGSL     reusable WGSL primitive fns (rounded-rect SDF + panel/banner/
//                   button fills). shader.mjs pastes these in and calls them from
//                   its decode loop, so every scene's UI is drawn by the SAME code.
//   CHROME_PRELUDE  JS layout + draw + hit-test helpers. build.mjs inlines this
//                   into PRELUDE (like parts.mjs), so `panel/banner/button/statCard/
//                   listRow/palette/topBar/cornerPads` + the `CH` layout table land
//                   in scope for every mod-*. A scene calls ONE helper, never a raw
//                   pushEnt for chrome — so panels can't diverge (STRUCTURE §9).
//
// This file has NO imports (inlinable). It reuses the entity encoding of CONTRACT
// §4 and extends it with two non-interactive UI rects; buttons stay 300..319:
//
//   300..319  BUTTON  a = state (0 idle · 0.5 hover · 1 pressed/active)   fract(code) = half-width, height = hw·0.5
//   320       PANEL   translucent overlay rect                            a = packWH(halfW, halfH)
//   321       BANNER  red inline reason banner ("would overlap", …)       a = packWH(halfW, halfH)
//
// packWH packs the two half-sizes a rect needs into the single aux float `a`:
//   a = round(halfW·4096) + halfH        (halfW in [0,1], halfH in [0,1))
// The WGSL side inverts it exactly: halfW = floor(a)/4096, halfH = fract(a). The
// two exports MUST agree on this — chrome.test.mjs pins the round-trip.
//
// Coordinates are the LETTERBOX SQUARE (side = min(w,h)), the same space toUV maps
// pointer pixels into: a normalised [-1,1]² with +y up, +x right. The composers are
// PURE — a scene passes the pointer `(px,py)` and a rising-edge `clicked` boolean,
// and each returns which control (if any) was activated. No global reads → testable.

// ── WGSL primitives: the shared draw code the shader calls ──────────────────
export const CHROME_WGSL = String.raw`
// chrome geometry — mirrors CHROME_PRELUDE.chPackWH exactly (chrome.test pins this)
fn ch_unpackW(a: f32) -> f32 { return floor(a) / 4096.0; }
fn ch_unpackH(a: f32) -> f32 { return fract(a); }
fn ch_rrect(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
// translucent overlay panel: dark fill + cool rim. rgb premultiplied, a = coverage.
fn ch_panel(uv: vec2f, c: vec2f, hw: f32, hh: f32) -> vec4f {
  let d = ch_rrect(uv - c, vec2f(hw, hh), 0.02);
  let fill = smoothstep(0.004, -0.004, d);
  let rim = exp(-abs(d) * 150.0);
  let rgb = vec3f(0.09, 0.13, 0.21) * fill + vec3f(0.45, 0.62, 0.86) * rim * 0.6;
  return vec4f(rgb, fill * 0.55 + rim * 0.45);
}
// red reason banner: same rect, hot red rim so an illegal action reads instantly.
fn ch_banner(uv: vec2f, c: vec2f, hw: f32, hh: f32) -> vec4f {
  let d = ch_rrect(uv - c, vec2f(hw, hh), 0.015);
  let fill = smoothstep(0.004, -0.004, d);
  let rim = exp(-abs(d) * 170.0);
  let rgb = vec3f(0.28, 0.05, 0.06) * fill + vec3f(1.0, 0.34, 0.30) * rim;
  return vec4f(rgb, fill * 0.7 + rim * 0.6);
}
// drawn button: idle/hover/pressed brighten by state (0/0.5/1). height = hw*0.5.
fn ch_button(uv: vec2f, c: vec2f, hw: f32, state: f32) -> vec4f {
  let d = ch_rrect(uv - c, vec2f(hw, hw * 0.5), 0.012);
  let fill = smoothstep(0.005, -0.005, d);
  let rim = exp(-abs(d) * 190.0);
  let lift = 0.30 + 0.70 * state;
  let rgb = vec3f(0.14, 0.20, 0.30) * (1.0 + state) * fill + vec3f(0.55, 0.78, 1.0) * rim * lift;
  return vec4f(rgb, fill * 0.9 + rim * lift);
}
`

// ── PRELUDE helpers: layout, draw (via pushEnt), hit-test ────────────────────
export const CHROME_PRELUDE = String.raw`
// entity codes (CONTRACT §4) — chrome's slice
const CH_BTN0 = 300, CH_PANEL = 320, CH_BANNER = 321;

// the one layout table every scene shares (letterbox-square coords, +y up)
const CH = {
  barY: 0.90, barHalfH: 0.075, barHalfW: 0.995,        // persistent top bar band
  tabX: [-0.82, -0.66, -0.50], tabHW: 0.072,           // menu · finder · room tabs
  tabName: ['menu', 'finder', 'room'],
  matchX: 0.0, ctlX: [0.66, 0.84],                     // matchup centre · chat/controls right
  padY: -0.90, padHW: 0.062,                           // design (BL) · fleet (BR) corner pads
  designX: -0.90, fleetX: 0.90,
  palY: -0.86, palHW: 0.062, palX: [-0.30, -0.15, 0.0, 0.15, 0.30],  // bottom palette strip
  bannerY: -0.42, bannerHalfH: 0.05,                   // inline reason banner
  ID_DESIGN: 10, ID_FLEET: 11, ID_PAL0: 12,            // stable button ids
};

// pack two half-sizes into one aux float; WGSL ch_unpackW/H inverts it exactly.
function chPackWH(hw, hh) {
  const w = Math.max(0, Math.min(1, hw));
  const h = Math.max(0, Math.min(0.9999, hh));
  return Math.round(w * 4096) + h;
}
// rect hit-test in letterbox-square uv (self-contained — no dep on build's hitButton)
function chHit(cx, cy, hw, hh, px, py) {
  return px >= cx - hw && px <= cx + hw && py >= cy - hh && py <= cy + hh;
}

// primitives — the ONLY things that pushEnt chrome codes ---------------------
function panel(cx, cy, hw, hh) { pushEnt(cx, cy, chPackWH(hw, hh), CH_PANEL); }
function banner(cx, cy, hw, hh) { pushEnt(cx, cy, chPackWH(hw, hh), CH_BANNER); }
// drawn button; height = hw·0.5. code = 300+id + hw (hw<1 rides fract, id stays int).
function button(id, cx, cy, hw, state) {
  pushEnt(cx, cy, state, CH_BTN0 + id + Math.max(0, Math.min(0.999, hw)));
}
// interactive button: derives hover/pressed from the pointer, returns true on click.
function buttonAt(id, cx, cy, hw, px, py, clicked, forceOn) {
  const inside = chHit(cx, cy, hw, hw * 0.5, px, py);
  const state = forceOn ? 1 : (inside ? (clicked ? 1 : 0.5) : 0);
  button(id, cx, cy, hw, state);
  return inside && !!clicked;
}

// composed widgets — a scene calls these, never the primitives directly -------

// persistent top bar: band + scene tabs (active highlighted) + matchup + controls.
// returns the tab name clicked ('menu'|'finder'|'room') or null.
function topBar(active, px, py, clicked) {
  panel(0.0, CH.barY, CH.barHalfW, CH.barHalfH);
  let hit = null;
  for (let i = 0; i < CH.tabX.length; i++) {
    const on = CH.tabName[i] === active;
    if (buttonAt(i, CH.tabX[i], CH.barY, CH.tabHW, px, py, clicked, on) && !on) hit = CH.tabName[i];
  }
  // matchup readout (centre) + chat/controls (right) are non-interactive chrome
  button(3, CH.matchX, CH.barY, 0.20, 0.0);
  button(4, CH.ctlX[0], CH.barY, 0.055, 0.0);
  button(5, CH.ctlX[1], CH.barY, 0.055, 0.0);
  return hit;
}

// persistent bottom corner pads. returns 'design' | 'fleet' | null.
function cornerPads(px, py, clicked) {
  const d = buttonAt(CH.ID_DESIGN, CH.designX, CH.padY, CH.padHW, px, py, clicked);
  const f = buttonAt(CH.ID_FLEET, CH.fleetX, CH.padY, CH.padHW, px, py, clicked);
  return d ? 'design' : (f ? 'fleet' : null);
}

// bottom palette strip (designer). sel = active slot. returns clicked slot or null.
function palette(sel, px, py, clicked) {
  let hit = null;
  for (let s = 0; s < CH.palX.length; s++) {
    const on = s === sel;
    if (buttonAt(CH.ID_PAL0 + s, CH.palX[s], CH.palY, CH.palHW, px, py, clicked, on) && !on) hit = s;
  }
  return hit;
}

// tooltip stat card: a translucent panel sized to N stat rows. non-interactive.
function statCard(cx, cy, rows) {
  const hh = 0.03 * Math.max(1, rows) + 0.03;
  panel(cx, cy, 0.17, hh);
}

// a browser/seat list row. selected|hover shade; returns true when clicked.
function listRow(id, cx, cy, hw, selected, px, py, clicked) {
  const inside = chHit(cx, cy, hw, hw * 0.5, px, py);
  const state = selected ? 1 : (inside ? 0.5 : 0);
  button(id, cx, cy, hw, state);
  return inside && !!clicked;
}

// red inline reason banner ("would overlap" / "disconnected" / "not enough ⬡").
// stashes the text on wd for any external HUD; draws the red rect. hw scales w/ len.
function reason(msg) {
  wd.__reason = msg || '';
  if (!msg) return;
  const hw = Math.min(0.9, 0.05 + String(msg).length * 0.011);
  banner(0.0, CH.bannerY, hw, CH.bannerHalfH);
}
`
