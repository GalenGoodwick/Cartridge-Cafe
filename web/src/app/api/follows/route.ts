import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureCommunityTables, usersByHandle, handleOf, notifyUser } from '@/lib/notify'

export const dynamic = 'force-dynamic'

async function me() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true, name: true } })
}

/** GET ?handle=x — follower count for a profile + whether I follow them */
export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get('handle') || ''
  const targets = await usersByHandle(handle)
  if (!targets.length) return NextResponse.json({ followers: 0, following: false })
  await ensureCommunityTables()
  const ids = targets.map(t => t.id)
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(DISTINCT "followerId") AS n FROM "CafeFollow" WHERE "followeeId" = ANY(${ids})`
  const u = await me()
  let following = false
  if (u) {
    const f = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM "CafeFollow" WHERE "followerId" = ${u.id} AND "followeeId" = ANY(${ids})`
    following = Number(f[0]?.n ?? 0) > 0
  }
  return NextResponse.json({ followers: Number(rows[0]?.n ?? 0), following })
}

/** POST { handle } follow · DELETE { handle } unfollow */
export async function POST(req: NextRequest) {
  const u = await me()
  if (!u) return NextResponse.json({ error: 'sign in to follow' }, { status: 401 })
  const { handle } = await req.json().catch(() => ({}))
  const targets = await usersByHandle(String(handle || ''))
  if (!targets.length) return NextResponse.json({ error: 'no such maker' }, { status: 404 })
  await ensureCommunityTables()
  for (const t of targets) {
    if (t.id === u.id) continue
    await prisma.$executeRaw`INSERT INTO "CafeFollow" ("followerId", "followeeId") VALUES (${u.id}, ${t.id}) ON CONFLICT DO NOTHING`
    void notifyUser(t.id, 'follow', `${u.name || handleOf(u.email)} now follows your work`, `/u/${handleOf(u.email)}`)
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const u = await me()
  if (!u) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  const { handle } = await req.json().catch(() => ({}))
  const targets = await usersByHandle(String(handle || ''))
  await ensureCommunityTables()
  for (const t of targets) {
    await prisma.$executeRaw`DELETE FROM "CafeFollow" WHERE "followerId" = ${u.id} AND "followeeId" = ${t.id}`
  }
  return NextResponse.json({ ok: true })
}
