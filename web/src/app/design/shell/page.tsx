'use client'

// THE WORLD-PAGE APP SHELL — rendered ENTIRELY from the engine grid, no
// cartridge (Galen: "take the basic layout for a world and do it — don't need
// a cartridge loaded"). Proof that the whole page's positioning comes from ONE
// place the AI can read: the platform doc (ui-grid-doc.ts), solved by the grid,
// verifiable by the eye. Nothing is positioned by hand CSS — every chrome piece
// is a TENANT in a solved region.
//
// MOBILE INSTANCE (Galen, from a live CINDERFELL phone shot: "we have no header
// or footer space to expand menu options from"). On a phone the desktop RAIL
// (⛶ PLAY / ? INSTRUCTIONS / ✎ EDIT / ⑂ FORK) has nowhere to go, so on the real
// page those buttons FLOAT over the world and the cafe actions collide with the
// game's joystick + A/B. The fix: reserve a HEADER band and a FOOTER band, and
// collapse the overflow into menus that EXPAND FROM those bands (the grid's
// slip-in mechanic) — the world + its game controls stay clear between them.
import { useEffect, useRef, useState } from 'react'
import { WORLD_PAGE_GRID } from '@/app/engine/ui-grid-doc'
import { solveUiGrid, uiGridOverlaps, type SolvedRegion, type UiGridState, type UiGridDoc } from '@/app/engine/ui-grid'
import { FitShader } from './FitShader'

// the shared doc's game.stage is full-bleed; for the CONTAINED look (chrome
// AROUND the world, never under) the shell insets it: desktop stops before the
// rail, phone spans the column but stays BETWEEN the reserved bands.
const SHELL_DOC: UiGridDoc = {
  regions: [
    ...WORLD_PAGE_GRID.regions.filter(r => r.id !== 'game.stage'),
    { id: 'game.stage', layer: 'game', anchor: { vx: [0.01, 0.85], vy: [0.10, 0.925] }, z: 5, when: { viewport: { minW: 700 } } },
    // phone: the world sits BETWEEN the header (0.09) and footer (0.90) bands —
    // the bands are reserved space, so nothing floats over the world.
    { id: 'game.stage.narrow', layer: 'game', anchor: { vx: [0.02, 0.98], vy: [0.09, 0.90] }, z: 5, when: { viewport: { maxW: 699 } } },
    { id: 'chrome.rail', layer: 'cafe', anchor: { vx: [0.858, 1], vy: [0.09, 0.93] }, z: 41, when: { viewport: { minW: 700 } } },
  ],
}

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
 *  are honored exactly at any instance. */
function Region({ r, children, art }: { r: SolvedRegion; children?: React.ReactNode; art?: boolean }) {
  const isGame = r.layer === 'game'
  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: r.rect.x, top: r.rect.y, width: r.rect.w, height: r.rect.h, zIndex: r.z,
        border: isGame ? '1px solid rgba(80,200,255,0.35)' : undefined,
        borderRadius: isGame ? 10 : 0,
        background: isGame ? '#05060c' : 'rgba(10,9,14,0.82)',
        backdropFilter: isGame ? undefined : 'blur(6px)',
        boxShadow: isGame ? '0 0 0 1px rgba(0,0,0,0.6), inset 0 0 40px rgba(0,0,0,0.5)' : undefined,
      }}
    >
      {art && <FitShader />}
      {children}
    </div>
  )
}

const chip = 'font-mono text-[12px] tracking-[0.15em] px-3 py-1.5 rounded-lg border border-white/15 bg-black/60 text-white/80 pointer-events-auto'
const dot = 'font-mono text-[15px] w-9 h-9 grid place-items-center rounded-lg border border-white/20 bg-black/70 text-white/85 pointer-events-auto active:bg-white/15'
const menuItem = 'w-full text-left font-mono text-[13px] tracking-[0.18em] px-4 py-3.5 text-white/85 border-b border-white/10 active:bg-white/10 pointer-events-auto'

