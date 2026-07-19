'use client'

import { useState, useEffect } from 'react'

/** Follow a world's creator — you get their new worlds + edits in your feed.
 *  Hidden for your own worlds and while its own state is loading. Degrades
 *  quietly if the Follow table isn't migrated yet (the API returns defaults). */
export default function FollowButton({ targetId, isOwner }: { targetId?: string | null; isOwner: boolean }) {
  const [state, setState] = useState<{ following: boolean; followers: number; signedIn: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!targetId || isOwner) return
    let alive = true
    fetch(`/api/follow?targetId=${encodeURIComponent(targetId)}`)
      .then(r => r.json()).then(d => { if (alive) setState(d) }).catch(() => {})
    return () => { alive = false }
  }, [targetId, isOwner])

  if (!targetId || isOwner || !state) return null

  const toggle = async () => {
    if (busy) return
    if (!state.signedIn) { window.location.href = '/auth/signin'; return }
    const next = !state.following
    setBusy(true)
    setState(s => s ? { ...s, following: next, followers: Math.max(0, s.followers + (next ? 1 : -1)) } : s)
    try {
      const r = await fetch('/api/follow', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId }),
      })
      if (!r.ok) throw new Error('failed')
    } catch {
      setState(s => s ? { ...s, following: !next, followers: Math.max(0, s.followers + (next ? -1 : 1)) } : s)
    } finally { setBusy(false) }
  }

  return (
    <button
      onClick={toggle} disabled={busy}
      title={state.following ? 'following — you get their new worlds & edits' : 'follow — get their new worlds & edits'}
      className={`px-2 py-1 rounded-lg text-[12px] tracking-[0.15em] font-mono backdrop-blur border transition-colors disabled:opacity-60 ${
        state.following
          ? 'bg-amber-400/20 border-amber-300/50 text-amber-100'
          : 'bg-black/60 border-white/10 text-white/60 hover:text-white hover:bg-black/80'
      }`}
    >
      {state.following ? '✓ FOLLOWING' : '+ FOLLOW'}{state.followers > 0 ? ` · ${state.followers}` : ''}
    </button>
  )
}
