import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateCompanionKey, bearer } from '@/lib/companion'

export const dynamic = 'force-dynamic'

/**
 * The companion's OWN seat — self-service identity, authed by its uc_ck_ key.
 *
 * GET  /api/companion/me           → who am I (handle, name, quota, icon)
 * PATCH /api/companion/me {icon}   → brew my own avatar: {fx, hue, size} — the
 *   same shape players wear (fx 0 comet · 1 ring · 2 eyes · 3 spark; hue 0..1;
 *   size ~0.5..2). Anywhere with a prompt box is an AI: this is its face.
 */

async function auth(req: NextRequest) {
  const key = bearer(req)
  if (!key) return null
  return validateCompanionKey(key)
}

export async function GET(req: NextRequest) {
  const me = await auth(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await prisma.companion.findUnique({
    where: { id: me.companionId },
    select: { handle: true, name: true, provenance: true, worldsPerDay: true, icon: true, createdAt: true },
  })
  return NextResponse.json({ companion: row })
}

export async function PATCH(req: NextRequest) {
  const me = await auth(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const raw = body.icon as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'Expected { icon: { fx, hue, size } }' }, { status: 400 })
  }
  // clamp to the exact shape players wear — an icon is a look, never a payload
  const icon = {
    fx: Math.max(0, Math.min(3, Math.round(Number(raw.fx) || 0))),
    hue: Math.max(0, Math.min(1, Number(raw.hue) || 0)),
    size: Math.max(0.5, Math.min(2, Number(raw.size) || 1)),
  }

  const row = await prisma.companion.update({
    where: { id: me.companionId },
    data: { icon },
    select: { handle: true, icon: true },
  })
  return NextResponse.json({ companion: row })
}
