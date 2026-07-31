// engine/InstructionsPanel.tsx — the ? INSTRUCTIONS card (view + owner edit),
// carved out of FieldEngine.tsx (DESIGN-fieldengine-carve.md, Phase 4).
// Pure move, byte-identical body.
'use client'

import type { Dispatch, SetStateAction, MutableRefObject } from 'react'
import type { FieldSimulation } from './simulation'
import { can, type WorldContext } from '@/lib/worldContext'

export function InstructionsPanel({ playScene, ctx, instrEdit, setInstrEdit, instrDraft, setInstrDraft, setInstrOpen, simulationRef }: {
  playScene?: string
  ctx: WorldContext
  instrEdit: boolean
  setInstrEdit: Dispatch<SetStateAction<boolean>>
  instrDraft: string
  setInstrDraft: Dispatch<SetStateAction<string>>
  setInstrOpen: Dispatch<SetStateAction<boolean>>
  simulationRef: MutableRefObject<FieldSimulation | null>
}) {
  return (
            <div className={`absolute z-50 ${playScene === 'CAFE' || playScene === 'SUB-MAIN' ? 'top-28' : 'top-14'}`}
              style={{ right: 'max(1rem, calc((100% - 100vh) / 2 + 1rem))' }}>{/* the GRID's top-right — the world square is aspect-fit; on wide screens right-36 sat by the chat rail (Galen) */}
              {/* anchored to the grid's top-right under its button — a reference
                  card, not a curtain: the vote rail and the world stay visible
                  and clickable while it's open (✕ or ESC closes) */}
              {/* header bar (title + EDIT + ✕) is PINNED; the body below scrolls,
                  so the title and close stay visible however long the text runs */}
              <div
                className="w-[380px] max-w-[80vw] max-h-[62vh] flex flex-col overflow-hidden rounded-xl border border-white/15 bg-black/90 backdrop-blur font-mono text-white/85 shadow-[0_8px_40px_rgba(0,0,0,0.55)]"
              >
                <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-white/10 bg-black/90 flex-shrink-0">
                  <div className="text-[16px] tracking-[0.25em] text-white/50">INSTRUCTIONS</div>
                  <div className="flex items-center gap-2">
                    {can(ctx, 'editLaw') && !instrEdit && (
                      <>
                        <button
                          className="text-[14px] tracking-[0.15em] text-white/50 hover:text-white border border-white/15 rounded px-2 py-0.5 transition-colors"
                          onClick={() => { setInstrDraft(String(simulationRef.current?.worldData?.instructions || '')); setInstrEdit(true) }}
                        >
                          EDIT
                        </button>
                      </>
                    )}
                    <button
                      aria-label="Close instructions"
                      className="w-6 h-6 rounded text-white/60 hover:text-white hover:bg-white/10 text-[18px] leading-none transition-colors"
                      onClick={() => { setInstrOpen(false); setInstrEdit(false) }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="min-h-0 overflow-y-auto px-5 py-4 text-[18px] leading-relaxed">
                {instrEdit ? (
                  <>
                    <textarea
                      value={instrDraft}
                      onChange={e => setInstrDraft(e.target.value)}
                      rows={10}
                      className="w-full bg-black/60 border border-white/15 rounded-lg p-3 text-[18px] font-mono text-white/85 outline-none focus:border-white/35"
                      placeholder={'Key entry first, one per line:\nWASD — move · SPACE — dash · CLICK — select\n\nThen the point: what the player is trying to do, and what winning is.'}
                    />
                    <div className="flex gap-2 mt-3 justify-end">
                      <button className="text-[14px] tracking-[0.15em] text-white/50 hover:text-white px-2 py-1" onClick={() => setInstrEdit(false)}>CANCEL</button>
                      <button
                        className="text-[14px] tracking-[0.15em] bg-white/10 hover:bg-white/20 border border-white/20 rounded px-3 py-1 transition-colors"
                        onClick={() => { const s = simulationRef.current; if (s) s.worldData.instructions = instrDraft; setInstrEdit(false) }}
                      >
                        SAVE
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="whitespace-pre-line">
                    {String(simulationRef.current?.worldData?.instructions ||
                      ((simulationRef.current?.fields?.size ?? 0) === 0
                        ? 'This world is BLANK — here is how to make it real:\n\n1 · ⚡ CONNECT AI — copy the briefing to any AI and tell it what to build. It works over plain HTTP; the world updates live.\n2 · Or build by hand in the workshop tools (⚙).\n3 · The world saves itself as you make it. The moment it is not blank, it joins the cafe\u2019s main screen.\n\nWrite these instructions properly (EDIT, above) once your world knows what it is: key entry first, then the point.'
                        : 'No instructions written for this world yet.'))}
                  </div>
                )}
                </div>
              </div>
            </div>
  )
}
