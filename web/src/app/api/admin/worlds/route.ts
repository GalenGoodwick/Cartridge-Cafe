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
  const body = await req.json().catch(() => null) as { name?: string; private?: boolean } | null
  if (!body?.name || typeof body.private !== 'boolean') return NextResponse.json({ error: 'name and private required' }, { status: 400 })
  await hydrateAllScenes()
  const s = loadScene(body.name) as { worldData?: Record<string, unknown>; timestamp?: number } | undefined
  if (!s) return NextResponse.json({ error: 'no such world' }, { status: 404 })
  s.worldData = { ...(s.worldData || {}), __private: body.private }
  s.timestamp = Date.now()
  saveScene(body.name, s as never)   // memory + disk + Neon mirror
  return NextResponse.json({ ok: true, name: body.name, private: body.private })
}
