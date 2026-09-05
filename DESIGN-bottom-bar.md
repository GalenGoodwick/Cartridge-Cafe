# THE BOTTOM BAR — the complete pathway log (Sep 5, the from-scratch rebuild)

One fixed bar, one flex row: `[ LEFT flex-1 | RIGHT flex-1 (row-reversed) ]` — no floating
center. The right group's IDENTITY SLOT swaps SIGN IN ⇄ NAV on session state. No absolute zones, ever again.

## Every pathway (the registry in grid/BottomBar.tsx implements THIS table)

| id | icon | label | side (outer→inner) | shows when | tier | action |
|---|---|---|---|---|---|---|
| back | ◂ | — | LEFT 1 | always | 0 | history back; at start opens NAV |
| edit | ⚡ | EDIT | LEFT 2 | world not premium | 0 | the gold door — copy text that sets YOUR AI editing this world (modal) |
| title | — | Cartridge.Cafe / world name | LEFT 3 | not engine set | 1 | main: UI selector · games: attribution |
| share | ↗ | SHARE | LEFT 4 | always | 0 | copies the MCP one-liner (the whole invitation) |
| commons | ◉ | COMMONS | LEFT inner | main set | 1 | cafe-wide chat toggle |
| rec | ● | REC / m:ss | LEFT inner | games + playing | 2 | record world → mp4 |
| reset | ⟲ | RESET | LEFT inner | games + playing + world declares R-reset | 1 | confirm-then-restart |
| signin→nav | ⚿/☕ | SIGN IN ⇄ NAV | RIGHT 2 — THE IDENTITY SLOT | signed out = gold SIGN IN; signing in TURNS IT INTO the NAV cup (never disappears) | 0 | signin: /auth/signin · nav: the dockstar selector |
| connect | ⚿/⚡ | CONNECT AI / AI LIVE | RIGHT 1 (green, edge-pinned) | not engine set | 0 | the green door (modal); LIGHTS UP on the honest heartbeat |
| instructions | ? | INSTRUCTIONS | RIGHT 2 | games set | 0 | the world's ? card |
| contact | ✉ | CONTACT | RIGHT 3 | games set | 2 | /contact teams door |
| brewicon | ◆ | BREW ICON | RIGHT inner (near cup) | main set | 1 | icon author panel |

## The laws

- **Tiers, not clipping**: tier 0 = phone essentials · 1 = ≥700px · 2 = ≥1040px.
  A button either exists whole or not at all. overflow-hidden is the last-resort
  guard, never the mechanism.
- **Edge pins**: LEFT 1 (back) and RIGHT 1 (connect) can never be clipped —
  outermost in flex order (right group is row-reversed).
- **Touch floor**: narrow = 44×44px minimum targets, 16px glyphs.
- **Tones**: gold = "your AI acts" (EDIT, SIGN IN) · green = "AI presence"
  (CONNECT/LIVE, COMMONS active) · neutral chips = everything else. Premium
  worlds hide gold EDIT (their contract).
- **The bar reaches the physical bottom**: backing extends through
  env(safe-area-inset-bottom).
- Anything not in this table does NOT belong in the bar — it belongs in the NAV cup.
