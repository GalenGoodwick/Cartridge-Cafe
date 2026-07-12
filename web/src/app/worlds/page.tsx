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

const fresh = (iso: string) => Date.now() - new Date(iso).getTime() < 1000 * 60 * 60 * 48

/** THE SHELF — worlds as cartridges. Pull one down, or press a blank. */
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
      if (r.ok) { setSignedIn(true); setMine((await r.json()).spaces || []) }
    } catch { /* signed out */ }
  }, [])

  useEffect(() => { load() }, [load])

  const createWorld = async () => {
    if (!newName.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const d = await r.json()
      if (r.ok) router.push(`/space/${d.space.slug}`)
      else setErr(d.error || 'the press jammed — try another name')
    } finally { setBusy(false) }
  }

  const Cart = ({ w, owned, i }: { w: WorldCard; owned?: boolean; i: number }) => (
    <a
      href={`/space/${w.slug}`}
      className="cart block arrive"
      style={{ animationDelay: `${0.08 + i * 0.06}s` }}
    >
      <div className="cart-label px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="font-display italic text-xl text-glow leading-tight">{w.name}</div>
          <span className={`cart-led mt-1.5 shrink-0 ${fresh(w.updatedAt) ? '' : 'cart-led--cold'}`} />
        </div>
        {w.description && (
          <div className="text-[12px] text-crema/80 mt-1.5 line-clamp-2 font-sans">{w.description}</div>
        )}
      </div>
      <div className="px-4 py-2.5 flex items-center gap-3 font-mono text-[10px] tracking-wider text-grounds">
        <span className="truncate">{owned ? 'YOURS' : (w.owner?.name || 'ANONYMOUS').toUpperCase()}</span>
        <span className="ml-auto shrink-0">{w._count?.versions ?? 0} SAVES</span>
        {(w._count?.forks ?? 0) > 0 && <span className="shrink-0">{w._count!.forks} REMIXES</span>}
      </div>
      {w.forkOf && (
        <div className="px-4 pb-2.5 -mt-1 font-mono text-[9px] tracking-wider text-grounds/60">
          REMIX OF {w.forkOf.name.toUpperCase()}
        </div>
      )}
    </a>
  )

  const Rail = ({ children, delay }: { children: React.ReactNode; delay: number }) => (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-end">{children}</div>
      <div className="shelf-rail mt-0 mb-10 arrive" style={{ animationDelay: `${delay}s` }} />
    </>
  )

  return (
    <div className="cafe-room text-steamer">
      <div className="relative z-10 mx-auto max-w-4xl px-6 py-14">

        {/* signage */}
        <header className="mb-14 flex items-end justify-between flex-wrap gap-6">
          <div>
            <a href="/" className="brass-tab inline-block px-2 py-1 text-[10px] mb-4">← THE ROOM</a>
            <h1 className="cafe-sign text-5xl sm:text-6xl">the shelf</h1>
            <p className="font-mono text-[11px] tracking-[0.3em] text-grounds uppercase mt-3">
              every world is one file · pull it down · leave your own
            </p>
          </div>

          {/* the blank cartridge — the press */}
          {signedIn && (
            <div className="cart cafe-steam w-full sm:w-72 arrive" style={{ animationDelay: '0.15s' }}>
              <div className="cart-label px-4 pt-4 pb-3">
                <div className="font-display italic text-lg text-flame/90">a blank cartridge</div>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createWorld()}
                  placeholder="name the world…"
                  className="mt-2 w-full bg-transparent border-b border-dashed border-brass/40 pb-1 font-sans text-sm text-steamer placeholder:text-grounds/50 outline-none focus:border-flame/70 transition-colors"
                />
              </div>
              <button
                onClick={createWorld}
                disabled={busy || !newName.trim()}
                className="w-full px-4 py-2.5 font-mono text-[10px] tracking-[0.25em] text-void bg-flame/90 hover:bg-glow disabled:opacity-30 disabled:hover:bg-flame/90 transition-colors"
              >
                {busy ? 'PRESSING…' : 'PRESS IT'}
              </button>
            </div>
          )}
          {!signedIn && (
            <a href="/auth/signin" className="cart px-5 py-4 font-mono text-[11px] tracking-[0.2em] text-flame hover:text-glow arrive" style={{ animationDelay: '0.15s' }}>
              SIGN IN TO PRESS A BLANK →
            </a>
          )}
        </header>

        {err && <div className="mb-6 font-mono text-xs text-red-300/80">{err}</div>}

        {mine.length > 0 && (
          <>
            <h2 className="font-mono text-[10px] tracking-[0.4em] text-brass mb-4">YOUR RAIL</h2>
            <Rail delay={0.3}>
              {mine.map((w, i) => <Cart key={w.id} w={w} owned i={i} />)}
            </Rail>
          </>
        )}

        <h2 className="font-mono text-[10px] tracking-[0.4em] text-brass mb-4">THE HOUSE RAIL</h2>
        {publicWorlds.length === 0 ? (
          <div className="cart px-6 py-8 text-center arrive" style={{ animationDelay: '0.2s' }}>
            <div className="font-display italic text-lg text-crema">the rail is empty tonight.</div>
            <div className="font-mono text-[10px] tracking-widest text-grounds mt-2">FIRST CARTRIDGE GETS THE WARM SPOT BY THE WINDOW</div>
          </div>
        ) : (
          <Rail delay={0.4}>
            {publicWorlds.map((w, i) => <Cart key={w.id} w={w} i={i} />)}
          </Rail>
        )}

        <footer className="mt-4 text-center font-mono text-[9px] tracking-[0.4em] text-grounds/40">
          CARTRIDGE.CAFE · OPEN ALL NIGHT · FREE REFILLS
        </footer>
      </div>
    </div>
  )
}
