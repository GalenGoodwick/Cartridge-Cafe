import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { loadPublished, bumpPageViews } from '@/lib/pages'
import PageBlocks from '../../pages/PageBlocks'

// Permanently-hosted, published cafe page. Server-rendered for metadata; shader
// blocks hydrate as client islands (see PageBlocks / ShaderFrame).
export const dynamic = 'force-dynamic'

// generateMetadata + the page component both need the doc — cache() dedupes
// them into one store read per request.
const getPage = cache(loadPublished)

function firstText(blocks: { kind: string; text?: string }[]): string | undefined {
  const t = blocks.find((b) => (b.kind === 'text' || b.kind === 'heading') && b.text)?.text
  return t?.slice(0, 160)
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const page = await getPage(slug)
  if (!page) return { title: 'Page not found · cartridge.cafe' }
  const description = firstText(page.blocks) || 'A page built on cartridge.cafe.'
  return {
    title: `${page.title} · cartridge.cafe`,
    description,
    openGraph: { title: page.title, description, type: 'website' },
  }
}

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = await getPage(slug)
  if (!page) notFound()
  void bumpPageViews(slug)   // count the visit — atomic, fire-and-forget

  return (
    <div className="min-h-dvh bg-[#0A0D13] text-[#E9EFF7]">
      <PageBlocks blocks={page.blocks} title={page.title} />
      <footer className="mx-auto w-full max-w-3xl px-3 pb-8 pt-4 text-center space-x-4">
        <a href="/pages" className="text-[11px] font-mono text-[#3f4f63] hover:text-[#FFB25A] transition-colors">
          built on cartridge.cafe · make your own ✦
        </a>
        <Link href="/p" className="text-[11px] font-mono text-[#3f4f63] hover:text-[#FFB25A] transition-colors">
          more pages →
        </Link>
      </footer>
    </div>
  )
}
