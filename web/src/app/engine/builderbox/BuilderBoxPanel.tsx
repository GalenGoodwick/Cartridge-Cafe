// engine/builderbox/BuilderBoxPanel.tsx — the ⌁ BUILDERBOX panel (AI build log +
// world chat + summon/hack doors), carved out of FieldEngine.tsx
// (DESIGN-fieldengine-carve.md, Phase 4). Pure move, byte-identical body.
'use client'

import type { Dispatch, SetStateAction, MutableRefObject, RefObject } from 'react'
import AgentTerminalPanel from '../AgentTerminalPanel'
import type { TerminalEntry } from '../AgentTerminalPanel'
import { BuilderBoxChat } from './BuilderBoxChat'

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
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 font-mono text-[13px] tracking-[0.2em] text-white/65">
                <span>⌁ BUILDERBOX</span>
                <div className="flex items-center gap-2.5">
                  <span className="text-white/55">{terminalLog.length} steps</span>
                  <button
                    onClick={() => { setBuildConsoleOpen(false); buildConsoleClosedRef.current = true }}
                    title="close the BuilderBox"
                    className="text-white/65 hover:text-white text-[15px] leading-none">✕</button>
                </div>
              </div>
              <div ref={buildConsoleRef} className="flex-1 min-h-0 flex flex-col">
                {terminalLog.length === 0
                  ? <div className="font-mono text-[14px] text-white/60 leading-relaxed px-3 py-2">no build running — speak below and the network hears.<br/>when an AI builds here, each shader, field, and rule lands live.</div>
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
              {/* (SUMMON removed from the BuilderBox — Galen, Aug 26. The owner's
                  way to get an AI building is ⚡ CONNECT YOUR AI; chat below just
                  talks to the room.) */}
              {/* (fork/build footers REMOVED — Galen, Aug 28: no fork and
                  build on builderbox; forking lives in CREATE / the grid) */}

            </div>
  )
}
