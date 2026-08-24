import { NextRequest, NextResponse } from 'next/server'
import { loadGameSlot } from '../../../engine/store'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/icons/[slug] — ONE world's photographed icon as a real PNG
 *  (task #13: the per-slug endpoint Card.icon references — the batch feed
 *  serves the grid; this serves a single card, an <img> tag, an unfurl).
 *  Same store as the batch: slot `world_icon:<slug>` = { png: base64 }. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const clean = slug.trim().toLowerCase()
  if (!clean || clean.length > 80) return new NextResponse('bad slug', { status: 400 })
  const doc = (await loadGameSlot(`world_icon:${clean}`)) as { png_b64?: string; failed?: boolean } | undefined
  if (!doc?.png_b64) return new NextResponse('no icon yet — the eye photographs worlds on a cadence', { status: 404 })
  try {
    const buf = Buffer.from(doc.png_b64, 'base64')
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'image/png',
        // icons refresh when the eye re-photographs — cache briefly, revalidate
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    })
  } catch {
    return new NextResponse('corrupt icon', { status: 500 })
  }
}
