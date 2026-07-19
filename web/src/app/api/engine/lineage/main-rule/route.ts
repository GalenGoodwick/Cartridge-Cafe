import { NextRequest, NextResponse } from 'next/server'
import { mayWriteScene } from '../../scene-auth'
import { loadGameSlot, saveGameSlot } from '../../store'

export const dynamic = 'force-dynamic'

const slotOf = (base: string) => 'main-rule:' + base.trim().toUpperCase()

/** GET /api/engine/lineage/main-rule?base=NAME — read a world's overturn rule.
 *  { winnerTakesMain } — false (default): a tournament win is only a podium and
 *  main stays with the maker. true: the popular winner takes the throne. */
export async function GET(req: NextRequest) {
  const base = (req.nextUrl.searchParams.get('base') || '').trim()
  if (!base) return NextResponse.json({ winnerTakesMain: false })
  const rule = (await loadGameSlot(slotOf(base))) as { winnerTakesMain?: boolean } | undefined
  return NextResponse.json({ winnerTakesMain: !!rule?.winnerTakesMain })
}

/** POST /api/engine/lineage/main-rule { base, winnerTakesMain }
 *  OWNER-ONLY — this decides whether challengers can take main, so only whoever
 *  may write the BASE world may flip it (same authority gate as set-main). */
export async function POST(req: NextRequest) {
  let base = ''
  let winnerTakesMain = false
  try {
    const b = await req.json()
    base = String(b?.base ?? '').trim()
    winnerTakesMain = !!b?.winnerTakesMain
  } catch { /* 400 below */ }
  if (!base) return NextResponse.json({ error: 'base required' }, { status: 400 })

  if (!(await mayWriteScene(req, base))) {
    return NextResponse.json({ error: 'Only the world\'s owner can set this' }, { status: 403 })
  }

  await saveGameSlot(slotOf(base), { winnerTakesMain })
  return NextResponse.json({ ok: true, winnerTakesMain })
}
