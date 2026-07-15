import { NextRequest, NextResponse } from 'next/server'
import { loadGameSlot } from '../../store'
import { listScenes } from '../../store'
import { getLineage, setMainHolder } from '../../lineage'

export const dynamic = 'force-dynamic'

/** POST /api/engine/lineage/promote  { base }
 *  Wire the tournament to the throne. This does NOT trust a client-supplied
 *  winner — it READS the world arena's own stored champion (`tournament:world:
 *  <BASE>`) and resolves it to a scene, then swaps mainHolder. So only whatever
 *  actually won the arena can take main; edit access never does.
 *
 *  Resolution mirrors the arena roster:
 *   · champion 'MAIN' (or none)  → the immortal original reclaims the throne
 *   · a branch identity          → its NEWEST version scene */
export async function POST(req: NextRequest) {
  let base: string
  try { base = String((await req.json())?.base ?? '').trim() } catch { base = '' }
  if (!base) return NextResponse.json({ error: 'base required' }, { status: 400 })

  const lin = await getLineage(base)
  if (!lin) return NextResponse.json({ error: 'no lineage for this world (branch it first)' }, { status: 404 })

  const arena = (await loadGameSlot('tournament:world:' + base.toUpperCase())) as { champion?: string | null } | undefined
  const champion = arena?.champion ?? null

  // resolve the roster name to a concrete holder scene
  let holder: string
  if (!champion || champion === 'MAIN') {
    holder = lin.original                                   // the original reclaims main
  } else {
    // newest version of the winning branch identity (e.g. "BASE ⑂ alice · label")
    let best: string | null = null, bestVer = -1
    for (const n of listScenes()) {
      if (!n.startsWith(base + ' ⑂ ')) continue
      const vAt = n.lastIndexOf(' · v')
      const ident = vAt > 0 ? n.slice(0, vAt) : n
      const ver = vAt > 0 ? (parseInt(n.slice(vAt + 4), 10) || 0) : 0
      if (ident === champion && ver >= bestVer) { bestVer = ver; best = n }
    }
    if (!best) return NextResponse.json({ error: `champion "${champion}" has no scene to promote`, champion }, { status: 409 })
    holder = best
  }

  const prevHolder = lin.mainHolder
  const updated = await setMainHolder(base, holder)
  return NextResponse.json({
    ok: true, base: lin.base, champion,
    mainHolder: updated?.mainHolder ?? holder,
    changed: holder !== prevHolder,
    original: lin.original,
  })
}