export default function ShellProof() {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [phone, setPhone] = useState(false)
  const [menu, setMenu] = useState<null | 'world' | 'cafe'>(null)   // which reserved-band drawer is open
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const m = () => {
      const W = window.innerWidth, H = window.innerHeight
      if (phone) { const fw = Math.min(W, Math.round(H * 9 / 19.5), 460); setDims({ w: fw, h: H }) }
      else setDims({ w: W, h: H })
    }
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [phone])
  // when entering the phone instance, open the header menu once so the
  // "expand FROM the band" behaviour is visible at a glance.
  useEffect(() => { setMenu(phone ? 'world' : null) }, [phone])
  const solved = useSolved(dims)
  const isNarrow = (dims?.w ?? 9999) <= 699

  const topbar = solved.find(r => r.id === 'chrome.topbar')
  const bottombar = solved.find(r => r.id === 'chrome.bottombar')
  const stage = solved.find(r => r.id === 'game.stage.narrow' || r.id === 'game.stage')

  const tenants: Record<string, React.ReactNode> = {
    'chrome.topbar': isNarrow ? (
      // HEADER BAND: back · title · ⋯ (expands the world menu DOWN from here)
      <div className="absolute inset-0 flex items-center px-2 gap-2">
        <span className={dot}>◂</span>
        <span className="font-mono text-[12px] tracking-[0.15em] text-white/85 truncate">CINDERFELL</span>
        <button className={`${dot} ml-auto ${menu === 'world' ? 'bg-white/15 border-amber-300/50' : ''}`}
          onClick={() => setMenu(m => m === 'world' ? null : 'world')}>⋯</button>
      </div>
    ) : (
      <div className="absolute inset-0 flex items-center px-3 gap-2 pointer-events-none">
        <span className={chip}>◂</span><span className="font-mono text-[13px] tracking-[0.15em] text-white/85">CINDERFELL · Galen</span>
        <span className={`${chip} ml-auto`}>⚓ DOCK IN</span></div>
    ),
    'chrome.rail': (
      <div className="absolute inset-0 flex flex-col items-end p-2 gap-1.5 pointer-events-none">
        <span className={chip}>⛶ PLAY</span><span className={chip}>? INSTRUCTIONS</span><span className={chip}>✎ EDIT</span></div>
    ),
    'chrome.bottombar': isNarrow ? (
      // FOOTER BAND: primary action + ⋯ (expands the cafe menu UP from here)
      <div className="absolute inset-0 flex items-center px-2 gap-2">
        <span className={`${chip} flex-1 text-center`}>⛶ PLAY</span>
        <button className={`${dot} ${menu === 'cafe' ? 'bg-white/15 border-amber-300/50' : ''}`}
          onClick={() => setMenu(m => m === 'cafe' ? null : 'cafe')}>⋯</button>
      </div>
    ) : null,
    'chrome.bottombar.right': isNarrow ? null : (
      <div className="absolute inset-0 flex items-center justify-end px-2 gap-2 pointer-events-none">
        <span className={chip}>+ FOLLOW</span><span className={chip}>↗ SHARE</span></div>
    ),
    'chrome.bottombar.left': isNarrow ? null : (
      <div className="absolute inset-0 flex items-center px-2 pointer-events-none">
        <span className={chip}>⌁ BUILDERBOX</span></div>
    ),
  }

  const w = dims?.w ?? 0
  const left = phone && dims ? Math.round((window.innerWidth - w) / 2) : 0
  const gate = uiGridOverlaps(SHELL_DOC, solved).length === 0

  return (
    <>
      <div className="fixed inset-0 -z-10" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }} />
      <div
        ref={wrapRef}
        className="fixed top-0 overflow-hidden"
        style={{ left, width: w || '100%', height: '100%', transform: 'translateZ(0)', borderInline: phone ? '1px solid rgba(185,122,42,0.3)' : undefined }}
      >
        {solved.filter(r => !r.slip).map(r => (
          <Region key={r.id} r={r} art={r.layer === 'game'}>{tenants[r.id]}</Region>
        ))}

        {/* GAME CONTROLS live INSIDE the stage (game layer) — the whole point is
            they no longer collide with cafe chrome, because the footer band is
            reserved space below them. */}
        {isNarrow && stage && (
          <div className="absolute pointer-events-none" style={{ left: stage.rect.x, top: stage.rect.y, width: stage.rect.w, height: stage.rect.h, zIndex: 6 }}>
            <div className="absolute left-3 bottom-3 w-16 h-16 rounded-full border border-white/25 grid place-items-center">
              <div className="w-7 h-7 rounded-full bg-white/40" /></div>
            <div className="absolute right-3 bottom-3 flex gap-2">
              <div className="w-11 h-11 rounded-full border border-white/25 grid place-items-center font-mono text-white/70">A</div>
              <div className="w-11 h-11 rounded-full border border-white/25 grid place-items-center font-mono text-white/70">B</div></div>
          </div>
        )}

        {/* WORLD MENU — expands DOWN from the header band */}
        {isNarrow && menu === 'world' && topbar && (
          <div className="absolute rounded-b-xl overflow-hidden shadow-2xl"
            style={{ left: topbar.rect.x + 6, top: topbar.rect.y + topbar.rect.h, width: Math.min(240, topbar.rect.w - 12), zIndex: 90, background: 'rgba(14,12,18,0.97)', border: '1px solid rgba(255,190,60,0.25)', borderTop: 'none' }}>
            {['⛶ PLAY', '? INSTRUCTIONS', '✎ EDIT', '⑂ FORK', '⚓ DOCK IN'].map(o => (
              <button key={o} className={menuItem} onClick={() => setMenu(null)}>{o}</button>
            ))}
          </div>
        )}

        {/* CAFE MENU — expands UP from the footer band */}
        {isNarrow && menu === 'cafe' && bottombar && (
          <div className="absolute rounded-t-xl overflow-hidden shadow-2xl"
            style={{ right: (dims!.w) - (bottombar.rect.x + bottombar.rect.w) + 6, bottom: (dims!.h) - bottombar.rect.y, width: Math.min(240, bottombar.rect.w - 12), zIndex: 90, background: 'rgba(14,12,18,0.97)', border: '1px solid rgba(255,190,60,0.25)', borderBottom: 'none' }}>
            {['↗ SHARE', '+ FOLLOW', '⌁ BUILDERBOX'].map(o => (
              <button key={o} className={menuItem} onClick={() => setMenu(null)}>{o}</button>
            ))}
          </div>
        )}
      </div>

      <button onClick={() => setPhone(p => !p)}
        className="fixed top-2 left-1/2 -translate-x-1/2 z-[999] font-mono text-[11px] tracking-[0.2em] px-3 py-1.5 rounded-full border border-emerald-300/50 text-emerald-200 bg-black/80 pointer-events-auto">
        {phone ? '◻ DESKTOP INSTANCE' : '▯ PHONE INSTANCE'}
      </button>
      <div className="fixed bottom-1 left-1/2 -translate-x-1/2 z-[999] font-mono text-[10px] tracking-[0.15em] text-white/40">
        {`reserved header + footer bands · menus expand FROM the bands · gate: ${gate ? 'PASS (overlaps: [])' : 'COLLIDE'}`}
      </div>
    </>
  )
}
