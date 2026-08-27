# MOBILE = APP SHELL (Galen's ruling, Aug 26 night)

> Mobile needs no editing tools — it is PLAY ONLY. Desktop edit tools all go
> to the RIGHT, inside the space. Mobile is designed as an APP SHELL:
> persistent app bar + the game as the main pane + a bottom app nav. A real
> cafe client, just play-only.

Chosen over the handheld-console frame (full-bleed, no chrome) and the
links-only frame (no mobile catalog ever). Mobile browses and plays; it never
edits.

## STRUCTURE: THE WORLD FRAME (see DESIGN-ui-grid.md § THE WORLD FRAME)

Galen's "don't use common ground code — remake so it is ours" = the old
Unity Chant iframe setup is PATTERN ONLY; none of its code ports. The
structural half of this design lives in the WORLD FRAME spec (DESIGN-ui-grid
§): app shell owns chrome via the platform doc; the world lives in an iframe
MOVER with a real viewport (fit=mobile = frame dimensions — letterbox math
and containing-block transforms die); one typed, versioned seam protocol
replaces ad-hoc window events. THIS document is the complement: WHAT the
mobile surface shows (play-only culling, phone chrome composition, the app
nav, the mobile shelf) — the product layer that renders ON the frame
structure. Structural rungs are the frame spec's F1–F5; the rungs below are
the surface rungs that ride them.

## The shape

```
┌─────────────┐
│ ◂ NAME    ☰ │  ← persistent APP BAR (chrome.topbar, phone instance)
├─────────────┤
│    GAME     │  ← game.stage — touch controls live in the GAME's own grid
│             │
├─────────────┤
│ ▦ shelf · ⌂ │  ← APP NAV (chrome.appnav, phone-only)
└─────────────┘
```

Everything is the ONE platform doc (ui-grid-doc.ts) culled by axes — no
mobile fork:

| surface | when-clause |
|---|---|
| chrome.topbar (◂ + title everywhere; ☰ joins on phone) | always; ☰ tenant `viewport:{maxW:520}` |
| ⚓ DOCK pill | `viewport:{minW:521}` — docking leads to editing; phone never sees it |
| EDIT fold / dock stack / BUILDERBOX / design rail / drag | `viewport:{minW:521}` + role owner/member (+ mode design as the rail lands) |
| chrome.appnav (▦ shelf · ⌂) | `viewport:{maxW:520}`, parented to chrome.bottombar |
| FOLLOW / SHARE | desktop: bottombar.right tenants (as shipped); phone: move into the ☰ sheet |
| touch controls | GAME layer perchers — the ghost-persistence lane, never cafe chrome |

## Desktop counterpart (same ruling, other side)

All edit tools consolidate to THE RIGHT: `chrome.rail` — one right-edge cafe
region hosting the whole edit surface (PLAY · INSTRUCTIONS · FORK · EDIT fold
→ later the design-mode tools rail beside a bounded canvas). No edit chrome
anywhere else. `when: { viewport:{minW:521} }`.

## Rungs (each its own commit, gates: overlap gate + tsc + suite + build + eye matrix)

0. **The frame rungs F1–F3 land first** (frame spec's lanes — fable/opus):
   world boots in the frame, shell chrome on GridChrome, fit=mobile = frame
   dimensions.
1. **Phone app bar completion** — ☰ tenant joins chrome.topbar on phone; it
   opens THE SHEET (slip-in region): INSTRUCTIONS · FOLLOW · SHARE ·
   "editing lives on desktop" note. ⚓ DOCK culled on phone (maxW 520).
2. **chrome.rail** — the right-edge home; PLAY/INSTRUCTIONS/FORK/EDIT become
   its tenants; FieldEngine hands content, never positions. Desktop-only
   (minW 521) — Galen: edit tools all to the RIGHT, inside the space.
3. **chrome.appnav** — the bottom app nav, phone-only: ⌂ (cafe door) · ▦
   (shelf). BLOCKED on rung 4's decision — nav without destinations is dead
   chrome.
4. **The mobile shelf** — the play-only catalog a phone can actually use
   (the reason phones redirect to /story today). Needs its own design pass;
   OPEN LANE — needs a ruling on what ⌂ and ▦ point at until it exists.
5. **Touch controls in the game grid** — after ghost persistence / F4 (game
   uiRects flow frame→shell); phone play without a keyboard.

## Open questions (for Galen / the track)

- Until rung 4: does ⌂ point at /story, and ▦ hide? (Recommended: yes — ship
  the bar + sheet now, nav follows the shelf.)
- Does the phone get the exit-gate dialog on ◂, or app-style instant back?
  (Recommended: keep the gate — a mid-game exit costs progress.)
- PWA/install prompt («add to home screen») — later polish lane, not now.
