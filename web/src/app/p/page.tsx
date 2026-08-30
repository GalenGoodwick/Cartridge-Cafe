import type { Metadata } from 'next'
import Link from 'next/link'
import { listPublishedPages, loadPublished } from '@/lib/pages'
import PageCard from './PageCard'

// THE PAGES HUB — the shelf of published pages. Two rails (fresh / most
// visited), every card a live GPU window, server-rendered so crawlers see real
// text and real links. This is the front door of the pages network.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Pages · cartridge.cafe',
  description: 'Living pages built with AI — every frame is a shader running on your GPU. Browse the newest and most-visited, then make your own: free to build, $10 to publish forever.',
}

const RAIL = 12   // cards per rail

export default async function PagesHub() {
  // the shelf shows CLAIMED pages — unclaimed ones are live but unlisted
  // (shareable by link; the $10 buys the listing + the permanent name)
  const all = (await listPublishedPages()).filter((p) => p.claimed !== false)
  const fresh = [...all].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, RAIL)
  const top = [...all].filter((p) => (p.views ?? 0) > 0).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, RAIL)

  // hero shaders for every card actually shown (unique slugs, one read each)
  const shown = [...new Set([...fresh, ...top].map((p) => p.slug))]
  const heroes = new Map<string, string | null>()
  await Promise.all(shown.map(async (slug) => {
    const page = await loadPublished(slug)
    const shader = page?.blocks.find((b) => b.kind === 'shader')
    heroes.set(slug, shader && 'wgsl' in shader ? shader.wgsl : null)
  }))

  return (
    <div className="min-h-dvh bg-[#0A0D13] text-[#E9EFF7]">
      <header className="border-b border-[#1c2941] px-4 py-10 text-center">
        <p className="font-mono text-[12px] tracking-[0.3em] text-[#55677E] uppercase">cartridge.cafe</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          <span className="text-[#FFB25A]">✦</span> Pages
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#7E93AC]">
          Living pages — every frame is a shader imagined by an AI, running live on your GPU.
          Yours is live the moment you make it. <span className="text-[#c7d3e0]">$10 names it and puts it on this shelf, forever.</span>
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <a href="/pages" className="rounded-md bg-[#FF6A2B] px-5 py-2.5 text-sm font-semibold text-[#140a04] hover:bg-[#ff7d44] transition-colors">
            ＋ make your page
          </a>
          <a href="/pages#connect" className="rounded-md border border-[#26364e] px-5 py-2.5 text-sm font-mono text-[#7E93AC] hover:text-[#E9EFF7] hover:border-[#3a5075] transition-colors">
            ⚡ connect your AI
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 space-y-12">
        {all.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[#7E93AC]">The shelf is empty — yours could be the first page here.</p>
            <a href="/pages" className="mt-4 inline-block font-mono text-sm text-[#FFB25A] underline underline-offset-2">start building →</a>
          </div>
        ) : (
          <>
            <section>
              <h2 className="mb-4 font-mono text-xs tracking-[0.25em] text-[#55677E] uppercase">fresh off the press</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {fresh.map((p) => (
                  <PageCard key={p.slug} slug={p.slug} title={p.title} desc={p.desc} views={p.views} heroWgsl={heroes.get(p.slug)} />
                ))}
              </div>
            </section>

            {top.length > 0 && (
              <section>
                <h2 className="mb-4 font-mono text-xs tracking-[0.25em] text-[#55677E] uppercase">most visited</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {top.map((p) => (
                    <PageCard key={p.slug} slug={p.slug} title={p.title} desc={p.desc} views={p.views} heroWgsl={heroes.get(p.slug)} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 pb-10 text-center">
        <Link href="/" className="font-mono text-[12px] text-[#3f4f63] hover:text-[#FFB25A] transition-colors">
          ← back to the cafe
        </Link>
      </footer>
    </div>
  )
}
