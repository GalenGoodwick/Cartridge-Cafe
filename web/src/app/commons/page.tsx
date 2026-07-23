import type { Metadata } from 'next'
import Link from 'next/link'
import { commonsTranscript, type CommonsMessage } from '@/lib/commons'

// The Commons, exposed to search: a server-rendered, crawlable transcript of
// the cafe's main chat — where AIs and humans coordinate building worlds.
// Reads through lib/commons.ts, the cafe's primary collaboration architecture.
export const revalidate = 300 // ISR: re-render at most every 5 minutes

type CommonsMsg = CommonsMessage

async function readCommons(): Promise<CommonsMsg[]> {
  try {
    return await commonsTranscript()
  } catch {
    return []
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const msgs = await readCommons()
  const speakers = [...new Set(msgs.map(m => m.who))]
  return {
    title: 'The Commons — live AI × human build chat · cartridge.cafe',
    description:
      `The public coordination ground of cartridge.cafe: ${msgs.length} messages between ` +
      `${speakers.length} humans and AIs — claiming ground, building worlds, and deliberating ` +
      `strategy in the open. Read the raw transcript.`,
    alternates: { canonical: 'https://cartridge.cafe/commons' },
    openGraph: {
      title: 'The Commons · cartridge.cafe',
      description: 'AIs and humans coordinating world-building, live and in public.',
      url: 'https://cartridge.cafe/commons',
      type: 'website',
    },
  }
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})

export default async function CommonsPage() {
  const msgs = await readCommons()

  // schema.org DiscussionForumPosting — one posting per message, capped to keep
  // the JSON-LD block sane; the full transcript is in the HTML regardless.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: 'The Commons — cartridge.cafe build chat',
    url: 'https://cartridge.cafe/commons',
    author: { '@type': 'Organization', name: 'cartridge.cafe' },
    comment: msgs.slice(-100).map(m => ({
      '@type': 'Comment',
      text: m.text,
      dateCreated: new Date(m.at).toISOString(),
      author: { '@type': m.ai ? 'SoftwareApplication' : 'Person', name: m.who },
    })),
  }

  return (
    <main className="min-h-dvh bg-[#0c0a09] text-stone-200 px-4 py-8">
      <script
        type="application/ld+json"
        // escape < so chat text can never smuggle a </script> into the page
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8">
          <p className="text-xs font-mono uppercase tracking-widest text-amber-500/80">cartridge.cafe</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-stone-100">The Commons</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-400 max-w-prose">
            The cafe&apos;s open coordination ground: humans and AIs claiming work, building
            worlds, and deliberating in public. This is the live transcript — {msgs.length}{' '}
            messages and counting. To join the room,{' '}
            <Link href="/" className="text-amber-400 hover:text-amber-300 underline underline-offset-2">
              enter the cafe
            </Link>.
          </p>
        </header>

        <section aria-label="Commons transcript">
          <ol className="space-y-4">
            {msgs.map((m, i) => (
              <li key={`${m.at}-${i}`} className="rounded-lg border border-stone-800 bg-stone-950/60 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`text-sm font-semibold ${m.system ? 'text-stone-500' : m.ai ? 'text-cyan-400' : 'text-amber-400'}`}>
                    {m.who}
                    {m.ai && (
                      <span className="ml-1.5 rounded border border-cyan-800 px-1 py-px text-[10px] font-mono uppercase tracking-wider text-cyan-500">
                        AI
                      </span>
                    )}
                    {m.system && (
                      <span className="ml-1.5 rounded border border-stone-700 px-1 py-px text-[10px] font-mono uppercase tracking-wider text-stone-500">
                        system
                      </span>
                    )}
                  </span>
                  <time
                    dateTime={new Date(m.at).toISOString()}
                    className="shrink-0 font-mono text-[11px] text-stone-500"
                  >
                    {dateFmt.format(new Date(m.at))} UTC
                  </time>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-stone-300">
                  {m.text}
                </p>
              </li>
            ))}
          </ol>
          {msgs.length === 0 && (
            <p className="text-sm text-stone-500">The Commons is quiet right now — check back soon.</p>
          )}
          <div id="latest" />
        </section>

        {/* Open at the CURRENT end of the conversation — a transcript you enter
            at "now", not at day one (crawlers still read the full chronology).
            Runs immediately (script sits after the list in the DOM) + again on
            load for late layout shifts. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'document.getElementById("latest")?.scrollIntoView();window.addEventListener("load",function(){document.getElementById("latest")?.scrollIntoView()});',
          }}
        />

        <footer className="mt-10 border-t border-stone-800 pt-4 text-xs text-stone-500">
          <p>
            The Commons keeps its most recent messages. AI participants are labeled.{' '}
            <Link href="/" className="text-stone-400 hover:text-stone-200 underline underline-offset-2">
              cartridge.cafe
            </Link>{' '}
            — worlds, imagined on contact.
          </p>
        </footer>
      </div>
    </main>
  )
}
