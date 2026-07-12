import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

export const dynamic = 'force-dynamic'

/** GET /api/engine/guide — the agent guide as plain markdown.
 *  Public: it documents the command surface, not secrets. Any AI handed a
 *  world token can fetch this and know how to build. */
export async function GET() {
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
