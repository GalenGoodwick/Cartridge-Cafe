'use client'

import { playerConnectPrompt } from '@/lib/connectPrompt'
import { useState, useEffect } from 'react'
import { copyText } from '@/lib/copyText'

/** CONNECT AI to the cafe — mint/revoke your personal PLAYER KEY. A connected AI
 *  (or your terminal) uses it to chat the commons and create/edit YOUR OWN worlds.
 *  Shown once on mint; revocable anytime. Lives on MAIN (the cafe account menu),
 *  not on individual worlds. Controlled: the menu opens it, ✕/onClose closes it.
 *
 *  Raw keys are stored hash-only server-side (never re-shown), so "copy my current
 *  key" is served from THIS browser: we remember the active key in localStorage on
 *  mint (and you can paste a key minted elsewhere to remember it here). Cleared on
 *  revoke; only ever the active key, only on your own device. */
const KEY_LS = 'cafe_player_key'   // { prefix, raw } — this browser's copy of the active key
function readCached(): { prefix: string; raw: string } | null {
  try { const s = localStorage.getItem(KEY_LS); return s ? JSON.parse(s) : null } catch { return null }
}
function writeCached(prefix: string, raw: string) { try { localStorage.setItem(KEY_LS, JSON.stringify({ prefix, raw })) } catch {} }
function clearCached() { try { localStorage.removeItem(KEY_LS) } catch {} }

export default function ConnectAiPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<{ signedIn: boolean; keys: Array<{ prefix: string; createdAt: string }> } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)   // raw key, shown once
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [manual, setManual] = useState<string | null>(null)   // clipboard blocked → show text to copy by hand
  const [cached, setCached] = useState<{ prefix: string; raw: string } | null>(null)   // this browser's remembered key
  const [paste, setPaste] = useState('')          // paste-to-remember a key minted elsewhere
  const [showPaste, setShowPaste] = useState(false)
  const [pasteErr, setPasteErr] = useState('')

  const load = () => fetch('/api/player-token').then(r => r.json()).then(setState).catch(() => {})
  useEffect(() => { load(); setCached(readCached()) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const prompt = (tok: string) => playerConnectPrompt(tok)

  const mint = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/player-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      if (d?.token) {
        writeCached(d.prefix, d.token); setCached({ prefix: d.prefix, raw: d.token })   // remember it so "copy my current key" works later
        setFresh(d.token)
        load()
        // The prompt lands on the clipboard the moment it exists — copying must
        // not cost an extra click (Galen). The mint click is the user gesture;
        // if the clipboard still refuses, copy() opens the manual-select box.
        copy(prompt(d.token), 'prompt')
      }
    } finally { setBusy(false) }
  }
  const revoke = async () => {
    setBusy(true)
    try { await fetch('/api/player-token', { method: 'DELETE' }); clearCached(); setCached(null); setFresh(null); load() } finally { setBusy(false) }
  }
  // when even the fallback can't write the clipboard, show the text itself so
  // the player can select-and-copy by hand — never a dead button
  const copy = (t: string, k: string) => {
    copyText(t).then(ok => {
      if (ok) { setManual(null); setCopied(k); setTimeout(() => setCopied(''), 1600) }
      else { setManual(t); setCopied('fail:' + k); setTimeout(() => setCopied(''), 2400) }
    })
  }

  const activePrefix = state?.keys?.[0]?.prefix ?? null
  // the remembered key belongs to the active key iff its prefix matches
  const cachedIsActive = !!(cached && activePrefix && cached.prefix === activePrefix)
  // paste a key minted on another device — accept it only if it matches the active
  // key's prefix (so we never remember a stale or foreign key)
  const rememberPasted = () => {
    setPasteErr('')
    const raw = paste.trim()
    if (!raw.startsWith('uc_pt_')) { setPasteErr('that is not a uc_pt_ key'); return }
    const base = (activePrefix ?? '').replace('…', '')
    if (base && !raw.startsWith(base)) { setPasteErr('that key is not your current one'); return }
    const prefix = activePrefix ?? (raw.slice(0, 12) + '…')
    writeCached(prefix, raw); setCached({ prefix, raw }); setPaste(''); setShowPaste(false)
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
            {/* COPY MY CURRENT KEY — whenever this browser remembers the active key */}
            {cachedIsActive && (
              <>
                <button onClick={() => copy(cached!.raw, 'cur')}
                  className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-[14px] tracking-[0.15em] text-void font-bold transition-all">
                  {copied === 'cur' ? 'COPIED ✓' : copied === 'fail:cur' ? '⚠ COPY BLOCKED — select below' : '📋 COPY MY CURRENT KEY'}
                </button>
                <button onClick={() => copy(prompt(cached!.raw), 'curprompt')}
                  className="w-full rounded-md border border-brass/30 px-3 py-1.5 text-[14px] text-steamer/70 hover:text-glow">
                  {copied === 'curprompt' ? 'copied ✓' : copied === 'fail:curprompt' ? '⚠ copy blocked — select below' : 'copy the full connect prompt'}
                </button>
                {manual !== null && (
                  <textarea readOnly value={manual} rows={6} onFocus={e => e.currentTarget.select()}
                    className="w-full rounded-md border border-amber-400/40 bg-black/60 px-2 py-1.5 text-[12px] leading-relaxed text-glow/90 select-all resize-none" />
                )}
              </>
            )}
            {/* active key exists but this browser doesn't hold it — explain honestly;
                MINT (below) is the primary path, paste is a small non-destructive option */}
            {!!activePrefix && !cachedIsActive && (
              <div className="rounded-md border border-brass/25 bg-brass/5 px-2.5 py-2 space-y-1.5">
                <div className="text-[12px] text-glow/50 leading-snug">
                  This browser doesn’t have your current key ({activePrefix}) saved — keys are shown only <b>once</b>. Mint a new one below (that revokes the old), or if you saved this key elsewhere, paste it to copy it again.
                </div>
                {showPaste ? (
                  <>
                    <input value={paste} onChange={e => setPaste(e.target.value)} placeholder="uc_pt_…" autoFocus
                      className="w-full rounded-md border border-brass/30 bg-black/60 px-2 py-1.5 text-[12px] text-glow/90 placeholder-glow/25" />
                    {pasteErr && <div className="text-[12px] text-red-400/80">{pasteErr}</div>}
                    <div className="flex gap-1.5">
                      <button onClick={rememberPasted} className="flex-1 rounded-md bg-flame hover:bg-glow px-2 py-1.5 text-[13px] tracking-[0.1em] text-void font-bold">REMEMBER</button>
                      <button onClick={() => { setShowPaste(false); setPaste(''); setPasteErr('') }} className="rounded-md border border-brass/30 px-2 py-1.5 text-[13px] text-glow/50 hover:text-glow">cancel</button>
                    </div>
                  </>
                ) : (
                  <button onClick={() => setShowPaste(true)} className="text-[12px] text-steamer/60 hover:text-glow underline underline-offset-2">
                    saved it elsewhere? paste to copy it →
                  </button>
                )}
              </div>
            )}
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
            {!!state?.keys?.length && <div className="text-[14px] text-glow/30 text-center">{state.keys[0].prefix} · active{cachedIsActive ? ' · remembered here' : ''}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
