import { NextResponse } from 'next/server'
import { loadScene, listScenes, hydrateAllScenes, loadGameSlot } from '../store'
import { composeIcon, dominantHue, IconField } from '@/lib/icon-compose'
import { iconSnapshotHash, iconHealth, needsBake, iconSlotKey, type IconRecord } from '@/lib/icon-bake'
import { enqueueBake } from '@/lib/icon-bake-queue'

export const dynamic = 'force-dynamic'

// house SCENES bake through the SAME eye pipeline as player spaces — keyed under
// scene:<NAME> so it never collides with a space slug. This is what makes the
// icon system truly unified: a scene whose look won't compile as a standalone
// shader (veilfire, feedback worlds) gets a photographed frame just like a space.
const sceneSlug = (name: string) => 'scene:' + name

// house worlds that keep their hand-coded door mini — no screenshot icon
const STYLED = new Set(['FABRIC', 'ORRERY', 'GARNET', 'ONE DAY', 'SAIL', 'SOLSTICE', 'TIDERUNNER', 'SIGNAL'])

/** GET /api/engine/scene-icons — the same icon shaders the player-world shelf
 *  gets, but for HOUSE scenes: each scene's dominant visual composed with its
 *  fields, so PROOF/HANABI/etc. show their real look instead of a default
 *  emblem. Styled scenes (with a curated mini) and branches are skipped. */
export async function GET() {
  await hydrateAllScenes()
  const out: { name: string; hue: number | null; iconWgsl: string; png?: string; hash?: string }[] = []
  for (const name of listScenes()) {
    if ((loadScene(name) as { worldData?: { __private?: boolean } } | undefined)?.worldData?.__private) { continue }   // unlisted
    const up = name.toUpperCase()
    if (name === 'CAFE' || name === 'SUB-MAIN' || name.includes(' ⑂ ') || STYLED.has(up)) continue
    // Main always serves the original (the swap-main throne was retired with the
    // tournament), so the icon is composed from the base scene itself.
    const liveName = name
    type S = { fields?: IconField[]; visualTypes?: Array<{ name?: string; wgsl?: string }>; modules?: Array<{ name?: string; wgsl?: string }>; worldData?: { icon_wgsl?: unknown } }
    let scene: S | null = null
    try { scene = (loadScene(liveName) as unknown as S) || null } catch { continue }
    if (!scene) continue
    const iconWgsl = composeIcon(scene.fields || [], scene.visualTypes || [], scene.worldData?.icon_wgsl, scene.modules || [])
    // BAKED PHOTO (unified pipeline) — the canonical icon. Keyed on the live scene's
    // look-hash; served when fresh, else lazily (re)baked in the background.
    const hash = iconSnapshotHash(scene as never)
    const rec = (await loadGameSlot(iconSlotKey(sceneSlug(liveName))).catch(() => undefined)) as IconRecord | undefined
    const health = iconHealth(rec, hash)
    if (health === 'ok' && rec?.png_b64) {
      out.push({ name: up, hue: dominantHue(scene.fields || []), iconWgsl: iconWgsl || '', png: rec.png_b64, hash })
      continue
    }
    // lazy bake OFF by default (see spaces/icons) — traffic must not stampede the
    // eye. Controlled baking only: the heal sweep. Flip ICON_LAZY_BAKE=1 to re-enable.
    if (process.env.ICON_LAZY_BAKE === '1' && needsBake(health)) enqueueBake(sceneSlug(liveName), scene as never)
    // no baked photo yet: fall back to the composed shader placeholder if it has
    // one; a scene that composes to NOTHING waits (emblem) until its bake lands.
    if (iconWgsl) out.push({ name: up, hue: dominantHue(scene.fields || []), iconWgsl })
  }
  // edge-cacheable: no session, house scenes change rarely — first visitor pays
  // the compose, everyone else gets the icons instantly for 30s (SWR for 2min)
  return NextResponse.json({ icons: out }, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
  })
}
