'use client'

import { Suspense, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

// next-auth error codes, translated into cafe language
const ERROR_TEXT: Record<string, string> = {
  OAuthAccountNotLinked: 'that email already has a deed under a different door — use the provider you first came in with.',
  OAuthCallbackError: 'the provider let go of your hand on the way back. try again.',
  AccessDenied: 'the counter turned you away. try again or use another door.',
  Callback: 'something broke on the way back in. try again.',
  Configuration: 'this door is not wired up yet.',
  CredentialsSignin: 'that name and word did not match the ledger.',
  Default: 'the door stuck. try again.',
}

function SignInInner() {
  const params = useSearchParams()
  const callbackUrl = params.get('callbackUrl') || '/'
  const errorCode = params.get('error')
  const [providers, setProviders] = useState<Record<string, unknown> | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  // only offer doors that actually open
  useEffect(() => {
    fetch('/api/auth/providers').then(r => r.json()).then(setProviders).catch(() => setProviders({}))
  }, [])

  return (
    <div className="cafe-room text-steamer flex items-center justify-center px-6">
      <div className="relative z-10 w-full max-w-sm">
        {/* the plaque */}
        <div className="cart cafe-steam arrive">
          <div className="cart-label px-6 pt-7 pb-5 text-center">
            <div className="font-mono text-[9px] tracking-[0.5em] text-brass uppercase">members&apos; counter</div>
            <h1 className="cafe-sign text-4xl mt-3">come in</h1>
            <p className="font-sans text-xs text-grounds mt-3">a world needs a name on its deed.</p>
          </div>
          <div className="px-6 py-6 space-y-3">
            {errorCode && (
              <p className="font-mono text-[10px] leading-relaxed text-flame/90 text-center pb-1">
                {ERROR_TEXT[errorCode] || ERROR_TEXT.Default}
              </p>
            )}
            {(!providers || !!providers.google) && (
              <button
                onClick={() => signIn('google', { callbackUrl })}
                className="w-full rounded-lg bg-flame/90 hover:bg-glow text-void font-mono text-[11px] tracking-[0.2em] px-6 py-3.5 transition-colors"
              >
                CONTINUE WITH GOOGLE
              </button>
            )}
            {providers && !!providers.github && (
              <button
                onClick={() => signIn('github', { callbackUrl })}
                className="w-full rounded-lg border border-brass/30 hover:border-flame/60 text-steamer/80 hover:text-glow font-mono text-[11px] tracking-[0.2em] px-6 py-3.5 transition-all"
              >
                CONTINUE WITH GITHUB
              </button>
            )}
            {/* the ledger door — email + word (CredentialsProvider was always wired; now it has a handle) */}
            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-brass/20" />
              <span className="font-mono text-[9px] tracking-[0.3em] text-grounds">OR THE LEDGER</span>
              <div className="flex-1 h-px bg-brass/20" />
            </div>
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (busy) return
                setBusy(true)
                await signIn('credentials', { email, password, callbackUrl })
                setBusy(false)
              }}
            >
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="email" autoComplete="email" required
                className="w-full rounded-lg bg-void/40 border border-brass/25 focus:border-flame/60 outline-none text-steamer font-mono text-[11px] px-4 py-3 placeholder:text-grounds"
              />
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="password" autoComplete="current-password" required
                className="w-full rounded-lg bg-void/40 border border-brass/25 focus:border-flame/60 outline-none text-steamer font-mono text-[11px] px-4 py-3 placeholder:text-grounds"
              />
              <button
                type="submit" disabled={busy}
                className="w-full rounded-lg border border-brass/30 hover:border-flame/60 text-steamer/80 hover:text-glow font-mono text-[11px] tracking-[0.2em] px-6 py-3.5 transition-all disabled:opacity-50"
              >
                {busy ? 'CHECKING THE LEDGER…' : 'SIGN THE LEDGER'}
              </button>
            </form>
          </div>
        </div>
        <a href="/" className="brass-tab inline-block px-2 py-1 text-[10px] mt-6 arrive" style={{ animationDelay: '0.2s' }}>
          ← BACK TO THE ROOM
        </a>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return <Suspense><SignInInner /></Suspense>
}
