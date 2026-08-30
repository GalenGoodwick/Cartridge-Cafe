import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { sendCompanyInvoice } from '@/lib/stripe'
import { getCompanyByHandle } from '@/lib/company'

export const dynamic = 'force-dynamic'

/** POST /api/admin/company/invoice { handle, amountUsd, description, daysUntilDue? }
 *  — Stripe emails the company a net-30 invoice (send_invoice collection). The
 *  keeper's answer to "how does a company pay us" — no card, a real invoice. */
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { handle?: string; amountUsd?: number; description?: string; daysUntilDue?: number }
  const company = await getCompanyByHandle(body.handle || '')
  if (!company) return NextResponse.json({ error: 'no such company' }, { status: 404 })
  const owner = await prisma.user.findUnique({ where: { id: company.ownerId }, select: { email: true } })
  if (!owner?.email) return NextResponse.json({ error: 'company owner has no email on file' }, { status: 400 })

  const out = await sendCompanyInvoice({
    email: owner.email,
    companyName: company.name,
    amountUsd: Number(body.amountUsd),
    description: body.description || `cartridge.cafe — ${company.name} white-label`,
    daysUntilDue: body.daysUntilDue,
  })
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ ok: true, url: out.url, invoiceId: out.invoiceId, sentTo: owner.email })
}
