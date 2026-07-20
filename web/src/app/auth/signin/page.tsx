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
  CredentialsSignin: 'the ledger refused: wrong word for that name — or a NEW name with a word under 8 characters (a new email + an 8+ character word signs you up right here). if you first came in with google, use that door.',
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
  const { data: session } = useSession()
  const [enrolled, setEnrolled] = useState<string>('')

  const [claimedN, setClaimedN] = useState<number | null>(null)

  // only offer doors that actually open
  useEffect(() => {
    fetch('/api/auth/providers').then(r => r.json()).then(setProviders).catch(() => setProviders({}))
  }, [])

  // the deed follows the person: a real sign-in with a guest cookie claims
  // the guest's world(s). No-op without one — safe to call every visit.
  useEffect(() => {
    if (!session?.user || session.user.isTemp) return
    fetch('/api/spaces/claim', { method: 'POST' }).then(r => r.json())
      .then(d => { if (d.claimed > 0) setClaimedN(d.claimed) }).catch(() => {})
  }, [session])

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
            {claimedN !== null && (
              <p className="font-mono text-[14px] leading-relaxed text-flame/90 text-center pb-1">
                deed signed — your {claimedN > 1 ? `${claimedN} worlds are` : 'world is'} yours for keeps.
              </p>
            )}
            {session?.user?.isTemp && (
              <p className="font-mono text-[14px] leading-relaxed text-brass text-center pb-1">
                you&apos;re brewing as a guest. sign in through any door below and your world comes with you.
              </p>
            )}
            {session?.user && (
              <div className="rounded-lg border border-brass/25 bg-void/30 px-4 py-3.5 space-y-2">
                <div className="font-mono text-[14px] tracking-[0.25em] text-brass">YOU ARE IN AS {(session.user.email || '').toUpperCase()}</div>
                <p className="font-sans text-[16px] text-grounds">secure this device — next time, your face or fingerprint is the key.</p>
                <button
                  onClick={async () => {
                    setEnrolled('')
                    try {
                      const { startRegistration } = await import('@simplewebauthn/browser')
                      const opts = await (await fetch('/api/auth/passkey/register')).json()
                      if (opts.error) { setEnrolled(opts.error); return }
                      const att = await startRegistration({ optionsJSON: opts })
                      const v = await (await fetch('/api/auth/passkey/register', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ response: att, deviceName: navigator.platform || 'this device' }),
                      })).json()
                      setEnrolled(v.ok ? 'this device now opens the door.' : (v.error || 'could not add'))
                    } catch { setEnrolled('the prompt was dismissed.') }
                  }}
                  className="w-full rounded-lg border border-flame/40 hover:border-flame/70 text-flame/90 hover:text-glow font-mono text-[16px] tracking-[0.2em] px-6 py-3 transition-all"
                >
                  ⌘ ADD FACE ID / TOUCH ID
                </button>
                {enrolled && <p className="font-mono text-[14px] text-grounds">{enrolled}</p>}
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
            {/* The sign-in DOORS. Once you're in, they vanish — the only thing
                left is the post-auth card above (name is set, secure the device,
                turn on notifications). "After auth" belongs after auth. */}
            {!session?.user && <>
            {(!providers || !!providers.google) && (
              <button
                onClick={() => signIn('google', { callbackUrl })}
                className="w-full rounded-lg bg-flame/90 hover:bg-glow text-void font-mono text-[16px] tracking-[0.2em] px-6 py-3.5 transition-colors"
              >
                CONTINUE WITH GOOGLE
              </button>
            )}
            {providers && !!providers.guest && !session?.user && (
              <button
                onClick={async () => {
                  if (busy) return
                  setBusy(true)
                  try {
                    const r = await (await fetch('/api/auth/guest', { method: 'POST' })).json()
                    if (r.ok) await signIn('guest', { callbackUrl: '/?brew=1' })
                  } finally { setBusy(false) }
                }}
                className="w-full rounded-lg border border-dashed border-brass/40 hover:border-flame/60 text-grounds hover:text-steamer font-mono text-[16px] tracking-[0.2em] px-6 py-3 transition-all"
              >
                JUST TRY IT — BREW ONE WORLD AS A GUEST
              </button>
            )}
            {providers && !!providers.passkey && (
              <button
                onClick={async () => {
                  try {
                    const { startAuthentication } = await import('@simplewebauthn/browser')
                    const options = await (await fetch('/api/auth/passkey/login')).json()
                    const assertion = await startAuthentication({ optionsJSON: options })
                    await signIn('passkey', { assertion: JSON.stringify(assertion), callbackUrl })
                  } catch { /* user dismissed the prompt */ }
                }}
                className="w-full rounded-lg border border-brass/30 hover:border-flame/60 text-steamer/80 hover:text-glow font-mono text-[16px] tracking-[0.2em] px-6 py-3.5 transition-all"
              >
                ⌘ CONTINUE WITH PASSKEY
              </button>
            )}
            {providers && !!providers.github && (
              <button
                onClick={() => signIn('github', { callbackUrl })}
                className="w-full rounded-lg border border-brass/30 hover:border-flame/60 text-steamer/80 hover:text-glow font-mono text-[16px] tracking-[0.2em] px-6 py-3.5 transition-all"
              >
                CONTINUE WITH GITHUB
              </button>
            )}
            {/* the ledger door — email + word (CredentialsProvider was always wired; now it has a handle) */}
            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-brass/20" />
              <span className="font-mono text-[14px] tracking-[0.3em] text-grounds">OR THE LEDGER — SIGN IN, OR SIGN UP FRESH</span>
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
                className="w-full rounded-lg bg-void/40 border border-brass/25 focus:border-flame/60 outline-none text-steamer font-mono text-[16px] px-4 py-3 placeholder:text-grounds"
              />
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="password — 8+ characters signs a new account" autoComplete="current-password" required minLength={8}
                className="w-full rounded-lg bg-void/40 border border-brass/25 focus:border-flame/60 outline-none text-steamer font-mono text-[16px] px-4 py-3 placeholder:text-grounds"
              />
              <button
                type="submit" disabled={busy}
                className="w-full rounded-lg border border-brass/30 hover:border-flame/60 text-steamer/80 hover:text-glow font-mono text-[16px] tracking-[0.2em] px-6 py-3.5 transition-all disabled:opacity-50"
              >
                {busy ? 'CHECKING THE LEDGER…' : 'SIGN THE LEDGER'}
              </button>
            </form>
            {/* clickwrap: continuing = agreeing, with the commons deal stated plainly */}
            <div className="pt-2 text-center font-mono text-[14px] leading-relaxed text-crema/40">
              by continuing you agree to the{' '}
              <a href="/terms" className="text-brass hover:text-flame underline">terms</a> &amp;{' '}
              <a href="/privacy" className="text-brass hover:text-flame underline">privacy</a>.
              <br />worlds you make public can be branched by others · private stays yours.
            </div>
            </>}
            {/* once signed in, the way onward — the doors above are gone */}
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
