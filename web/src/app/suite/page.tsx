import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasIpControl, isProductConfigured } from '@/lib/stripe'

export const metadata: Metadata = { title: 'Premium Suite', description: 'IP control, asset imports, and your company space.' }
export const dynamic = 'force-dynamic'

const box = 'rounded-xl border border-[#b97a2a]/25 bg-[#0d0906]/70 p-5'

/** /suite — ◆ THE PREMIUM SUITE (Galen, Aug 27): everything the IP control
 *  membership unlocks, in one place under the dropdown: closed-source worlds,
 *  asset imports (sprites live; 3D models + audio as they land), and the
 *  company space (<handle>.cartridge.cafe / /c/<handle>). */
export default async function SuitePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect(`/auth/signin?callbackUrl=${encodeURIComponent('/suite')}`)
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } })
  if (!user) redirect('/auth/signin')
  const active = await hasIpControl(user.id)
  const buyable = isProductConfigured('ip')
  const handle = user.email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')

  const Row = ({ mark, title, body, live }: { mark: string; title: string; body: string; live: boolean }) => (
    <div className="flex gap-3 items-start">
      <div className={`font-mono text-[13px] mt-0.5 ${live ? 'text-emerald-300/90' : 'text-white/30'}`}>{mark}</div>
      <div>
        <div className="font-mono text-[13.5px] text-white/85">{title} {!live && <span className="text-[10px] tracking-[0.15em] text-white/30 ml-1">COMING</span>}</div>
        <div className="font-mono text-[12px] leading-relaxed text-white/45 mt-0.5">{body}</div>
      </div>
    </div>
  )

  return (
    <main className="min-h-screen" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <div className="mx-auto max-w-2xl px-6 py-14 font-mono">
        <a href="/" className="text-[13px] tracking-[0.2em] text-amber-200/60 hover:text-amber-200">◂ cartridge.cafe</a>
        <h1 className="cafe-sign text-4xl text-glow mt-4 mb-2">◆ premium suite{!active && !buyable && <span className="ml-3 align-middle font-mono text-[11px] tracking-[0.3em] text-amber-200/70 border border-amber-300/40 rounded px-2 py-1">COMING SOON</span>}</h1>
        <p className="text-[13px] text-white/50 mb-8">
          {active
            ? 'your IP control membership is active — everything below is yours.'
            : 'the IP control membership: your work stays yours alone, and the studio doors open.'}
        </p>

        <div className="flex flex-col gap-5">
          <section className={box}>
            <div className="text-[12px] tracking-[0.3em] text-amber-200/70 mb-4">WHAT THE SUITE HOLDS</div>
            <div className="flex flex-col gap-4">
              <Row mark="◆" live title="total IP control"
                body="every world you make is closed source — playable on the shelf, never readable or reusable by other members. the platform commons deal stops at your door." />
              <Row mark="◲" live title="sprite uploads & ripping"
                body="upload real pixel art, rip sheets into animated clips, sample them in any shader — the ◲ SPRITES panel on your worlds, and define_sheet over the bridge for your AI." />
              <Row mark="▦" live={false} title="3D model uploads"
                body="bring meshes into raymarched worlds — the import pipeline is on the roadmap; suite holders get it the day it lands." />
              <Row mark="♪" live={false} title="music & sfx uploads"
                body="mp3 / hosted-track imports beyond the synthesized audio every world already has — same deal: yours the day it lands." />
              <Row mark="◈" live title="your company space"
                body={`a private-dev door listing only your apps, for you and your member seats: /c/${handle || '<handle>'} — and ${handle || '<handle>'}.cartridge.cafe once the subdomain is pointed.`} />
            </div>
          </section>

          <section className={box}>
            {active ? (
              <div className="flex flex-wrap gap-3">
                <a href={`/c/${handle}`} className="font-mono text-[13px] tracking-[0.12em] px-3.5 py-2 rounded-lg border border-amber-300/50 text-amber-100 hover:bg-amber-400/15">◈ OPEN MY COMPANY SPACE</a>
                <a href="/account" className="font-mono text-[13px] tracking-[0.12em] px-3.5 py-2 rounded-lg border border-white/20 text-white/70 hover:bg-white/10">MANAGE MEMBERSHIP</a>
              </div>
            ) : buyable ? (
              <SuiteBuy />
            ) : (
              <p className="text-[12.5px] text-white/45">the suite is COMING SOON — pricing lands with it, and nothing here is on sale yet. playing and the $10/mo editing membership are unaffected.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

/** the buy button posts JSON (the checkout route's shape), so it's a client hop */
function SuiteBuy() {
  return (
    <a href="/suite/buy" className="inline-block font-mono text-[13px] tracking-[0.12em] px-3.5 py-2 rounded-lg border border-amber-300/50 text-amber-100 hover:bg-amber-400/15">
      ◆ JOIN THE SUITE
    </a>
  )
}
