import { createHmac } from 'crypto'

/** Signed-cookie helpers. Once shared with WebAuthn passkeys (now removed);
 *  still used by the guest door and world-claim flow to carry a tamper-evident
 *  id in an HMAC-signed, httpOnly cookie — stateless across lambdas. */

const SECRET = () => process.env.NEXTAUTH_SECRET || 'cafe-dev'

export function signChallenge(challenge: string): string {
  const mac = createHmac('sha256', SECRET()).update(challenge).digest('base64url')
  return `${challenge}.${mac}`
}

export function verifyChallengeCookie(cookie: string | undefined): string | null {
  if (!cookie) return null
  const dot = cookie.lastIndexOf('.')
  if (dot < 0) return null
  const challenge = cookie.slice(0, dot)
  return signChallenge(challenge) === cookie ? challenge : null
}
