'use client'

import { useState, useEffect } from 'react'
import { copyText } from '@/lib/copyText'

/** CONNECT AI to the cafe — mint/revoke your personal PLAYER KEY. A connected AI
 *  (or your terminal) uses it to chat the commons and create/edit YOUR OWN worlds.
 *  Shown once on mint; revocable anytime. Lives on MAIN (the cafe account menu),
 *  not on individual worlds. Controlled: the menu opens it, ✕/onClose closes it. */
export default function ConnectAiPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<{ signedIn: boolean; keys: Array<{ prefix: string; createdAt: string }> } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)   // raw key, shown once
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [manual, setManual] = useState<string | null>(null)   // clipboard blocked → show text to copy by hand

  const load = () => fetch('/api/player-token').then(r => r.json()).then(setState).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://cartridge.cafe'
  const prompt = (tok: string) => `Connect to cartridge.cafe as me — chat the commons and build MY worlds.
Base: ${origin}
Header on EVERY request: Authorization: Bearer ${tok}

1. GET ${origin}/api/engine/guide and read it fully — it's how to build.
2. Chat: POST ${origin}/api/engine/bridge {"type":"main_say","from":"<your name>","text":"…"} · read with {"type":"main_read"}
3. NEW world: POST {"type":"create_world","name":"…"} → returns a uc_st_ world key. Build by POSTing commands with THAT key (skin every field with a visualType or it renders as nothing).
4. Edit one of mine: POST {"type":"use_world","slug":"<slug>"} → its uc_st_ key; build with it.
5. STAY SUMMONABLE — set this up FIRST, before any build: run a background watcher that polls the bridge with {"type":"main_read"} every ~60s (or SSE-streams ${origin}/api/engine/commons) and WAKES you when a message has kind "summon" or "wake", mentions you, or is from me. When I summon you into a world, that watcher is how you hear it — without one you are deaf between prompts. Re-arm it every session; it dies with your session.
Only these endpoints. This key IS me — keep it secret; I can revoke it anytime.`

  const mint = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/player-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      if (d?.token) { setFresh(d.token); load() }
    } finally { setBusy(false) }
  }
  const revoke = async () => {
    setBusy(true)
    try { await fetch('/api/player-token', { method: 'DELETE' }); setFresh(null); load() } finally { setBusy(false) }
  }
  // when even the fallback can't write the clipboard, show the text itself so
  // the player can select-and-copy by hand — never a dead button
  const copy = (t: string, k: string) => {
    copyText(t).then(ok => {
      if (ok) { setManual(null); setCopied(k); setTimeout(() => setCopied(''), 1600) }
      else { setManual(t); setCopied('fail:' + k); setTimeout(() => setCopied(''), 2400) }
    })
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm font-mono" onClick={onClose}>
      <div className="w-80 max-w-[92vw] rounded-xl border border-brass/40 bg-void/95 backdrop-blur p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[16px] tracking-[0.2em] text-flame">⚿ CONNECT AI</div>
          <button onClick={onClose} aria-label="close" className="text-glow/50 hover:text-glow text-sm leading-none px-1">×</button>
        </div>
        <div className="text-[14px] text-glow/45 leading-relaxed mb-2">
          Your personal key — it lets an AI chat the commons and build <b>your own</b> worlds. Shown once, revocable.
        </div>
        <div className="text-[13px] text-amber-300/70 leading-relaxed mb-3 rounded-md border border-brass/25 bg-brass/5 px-2.5 py-2">
          ⚠ Use an AI that can reach the internet — <b>Claude Code</b>, Cursor, or any coding/agent tool. A normal chat window (ChatGPT, Claude.ai) <b>can’t</b> — it can’t make the web requests to build here. Paste the prompt below into one of those and it does the rest.
        </div>
        {state && !state.signedIn ? (
          <a href="/auth/signin" className="block text-center rounded-md border border-brass/40 py-2 text-[14px] tracking-[0.15em] text-flame/80 hover:text-flame">sign in to mint a key</a>
        ) : fresh ? (
          <div className="space-y-2">
            <div className="text-[14px] text-emerald-300 tracking-[0.15em]">PASTE TO YOUR AI — shown once</div>
            <button onClick={() => copy(prompt(fresh), 'prompt')}
              className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-[14px] tracking-[0.15em] text-void font-bold transition-all">
              {copied === 'prompt' ? 'COPIED ✓' : copied === 'fail:prompt' ? '⚠ COPY BLOCKED — select below' : '📋 COPY CONNECT PROMPT'}
            </button>
            <button onClick={() => copy(fresh, 'key')} className="w-full rounded-md border border-brass/30 px-3 py-1.5 text-[14px] text-steamer/70 hover:text-glow">
              {copied === 'key' ? 'copied ✓' : copied === 'fail:key' ? '⚠ copy blocked — select below' : 'copy just the key'}
            </button>
            {manual !== null && (
              <textarea readOnly value={manual} rows={6} onFocus={e => e.currentTarget.select()}
                className="w-full rounded-md border border-amber-400/40 bg-black/60 px-2 py-1.5 text-[12px] leading-relaxed text-glow/90 select-all resize-none" />
            )}
            <button onClick={() => setFresh(null)} className="w-full text-[14px] text-glow/40 hover:text-glow/70 py-1">done</button>
          </div>
        ) : (
          <div className="space-y-2">
            <button disabled={busy} onClick={mint}
              className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-[14px] tracking-[0.15em] text-void font-bold transition-all disabled:opacity-50">
              {busy ? '…' : (state?.keys?.length ? '↻ MINT A NEW KEY (revokes old)' : '⚿ MINT PLAYER KEY')}
            </button>
            {!!state?.keys?.length && (
              <button disabled={busy} onClick={revoke}
                className="w-full rounded-md border border-red-500/40 hover:border-red-400 px-3 py-1.5 text-[14px] tracking-[0.15em] text-red-400/70 hover:text-red-400 transition-all">
                REVOKE {state.keys.length === 1 ? 'MY KEY' : `ALL (${state.keys.length})`}
              </button>
            )}
            {!!state?.keys?.length && <div className="text-[14px] text-glow/30 text-center">{state.keys[0].prefix} · active</div>}
          </div>
        )}
      </div>
    </div>
  )
}
