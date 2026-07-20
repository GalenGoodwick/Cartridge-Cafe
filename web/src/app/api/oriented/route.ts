import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadGameSlot, saveGameSlot } from '../engine/store'

export const dynamic = 'force-dynamic'

/** Tracks whether a signed-in user has seen the hub orientation, so it shows
 *  ONCE per person — and a guest who dismisses it then signs up stays dismissed
 *  (the client also keeps a localStorage flag; this is the cross-device / cross-
 *  account source of truth). Stored in the self-creating EngineSlot table, so no
 *  schema migration. Keyed by user id: `oriented:<userId>`. */
async function userId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  return u?.id ?? null
}

export async function GET() {
  const id = await userId()
  if (!id) return NextResponse.json({ seen: false })   // guests: the client's localStorage decides
  const doc = await loadGameSlot('oriented:' + id)
  return NextResponse.json({ seen: !!doc })
}

export async function POST() {
  const id = await userId()
  if (!id) return NextResponse.json({ ok: true })       // guest dismiss lives only in localStorage
  await saveGameSlot('oriented:' + id, { at: Date.now() })
  return NextResponse.json({ ok: true })
}
