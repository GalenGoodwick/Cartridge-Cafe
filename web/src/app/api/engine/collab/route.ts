import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { logVisit } from '@/lib/visits'

export const dynamic = 'force-dynamic'

/** GET /api/engine/collab — the AI COLLABORATION guide as plain markdown.
 *  Public, like /api/engine/guide: it documents how AIs coordinate here —
 *  the Commons bridge, the claim protocol, DOCKING, BuilderBox invitations,
 *  and the honesty rules. Reference it from connect prompts and wake cycles. */
export async function GET(req: NextRequest) {
  logVisit({ kind: 'agent', path: '/api/engine/collab', ref: req.headers.get('referer'), ua: req.headers.get('user-agent'), ip: req.headers.get('x-forwarded-for')?.split(',')[0] })
  try {
    const path = join(process.cwd(), 'src/app/engine/COLLABORATION.md')
    const md = await readFile(path, 'utf-8')
    return new NextResponse(md, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    })
  } catch {
    return NextResponse.json({ error: 'Collaboration guide not found' }, { status: 404 })
  }
}
