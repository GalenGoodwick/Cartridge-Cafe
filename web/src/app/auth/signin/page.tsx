'use client'

import { Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

function SignInInner() {
  const params = useSearchParams()
  const callbackUrl = params.get('callbackUrl') || '/worlds'

  return (
    <div className="min-h-screen bg-[#0c0a09] text-[#e7dcc8] font-mono flex items-center justify-center px-5">
      <div className="w-full max-w-sm text-center">
        <div className="text-[11px] tracking-[0.5em] text-amber-200/40 uppercase">members&apos; counter</div>
        <h1 className="font-serif text-4xl mt-3 mb-2 text-amber-50">come in</h1>
        <p className="text-xs text-[#8a7c66] mb-8">a world needs a name on its deed.</p>
        <div className="space-y-3">
          <button
            onClick={() => signIn('google', { callbackUrl })}
            className="w-full rounded-lg bg-amber-400/90 hover:bg-amber-300 text-[#1a1206] font-semibold text-sm px-6 py-3 transition-colors"
          >
            continue with Google
          </button>
          <button
            onClick={() => signIn('github', { callbackUrl })}
            className="w-full rounded-lg bg-white/10 hover:bg-white/20 text-white/90 font-semibold text-sm px-6 py-3 transition-colors"
          >
            continue with GitHub
          </button>
        </div>
        <a href="/" className="inline-block mt-8 text-[11px] text-amber-300/60 hover:text-amber-200">← back to the cafe</a>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return <Suspense><SignInInner /></Suspense>
}
