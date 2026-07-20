import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rpFrom, signChallenge, verifyChallengeCookie, CHALLENGE_COOKIE, ensurePasskeyTable } from '@/lib/passkeys'

export const dynamic = 'force-dynamic'

/** GET — mint registration options for the signed-in user (their device
 *  creates a keypair; we'll store only the public half). */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  await ensurePasskeyTable()
  const user = await prisma.user.findUnique({ where: { email }, include: { passkeys: true } })
  if (!user) return NextResponse.json({ error: 'No user' }, { status: 401 })

  const { rpID, rpName } = rpFrom(req)
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: email,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: user.passkeys.map(p => ({ id: p.credentialId })),
    // platform = THIS device's Face ID / Touch ID / Windows Hello. Without the
    // attachment the browser opened its cross-device chooser (QR codes, security
    // keys) — the button says FACE ID and must summon exactly that. residentKey
    // required makes it discoverable, so passkey login needs no email typed.
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    // reinforce the platform lock with the browser hint (maps to
    // hints:['client-device'] — newer UAs lead straight to Face ID / Touch ID)
    preferredAuthenticatorType: 'localDevice',
  })
  const res = NextResponse.json(options)
  res.cookies.set(CHALLENGE_COOKIE, signChallenge(options.challenge), { httpOnly: true, sameSite: 'lax', maxAge: 300, path: '/' })
  return res
}

/** POST — verify the device's attestation and remember the passkey. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return NextResponse.json({ error: 'No user' }, { status: 401 })

  const expectedChallenge = verifyChallengeCookie(req.cookies.get(CHALLENGE_COOKIE)?.value)
  if (!expectedChallenge) return NextResponse.json({ error: 'Challenge expired — try again' }, { status: 400 })

  const body = await req.json().catch(() => null)
  if (!body?.response) return NextResponse.json({ error: 'Missing attestation' }, { status: 400 })

  const { rpID, origin } = rpFrom(req)
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    })
    if (!verified || !registrationInfo) return NextResponse.json({ error: 'Not verified' }, { status: 400 })
    const cred = registrationInfo.credential
    // MUST ensure the table here too: the GET set tableReady on ITS lambda, but
    // this POST usually runs on a different serverless instance where the table
    // was never created — so the insert threw and Face ID "did nothing".
    await ensurePasskeyTable()
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: cred.id,
        publicKey: Buffer.from(cred.publicKey).toString('base64url'),
        counter: cred.counter,
        transports: (cred.transports || []).join(','),
        deviceName: (body.deviceName || '').slice(0, 60) || null,
      },
    })
    const res = NextResponse.json({ ok: true })
    res.cookies.delete(CHALLENGE_COOKIE)
    return res
  } catch (e) {
    return NextResponse.json({ error: `Verification failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 400 })
  }
}
