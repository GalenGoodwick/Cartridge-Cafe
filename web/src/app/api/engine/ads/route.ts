import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadGameSlot, saveGameSlot } from '../store'

export const dynamic = 'force-dynamic'

// The contained ad model: ads are AI-made, platform-hosted, and NEVER link out.
// They earn impressions + interactions only — everything stays on cartridge.cafe.
// No payouts (v1) → no payout fraud; no links → no external liability.
// lifecycle: a paid ad is `pending` until it's funded, then `active` with an
// expiry (the "$10 for a month" window). The house ad is always eligible.
type AdStatus = 'active' | 'pending'
type Ad = { id: string; title: string; body: string; emoji: string; advertiser: string; impressions: number; interactions: number; house?: boolean; status?: AdStatus; createdAt?: number; expiresAt?: number }
type AdsDoc = { v: 1; ads: Ad[] }
type ProtDoc = { v: 1; users?: Record<string, boolean>; worlds?: Record<string, boolean> }

// house ad fills unsold inventory — a slot is never empty, and it recruits advertisers
const HOUSE: Ad = {
  id: 'house', house: true, status: 'active', emoji: '📣', advertiser: 'cartridge.cafe',
  title: 'Advertise on cartridge.cafe',
  body: 'Your product, built into an interactive AI world and shown to players across the cafe. No links, no tracking — just attention. Make your ad with the same AI that builds the worlds.',
  impressions: 0, interactions: 0,
}

/** create/activate are privileged (you, or the Stripe webhook via admin token). */
function mayManage(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  const auth = req.headers.get('authorization')
  return !!(auth?.startsWith('Bearer ') && process.env.ENGINE_AGENT_TOKEN && auth.slice(7) === process.env.ENGINE_AGENT_TOKEN)
}

async function getAds(): Promise<AdsDoc> {
  const d = (await loadGameSlot('ads:index')) as AdsDoc | undefined
  if (d && d.v === 1 && Array.isArray(d.ads) && d.ads.length) return d
  const seed: AdsDoc = { v: 1, ads: [{ ...HOUSE }] }
  await saveGameSlot('ads:index', seed)
  return seed
}

/** A viewer is ad-free if THEY are protected (paid), or the WORLD is protected. */
async function isProtected(userId: string | null, world: string | null): Promise<boolean> {
  const p = (await loadGameSlot('ads:protected')) as ProtDoc | undefined
  if (!p || p.v !== 1) return false
  if (userId && p.users?.[userId]) return true
  if (world && p.worlds?.[world]) return true
  return false
}

/** GET /api/engine/ads?world=NAME — serve one ad, or none for protected viewers/worlds. */
export async function GET(req: NextRequest) {
  const world = new URL(req.url).searchParams.get('world')
  const session = await getServerSession(authOptions)
  const uid = session?.user?.id ?? null
  if (await isProtected(uid, world)) return NextResponse.json({ ad: null, protected: true })
  const { ads } = await getAds()
  // rotation: only live inventory — house ad + paid ads that are active and not
  // expired — then least-shown-first so impressions spread evenly across them.
  const now = Date.now()
  const live = ads.filter(a => a.house || (a.status === 'active' && (!a.expiresAt || now < a.expiresAt)))
  const pick = live.sort((a, b) => (a.impressions || 0) - (b.impressions || 0))[0] || null
  if (!pick) return NextResponse.json({ ad: null })
  return NextResponse.json({ ad: { id: pick.id, title: pick.title, body: pick.body, emoji: pick.emoji, advertiser: pick.advertiser } })
}

/** POST { adId, event: 'impression'|'interaction' } — server-authoritative counters.
 *  v1 has no per-viewer dedup; the client throttles display, and with no payouts an
 *  inflated count only skews advertiser reporting — hardening (per-session/IP caps)
 *  comes before any creator rev-share. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ── create a pending ad (submit form) ── returns its id; runs only once activated
    if (body.action === 'create') {
      if (!mayManage(req)) return NextResponse.json({ error: 'not allowed' }, { status: 403 })
      const { title, body: text, emoji, advertiser } = body
      if (!title || !text || !advertiser) return NextResponse.json({ error: 'title, body, advertiser required' }, { status: 400 })
      const doc = await getAds()
      const id = 'ad_' + Math.random().toString(36).slice(2, 10)
      doc.ads.push({ id, title: String(title).slice(0, 80), body: String(text).slice(0, 400), emoji: String(emoji || '✦').slice(0, 4), advertiser: String(advertiser).slice(0, 40), status: 'pending', createdAt: Date.now(), impressions: 0, interactions: 0 })
      await saveGameSlot('ads:index', doc)
      return NextResponse.json({ ok: true, id })
    }

    // ── activate a paid ad for N days (Stripe webhook / admin, after payment) ──
    if (body.action === 'activate') {
      if (!mayManage(req)) return NextResponse.json({ error: 'not allowed' }, { status: 403 })
      const doc = await getAds()
      const ad = doc.ads.find(a => a.id === body.adId)
      if (!ad) return NextResponse.json({ error: 'no such ad' }, { status: 404 })
      ad.status = 'active'
      ad.expiresAt = Date.now() + (Number(body.days) || 30) * 86400000
      await saveGameSlot('ads:index', doc)
      return NextResponse.json({ ok: true, expiresAt: ad.expiresAt })
    }

    // ── track an impression / interaction (open, from the interstitial) ──
    const { adId, event } = body
    if (!adId || (event !== 'impression' && event !== 'interaction')) {
      return NextResponse.json({ error: 'adId + event required' }, { status: 400 })
    }
    const doc = await getAds()
    const ad = doc.ads.find(a => a.id === adId)
    if (ad) {
      if (event === 'impression') ad.impressions = (ad.impressions || 0) + 1
      else ad.interactions = (ad.interactions || 0) + 1
      await saveGameSlot('ads:index', doc)
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
}
