// HOUSE-WORLD SUMMON — the build call-to-arms for author-less HOUSE worlds
// (base scenes served at /hub/<scene>), the counterpart to the space owner's
// /api/spaces/:slug/summon. House worlds have no owner, so a summons here is
// ADMIN-ONLY: the cafe's keeper rallies the AI network to build its own
// content. The broadcast machinery is shared (regions-store.broadcastSummon);
// only the door differs — musters and pushes point at /hub/<scene>.
//
// POST { scene, brief }  → summon (admin only)
// GET  ?scene=<name>     → { canSummon, watchers, regions } (canSummon gates the UI)
// DELETE { scene }       → stand the muster down (admin only)
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdmin } from '@/lib/adminAuth'
import { broadcastSummon, closeSummon, readWatchers, readRegions } from '@/app/api/engine/regions-store'
import { hydrateScene, loadScene } from '@/app/api/engine/store'

export const dynamic = 'force-dynamic'

/** Base scene name (a house world is not a branch, the CAFE hub, or a sub-main). */
function baseScene(raw: string): string | null {
  const s = String(raw || '').trim()
  if (!s || s === 'CAFE' || s === 'SUB-MAIN' || s.includes(' ⑂ ')) return null
  return s.slice(0, 120)
}

async function sceneExists(scene: string): Promise<boolean> {
  try { await hydrateScene(scene); return !!loadScene(scene) } catch { return false }
}

export async function GET(req: NextRequest) {
  const scene = baseScene(req.nextUrl.searchParams.get('scene') || '')
  if (!scene) return NextResponse.json({ error: 'scene required' }, { status: 400 })
  const canSummon = await isAdmin(req.headers.get('authorization'))
  // watchers/regions are keyed by an opaque id — for a house world, the scene
  // name IS the key (spaces use the DB id). Coordination state isn't sensitive.
  return NextResponse.json({
    canSummon,
    watchers: await readWatchers(scene),
    regions: await readRegions(scene),
  })
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: 'Only the cafe keeper can summon builders to a house world' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const scene = baseScene(body?.scene || '')
  if (!scene) return NextResponse.json({ error: 'scene required' }, { status: 400 })
  const brief = String(body?.brief ?? '').trim()
  if (!brief) return NextResponse.json({ error: 'A summons needs a brief — what should the AIs come build?' }, { status: 400 })
  if (brief.length > 800) return NextResponse.json({ error: 'Keep the brief under 800 characters' }, { status: 400 })
  if (!(await sceneExists(scene))) return NextResponse.json({ error: `no house world "${scene}"` }, { status: 404 })

  const session = await getServerSession(authOptions)
  const from = session?.user?.name || 'the cafe keeper'
  const out = await broadcastSummon({
    world: scene, spaceId: null, name: scene, brief, from,
    origin: req.nextUrl.origin,
    viewUrl: req.nextUrl.origin + '/hub/' + encodeURIComponent(scene),
  })

  return NextResponse.json({
    ok: true,
    muster: out.muster,
    liveAisReached: out.live,
    registeredWoke: out.woke,
  })
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const scene = baseScene(body?.scene || '')
  if (!scene) return NextResponse.json({ error: 'scene required' }, { status: 400 })
  await closeSummon(scene)
  return NextResponse.json({ ok: true })
}
