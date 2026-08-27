// THE PLATFORM DOC v0 — the ONE uiGrid declaration for world pages (Galen:
// "we design the whole site with the engine"). Pages and the eye import THIS
// SAME object: what renders and what verifies can never drift. Placement
// changes land HERE (including codified owner drags — chrome_placement →
// band edits), never as hand CSS on elements.
//
// v0 scope: the world page. Regions are the HOMES; components become tenants
// one at a time (rung 2: SHARE first). The doc is intentionally minimal —
// every region added here must immediately pass the overlap gate.
import type { UiGridDoc } from './ui-grid'

/** the phone-window cut: at or under this column width the top band
 *  consolidates into ONE bar (chrome.topbar.narrow) — the calculated-instance
 *  predicate every consumer (doc, bar mount, engine yield) must share. */
export const NARROW_TOPBAR_MAX_W = 520

export const WORLD_PAGE_GRID: UiGridDoc = {
  regions: [
    // THE GAME MOVER — everything between the bars. Hosts its own perchers
    // (game UI) on the game-only layer; never cafe territory.
    { id: 'game.stage', layer: 'game', anchor: { vx: [0, 1], vy: [0.055, 0.94] }, z: 0 },

    // CAFE — the bars. Perchers roost here as they migrate off hand CSS.
    { id: 'chrome.topbar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.055] }, z: 40 },
    // narrow instance (rung 3): the consolidated bar [◂ · chip · ⚓] needs
    // headroom for the two-line focus chip — a DEEPENED topbar band on phone
    // windows only. Parented to chrome.topbar: same home, legal nesting.
    { id: 'chrome.topbar.narrow', layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.08] }, z: 62, parent: 'chrome.topbar', when: { viewport: { maxW: NARROW_TOPBAR_MAX_W } } },
    { id: 'chrome.bottombar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.94, 1] }, z: 40 },

    // bottombar slots (parented — legal nesting): actions right, console left
    { id: 'chrome.bottombar.right', layer: 'cafe', anchor: { vx: [0.72, 1], vy: [0.94, 1] }, z: 41, parent: 'chrome.bottombar' },
    { id: 'chrome.bottombar.left', layer: 'cafe', anchor: { vx: [0, 0.55], vy: [0.94, 1] }, z: 41, parent: 'chrome.bottombar' },

    // SLIP-INS — console/nav cost zero viewport at rest
    { id: 'console.builderbox', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.45, 1] }, z: 80, slip: { edge: 'bottom', trigger: 'console' } },
    { id: 'nav.site', layer: 'cafe', anchor: { vx: [0, 0.7], vy: [0, 1] }, z: 81, slip: { edge: 'left', trigger: 'nav' } },
  ],
}
