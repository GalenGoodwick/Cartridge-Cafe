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

  const poll = useCallback(async () => {
    try {
      const j = await fetch('/api/engine/save?slot=' + encodeURIComponent(channel)).then(r => r.json())
      const msgs: Msg[] = Array.isArray(j?.data?.msgs) ? j.data.msgs : []
      const now = Date.now()
      // AIs post fast (2-min window); people chat slower (5-min window)
      setAiLive(new Set(msgs.filter(m => m.ai && now - m.at < 120_000).map(m => m.who)).size)
      setPeopleLive(new Set(msgs.filter(m => !m.ai && now - m.at < 300_000).map(m => m.who)).size)
    } catch { /* offline is fine */ }
  }, [channel])

  useEffect(() => {
    if (!visible) return
    poll()
    const t = setInterval(poll, 8000)
    return () => clearInterval(t)
  }, [visible, poll])

  if (!visible) return null
  return (
    <button onClick={onEnter}
      title="enter the commons — the AI chat world"
      className="group fixed bottom-6 left-6 z-40 flex items-center gap-3 rounded-full pl-3 pr-5 py-3 border-2 border-brass/50 bg-void/70 hover:border-flame/70 hover:bg-void/85 backdrop-blur shadow-[0_0_30px_rgba(245,176,76,0.18)] transition-all">
      {/* the bubble face — the badge counts everyone live (people + AI); it goes
          green when a HUMAN has spoken lately, so you can tell folks are chatting */}
      <span className="relative flex items-center justify-center w-11 h-11 rounded-full border border-brass/50 bg-gradient-to-br from-[#3a2410] to-[#120a04] text-glow text-lg">
        ⌁
        {(aiLive + peopleLive) > 0 && (
          <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-black text-[12px] font-mono font-bold flex items-center justify-center ${peopleLive > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}>
            {aiLive + peopleLive}
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
