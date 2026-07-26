// vigil-puzzle.mjs — the CORE loop, redesigned to Galen's brief: "a walkway with
// gaps where eyes see." The central walkway has GAPS. Each gap is bridged by a
// pane that is solid footing ONLY while a Watcher's gaze currently lights it. You
// watch the sweeping gaze and cross a gap in the moment its pane is lit; step onto
// an unlit gap and it is just a hole. No doors, no locks — see the light, cross.

export function initPuzzle() {
  return {
    gaps: [
      { z: 8.5, pane: 0 },
      { z: 15.5, pane: 1 },
    ],
  }
}

/** Over an UNLIT gap → blocked (a hole). Over a lit gap or on solid walkway → clear. */
export function gapBlocked(x, z, gaps = [], panes = []) {
  for (const g of gaps) {
    if (Math.abs(z - g.z) < 1.6 && Math.abs(x) <= 2.6) {
      const pane = panes.find((p) => p.id === g.pane)
      if (!pane || !pane.lit) return true
    }
  }
  return false
}

/** Are you standing over a gap right now (whether lit or not)? */
export function overGap(x, z, gaps = []) {
  return gaps.some((g) => Math.abs(z - g.z) < 1.6 && Math.abs(x) <= 2.6)
}
