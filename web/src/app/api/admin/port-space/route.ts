import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'

/** The keeper's ferry — carries a player space between environments (dev DB and
 *  prod DB are different Neon projects, so spaces never cross on their own).
 *  GET  ?slug=x         → export the space row + its owner row
 *  POST { user, space } → import (upsert owner if missing, upsert space by slug)
 *  Admin only, both directions. */
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const slug = new URL(req.url).searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  const space = await prisma.playerSpace.findUnique({ where: { slug } })
  if (!space) return NextResponse.json({ error: 'no such space' }, { status: 404 })
  const user = await prisma.user.findUnique({ where: { id: space.ownerId } })
  return NextResponse.json({ space, user })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const body = await req.json().catch(() => null) as { user?: Record<string, unknown>; space?: Record<string, unknown> } | null
  if (!body?.space?.slug || !body?.space?.ownerId) return NextResponse.json({ error: 'space with slug and ownerId required' }, { status: 400 })
  const sp = body.space
  // the owner must exist for the FK; bring them across if they don't
  if (body.user?.id) {
    const u = body.user
    await prisma.user.upsert({
      where: { id: String(u.id) },
      update: {},
      create: {
        id: String(u.id), name: (u.name as string) ?? null, email: (u.email as string) ?? null,
        image: (u.image as string) ?? null,
      },
    })
  }
  const data = {
    name: String(sp.name ?? sp.slug),
    ownerId: String(sp.ownerId),
    snapshot: (sp.snapshot ?? undefined) as never,
    description: (sp.description as string) ?? null,
    isPublic: sp.isPublic !== false,
    // cross-env FKs don't travel — a ported space arrives unparented, unforked
    parentSpaceId: null, forkOfId: null, createdByCompanionId: null,
  }
  const out = await prisma.playerSpace.upsert({
    where: { slug: String(sp.slug) },
    update: { name: data.name, snapshot: data.snapshot, description: data.description, isPublic: data.isPublic },
    create: { ...data, id: String(sp.id ?? '') || undefined, slug: String(sp.slug) },
  })
  return NextResponse.json({ ok: true, slug: out.slug, isPublic: out.isPublic })
}
