'use client'

// GRID CHROME — rung 2 of the ui-grid (the compositor's first breath): cafe
// perchers whose POSITION COMES FROM THE SOLVER, never hand CSS. A tenant
// declares only its region id + gravity within it; GridChrome solves the
// PLATFORM DOC against the live container each frame a resize lands, and the
// percher renders at its region's solved rect. Placement edits happen in the
// DOC (ui-grid-doc.ts) — including codified owner drags — and every consumer
// (page, eye, probe) reads the same truth.
import { useEffect, useState, type ReactNode } from 'react'
import { WORLD_PAGE_GRID } from './ui-grid-doc'
import { solveUiGrid, type SolvedRegion, type UiGridState } from './ui-grid'

export function useSolvedGrid(container?: { w: number; h: number } | null): SolvedRegion[] {
  const [solved, setSolved] = useState<SolvedRegion[]>([])
  useEffect(() => {
    const solve = () => {
      const win = container ?? { w: window.innerWidth, h: window.innerHeight }
      const state: UiGridState = { mode: 'view', role: 'visitor', worldState: 'done', window: win }
      setSolved(solveUiGrid(WORLD_PAGE_GRID, state))
    }
    solve()
    window.addEventListener('resize', solve)
    return () => window.removeEventListener('resize', solve)
  }, [container?.w, container?.h])   // eslint-disable-line react-hooks/exhaustive-deps
  return solved
}

/** A TENANT: renders its children at the solved rect of `region`, aligned by
 *  gravity. The child owns its content; the GRID owns its place. */
export function GridSlot({ region, gravity = 'center', solved, children }: {
  region: string
  gravity?: 'center' | 'left' | 'right'
  solved: SolvedRegion[]
  children: ReactNode
}) {
  const r = solved.find(s => s.id === region)
  if (!r) return null
  const justify = gravity === 'left' ? 'flex-start' : gravity === 'right' ? 'flex-end' : 'center'
  return (
    <div
      data-cc-chrome
      className="fixed z-[60] flex items-center pointer-events-auto"
      style={{ left: r.rect.x, top: r.rect.y, width: r.rect.w, height: r.rect.h, justifyContent: justify, zIndex: r.z + 20 }}
    >
      {children}
    </div>
  )
}
