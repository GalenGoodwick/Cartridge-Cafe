import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canCreateWorld, forkSnapshotToSpace } from '@/lib/world-create'
import { hydrateScene, loadScene } from '../../store'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** POST /api/engine/scene/fork { name, label? } — fork a HOUSE/scene world into
 *  a private playerSpace the signed-in user OWNS. The fork-paradigm replacement
 *  for "create branch": instead of an ownerless `BASE ⑂ handle · v1` scene, the
 *  remixer gets a real world — maker tag, forkOf lineage, shelf-capable. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'sign in to fork a world — the fork is yours, so it needs an owner' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json().catch(() => null) as { name?: string; label?: string } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name required — which world are you forking?' }, { status: 400 })

  await hydrateScene(name)
  const scene = loadScene(name)
  if (!scene) return NextResponse.json({ error: `no world named "${name}"` }, { status: 404 })

  const gate = await canCreateWorld(user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const label = typeof body?.label === 'string' ? body.label : undefined
  // fork from the BASE display name (a fork of someone's branch credits the base line)
  const baseName = name.split(' ⑂ ')[0]
  const space = await forkSnapshotToSpace({
    userId: user.id, baseName, label,
    snapshot: scene as unknown as Prisma.InputJsonValue,
  })
  return NextResponse.json({
    ok: true, forked: true, slug: space.slug, name: space.name,
    next: `your fork lives at /space/${space.slug} — private until you publish it`,
  }, { status: 201 })
}
