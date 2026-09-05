'use client'

import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useState, useEffect, Suspense } from 'react'

// /pair?code=XXXX — register an AI and this account TOGETHER. The AI initiated
// a pairing over the bridge; the human signs in (or up — guest data survives
// auth as always) and one click gives the AI its own revocable key and claims
// every world it brewed as a guest onto the account.

function PairInner() {
  const searchParams = useSearchParams()
  const code = (searchParams.get('code') || '').toUpperCase()
  const { data: session, status } = useSession()

  const [info, setInfo] = useState<{ aiName: string; status: string; hasGuestWorlds: boolean } | null>(null)
  const [infoError, setInfoError] = useState('')
  const [loading, setLoading] = useState(false)
  const [claimed, setClaimed] = useState<number | null>(null)
  const [gifted, setGifted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!code) return
    fetch(`/api/ai/pair?code=${encodeURIComponent(code)}&info=1`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setInfo)
      .catch(() => setInfoError('This pairing code is expired or invalid. Ask your AI to start again.'))
  }, [code])

  const card = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-lg p-8 max-w-md w-full">{children}</div>
    </div>
  )

  if (!code) {
    return card(
      <>
        <h1 className="text-xl font-serif mb-2">Register an AI with your account</h1>
        <p className="text-muted text-sm">
          This page connects an AI to your account. Ask your AI to connect its
          account (in Claude Code: ask it to “connect to my cartridge.cafe
          account”) — it will give you a link back here with a code.
        </p>
      </>
    )
  }

  if (infoError) {
    return card(
      <>
        <h1 className="text-xl font-serif mb-2">Code expired</h1>
        <p className="text-muted text-sm">{infoError}</p>
      </>
    )
  }

  if (status === 'loading' || !info) {
    return card(<p className="text-muted">Loading…</p>)
  }

  if (status === 'unauthenticated') {
    return card(
      <>
        <h1 className="text-xl font-serif mb-2">Almost there</h1>
        <p className="text-muted text-sm mb-1">
          <b className="text-foreground">{info.aiName}</b> wants to register with your account.
        </p>
        <p className="text-muted text-sm mb-5">
          Sign in — or sign up, it takes a moment. Everything you or your AI
          made as a guest carries through and becomes yours.
        </p>
        <a
          href={`/auth/signin?callbackUrl=${encodeURIComponent(`/pair?code=${code}`)}`}
          className="inline-block bg-accent text-background px-6 py-2 rounded font-medium"
        >
          Sign in / Sign up
        </a>
      </>
    )
  }

  if (claimed !== null) {
    return card(
      <>
        <h1 className="text-xl font-serif mb-2 text-success">Registered together</h1>
        {gifted && (
          <div className="mb-3 p-3 rounded-lg border border-amber-300/40 bg-amber-400/10">
            <div className="text-amber-200 text-sm font-bold mb-0.5">🎁 first-pairing gift — yours now</div>
            <div className="text-foreground text-sm">30 days of the editing membership + 2 world builds.</div>
          </div>
        )}
        <p className="text-muted text-sm mb-2">
          <b className="text-foreground">{info.aiName}</b> now builds as you: it holds its own
          key (revocable any time in the account menu → ⚿ CONNECT AI), and every
          world it creates is yours.
        </p>
        {claimed > 0 && (
          <p className="text-muted text-sm mb-2">
            {claimed} world{claimed === 1 ? '' : 's'} it already brewed {claimed === 1 ? 'was' : 'were'} claimed to your account.
          </p>
        )}
        <p className="text-muted text-sm">You can close this tab and return to your AI.</p>
      </>
    )
  }

  const handleRegister = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/ai/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', code }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'Failed to register')
      else { setClaimed(data.claimedWorlds ?? 0); setGifted(!!data.firstPairGift) }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return card(
    <>
      <h1 className="text-xl font-serif mb-2">Register {info.aiName}</h1>
      <p className="text-muted text-sm mb-4">
        Code: <code className="bg-background px-2 py-0.5 rounded font-mono">{code}</code>
      </p>
      <p className="text-muted text-sm mb-2">Registering pairs this AI with your account:</p>
      <ul className="text-muted text-sm mb-5 list-disc pl-5 space-y-1">
        <li>it gets its own key — labeled, revocable any time, separate from your other keys</li>
        <li>worlds it builds are born owned by you</li>
        {info.hasGuestWorlds && <li>worlds it already brewed as a guest transfer to you now</li>}
      </ul>

      {error && <p className="text-error text-sm mb-3">{error}</p>}

      <button
        onClick={handleRegister}
        disabled={loading}
        className="w-full bg-accent text-background py-2 rounded font-medium disabled:opacity-50"
      >
        {loading ? 'Registering…' : 'Register together'}
      </button>
    </>
  )
}

export default function PairPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted">Loading…</p>
      </div>
    }>
      <PairInner />
    </Suspense>
  )
}
