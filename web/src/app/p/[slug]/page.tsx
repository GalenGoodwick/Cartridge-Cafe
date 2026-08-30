import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadPublished, bumpPageViews, slugIndex } from '@/lib/pages'
import PageBlocks from '../../pages/PageBlocks'
import AdminBar from './AdminBar'

// A live cafe page. Server-rendered for metadata; shader blocks hydrate as
// client islands (see PageBlocks / ShaderFrame). Pages are live from creation —
// unclaimed ones carry a drift banner; the $10 claim anchors them.
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
    // unclaimed addresses are provisional — keep them out of search indexes
    ...(page.claimed === false ? { robots: { index: false } } : {}),
  }
}

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = await getPage(slug)
  if (!page) notFound()
  void bumpPageViews(slug)   // count the visit — atomic, fire-and-forget

  // owner? → admin bar on the live page (the page is the workspace)
  const [session, idx] = await Promise.all([getServerSession(authOptions), slugIndex(slug)])
  const isOwner = !!session?.user?.id && !!idx && idx.ownerId === session.user.id
  const unclaimed = page.claimed === false

  return (
    <div className="min-h-dvh bg-[#0A0D13] text-[#E9EFF7]">
      {unclaimed && (
        <div className="border-b border-[#2a2410] bg-[#171307] px-4 py-1.5 text-center">
          <span className="font-mono text-[12px] text-[#8a7440]">
            unclaimed page · this address is provisional — claiming ($10) names it and anchors it forever
          </span>
        </div>
      )}
      <PageBlocks blocks={page.blocks} title={page.title} />
      <footer className={`mx-auto w-full max-w-3xl px-3 pt-4 text-center space-x-4 ${isOwner ? 'pb-20' : 'pb-8'}`}>
        <a href="/pages" className="text-[12px] font-mono text-[#3f4f63] hover:text-[#FFB25A] transition-colors">
          built on cartridge.cafe · make your own ✦
        </a>
        <Link href="/p" className="text-[12px] font-mono text-[#3f4f63] hover:text-[#FFB25A] transition-colors">
          more pages →
        </Link>
      </footer>
      {isOwner && idx && <AdminBar pageId={idx.pageId} claimed={!unclaimed} />}
    </div>
  )
}
