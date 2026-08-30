import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAdminUserId } from '@/lib/adminAuth'
import { createPromoCode, listPromoCodes } from '@/lib/promo'

export const dynamic = 'force-dynamic'

/** PROMO CODES — keeper-minted gift codes (default: 2 build credits + 30 days
 *  of editing membership per redeemer). GET = list codes + use counts (admin).
 *  POST = mint one (admin). Redemption is /api/promo/redeem. */

async function adminUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user || !(await isAdminUserId(user.id))) return null
  return user
}

export async function GET() {
  const user = await adminUser()
  if (!user) return NextResponse.json({ error: 'admin only' }, { status: 403 })
  const codes = await listPromoCodes()
  return NextResponse.json({
    codes: codes.map((c) => ({
      code: c.code, credits: c.credits, memberDays: c.memberDays,
      maxUses: c.maxUses, used: c.uses.length, at: c.at, disabled: !!c.disabled,
    })),
  })
}

export async function POST(req: NextRequest) {
  const user = await adminUser()
  if (!user) return NextResponse.json({ error: 'admin only' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { credits?: number; memberDays?: number; maxUses?: number | null }
  const promo = await createPromoCode({
    credits: body.credits, memberDays: body.memberDays, maxUses: body.maxUses ?? null,
    createdBy: user.id,
  })
  return NextResponse.json({ ok: true, code: promo.code, credits: promo.credits, memberDays: promo.memberDays, maxUses: promo.maxUses }, { status: 201 })
}
