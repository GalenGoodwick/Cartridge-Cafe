import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { saveGameSlotStrict } from '@/app/api/engine/store'

export const dynamic = 'force-dynamic'

/** POST /api/spaces/[slug]/card-shot — SET VISUAL (Galen, Sep 5: "not a call
 *  to produce an icon. just a direct snapshot of the game"). The owner takes
 *  the EYE's current shot and makes it the world's games-page visual — written
 *  into the SAME `world_icon:<slug>` slot the icon photographer uses, so every
 *  card surface (grid, unfurls, /api/spaces/icons/[slug]) picks it up with
 *  zero new render machinery. Blob lives in the slot, never in worldData
 *  (the detoast law). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const clean = slug.trim().toLowerCase()
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  const space = await prisma.playerSpace.findUnique({ where: { slug: clean }, select: { id: true, ownerId: true } })
  if (!user || !space) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (space.ownerId !== user.id) {
    const { isAdminUserId } = await import('@/lib/adminAuth')
    if (!(await isAdminUserId(user.id))) return NextResponse.json({ error: 'only the world’s creator sets its visual' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as { png_b64?: string }
  let png = String(body.png_b64 ?? '')
  const comma = png.indexOf(',')
  if (png.startsWith('data:') && comma > 0) png = png.slice(comma + 1)   // accept data-URLs
  if (!png || png.length < 100) return NextResponse.json({ error: 'no shot — open the EYE and take one first' }, { status: 400 })
  if (png.length > 2_000_000) return NextResponse.json({ error: 'shot too large (2MB cap)' }, { status: 413 })
  try { Buffer.from(png, 'base64') } catch { return NextResponse.json({ error: 'not valid base64 png' }, { status: 400 }) }
  await saveGameSlotStrict(`world_icon:${clean}`, { png_b64: png, at: Date.now(), by: 'set-visual' })
  return NextResponse.json({ ok: true, next: 'the games page now shows this exact frame' })
}
