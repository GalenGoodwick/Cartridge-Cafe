'use client'

import { copyText } from '@/lib/copyText'
import { useState, useEffect, useRef, useCallback } from 'react'

interface SpaceManagementOverlayProps {
  spaceSlug: string
  spaceId: string
  /** Render as a plain section inside another panel (WORLD TOOLS) instead of a
   *  standalone top-right overlay. One toolbox, not two. */
  embedded?: boolean
}

interface SpaceData {
  name: string
  description: string | null
  isPublic: boolean
}

interface TokenData {
  id: string
  name: string
  tokenPrefix: string
  lastUsedAt: string | null
  createdAt: string
}


function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function SpaceManagementOverlay({ spaceSlug, spaceId, embedded }: SpaceManagementOverlayProps) {
  const [open, setOpen] = useState(!!embedded)
  const [space, setSpace] = useState<SpaceData | null>(null)
  const [tokens, setTokens] = useState<TokenData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Inline editing state
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)


  // Pay — the OWN step of the funnel (renders only when the rail is configured)
  const [pay, setPay] = useState<{ configured: boolean; products: Array<{ key: string; label: string }>; mine: Array<{ product: string; slug?: string; active: boolean }> } | null>(null)
  const [payBusy, setPayBusy] = useState(false)
  useEffect(() => {
    fetch('/api/pay/checkout', { cache: 'no-store' }).then(r => r.json()).then(setPay).catch(() => {})
  }, [])
  const protectProduct = pay?.configured ? pay.products.find(pr => pr.key === 'protect') : undefined
  const isProtected = !!pay?.mine.some(e => e.product === 'protect' && e.slug === spaceSlug && e.active)
  const buyProtect = async () => {
    if (payBusy) return
    setPayBusy(true)
    try {
      const r = await fetch('/api/pay/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product: 'protect', slug: spaceSlug }) })
      const j = await r.json()
      if (j?.url) { window.location.assign(j.url); return }
      setError(j?.error || 'checkout unavailable')
    } catch { setError('checkout unavailable') }
    finally { setPayBusy(false) }
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [spaceRes, tokenRes] = await Promise.all([
        fetch(`/api/spaces/${spaceSlug}`, { headers: { Origin: window.location.origin } }),
        fetch(`/api/spaces/${spaceSlug}/token`, { headers: { Origin: window.location.origin } }),
      ])
      if (spaceRes.ok) {
        const { space: s } = await spaceRes.json()
        setSpace({ name: s.name, description: s.description, isPublic: s.isPublic })
        setNameValue(s.name)
      }
      if (tokenRes.ok) {
        const { tokens: t } = await tokenRes.json()
        setTokens(t)
      }
    } catch {
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }, [spaceSlug])

  useEffect(() => {
    if (open) fetchAll()
  }, [open, fetchAll])

  const patchSpace = async (data: Partial<SpaceData>) => {
    const res = await fetch(`/api/spaces/${spaceSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      const { space: s } = await res.json()
      setSpace(prev => prev ? { ...prev, ...s } : prev)
    }
  }

  const saveName = () => {
    setEditingName(false)
    if (nameValue.trim() && nameValue !== space?.name) {
      patchSpace({ name: nameValue.trim() })
    }
  }

  const revokeToken = async (tokenId: string) => {
    const res = await fetch(`/api/spaces/${spaceSlug}/token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
      body: JSON.stringify({ tokenId }),
    })
    if (res.ok) {
      setTokens(prev => prev.filter(t => t.id !== tokenId))
    }
  }

  // Collapsed state — gear button (standalone mode only; embedded is always open)
  if (!open && !embedded) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-3 right-3 z-20 px-2 py-1 bg-surface/80 backdrop-blur-sm border border-border rounded text-[14px] font-mono text-muted hover:text-accent hover:border-accent/30 transition-colors"
        title="Space settings"
      >
        # {space?.name || spaceSlug}
      </button>
    )
  }

  return (
    <div className={embedded
      ? 'w-full max-h-[40vh] flex flex-col border-b border-border overflow-hidden text-[14px] font-mono'
      : 'absolute top-3 right-3 z-20 w-80 max-h-[70vh] flex flex-col bg-surface/95 backdrop-blur-sm border border-border rounded-lg overflow-hidden text-[14px] font-mono'}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        {editingName ? (
          <input
            ref={nameInputRef}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditingName(false); setNameValue(space?.name || '') } }}
            className="flex-1 bg-background border border-accent/50 rounded px-1.5 py-0.5 text-foreground text-[14px] font-mono outline-none"
            autoFocus
          />
        ) : (
          <button
            onClick={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.select(), 0) }}
            className="text-foreground hover:text-accent transition-colors truncate text-left flex-1"
            title="Click to rename"
          >
            {space?.name || spaceSlug}
          </button>
        )}
        {!embedded && (
          <button
            onClick={() => setOpen(false)}
            className="ml-2 text-muted hover:text-foreground flex-shrink-0 w-4 h-4 flex items-center justify-center"
          >
            x
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="overflow-y-auto flex-1">
        {loading ? (
          <div className="px-3 py-4 text-muted text-center">loading...</div>
        ) : error ? (
          <div className="px-3 py-4 text-error text-center">{error}</div>
        ) : (
          <>
            {/* Visibility — the world's one front-door switch */}
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center justify-between">
                <span className="text-muted">playable</span>
                <button
                  onClick={() => {
                    const next = !space?.isPublic
                    setSpace(prev => prev ? { ...prev, isPublic: next } : prev)
                    patchSpace({ isPublic: next })
                  }}
                  className={`px-2 py-0.5 rounded border transition-colors ${
                    space?.isPublic
                      ? 'bg-success/15 text-success border-success/30'
                      : 'bg-warning/15 text-warning border-warning/30'
                  }`}
                >
                  {space?.isPublic ? 'PLAYABLE' : 'UNPLAYABLE'}
                </button>
              </div>
              {/* the commons deal, said right where the switch is thrown */}
              <div className="mt-1.5 text-[14px] leading-snug text-muted/70">
                {space?.isPublic
                  ? 'on the shelf — anyone can play it; forks (if you allow them) carry your credit through lineage'
                  : 'yours alone — no one else can open or play it'}
              </div>
            </div>

            {/* Protect — pay-to-protect, the world's shield (renders only when
                the revenue rail is configured; test-mode keys = test checkout) */}
            {protectProduct && (
              <div className="px-3 py-2 border-b border-border">
                <div className="flex items-center justify-between">
                  <span className="text-muted">protection</span>
                  {isProtected ? (
                    <span className="px-2 py-0.5 rounded border bg-success/15 text-success border-success/30">🛡 protected</span>
                  ) : (
                    <button onClick={() => void buyProtect()} disabled={payBusy}
                      className="px-2 py-0.5 rounded border bg-flame/15 text-glow border-flame/40 hover:bg-flame/25 transition-colors disabled:opacity-50">
                      {payBusy ? 'opening checkout…' : '🛡 protect this world'}
                    </button>
                  )}
                </div>
                <div className="mt-1.5 text-[14px] leading-snug text-muted/70">
                  {isProtected
                    ? 'shielded — this world cannot be overturned or clobbered'
                    : 'a small one-time shield: keeps challengers from overturning your main'}
                </div>
              </div>
            )}

            {/* KEYS & SEATS (Galen, Sep 5: 'keep the function but leave out the
                ui') — hand-minting is gone: every key now arrives through an
                automated, ATTRIBUTED pathway (green door / EDIT text, use_world
                member seats, MAKE ICON). What remains is governance: WHO holds
                a seat on this world, and the revoke hammer. */}
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-muted">keys &amp; seats on {spaceSlug} ({tokens.length})</span>
              </div>
              {/* Token list */}
              <div className="space-y-1">
                {tokens.map(t => (
                  <div key={t.id} className="flex items-center gap-1.5 group">
                    <code className="text-muted-light flex-shrink-0">{t.tokenPrefix}</code>
                    {t.name?.startsWith('member:')
                      ? <span className="truncate flex-1"><span className="text-success">@{t.name.slice(7)}</span><span className="text-muted"> — member seat</span></span>
                      : <span className="text-foreground truncate flex-1">{t.name || 'unnamed key'}</span>}
                    {t.lastUsedAt && (
                      <span className="text-muted-light flex-shrink-0">{timeAgo(t.lastUsedAt)}</span>
                    )}
                    <button
                      onClick={() => revokeToken(t.id)}
                      className="text-error/50 hover:text-error opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      revoke
                    </button>
                    {/* BAN — a kick that sticks (member rows only): revokes
                        their keys AND blocks re-entry for 30 days (invite,
                        open-world self-mint). Revoke alone = a soft kick they
                        can undo by rejoining. */}
                    {t.name.startsWith('member:') && (
                      <button
                        onClick={async () => {
                          const handle = t.name.slice(7)
                          if (!window.confirm(`ban ${handle} from this world for 30 days? Their keys die now and no invite can readmit them until it lapses.`)) return
                          const r = await fetch(`/api/spaces/${spaceSlug}/ban`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: window.location.origin }, body: JSON.stringify({ handle }) })
                          if (r.ok) setTokens(prev => prev.filter(x => !(x.name === t.name))); else setError('ban failed')
                        }}
                        className="text-error/70 hover:text-error opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 font-bold"
                        title="ban — revoke their keys AND block re-entry for 30 days"
                      >
                        ban
                      </button>
                    )}
                  </div>
                ))}
                {tokens.length === 0 && (
                  <div className="text-muted-light py-1">no active tokens</div>
                )}
              </div>
            </div>

          </>
        )}
      </div>
    </div>
  )
}
