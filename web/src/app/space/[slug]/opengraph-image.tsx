import { after } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  loadSpaceOgCard, spaceOgState, bakeSpaceOgCard, spaceTemplateResponse, spaceLookHash,
  OG_SIZE,
} from '@/lib/og-card'

// Per-world OG card — SERVED, never rendered here (same law as the site card).
// The old design rendered the world through the eye AT SCRAPE TIME: 14s on a
// real public world (measured, tideglass Aug 20) — every scraper timed out and
// shared links showed nothing. Now the finished card lives in slot
// og_card:space:<slug>; this route is a byte copy. Staleness is the world's
// LOOK-SIGNATURE (iconSnapshotHash): a card re-bakes (in the background, via
// after()) only when the world actually changed. Eye-hostile worlds carry a
// failure record and serve their night template instantly, forever, until they
// change. PRIVATE worlds serve a NAMELESS generic card — this route is public,
// and a guessed URL must not leak a private world's pixels or name.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// headroom for a background bake scheduled by after() (render-service round-trip)
export const maxDuration = 60
export const alt = 'A world on cartridge.cafe'
export const size = OG_SIZE
export const contentType = 'image/png'

const CACHE_OK = 'public, s-maxage=86400, stale-while-revalidate=604800'
const CACHE_SOON = 'public, s-maxage=300'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const space = await prisma.playerSpace
    .findUnique({ where: { slug }, select: { name: true, snapshot: true, isPublic: true, owner: { select: { name: true } } } })
    .catch(() => null)

  // unknown or PRIVATE world: a nameless card, long-cached — nothing to leak,
  // nothing to bake. (Scrapers never get pointed here for private worlds — the
  // page 404s them onto the site card — this guards direct URL guesses.)
  if (!space || !space.isPublic) {
    return spaceTemplateResponse('a world', 'someone', { 'Cache-Control': CACHE_OK })
  }

  const name = space.name || slug
  const owner = space.owner?.name || 'someone'
  const snap = (space.snapshot ?? {}) as Parameters<typeof bakeSpaceOgCard>[1]
  const hash = spaceLookHash(snap)
  const record = await loadSpaceOgCard(slug)
  const state = spaceOgState(record, hash)

  if ((state === 'ok' || state === 'stale') && record?.png_b64) {
    if (state === 'stale') {
      after(() => bakeSpaceOgCard(slug, snap, hash, name, owner).catch(() => {}))
    }
    return new Response(Buffer.from(record.png_b64, 'base64'), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE_OK },
    })
  }

  if (state === 'failed') {
    // the eye already ran on exactly this content and got nothing — the template
    // IS this world's card until the world changes. Long cache, no re-bake.
    return spaceTemplateResponse(name, owner, { 'Cache-Control': CACHE_OK })
  }

  // missing (or stale-with-no-bytes): NEVER make a scraper wait on the eye —
  // template now with a short cache, real card bakes behind the response.
  after(() => bakeSpaceOgCard(slug, snap, hash, name, owner).catch(() => {}))
  return spaceTemplateResponse(name, owner, { 'Cache-Control': CACHE_SOON })
}
