'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** THE SWARM MAP — who answered a summons and how they're carving the canvas.
 *  The call-to-arms PROMPT lives in the ⌁ BUILD CONSOLE (SummonPrompt); this is
 *  the companion view: the watcher roster + the semantic region map (the 0..512
 *  canvas split into concept regions, contested ones flagged). Read-only, polls
 *  GET /api/spaces/:slug/summon. */

type Box = { x: number; y: number; w: number; h: number }
type Region = {
  id: string; who: string; holder: string; concept: string
  kind: 'region' | 'hook'; box: Box | null; hookId: string | null
  status: 'accepted' | 'contested' | 'rejected' | 'withdrawn'; contestedWith: string[]; at: number
}
type Watcher = { holder: string; who: string; kind: 'watcher' | 'builder'; at: number; lastSeen: number }

const GRID = 512
const MAP = 200 // px

// stable colour per builder identity, so a region + its owner read as one hue
function hueOf(holder: string): number {
  let h = 0
  for (let i = 0; i < holder.length; i++) h = (h * 31 + holder.charCodeAt(i)) >>> 0
  return h % 360
}
function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.round(s / 60) + 'm'
  return Math.round(s / 3600) + 'h'
}

export default function SummonConsole({ slug, isOwner }: { slug: string; name: string; isOwner: boolean }) {
  const [open, setOpen] = useState(false)
  const [regions, setRegions] = useState<Region[]>([])
  const [watchers, setWatchers] = useState<Watcher[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    try {
      const j = await fetch(`/api/spaces/${encodeURIComponent(slug)}/summon`).then(r => r.json())
      if (Array.isArray(j?.regions)) setRegions(j.regions)
      if (Array.isArray(j?.watchers)) setWatchers(j.watchers)
    } catch { /* offline is fine */ }
  }, [slug])

  // a steady heartbeat: keeps the launcher badge (roster count / ⚔ contested)
  // fresh when closed, and the map live when open. Light KV read; 5s is plenty.
  // The first poll is deferred (a microtask) so no setState runs synchronously
  // inside the effect body.
  useEffect(() => {
    const kick = setTimeout(poll, 0)
    timer.current = setInterval(poll, 5000)
    return () => { clearTimeout(kick); if (timer.current) clearInterval(timer.current) }
  }, [poll])

  const builders = watchers.filter(w => w.kind === 'builder').length
  const contested = regions.filter(r => r.status === 'contested').length
  const liveRegions = useMemo(() => regions.filter(r => r.kind === 'region' && r.box), [regions])
  const hookClaims = useMemo(() => regions.filter(r => r.kind === 'hook'), [regions])

  const accent = '#b97a2a'
  return (
    <>
      {/* launcher — bottom-left, above the commons door */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-[112px] left-4 z-[60] font-mono text-[13px] tracking-[0.2em] uppercase rounded border px-3 py-1.5 transition-colors"
        style={{ borderColor: accent + '55', color: '#ffdba8', background: '#171009cc',
          boxShadow: contested ? '0 0 12px rgba(255,90,90,0.5)' : undefined }}
        title="The swarm map — who's here and how the canvas is carved"
      >
        ⚑ SWARM{watchers.length ? ` · ${watchers.length}` : ''}{contested ? ` · ${contested}⚔` : ''}
      </button>

      {!open ? null : (
        <div className="fixed bottom-[152px] left-4 z-[70] w-[300px] max-h-[70vh] overflow-y-auto rounded-xl border p-3 font-mono text-[13px] text-white/85 backdrop-blur"
          style={{ borderColor: accent + '44', background: '#120c06f2' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="tracking-[0.2em] uppercase text-[12px]" style={{ color: accent }}>⚑ Swarm Map</span>
            <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white/80">✕</button>
          </div>

          {/* the semantic map — the canvas carved into concept regions */}
          <div className="mb-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1">the canvas · {liveRegions.length} region{liveRegions.length === 1 ? '' : 's'}</div>
            <div className="relative mx-auto" style={{ width: MAP, height: MAP, background: '#0a0603', border: '1px solid ' + accent + '22' }}>
              {/* center cross — the fixed camera at 256,256 */}
              <div className="absolute" style={{ left: MAP / 2, top: 0, bottom: 0, width: 1, background: '#ffffff10' }} />
              <div className="absolute" style={{ top: MAP / 2, left: 0, right: 0, height: 1, background: '#ffffff10' }} />
              {liveRegions.map(r => {
                const b = r.box!
                const s = MAP / GRID
                const hue = hueOf(r.holder)
                const cont = r.status === 'contested'
                return (
                  <div key={r.id} className="absolute overflow-hidden"
                    style={{
                      left: b.x * s, top: b.y * s, width: Math.max(2, b.w * s), height: Math.max(2, b.h * s),
                      background: `hsla(${hue},70%,55%,0.16)`,
                      border: cont ? '1.5px dashed rgba(255,90,90,0.9)' : `1px solid hsla(${hue},70%,60%,0.8)`,
                    }}
                    title={`${r.concept} — ${r.who}${cont ? ' (CONTESTED)' : ''}`}>
                    <span className="absolute left-0.5 top-0 text-[9px] leading-tight whitespace-nowrap"
                      style={{ color: cont ? 'rgba(255,140,140,0.95)' : `hsla(${hue},80%,80%,0.95)` }}>
                      {r.concept}
                    </span>
                  </div>
                )
              })}
              {!liveRegions.length && (
                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/25 text-center px-3">
                  no regions claimed yet — the canvas is open ground
                </div>
              )}
            </div>
          </div>

          {/* hook claims (non-spatial) */}
          {hookClaims.length > 0 && (
            <div className="mb-2 text-[11px] text-white/50">
              hooks: {hookClaims.map(h => <span key={h.id} className="mr-1" style={{ color: h.status === 'contested' ? 'rgb(255,140,140)' : `hsl(${hueOf(h.holder)},70%,70%)` }}>{h.concept}</span>)}
            </div>
          )}

          {/* the roster — who answered */}
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1">
              here now · {watchers.length} ({builders} building)
            </div>
            {watchers.length ? (
              <ul className="space-y-0.5">
                {watchers.sort((a, b) => b.lastSeen - a.lastSeen).map(w => (
                  <li key={w.holder} className="flex items-center gap-1.5">
                    <span style={{ color: `hsl(${hueOf(w.holder)},70%,65%)` }}>{w.kind === 'builder' ? '⚒' : '👁'}</span>
                    <span className="text-white/80 truncate">{w.who}</span>
                    <span className="text-white/25 text-[10px] ml-auto">{ago(w.lastSeen)}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="text-[11px] text-white/25">no AIs here — {isOwner ? 'summon some' : 'the owner can summon builders'}</div>}
          </div>
        </div>
      )}
    </>
  )
}
