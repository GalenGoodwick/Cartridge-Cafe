'use client'

// ═══ THE ONE GRID (Galen, Aug 28) ═══
// "The reckoning and old main used to be a grid. Put the responsive grid front
// and center — everything flows around it. Everything is loaded into one
// shader. Engine toggle brings in the tools from outside. We only have ONE
// grid ever; the grid itself resizes based on game."
//
// ONE persistent FieldEngine, mounted once, NEVER torn down:
//   HOME  — the catalog drawn INSIDE the engine (ui-solver glass pills over the
//           ONE-HOME starfield cartridge). Picking a world hot-swaps it into
//           the SAME canvas (the in-place scene swap CafeShell pioneered).
//   PLAY  — a bottom selection bar flows in: tabs + back to the grid.
//   ENGINE— tools dock in from outside; a dockstar (▣) in the top bar opens
//           config. The grid itself is untouched at center.
//   LINK  — ?w=<slug> serializes the view; every state is shareable.
import { useCallback, useEffect, useMemo, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'
import { useShellHost } from '@/app/engine/useShellHost'
import { useAppMode } from '@/app/engine/app-mode'
import ModeToggle from '@/app/ModeToggle'
import type { UiNode } from '@/app/engine/ui-solver'
import { SHELL_GLASS, shellAction } from '@/app/engine/ui-blocks'

type Entry = { slug: string; name: string; premium?: boolean }
const HOME = 'ONE-HOME'

export default function OneGrid() {
  const { mode } = useAppMode()
  const engine = mode === 'engine'
  // THE ONE SCENE — 'ONE-HOME' or 'space:<slug>'. Changing it hot-swaps the
  // world INTO the same engine; the component never remounts.
  const [scene, setScene] = useState<string>(HOME)
  const [tab, setTab] = useState<'published' | 'premium'>('published')
  const [entries, setEntries] = useState<Entry[]>([])
  const [cfgOpen, setCfgOpen] = useState(false)
  const atHome = scene === HOME

  // linkable: read ?w= on arrival, write it on every swap
  useEffect(() => {
    try {
      const w = new URL(window.location.href).searchParams.get('w')
      if (w) setScene(w.startsWith('space:') || w === HOME ? w : 'space:' + w)
    } catch { /* ssr */ }
  }, [])
  const go = useCallback((next: string) => {
    setScene(next)
    try {
      const u = new URL(window.location.href)
      if (next === HOME) u.searchParams.delete('w'); else u.searchParams.set('w', next.replace(/^space:/, ''))
      window.history.pushState(null, '', u.toString())
    } catch { /* fine */ }
  }, [])
  useEffect(() => {
    const onPop = () => {
      try {
        const w = new URL(window.location.href).searchParams.get('w')
        setScene(w ? (w === HOME ? HOME : 'space:' + w) : HOME)
      } catch { /* fine */ }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // the catalog feed for the grid (local fallback: the bundled cartridges)
  useEffect(() => {
    fetch(`/api/cards?tab=${tab}`).then(r => r.json())
      .then((d: { cards?: Array<{ slug: string; name: string }> }) => {
        if (Array.isArray(d.cards) && d.cards.length) setEntries(d.cards.map(c => ({ slug: c.slug, name: c.name })))
        else setEntries([{ slug: 'CINDERFELL', name: 'CINDERFELL' }])
      })
      .catch(() => setEntries([{ slug: 'CINDERFELL', name: 'CINDERFELL' }]))
  }, [tab])

  // ── THE CATALOG AS ENGINE PIXELS — glass pills laid as a responsive grid of
  // ui-solver nodes (the reckoning's grid, reborn in the one shader). Clicks
  // ride the shell: namespace; the host swaps the scene. ──
  const [win, setWin] = useState({ w: 1200, h: 800 })
  useEffect(() => {
    const m = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])
  const homeUi = useMemo<UiNode[] | null>(() => {
    if (!atHome) return null
    const scale = 512 / Math.min(win.w, win.h)
    const dvw = win.w * scale, dvh = win.h * scale
    const TILE_W = 120, TILE_H = 26, GAP = 10
    const cols = Math.max(1, Math.floor((dvw - 40) / (TILE_W + GAP)))
    const nodes: UiNode[] = [{
      id: 'one.title', kind: 'text', text: 'CARTRIDGE.CAFE', fontSize: 16, color: 'rgba(255,219,168,0.95)',
      anchor: { vx: 0.5, vy: 26 / dvh }, align: 'tc',
    } as UiNode]
    entries.slice(0, cols * 8).forEach((e, i) => {
      const r = Math.floor(i / cols), c = i % cols
      const gridW = cols * (TILE_W + GAP) - GAP
      const x0 = (dvw - gridW) / 2 + c * (TILE_W + GAP)
      const y0 = 60 + r * (TILE_H + GAP)
      nodes.push({
        id: `one.w.${e.slug}`, kind: 'panel', pad: 6, w: TILE_W, glass: SHELL_GLASS,
        click: shellAction(`open:${e.slug}`), draggable: false, collapsible: false,
        anchor: { vx: x0 / dvw, vy: y0 / dvh }, align: 'tl',
        children: [{ id: `one.w.${e.slug}.t`, kind: 'text', text: e.name.toUpperCase().slice(0, 16), fontSize: 10, color: 'rgba(236,235,242,0.92)' }],
      })
    })
    return nodes
  }, [atHome, entries, win])
  // in-world: one thin pill back to the grid (engine pixels, same seam)
  const worldUi = useMemo<UiNode[]>(() => ([{
    id: 'one.back', kind: 'panel', pad: 7, glass: SHELL_GLASS,
    click: shellAction('grid'), draggable: false, collapsible: false,
    anchor: { vx: 0.012, vy: 0.012 }, align: 'tl',
    children: [{ id: 'one.back.t', kind: 'text', text: '< GRID', fontSize: 12, color: 'rgba(236,235,242,0.92)' }],
  }]), [])

  // shell actions: open:<slug> swaps a world in; grid returns home
  const lastAction = useShellHost()
  useEffect(() => {
    if (!lastAction.startsWith('shell:')) return
    const a = lastAction.slice(6)
    if (a === 'grid') go(HOME)
    else if (a.startsWith('open:')) {
      const slug = a.slice(5)
      go(slug === 'CINDERFELL' ? 'CINDERFELL' : 'space:' + slug)   // local cartridge vs live world
    }
  }, [lastAction, go])

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#04050b' }}>
      {/* ═ THE ONE GRID — one engine, mounted once, worlds hot-swap in ═ */}
      <FieldEngine playScene={scene} shellUi={atHome ? homeUi : worldUi} hooksTrusted externalTopbar mobilePlay={!engine} />

      {/* ── TOP BAR (flows around the grid, never in it) ── */}
      <div className="fixed top-0 inset-x-0 z-[120] flex items-center gap-2 px-3 py-2 pointer-events-none">
        <span className="font-mono text-[12px] tracking-[0.2em] text-white/40">THE ONE GRID</span>
        <div className="ml-auto pointer-events-auto"><ModeToggle compact /></div>
        {engine && (
          <button onClick={() => setCfgOpen(o => !o)} aria-label="config"
            className={`pointer-events-auto w-9 h-9 grid place-items-center rounded-xl border text-[15px] ${cfgOpen ? 'bg-amber-400/20 border-amber-300/60 text-amber-100' : 'bg-black/50 border-white/12 text-white/70'}`}
            title="dockstar — config">▣</button>
        )}
      </div>

      {/* ── ENGINE: the dockstar config (tools dock in FROM OUTSIDE) ── */}
      {engine && cfgOpen && (
        <div className="fixed top-14 right-3 z-[125] w-72 rounded-2xl border border-amber-300/25 bg-[#12100a]/97 backdrop-blur p-4 font-mono">
          <div className="text-[12px] tracking-[0.25em] text-amber-200/80 mb-2">▣ DOCKSTAR</div>
          <div className="text-[11px] text-white/50 leading-relaxed">
            <div className="mb-1">scene: <span className="text-white/85">{scene}</span></div>
            <div className="mb-3">mode: <span className="text-white/85">{mode}</span></div>
            <button onClick={async () => { try { await navigator.clipboard.writeText(window.location.href) } catch { /* ignore */ } }}
              className="w-full text-left px-3 py-2 rounded-lg border border-white/12 text-white/70 hover:bg-white/5">⧉ copy link to this view</button>
            <div className="mt-3 text-white/30">engine tools dock here — the grid stays at center.</div>
          </div>
        </div>
      )}

      {/* ── PLAY: the bottom SELECTION BAR (slips in; tabs + grid nav) ── */}
      {!engine && (
        <div className="fixed bottom-0 inset-x-0 z-[120] flex items-center gap-2 px-3 pointer-events-none"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 10px)', paddingTop: 8 }}>
          {!atHome && (
            <button onClick={() => go(HOME)}
              className="pointer-events-auto font-mono text-[12px] tracking-[0.15em] px-3.5 py-2 rounded-xl bg-black/60 backdrop-blur border border-white/12 text-white/85 active:bg-black/80">
              ◱ GRID
            </button>
          )}
          {atHome && (['published', 'premium'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`pointer-events-auto font-mono text-[12px] tracking-[0.15em] px-3.5 py-2 rounded-xl backdrop-blur border ${tab === t ? 'bg-emerald-400/15 border-emerald-300/50 text-emerald-100' : 'bg-black/50 border-white/12 text-white/50'}`}>
              {t === 'published' ? '▶ GAMES' : '✦ PREMIUM'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
