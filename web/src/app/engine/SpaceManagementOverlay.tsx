'use client'

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

const PROD_URL = 'https://unionchant.vercel.app'

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

  // Token generation
  const [showTokenForm, setShowTokenForm] = useState(false)
  const [tokenName, setTokenName] = useState('')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)

  // Share
  const [linkCopied, setLinkCopied] = useState(false)

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

  const generateToken = async () => {
    if (!tokenName.trim()) return
    const res = await fetch(`/api/spaces/${spaceSlug}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
      body: JSON.stringify({ name: tokenName.trim() }),
    })
    if (res.ok) {
      const { token } = await res.json()
      setNewToken(token)
      setTokenName('')
      setShowTokenForm(false)
      // Refresh token list
      const tokenRes = await fetch(`/api/spaces/${spaceSlug}/token`, { headers: { Origin: window.location.origin } })
      if (tokenRes.ok) {
        const { tokens: t } = await tokenRes.json()
        setTokens(t)
      }
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

  const copyToClipboard = async (text: string, setter: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text)
      setter(true)
      setTimeout(() => setter(false), 2000)
    } catch { /* fallback: do nothing */ }
  }

  // Collapsed state — gear button (standalone mode only; embedded is always open)
  if (!open && !embedded) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-3 right-3 z-20 px-2 py-1 bg-surface/80 backdrop-blur-sm border border-border rounded text-[12px] font-mono text-muted hover:text-accent hover:border-accent/30 transition-colors"
        title="Space settings"
      >
        # {space?.name || spaceSlug}
      </button>
    )
  }

  return (
    <div className={embedded
      ? 'w-full max-h-[40vh] flex flex-col border-b border-border overflow-hidden text-[12px] font-mono'
      : 'absolute top-3 right-3 z-20 w-80 max-h-[70vh] flex flex-col bg-surface/95 backdrop-blur-sm border border-border rounded-lg overflow-hidden text-[12px] font-mono'}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        {editingName ? (
          <input
            ref={nameInputRef}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditingName(false); setNameValue(space?.name || '') } }}
            className="flex-1 bg-background border border-accent/50 rounded px-1.5 py-0.5 text-foreground text-[12px] font-mono outline-none"
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
                <span className="text-muted">visibility</span>
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
                  {space?.isPublic ? 'public' : 'private'}
                </button>
              </div>
            </div>

            {/* Share */}
            <div className="px-3 py-2 border-b border-border">
              <div className="text-muted mb-1.5">share</div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted truncate flex-1">/space/{spaceSlug}</span>
                <button
                  onClick={() => copyToClipboard(`${PROD_URL}/space/${spaceSlug}`, setLinkCopied)}
                  className="px-2 py-0.5 bg-accent/15 text-accent border border-accent/30 rounded hover:bg-accent/30 transition-colors flex-shrink-0"
                >
                  {linkCopied ? 'copied' : 'copy link'}
                </button>
              </div>
            </div>

            {/* Tokens */}
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-muted">tokens ({tokens.length})</span>
                <button
                  onClick={() => { setShowTokenForm(!showTokenForm); setNewToken(null) }}
                  className="text-accent hover:text-accent-hover transition-colors"
                >
                  {showTokenForm ? 'cancel' : '+ generate'}
                </button>
              </div>

              {/* New token display */}
              {newToken && (
                <div className="mb-1.5 p-1.5 bg-success/10 border border-success/30 rounded">
                  <div className="text-success mb-1">new token (shown once):</div>
                  <div className="flex items-center gap-1">
                    <code className="text-foreground break-all flex-1 select-all">{newToken}</code>
                    <button
                      onClick={() => copyToClipboard(newToken, setTokenCopied)}
                      className="px-1.5 py-0.5 bg-success/20 text-success border border-success/30 rounded hover:bg-success/30 transition-colors flex-shrink-0"
                    >
                      {tokenCopied ? 'ok' : 'copy'}
                    </button>
                  </div>
                </div>
              )}

              {/* Token generation form */}
              {showTokenForm && (
                <div className="flex items-center gap-1 mb-1.5">
                  <input
                    value={tokenName}
                    onChange={e => setTokenName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') generateToken() }}
                    placeholder="token name..."
                    className="flex-1 bg-background border border-border rounded px-2 py-1 text-foreground text-[12px] font-mono outline-none focus:border-accent/50"
                    autoFocus
                  />
                  <button
                    onClick={generateToken}
                    className="px-2 py-1 bg-accent/15 text-accent border border-accent/30 rounded hover:bg-accent/30 transition-colors"
                  >
                    create
                  </button>
                </div>
              )}

              {/* Token list */}
              <div className="space-y-1">
                {tokens.map(t => (
                  <div key={t.id} className="flex items-center gap-1.5 group">
                    <code className="text-muted-light flex-shrink-0">{t.tokenPrefix}</code>
                    <span className="text-foreground truncate flex-1">{t.name}</span>
                    {t.lastUsedAt && (
                      <span className="text-muted-light flex-shrink-0">{timeAgo(t.lastUsedAt)}</span>
                    )}
                    <button
                      onClick={() => revokeToken(t.id)}
                      className="text-error/50 hover:text-error opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      revoke
                    </button>
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
