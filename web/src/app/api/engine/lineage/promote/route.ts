import { NextRequest, NextResponse } from 'next/server'
import { loadGameSlot } from '../../store'
import { listScenes, loadScene, saveScene, hydrateAllScenes } from '../../store'
import { getLineage, setMainHolder } from '../../lineage'

export const dynamic = 'force-dynamic'

/** POST /api/engine/lineage/promote  { base }
 *  Wire the tournament to the WINNER'S PODIUM — not the throne. Main always
 *  stays with the original maker; winning never takes it. What an election
 *  does: the winning branch's scene is FROZEN into the reserved `winner`
 *  namespace (`BASE ⑂ winner · vK`) — a podium copy shown BEFORE main and the
 *  branches. The author deleting or continuing their branch can never change
 *  or break what won; a new version has to win again.
 *
 *  This does NOT trust a client-supplied winner — it READS the world arena's
 *  own stored champion (`tournament:world:<BASE>`) and resolves it:
 *   · champion 'MAIN' (or none)  → nothing to stage; main is already the maker's
 *   · a branch identity          → its NEWEST version scene is frozen to the podium */
export async function POST(req: NextRequest) {
  await hydrateAllScenes()
  let base: string
  try { base = String((await req.json())?.base ?? '').trim() } catch { base = '' }
  if (!base) return NextResponse.json({ error: 'base required' }, { status: 400 })

  const lin = await getLineage(base)
  if (!lin) return NextResponse.json({ error: 'no lineage for this world (branch it first)' }, { status: 404 })

  const arena = (await loadGameSlot('tournament:world:' + base.toUpperCase())) as { champion?: string | null } | undefined
  const champion = arena?.champion ?? null

  if (!champion || champion === 'MAIN') {
    return NextResponse.json({ ok: true, base: lin.base, champion, winner: null, staged: false, original: lin.original })
  }

  // newest version of the winning branch identity (e.g. "BASE ⑂ alice · label")
  let best: string | null = null, bestVer = -1
  for (const n of listScenes()) {
    if (!n.startsWith(base + ' ⑂ ')) continue
    const vAt = n.lastIndexOf(' · v')
    const ident = vAt > 0 ? n.slice(0, vAt) : n
    const ver = vAt > 0 ? (parseInt(n.slice(vAt + 4), 10) || 0) : 0
    if (ident === champion && ver >= bestVer) { bestVer = ver; best = n }
  }
  if (!best) return NextResponse.json({ error: `champion "${champion}" has no scene to stage`, champion }, { status: 409 })

  const src = loadScene(best)
  if (!src) return NextResponse.json({ error: `champion scene "${best}" unreadable` }, { status: 409 })
  let preK = 0
  let reuse: string | null = null
  for (const n of listScenes()) {
    const m = n.match(/ ⑂ winner · v(\d+)$/)
    if (!m || !n.startsWith(base + ' ⑂ winner · v')) continue
    preK = Math.max(preK, parseInt(m[1], 10) || 0)
    const sc = loadScene(n) as { worldData?: { __winner_of?: string } } | undefined
    if (sc?.worldData?.__winner_of === best) reuse = n   // this election already staged
  }
  let winner: string
  if (reuse) {
    winner = reuse
  } else {
    const copyName = `${base} ⑂ winner · v${preK + 1}`
    const copy = JSON.parse(JSON.stringify(src)) as { name?: string; timestamp?: number; worldData?: Record<string, unknown> }
    copy.name = copyName
    copy.timestamp = Date.now()
    copy.worldData = { ...(copy.worldData || {}), __winner_of: best, __winner_at: Date.now() }
    saveScene(copyName, copy as never)
    winner = copyName
  }

  // OPT-IN OVERTURN — by default a win is only a podium; main stays with the
  // maker. But a maker may set { winnerTakesMain } (owner-gated, via the
  // main-rule endpoint) to hand the throne to the popular winner: the frozen
  // podium copy becomes the lineage's mainHolder.
  let tookMain = false
  const rule = (await loadGameSlot('main-rule:' + base.toUpperCase())) as { winnerTakesMain?: boolean } | undefined
  if (rule?.winnerTakesMain && winner !== lin.mainHolder) {
    await setMainHolder(base, winner)
    tookMain = true
  }

  return NextResponse.json({ ok: true, base: lin.base, champion, winner, staged: !reuse, original: lin.original, tookMain })
}
