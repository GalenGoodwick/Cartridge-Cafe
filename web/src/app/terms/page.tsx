import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms & the Commons Deal',
  description: 'How cartridge.cafe works: you own what you make, playable worlds are on the shelf (forkable only if you allow it), unplayable worlds are yours alone.',
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="cafe-sign text-xl text-glow mt-9 mb-2">{children}</h2>
)
const P = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <p className={`text-[18px] leading-relaxed text-crema/80 mb-3 ${className}`}>{children}</p>
)

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-void text-crema/80" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <div className="mx-auto max-w-2xl px-6 py-16 font-mono">
        <Link href="/" className="text-[14px] tracking-[0.2em] text-brass hover:text-flame">◂ cartridge.cafe</Link>
        <h1 className="cafe-sign text-4xl text-glow mt-5 mb-1">terms & the commons deal</h1>
        <div className="text-[14px] tracking-[0.15em] text-crema/40 mb-2">last updated 2026-09-04</div>

        {/* the human version, up top and loud */}
        <div className="rounded-xl border border-brass/40 bg-black/30 p-5 mt-6">
          <div className="text-[14px] tracking-[0.2em] text-flame mb-2">THE COMMONS DEAL — in plain words</div>
          <P><b className="text-glow">Your worlds are yours to manage</b> &mdash; publish, unpublish, open or close building, and (within the co-builder rules) delete.</P>
          <P><b className="text-glow">Code is open source within the platform.</b> The code of playable worlds &mdash; shaders, hooks, nodes &mdash; is readable by every member through the library, and may be reused <b>inside other cartridge.cafe worlds</b>. Attribution travels with it: lineage, version history, and the library record who made what. This is the commons that makes the cafe compound.</P>
          <P><b className="text-glow">Want total IP control?</b> The <b>◆ IP control membership</b> ($100/mo, on the <Link href="/suite" className="text-brass hover:text-flame underline">premium suite</Link> page) closes the source of every world you make &mdash; playable on the shelf, never readable, never reusable &mdash; and includes your <b>company space</b>: a named page and subdomain of your own. The deal above stops applying to your work the moment you hold it.</P>
          <P><b className="text-glow">Playable worlds are on the shelf.</b> Make a world playable and anyone can play it. Forking &mdash; taking a copy to build on &mdash; exists only for <b>bases</b>: worlds explicitly marked as starting points. A fork becomes its maker&rsquo;s own world, keeps its <b>lineage</b> back to the base, and the original always stays its maker&rsquo;s &mdash; untouched.</P>
          <P><b className="text-glow">Unplayable worlds are yours alone.</b> No one else can see, open, or fork an unplayable world (crew members you have invited keep their access). A shared link simply doesn&rsquo;t open for anyone else.</P>
          <P className="mb-0"><b className="text-glow">Be decent.</b> No illegal, hateful, or seizure-inducing content. We can remove worlds and close accounts that break the rules.</P>
        </div>

        <H>1 · Your account</H>
        <P>You need an account to brew and keep worlds. You&rsquo;re responsible for what happens under your account. One person, one identity; don&rsquo;t impersonate others. We can suspend or remove accounts that abuse the service or break these terms. Manage your subscription and your data &mdash; including full export and deletion &mdash; any time from your <Link href="/account" className="text-brass hover:text-flame underline">account page</Link>.</P>

        <H>2 · What you make, and who owns it</H>
        <P>You keep ownership of the worlds and content you create. By using cartridge.cafe you grant us a worldwide, non-exclusive license to <b>host, store, display, and back up</b> your content so the service can run — nothing more. We don&rsquo;t claim ownership and we don&rsquo;t sell your worlds.</P>
        <P><b>The platform commons:</b> unless you hold the IP control membership, publishing a playable world also grants every member a license to <b>read its code and reuse it within cartridge.cafe worlds</b>, with attribution preserved through lineage and the library. This license is platform-scoped — it does not permit taking your work outside the cafe — and closing or unpublishing a world stops new reading, though work already legitimately reused stays where it landed. <b>Private worlds are never part of the commons.</b></P>
        <P><b>IP control (premium):</b> holders&rsquo; worlds are excluded from the platform commons entirely — closed source even when public — and the membership includes a <b>company space</b> (your named page and <span className="text-glow">yourname.cartridge.cafe</span> subdomain). While the membership lapses, worlds stay closed-source-by-you but new publishing falls under the standard commons deal.</P>

        <H>3 · Forking (when the maker allows it)</H>
        <P>When you make a world <b>playable</b>, every other member gets a license to <b>view and play</b> it. Forking — taking an independent copy to build on — exists only for <b>bases</b>: worlds explicitly marked as starting points (the house&rsquo;s base formats, or a world whose maker flips the base switch). A fork becomes its maker&rsquo;s own world; the base is untouched. Every fork carries <b>lineage</b> — a link back to what it came from — so credit follows the work.</P>
        <P>Forkable worlds are shared under a <b>CC BY-SA</b>-style arrangement: attribution is preserved through lineage. You can disable forking or make a world unplayable at any time to stop new forks, but forks already made remain their creators&rsquo;.</P>

        <H>4 · Private worlds</H>
        <P>A <b>private</b> world is visible only to you. It can&rsquo;t be opened, played, or forked by anyone else, and its link won&rsquo;t load for anyone but you. Privacy is the off-switch for the commons.</P>

        <H>5 · Rules of the cafe</H>
        <P>Don&rsquo;t upload or build content that is illegal, infringing, hateful, harassing, or that endangers people — including <b>strobing / flashing visuals</b>, which are rejected culture-wide. Don&rsquo;t attack the service, other members, or their worlds. We may remove content and close accounts at our discretion to keep the cafe safe.</P>

        <H>6 · AI-built worlds</H>
        <P>Worlds are built by AI agents <b>you connect</b> — there is no house AI building on your behalf. You&rsquo;re responsible for the briefs you submit, the agents you connect, and the worlds they produce, the same as anything else you make here.</P>

        <H>7 · Payments</H>
        <P>Playing is free. The <b>editing membership</b> is a monthly subscription (currently $10/mo) that grants a seat to build on open building worlds; the <b>IP control membership</b> <em>(coming soon)</em> is a premium subscription that closes your worlds&rsquo; source, unlocks <b>asset imports</b> (sprite uploads/ripping today; 3D models and music/sfx as those pipelines land), and includes a <b>company space</b> — a private-dev door for your apps (yourname.cartridge.cafe); <b>world generation</b> is a one-time purchase per world; some worlds are <b>paid experiences</b> priced by their makers. All payments are processed by Stripe &mdash; we never see your card. You can <b>cancel your subscription at any time</b> from your <Link href="/account" className="text-brass hover:text-flame underline">account page</Link> &mdash; one direct click, or through Stripe&rsquo;s own portal; canceling keeps your seat until the period ends. Your worlds and credit stay yours after a lapse &mdash; only the build seat pauses.</P>

        <H>8 · Open building &amp; co-builders</H>
        <P>A world whose maker opens building invites others&rsquo; real work into it. In fairness to co-builders, a <b>public open-building world that others have built in can&rsquo;t be deleted outright</b> &mdash; its maker can close building or unpublish it (both reversible) first. If an account is deleted, such worlds are preserved for the community, disconnected from the departed maker&rsquo;s identity.</P>

        <H>9 · Our software</H>
        <P>The cartridge.cafe platform itself — its code, engine, shaders, design, and branding — is <b>proprietary</b> and remains ours (see the project&rsquo;s license, <span className="text-glow">All Rights Reserved</span>). Running the site in your browser to use the service is fine; copying, reverse-engineering, or reusing our software to build a competing or derivative product is not. This is separate from the worlds <b>you</b> make, which stay yours under sections&nbsp;2&ndash;4.</P>

        <H>10 · The service, as-is</H>
        <P>cartridge.cafe is provided &ldquo;as is,&rdquo; without warranties. Worlds can change, break, or be removed; we don&rsquo;t guarantee uptime or that your data is permanent. To the extent the law allows, we&rsquo;re not liable for losses arising from using the service. Keep your own copies of anything you can&rsquo;t bear to lose.</P>

        <H>11 · Changes</H>
        <P>We may update these terms. If we make material changes we&rsquo;ll note it here and update the date above. Continuing to use cartridge.cafe means you accept the current terms.</P>

        <P className="mt-8 text-[16px] text-crema/50">Questions? See our <Link href="/privacy" className="text-brass hover:text-flame underline">Privacy Policy</Link>, your <Link href="/account" className="text-brass hover:text-flame underline">account page</Link>, or ask in <Link href="/commons" className="text-brass hover:text-flame underline">the commons</Link>.</P>
      </div>
    </main>
  )
}
