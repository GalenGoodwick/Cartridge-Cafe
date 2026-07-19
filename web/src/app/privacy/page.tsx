import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What cartridge.cafe collects, why, and what we never do with it.',
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="cafe-sign text-xl text-glow mt-9 mb-2">{children}</h2>
)
const P = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <p className={`text-[15px] leading-relaxed text-crema/80 mb-3 ${className}`}>{children}</p>
)

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-void text-crema/80" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <div className="mx-auto max-w-2xl px-6 py-16 font-mono">
        <Link href="/" className="text-[12px] tracking-[0.2em] text-brass hover:text-flame">◂ cartridge.cafe</Link>
        <h1 className="cafe-sign text-4xl text-glow mt-5 mb-1">privacy</h1>
        <div className="text-[12px] tracking-[0.15em] text-crema/40 mb-6">last updated 2026-07-19</div>

        <P>cartridge.cafe collects as little as it can and never sells your data. Here&rsquo;s the whole picture.</P>

        <H>What we collect</H>
        <P><b className="text-glow">Account:</b> your email (or a passkey / guest token) so you can sign in and own your worlds. <b className="text-glow">Worlds:</b> the worlds you create, their save points, and lineage. <b className="text-glow">Usage:</b> basic technical data — which world you&rsquo;re in, presence, and error/diagnostic reports (e.g. a browser that can&rsquo;t render) so we can fix what&rsquo;s broken.</P>

        <H>Why</H>
        <P>To run the service: sign you in, keep and display your worlds, show who&rsquo;s around, and debug problems. Public worlds and your display name are visible to other members by design — that&rsquo;s the cafe. Private worlds are visible only to you.</P>

        <H>What we never do</H>
        <P>We don&rsquo;t sell your data, and we don&rsquo;t use your private worlds for anything but storing them for you. We don&rsquo;t run third-party ad trackers that follow you across the web.</P>

        <H>Third parties</H>
        <P>We use service providers to operate: hosting (Vercel), the database (Neon), and — if/when paid features launch — a payment processor (Stripe) that handles card data directly (we never see full card numbers). AI-built worlds run through AI providers you connect or the cafe&rsquo;s resident AI; the briefs you submit are sent to those models to build your world.</P>

        <H>Your control</H>
        <P>You can make any world private (hidden from others) or delete it. You can delete your account, which removes your worlds. Deletes are permanent — there&rsquo;s no undo.</P>

        <H>Changes</H>
        <P>If this policy changes materially, we&rsquo;ll note it here and update the date above.</P>

        <P className="mt-8 text-[13px] text-crema/50">See also the <Link href="/terms" className="text-brass hover:text-flame underline">Terms &amp; the Commons Deal</Link>.</P>
      </div>
    </main>
  )
}
