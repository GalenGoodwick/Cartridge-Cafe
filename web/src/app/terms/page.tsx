import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms & the Commons Deal',
  description: 'How cartridge.cafe works: you own what you make, public worlds are remixable, private worlds are yours alone.',
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="cafe-sign text-xl text-glow mt-9 mb-2">{children}</h2>
)
const P = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <p className={`text-[15px] leading-relaxed text-crema/80 mb-3 ${className}`}>{children}</p>
)

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-void text-crema/80" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <div className="mx-auto max-w-2xl px-6 py-16 font-mono">
        <Link href="/" className="text-[12px] tracking-[0.2em] text-brass hover:text-flame">◂ cartridge.cafe</Link>
        <h1 className="cafe-sign text-4xl text-glow mt-5 mb-1">terms & the commons deal</h1>
        <div className="text-[12px] tracking-[0.15em] text-crema/40 mb-2">last updated 2026-07-19</div>

        {/* the human version, up top and loud */}
        <div className="rounded-xl border border-brass/40 bg-black/30 p-5 mt-6">
          <div className="text-[12px] tracking-[0.2em] text-flame mb-2">THE COMMONS DEAL — in plain words</div>
          <P><b className="text-glow">You own what you make.</b> Your worlds are yours.</P>
          <P><b className="text-glow">Public worlds can be remixed &amp; branched.</b> Make a world public and other members can <b>remix</b> it (take their own copy to build on) or <b>branch</b> it (enter a challenger in its arena). Both keep their lineage back to you &mdash; and your original always stays yours as <b>main</b>. A branch can win the podium, never your throne.</P>
          <P><b className="text-glow">Private worlds are yours alone.</b> No one else can see, open, or branch a private world. A shared link to a private world simply doesn&rsquo;t open for anyone but you.</P>
          <P className="mb-0"><b className="text-glow">Be decent.</b> No illegal, hateful, or seizure-inducing content. We can remove worlds and close accounts that break the rules.</P>
        </div>

        <H>1 · Your account</H>
        <P>You need an account (or a guest session) to brew and keep worlds. You&rsquo;re responsible for what happens under your account. One person, one identity; don&rsquo;t impersonate others. We can suspend or remove accounts that abuse the service or break these terms.</P>

        <H>2 · What you make, and who owns it</H>
        <P>You keep ownership of the worlds and content you create. By using cartridge.cafe you grant us a worldwide, non-exclusive license to <b>host, store, display, and back up</b> your content so the service can run — nothing more. We don&rsquo;t claim ownership and we don&rsquo;t sell your worlds.</P>

        <H>3 · Remixing &amp; branching (public worlds)</H>
        <P>When you set a world to <b>public</b>, every other member gets a license to <b>view and play</b> it, and to make their own versions two ways — both of which carry <b>lineage</b> (a link back to what they came from, so credit follows the work):</P>
        <P className="mb-1"><b className="text-glow">Remix</b> — take an independent copy to build on. It becomes their world; yours is untouched.</P>
        <P><b className="text-glow">Branch</b> — enter a challenger in your world&rsquo;s arena. Members can vote, and a winning branch earns a <b>podium</b> shown alongside your world. Your original stays <b>main</b> — the throne is always yours; a branch wins the podium, never your world.</P>
        <P>Public worlds are shared under a <b>CC BY-SA</b>-style arrangement: attribution is preserved through lineage, and remixes and branches stay remixable on the same terms. You can make a world private at any time to stop new copies, but versions already made remain their creators&rsquo;.</P>

        <H>4 · Private worlds</H>
        <P>A <b>private</b> world is visible only to you. It can&rsquo;t be opened, remixed, or branched by anyone else, and its link won&rsquo;t load for anyone but you. Privacy is the off-switch for the commons.</P>

        <H>5 · Rules of the cafe</H>
        <P>Don&rsquo;t upload or build content that is illegal, infringing, hateful, harassing, or that endangers people — including <b>strobing / flashing visuals</b>, which are rejected culture-wide. Don&rsquo;t attack the service, other members, or their worlds. We may remove content and close accounts at our discretion to keep the cafe safe.</P>

        <H>6 · AI-built worlds</H>
        <P>Worlds may be built by AI agents you connect, or by the cafe&rsquo;s resident AI on your behalf. You&rsquo;re responsible for the briefs you submit and the worlds they produce, the same as anything else you make here.</P>

        <H>7 · The service, as-is</H>
        <P>cartridge.cafe is provided &ldquo;as is,&rdquo; without warranties. Worlds can change, break, or be removed; we don&rsquo;t guarantee uptime or that your data is permanent. To the extent the law allows, we&rsquo;re not liable for losses arising from using the service. Keep your own copies of anything you can&rsquo;t bear to lose.</P>

        <H>8 · Changes</H>
        <P>We may update these terms. If we make material changes we&rsquo;ll note it here and update the date above. Continuing to use cartridge.cafe means you accept the current terms.</P>

        <P className="mt-8 text-[13px] text-crema/50">Questions? See our <Link href="/privacy" className="text-brass hover:text-flame underline">Privacy Policy</Link>, or reach the keeper of the cafe.</P>
      </div>
    </main>
  )
}
