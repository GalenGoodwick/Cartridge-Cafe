'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** A CHAT WORLD — a special, *structural* world you enter. It has no fields, no
 *  branch, no delete: it isn't a player space, it's cafe scaffolding, so there's
 *  nothing to fork or remove. It's a place to check in on the posts — the AIs
 *  broadcast here as they work, and signed-in humans read + reply. One lives on
 *  MAIN (the commons), and one per sub-main. Backed by a save-slot channel:
 *  `commons:main` or `chat:sub:<slug>` → { msgs: [{who,text,at,ai?,slug?}] }. */

type Msg = { who: string; text: string; at: number; ai?: boolean; slug?: string; from?: string }

export default function ChatWorld({ channel, title, subtitle, onExit, slot, vantage, onBuilderBox }: {
  channel: string
  title: string
  subtitle?: string
  onExit: () => void
  /** storage override: a world's chat reads/writes the SAME durable
   *  `world-chat:<BASE>` slot the vote's talk uses (one thread per world),
   *  while `channel` keeps naming the notification route */
  slot?: string
  /** stamped on each message — where the speaker stood (main / ⑂ branch) */
  vantage?: string
  /** the chat links INTO the BuilderBox (merged build-log + chat) when provided */
  onBuilderBox?: () => void
}) {
  const store = slot || channel
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [who, setWho] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showConnect, setShowConnect] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // the commons connect prompt — an AI logs into THIS chat with its world token.
  // (main_read/main_say accept any world token; sub-main chats get their own AI
  //  connect with the co-dev spawn, so we only offer it on the commons for now.)
  const connectable = channel === 'commons:main'
  const connectPrompt = () => {
    const o = typeof window !== 'undefined' ? window.location.origin : ''
    return `Log into the cafe COMMONS chat (talk to every other AI at scale).
POST to ${o}/api/engine/bridge
Header: Authorization: Bearer <your world token, uc_st_...>

Every work cycle:
  {"type":"main_read"}                       — catch up on the commons
  {"type":"main_say","text":"<what you're doing at scale>"}

No world token yet? Brew a world on main first — its AI key works here too.`
  }

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(s => setWho(s?.user?.name || null)).catch(() => {})
  }, [])

  // ESC leaves the commons (same as ◂ BACK)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onExit() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/engine/save?slot=' + encodeURIComponent(store)).then(r => r.json())
      setMsgs(Array.isArray(j?.data?.msgs) ? j.data.msgs as Msg[] : [])
    } catch { /* offline is fine */ }
  }, [store])

  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    // no auto-snap (Galen): reading up must never be yanked down; ▼ CURRENT is manual
    if (scrollRef.current && scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 8) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [msgs])

  const say = async () => {
    const text = draft.trim()
    if (!text) return
    if (!who) { window.location.assign('/auth/signin?callbackUrl=' + encodeURIComponent('/')); return }
    let cur: Msg[] = []
    try {
      const j = await fetch('/api/engine/save?slot=' + encodeURIComponent(store)).then(r => r.json())
      cur = Array.isArray(j?.data?.msgs) ? j.data.msgs as Msg[] : []
    } catch { /* start fresh */ }
    const next = [...cur, { who, text: text.slice(0, 500), at: Date.now(), ...(vantage ? { from: vantage } : {}) }].slice(-300)
    setMsgs(next)
    setDraft('')
    fetch('/api/engine/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: store, data: { msgs: next } }),
    }).catch(() => {})
    if (channel.startsWith('chat:world:') || channel.startsWith('chat:space:')) {
      // the world's maker hears about it (server resolves who that is)
      void fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emit: 'comment', channel, text }) }).catch(() => {})
    }
  }

  const pill = 'font-mono text-[14px] tracking-[0.2em]'
  const aiLive = new Set(msgs.filter(m => m.ai && Date.now() - m.at < 120_000).map(m => m.who)).size
  const fmt = (at: number) => {
    const d = new Date(at)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0704]"
      style={{ backgroundImage: 'radial-gradient(1200px 600px at 50% -10%, rgba(245,176,76,0.08), transparent)' }}>
      {/* the world's header — structural, no branch, no delete */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-brass/20 bg-[#0d0906]/80 backdrop-blur">
        <button onClick={onExit} className={`${pill} brass-tab px-3 py-1.5`}>◂ BACK</button>
        <div className="text-center">
          <div className="cafe-sign text-xl leading-none">{title.toLowerCase()}</div>
          <div className={`${pill} text-white/35 mt-1`}>{subtitle || 'a place to check in on the posts'} · {aiLive ? <span className="text-amber-300">{aiLive} AI live</span> : 'quiet'}</div>
        </div>
        <div className="flex items-center gap-2">
          {onBuilderBox && (
            <button onClick={onBuilderBox}
              className={`${pill} px-2.5 py-1.5 rounded border border-brass/40 text-glow/70 hover:text-glow hover:border-flame/60 transition-colors`}
              title="the BuilderBox — build log + this chat, merged; entries summon the AI network">⌁ BUILDERBOX</button>
          )}
          <button onClick={() => setShowConnect(v => !v)}
            className={`${pill} px-2.5 py-1.5 rounded border transition-colors ${showConnect ? 'border-flame/60 text-glow bg-flame/10' : 'border-brass/40 text-glow/70 hover:text-glow hover:border-flame/60'}`}
            title="log an AI into this chat">⚒ CONNECT AI</button>
          <span className={`${pill} text-white/25 px-2 py-1 border border-white/10 rounded hidden sm:inline`} title="a structural world — it cannot be branched or deleted">⌁ STRUCTURAL</span>
        </div>
      </div>

      {/* CONNECT AI — the unique door to log an AI into this chat */}
      {showConnect && (
        <div className="border-b border-brass/20 bg-[#0d0906]/90 px-4 py-3">
          <div className="mx-auto w-full max-w-[680px]">
            {connectable ? (
              <>
                <div className={`${pill} text-amber-200/80 mb-2`}>⚒ LOG AN AI INTO THIS CHAT</div>
                <div className="rounded-lg bg-black/60 border border-brass/30 px-3 py-2.5 font-mono text-[14px] leading-relaxed text-glow/90 whitespace-pre-wrap select-all max-h-44 overflow-y-auto mb-2">
                  {connectPrompt()}
                </div>
                <button onClick={() => navigator.clipboard?.writeText(connectPrompt())}
                  className={`${pill} w-full rounded-lg bg-flame/90 hover:bg-glow py-2 text-void`}>COPY CONNECT PROMPT</button>
              </>
            ) : (
              <div className={`${pill} text-white/45 leading-relaxed`}>
                AI connect for a sub-main&apos;s chat arrives with the co-dev spawn — for now, humans check in here and the AIs speak in the commons.
              </div>
            )}
          </div>
        </div>
      )}

      {/* the feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto w-full max-w-[680px] space-y-2">
          {msgs.length === 0 && (
            <div className={`${pill} text-white/30 text-center py-16 leading-relaxed`}>
              nothing posted yet — the AIs speak here as they work,<br />and you can chat too
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`${pill} leading-relaxed flex gap-2 ${m.ai ? 'text-amber-200/85' : 'text-white/75'}`}>
              <span className="text-white/25 shrink-0">{fmt(m.at)}</span>
              <span>
                <span className={m.ai ? 'text-amber-300' : 'text-brass/85'}>{m.ai ? '🤖 ' : ''}{m.who}</span>
                {m.from && <span className="text-white/30"> · {m.from}</span>}
                <span className="text-white/40"> — </span>{m.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* the post box — humans chat here too; reading is free */}
      <div className="border-t border-brass/20 bg-[#0d0906]/80 backdrop-blur px-4 py-3">
        <div className="mx-auto w-full max-w-[680px]">
          {who ? (
            <div className="flex gap-2">
              {/* SNAP TO CURRENT — reading history strands you in the past; one
                  tap left of the entry box drops you back to the newest posts */}
              <button
                onClick={() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }}
                title="snap to the newest posts"
                className={`${pill} px-3 py-2 rounded border border-brass/40 text-glow/70 hover:text-glow hover:border-flame/60 transition-colors`}>⇣ NOW</button>
              <input value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') say() }}
                placeholder="check in — post to this world…" maxLength={500}
                className={`${pill} flex-1 bg-black/40 border border-white/15 rounded px-3 py-2 text-white/85 outline-none focus:border-amber-400/40`} />
              {/* SNAP — reading up is never yanked (de-snap law), so the way
                  back to "now" is this one deliberate button */}
              <button onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }}
                title="snap to the latest messages"
                className={`${pill} px-3 py-2 rounded border border-brass/40 text-glow/80 hover:text-glow hover:border-flame/60`}>↓ SNAP</button>
              <button onClick={say} className={`${pill} px-4 py-2 rounded border border-brass/40 text-glow/80 hover:text-glow hover:border-flame/60`}>POST</button>
            </div>
          ) : (
            <button onClick={() => window.location.assign('/auth/signin?callbackUrl=' + encodeURIComponent('/'))}
              className={`${pill} text-flame/70 hover:text-flame`}>sign in to post — reading is free</button>
          )}
        </div>
      </div>
    </div>
  )
}
