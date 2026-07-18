import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyChallengeCookie } from '@/lib/passkeys'

export const dynamic = 'force-dynamic'

/** POST /api/spaces/claim — sign the deed. A real (non-temp) signed-in user
 *  whose browser still carries the guest cookie takes ownership of every
 *  world the guest brewed; the temp user is then retired. Idempotent and a
 *  silent no-op without a valid cookie, so the client may call it freely. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.isTemp) return NextResponse.json({ claimed: 0 })

  const raw = req.cookies.get('cc_guest')?.value
  const guestId = raw ? verifyChallengeCookie(raw) : null
  if (!guestId) return NextResponse.json({ claimed: 0 })

  const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!me || me.id === guestId) return NextResponse.json({ claimed: 0 })

  const guest = await prisma.user.findUnique({ where: { id: guestId }, select: { email: true } })
  if (!guest?.email.endsWith('@guest.cartridge.cafe')) return NextResponse.json({ claimed: 0 })

  const moved = await prisma.playerSpace.updateMany({
    where: { ownerId: guestId },
    data: { ownerId: me.id },
  })

  // branches follow too: rename "BASE ⑂ guesthandle …" to the new handle
  let branchesMoved = 0
  try {
    const { handleOf } = await import('@/lib/guest-quota')
    const { hydrateAllScenes, listScenes, loadScene, saveScene, deleteScene } = await import('../../engine/store')
    const gh = handleOf(guest.email)
    const nh = handleOf(session.user.email)
    if (gh && nh && gh !== nh) {
      await hydrateAllScenes()
      for (const n of listScenes()) {
        const f = n.indexOf(' ⑂ ')
        if (f < 0 || n.slice(f + 3).split(' · ')[0].trim() !== gh) continue
        const scene = loadScene(n)
        if (!scene) continue
        const renamed = n.slice(0, f + 3) + nh + n.slice(f + 3 + gh.length)
        saveScene(renamed, { ...scene, name: renamed })
        deleteScene(n)
        branchesMoved++
      }
    }
  } catch { /* branch carry is best-effort; worlds already moved */ }
  // retire the guest shell — its worlds now live under a signed deed
  await prisma.user.update({ where: { id: guestId }, data: { status: 'DELETED', deletedAt: new Date() } }).catch(() => {})

  const res = NextResponse.json({ claimed: moved.count + branchesMoved })
  res.cookies.delete('cc_guest')
  return res
}
