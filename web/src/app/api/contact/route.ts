import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// naive per-IP throttle — contact is a public door; a burst is a bot, not a team
const recent = new Map<string, number[]>()
const WINDOW_MS = 10 * 60_000
const MAX_PER_WINDOW = 5

/** POST /api/contact — { email, message, context? } → logged for the keeper's
 *  message page (/admin/messages). The teams door named in the terms. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const now = Date.now()
  const hits = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  if (hits.length >= MAX_PER_WINDOW) return NextResponse.json({ error: 'too many messages — try again later' }, { status: 429 })
  hits.push(now)
  recent.set(ip, hits)

  let body: { email?: string; message?: string; context?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad request' }, { status: 400 }) }

  const email = (body.email || '').trim().slice(0, 320)
  const message = (body.message || '').trim().slice(0, 4000)
  const context = (body.context || '').trim().slice(0, 200) || null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'a real email address is required — it is how we reply' }, { status: 400 })
  if (message.length < 10) return NextResponse.json({ error: 'tell us a little more (10+ characters)' }, { status: 400 })

  await prisma.contactMessage.create({ data: { email, message, context } })
  return NextResponse.json({ ok: true })
}
