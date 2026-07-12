'use client'

import { Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

function SignInInner() {
  const params = useSearchParams()
  const callbackUrl = params.get('callbackUrl') || '/worlds'

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
            <button
              onClick={() => signIn('google', { callbackUrl })}
              className="w-full rounded-lg bg-flame/90 hover:bg-glow text-void font-mono text-[11px] tracking-[0.2em] px-6 py-3.5 transition-colors"
            >
              CONTINUE WITH GOOGLE
            </button>
            <button
              onClick={() => signIn('github', { callbackUrl })}
              className="w-full rounded-lg border border-brass/30 hover:border-flame/60 text-steamer/80 hover:text-glow font-mono text-[11px] tracking-[0.2em] px-6 py-3.5 transition-all"
            >
              CONTINUE WITH GITHUB
            </button>
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
