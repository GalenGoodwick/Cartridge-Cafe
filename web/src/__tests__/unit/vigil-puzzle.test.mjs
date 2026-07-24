import { describe, it, expect } from 'vitest'
import { initPuzzle, doorSolidAt, panelAssist, updateDoors } from '../../lib/vigil-puzzle.mjs'
import { initVigilState, stepVigil } from '../../lib/vigil-logic.mjs'

describe('doorSolidAt', () => {
  it('a locked door blocks the nave; an unlocked one does not', () => {
    const doors = [{ id: 0, z: 11, linkedPane: 1, locked: true }]
    expect(doorSolidAt(0, 11, doors)).toBe(true)
    expect(doorSolidAt(0, 13, doors)).toBe(false) // away from the door band
    doors[0].locked = false
    expect(doorSolidAt(0, 11, doors)).toBe(false)
  })
})

describe('panelAssist', () => {
  it('on a panel → aims at the linked pane; off it → null', () => {
    const { panels } = initPuzzle()
    const panes = initVigilState().panes
    const aim = panelAssist([-1.5, 1, 9], panels, panes) // panel 0 aims at pane 1
    expect(aim).not.toBeNull()
    expect(Math.abs(Math.hypot(...aim) - 1)).toBeLessThan(1e-9)
    expect(panelAssist([5, 1, 5], panels, panes)).toBeNull()
  })
})

describe('updateDoors', () => {
  it('latches open once the linked pane has ever flipped', () => {
    const doors = [{ id: 0, z: 11, linkedPane: 1, locked: true }]
    const panes = [{ id: 1, everFlipped: 0 }]
    updateDoors(doors, panes); expect(doors[0].locked).toBe(true)
    panes[0].everFlipped = 1
    updateDoors(doors, panes); expect(doors[0].locked).toBe(false)
    panes[0].everFlipped = 0 // pane goes dark again — door must NOT re-lock
    updateDoors(doors, panes); expect(doors[0].locked).toBe(false)
  })
})

describe('THE SOLVE — the puzzle is actually solvable (not the 2/800 accident)', () => {
  it('a locked door blocks passage until you stand on its panel and the sweep crosses', () => {
    const G = initVigilState()
    // door 0 (z=11) starts locked → walking forward is stopped before it
    G.flame.pos = [-1.5, 1, 10.5]
    for (let i = 0; i < 30; i++) stepVigil(G, { moveX: 0, moveZ: 1, aimX: 0, aimZ: 1 }, 1 / 60)
    expect(G.doors[0].locked).toBe(true)
    expect(G.flame.pos[2]).toBeLessThan(11) // blocked by the locked door

    // now stand on panel 0 and hold — the stance aims the light; over a full
    // Watcher sweep a crossing MUST occur and flip pane 1, unlocking the door.
    G.flame.pos = [-1.5, 1, 9]
    let flipped = false
    for (let i = 0; i < 1200 && !flipped; i++) {
      stepVigil(G, { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0 }, 1 / 60)
      if (G.panes[1].everFlipped) flipped = true
    }
    expect(flipped).toBe(true)          // the solve fired — deliberately
    expect(G.doors[0].locked).toBe(false) // door unlocked

    // and now you can walk through where you couldn't before
    for (let i = 0; i < 120; i++) stepVigil(G, { moveX: 0, moveZ: 1, aimX: 0, aimZ: 1 }, 1 / 60)
    expect(G.flame.pos[2]).toBeGreaterThan(11.5) // passed the door
  })
})
