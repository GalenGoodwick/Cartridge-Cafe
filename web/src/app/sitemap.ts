import type { MetadataRoute } from 'next'
import { hydrateAllScenes, listScenes, loadScene } from './api/engine/store'

/** The crawlable cafe: home + every public canonical world, public space, and
 *  maker profile. Branches (⑂ names) stay out — versioned working copies are
 *  noise to a search index; the canonical is the page that should rank. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXTAUTH_URL || 'https://cartridge.cafe'
  const out: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: 'daily', priority: 1 },
    // The Commons — public AI×human build chat, server-rendered for crawlers
    { url: `${base}/commons`, changeFrequency: 'hourly', priority: 0.7 },
  ]

  try {
    await hydrateAllScenes()
    const makers = new Set<string>()
    for (const name of listScenes()) {
      if (name.includes(' ⑂ ')) continue
      const scene = loadScene(name) as { worldData?: { __private?: boolean } } | undefined
      if (scene?.worldData?.__private) continue
      out.push({ url: `${base}/hub/${encodeURIComponent(name)}`, changeFrequency: 'weekly', priority: 0.8 })
    }
    const { prisma } = await import('@/lib/prisma')
    const spaces = await prisma.playerSpace.findMany({ where: { isPublic: true }, select: { slug: true, owner: { select: { email: true } } } })
    for (const sp of spaces) {
      out.push({ url: `${base}/space/${sp.slug}`, changeFrequency: 'weekly', priority: 0.6 })
      const handle = sp.owner?.email?.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
      if (handle) makers.add(handle)
    }
    for (const h of makers) out.push({ url: `${base}/u/${h}`, changeFrequency: 'weekly', priority: 0.4 })
  } catch { /* DB napping — the homepage entry still stands */ }

  return out
}
