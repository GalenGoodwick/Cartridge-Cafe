import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasIpControl } from '@/lib/stripe'
import { getCompanyByOwner, registerCompany, unregisterCompany } from '@/lib/company'

export const dynamic = 'force-dynamic'

/** SELF-SERVE COMPANY CLAIM (the suite pathway). Admin provisioning stays the
 *  high-touch door (/api/admin/company); this is the ◆ IP-control holder
 *  claiming their OWN handle the moment the membership is active — name the
 *  company, get /c/<handle> and <handle>.cartridge.cafe, no keeper required.
 *  One company per account; re-claiming moves the door (old handle released). */

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const company = await getCompanyByOwner(user.id)
  return NextResponse.json({ company, ipControl: await hasIpControl(user.id) })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!(await hasIpControl(user.id))) {
    return NextResponse.json({ error: 'the company space comes with the ◆ IP control membership — join the suite first' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as { handle?: string; name?: string }
  const handle = String(body.handle ?? '')
  const name = String(body.name ?? '').trim()

  const mine = await getCompanyByOwner(user.id)
  const reg = await registerCompany({ handle, ownerId: user.id, name: name || handle, by: user.id })
  if (!reg.ok) return NextResponse.json({ error: reg.error }, { status: reg.status })
  // moving doors: release the previous handle AFTER the new one is safely held
  if (mine && mine.handle !== reg.company.handle) await unregisterCompany(mine.handle)
  return NextResponse.json({ ok: true, company: reg.company })
}
