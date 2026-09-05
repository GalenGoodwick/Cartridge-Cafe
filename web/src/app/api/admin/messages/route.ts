import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/admin/messages — the keeper's inbox (contact-form messages, newest first). */
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  }
  const messages = await prisma.contactMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ messages })
}

/** PATCH /api/admin/messages — { id, status } → mark READ (or back to NEW). */
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  }
  const { id, status } = await req.json().catch(() => ({}))
  if (!id || !['NEW', 'READ'].includes(status)) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  await prisma.contactMessage.update({ where: { id }, data: { status } })
  return NextResponse.json({ ok: true })
}
