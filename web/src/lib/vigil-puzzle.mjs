// vigil-puzzle.mjs — the door-lockout loop that gives the flip a PURPOSE.
//
// The problem it solves: in free play the gaze∩light∩pane crossing fires ~2/800
// ticks — pure luck, so the flip feels like nothing. The puzzle makes crossings
// DELIBERATE and REACHABLE:
//   • DOORS block the nave; each is locked until its linked pane is flipped.
//   • STANCE PANELS: standing on one auto-aims the flame's light at that pane,
//     so you only have to wait for the Watcher's sweep to cross it — a solve you
//     perform, not stumble into.
// Once a door's pane has ever flipped, the door stays open (latched).

export function initPuzzle() {
  return {
    doors: [
      { id: 0, z: 11, linkedPane: 1, locked: true },
      { id: 1, z: 17, linkedPane: 2, locked: true },
    ],
    panels: [
      { id: 0, x: -1.5, z: 9, aimPane: 1 },
      { id: 1, x: -1.5, z: 15, aimPane: 2 },
    ],
  }
}

/** A locked door is solid across the walkable width in a thin z band. */
export function doorSolidAt(x, z, doors = []) {
  for (const d of doors) if (d.locked && Math.abs(z - d.z) < 0.4 && Math.abs(x) <= 9) return true
  return false
}

const paneCenter = (pane) => [pane.origin[0] + 1, 1, pane.origin[2] + 1]

/** On a panel → unit aim toward the linked pane's centre; else null. */
export function panelAssist(flamePos, panels = [], panes = []) {
  for (const p of panels) {
    if (Math.hypot(flamePos[0] - p.x, flamePos[2] - p.z) < 0.9) {
      const pane = panes.find((pn) => pn.id === p.aimPane)
      if (pane) {
        const c = paneCenter(pane)
        const dx = c[0] - flamePos[0], dz = c[2] - flamePos[2]
        const L = Math.hypot(dx, dz) || 1
        return [dx / L, 0, dz / L]
      }
    }
  }
  return null
}

/** After flips: a door unlocks the moment its linked pane has been flipped, and
 *  stays unlocked (latched — a re-armed dark pane must not re-lock the door). */
export function updateDoors(doors = [], panes = []) {
  for (const d of doors) {
    if (!d.locked) continue
    const pane = panes.find((pn) => pn.id === d.linkedPane)
    if (pane && pane.everFlipped) d.locked = false
  }
}
