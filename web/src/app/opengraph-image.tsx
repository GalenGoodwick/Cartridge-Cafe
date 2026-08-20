import { after } from 'next/server'
import {
  loadOgCard, ogCardState, bakeSiteOgCard, fallbackCardResponse,
  OG_SIZE, OG_ALT,
} from '@/lib/og-card'

// The SITE share card (cartridge.cafe) — SERVED, never rendered here. The card
// (featured world NOCTURNE DISTRICT under the wordmark, Galen's pick) is baked
// ahead of time into slot `og_card:site` by src/lib/og-card.tsx; this route is a
// byte copy in milliseconds. The old design rendered through the eye AT SCRAPE
// TIME behind ISR — correct on a cache hit, but every miss (revalidation, fresh
// deploy, cold edge region) took the 14s render round-trip and LinkedIn's /
// Telegram's short-fetch bots timed out and kept their STALE card. Pre-bake +
// stale-while-revalidate closes that miss path: a scraper always gets a finished
// PNG now; aging cards re-bake in the background via after().
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// headroom for a background bake scheduled by after() (render-service round-trip)
export const maxDuration = 60
export const alt = OG_ALT
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  const record = await loadOgCard()

  if (record) {
    // serve the baked card instantly; if it's aging, refresh it AFTER the response
    if (ogCardState(record, Date.now()) === 'stale') {
      after(() => bakeSiteOgCard().catch(() => {}))
    }
    return new Response(Buffer.from(record.png_b64, 'base64'), {
      headers: {
        'Content-Type': 'image/png',
        // long CDN cache — most scrapes never even reach this lambda; the slot
        // re-bake (daily, background) is the real freshness mechanism
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  }

  // No baked card yet (first boot / slot wiped): NEVER make a scraper wait on
  // the eye — serve the wordmark-on-night fallback with a SHORT cache and bake
  // in the background so the next scrape gets the real card.
  after(() => bakeSiteOgCard().catch(() => {}))
  return fallbackCardResponse({ 'Cache-Control': 'public, s-maxage=300' })
}
