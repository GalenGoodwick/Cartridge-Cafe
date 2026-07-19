import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { rpFrom, signChallenge, CHALLENGE_COOKIE } from '@/lib/passkeys'

export const dynamic = 'force-dynamic'

/** GET — mint authentication options (pre-auth: any device may ask; the
 *  assertion is verified inside NextAuth's `passkey` credentials provider). */
export async function GET(req: NextRequest) {
  const { rpID } = rpFrom(req)
  // platform only — this is a Touch ID / Face ID button, never a QR-hop or a
  // roaming USB key. `hints: ['client-device']` tells the browser to lead with
  // (and stick to) the authenticator ON this device; userVerification 'required'
  // demands the biometric/PIN. Matches the register route's platform lock.
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
  })
  // @simplewebauthn/server v13 doesn't type `hints` on auth options, but the
  // browser passes the whole options JSON straight into navigator.credentials
  // .get({ publicKey }), so adding it here reaches WebAuthn and suppresses the
  // QR / security-key chooser in favour of THIS device's Face ID / Touch ID.
  ;(options as typeof options & { hints?: string[] }).hints = ['client-device']
  const res = NextResponse.json(options)
  res.cookies.set(CHALLENGE_COOKIE, signChallenge(options.challenge), { httpOnly: true, sameSite: 'lax', maxAge: 300, path: '/' })
  return res
}
