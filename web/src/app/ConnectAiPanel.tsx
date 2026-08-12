'use client'

import { playerConnectPrompt, cafeOrigin } from '@/lib/connectPrompt'
import { useState, useEffect, useRef } from 'react'
import { copyText } from '@/lib/copyText'

/** One copyable, individually-SELECTABLE field (Base URL / key) — so a user can
 *  grab just the URL or just the key, instead of the whole prompt being one lump
 *  (the reported "I can't select just the url" pain). Click selects only this
 *  field's value. */
function CopyField({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 text-[11px] tracking-[0.12em] text-glow/35">{label}</span>
      <input readOnly value={value} onFocus={e => e.currentTarget.select()}
        className="min-w-0 flex-1 select-all truncate rounded-md border border-brass/25 bg-black/50 px-2 py-1 text-[12px] text-glow/85" />
      <button onClick={onCopy} className="shrink-0 rounded-md border border-brass/30 px-2 py-1 text-[12px] text-steamer/70 hover:text-glow">
        {copied ? '✓' : 'copy'}
      </button>
    </div>
  )
}

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

/** The CONNECT-AI body (paste-a-prompt door). Rendered inside <ConnectPanel/>,
 *  which owns the modal chrome (overlay, tab bar, Escape/× close). */
export default function ConnectAiPanel() {
  const [state, setState] = useState<{ signedIn: boolean; keys: Array<{ prefix: string; createdAt: string }>; failed?: boolean } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)   // raw key, shown once
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [manual, setManual] = useState<string | null>(null)   // clipboard blocked → show text to copy by hand
  // Read the remembered key on the FIRST render (lazy init), not in an effect —
  // otherwise `cached` is null on the paint where `state` first resolves, and the
  // panel briefly shows the "paste your key to remember it" box before a reload
  // settles it. Reading synchronously makes the box decision right on first paint.
  const [cached, setCached] = useState<{ prefix: string; raw: string } | null>(() => readCached())   // this browser's remembered key
  const [paste, setPaste] = useState('')          // paste-to-remember a key minted elsewhere
  const [showPaste, setShowPaste] = useState(false)
  const [pasteErr, setPasteErr] = useState('')

  // Never hang the dialog. The GET used to swallow any failure (.catch(()=>{})),
  // so a slow/erroring /api/player-token (e.g. a degraded DB) left the primary
  // body stuck on its "…" spinner forever — only the MCP link usable (the bug in
  // Galen's screenshot). Now failure AND a 6s timeout both resolve to a fallback
  // state, so the panel always lands on something actionable. A functional update
  // never clobbers a real result that raced in first.
  const load = () => fetch('/api/player-token', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
    .then(d => setState({ signedIn: !!d?.signedIn, keys: Array.isArray(d?.keys) ? d.keys : [] }))
    .catch(() => setState(prev => prev ?? { signedIn: false, keys: [], failed: true }))
  useEffect(() => {
    load()
    const t = setTimeout(() => setState(prev => prev ?? { signedIn: false, keys: [], failed: true }), 6000)
    return () => clearTimeout(t)
  }, [])

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
        // Best-effort auto-copy the moment the key exists — a convenience, not the
        // reliable path. It runs AFTER the await, so the click's user-activation is
        // already spent: clipboard writes usually reject here (and the execCommand
        // fallback too). So it's SILENT — a failure must NOT flip the button to
        // "COPY BLOCKED" before the user ever clicks it. The visible COPY button
        // below is the reliable path: it copies inside its own click gesture.
        copy(prompt(d.token), 'prompt', true)
      }
    } finally { setBusy(false) }
  }
  const revoke = async () => {
    setBusy(true)
    try { await fetch('/api/player-token', { method: 'DELETE' }); clearCached(); setCached(null); setFresh(null); load() } finally { setBusy(false) }
  }

  // AUTO-GENERATE a key so the prompt is ready the instant the popup opens — the
  // user shouldn't have to press "mint" for the default path (Galen). Only when
  // signed in with NO key on the account: there's nothing to revoke, so it's safe
  // to do silently. When a key already exists we NEVER auto-mint — minting a new
  // one revokes the old, and that's the user's explicit choice (the MINT A NEW
  // KEY button). If the browser already remembers a key, that one is reused as-is.
  const autoMinted = useRef(false)
  useEffect(() => {
    if (autoMinted.current || busy || fresh) return
    if (state?.signedIn && state.keys.length === 0) {
      autoMinted.current = true
      mint()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, busy, fresh])
  // when even the fallback can't write the clipboard, show the text itself so
  // the player can select-and-copy by hand — never a dead button. `silent` is for
  // best-effort auto-copies (e.g. right after mint, past the gesture window): on
  // failure they stay quiet instead of falsely warning about a copy nobody asked for.
  const copy = (t: string, k: string, silent = false) => {
    copyText(t).then(ok => {
      if (ok) { setManual(null); setCopied(k); setTimeout(() => setCopied(''), 1600) }
      else if (!silent) { setManual(t); setCopied('fail:' + k); setTimeout(() => setCopied(''), 2400) }
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

  // The connect prompt for THIS browser's remembered key — always offer-able,
  // independent of the server round-trip. Galen's law: CONNECT AI must ALWAYS
  // show the prompt to copy, never gate it behind a spinner or a signed-out nag.
  const cachedPromptBlock = (note?: string) => cached && (
    <div className="space-y-2">
      <button onClick={() => copy(prompt(cached.raw), 'prompt')}
        className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-[14px] tracking-[0.15em] text-void font-bold transition-all">
        {copied === 'prompt' ? 'COPIED ✓' : copied === 'fail:prompt' ? '⚠ COPY BLOCKED — select below' : '📋 COPY CONNECT PROMPT'}
      </button>
      <div className="space-y-1.5 pt-0.5">
        <div className="text-[11px] tracking-[0.1em] text-glow/30">…or grab one piece:</div>
        <CopyField label="Base URL" value={cafeOrigin()} onCopy={() => copy(cafeOrigin(), 'url')} copied={copied === 'url'} />
        <CopyField label="Key" value={cached.raw} onCopy={() => copy(cached.raw, 'key')} copied={copied === 'key'} />
      </div>
      {manual !== null && (
        <textarea readOnly value={manual} rows={6} onFocus={e => e.currentTarget.select()}
          className="w-full rounded-md border border-amber-400/40 bg-black/60 px-2 py-1.5 text-[12px] leading-relaxed text-glow/90 select-all resize-none" />
      )}
      {note && <div className="text-[12px] text-glow/40 leading-snug">{note}</div>}
    </div>
  )

  return (
    <>
        <div className="text-[14px] text-glow/45 leading-relaxed mb-2">
          Your personal key — it lets an AI chat the commons and build <b>your own</b> worlds. Shown once, revocable.
        </div>
        <div className="text-[13px] text-emerald-300/80 leading-relaxed mb-2 rounded-md border border-emerald-400/25 bg-emerald-400/[0.06] px-2.5 py-2">
          <b>Nothing installs on your computer, and you run no commands.</b> You paste <b>one message</b> into an AI assistant and it makes the web requests — not you. Revoke the key anytime.
        </div>
        <div className="text-[13px] text-glow/50 leading-relaxed mb-3 rounded-md border border-brass/25 bg-brass/5 px-2.5 py-2">
          It just needs an AI that can reach the internet — <b>Claude Code</b>, Cursor, or any coding/agent tool. A normal chat window (ChatGPT, Claude.ai) can’t make the web requests to build here. Paste the prompt below into one of those and it does the rest.
        </div>
        {!state ? (
          // still checking the account — but a spinner is never the whole story:
          // if THIS browser remembers a key, hand over its prompt immediately
          // (account controls fill in underneath once state resolves).
          cached ? cachedPromptBlock() : (
            <div className="text-[14px] text-glow/35 text-center py-3 tracking-[0.15em]">…</div>
          )
        ) : state.failed ? (
          // account fetch failed (e.g. DB degraded). Don't misfire "sign in" at a
          // user who IS signed in; if we hold a remembered key, offer it anyway.
          cached ? cachedPromptBlock('couldn’t verify your account just now — this remembered key still works until you revoke it') : (
            <div className="space-y-2">
              <div className="text-[14px] text-amber-200/80 leading-snug">Couldn’t reach your account just now.</div>
              <button onClick={() => { setState(null); load() }} className="w-full rounded-md border border-brass/40 py-2 text-[14px] tracking-[0.15em] text-flame/80 hover:text-flame">RETRY</button>
              <a href="/auth/signin" className="block text-center text-[13px] text-glow/40 hover:text-glow">or sign in</a>
            </div>
          )
        ) : !state.signedIn ? (
          cached ? cachedPromptBlock() : (
            <a href="/auth/signin" className="block text-center rounded-md border border-brass/40 py-2 text-[14px] tracking-[0.15em] text-flame/80 hover:text-flame">sign in to mint a key</a>
          )
        ) : fresh ? (
          <div className="space-y-2">
            <div className="text-[14px] text-emerald-300 tracking-[0.15em]">PASTE TO YOUR AI — shown once</div>
            <button onClick={() => copy(prompt(fresh), 'prompt')}
              className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-[14px] tracking-[0.15em] text-void font-bold transition-all">
              {copied === 'prompt' ? 'COPIED ✓' : copied === 'fail:prompt' ? '⚠ COPY BLOCKED — select below' : '📋 COPY CONNECT PROMPT'}
            </button>
            <div className="space-y-1.5 pt-0.5">
              <div className="text-[11px] tracking-[0.1em] text-glow/30">…or grab one piece:</div>
              <CopyField label="Base URL" value={cafeOrigin()} onCopy={() => copy(cafeOrigin(), 'url')} copied={copied === 'url'} />
              <CopyField label="Key" value={fresh} onCopy={() => copy(fresh, 'key')} copied={copied === 'key'} />
            </div>
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
                <div className="space-y-1.5 pt-0.5">
                  <div className="text-[11px] tracking-[0.1em] text-glow/30">…or grab one piece:</div>
                  <CopyField label="Base URL" value={cafeOrigin()} onCopy={() => copy(cafeOrigin(), 'url')} copied={copied === 'url'} />
                  <CopyField label="Key" value={cached!.raw} onCopy={() => copy(cached!.raw, 'key')} copied={copied === 'key'} />
                </div>
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
    </>
  )
}
