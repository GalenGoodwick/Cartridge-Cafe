# THE BOTTOM BAR — the complete pathway log (Sep 5, the from-scratch rebuild)

One fixed bar, ONE div, one flex row:
`…spacer… back edit title share instructions [SIGN IN⇄NAV] connect …spacer… commons rec reset brewicon`.
The MAIN FLOW floats CENTERED (matched spacers either side); the TOGGLES cluster rides the right edge.
Every button lives in the same flex context. The IDENTITY SLOT swaps SIGN IN ⇄ NAV
on session state. No absolute zones, no sibling divs, ever again.

## Every pathway (the registry in grid/BottomBar.tsx implements THIS table)

| id | icon | label | side (outer→inner) | shows when | tier | action |
|---|---|---|---|---|---|---|
| back | ◂ | — | LEFT 1 | always | 0 | history back; at start opens NAV |
| edit | ⚡ | EDIT | LEFT 2 | main grid (BLUE) + in-world (GOLD, not premium) | 0 | copy text that sets YOUR AI editing (modal) |
| title | — | Cartridge.Cafe | LEFT 3 | main set ONLY (in games/engine the world is already selected — name is redundant; attribution lives in the engine's ⑂ LINEAGE tab) | 1 | UI selector |
| share | ↗ | SHARE | LEFT 4 | always | 0 | copies the MCP one-liner (the whole invitation) |
| create | ✚ | CREATE | LEFT 5 (gold) | not in create set, never IN-game | 0 | the birth half of the EDIT/CREATE pair — switches to the create set |
| commons | ◉ | COMMONS | LEFT inner | main set | 1 | cafe-wide chat toggle |
| rec | ● | REC / m:ss | LEFT inner | games + playing | 2 | record world → mp4 |
| reset | ⟲ | RESET | LEFT inner | games + playing + world declares R-reset | 1 | confirm-then-restart |
| signin→nav | ⚿/☕ | SIGN IN ⇄ NAV | RIGHT 2 — THE IDENTITY SLOT | signed out = gold SIGN IN; signing in TURNS IT INTO the NAV cup (never disappears) | 0 | signin: /auth/signin · nav: the dockstar selector |
| connect | ⚿/⚡ | CONNECT AI / AI LIVE | RIGHT 1 (green, edge-pinned) | not engine set | 0 | the green door (modal); LIGHTS UP on the honest heartbeat |
| instructions | ? | INSTRUCTIONS | RIGHT 2 | IN-game only (playing) | 0 | the world's ? card |
| brewicon | ◆ | BREW ICON | RIGHT inner (near cup) | main set | 1 | icon author panel |

## The laws

- **Tiers, not clipping**: tier 0 = phone essentials · 1 = ≥700px · 2 = ≥1040px.
  A button either exists whole or not at all. overflow-hidden is the last-resort
  guard, never the mechanism.
- **Center flow**: the main cluster floats centered and condenses symmetrically;
  only the toggles cluster pins an edge (right). back opens the flow, connect
  closes it (RIGHT array renders reversed into reading order).
- **Touch floor**: narrow = 44×44px minimum targets, 16px glyphs.
- **Glyph mode**: under 1280px every button sheds its word and keeps its icon
  (still ≥40px click boxes); full labels only when the whole row honestly fits.
  Condensing is graded: labels → icons (1280) → drop tier-2 (1040) → drop
  tier-1 + touch sizing (700).
- **Tones**: gold = "your AI acts" (CREATE, in-world EDIT, SIGN IN) · blue =
  the main grid's edit door (EDIT at browse) · green = "AI presence"
  (CONNECT/LIVE, COMMONS active) · neutral chips = everything else. Premium
  worlds hide gold EDIT (their contract).
- **The bar reaches the physical bottom**: backing extends through
  env(safe-area-inset-bottom).
- Anything not in this table does NOT belong in the bar — it belongs in the NAV cup.
  (contact lived here once, tier-vanished, and moved to the nav page — the precedent.)
