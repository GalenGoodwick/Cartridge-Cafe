import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { logVisit } from '@/lib/visits'

export const dynamic = 'force-dynamic'

/** GET /api/engine/guide — the agent guide as plain markdown.
 *  Public: it documents the command surface, not secrets. Any AI handed a
 *  world token can fetch this and know how to build. */
export async function GET(req: NextRequest) {
  logVisit({ kind: 'agent', path: '/api/engine/guide', ref: req.headers.get('referer'), ua: req.headers.get('user-agent'), ip: req.headers.get('x-forwarded-for')?.split(',')[0] })
  try {
    const path = join(process.cwd(), 'src/app/engine/AI_ENGINE_GUIDE.md')
    const md = await readFile(path, 'utf-8')
    return new NextResponse(md, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    })
  } catch {
    return NextResponse.json({ error: 'Guide not found' }, { status: 404 })
  }
}
