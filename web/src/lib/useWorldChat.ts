'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** ONE world-chat core — the single implementation behind BOTH renderers of a
 *  `world-chat:<KEY>` slot (and the commons slots): the full-screen ChatWorld
 *  and the compact BuilderBoxChat inside the BuilderBox. Owns the load/poll
 *  loop (4s cadence), say() (read-current → optimistic append → save →
 *  maker-notify), the signed-in `who`, the draft, and the shared snap-to-bottom
 *  handle. Visual scroll behavior (auto-stick, first-paint snap, atBottom
 *  tracking) stays per-skin — the two surfaces genuinely differ there.
 *
 *  PRESERVED DIVERGENCES (the two components behaved differently before the
 *  merge; each keeps its old behavior via opts):
 *  - verifyPost (BuilderBoxChat: true / ChatWorld: false) — BuilderBox awaits
 *    the save, READ-BACKS the slot to confirm the entry landed (a 200 is not a
 *    result — house rule), and on failure surfaces postErr, restores the
 *    draft, and SKIPS the notify. ChatWorld fire-and-forgets the save and
 *    always proceeds to the notify check.
 *  - noStore (BuilderBoxChat: true / ChatWorld: false) — BuilderBox fetches
 *    the slot with `cache: 'no-store'`; ChatWorld uses default caching.
 *  - clearOnBadPayload (ChatWorld: true / BuilderBoxChat: false) — on a
 *    payload without a msgs array, ChatWorld cleared to []; BuilderBox kept
 *    the last-known messages (the degraded-poll-safe stance).
 *  - vantage (ChatWorld only) — stamps `from` (main / ⑂ branch) on each post.
 *  Unified without an opt (no behavior change at any call site):
 *  - notify condition: fires iff channel starts with chat:world:/chat:space:.
 *    ChatWorld already gated on that prefix; BuilderBoxChat emitted
 *    unconditionally but its channel is ALWAYS one of those two prefixes.
 *  - notify fetch now always passes keepalive:true (was BuilderBox-only) so a
 *    post-then-navigate still lands the maker-notify; same request otherwise.
 *  - the poll guards setState after unmount (was BuilderBox-only; a no-op
 *    difference — React drops setState on unmounted components anyway). */

export type WorldChatMsg = { who: string; text: string; at: number; ai?: boolean; slug?: string; from?: string }

export type UseWorldChatOpts = {
  /** notification route (`chat:world:<base>` / `chat:space:<slug>` /
   *  `commons:*`) — the comment-notify fires only for the chat:* prefixes */
  channel?: string
  /** stamped on each post as `from` — where the speaker stood (main / ⑂ branch) */
  vantage?: string
  /** await the save + read back the slot to confirm the entry persisted;
   *  failure → postErr + draft restored + no notify (BuilderBoxChat) */
  verifyPost?: boolean
  /** fetch the slot with `cache: 'no-store'` (BuilderBoxChat) */
  noStore?: boolean
  /** a payload without a msgs array clears the list instead of keeping the
   *  last-known messages (ChatWorld's historical behavior) */
  clearOnBadPayload?: boolean
}

export function useWorldChat(slotKey: string, opts: UseWorldChatOpts = {}) {
  const { channel, vantage, verifyPost = false, noStore = false, clearOnBadPayload = false } = opts
  const [msgs, setMsgs] = useState<WorldChatMsg[]>([])
  const [who, setWho] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [postErr, setPostErr] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(s => setWho(s?.user?.name || null)).catch(() => {})
  }, [])

  // one read of the slot — used by the poll, the pre-post read, and the read-back
  const fetchMsgs = useCallback(async (): Promise<WorldChatMsg[] | null> => {
    const j = await fetch('/api/engine/save?slot=' + encodeURIComponent(slotKey), noStore ? { cache: 'no-store' } : undefined).then(r => r.json())
    return Array.isArray(j?.data?.msgs) ? j.data.msgs as WorldChatMsg[] : null
  }, [slotKey, noStore])

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const cur = await fetchMsgs()
        if (!live) return
        if (cur) setMsgs(cur)
        else if (clearOnBadPayload) setMsgs([])
      } catch { /* offline is fine */ }
    }
    load()
    const t = setInterval(load, 4000)
    return () => { live = false; clearInterval(t) }
  }, [fetchMsgs, clearOnBadPayload])

  const say = useCallback(async () => {
    const text = draft.trim()
    if (!text) return
    if (!who) { window.location.assign('/auth/signin?callbackUrl=' + encodeURIComponent('/')); return }
    setPostErr(null)
    let cur: WorldChatMsg[] = []
    try { cur = (await fetchMsgs()) || [] } catch { /* start fresh */ }
    const stamp = Date.now()
    const next = [...cur, { who, text: text.slice(0, 500), at: stamp, ...(vantage ? { from: vantage } : {}) }].slice(-300)
    setMsgs(next)
    setDraft('')
    const post = fetch('/api/engine/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: slotKey, data: { msgs: next } }),
    })
    if (verifyPost) {
      try {
        const w = await post
        if (!w.ok) throw new Error('save ' + w.status)
        // READ BACK — a 200 is not a result (house rule): confirm the entry landed
        const v = await fetchMsgs()
        if (!v || !v.some(m => m.at === stamp)) throw new Error('entry did not persist')
      } catch (e) {
        setPostErr('✗ didn’t post (' + String(e instanceof Error ? e.message : e).slice(0, 60) + ') — copy your text and retry')
        setDraft(text)
        return
      }
    } else {
      post.catch(() => {})
    }
    // CHAT IS CHAT (Galen): a chat entry NOTIFIES the maker (server resolves who
    // that is) — it does NOT summon the AI network; that's the SUMMON bar's job.
    // Commons channels have no maker to ping, hence the prefix gate.
    if (channel && (channel.startsWith('chat:world:') || channel.startsWith('chat:space:'))) {
      void fetch('/api/notifications', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emit: 'comment', channel, text }) }).catch(() => {})
    }
  }, [draft, who, vantage, verifyPost, channel, slotKey, fetchMsgs])

  // the way back to "now" — de-snap law: reading up is never yanked, so every
  // skin exposes one deliberate snap control wired to this
  const snapToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  return { msgs, who, draft, setDraft, say, postErr, scrollRef, snapToBottom }
}
