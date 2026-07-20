import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { listScenes, loadScene, saveScene, hydrateAllScenes, deleteScene } from '../../engine/store'
import { invalidateSpaceCache } from '../../engine/space-store'
import { prisma } from '@/lib/prisma'

/** GET /api/admin/worlds — every world (store scenes + player spaces) with its visibility.
 *  POST { name | base, private } — scenes · POST { space: slug, private } — spaces. Admin only. */
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  await hydrateAllScenes()
  const worlds = listScenes().map(name => {
    const s = loadScene(name) as { timestamp?: number; worldData?: { __private?: boolean; built_by?: string } } | undefined
    return { name, private: !!s?.worldData?.__private, timestamp: s?.timestamp ?? 0, builtBy: s?.worldData?.built_by ?? '' }
  }).sort((a, b) => a.name.localeCompare(b.name))
  const rows = await prisma.playerSpace.findMany({
    select: { slug: true, name: true, isPublic: true, owner: { select: { name: true } } },
    orderBy: { updatedAt: 'desc' }, take: 200,
  }).catch(() => [])
  const spaces = rows.map(s => ({ slug: s.slug, name: (s.name || s.slug).toUpperCase(), private: !s.isPublic, owner: s.owner?.name ?? '' }))
  return NextResponse.json({ worlds, spaces })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const body = await req.json().catch(() => null) as { name?: string; base?: string; space?: string; private?: boolean } | null
  if ((!body?.name && !body?.base && !body?.space) || typeof body?.private !== 'boolean') return NextResponse.json({ error: 'name, base or space required, with private' }, { status: 400 })
  if (body.space) {
    // a player space: visibility is its own column, honored by /api/spaces/browse
    const up = await prisma.playerSpace.updateMany({ where: { slug: body.space }, data: { isPublic: !body.private } })
    if (!up.count) return NextResponse.json({ error: 'no such space' }, { status: 404 })
    return NextResponse.json({ ok: true, changed: up.count, private: body.private })
  }
  await hydrateAllScenes()
  // a branch's toggle covers EVERY version of it (names end ' · vN')
  const strip = (n: string) => n.replace(/ · v\d+$/, '')
  const targets = body.name ? [body.name] : listScenes().filter(n => strip(n) === body.base || n === body.base)
  let done = 0
  for (const nm of targets) {
    const sc = loadScene(nm) as { worldData?: Record<string, unknown>; timestamp?: number } | undefined
    if (!sc) continue
    sc.worldData = { ...(sc.worldData || {}), __private: body.private }
    sc.timestamp = Date.now()
    saveScene(nm, sc as never)
    done++
  }
  if (!done) return NextResponse.json({ error: 'no such world' }, { status: 404 })
  return NextResponse.json({ ok: true, changed: done, private: body.private })
}

/** DELETE /api/admin/worlds { space: slug } — hard-delete a player space, OR
 *  { name } — delete a store scene. Admin OVERRIDE: skips the owner-only fairness
 *  gates (branches/flags/lineage) — the keeper can always clear a world. */
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const body = await req.json().catch(() => null) as { space?: string; name?: string } | null
  if (!body?.space && !body?.name) return NextResponse.json({ error: 'space or name required' }, { status: 400 })

  if (body.space) {
    const space = await prisma.playerSpace.findUnique({ where: { slug: body.space }, select: { id: true } })
    if (!space) return NextResponse.json({ error: 'no such space' }, { status: 404 })
    // clear dependents that don't cascade, then the space
    await prisma.buildJob.deleteMany({ where: { spaceId: space.id } }).catch(() => {})
    invalidateSpaceCache(space.id)
    await prisma.playerSpace.delete({ where: { id: space.id } })
    return NextResponse.json({ ok: true, deleted: 'space:' + body.space })
  }

  await hydrateAllScenes()
  const strip = (n: string) => n.replace(/ · v\d+$/, '')
  const targets = listScenes().filter(n => n === body.name || strip(n) === body.name)
  if (!targets.length) return NextResponse.json({ error: 'no such world' }, { status: 404 })
  for (const nm of targets) deleteScene(nm)
  return NextResponse.json({ ok: true, deleted: targets })
}
