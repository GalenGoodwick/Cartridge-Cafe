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
const SHELL_DOC: UiGridDoc = {
  regions: [
    ...WORLD_PAGE_GRID.regions,
    { id: 'chrome.rail', layer: 'cafe', anchor: { vx: [0.858, 1], vy: [0.09, 0.93] }, z: 41, when: { viewport: { minW: 700 } } },   // clears the chair's deepened topbar (0.08) — gate-verified
  ],
}
import { LiveArt } from '@/app/cards/LiveArt'

// a self-contained backdrop visual (a slow aurora) — engine renders the mover
const BACKDROP = /* wgsl */`
fn visual_shell_bg(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let p = vec2f(uv.x, -uv.y);
  let wav = sin(p.x * 3.0 + time * 0.3) * cos(p.y * 4.0 - time * 0.22) * 0.5 + 0.5;
  var col = mix(vec3f(0.03, 0.035, 0.08), vec3f(0.12, 0.09, 0.24), wav);
  col += vec3f(0.4, 0.24, 0.6) * pow(max(0.0, 0.7 - length(p - vec2f(0.0, -0.25))), 3.0) * 1.5;
  col += vec3f(0.06, 0.05, 0.12) * sin(p.y * 9.0 + p.x * 3.0 + time * 0.6);
  return vec4f(col, 1.0);
}`

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

/** A region made visible + its tenants — the shell IS the grid. */
function Region({ r, children, art }: { r: SolvedRegion; children?: React.ReactNode; art?: boolean }) {
  const isGame = r.layer === 'game'
  return (
    <div
      className="fixed overflow-hidden"
      style={{
        left: r.rect.x, top: r.rect.y, width: r.rect.w, height: r.rect.h, zIndex: r.z,
        border: `1px dashed ${isGame ? 'rgba(80,200,255,0.35)' : 'rgba(255,190,60,0.35)'}`,
        background: isGame ? '#05060c' : 'rgba(20,16,10,0.55)',
        backdropFilter: isGame ? undefined : 'blur(2px)',
      }}
    >
      {art && <div className="absolute inset-0"><LiveArt wgsl={BACKDROP} hue={0.7} onFail={() => {}} /></div>}
      <span className="absolute top-1 left-2 font-mono text-[10px] tracking-[0.15em]"
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
      <span className={chip}>◂</span><span className="font-mono text-[13px] tracking-[0.15em] text-white/85">BASE · Galen</span>
      <span className={`${chip} ml-auto`}>⚓ DOCK IN</span></div>,
    'chrome.rail': <div className="absolute inset-0 flex flex-col items-end p-2 gap-1.5 pointer-events-none">
      <span className={chip}>⛶ PLAY</span><span className={chip}>? INSTRUCTIONS</span><span className={chip}>✎ EDIT</span></div>,
    'chrome.bottombar.right': <div className="absolute inset-0 flex items-center justify-end px-2 gap-2 pointer-events-none">
      <span className={chip}>+ FOLLOW</span><span className={chip}>↗ SHARE</span></div>,
    'chrome.bottombar.left': <div className="absolute inset-0 flex items-center px-2 pointer-events-none">
      <span className={chip}>⌁ BUILDERBOX</span></div>,
  }

  return (
    <div ref={wrapRef} className="fixed inset-0 bg-black"
      style={dims && phone ? { left: (window.innerWidth - dims.w) / 2, width: dims.w } : undefined}>
      {solved.filter(r => !r.slip).map(r => (
        <Region key={r.id} r={r} art={r.id === 'game.stage'}>{tenants[r.id]}</Region>
      ))}
      <button onClick={() => setPhone(p => !p)}
        className="fixed top-2 left-1/2 -translate-x-1/2 z-[999] font-mono text-[11px] tracking-[0.2em] px-3 py-1.5 rounded-full border border-emerald-300/50 text-emerald-200 bg-black/80 pointer-events-auto">
        {phone ? '◻ DESKTOP INSTANCE' : '▯ PHONE INSTANCE'}
      </button>
      <div className="fixed bottom-1 left-1/2 -translate-x-1/2 z-[999] font-mono text-[10px] tracking-[0.15em] text-white/40">
        {`the whole layout is solved from the doc — no hand CSS · gate: ${uiGridOverlaps(SHELL_DOC, solved).length === 0 ? "PASS (overlaps: [])" : "COLLIDE"}`}
      </div>
    </div>
  )
}
