import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { listScenes, loadScene, saveScene, hydrateAllScenes } from '../../engine/store'

/** GET /api/admin/worlds — every world with its visibility.
 *  POST { name, private } — publish to main / make private. Admin only. */
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  await hydrateAllScenes()
  const worlds = listScenes().map(name => {
    const s = loadScene(name) as { timestamp?: number; worldData?: { __private?: boolean; built_by?: string } } | undefined
    return { name, private: !!s?.worldData?.__private, timestamp: s?.timestamp ?? 0, builtBy: s?.worldData?.built_by ?? '' }
  }).sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ worlds })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const body = await req.json().catch(() => null) as { name?: string; base?: string; private?: boolean } | null
  if ((!body?.name && !body?.base) || typeof body?.private !== 'boolean') return NextResponse.json({ error: 'name-or-base and private required' }, { status: 400 })
  await hydrateAllScenes()
  // a branch's toggle covers EVERY version of it (names end ' · vN')
  const strip = (n: string) => n.replace(/ · v\d+$/, '')
  const targets = body.name ? [body.name] : listScenes().filter(n => strip(n) === body.base || n === body.base)
  let done = 0
  for (const nm of targets) {
    const sc = loadScene(nm) as { worldData?: Record<string, unknown>; timestamp?: number } | undefined
    if (!sc) continue
    sc.worldData = { ...(sc.worldData || {}), __private: body.private }
    sc.timestamp = Date.now()
    saveScene(nm, sc as never)
    done++
  }
  if (!done) return NextResponse.json({ error: 'no such world' }, { status: 404 })
  return NextResponse.json({ ok: true, changed: done, private: body.private })
}
