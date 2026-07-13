import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXTAUTH_URL || 'https://cartridge.cafe'
  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
  ]
}
