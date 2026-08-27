// engine/WorldToolsPanel.tsx — the WORLD TOOLS panel (law toggles, lineage,
// space management, delete door), carved out of FieldEngine.tsx
// (DESIGN-fieldengine-carve.md, Phase 4). Pure move, byte-identical body.
'use client'

import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction, MutableRefObject } from 'react'
import { can, type WorldContext } from '@/lib/worldContext'
import type { FieldSimulation } from './simulation'
import SpaceManagementOverlay from './SpaceManagementOverlay'

export function WorldToolsPanel({ simulationRef, spaceId, spaceSlug, isOwner, lastSceneRef, setChromeVisible, ctx, presenceOff, setPresenceOff, presenceOffRef, setToolsTick, lineageBase, loadLineage, lineageBusy, lineageTrail, lineageRemixes }: {
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
                  {canEditLaw && (
                  <div className="flex items-center justify-between text-[16px]">
                    <span>allow forking</span>
                    {toggleBtn(wd?.['forkable'] === true, () => {
                      const sim = simulationRef.current
                      if (!sim) return
                      // FORKABILITY IS OPT-IN (Galen): no fork button, no fork
                      // route, unless the maker enables it here. Off by default.
                      sim.worldData['forkable'] = sim.worldData['forkable'] === true ? false : true
                      persistBranchRules()
                      setToolsTick(n => n + 1)
                    })}
                  </div>
                  )}
                  {/* THE SOCIAL CONTRACT (world-policy): declared ONCE, then
                      immutable — changing the deal on people mid-world isn't
                      fair (Galen). Undeclared worlds run the default (owner
                      builds, everyone plays); invited crew always keep their
                      keys regardless. The dropdowns write worldData.policy;
                      the server's mayWritePolicy admits only the FIRST set. */}
                  {spaceId && (() => {
                    const pol = wd?.['policy'] as { build?: string; play?: string } | undefined
                    const declared = !!(pol && typeof pol === 'object' && pol.build)
                    if (declared) return (
                      <div className="flex items-center justify-between text-[16px]">
                        <span>social contract</span>
                        <span className="px-2 py-0.5 rounded-full border border-white/15 text-[13px] tracking-[0.1em] text-white/50"
                          title="declared once at the start — immutable, so the deal never changes on the people already building here">
                          build: {pol.build} · play: {pol.play ?? 'everyone'} · sealed
                        </span>
                      </div>
                    )
                    if (!canEditLaw) return null
                    return (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[16px]">
                          <span>social contract</span>
                          <span className="text-[13px] text-white/35">undeclared · default</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[13px]">
                          {(['owner', 'invited', 'anyone'] as const).map(b => (
                            <button key={b}
                              onClick={() => {
                                const sim = simulationRef.current; if (!sim) return
                                if (!window.confirm(`declare the contract: BUILD = ${b}, PLAY = everyone?\n\nThis is PERMANENT — the deal never changes on people once they're building here.`)) return
                                sim.worldData['policy'] = { build: b, play: 'everyone' }
                                setToolsTick(n => n + 1)
                              }}
                              className="px-2 py-0.5 rounded-full border border-white/20 text-white/55 hover:border-emerald-300/50 hover:text-emerald-200 transition-colors">
                              build: {b}
                            </button>
                          ))}
                        </div>
                        <div className="text-[13px] text-white/30 leading-snug">
                          who may build here — declared ONCE, then sealed. owner = just you (+ anyone you invite); invited = your crew; anyone = open ground.
                        </div>
                      </div>
                    )
                  })()}
                  {/* THE CARD (Galen: "does a world have a config button?") —
                      the owner sets what the catalog says: KIND (or auto — the
                      anatomy decides), TYPE (from the vocabulary), tags, the
                      blurb, and the STORY (vision). Writes land on worldData
                      and persist with the world; the card feed serves them. */}
                  {spaceId && canEditLaw && <CardConfig simulationRef={simulationRef} setToolsTick={setToolsTick} />}
                  {/* winner-takes-main RETIRED with the podium (branch→fork
                      transition): world votes no longer exist, so no challenger
                      can win — or take — anything. Your main is simply yours. */}
                  <div className="text-[14px] text-white/35 leading-relaxed">
                    {canEditLaw
                      ? "multiplayer is the world's law — saved with it. presence is your own eyes: off means invisible both ways. restart lets any player press R to send the world back to its start. allow forking puts the FORK button on your world — anyone may take their own copy (off = your world cannot be forked)."
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
                {/* (✕ delete this world REMOVED from world tools — Galen, Aug 27:
                    deletion lives on YOUR ACCOUNT page (/mine) with the game
                    list; co-built worlds are protected there.) */}
              </div>
            )
}


/** THE CARD config — kind/type/tags/blurb/story, owner-editable. Values write
 *  straight onto sim.worldData (the tab's 2s sync persists them); kind AUTO
 *  removes the declaration so the anatomy decides (deriveKind). */
function CardConfig({ simulationRef, setToolsTick }: {
  simulationRef: MutableRefObject<FieldSimulation | null>
  setToolsTick: Dispatch<SetStateAction<number>>
}) {
  const sim = simulationRef.current
  const wd = sim?.worldData as Record<string, unknown> | undefined
  const card = (wd?.card && typeof wd.card === 'object' ? wd.card : {}) as { type?: string; tags?: string[]; kind?: string }
  const [types, setTypes] = useState<Array<{ id: string; label: string }>>([])
  const [tagsDraft, setTagsDraft] = useState((card.tags ?? []).join(', '))
  const [blurbDraft, setBlurbDraft] = useState(typeof wd?.blurb === 'string' ? wd.blurb : '')
  const [storyDraft, setStoryDraft] = useState(typeof wd?.vision === 'string' ? wd.vision : '')
  useEffect(() => {
    fetch('/api/cards?types=1').then(r => r.json()).then(d => setTypes(d.types ?? [])).catch(() => {})
  }, [])
  const writeCard = (patch: Record<string, unknown>) => {
    const s2 = simulationRef.current; if (!s2) return
    const cur = (s2.worldData['card'] && typeof s2.worldData['card'] === 'object' ? s2.worldData['card'] : {}) as Record<string, unknown>
    const next = { ...cur, ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    s2.worldData['card'] = next
    setToolsTick(n => n + 1)
  }
  const kindNow = card.kind === 'toy' || card.kind === 'world' || card.kind === 'game' ? card.kind : 'auto'
  return (
    <div className="space-y-2 pt-1">
      <div className="text-[14px] tracking-[0.2em] text-white/40">THE CARD</div>
      <div className="flex items-center gap-1.5 text-[13px]">
        {(['auto', 'toy', 'world', 'game'] as const).map(k => (
          <button key={k}
            onClick={() => writeCard({ kind: k === 'auto' ? undefined : k })}
            title={k === 'auto' ? 'the anatomy decides: rules built → game; multiplayer/big grid → world; else toy' : k}
            className={`px-2 py-0.5 rounded-full border transition-colors ${kindNow === k
              ? 'border-amber-300/60 bg-amber-400/15 text-amber-200'
              : 'border-white/20 text-white/50 hover:text-white'}`}>
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      <select value={card.type ?? ''}
        onChange={e => writeCard({ type: e.target.value || undefined })}
        className="w-full bg-black/50 border border-white/15 rounded px-2 py-1.5 text-[14px] text-white/80 outline-none focus:border-amber-300/50">
        <option value="">type… (the vocabulary)</option>
        {types.map(t => <option key={t.id} value={t.id}>{t.label ?? t.id}</option>)}
      </select>
      <input value={tagsDraft} onChange={e => setTagsDraft(e.target.value)}
        onBlur={() => writeCard({ tags: tagsDraft.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) })}
        placeholder="tags, comma, separated"
        className="w-full bg-black/50 border border-white/15 rounded px-2 py-1.5 text-[14px] text-white/80 placeholder:text-white/25 outline-none focus:border-amber-300/50" />
      <input value={blurbDraft} onChange={e => setBlurbDraft(e.target.value)}
        onBlur={() => { const s2 = simulationRef.current; if (s2) { s2.worldData['blurb'] = blurbDraft.trim(); setToolsTick(n => n + 1) } }}
        placeholder="the blurb — one line the card shows"
        className="w-full bg-black/50 border border-white/15 rounded px-2 py-1.5 text-[14px] text-white/80 placeholder:text-white/25 outline-none focus:border-amber-300/50" />
      <textarea value={storyDraft} onChange={e => setStoryDraft(e.target.value)}
        onBlur={() => { const s2 = simulationRef.current; if (s2) { s2.worldData['vision'] = storyDraft.trim(); setToolsTick(n => n + 1) } }}
        placeholder="the story (vision) — what this world IS; the desc falls back to its first line"
        rows={3}
        className="w-full bg-black/50 border border-white/15 rounded px-2 py-1.5 text-[13px] leading-snug text-white/80 placeholder:text-white/25 outline-none focus:border-amber-300/50 resize-y" />
      <div className="text-[12px] text-white/30 leading-snug">
        instructions have their own door — the ? INSTRUCTIONS panel. Everything here lands on the card the catalog deals.
      </div>
    </div>
  )
}