import { NextRequest, NextResponse } from 'next/server'
import { mayWriteScene } from '../../scene-auth'
import { getLineage, setMainHolder } from '../../lineage'
import { hydrateAllScenes, listScenes, loadScene } from '../../store'

export const dynamic = 'force-dynamic'

/** POST /api/engine/lineage/set-main  { base, holder }
 *  The OWNER'S hand on the throne: whoever may write the BASE world may choose
 *  which version/branch main serves — players joining and the vote display see
 *  the holder. The tournament can still crown its own (the podium copy is
 *  separate and frozen); the original stays immortal either way.
 *
 *  Authority is the BASE, not the holder — otherwise any brancher could seize
 *  main by "setting" their own branch. */
export async function POST(req: NextRequest) {
  let base = '', holder = ''
  try {
    const b = await req.json()
    base = String(b?.base ?? '').trim()
    holder = String(b?.holder ?? '').trim()
  } catch { /* fall through to the 400 */ }
  if (!base || !holder) return NextResponse.json({ error: 'base and holder required' }, { status: 400 })

  if (!(await mayWriteScene(req, base))) {
    return NextResponse.json({ error: 'Only the world\'s owner can set main' }, { status: 403 })
  }

  const lin = await getLineage(base)
  if (!lin) return NextResponse.json({ error: 'no lineage for this world (branch it first)' }, { status: 404 })

  // the holder must be real: the original, or an existing scene in THIS lineage
  await hydrateAllScenes()
  const inLineage = holder === lin.original || holder.startsWith(`${base} ⑂ `)
  if (!inLineage || (holder !== lin.original && !loadScene(holder) && !listScenes().includes(holder))) {
    return NextResponse.json({ error: 'holder must be this world\'s original or one of its existing branch versions' }, { status: 400 })
  }

  const updated = await setMainHolder(base, holder)
  return NextResponse.json({ ok: true, lineage: updated })
}
