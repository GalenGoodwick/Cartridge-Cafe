'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface WorldCard {
  id: string
  slug: string
  name: string
  description: string | null
  updatedAt: string
  owner?: { id: string; name: string | null; image: string | null }
  forkOf?: { slug: string; name: string } | null
  _count?: { versions: number; forks: number; flags: number }
}

/** /worlds — the gallery: browse public worlds, jump into yours, make a new one. */
export default function WorldsPage() {
  const router = useRouter()
  const [publicWorlds, setPublicWorlds] = useState<WorldCard[]>([])
  const [mine, setMine] = useState<WorldCard[]>([])
  const [signedIn, setSignedIn] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/spaces/browse')
      if (r.ok) setPublicWorlds((await r.json()).spaces || [])
    } catch { /* fine */ }
    try {
      const r = await fetch('/api/spaces')
      if (r.ok) {
        setSignedIn(true)
        setMine((await r.json()).spaces || [])
      }
    } catch { /* signed out */ }
  }, [])

  useEffect(() => { load() }, [load])

  const createWorld = async () => {
    if (!newName.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const d = await r.json()
      if (r.ok) router.push(`/space/${d.space.slug}`)
      else setErr(d.error || 'Could not create world')
    } finally { setBusy(false) }
  }

  const Card = ({ w, owned }: { w: WorldCard; owned?: boolean }) => (
    <a
      href={`/space/${w.slug}`}
      className="block rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition-colors p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-serif text-lg text-white/90">{w.name}</div>
        {owned && <span className="text-[10px] rounded bg-accent/20 text-accent px-1.5 py-0.5">yours</span>}
      </div>
      {w.owner && <div className="text-xs text-white/40 mt-0.5">by {w.owner.name || 'anonymous'}</div>}
      {w.description && <div className="text-sm text-white/60 mt-2 line-clamp-2">{w.description}</div>}
      <div className="flex gap-3 mt-3 text-[11px] text-white/40">
        {w._count && <span>{w._count.versions} save points</span>}
        {w._count && w._count.forks > 0 && <span>{w._count.forks} remixes</span>}
        {w.forkOf && <span className="text-white/30">remix of {w.forkOf.name}</span>}
        <span className="ml-auto">{new Date(w.updatedAt).toLocaleDateString()}</span>
      </div>
    </a>
  )

  return (
    <div className="min-h-screen bg-[#0b0f1a] px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
          <div>
            <h1 className="font-serif text-3xl text-white/95">Worlds</h1>
            <p className="text-sm text-white/50 mt-1">
              Living spaces built by people and AIs. Visit any of them. Remix the ones you love.
            </p>
          </div>
          {signedIn && (
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createWorld()}
                placeholder="Name a new world…"
                className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50"
              />
              <button
                onClick={createWorld}
                disabled={busy || !newName.trim()}
                className="rounded-lg bg-accent/80 hover:bg-accent text-white text-sm px-4 py-2 disabled:opacity-40 transition-colors"
              >
                Create
              </button>
            </div>
          )}
        </div>

        {err && <div className="mb-4 text-sm text-error">{err}</div>}

        {mine.length > 0 && (
          <>
            <h2 className="text-sm uppercase tracking-wide text-white/40 mb-3">Your worlds</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-10">
              {mine.map(w => <Card key={w.id} w={w} owned />)}
            </div>
          </>
        )}

        <h2 className="text-sm uppercase tracking-wide text-white/40 mb-3">Public worlds</h2>
        {publicWorlds.length === 0 ? (
          <div className="text-white/40 text-sm rounded-xl border border-dashed border-white/10 p-8 text-center">
            No public worlds yet. {signedIn ? 'Yours could be the first.' : 'Sign in to make the first one.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {publicWorlds.map(w => <Card key={w.id} w={w} />)}
          </div>
        )}
      </div>
    </div>
  )
}
