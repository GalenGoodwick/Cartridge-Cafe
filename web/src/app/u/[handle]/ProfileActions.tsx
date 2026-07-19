'use client'

import { useEffect, useState } from 'react'

/** Follow button + follower count + (on your own page) the icon door. */
export default function ProfileActions({ handle }: { handle: string }) {
  const [followers, setFollowers] = useState(0)
  const [following, setFollowing] = useState(false)
  const [mine, setMine] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = () => fetch('/api/follows?handle=' + encodeURIComponent(handle)).then(r => r.json())
    .then(d => { setFollowers(d.followers || 0); setFollowing(!!d.following) }).catch(() => {})

  useEffect(() => {
    refresh()
    fetch('/api/auth/session').then(r => r.json()).then(s => {
      const h = (s?.user?.email || '').split('@')[0].replace(/[^a-z0-9_-]/gi, '')
      setMine(!!h && h === handle)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle])

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="text-[11px] text-[#8a7454]">{followers} follower{followers === 1 ? '' : 's'}</div>
      {mine ? (
        <a href="/?icon=1"
          className="rounded-lg border border-[#f5b04c]/50 px-4 py-2 text-[11px] tracking-[0.2em] text-[#f5b04c] hover:bg-[#f5b04c]/10 transition-colors">
          ◆ BREW YOUR ICON
        </a>
      ) : (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = await fetch('/api/follows', {
              method: following ? 'DELETE' : 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ handle }),
            })
            if (r.status === 401) window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent('/u/' + handle)
            await refresh(); setBusy(false)
          }}
          className={`rounded-lg px-4 py-2 text-[11px] tracking-[0.2em] transition-colors border ${following
            ? 'border-[#8a7454]/50 text-[#8a7454] hover:text-[#e8d5b5]'
            : 'border-[#f5b04c]/50 text-[#f5b04c] hover:bg-[#f5b04c]/10'}`}
        >
          {following ? '✓ FOLLOWING' : '+ FOLLOW'}
        </button>
      )}
    </div>
  )
}
