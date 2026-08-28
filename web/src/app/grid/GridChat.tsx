'use client'

// THE CHAT, done over (Galen, Aug 28): a field-bounded OVERLAY like the
// dockstar menu — the bar is never covered. NO AI mode, no connect prompts,
// no vantage framing: just the people in THIS world, talking. One thread per
// world (the world-chat:<KEY> slot; MAIN has its own), through the ONE chat
// core (useWorldChat — same data layer as everything else, fresh skin).
import { useEffect, useRef } from 'react'
import { useWorldChat } from '@/lib/useWorldChat'

export default function GridChat({ slotKey, title, bounds, onClose, inline }: {
  slotKey: string                       // world-chat:<KEY> — unique per world/main
  title: string
  bounds?: { top: number; right: number; bottom: number; left: number }
  onClose?: () => void
  /** inline: render as a filling panel (the engine's under-area), no overlay */
  inline?: boolean
}) {
  const { msgs, who, draft, setDraft, say } = useWorldChat(slotKey, { noStore: true })
  const listRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  // stick to the newest message unless the reader scrolled up
  useEffect(() => {
    const el = listRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [msgs])

  const body = (
      <div className="w-full max-w-[640px] h-full flex flex-col p-4 mx-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[12px] tracking-[0.25em] text-white/85">◉ {title} — THE ROOM</span>
          {!inline && (
            <button onClick={onClose} aria-label="close chat"
              className="w-8 h-8 grid place-items-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 text-[16px]">✕</button>
          )}
        </div>

        {/* the thread */}
        <div ref={listRef}
          onScroll={e => { const el = e.currentTarget; atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}
          className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/12 bg-black/50 p-3 font-mono text-[13px] leading-relaxed">
          {msgs.length === 0 && (
            <div className="text-white/45 py-6 text-center">quiet in here — say something.</div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className="py-1 border-b border-white/5 last:border-0">
              <span className={`${m.who === who ? 'text-emerald-200' : 'text-amber-200/90'}`}>{m.who}</span>
              <span className="text-white/35 text-[10px] ml-2">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <div className="text-white/90 whitespace-pre-wrap break-words">{m.text}</div>
            </div>
          ))}
        </div>

        {/* the say line */}
        <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); if (draft.trim()) { atBottomRef.current = true; say() } }}>
          <input
            value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={who ? `say it, ${who}…` : 'say something…'}
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/20 font-mono text-[13px] text-white/95 placeholder:text-white/35 outline-none focus:border-emerald-300/50"
          />
          <button type="submit" disabled={!draft.trim()}
            className="px-4 py-2.5 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 font-mono text-[12px] tracking-[0.15em] hover:bg-emerald-400/25 disabled:opacity-35 transition-colors">
            SAY
          </button>
        </form>
      </div>
  )
  if (inline) return <div className="w-full h-full">{body}</div>
  return (
    <div className="fixed z-[127] flex items-end justify-center backdrop-blur-sm"
      style={{ top: bounds!.top, right: bounds!.right, bottom: bounds!.bottom, left: bounds!.left, background: 'rgba(5,6,12,0.88)', borderRadius: 10 }}
      onClick={onClose}>
      {body}
    </div>
  )
}
