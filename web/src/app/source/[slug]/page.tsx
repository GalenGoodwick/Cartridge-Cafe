// /source/[slug] — THE PUBLIC SOURCE PAGE (the SEO surface, Galen Sep 5 2026).
// A world's play page is a canvas: crawlers see nothing. This page is the same
// world as TEXT: vision, instructions, and full source (WGSL visuals, shader
// modules, step hooks), server-rendered so search engines and AI systems can
// read what the cafe's commons actually contains. Terms §2 grants exactly this
// exposure for free/editing-tier published worlds; IP-control holders' worlds
// and private worlds return 404 and never appear in the sitemap.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import { getSpaceSnapshot } from '@/app/api/engine/space-store'
import { hasIpShield } from '@/lib/stripe'

export const revalidate = 3600   // ISR: crawls hit the cache, never the hot path

type Snap = {
  worldData?: Record<string, unknown>
  visualTypes?: { name?: string; wgsl?: string }[]
  modules?: { name?: string; wgsl?: string }[]
  stepHooks?: { id?: string; hookId?: string; author?: string; description?: string; code?: string }[]
  fields?: unknown[]
}

async function loadPublicWorld(slug: string) {
  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, isPublic: true, ownerId: true },
  })
  if (!space || !space.isPublic) return null
  if (await hasIpShield(space.ownerId)) return null   // closed source never leaks
  const snap = (await getSpaceSnapshot(space.id)) as Snap | null
  if (!snap) return null
  return { space, snap }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const w = await loadPublicWorld(slug)
  if (!w) return { title: 'source not found' }
  const wd = w.snap.worldData || {}
  const blurb = typeof wd.blurb === 'string' ? wd.blurb : ''
  const vision = typeof wd.vision === 'string' ? wd.vision : ''
  return {
    title: `${w.space.name} — open source world code`,
    description: (blurb || vision || `Full WGSL and JavaScript source of ${w.space.name}, a live world on cartridge.cafe.`).slice(0, 300),
    alternates: { canonical: `/source/${w.space.slug}` },
  }
}

const Code = ({ title, meta, code }: { title: string; meta?: string; code: string }) => (
  <section className="mb-8">
    <h3 className="font-mono text-[15px] tracking-[0.15em] text-brass mb-1">{title}</h3>
    {meta && <div className="font-mono text-[12px] text-crema/40 mb-2">{meta}</div>}
    <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/50 p-4 text-[12.5px] leading-relaxed text-crema/80"><code>{code}</code></pre>
  </section>
)

export default async function SourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const w = await loadPublicWorld(slug)
  if (!w) notFound()
  const wd = w.snap.worldData || {}
  const vision = typeof wd.vision === 'string' ? wd.vision : ''
  const instructions = typeof wd.instructions === 'string' ? wd.instructions : ''
  const blurb = typeof wd.blurb === 'string' ? wd.blurb : ''
  const builtBy = typeof wd.built_by === 'string' ? wd.built_by : ''
  const visuals = (w.snap.visualTypes || []).filter((v) => v?.wgsl)
  const modules = (w.snap.modules || []).filter((m) => m?.wgsl)
  const hooks = (w.snap.stepHooks || []).filter((h) => h?.code)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: w.space.name,
    description: blurb || vision.slice(0, 200),
    programmingLanguage: ['WGSL', 'JavaScript'],
    runtimePlatform: 'WebGPU',
    url: `https://cartridge.cafe/source/${w.space.slug}`,
    targetProduct: { '@type': 'VideoGame', name: w.space.name, url: `https://cartridge.cafe/space/${w.space.slug}` },
  }

  return (
    <main className="min-h-screen text-crema/80" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto max-w-3xl px-6 py-14">
        <div className="font-mono text-[13px] tracking-[0.2em] text-brass"><Link href="/" className="hover:text-flame">cartridge.cafe</Link> · open source world</div>
        <h1 className="cafe-sign text-4xl text-glow mt-3 mb-2">{w.space.name}</h1>
        {blurb && <p className="text-[19px] text-crema/85 mb-4">{blurb}</p>}
        <div className="flex gap-3 mb-8 font-mono text-[13px] tracking-[0.18em]">
          <Link href={`/space/${w.space.slug}`} className="px-4 py-2 rounded-xl border border-brass/60 bg-brass/15 text-crema hover:bg-brass/25">▸ PLAY THIS WORLD</Link>
          <Link href="/terms" className="px-4 py-2 rounded-xl border border-white/20 text-crema/60 hover:text-crema">the commons deal</Link>
        </div>

        {vision && (<section className="mb-8">
          <h2 className="font-mono text-[14px] tracking-[0.25em] text-flame mb-2">THE VISION</h2>
          <p className="text-[16px] leading-relaxed text-crema/75 whitespace-pre-wrap">{vision}</p>
        </section>)}
        {instructions && (<section className="mb-8">
          <h2 className="font-mono text-[14px] tracking-[0.25em] text-flame mb-2">HOW TO PLAY</h2>
          <p className="text-[16px] leading-relaxed text-crema/75 whitespace-pre-wrap">{instructions}</p>
        </section>)}

        <section className="mb-8 font-mono text-[13px] text-crema/50 leading-relaxed">
          {builtBy && <div>built by: {builtBy}</div>}
          <div>{visuals.length} visual shader{visuals.length === 1 ? '' : 's'} · {modules.length} shader module{modules.length === 1 ? '' : 's'} · {hooks.length} step hook{hooks.length === 1 ? '' : 's'} · runs on WebGPU in the browser</div>
          <div className="mt-1">This source is part of the cartridge.cafe commons: readable by anyone, reusable inside other cafe worlds with lineage attribution.</div>
        </section>

        <h2 className="font-mono text-[15px] tracking-[0.25em] text-flame mb-4 mt-10">— VISUAL SHADERS (WGSL) —</h2>
        {visuals.map((v, i) => <Code key={i} title={`visual · ${v.name || 'unnamed'}`} code={v.wgsl || ''} />)}
        {modules.length > 0 && <h2 className="font-mono text-[15px] tracking-[0.25em] text-flame mb-4 mt-10">— SHADER MODULES —</h2>}
        {modules.map((m, i) => <Code key={i} title={`module · ${m.name || 'unnamed'}`} code={m.wgsl || ''} />)}
        {hooks.length > 0 && <h2 className="font-mono text-[15px] tracking-[0.25em] text-flame mb-4 mt-10">— STEP HOOKS (JAVASCRIPT) —</h2>}
        {hooks.map((h, i) => <Code key={i} title={`hook · ${h.id || h.hookId || 'unnamed'}`} meta={h.description || (h.author ? `by ${h.author}` : undefined)} code={h.code || ''} />)}

        <footer className="mt-12 pt-6 border-t border-white/10 font-mono text-[12px] text-crema/40 leading-relaxed">
          cartridge.cafe is a live, community-edited AI interactive world generator. Worlds are built by humans and the AIs they connect;
          free-tier and editing-tier world code is open source under <Link href="/terms" className="text-brass/70 hover:text-flame">the commons deal</Link>.
          Want copyright and confidentiality? The <Link href="/suite" className="text-brass/70 hover:text-flame">◆ IP control membership</Link> is the private development chamber. Teams: <Link href="/contact" className="text-brass/70 hover:text-flame">contact us</Link>.
        </footer>
      </div>
    </main>
  )
}
