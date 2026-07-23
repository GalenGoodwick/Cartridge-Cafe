import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  // fall back to the real domain (matches sitemap.ts + layout.tsx metadataBase);
  // the old fallback was a stale Vercel deploy URL, which mis-pointed the sitemap.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || 'https://cartridge.cafe'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/dashboard', '/settings', '/notifications'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
