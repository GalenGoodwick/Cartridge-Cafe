import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/[slug]/export?format=cartridge|itch — take your game OUT
 *  (Galen, Sep 5: 'tab to export the game… playable/uploadable to itch.io').
 *  Owner/keeper only (proprietary work must never exfiltrate via export).
 *  · cartridge → the world's full snapshot as <slug>.cartridge.json (the
 *    bootstrap format — re-importable, versionable, yours)
 *  · itch → a standalone index.html that fullscreen-embeds the LIVE world;
 *    zip it and upload to itch.io as an HTML5 game (always-latest build,
 *    no bundling). True offline desktop builds (Electron/Steam) come later. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const clean = slug.trim().toLowerCase()
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  const space = await prisma.playerSpace.findUnique({ where: { slug: clean }, select: { id: true, name: true, ownerId: true, snapshot: true } })
  if (!me || !space) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (space.ownerId !== me.id) {
    const { isAdminUserId } = await import('@/lib/adminAuth')
    if (!(await isAdminUserId(me.id))) return NextResponse.json({ error: 'only the maker exports' }, { status: 403 })
  }

  const format = req.nextUrl.searchParams.get('format') || 'cartridge'
  if (format === 'itch') {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${space.name}</title>
<style>html,body{margin:0;height:100%;background:#050509;overflow:hidden}iframe{border:0;width:100vw;height:100vh}</style>
</head><body>
<iframe src="https://cartridge.cafe/space/${clean}?embed=1" allow="fullscreen; gamepad; xr-spatial-tracking"></iframe>
</body></html>`
    return new NextResponse(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="index.html"`,
    } })
  }
  return new NextResponse(JSON.stringify({ format: 'cartridge.cafe/v1', slug: clean, name: space.name, exportedAt: Date.now(), snapshot: space.snapshot }, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${clean}.cartridge.json"`,
    },
  })
}
