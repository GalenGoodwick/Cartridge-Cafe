'use client'

import { useState, useEffect } from 'react'

/** Follow a world's creator — uses the cafe's ONE follow system (/api/follows,
 *  handle-based, the same CafeFollow data + notifications as the maker profile).
 *  Hidden on your own worlds and while its state is loading. */
export default function FollowButton({ handle, isOwner }: { handle?: string | null; isOwner: boolean }) {
  const [state, setState] = useState<{ following: boolean; followers: number } | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!handle || isOwner) return
    let alive = true
    fetch('/api/auth/session').then(r => r.json()).then(s => { if (alive) setSignedIn(!!s?.user) }).catch(() => {})
    fetch('/api/follows?handle=' + encodeURIComponent(handle)).then(r => r.json())
      .then(d => { if (alive) setState({ following: !!d.following, followers: d.followers || 0 }) }).catch(() => {})
    return () => { alive = false }
  }, [handle, isOwner])

  if (!handle || isOwner || !state) return null

  const toggle = async () => {
    if (busy) return
    if (!signedIn) { window.location.href = '/auth/signin'; return }
    const next = !state.following
    setBusy(true)
    setState(s => s ? { following: next, followers: Math.max(0, s.followers + (next ? 1 : -1)) } : s)
    try {
      const r = await fetch('/api/follows', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      })
      if (!r.ok) throw new Error('failed')
    } catch {
      setState(s => s ? { following: !next, followers: Math.max(0, s.followers + (next ? -1 : 1)) } : s)
    } finally { setBusy(false) }
  }

  return (
    <button
      onClick={toggle} disabled={busy}
      title={state.following ? 'following — you get their new worlds & edits' : 'follow — get their new worlds & edits'}
      className={`px-2 py-1 rounded-lg text-[14px] tracking-[0.15em] font-mono backdrop-blur border transition-colors disabled:opacity-60 ${
        state.following
          ? 'bg-amber-400/20 border-amber-300/50 text-amber-100'
          : 'bg-black/60 border-white/10 text-white/60 hover:text-white hover:bg-black/80'
      }`}
    >
      {state.following ? '✓ FOLLOWING' : '+ FOLLOW'}{state.followers > 0 ? ` · ${state.followers}` : ''}
    </button>
  )
}
