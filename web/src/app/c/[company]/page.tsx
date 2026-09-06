import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasIpControl } from '@/lib/stripe'
import { getCompanyByHandle } from '@/lib/company'

export const metadata: Metadata = { title: 'Company', description: 'A private development space on cartridge.cafe.' }
export const dynamic = 'force-dynamic'

/** /c/[company] — THE COMPANY DOOR (Galen, Aug 27: "a fortis.cartridge.cafe
 *  style thing — just has the company's apps for private dev"). Serves a
 *  ◆ premium (IP control) account's worlds as a private-dev shelf: the
 *  company's own people (the owner, and anyone holding a member seat on one
 *  of its worlds) see the apps; everyone else meets a closed door. Subdomain
 *  hosts (<company>.cartridge.cafe) rewrite here via proxy.ts. */
export default async function CompanyPage({ params }: { params: Promise<{ company: string }> }) {
  const { company } = await params
  const handle = company.toLowerCase().replace(/[^a-z0-9_-]/g, '')

  // OWNER RESOLUTION — the provisioned registry is the truth (a chosen handle
  // bound to an account). Fall back to the legacy email-local-part guess only
  // for handles registered before provisioning existed.
  let owner: { id: string; name: string | null } | null = null
  let regName: string | null = null
  const registered = await getCompanyByHandle(handle)
  if (registered && (await hasIpControl(registered.ownerId))) {
    const u = await prisma.user.findUnique({ where: { id: registered.ownerId }, select: { id: true, name: true } })
    if (u) { owner = u; regName = registered.name }
  }
  if (!owner) {
    const users = await prisma.$queryRawUnsafe<Array<{ id: string; name: string | null; email: string }>>(
      `SELECT id, name, email FROM "User" WHERE lower(split_part(email, '@', 1)) = $1 AND status = 'ACTIVE' LIMIT 5`,
      handle,
    ).catch(() => [])
    for (const u of users) if (await hasIpControl(u.id)) { owner = u; break }
  }

  const shell = (body: React.ReactNode) => (
    <main className="min-h-screen" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <div className="mx-auto max-w-2xl px-6 py-16 font-mono">{body}</div>
    </main>
  )

  if (!owner) {
    return shell(
      <>
        <div className="text-[14px] tracking-[0.2em] text-amber-200/60 mb-4">cartridge.cafe</div>
        <h1 className="cafe-sign text-3xl text-glow mb-3">no company here</h1>
        <p className="text-[14px] text-white/60">this address isn&rsquo;t claimed. company spaces come with the ◆ IP control membership.</p>
        <a href="/" className="inline-block mt-6 text-[14px] tracking-[0.2em] text-amber-200/70 hover:text-amber-200">◂ the cafe</a>
      </>,
    )
  }

  // WHO MAY ENTER: the owner, or a holder of a member seat on any company world
  const session = await getServerSession(authOptions)
  const me = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } })
    : null
  const myHandle = me?.email ? me.email.split('@')[0].replace(/[^a-z0-9_-]/gi, '') : null
  let inside = me?.id === owner.id
  // the KEEPER sees every room (admin oversight — same authority as /admin)
  if (!inside && me?.id) {
    const { isAdminUserId } = await import('@/lib/adminAuth')
    if (await isAdminUserId(me.id)) inside = true
  }
  if (!inside && myHandle) {
    const seat = await prisma.spaceToken.count({
      where: { name: `member:${myHandle}`, revokedAt: null, space: { ownerId: owner.id } },
    })
    inside = seat > 0
  }

  const companyName = (regName || owner.name || handle).toUpperCase()

  if (!inside) {
    return shell(
      <>
        <div className="text-[14px] tracking-[0.2em] text-amber-200/60 mb-4">cartridge.cafe · company space</div>
        <h1 className="cafe-sign text-3xl text-glow mb-3">◆ {companyName}</h1>
        <p className="text-[14px] text-white/60 leading-relaxed">
          a private development space. entry is by the company&rsquo;s member seats —
          {me ? ' your account holds none of them.' : ' sign in if you hold one.'}
        </p>
        {!me && (
          <a href={`/auth/signin?callbackUrl=${encodeURIComponent(`/c/${handle}`)}`}
            className="inline-block mt-5 font-mono text-[14px] tracking-[0.15em] px-3.5 py-2 rounded-lg border border-amber-300/50 text-amber-100 hover:bg-amber-400/15">
            SIGN IN
          </a>
        )}
      </>,
    )
  }

  // INSIDERS GO STRAIGHT INTO THE PRIVATE ENGINE WINDOW (Galen, Sep 5:
  // 'it isn't a private engine window' — a list page wasn't the thing).
  // /grid?ui=engine&co=<handle> opens the engine with THE PRIVATE LINE tool.
  redirect(`/grid?ui=engine&co=${encodeURIComponent(handle)}`)
}
