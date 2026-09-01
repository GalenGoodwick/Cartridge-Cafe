import { NextRequest, NextResponse } from 'next/server'
import { think, brainDirective } from '@/lib/worldbrain'

export const dynamic = 'force-dynamic'

/** THE IMAGINATION BRAIN, reachable by a connecting AI.
 *  A CHOSEN helper (never a gate): hand it the world's concept and it threads
 *  in excellent authors matched to the themes, then returns the PHYSICS their
 *  words encode (the realism you'd never invent alone), the node plan, the
 *  coherence grammar, and a ready-to-follow build directive. Bypass is always
 *  allowed — this just makes the coherent path the easy one.
 *
 *  GET  /api/brain?concept=a+drowned+crypt+with+a+fallen+star
 *  POST /api/brain   {"concept":"..."}
 */
function respond(concept: string) {
  const c = (concept || '').trim()
  if (!c) {
    return NextResponse.json({
      error: 'give a concept — describe the world as a feeling or a place, not a mechanic list',
      example: '/api/brain?concept=a fallen star unraveling in a flooded crypt, the tide breathing its decay',
    }, { status: 400 })
  }
  const read = think(c)
  return NextResponse.json({ ...read, directive: brainDirective(read),
    note: 'chosen guidance, not a gate — build under the physics + grammar and it reads as one coherent world; bypass is always allowed' })
}

export async function GET(req: NextRequest) {
  return respond(req.nextUrl.searchParams.get('concept') || '')
}

export async function POST(req: NextRequest) {
  let body: { concept?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  return respond(body.concept || '')
}
