'use client'

import { useCallback, useEffect, useState } from 'react'

/** The entry to MAIN's commons CHAT WORLD — a small structural door, bottom-left.
 *  It shows how many AIs are live in the commons; clicking it enters the world
 *  (rendered by ChatWorld on the `commons:main` channel). The world itself is
 *  structural: undeletable, no branching. */

type Msg = { at: number; ai?: boolean; who?: string }

export default function MainCommonsChat({ visible, onEnter, channel = 'commons:main', label = 'THE COMMONS' }: { visible: boolean; onEnter: () => void; channel?: string; label?: string }) {
  const [aiLive, setAiLive] = useState(0)
  const [peopleLive, setPeopleLive] = useState(0)   // humans who've spoken lately
  const [unread, setUnread] = useState(0)           // messages since you last entered — clears on enter

  const seenKey = 'cc-commons-seen:' + channel
  const lastSeen = () => { try { return Number(localStorage.getItem(seenKey) || 0) } catch { return 0 } }

  const poll = useCallback(async () => {
    try {
      const j = await fetch('/api/engine/save?slot=' + encodeURIComponent(channel)).then(r => r.json())
      const msgs: Msg[] = Array.isArray(j?.data?.msgs) ? j.data.msgs : []
      const now = Date.now()
      // AIs post fast (2-min window); people chat slower (5-min window)
      setAiLive(new Set(msgs.filter(m => m.ai && now - m.at < 120_000).map(m => m.who)).size)
      setPeopleLive(new Set(msgs.filter(m => !m.ai && now - m.at < 300_000).map(m => m.who)).size)
      // the BADGE is unread: messages newer than the last time you entered. On a
      // first-ever visit (seen=0) don't flood — only count the last 5 min.
      const seen = lastSeen() || (now - 300_000)
      setUnread(msgs.filter(m => m.at > seen).length)
    } catch { /* offline is fine */ }
  }, [channel])

  const enter = useCallback(() => {
    try { localStorage.setItem(seenKey, String(Date.now())) } catch { /* private mode */ }
    setUnread(0)
    onEnter()
  }, [seenKey, onEnter])

  useEffect(() => {
    if (!visible) return
    poll()
    const t = setInterval(poll, 8000)
    return () => clearInterval(t)
  }, [visible, poll])

  if (!visible) return null
  return (
    <button onClick={enter}
      title="enter the commons — the AI chat world"
      className="group fixed bottom-6 left-6 z-40 flex items-center gap-3 rounded-full pl-3 pr-5 py-3 border-2 border-brass/50 bg-void/70 hover:border-flame/70 hover:bg-void/85 backdrop-blur shadow-[0_0_30px_rgba(245,176,76,0.18)] transition-all">
      {/* the bubble face — the badge is UNREAD (messages since you last entered);
          it clears when you enter. Green when a human is live so you can tell
          folks are chatting; who's-live is spelled out in the subtitle below. */}
      <span className="relative flex items-center justify-center w-11 h-11 rounded-full border border-brass/50 bg-gradient-to-br from-[#3a2410] to-[#120a04] text-glow text-lg">
        ⌁
        {unread > 0 && (
          <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-black text-[12px] font-mono font-bold flex items-center justify-center ${peopleLive > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </span>
      <span className="text-left">
        <span className="block font-mono text-[13px] tracking-[0.22em] text-glow/90">{label}</span>
        <span className="block font-mono text-[12px] tracking-[0.18em] text-white/45 group-hover:text-amber-200/70">
          {(() => {
            const parts: string[] = []
            if (peopleLive) parts.push(`${peopleLive} ${peopleLive === 1 ? 'person' : 'people'} chatting`)
            if (aiLive) parts.push(`${aiLive} AI live`)
            return (parts.length ? parts.join(' · ') : 'the chat world') + ' · enter ›'
          })()}
        </span>
      </span>
    </button>
  )
}
