'use client'

import { Suspense, useEffect, useState } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { NotifyMeButton } from '@/components/NotifyMeButton'

// next-auth error codes, translated into cafe language
const ERROR_TEXT: Record<string, string> = {
  OAuthAccountNotLinked: 'that email already has a deed under a different door — use the provider you first came in with.',
  OAuthCallbackError: 'the provider let go of your hand on the way back. try again.',
  AccessDenied: 'the counter turned you away. try again or use another door.',
  Callback: 'something broke on the way back in. try again.',
  Configuration: 'this door is not wired up yet.',
  CredentialsSignin: 'that door would not open. try again, or use another.',
  Default: 'the door stuck. try again.',
}

function SignInInner() {
  const params = useSearchParams()
  const callbackUrl = params.get('callbackUrl') || '/'
  const errorCode = params.get('error')
  const [providers, setProviders] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: session } = useSession()

  // only offer doors that actually open
  useEffect(() => {
    fetch('/api/auth/providers').then(r => r.json()).then(setProviders).catch(() => setProviders({}))
  }, [])

  // Enter through an OAuth door.
  const enterThrough = async (provider: string) => {
    if (busy) return
    setBusy(true)
    try {
      await signIn(provider, { callbackUrl })
    } finally { setBusy(false) }
  }

  return (
    <div className="cafe-room text-steamer flex items-center justify-center px-6">
      {/* the way out, always in reach — the only back link used to hide below
          the fold at the card's foot */}
      <button
        onClick={() => { if (history.length > 1) history.back(); else window.location.href = '/' }}
        className="fixed top-5 left-5 z-50 brass-tab px-3 py-1.5 text-[14px] font-mono tracking-[0.2em]"
      >
        ← BACK
      </button>
      <div className="relative z-10 w-full max-w-sm">
        {/* the plaque */}
        <div className="cart cafe-steam arrive">
          <div className="cart-label px-6 pt-7 pb-5 text-center">
            <div className="font-mono text-[14px] tracking-[0.5em] text-brass uppercase">members&apos; counter</div>
            <h1 className="cafe-sign text-4xl mt-3">come in</h1>
            <p className="font-sans text-xs text-grounds mt-3">a world needs a name on its deed.</p>
          </div>
          <div className="px-6 py-6 space-y-3">
            {session?.user && (
              <div className="rounded-lg border border-brass/25 bg-void/30 px-4 py-3.5 space-y-2">
                <div className="font-mono text-[14px] tracking-[0.25em] text-brass">YOU ARE IN AS {(session.user.email || '').toUpperCase()}</div>
                <div className="pt-1">
                  <p className="font-sans text-[16px] text-grounds mb-2">get a ping when a world you brewed finishes building — even after you leave.</p>
                  <NotifyMeButton label="🔔 TURN ON NOTIFICATIONS" onLabel="🔔 NOTIFICATIONS ON" className="items-stretch" />
                </div>
              </div>
            )}
            {errorCode && (
              <p className="font-mono text-[14px] leading-relaxed text-flame/90 text-center pb-1">
                {ERROR_TEXT[errorCode] || ERROR_TEXT.Default}
              </p>
            )}
            {/* The sign-in DOORS. Once you're in they vanish — the only
                thing left is the post-auth card above. */}
            {!session?.user && <>
            {(!providers || !!providers.google) && (
              <button
                onClick={() => enterThrough('google')}
                disabled={busy}
                className="w-full rounded-lg bg-flame/90 hover:bg-glow text-void font-mono text-[16px] tracking-[0.2em] px-6 py-3.5 transition-colors disabled:opacity-50"
              >
                CONTINUE WITH GOOGLE
              </button>
            )}
            {providers && !!providers.github && (
              <button
                onClick={() => enterThrough('github')}
                disabled={busy}
                className="w-full rounded-lg border border-brass/30 hover:border-flame/60 text-steamer/80 hover:text-glow font-mono text-[16px] tracking-[0.2em] px-6 py-3.5 transition-all disabled:opacity-50"
              >
                CONTINUE WITH GITHUB
              </button>
            )}
            {/* clickwrap: continuing = agreeing, with the commons deal stated plainly */}
            <div className="pt-2 text-center font-mono text-[14px] leading-relaxed text-crema/40">
              by continuing you agree to the{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-brass hover:text-flame underline">terms</a> &amp;{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brass hover:text-flame underline">privacy</a>.
              <br />worlds you make playable are open to everyone · forking is yours to allow · unpublished stays yours.
            </div>
            </>}
            {/* once signed in, the way onward — the doors above are gone. */}
            {session?.user && (
              <a href={callbackUrl}
                className="block w-full text-center rounded-lg bg-flame/90 hover:bg-glow text-void font-mono text-[16px] tracking-[0.2em] px-6 py-3.5 transition-colors">
                ENTER THE CAFE →
              </a>
            )}
          </div>
        </div>
        <a href="/" className="brass-tab inline-block px-2 py-1 text-[14px] mt-6 arrive" style={{ animationDelay: '0.2s' }}>
          ← BACK TO THE ROOM
        </a>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return <Suspense><SignInInner /></Suspense>
}
