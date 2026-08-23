// engine/builderbox/BuilderBoxPanel.tsx — the ⌁ BUILDERBOX panel (AI build log +
// world chat + summon/hack doors), carved out of FieldEngine.tsx
// (DESIGN-fieldengine-carve.md, Phase 4). Pure move, byte-identical body.
'use client'

import type { Dispatch, SetStateAction, MutableRefObject, RefObject } from 'react'
import AgentTerminalPanel from '../AgentTerminalPanel'
import type { TerminalEntry } from '../AgentTerminalPanel'
import { BuilderBoxChat } from './BuilderBoxChat'
import SummonPrompt from '../SummonPrompt'

export function BuilderBoxPanel({ terminalLog, setBuildConsoleOpen, buildConsoleClosedRef, buildConsoleRef, lastSceneRef, playScene, spaceId, spaceName, spaceSlug, spaceOwnerName, isOwner, isHub, riding, me, handleBranch, onFork, forkable, setWorldChatOpen, sendHumanShot, humanShot }: {
  terminalLog: TerminalEntry[]
  setBuildConsoleOpen: Dispatch<SetStateAction<boolean>>
  buildConsoleClosedRef: MutableRefObject<boolean>
  buildConsoleRef: RefObject<HTMLDivElement | null>
  lastSceneRef: MutableRefObject<string>
  playScene?: string
  spaceId?: string
  spaceName?: string
  spaceSlug?: string
  spaceOwnerName?: string | null
  isOwner?: boolean
  isHub: boolean
  riding: string | null
  me: string | null
  handleBranch: () => void
  onFork: () => void
  forkable: boolean
  setWorldChatOpen: Dispatch<SetStateAction<boolean>>
  sendHumanShot?: () => void
  humanShot?: 'idle' | 'sending' | 'sent' | 'err'
}) {
  return (
            <div className="absolute -translate-x-1/2 bottom-6 z-50 pointer-events-auto w-[560px] max-w-[86vw] h-[560px] max-h-[82vh] rounded-xl border border-white/12 bg-black/85 backdrop-blur overflow-hidden flex flex-col shadow-[0_8px_40px_rgba(0,0,0,0.55)]"
              style={{ left: 'calc(50% + 145px)' }}>
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 font-mono text-[13px] tracking-[0.2em] text-white/40">
                <span>⌁ BUILDERBOX</span>
                <div className="flex items-center gap-2.5">
                  <span className="text-white/25">{terminalLog.length} steps</span>
                  <button
                    onClick={() => { setBuildConsoleOpen(false); buildConsoleClosedRef.current = true }}
                    title="close the BuilderBox"
                    className="text-white/40 hover:text-white text-[15px] leading-none">✕</button>
                </div>
              </div>
              <div ref={buildConsoleRef} className="flex-1 min-h-0 flex flex-col">
                {terminalLog.length === 0
                  ? <div className="font-mono text-[14px] text-white/30 leading-relaxed px-3 py-2">no build running — speak below and the network hears.<br/>when an AI builds here, each shader, field, and rule lands live.</div>
                  : <AgentTerminalPanel entries={terminalLog} header={false} />}
              </div>
              {/* the MERGED WORLD CHAT — one surface (Galen). Entries invite AIs. */}
              {(() => {
                const cur = lastSceneRef.current || playScene || ''
                const base = cur.split(' ⑂ ')[0]
                const key = ((spaceId ? (spaceName || spaceSlug) : base) || '').split(' ⑂ ')[0].trim().toUpperCase()
                const channel = spaceId && spaceSlug ? 'chat:space:' + spaceSlug : 'chat:world:' + base
                return key ? <BuilderBoxChat slotKey={key} channel={channel} sendHumanShot={sendHumanShot} humanShot={humanShot} onFullChat={() => { setBuildConsoleOpen(false); setWorldChatOpen(true) }} /> : null
              })()}
              {/* the PROMPT BOX — summon connected AIs to build this world. Owner
                  of a real space only (the summons pushes to real humans). NOT on
                  a branch (Galen): the summon rallies to the space's MAIN, so on a
                  branch it's misleading — `riding` is the branch scene when set. */}
              {spaceSlug && spaceId && isOwner && !riding && (
                <SummonPrompt slug={spaceSlug} name={spaceName || spaceSlug} />
              )}
              {/* HOUSE WORLD (author-less base scene, no space): the cafe keeper
                  can summon AIs to build its own content. The box self-hides for
                  non-admins (SummonPrompt polls canSummon), and the server
                  re-checks admin — so this renders for everyone but only opens
                  for the keeper. Not the CAFE hub / a sub-main / a branch. */}
              {!spaceId && !isHub && !riding && me && (() => {
                const cur = (lastSceneRef.current || playScene || '').split(' ⑂ ')[0].trim()
                if (!cur || cur === 'CAFE' || cur === 'SUB-MAIN') return null
                return <SummonPrompt scene={cur} name={cur} />
              })()}
              {/* NOT your world (fork paradigm): remixing someone's world
                  FORKS it — instantly your own world, lineage back here. Only
                  if its maker enabled forking; otherwise say so honestly. */}
              {spaceSlug && spaceId && !isOwner && !riding && (
                <div className="px-3 py-2 border-t border-white/10">
                  {forkable ? (<>
                    <div className="font-mono text-[13px] text-white/40 leading-relaxed mb-1.5">
                      this is {spaceOwnerName ? `${spaceOwnerName}'s` : 'another maker’s'} world — forking takes <span className="text-emerald-200/80">your own copy</span>, with lineage back here
                    </div>
                    <button
                      onClick={() => { setBuildConsoleOpen(false); onFork() }}
                      className="w-full px-2 py-1.5 rounded bg-emerald-400/15 border border-emerald-300/40 text-emerald-200 hover:bg-emerald-400/25 font-mono text-[14px] tracking-[0.15em] transition-colors">
                      ⑄ FORK THIS WORLD
                    </button>
                  </>) : (
                    <div className="font-mono text-[13px] text-white/30 leading-relaxed">
                      this is {spaceOwnerName ? `${spaceOwnerName}'s` : 'another maker’s'} world — its maker hasn&apos;t enabled forking
                    </div>
                  )}
                </div>
              )}
              {/* HOUSE world — no space, so no summon/hack above: its BuilderBox
                  had a chat + log but NO build door ("not all worlds have a
                  unified builderbox", Galen). House worlds are open ground — you
                  build one by branching your own copy — so give it the same
                  ⑂ build footer every other world has. (Branches ride `riding`;
                  skip so the door only shows on the base.) */}
              {!spaceId && !isHub && !riding && (
                <div className="px-3 py-2 border-t border-white/10">
                  <div className="font-mono text-[13px] text-white/40 leading-relaxed mb-1.5">
                    a house world — open ground. build it by forking <span className="text-emerald-200/80">your own copy</span>
                  </div>
                  <button
                    onClick={() => { setBuildConsoleOpen(false); handleBranch() }}
                    className="w-full px-2 py-1.5 rounded bg-emerald-400/15 border border-emerald-300/40 text-emerald-200 hover:bg-emerald-400/25 font-mono text-[14px] tracking-[0.15em] transition-colors">
                    ⑄ FORK &amp; BUILD
                  </button>
                </div>
              )}
            </div>
  )
}
