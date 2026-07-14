import { NextResponse } from 'next/server'
import { loadScene, listScenes } from '../store'
import { composeIcon, dominantHue, IconField } from '@/lib/icon-compose'

export const dynamic = 'force-dynamic'

// house worlds that keep their hand-coded door mini — no screenshot icon
const STYLED = new Set(['FABRIC', 'ORRERY', 'GARNET', 'ONE DAY', 'SAIL', 'SOLSTICE', 'TIDERUNNER', 'SIGNAL'])

/** GET /api/engine/scene-icons — the same icon shaders the player-world shelf
 *  gets, but for HOUSE scenes: each scene's dominant visual composed with its
 *  fields, so PROOF/HANABI/etc. show their real look instead of a default
 *  emblem. Styled scenes (with a curated mini) and branches are skipped. */
export async function GET() {
  const out: { name: string; hue: number | null; iconWgsl: string }[] = []
  for (const name of listScenes()) {
    const up = name.toUpperCase()
    if (name === 'CAFE' || name === 'SUB-MAIN' || name.includes(' ⑂ ') || STYLED.has(up)) continue
    type S = { fields?: IconField[]; visualTypes?: Array<{ name?: string; wgsl?: string }>; worldData?: { icon_wgsl?: unknown } }
    let scene: S | null = null
    try { scene = (loadScene(name) as unknown as S) || null } catch { continue }
    if (!scene) continue
    const iconWgsl = composeIcon(scene.fields || [], scene.visualTypes || [], scene.worldData?.icon_wgsl)
    if (!iconWgsl) continue
    out.push({ name: up, hue: dominantHue(scene.fields || []), iconWgsl })
  }
  return NextResponse.json({ icons: out })
}
