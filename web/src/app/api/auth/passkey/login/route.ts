import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { rpFrom, signChallenge, CHALLENGE_COOKIE } from '@/lib/passkeys'

export const dynamic = 'force-dynamic'

/** GET — mint authentication options (pre-auth: any device may ask; the
 *  assertion is verified inside NextAuth's `passkey` credentials provider). */
export async function GET(req: NextRequest) {
  const { rpID } = rpFrom(req)
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' })
  const res = NextResponse.json(options)
  res.cookies.set(CHALLENGE_COOKIE, signChallenge(options.challenge), { httpOnly: true, sameSite: 'lax', maxAge: 300, path: '/' })
  return res
}
