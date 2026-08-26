// THE MODE OWNER — chrome/game-UI separation, rung 1 (Galen, Aug 26).
//
// A world on screen is always in exactly ONE mode, and the mode — not a pile
// of booleans — decides what platform chrome shows and whether the canvas is
// bounded:
//
//   view   — default. Game UI live inside the world; chrome is four things:
//            name · ? · SHARE · EDIT. Canvas fills its frame.
//   play   — one tap, clean. Game UI only; zero platform chrome beyond
//            REC + exit. Canvas edge to edge.
//   design — what EDIT opens (rung 3): the canvas insets and every world tool
//            (NODES · VERSIONS · UI-EDIT · params · build console) lives in a
//            rail beside the world. The bounded-canvas mechanism is the old
//            vote arena's viewport-inset primitive, reborn.
//
// Adoption plan (each rung its own commit, Galen-gated):
//   rung 1 (this) — the single mode cell exists in FieldEngine; 'play' is its
//     first tenant (the old playMode boolean is now derived from it).
//   rung 2 — platform chrome extracts into one <WorldChrome mode/> at the
//     shell edge; the scattered `viewport || playMode ? hidden` conditionals
//     die with it.
//   rung 3 — 'design' becomes real: the EDIT button sets it, the tools rail
//     opens. The save-states designMode (801c8f7 — author the cartridge
//     without touching per-player saves) MERGES into it: entering the rail IS
//     authoring the cartridge.
//
// Until rung 2 lands the shell doesn't own the cell yet — FieldEngine holds
// it — but there is only one cell, and 'design' is reserved. Nothing else may
// grow a new chrome-visibility boolean.
export type WorldMode = 'view' | 'play' | 'design'

export const WORLD_MODES: readonly WorldMode[] = ['view', 'play', 'design'] as const

// THE WORLD CONTAINER (spec v1 — https://claude.ai/code/artifact/090967ac-be95-4399-8385-6df6957878eb):
// one DOM element IS the world (FieldEngine's data-world-container). Three
// siblings, one owner each: CartridgeChrome renders into slots AROUND it,
// WorldContainer owns canvas + solved wd.ui + touch controls INSIDE it,
// DesignRail mounts beside it in 'design'. Migration: 1 wrap (done) ·
// 2 re-anchor solver to container+painted rects · 3 chrome to slots ·
// 4 frame=container sizing + rail · 5 vote deletion. Positioning by window
// coordinates is forbidden from step 2 onward (ui-seam-law).
