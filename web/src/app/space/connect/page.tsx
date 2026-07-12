'use client'

import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useState, useEffect, Suspense } from 'react'

function ConnectInner() {
  const searchParams = useSearchParams()
  const deviceCode = searchParams.get('code')
  const { data: session, status } = useSession()

  const [spaces, setSpaces] = useState<Array<{ slug: string; name: string }>>([])
  const [selectedSlug, setSelectedSlug] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // Load user's spaces
  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/spaces')
      .then(r => r.json())
      .then(data => {
        setSpaces(data.spaces || [])
        if (data.spaces?.length === 1) {
          setSelectedSlug(data.spaces[0].slug)
        }
      })
      .catch(() => setError('Failed to load spaces'))
  }, [status])

  if (!deviceCode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-surface border border-border rounded-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-serif mb-4">Connect Claude Code</h1>
          <p className="text-muted">
            Run <code className="bg-background px-2 py-0.5 rounded font-mono text-sm">npx @unitychant/space init</code> in
            your terminal to start the connection flow.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-surface border border-border rounded-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-serif mb-4">Sign In Required</h1>
          <p className="text-muted mb-4">Sign in to connect Claude Code to your space.</p>
          <a
            href={`/auth/signin?callbackUrl=${encodeURIComponent(`/space/connect?code=${deviceCode}`)}`}
            className="inline-block bg-accent text-background px-6 py-2 rounded font-medium"
          >
            Sign In
          </a>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-surface border border-border rounded-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-serif mb-2 text-success">Connected</h1>
          <p className="text-muted">
            Claude Code is now connected to your space. You can close this tab
            and return to your terminal.
          </p>
        </div>
      </div>
    )
  }

  const handleApprove = async () => {
    if (!selectedSlug) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/spaces/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', deviceCode, spaceSlug: selectedSlug }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to connect')
      } else {
        setDone(true)
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-lg p-8 max-w-md w-full">
        <h1 className="text-xl font-serif mb-2">Connect Claude Code</h1>
        <p className="text-muted text-sm mb-6">
          Code: <code className="bg-background px-2 py-0.5 rounded font-mono">{deviceCode}</code>
        </p>

        {spaces.length === 0 ? (
          <div>
            <p className="text-muted mb-4">You don{"'"}t have any spaces yet.</p>
            <a
              href="/api/spaces"
              className="text-accent underline text-sm"
            >
              Create a space first
            </a>
          </div>
        ) : (
          <>
            <label className="block text-sm text-muted mb-2">
              Which space should Claude Code program?
            </label>
            <select
              value={selectedSlug}
              onChange={e => setSelectedSlug(e.target.value)}
              className="w-full bg-background border border-border rounded px-3 py-2 mb-4 text-foreground"
            >
              <option value="">Select a space...</option>
              {spaces.map(s => (
                <option key={s.slug} value={s.slug}>{s.name}</option>
              ))}
            </select>

            {error && <p className="text-error text-sm mb-3">{error}</p>}

            <button
              onClick={handleApprove}
              disabled={!selectedSlug || loading}
              className="w-full bg-accent text-background py-2 rounded font-medium disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect'}
            </button>

            <p className="text-xs text-muted mt-4">
              This grants Claude Code access to create and modify fields, shaders,
              and interactions in your space.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default function ConnectPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    }>
      <ConnectInner />
    </Suspense>
  )
}
