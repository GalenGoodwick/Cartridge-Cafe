import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAdminToken } from '@/lib/adminAuth'
import { loadGameSlot } from '../../../engine/store'
import { getSpaceSnapshot, applyCommandToSnapshot } from '../../../engine/space-store'
import { historyMeta, type NodeHist, type FeedLine } from '@/lib/node-dock'

export const dynamic = 'force-dynamic'

/** THE DOCK PANEL's data + revert door (co-build rung 4).
 *  GET  — the world's node roster: hooks (with hold state), shaders (visual:/
 *         module: history keys), each with history meta (no code bodies) and
 *         its feed tail. Readable by anyone who can see the world.
 *  POST — {id, rev?} human REVERT (owner session only): lands through the same
 *         node_revert law the bridge uses (bad rev marked, restore is a forward
 *         version). The live tab adopts it on the next sync beat. */

async function spaceFor(slug: string) {
  return prisma.playerSpace.findUnique({ where: { slug }, select: { id: true, ownerId: true, isPublic: true } })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sp = await spaceFor(slug)
  if (!sp) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const session = await getServerSession(authOptions).catch(() => null)
  const me = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null
  if (!sp.isPublic && me?.id !== sp.ownerId && !isAdminToken(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const snap = await getSpaceSnapshot(sp.id)
  const wd = (snap?.worldData ?? {}) as Record<string, unknown>
  const nodes = (wd.__nodes && typeof wd.__nodes === 'object' ? wd.__nodes : {}) as Record<string, Record<string, unknown>>
  const hist = (wd.__nodeHist && typeof wd.__nodeHist === 'object' ? wd.__nodeHist : {}) as NodeHist

  // one roster: hook nodes + shader histories (visual:/module: keys)
  const ids = new Set([...Object.keys(nodes), ...Object.keys(hist)])
  const feedWanted = req.nextUrl.searchParams.get('feed')   // ?feed=<id> → include that node's feed tail
  const roster = await Promise.all([...ids].map(async id => {
    const n = nodes[id]
    const kind = id.startsWith('visual:') ? 'visual' : id.startsWith('module:') ? 'module' : 'hook'
    const feed = feedWanted === id
      ? (((await loadGameSlot(`nodefeed:${sp.id}:${id}`)) as FeedLine[] | undefined) ?? []).slice(-40)
      : undefined
    return {
      id, kind,
      rev: Number(n?.rev) || (hist[id]?.[hist[id].length - 1]?.rev ?? 0),
      holder: typeof n?.holder === 'string' ? (n.holder as string).slice(0, 8) : null,
      heldAt: Number(n?.heldAt) || null,
      history: historyMeta(hist, id),
      feed,
    }
  }))
  // families stay adjacent: "world" then "world:atrium" (plain localeCompare
  // already interleaves parents before their prefixed children); kinds grouped
  roster.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)))
  return NextResponse.json({ nodes: roster, now: Date.now() })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sp = await spaceFor(slug)
  if (!sp) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const session = await getServerSession(authOptions).catch(() => null)
  const me = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null
  const admin = isAdminToken(req.headers.get('authorization'))
  if (me?.id !== sp.ownerId && !admin) {
    return NextResponse.json({ error: 'only the world owner reverts from the panel' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'revert needs an {id}' }, { status: 400 })

  // shader nodes revert through their define command; hooks through node_revert
  if (id.startsWith('visual:') || id.startsWith('module:')) {
    const kind = id.startsWith('visual:') ? 'visual' : 'module'
    const name = id.slice(kind.length + 1)
    const snap = await getSpaceSnapshot(sp.id, true)
    const hist = ((snap?.worldData as Record<string, unknown>)?.__nodeHist ?? {}) as NodeHist
    const rev = body.rev !== undefined ? Number(body.rev) : undefined
    const chain = hist[id] ?? []
    const target = rev !== undefined
      ? chain.find(r => r.rev === rev && !r.bad)
      : [...chain].reverse().find(r => !r.bad && r.rev !== (chain[chain.length - 1]?.rev))
    if (!target) return NextResponse.json({ error: `no good version of "${id}" to revert to` }, { status: 400 })
    const out = await applyCommandToSnapshot(sp.id, {
      type: kind === 'visual' ? 'define_visual' : 'define_module',
      name, wgsl: target.code,
      __holder: 'owner-panel', __now: Date.now(), __admin: true,
    })
    if (out.error) return NextResponse.json({ error: String(out.error) }, { status: 400 })
    return NextResponse.json({ ok: true, revertedTo: target.rev })
  }

  const out = await applyCommandToSnapshot(sp.id, {
    type: 'node_revert', id,
    ...(body.rev !== undefined ? { rev: Number(body.rev) } : {}),
    reason: 'owner revert from the dock panel',
    __holder: 'owner-panel', __now: Date.now(), __admin: true,
  })
  if (out.ok !== true) return NextResponse.json({ error: String(out.error ?? 'revert failed') }, { status: 400 })
  return NextResponse.json({ ok: true, revertedTo: out.revertedTo, markedBad: out.markedBad })
}
