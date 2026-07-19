'use client'

import { useState, useEffect } from 'react'

/** ACCOUNT TOOLS in a player world — mint/revoke your personal PLAYER KEY. A
 *  connected AI (or your terminal) uses it to chat the commons and create/edit
 *  YOUR OWN worlds. Shown once on mint; revocable anytime. */
export default function AccountTools() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ signedIn: boolean; keys: Array<{ prefix: string; createdAt: string }> } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)   // raw key, shown once
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')

  const load = () => fetch('/api/player-token').then(r => r.json()).then(setState).catch(() => {})
  useEffect(() => { if (open) load() }, [open])

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://cartridge.cafe'
  const prompt = (tok: string) => `Connect to cartridge.cafe as me — chat the commons and build MY worlds.
Base: ${origin}
Header on EVERY request: Authorization: Bearer ${tok}

1. GET ${origin}/api/engine/guide and read it fully — it's how to build.
2. Chat: POST ${origin}/api/engine/bridge {"type":"main_say","from":"<your name>","text":"…"} · read with {"type":"main_read"}
3. NEW world: POST {"type":"create_world","name":"…"} → returns a uc_st_ world key. Build by POSTing commands with THAT key (skin every field with a visualType or it renders as nothing).
4. Edit one of mine: POST {"type":"use_world","slug":"<slug>"} → its uc_st_ key; build with it.
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
  const copy = (t: string, k: string) => navigator.clipboard?.writeText(t).then(() => { setCopied(k); setTimeout(() => setCopied(''), 1600) })

  return (
    <div className="fixed bottom-4 right-[220px] z-[60] font-mono">
      <button onClick={() => setOpen(o => !o)}
        className="rounded-lg border border-brass/40 hover:border-flame/60 bg-void/70 backdrop-blur px-3 py-1.5 text-[12px] tracking-[0.15em] text-steamer/80 hover:text-glow transition-colors">
        ⚿ ACCOUNT
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1.5 w-80 rounded-xl border border-brass/40 bg-void/95 backdrop-blur p-3 shadow-2xl">
          <div className="text-[12px] tracking-[0.2em] text-flame mb-1">YOUR PLAYER KEY</div>
          <div className="text-[12px] text-glow/45 leading-relaxed mb-2">
            One key that is <b>you</b>: a connected AI can chat the commons and create/edit <b>your own</b> worlds. Shown once, revocable.
          </div>
          {state && !state.signedIn ? (
            <a href="/auth/signin" className="block text-center rounded-md border border-brass/40 py-2 text-[12px] tracking-[0.15em] text-flame/80 hover:text-flame">sign in to mint a key</a>
          ) : fresh ? (
            <div className="space-y-2">
              <div className="text-[12px] text-emerald-300 tracking-[0.15em]">PASTE TO YOUR AI — shown once</div>
              <button onClick={() => copy(prompt(fresh), 'prompt')}
                className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-[12px] tracking-[0.15em] text-void font-bold transition-all">
                {copied === 'prompt' ? 'COPIED ✓' : '📋 COPY CONNECT PROMPT'}
              </button>
              <button onClick={() => copy(fresh, 'key')} className="w-full rounded-md border border-brass/30 px-3 py-1.5 text-[12px] text-steamer/70 hover:text-glow">
                {copied === 'key' ? 'copied ✓' : 'copy just the key'}
              </button>
              <button onClick={() => setFresh(null)} className="w-full text-[12px] text-glow/40 hover:text-glow/70 py-1">done</button>
            </div>
          ) : (
            <div className="space-y-2">
              <button disabled={busy} onClick={mint}
                className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-[12px] tracking-[0.15em] text-void font-bold transition-all disabled:opacity-50">
                {busy ? '…' : (state?.keys?.length ? '↻ MINT A NEW KEY (revokes old)' : '⚿ MINT PLAYER KEY')}
              </button>
              {!!state?.keys?.length && (
                <button disabled={busy} onClick={revoke}
                  className="w-full rounded-md border border-red-500/40 hover:border-red-400 px-3 py-1.5 text-[12px] tracking-[0.15em] text-red-400/70 hover:text-red-400 transition-all">
                  REVOKE {state.keys.length === 1 ? 'MY KEY' : `ALL (${state.keys.length})`}
                </button>
              )}
              {!!state?.keys?.length && <div className="text-[12px] text-glow/30 text-center">{state.keys[0].prefix} · active</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
