// engine/builderbox/BuilderBoxChat.tsx — P2 seam: the world chat that lives inside
// the BuilderBox, extracted from FieldEngine. Chat and build console are ONE surface
// (Galen); every entry NOTIFIES the maker but does NOT summon the AI network — that's
// the SUMMON bar's explicit job. Runs the shared useWorldChat core (same slot + notify
// path as ChatWorld), with verifyPost/noStore for this skin's stricter posting; only
// the compact layout is unique.
import { useState, useEffect } from 'react'
import { useWorldChat } from '@/lib/useWorldChat'

export function BuilderBoxChat({ slotKey, channel, onFullChat }: { slotKey: string; channel: string; onFullChat: () => void }) {
  const { msgs, who, draft, setDraft, say, postErr, scrollRef, snapToBottom } =
    useWorldChat('world-chat:' + slotKey, { channel, verifyPost: true, noStore: true })
  // no auto-snap — manual ▼ CURRENT only (Galen)
  const [atBottom, setAtBottom] = useState(true)
  const checkBottom = () => { const el = scrollRef.current; if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 8) }
  useEffect(() => { checkBottom() }, [msgs])
  return (
    <div className="border-t border-white/10 flex flex-col h-[280px]">
      <div className="flex items-center justify-between px-3 pt-1.5 font-mono text-[12px] tracking-[0.2em] text-white/35">
        <span>⌁ WORLD CHAT — the room hears you (chat is chat)</span>
        <div className="flex items-center gap-2">
          <button onClick={() => { snapToBottom(); setAtBottom(true) }} disabled={atBottom}
            title={atBottom ? 'at the newest message' : 'jump to the newest message'}
            className={atBottom ? 'text-white/20 cursor-default' : 'text-amber-300 animate-pulse'}>▼ CURRENT</button>
          <button onClick={onFullChat} title="open the full chat" className="hover:text-white/80">⛶</button>
        </div>
      </div>
      <div className="px-3 pt-0.5 font-mono text-[11px] leading-snug text-white/30">
        ⚑ SUMMON (the bar below, owners) = the explicit rally — it calls AI builders. CHAT = just talk: the maker and the room hear you; nothing is auto-summoned.
      </div>
      <div ref={scrollRef} onScroll={checkBottom} className="flex-1 min-h-0 overflow-y-auto px-3 py-1 font-mono text-[13px] leading-relaxed">
        {msgs.length === 0
          ? <div className="text-white/30">say something — the maker and the room hear it.</div>
          : msgs.slice(-40).map((m, i) => (
            <div key={m.at + '-' + i} className="text-white/75">
              <span className={m.ai ? 'text-amber-300/90' : 'text-emerald-300/80'}>{m.who}</span>
              <span className="text-white/30"> · </span>{m.text}
            </div>
          ))}
      </div>
      {postErr && <div className="px-3 pb-1 font-mono text-[12px] text-red-400/90">{postErr}</div>}
      <div className="flex gap-1.5 px-2 pb-2">
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void say() }}
          placeholder={who ? 'say something — the maker hears' : 'sign in to speak'}
          className="flex-1 bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 font-mono text-[13px] text-white/85 placeholder:text-white/25 outline-none focus:border-white/30" />
        <button onClick={() => void say()} className="px-3 rounded-md bg-white/10 hover:bg-white/20 font-mono text-[13px] text-white/70">➤</button>
      </div>
    </div>
  )
}
