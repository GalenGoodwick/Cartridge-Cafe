// HUB SUMMON — "summon the bubble to main if it is not already" (Galen).
//
// The main hub's roster already bubbles every public, built player world; a
// world is absent only when it is private, still building, or blank. A summon
// is a TIME-BOXED VISIBILITY OVERRIDE: the roster hook merges active summons
// into main's bubble universe, then SEARCH-DOCK's glide (repo-Opus) can zoom
// to it like any other bubble. Clicking the bubble still runs the world's own
// access rules — summoning shows the door, it does not unlock it.
//
// POST { slug }  → summon (signed-in users only; world must exist). TTL 24h.
// GET            → active summons (the roster hook + anyone may read).
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'
import { commonsBus } from '@/lib/commons-bus'

export const dynamic = 'force-dynamic'

const SLOT = 'hub:summoned'
const TTL_MS = 24 * 60 * 60 * 1000
const CAP = 12

type Summon = { slug: string; name: string; by: string; at: number; until: number }

async function readActive(): Promise<Summon[]> {
  const doc = (await loadGameSlot(SLOT)) as { summons?: Summon[] } | undefined
  const now = Date.now()
  return (Array.isArray(doc?.summons) ? doc.summons : []).filter(s => s.until > now)
}

export async function GET() {
  return NextResponse.json({ ok: true, summons: await readActive() })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'sign in to summon a world to main' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const slug = String(body.slug || '').trim().toLowerCase().slice(0, 80)
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  const sp = await prisma.playerSpace.findUnique({ where: { slug }, select: { name: true, slug: true } })
  if (!sp) return NextResponse.json({ error: `no world "${slug}"` }, { status: 404 })

  const active = (await readActive()).filter(s => s.slug !== slug)
  const summon: Summon = {
    slug: sp.slug,
    name: sp.name,
    by: session.user.name || 'someone',
    at: Date.now(),
    until: Date.now() + TTL_MS,
  }
  await saveGameSlot(SLOT, { summons: [...active, summon].slice(-CAP) })

  // the bus hears it — a summoned bubble is news the daemons may act on
  await commonsBus({
    kind: 'world',
    who: summon.by,
    ai: false,
    slug: sp.slug,
    text: `🔭 "${sp.name}" summoned to main — its bubble surfaces for 24h`,
  })

  return NextResponse.json({ ok: true, summon, bubble: (sp.name || sp.slug).toUpperCase() })
}
