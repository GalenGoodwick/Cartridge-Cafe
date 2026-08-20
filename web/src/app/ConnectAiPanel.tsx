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

/** CONNECT AI to the cafe — your personal PLAYER KEY. Galen's law (Aug 20):
 *  the current key is ALWAYS copyable by its signed-in owner, from any browser —
 *  the server stores it encrypted at rest and hands it back on GET. This
 *  replaced the shown-once + localStorage-remembered model, whose stale cache
 *  first-painted a revoked key's copy UI and then yanked to a mismatch box (the
 *  "phantom second window" Galen hit live). One view now: COPY · MINT NEW
 *  (revokes old) · REVOKE. Keys minted before this ship have no stored raw —
 *  a one-time verified paste restores them. */
export type KeyState = {
  signedIn: boolean
  keys: Array<{ prefix: string; createdAt: string }>
  raw?: string          // the current key, decrypted for its owner — the always-copyable path
  failed?: boolean      // fetch failed / timed out
  degraded?: boolean    // server answered but couldn't read keys (DB blip) — not key-less truth
} | null

/** The CONNECT-AI body (paste-a-prompt door). Rendered inside <ConnectPanel/>,
 *  which owns the modal chrome (overlay, tab bar, Escape/× close). */
export default function ConnectAiPanel() {
  const [state, setState] = useState<KeyState>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [manual, setManual] = useState<string | null>(null)   // clipboard blocked → show text to copy by hand
  const [paste, setPaste] = useState('')                      // one-time restore of a pre-retrievable key
  const [showPaste, setShowPaste] = useState(false)
  const [pasteErr, setPasteErr] = useState('')

  // Never hang the dialog: failure AND a 6s timeout both resolve to a fallback
  // state, so the panel always lands on something actionable. A functional
  // update never clobbers a real result that raced in first.
  const load = () => fetch('/api/player-token', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
    .then(d => setState({
      signedIn: !!d?.signedIn,
      keys: Array.isArray(d?.keys) ? d.keys : [],
      raw: typeof d?.raw === 'string' ? d.raw : undefined,
      degraded: !!d?.degraded,
    }))
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
        await load()   // GET returns the raw from now on — one source of truth
        // best-effort auto-copy; silent because the click's user-activation is
        // already spent and clipboard writes usually reject here. The COPY
        // button is the reliable path.
        copy(prompt(d.token), 'prompt', true)
      }
    } finally { setBusy(false) }
  }
  const revoke = async () => {
    setBusy(true)
    try { await fetch('/api/player-token', { method: 'DELETE' }); await load() } finally { setBusy(false) }
  }
  const restore = async () => {
    setPasteErr('')
    const raw = paste.trim()
    if (!raw.startsWith('uc_pt_')) { setPasteErr('that is not a uc_pt_ key'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/player-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restore: raw }) })
      if (r.ok) { setPaste(''); setShowPaste(false); await load() }
      else setPasteErr((await r.json().catch(() => null))?.error || 'could not restore')
    } finally { setBusy(false) }
  }

  // when even the fallback can't write the clipboard, show the text itself so
  // the player can select-and-copy by hand — never a dead button. `silent` is for
  // best-effort auto-copies: on failure they stay quiet instead of falsely
  // warning about a copy nobody asked for.
  const copy = (t: string, k: string, silent = false) => {
    copyText(t).then(ok => {
      if (ok) { setManual(null); setCopied(k); setTimeout(() => setCopied(''), 1600) }
      else if (!silent) { setManual(t); setCopied('fail:' + k); setTimeout(() => setCopied(''), 2400) }
    })
  }

  // AUTO-GENERATE a key so the prompt is ready the instant the popup opens —
  // only when signed in with NO key at all: nothing to revoke, safe to do
  // silently. When a key exists we NEVER auto-mint (minting revokes the old —
  // that's the user's explicit choice via the MINT A NEW KEY button).
  const autoMinted = useRef(false)
  useEffect(() => {
    if (autoMinted.current || busy) return
    if (state?.signedIn && !state.degraded && !state.failed && state.keys.length === 0) {
      autoMinted.current = true
      mint()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, busy])

  const activePrefix = state?.keys?.[0]?.prefix ?? null

  return (
    <>
        <div className="text-[14px] text-glow/45 leading-relaxed mb-2">
          Your personal key — it lets an AI chat the commons and build <b>your own</b> worlds. Always copyable here, revocable anytime.
        </div>
        <div className="text-[13px] text-emerald-300/80 leading-relaxed mb-2 rounded-md border border-emerald-400/25 bg-emerald-400/[0.06] px-2.5 py-2">
          <b>Nothing installs on your computer, and you run no commands.</b> You paste <b>one message</b> into an AI assistant and it makes the web requests — not you. Revoke the key anytime.
        </div>
        <div className="text-[13px] text-glow/50 leading-relaxed mb-3 rounded-md border border-brass/25 bg-brass/5 px-2.5 py-2">
          It just needs an AI that can reach the internet — <b>Claude Code</b>, Cursor, or any coding/agent tool. A normal chat window (ChatGPT, Claude.ai) can’t make the web requests to build here. Paste the prompt below into one of those and it does the rest.
        </div>
        {!state ? (
          <div className="text-[14px] text-glow/35 text-center py-3 tracking-[0.15em]">…</div>
        ) : state.failed || state.degraded ? (
          <div className="space-y-2">
            <div className="text-[14px] text-amber-200/80 leading-snug">Couldn’t reach your account just now.</div>
            <button onClick={() => { setState(null); load() }} className="w-full rounded-md border border-brass/40 py-2 text-[14px] tracking-[0.15em] text-flame/80 hover:text-flame">RETRY</button>
            {!state.signedIn && <a href="/auth/signin" className="block text-center text-[13px] text-glow/40 hover:text-glow">or sign in</a>}
          </div>
        ) : !state.signedIn ? (
          <a href="/auth/signin" className="block text-center rounded-md border border-brass/40 py-2 text-[14px] tracking-[0.15em] text-flame/80 hover:text-flame">sign in to mint a key</a>
        ) : (
          <div className="space-y-2">
            {/* THE always-copyable current key */}
            {state.raw && (
              <>
                <button onClick={() => copy(prompt(state.raw!), 'prompt')}
                  className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-[14px] tracking-[0.15em] text-void font-bold transition-all">
                  {copied === 'prompt' ? 'COPIED ✓' : copied === 'fail:prompt' ? '⚠ COPY BLOCKED — select below' : '📋 COPY CONNECT PROMPT'}
                </button>
                <button onClick={() => copy(state.raw!, 'key')}
                  className="w-full rounded-md border border-brass/30 px-3 py-1.5 text-[14px] text-steamer/70 hover:text-glow">
                  {copied === 'key' ? 'copied ✓' : copied === 'fail:key' ? '⚠ copy blocked — select below' : 'copy just my key'}
                </button>
                <div className="space-y-1.5 pt-0.5">
                  <div className="text-[11px] tracking-[0.1em] text-glow/30">…or grab one piece:</div>
                  <CopyField label="Base URL" value={cafeOrigin()} onCopy={() => copy(cafeOrigin(), 'url')} copied={copied === 'url'} />
                  <CopyField label="Key" value={state.raw} onCopy={() => copy(state.raw!, 'key2')} copied={copied === 'key2'} />
                </div>
                {manual !== null && (
                  <textarea readOnly value={manual} rows={6} onFocus={e => e.currentTarget.select()}
                    className="w-full rounded-md border border-amber-400/40 bg-black/60 px-2 py-1.5 text-[12px] leading-relaxed text-glow/90 select-all resize-none" />
                )}
              </>
            )}
            {/* a key exists but predates retrievable storage — one verified paste restores it */}
            {!state.raw && !!activePrefix && (
              <div className="rounded-md border border-brass/25 bg-brass/5 px-2.5 py-2 space-y-1.5">
                <div className="text-[12px] text-glow/50 leading-snug">
                  Your current key ({activePrefix}) was minted before keys became re-copyable, so the cafe can’t show it. Paste it once if you have it — it’ll be copyable here forever after — or mint a new one below.
                </div>
                {showPaste ? (
                  <>
                    <input value={paste} onChange={e => setPaste(e.target.value)} placeholder="uc_pt_…" autoFocus
                      className="w-full rounded-md border border-brass/30 bg-black/60 px-2 py-1.5 text-[12px] text-glow/90 placeholder-glow/25" />
                    {pasteErr && <div className="text-[12px] text-red-400/80">{pasteErr}</div>}
                    <div className="flex gap-1.5">
                      <button disabled={busy} onClick={restore} className="flex-1 rounded-md bg-flame hover:bg-glow px-2 py-1.5 text-[13px] tracking-[0.1em] text-void font-bold disabled:opacity-50">RESTORE</button>
                      <button onClick={() => { setShowPaste(false); setPaste(''); setPasteErr('') }} className="rounded-md border border-brass/30 px-2 py-1.5 text-[13px] text-glow/50 hover:text-glow">cancel</button>
                    </div>
                  </>
                ) : (
                  <button onClick={() => setShowPaste(true)} className="text-[12px] text-steamer/60 hover:text-glow underline underline-offset-2">
                    have it saved somewhere? paste to restore it →
                  </button>
                )}
              </div>
            )}
            <button disabled={busy} onClick={mint}
              className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-[14px] tracking-[0.15em] text-void font-bold transition-all disabled:opacity-50">
              {busy ? '…' : (state.keys.length ? '↻ MINT A NEW KEY (revokes old)' : '⚿ MINT PLAYER KEY')}
            </button>
            {!!state.keys.length && (
              <button disabled={busy} onClick={revoke}
                className="w-full rounded-md border border-red-500/40 hover:border-red-400 px-3 py-1.5 text-[14px] tracking-[0.15em] text-red-400/70 hover:text-red-400 transition-all">
                REVOKE {state.keys.length === 1 ? 'MY KEY' : `ALL (${state.keys.length})`}
              </button>
            )}
            {!!state.keys.length && <div className="text-[14px] text-glow/30 text-center">{state.keys[0].prefix} · active{state.raw ? ' · copyable anytime' : ''}</div>}
          </div>
        )}
    </>
  )
}
