import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadGameSlot, saveGameSlot, deleteGameSlot } from '../store'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

async function sessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  return user?.id ?? null
}

/** GET /api/engine/player-icon — the signed-in player's brewed icon, if an AI
 *  has set one via the bridge (`set_player_icon`, slot player-icon:<uid>).
 *  The cafe shell reads this on load and while the brew panel is open, so an
 *  AI-brewed icon lands without a manual localStorage step. */
export async function GET() {
  const uid = await sessionUserId()
  if (!uid) return NextResponse.json({ icon: null })
  const icon = await loadGameSlot('player-icon:' + uid)
  return NextResponse.json({ icon: icon ?? null })
}

/** POST /api/engine/player-icon — mint the player's ICON TOKEN (uc_it_…).
 *  The brew panel calls this and folds the token into the copied prompt, so
 *  the AI it's handed to can set_player_icon on the bridge with NO world and
 *  NO space token. Scope is exactly one command, landing on exactly this
 *  player. One live token per player — minting again revokes the last, so a
 *  prompt pasted somewhere regrettable dies on the next panel open. */
export async function POST() {
  const uid = await sessionUserId()
  if (!uid) return NextResponse.json({ error: 'sign in to brew your icon' }, { status: 401 })
  const prev = (await loadGameSlot('icon-token-of:' + uid)) as { hash?: string } | undefined
  if (prev?.hash) await deleteGameSlot('icon-token:' + prev.hash)
  const raw = 'uc_it_' + crypto.randomBytes(16).toString('hex')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  await saveGameSlot('icon-token:' + hash, { userId: uid, at: Date.now() })
  await saveGameSlot('icon-token-of:' + uid, { hash })
  return NextResponse.json({ token: raw })
}
