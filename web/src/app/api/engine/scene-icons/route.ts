import { NextResponse } from 'next/server'
import { loadScene, listScenes, hydrateAllScenes } from '../store'
import { getLineage } from '../lineage'
import { composeIcon, dominantHue, IconField } from '@/lib/icon-compose'

export const dynamic = 'force-dynamic'

// house worlds that keep their hand-coded door mini — no screenshot icon
const STYLED = new Set(['FABRIC', 'ORRERY', 'GARNET', 'ONE DAY', 'SAIL', 'SOLSTICE', 'TIDERUNNER', 'SIGNAL'])

/** GET /api/engine/scene-icons — the same icon shaders the player-world shelf
 *  gets, but for HOUSE scenes: each scene's dominant visual composed with its
 *  fields, so PROOF/HANABI/etc. show their real look instead of a default
 *  emblem. Styled scenes (with a curated mini) and branches are skipped. */
export async function GET() {
  await hydrateAllScenes()
  const out: { name: string; hue: number | null; iconWgsl: string }[] = []
  for (const name of listScenes()) {
    if ((loadScene(name) as { worldData?: { __private?: boolean } } | undefined)?.worldData?.__private) { continue }   // unlisted
    const up = name.toUpperCase()
    if (name === 'CAFE' || name === 'SUB-MAIN' || name.includes(' ⑂ ') || STYLED.has(up)) continue
    // KING-OF-THE-HILL: the door loads whoever holds MAIN — a promoted branch,
    // not the frozen base (CafeShell resolves launch → mainHolder the same way).
    // The icon must be composed from that SAME live scene, else promoting a
    // branch leaves the shelf icon stuck on the old base look (or black, when the
    // new live scene differs). Fall back to the base on any lineage miss.
    let liveName = name
    try {
      const lin = await getLineage(name)
      if (lin?.mainHolder && lin.original && lin.mainHolder !== lin.original
          && !lin.mainHolder.startsWith('space:') && loadScene(lin.mainHolder)) {
        liveName = lin.mainHolder
      }
    } catch { /* offline lineage → the base is a fine fallback */ }
    type S = { fields?: IconField[]; visualTypes?: Array<{ name?: string; wgsl?: string }>; modules?: Array<{ name?: string; wgsl?: string }>; worldData?: { icon_wgsl?: unknown } }
    let scene: S | null = null
    try { scene = (loadScene(liveName) as unknown as S) || null } catch { continue }
    if (!scene) continue
    const iconWgsl = composeIcon(scene.fields || [], scene.visualTypes || [], scene.worldData?.icon_wgsl, scene.modules || [])
    if (!iconWgsl) continue
    out.push({ name: up, hue: dominantHue(scene.fields || []), iconWgsl })
  }
  // edge-cacheable: no session, house scenes change rarely — first visitor pays
  // the compose, everyone else gets the icons instantly for 30s (SWR for 2min)
  return NextResponse.json({ icons: out }, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
  })
}
