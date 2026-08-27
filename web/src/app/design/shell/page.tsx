'use client'

// THE WORLD-PAGE APP SHELL — rendered ENTIRELY from the engine grid, no
// cartridge (Galen: "take the basic layout for a world and do it — don't need
// a cartridge loaded"). Proof that the whole page's positioning comes from ONE
// place the AI can read: the platform doc (ui-grid-doc.ts), solved by
// GridChrome, verifiable by the eye. Nothing here is positioned by hand CSS —
// every chrome piece is a TENANT in a solved region. The game MOVER holds a
// live shader (engine art), so even the backdrop is "out of the shader engine."
import { useEffect, useRef, useState } from 'react'
import { WORLD_PAGE_GRID } from '@/app/engine/ui-grid-doc'
import { solveUiGrid, uiGridOverlaps, type SolvedRegion, type UiGridState, type UiGridDoc } from '@/app/engine/ui-grid'

// PROPOSED locally (not yet in the shared doc — my claimed desktop lane): the
// session rail. Inset a hair off top/bottom bars so it clears the overlap gate
// before it's ever proposed to the shared truth (this is the pattern: propose
// local → gate → merge with the chair's review, never edit shared doc blind).
// the shared doc's game.stage is full-bleed (cafe composites over it). For the
// CONTAINED look (Galen — the reckoning's bounded inset: chrome AROUND the
// world, never under), the shell overrides game.stage into a WINDOW that stops
// before the rail on desktop and sits below the topbar / above the bottombar.
const SHELL_DOC: UiGridDoc = {
  regions: [
    ...WORLD_PAGE_GRID.regions.filter(r => r.id !== 'game.stage'),
    // desktop: the world window is inset left of the rail
    { id: 'game.stage', layer: 'game', anchor: { vx: [0.01, 0.85], vy: [0.10, 0.925] }, z: 5, when: { viewport: { minW: 700 } } },
    // phone: no rail — the window spans the column, still bounded by the bars
    { id: 'game.stage.narrow', layer: 'game', anchor: { vx: [0.02, 0.98], vy: [0.115, 0.925] }, z: 5, when: { viewport: { maxW: 699 } } },
    { id: 'chrome.rail', layer: 'cafe', anchor: { vx: [0.858, 1], vy: [0.09, 0.93] }, z: 41, when: { viewport: { minW: 700 } } },
  ],
}
import { FitShader } from './FitShader'

function useSolved(container: { w: number; h: number } | null): SolvedRegion[] {
  const [solved, setSolved] = useState<SolvedRegion[]>([])
  useEffect(() => {
    const s = () => {
      const win = container ?? { w: window.innerWidth, h: window.innerHeight }
      const state: UiGridState = { mode: 'view', role: 'owner', worldState: 'done', window: win, triggers: {} }
      setSolved(solveUiGrid(SHELL_DOC, state))
    }
    s(); window.addEventListener('resize', s)
    return () => window.removeEventListener('resize', s)
  }, [container?.w, container?.h])
  return solved
}

/** A region made visible + its tenants — the shell IS the grid. Regions are
 *  ABSOLUTE inside the shell root (a containing block), so their solved rects
 *  are honored exactly at any instance — no fixed-vs-wrapper drift. */
function Region({ r, children, art }: { r: SolvedRegion; children?: React.ReactNode; art?: boolean }) {
  const isGame = r.layer === 'game'
  // COVER, never squish (Galen — the fit-law): the shader fills a SQUARE sized
  // to the region's larger side and is CROPPED by the region's overflow — the
  // aspect stays 1:1 so it can't stretch. Keyed by rect so it remounts fresh on
  // an instance change (fixes the phone→desktop canvas loss).
  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: r.rect.x, top: r.rect.y, width: r.rect.w, height: r.rect.h, zIndex: r.z,
        border: isGame ? '1px solid rgba(80,200,255,0.45)' : '1px dashed rgba(255,190,60,0.3)',
        borderRadius: isGame ? 10 : 0,
        background: isGame ? '#05060c' : 'transparent',
        boxShadow: isGame ? '0 0 0 1px rgba(0,0,0,0.6), inset 0 0 40px rgba(0,0,0,0.5)' : undefined,
      }}
    >
      {/* THE HONEST FIX (Galen: I hid the problem with crop-to-cover before).
          FitShader reads its OWN real pixel size and recomposes — circles stay
          round (no squish), it fills the box (no letterbox), content reflows
          instead of being chopped (no crop). No square-and-crop. */}
      {art && <FitShader />}
      <span className="absolute top-1 left-2 font-mono text-[10px] tracking-[0.15em] z-10"
        style={{ color: isGame ? '#50c8ff' : '#ffbe3c', textShadow: '0 1px 2px #000' }}>
        {r.id} · {r.rect.w}×{r.rect.h}
      </span>
      {children}
    </div>
  )
}

const chip = 'font-mono text-[12px] tracking-[0.15em] px-3 py-1.5 rounded-lg border border-white/15 bg-black/60 text-white/80 pointer-events-auto'

export default function ShellProof() {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [phone, setPhone] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  // the shell can size itself to a phone column to show the calculated instance
  useEffect(() => {
    const m = () => {
      const W = window.innerWidth, H = window.innerHeight
      if (phone) { const fw = Math.min(W, Math.round(H * 9 / 19.5), 460); setDims({ w: fw, h: H }) }
      else setDims({ w: W, h: H })
    }
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [phone])
  const solved = useSolved(dims)

  const tenants: Record<string, React.ReactNode> = {
    'chrome.topbar': <div className="absolute inset-0 flex items-center px-3 gap-2 pointer-events-none">
      <span className={chip}>◂</span><span className="font-mono text-[13px] tracking-[0.15em] text-white/85">BASE · Galen</span></div>,
    'chrome.rail': <div className="absolute inset-0 flex flex-col items-end p-2 gap-1.5 pointer-events-none">
      <span className={chip}>⛶ PLAY</span><span className={chip}>? INSTRUCTIONS</span><span className={chip}>✎ EDIT</span></div>,
    'chrome.bottombar.right': <div className="absolute inset-0 flex items-center justify-end px-2 gap-2 pointer-events-none">
      <span className={chip}>+ FOLLOW</span><span className={chip}>↗ SHARE</span></div>,
    'chrome.bottombar.left': <div className="absolute inset-0 flex items-center px-2 pointer-events-none">
      <span className={chip}>⌁ BUILDERBOX</span></div>,
  }

  const w = dims?.w ?? 0
  const left = phone && dims ? Math.round((window.innerWidth - w) / 2) : 0
  return (
    <>
      {/* the page behind the frame — inert, so the phone margins read as device */}
      <div className="fixed inset-0 -z-10" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }} />
      {/* THE SHELL ROOT — a CONTAINING BLOCK (transform) at the instance rect.
          Regions inside are absolute → solved rects honored exactly; the phone
          column is genuinely centered; toggling instance re-solves cleanly. */}
      <div
        ref={wrapRef}
        className="fixed top-0 overflow-hidden"
        style={{ left, width: w || '100%', height: '100%', transform: 'translateZ(0)', borderInline: phone ? '1px solid rgba(185,122,42,0.3)' : undefined }}
      >
        {solved.filter(r => !r.slip).map(r => (
          <Region key={r.id} r={r} art={r.layer === 'game'}>{tenants[r.id]}</Region>
        ))}
      </div>
      <button onClick={() => setPhone(p => !p)}
        className="fixed top-2 left-1/2 -translate-x-1/2 z-[999] font-mono text-[11px] tracking-[0.2em] px-3 py-1.5 rounded-full border border-emerald-300/50 text-emerald-200 bg-black/80 pointer-events-auto">
        {phone ? '◻ DESKTOP INSTANCE' : '▯ PHONE INSTANCE'}
      </button>
      <div className="fixed bottom-1 left-1/2 -translate-x-1/2 z-[999] font-mono text-[10px] tracking-[0.15em] text-white/40">
        {`the whole layout is solved from the doc — no hand CSS · gate: ${uiGridOverlaps(SHELL_DOC, solved).length === 0 ? 'PASS (overlaps: [])' : 'COLLIDE'}`}
      </div>
    </>
  )
}
