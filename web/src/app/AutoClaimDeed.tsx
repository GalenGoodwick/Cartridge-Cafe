'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'

/** The deed follows the person — EVERYWHERE, not just the sign-in page.
 *
 *  When a REAL (non-temp) session is active, claim any worlds the browser
 *  brewed as a guest (the cc_guest cookie still links them). /api/spaces/claim
 *  is idempotent and a silent no-op without that cookie, so firing it once per
 *  signed-in identity is safe.
 *
 *  This closes the ownership hole behind "my world has no ALTER": a sign-in that
 *  never touched /auth/signin — an OAuth redirect landing straight on a world, a
 *  passkey unlock, a returning session — used to skip the only claim call there
 *  was, leaving guest-brewed worlds stranded under the throwaway guest account. */
export function AutoClaimDeed() {
  const { data: session, status } = useSession()
  const claimedFor = useRef<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    const u = session?.user as { id?: string; email?: string | null; isTemp?: boolean } | undefined
    if (!u || u.isTemp) return
    const id = u.id || u.email || 'me'
    if (claimedFor.current === id) return   // once per identity, no re-fire on every render
    claimedFor.current = id
    fetch('/api/spaces/claim', { method: 'POST' }).catch(() => {})
  }, [session, status])

  return null
}
