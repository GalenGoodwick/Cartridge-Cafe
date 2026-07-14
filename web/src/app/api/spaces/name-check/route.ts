import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/name-check?name=Foo&self=slug — is the name's derived slug
 *  free? Mirrors the slug rule in the PATCH route so the brew panel can gate
 *  the brief on a truly unique name. `self` excludes the caller's own draft. */
export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get('name') || '').trim()
  const self = (req.nextUrl.searchParams.get('self') || '').trim()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  if (!slug) return NextResponse.json({ available: false, slug: '' })
  const taken = await prisma.playerSpace.findUnique({ where: { slug }, select: { slug: true } })
  const available = !taken || taken.slug === self
  return NextResponse.json({ available, slug })
}
