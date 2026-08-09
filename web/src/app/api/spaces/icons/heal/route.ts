import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAdmin } from '@/lib/adminAuth'
import { bakeAllUnhealthy } from '@/lib/icon-bake-queue'
import { loadScene, listScenes, hydrateAllScenes } from '../../../engine/store'
import { getLineage } from '../../../engine/lineage'

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // a full sweep photographs many worlds through the eye

type Snap = {
  fields?: unknown[]
  stepHooks?: unknown[]
  visualTypes?: unknown[]
  worldData?: { creation_brief?: unknown; brief_done?: unknown } & Record<string, unknown>
} | null

/** POST /api/spaces/icons/heal — the deterministic backstop for the lazy shelf
 *  heal. Walks every non-blank world, re-bakes any whose icon is missing or stale
 *  (bounded concurrency), and returns a summary. Admin/cron only. GET mirrors it
 *  so it can be wired to a scheduled fetch. */
async function run(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdmin(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // PUBLIC worlds only by default: baking the hundreds of private/test/branch
  // worlds nobody sees just pounds the (fragile software-GPU) eye for nothing.
  // ?all=1 opts into everything. The shelf = public spaces + house scenes.
  const includeAll = new URL(req.url).searchParams.get('all') === '1'
  const spaces = await prisma.playerSpace.findMany({
    where: includeAll ? undefined : { isPublic: true },
    select: { slug: true, snapshot: true },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  const worlds = spaces
    .map(s => ({ slug: s.slug, sn: s.snapshot as Snap }))
    .filter(({ sn }) => {
      const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
      if (blank) return false
      if (sn?.worldData?.creation_brief && !sn?.worldData?.brief_done) return false
      return true
    })
    .map(({ slug, sn }) => ({ slug, snap: sn as never }))

  // house SCENES bake through the same pipeline (keyed scene:<liveName>, matching
  // what scene-icons serves). Since lazy bake is off, the sweep is how scenes
  // (veilfire etc.) get their photo. Skip CAFE/SUB-MAIN/branches/private.
  const sceneWorlds: Array<{ slug: string; snap: never }> = []
  try {
    await hydrateAllScenes()
    for (const name of listScenes()) {
      if (name === 'CAFE' || name === 'SUB-MAIN' || name.includes(' ⑂ ') || name.includes('␂')) continue
      let liveName = name
      try {
        const lin = await getLineage(name)
        if (lin?.mainHolder && lin.original && lin.mainHolder !== lin.original
            && !lin.mainHolder.startsWith('space:') && loadScene(lin.mainHolder)) liveName = lin.mainHolder
      } catch { /* base is a fine fallback */ }
      let scene: Snap = null
      try { scene = (loadScene(liveName) as unknown as Snap) } catch { continue }
      if (!scene) continue
      if ((scene as { worldData?: { __private?: boolean } })?.worldData?.__private) continue
      const blank = !(scene.fields?.length) && !(scene.stepHooks?.length) && !(scene.visualTypes?.length)
      if (blank) continue
      sceneWorlds.push({ slug: 'scene:' + liveName, snap: scene as never })
    }
  } catch { /* scenes are best-effort; spaces still sweep */ }

  const all = [...worlds, ...sceneWorlds]

  // ?max=N caps how many worlds this run photographs — lets a first backfill go
  // in gentle batches instead of one long run that could strain the eye.
  const maxParam = Number(new URL(req.url).searchParams.get('max'))
  const maxBakes = Number.isFinite(maxParam) && maxParam > 0 ? maxParam : undefined
  const summary = await bakeAllUnhealthy(all, { maxBakes })
  return NextResponse.json({ ok: true, summary })
}

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }
