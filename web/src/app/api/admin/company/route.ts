import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdmin } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { grantEntitlement, revokeEntitlement, hasIpControl } from '@/lib/stripe'
import { listCompanies, registerCompany, unregisterCompany, getCompanyByHandle } from '@/lib/company'

export const dynamic = 'force-dynamic'

/** ADMIN — provision & manage proprietary company tenants (Galen, Aug 30).
 *  GET    → every company + owner email + IP-control state.
 *  POST   → provision: bind a chosen handle to an account (by email) AND grant
 *           IP control. This is the "set one up" action for a white-label deal.
 *  DELETE → deprovision: release the handle and revoke IP control. */

async function guard(req: NextRequest) {
  return isAdmin(req.headers.get('authorization'))
}

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const companies = await listCompanies()
  const rows = await Promise.all(companies.map(async (c) => {
    const owner = await prisma.user.findUnique({ where: { id: c.ownerId }, select: { email: true, name: true } }).catch(() => null)
    const worlds = await prisma.playerSpace.count({ where: { ownerId: c.ownerId } }).catch(() => 0)
    return {
      handle: c.handle, name: c.name, domain: c.domain ?? null,
      ownerEmail: owner?.email ?? '(unknown)', ownerName: owner?.name ?? null,
      ipControl: await hasIpControl(c.ownerId), worlds, at: c.at,
    }
  }))
  return NextResponse.json({ companies: rows })
}

export async function POST(req: NextRequest) {
  if (!(await guard(req))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { email?: string; handle?: string; name?: string; domain?: string }
  const email = (body.email || '').trim().toLowerCase()
  if (!email || !body.handle) return NextResponse.json({ error: 'email and handle are required' }, { status: 400 })

  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, email: true } })
  if (!user) return NextResponse.json({ error: `no account for ${email} — they must sign in once first` }, { status: 404 })

  const session = await getServerSession(authOptions)
  const byId = (session?.user as { id?: string } | undefined)?.id || 'admin'

  const reg = await registerCompany({ handle: body.handle, ownerId: user.id, name: body.name || body.handle, domain: body.domain, by: byId })
  if (!reg.ok) return NextResponse.json({ error: reg.error }, { status: reg.status })

  // grant IP control (the entitlement the /suite + company door + closed-source
  // library gate all read). Idempotent — one active 'ip' grant per account.
  await grantEntitlement(user.id, { product: 'ip', sessionId: `provision:${reg.company.handle}` })

  return NextResponse.json({ ok: true, company: reg.company, ownerEmail: user.email }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  if (!(await guard(req))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const handle = req.nextUrl.searchParams.get('handle') || ''
  const company = await getCompanyByHandle(handle)
  if (!company) return NextResponse.json({ error: 'no such company' }, { status: 404 })
  await unregisterCompany(handle)
  await revokeEntitlement(company.ownerId, 'ip')
  return NextResponse.json({ ok: true })
}
