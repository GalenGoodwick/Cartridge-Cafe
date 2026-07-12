import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Device auth flow for connecting Claude Code to a space.
 *
 * 1. CLI calls POST with { action: 'init' } → gets { deviceCode, pollUrl }
 * 2. CLI opens browser to /space/connect?code=DEVICE_CODE
 * 3. User picks a space and clicks "Connect" → browser calls POST with { action: 'approve', deviceCode, spaceSlug }
 * 4. CLI polls GET ?code=DEVICE_CODE → gets { status: 'completed', token }
 */

// In-memory pending device codes (short-lived, 5min TTL)
const g = globalThis as unknown as {
  __deviceCodes?: Map<string, {
    pollSecret: string
    spaceToken: string | null
    spaceSlug: string | null
    expiresAt: number
  }>
}
const deviceCodes = g.__deviceCodes ??= new Map()

// Cleanup expired codes
function cleanup() {
  const now = Date.now()
  for (const [code, data] of deviceCodes) {
    if (now > data.expiresAt) deviceCodes.delete(code)
  }
}

/** GET /api/spaces/connect?code=XXX&secret=YYY — CLI polls for token */
export async function GET(req: NextRequest) {
  cleanup()

  const code = req.nextUrl.searchParams.get('code')
  const secret = req.nextUrl.searchParams.get('secret')
  if (!code || !secret) {
    return NextResponse.json({ error: 'code and secret required' }, { status: 400 })
  }

  const pending = deviceCodes.get(code)
  if (!pending) {
    return NextResponse.json({ error: 'expired_or_invalid' }, { status: 404 })
  }
  if (pending.pollSecret !== secret) {
    return NextResponse.json({ error: 'invalid_secret' }, { status: 403 })
  }
  if (Date.now() > pending.expiresAt) {
    deviceCodes.delete(code)
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }

  if (pending.spaceToken) {
    // Approved! Return token and clean up
    const token = pending.spaceToken
    const slug = pending.spaceSlug
    deviceCodes.delete(code)
    return NextResponse.json({ status: 'completed', token, spaceSlug: slug })
  }

  return NextResponse.json({ status: 'pending' })
}

/** POST /api/spaces/connect */
export async function POST(req: NextRequest) {
  cleanup()

  const body = await req.json()
  const { action } = body

  // --- CLI initiates device auth ---
  if (action === 'init') {
    const deviceCode = crypto.randomBytes(4).toString('hex').toUpperCase() // 8-char code like "A1B2C3D4"
    const pollSecret = crypto.randomBytes(16).toString('hex')

    deviceCodes.set(deviceCode, {
      pollSecret,
      spaceToken: null,
      spaceSlug: null,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    })

    return NextResponse.json({
      deviceCode,
      pollSecret,
      expiresIn: 300,
    })
  }

  // --- Browser approves device code ---
  if (action === 'approve') {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { deviceCode, spaceSlug } = body
    if (!deviceCode || !spaceSlug) {
      return NextResponse.json({ error: 'deviceCode and spaceSlug required' }, { status: 400 })
    }

    const pending = deviceCodes.get(deviceCode)
    if (!pending || Date.now() > pending.expiresAt) {
      return NextResponse.json({ error: 'Code expired or invalid' }, { status: 404 })
    }

    // Verify user owns the space
    const space = await prisma.playerSpace.findUnique({
      where: { slug: spaceSlug },
      select: { id: true, ownerId: true },
    })
    if (!space || space.ownerId !== user.id) {
      return NextResponse.json({ error: 'Space not found or not owned by you' }, { status: 403 })
    }

    // Generate a space token
    const rawToken = `uc_st_${crypto.randomBytes(16).toString('hex')}`
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const tokenPrefix = rawToken.slice(0, 12) + '...'

    await prisma.spaceToken.create({
      data: {
        name: 'Claude Code (auto)',
        tokenHash,
        tokenPrefix,
        spaceId: space.id,
      },
    })

    // Store token in pending device code for CLI to pick up
    pending.spaceToken = rawToken
    pending.spaceSlug = spaceSlug

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
