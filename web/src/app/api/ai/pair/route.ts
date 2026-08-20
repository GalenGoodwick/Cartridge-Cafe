import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyChallengeCookie } from '@/lib/passkeys'
import { checkRateLimit } from '@/lib/rate-limit'
import { mintPlayerToken, revokePlayerTokenByRaw } from '@/lib/player-token'
import { createPairing, readPairing, approvePairing, pollPairing } from '@/lib/ai-pairing'

export const dynamic = 'force-dynamic'

/**
 * AI ↔ account pairing — register an AI and a user account TOGETHER.
 *
 * 1. AI calls POST { action: 'init', aiName } (with its guest cookies, if any)
 *    → { code, secret, url }. The guest identity rides in the pairing row.
 * 2. Human opens /pair?code=CODE — signs in or signs up (guest browser data
 *    survives auth exactly as always), then clicks REGISTER.
 * 3. Browser calls POST { action: 'approve', code } → mints the AI its own
 *    labeled uc_pt_ key (ADDITIVE — does not revoke the user's other keys)
 *    and claims every world the AI's guest brewed onto the account.
 * 4. AI polls GET ?code&secret → { status: 'completed', token, handle }.
 */

/** GET /api/ai/pair?code=…&secret=… — AI polls. With ?info=1 (no secret):
 *  safe display fields for the /pair page. */
export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get('code') || '').toUpperCase()
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  if (req.nextUrl.searchParams.get('info')) {
    const p = await readPairing(code)
    if (!p) return NextResponse.json({ error: 'expired_or_invalid' }, { status: 404 })
    return NextResponse.json({ aiName: p.aiName, status: p.status, hasGuestWorlds: !!p.guestUserId })
  }

  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret) return NextResponse.json({ error: 'secret required' }, { status: 400 })
  const out = await pollPairing(code, secret)
  if (out.status === 'gone') return NextResponse.json({ error: 'expired_or_invalid' }, { status: 410 })
  return NextResponse.json(out)
}

/** POST /api/ai/pair — { action: 'init' | 'approve' } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  if (body.action === 'init') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local'
    if (await checkRateLimit('ai_pair_init', ip)) {
      return NextResponse.json({ error: 'Too many pairing attempts from here — slow down' }, { status: 429 })
    }
    const aiName = (typeof body.aiName === 'string' && body.aiName.trim() ? body.aiName.trim() : 'AI').slice(0, 40)
    // the AI's guest identity (from ITS cookie jar) rides along so its brews get claimed
    const rawCookie = req.cookies.get('cc_guest')?.value
    const guestUserId = rawCookie ? verifyChallengeCookie(rawCookie) : null
    const { code, secret, expiresIn } = await createPairing(aiName, guestUserId)
    const base = req.nextUrl.origin
    return NextResponse.json({
      code, secret, expiresIn,
      url: `${base}/pair?code=${code}`,
      next: 'Ask your human to open the url in a browser. They sign in (or sign up — nothing is lost through auth) and click REGISTER. Then poll GET ?code&secret until status=completed.',
    })
  }

  if (body.action === 'approve') {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
    const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    if (!me) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const code = (typeof body.code === 'string' ? body.code : '').toUpperCase()
    const pairing = code ? await readPairing(code) : null
    if (!pairing || pairing.status !== 'pending') {
      return NextResponse.json({ error: 'Code expired or invalid' }, { status: 404 })
    }

    // the register-together act: the AI gets its OWN key (additive — the
    // user's existing keys stay live; each is individually revocable).
    // (Guest estates are history: the guest door is closed, so there is
    // nothing to claim — worlds are born owned or not at all.)
    const { raw } = await mintPlayerToken(me.id, `${pairing.aiName} · paired`, { revokeExisting: false })
    const claimedWorlds = 0
    const { handleOf } = await import('@/lib/notify')
    const handle = handleOf(session.user.email) || null

    const ok = await approvePairing(code, { token: raw, handle, claimedWorlds })
    if (!ok) {
      // code expired between read and write — don't leave the minted key live
      await revokePlayerTokenByRaw(raw)
      return NextResponse.json({ error: 'Code expired or invalid' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, claimedWorlds })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
