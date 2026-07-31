// engine/BranchesPanel.tsx — the ⑂ BRANCHES cell (podium, ride, per-branch
// discussion), carved out of FieldEngine.tsx (DESIGN-fieldengine-carve.md,
// Phase 4). Pure move, byte-identical body.
'use client'

import type { Dispatch, SetStateAction, MutableRefObject } from 'react'

export type CellDoc = { viewers: Record<string, number>; discussion: Record<string, Array<{ who: string; text: string; at: number }>> }

export function BranchesPanel({ cellBase, cellData, setCellData, cellDraft, setCellDraft, saveCellDoc, whoRef, setBranchesOpen, branchList, handleLoadScene, spaceSlug, discOpen, setDiscOpen }: {
  cellBase: () => string
  cellData: CellDoc
  setCellData: Dispatch<SetStateAction<CellDoc>>
  cellDraft: string
  setCellDraft: Dispatch<SetStateAction<string>>
  saveCellDoc: (doc: CellDoc) => void
  whoRef: MutableRefObject<string>
  setBranchesOpen: Dispatch<SetStateAction<boolean>>
  branchList: Array<{ name: string; author: string; v: number }>
  handleLoadScene: (sceneName: string) => void
  spaceSlug?: string
  discOpen: string | null
  setDiscOpen: Dispatch<SetStateAction<string | null>>
}) {
            const base = cellBase()
            const viewers = Object.keys(cellData.viewers)   // presence only — the vote lives in the ⚔ reckoning
            const say = (author: string) => {
              const text = cellDraft.trim()
              if (!text) return
              const doc: CellDoc = JSON.parse(JSON.stringify(cellData))
              doc.discussion[author] = [...(doc.discussion[author] || []), { who: whoRef.current, text, at: Date.now() }].slice(-50)
              saveCellDoc(doc); setCellData(doc); setCellDraft('')
            }
            return (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBranchesOpen(false)}>
                <div className="max-w-md w-[92%] max-h-[76%] overflow-y-auto rounded-xl border border-white/15 bg-black/85 backdrop-blur p-5 font-mono text-[17px] text-white/85" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[16px] tracking-[0.25em] text-white/50">⑂ BRANCHES OF {base.toUpperCase()}</div>
                    <button aria-label="Close" className="text-white/40 hover:text-white text-[18px] leading-none px-1.5 py-0.5 rounded border border-white/10 hover:border-white/30 transition-colors" onClick={() => setBranchesOpen(false)}>✕</button>
                  </div>
                  <div className="flex items-center gap-2 mb-3 text-[14px] text-white/40">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                    <span>{viewers.length} here now</span>
                    <span className="text-white/25">· ride, discuss — cast your vote in the ⚔ reckoning</span>
                  </div>
                  {/* THE PODIUM — above main and the branches. The elected winner's
                      frozen copy rides from here; main always stays the maker's. */}
                  {(() => {
                    const podium = branchList.find(bb => bb.author === 'winner' || bb.author.startsWith('winner · '))
                    if (podium) {
                      const of = String(podium.author.split(' · ').slice(1).join(' · ') || '')
                      return (
                        <button className="w-full text-left px-3 py-2 rounded-lg border border-amber-300/40 bg-amber-400/10 hover:bg-amber-400/20 transition-colors mb-1.5"
                          onClick={() => { setBranchesOpen(false); handleLoadScene(podium.name) }}>
                          <span className="text-amber-200">⚔ WINNER</span>
                          <span className="text-white/45 text-[14px]"> — the vote's champion{of ? ` (${of})` : ''} · v{podium.v} · ride it</span>
                        </button>
                      )
                    }
                    return (
                      <div className="w-full px-3 py-2 rounded-lg border border-white/10 border-dashed mb-1.5">
                        <span className="text-white/35">⚔ no winner yet</span>
                        <span className="text-white/25 text-[14px]"> — the vote decides; the champion stands here</span>
                      </div>
                    )
                  })()}
                  <button className="w-full text-left px-3 py-2 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/5 transition-colors mb-1.5" onClick={() => {
                    setBranchesOpen(false)
                    // on a space, "main" is the space's own snapshot, not a scene named
                    // after the slug — the scene store has no such entry, so returning to
                    // the space page reloads main. (Play worlds keep the scene load.)
                    if (spaceSlug) { window.location.href = `/space/${encodeURIComponent(spaceSlug)}` }
                    else { handleLoadScene(base) }
                  }}>
                    <span className="text-emerald-300/90">main</span>
                    <span className="text-white/40 text-[14px]"> — the world as it stands</span>
                  </button>
                  {branchList.filter(bB => bB.author !== 'winner' && !bB.author.startsWith('winner · ')).map(bB => {
                    const chat = cellData.discussion[bB.author] || []
                    return (
                      <div key={bB.name} className="rounded-lg border border-white/10 mb-1.5">
                        <div className="flex items-center">
                          <button className="flex-1 text-left px-3 py-2 hover:bg-white/5 transition-colors" onClick={() => { setBranchesOpen(false); handleLoadScene(bB.name) }}>
                            <span className="text-amber-200/90">⑂ {bB.author}</span>
                            <span className="text-white/40 text-[14px]"> — v{bB.v} · ride it</span>
                          </button>
                          <button className="mr-2 px-2 py-1 text-[14px] text-white/50 hover:text-white" onClick={() => setDiscOpen(discOpen === bB.author ? null : bB.author)}>
                            💬{chat.length > 0 ? chat.length : ''}
                          </button>
                        </div>
                        {discOpen === bB.author && (
                          <div className="border-t border-white/10 px-3 py-2">
                            {chat.length === 0 && <div className="text-white/30 text-[14px] mb-1">no discussion yet — say why this branch should win</div>}
                            {chat.slice(-8).map((m, i) => (
                              <div key={i} className="text-[16px] mb-0.5"><span className="text-white/45">{m.who}:</span> {m.text}</div>
                            ))}
                            <div className="flex gap-1.5 mt-1.5">
                              <input
                                value={cellDraft}
                                onChange={e => setCellDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') say(bB.author) }}
                                placeholder="speak in the cell…"
                                className="flex-1 bg-black/60 border border-white/15 rounded px-2 py-1 text-[16px] outline-none focus:border-white/35"
                              />
                              <button className="text-[14px] px-2 border border-white/15 rounded hover:border-white/40" onClick={() => say(bB.author)}>SAY</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {branchList.length === 0 && (
                    <div className="text-white/35 text-[16px] px-1 py-2">no branches yet — be the first: ⑂ BRANCH</div>
                  )}
                  <div className="text-[14px] text-white/30 mt-2">unity chant law: five to a cell · one voice each · the winner becomes the world</div>
                </div>
              </div>
            )
}
