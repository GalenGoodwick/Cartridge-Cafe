import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readSprites, putSheet, deleteSheet } from '@/lib/sprite-store'
import { applyCommandToSnapshot } from '@/app/api/engine/space-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** SPRITES (Galen, Aug 26 — the Fortis ask). ONE pipeline with the bridge's
 *  define_sprite/define_sheet (sprite-store.ts is the shared core):
 *    GET    — the world's sheets (public: any player's tab builds the atlas)
 *    POST   — owner uploads/replaces a sheet {name, png, cols?, rows?, fps?}
 *    DELETE — owner removes a sheet ?name=…
 *  Mutations mirror metadata into worldData.sprites (rev bump → live tabs
 *  hot-load → the renderer refetches + repacks the atlas). */

async function findSpace(slug: string) {
  return prisma.playerSpace.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: { id: true, ownerId: true, isPublic: true },
  })
}

/** PREMIUM SUITE gate: media imports ride the ◆ IP-control membership
 *  (admins pass — the keeper demos). Shader-made art needs no upload. */
async function mayImportAssets(ownerId: string): Promise<boolean> {
  const { hasIpControl } = await import('@/lib/stripe')
  const { isAdminUserId } = await import('@/lib/adminAuth')
  return (await hasIpControl(ownerId)) || (await isAdminUserId(ownerId))
}

async function sessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  return u?.id ?? null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sp = await findSpace(slug)
  if (!sp) return NextResponse.json({ error: 'no such world' }, { status: 404 })
  if (!sp.isPublic) {
    // private world: only the owner's tab may pull the pixels
    const uid = await sessionUserId()
    if (!uid || uid !== sp.ownerId) return NextResponse.json({ error: 'private world' }, { status: 403 })
  }
  const doc = await readSprites(sp.id)
  return NextResponse.json({ sheets: doc.sheets })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sp = await findSpace(slug)
  if (!sp) return NextResponse.json({ error: 'no such world' }, { status: 404 })
  const uid = await sessionUserId()
  if (!uid || uid !== sp.ownerId) return NextResponse.json({ error: 'only the owner uploads sprites' }, { status: 403 })
  if (!(await mayImportAssets(uid))) {
    return NextResponse.json({ error: 'asset imports are a ◆ premium-suite feature (coming soon) — see /suite' }, { status: 402 })
  }
  const b = await req.json().catch(() => ({}))
  const out = await putSheet(sp.id, {
    name: String(b?.name ?? ''), png_b64: String(b?.png ?? b?.png_b64 ?? ''),
    cols: Number(b?.cols) || undefined, rows: Number(b?.rows) || undefined, fps: Number(b?.fps) || undefined,
  })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 })
  await applyCommandToSnapshot(sp.id, { type: 'set_world_data', data: { sprites: out.meta } }).catch(() => {})
  return NextResponse.json({ ok: true, meta: out.meta, sheets: out.doc.sheets.map(s => ({ name: s.name, cols: s.cols, rows: s.rows, fps: s.fps ?? null })) })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sp = await findSpace(slug)
  if (!sp) return NextResponse.json({ error: 'no such world' }, { status: 404 })
  const uid = await sessionUserId()
  if (!uid || uid !== sp.ownerId) return NextResponse.json({ error: 'only the owner removes sprites' }, { status: 403 })
  const name = req.nextUrl.searchParams.get('name') || ''
  const { meta } = await deleteSheet(sp.id, name)
  await applyCommandToSnapshot(sp.id, { type: 'set_world_data', data: { sprites: meta } }).catch(() => {})
  return NextResponse.json({ ok: true, meta })
}
