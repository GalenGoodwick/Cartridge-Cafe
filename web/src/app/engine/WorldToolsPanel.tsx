// engine/WorldToolsPanel.tsx — the WORLD TOOLS panel (law toggles, lineage,
// space management, delete door), carved out of FieldEngine.tsx
// (DESIGN-fieldengine-carve.md, Phase 4). Pure move, byte-identical body.
'use client'

import type { Dispatch, SetStateAction, MutableRefObject } from 'react'
import { can, type WorldContext } from '@/lib/worldContext'
import type { FieldSimulation } from './simulation'
import SpaceManagementOverlay from './SpaceManagementOverlay'

export function WorldToolsPanel({ simulationRef, spaceId, spaceSlug, isOwner, lastSceneRef, setChromeVisible, ctx, presenceOff, setPresenceOff, presenceOffRef, setToolsTick, lineageBase, winnerTakesMain, setWinnerTakesMain, loadLineage, lineageBusy, lineageTrail, lineageRemixes }: {
  simulationRef: MutableRefObject<FieldSimulation | null>
  spaceId?: string
  spaceSlug?: string
  isOwner?: boolean
  lastSceneRef: MutableRefObject<string>
  setChromeVisible: Dispatch<SetStateAction<boolean>>
  ctx: WorldContext
  presenceOff: boolean
  setPresenceOff: Dispatch<SetStateAction<boolean>>
  presenceOffRef: MutableRefObject<boolean>
  setToolsTick: Dispatch<SetStateAction<number>>
  lineageBase: string
  winnerTakesMain: boolean
  setWinnerTakesMain: Dispatch<SetStateAction<boolean>>
  loadLineage: () => void
  lineageBusy: boolean
  lineageTrail: null | { name: string; by?: string | null; kind: string; slug?: string }[]
  lineageRemixes: { name: string; slug: string }[]
}) {
            const wd = simulationRef.current?.worldData
            const mp = !(wd?.['singlePlayer'] === true || wd?.['multiplayer'] === false)
            const canEditLaw = can(ctx, 'editLaw')
            // branch rules persist per-branch (same slot the legacy chip row used)
            const persistBranchRules = () => {
              if (spaceId) return
              const s = simulationRef.current; if (!s) return
              fetch('/api/engine/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot: 'world-settings:' + (lastSceneRef.current || ''), data: {
                  multiplayer: s.worldData.multiplayer, singlePlayer: s.worldData.singlePlayer, rResetKey: !!s.worldData.rResetKey } }) }).catch(() => {})
            }
            const toggleBtn = (on: boolean, onClick: () => void) => (
              <button onClick={onClick}
                className={`px-2 py-0.5 rounded-full border text-[14px] tracking-[0.15em] transition-colors ${on
                  ? 'bg-emerald-400/20 border-emerald-300/50 text-emerald-200'
                  : 'bg-white/5 border-white/15 text-white/40'}`}>
                {on ? 'ON' : 'OFF'}
              </button>
            )
            return (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 max-h-[82vh] overflow-y-auto rounded-xl bg-black/80 backdrop-blur border border-white/10 font-mono text-white/80 shadow-2xl">
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 text-[14px] tracking-[0.25em] text-white/50">
                  <span>WORLD TOOLS</span>
                  <button onClick={() => setChromeVisible(false)} aria-label="close" className="text-white/40 hover:text-white text-sm leading-none px-1">×</button>
                </div>
                {/* one toolbox: name/visibility/share/tokens live here too */}
                {isOwner && spaceSlug && spaceId && (
                  <SpaceManagementOverlay
                    embedded
                    spaceSlug={spaceSlug}
                    spaceId={spaceId}
                  />
                )}
                <div className="px-3 py-2.5 space-y-2.5 border-b border-white/10">
                  {canEditLaw && (
                  <div className="flex items-center justify-between text-[16px]">
                    <span>multiplayer</span>
                    {toggleBtn(mp, () => {
                      const sim = simulationRef.current
                      if (!sim) return
                      sim.worldData['multiplayer'] = !mp
                      sim.worldData['singlePlayer'] = mp
                      persistBranchRules()
                      setToolsTick(n => n + 1)
                    })}
                  </div>
                  )}
                  <div className="flex items-center justify-between text-[16px]">
                    <span>player presence</span>
                    {toggleBtn(!presenceOff, () => {
                      const v = !presenceOff
                      setPresenceOff(v); presenceOffRef.current = v
                      try { if (v) localStorage.setItem('cc-presence-off', '1'); else localStorage.removeItem('cc-presence-off') } catch { /* fine */ }
                    })}
                  </div>
                  {canEditLaw && (
                  <div className="flex items-center justify-between text-[16px]">
                    <span>restart with R</span>
                    {toggleBtn(!!wd?.['rResetKey'], () => {
                      const sim = simulationRef.current
                      if (!sim) return
                      sim.worldData['rResetKey'] = !sim.worldData['rResetKey']
                      persistBranchRules()
                      setToolsTick(n => n + 1)   // spaces persist with the snapshot; branches via world-settings slot
                    })}
                  </div>
                  )}
                  {/* OPT-IN OVERTURN — by default a challenger winning the vote only
                      earns a podium; your main stays yours. Flip this and the
                      popular winner takes main automatically. Owner-gated server-side. */}
                  {canEditLaw && lineageBase && (
                  <div className="flex items-center justify-between text-[16px]">
                    <span>winner takes main</span>
                    {toggleBtn(winnerTakesMain, async () => {
                      const next = !winnerTakesMain
                      setWinnerTakesMain(next)
                      const r = await fetch('/api/engine/lineage/main-rule', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ base: lineageBase, winnerTakesMain: next }),
                      }).catch(() => null)
                      if (!r || !r.ok) setWinnerTakesMain(!next)   // revert on failure
                    })}
                  </div>
                  )}
                  <div className="text-[14px] text-white/35 leading-relaxed">
                    {canEditLaw
                      ? "multiplayer is the world's law — saved with it. presence is your own eyes: off means invisible both ways. restart lets any player press R to send the world back to its start. winner-takes-main hands the throne to a challenger that wins the vote — off by default, so your main stays yours (a win is only a podium)."
                      : 'presence is your own eyes: off means invisible both ways. the rest of the panel belongs to the owner.'}
                  </div>
                </div>
                {/* LINEAGE — where this world came from. Anyone can see it; credit follows the work. */}
                <div className="px-3 py-2.5 border-b border-white/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[14px] tracking-[0.2em] text-white/40">LINEAGE</div>
                    <button
                      onClick={loadLineage} disabled={lineageBusy}
                      title="trace this world back to the original it grew from"
                      className="px-2 py-0.5 rounded-full border text-[14px] tracking-[0.15em] border-white/25 text-white/70 hover:border-emerald-300/60 hover:text-emerald-200 transition-colors disabled:opacity-50">
                      {lineageBusy ? '…' : (lineageTrail ? '↻ TRAIL' : '≡ TRAIL')}
                    </button>
                  </div>
                  {lineageTrail && (
                    lineageTrail.length <= 1 ? (
                      <div className="text-[14px] text-white/35 leading-relaxed">an original — nothing upstream of it.</div>
                    ) : (
                      <div className="space-y-0.5">
                        {lineageTrail.map((n, i) => {
                          const here = i === lineageTrail.length - 1
                          const label = n.kind === 'root' ? n.name : (n.by ? `⑂ ${n.by}` : n.name)
                          return (
                            <div key={i} className={`text-[14px] leading-snug ${here ? 'text-amber-200/90' : 'text-white/55'}`}>
                              <span className="text-white/25">{i === 0 ? '● ' : '↳ '}</span>
                              {n.slug ? (
                                <a href={`/space/${n.slug}`} className="underline decoration-white/20 hover:decoration-emerald-300">{label}</a>
                              ) : label}
                              {here && <span className="text-white/35"> · here</span>}
                            </div>
                          )
                        })}
                      </div>
                    )
                  )}
                  {lineageTrail && lineageRemixes.length > 0 && (
                    <div className="pt-1 space-y-0.5">
                      <div className="text-[14px] text-white/30">{lineageRemixes.length} remix{lineageRemixes.length === 1 ? '' : 'es'} grew from this →</div>
                      {lineageRemixes.map(rx => (
                        <div key={rx.slug} className="text-[14px] leading-snug text-white/55">
                          <span className="text-white/25">↳ </span>
                          <a href={`/space/${rx.slug}`} className="underline decoration-white/20 hover:decoration-emerald-300">{rx.name}</a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* DIRECT EDIT KEYS removed — CONNECT AI / ALTER already mints the
                    world + branch keys, so a second door here only confused people.
                    CONTENTS (raw field list) removed too — dev-only clutter. */}
                {isOwner && (
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent('cafe:delete-world'))}
                    className="w-full text-left px-3 py-2 border-t border-white/10 text-[16px] text-red-300/70 hover:text-red-300 hover:bg-red-500/10 transition-colors">
                    ✕ delete this world
                  </button>
                )}
              </div>
            )
}
