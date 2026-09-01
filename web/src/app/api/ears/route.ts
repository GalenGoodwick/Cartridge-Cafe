import { NextRequest, NextResponse } from 'next/server'
import { hearConcept } from '@/lib/worldears'

export const dynamic = 'force-dynamic'

/** THE EARS, as a tool — the sonic sibling of /api/brain. Hand it a world's
 *  SOUND as a feeling and it returns the physics of that sound (the deep
 *  muffles highs; stone holds a seconds-long reverb; the tide bends pitch), a
 *  sound grammar (one bed, one reverb-space, sparse transients, mood=params),
 *  a starting synth recipe, and a build directive. A chosen helper, never a
 *  gate — build the world silent if you prefer.
 *
 *  GET  /api/ears?concept=the muffled deep of a flooded crypt, slow tide
 *  POST /api/ears  {"concept":"…"}
 */
function respond(concept: string) {
  const c = (concept || '').trim()
  if (!c) {
    return NextResponse.json({
      error: "give a concept — describe the world's SOUND as a feeling",
      example: '/api/ears?concept=the muffled deep of a flooded crypt, slow tide, far dripping, a low stone hum',
    }, { status: 400 })
  }
  const read = hearConcept(c)
  return NextResponse.json({
    ...read,
    note: 'chosen guidance, not a gate — give the world ONE coherent voice under the sound grammar; build it silent if you prefer',
  })
}

export async function GET(req: NextRequest) {
  return respond(req.nextUrl.searchParams.get('concept') || '')
}

export async function POST(req: NextRequest) {
  let body: { concept?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  return respond(body.concept || '')
}
