import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureCommunityTables, notifyUser, handleOf, adminUsers } from '@/lib/notify'
import { sendPushToUser, cafePush } from '@/lib/push'

export const dynamic = 'force-dynamic'

async function me() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true, name: true } })
}

/** GET — the bell: latest notifications + unread count for the signed-in user */
export async function GET() {
  const u = await me()
  if (!u) return NextResponse.json({ items: [], unread: 0 })
  await ensureCommunityTables()
  const items = await prisma.$queryRaw<Array<{ id: string; kind: string; text: string; link: string | null; readAt: Date | null; createdAt: Date }>>`
    SELECT "id", "kind", "text", "link", "readAt", "createdAt" FROM "Notif"
    WHERE "userId" = ${u.id} ORDER BY "createdAt" DESC LIMIT 30`
  const unread = items.filter(i => !i.readAt).length
  return NextResponse.json({ items, unread })
}

/** POST — actions:
 *  { readAll: true }                        → mark everything read
 *  { emit: 'comment', channel, text }       → a world/space chat got a message;
 *    the owner hears about it (resolved server-side, never self-notify) */
export async function POST(req: NextRequest) {
  const u = await me()
  if (!u) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  const body = await req.json().catch(() => ({}))

  if (body.readAll) {
    await ensureCommunityTables()
    await prisma.$executeRaw`UPDATE "Notif" SET "readAt" = CURRENT_TIMESTAMP WHERE "userId" = ${u.id} AND "readAt" IS NULL`
    return NextResponse.json({ ok: true })
  }

  if (body.emit === 'comment' && typeof body.channel === 'string') {
    const who = u.name || handleOf(u.email)
    const preview = String(body.text || '').slice(0, 80)
    if (body.channel.startsWith('chat:space:')) {
      const slug = body.channel.slice(11)
      const sp = await prisma.playerSpace.findUnique({ where: { slug }, select: { ownerId: true, name: true } })
      if (sp && sp.ownerId !== u.id) {
        await notifyUser(sp.ownerId, 'comment', `${who} in ${sp.name}: “${preview}”`, `/space/${slug}`)
        void sendPushToUser(sp.ownerId, cafePush.comment(who, sp.name, preview, `/space/${slug}`)).catch(() => {})
      }
      // CHAT IS CHAT (Galen): a message posts and notifies its maker — it does
      // NOT auto-summon the AI network. Attracting builders is the SUMMON bar's
      // job (an explicit attract command), kept separate so chat stays chat.
    } else if (body.channel.startsWith('chat:world:')) {
      const base = body.channel.slice(11)
      const link = `/hub/${encodeURIComponent(base)}`
      for (const admin of await adminUsers()) {
        if (admin.id !== u.id) {
          await notifyUser(admin.id, 'comment', `${who} in ${base}: “${preview}”`, link)
          void sendPushToUser(admin.id, cafePush.comment(who, base, preview, link)).catch(() => {})
        }
      }
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
