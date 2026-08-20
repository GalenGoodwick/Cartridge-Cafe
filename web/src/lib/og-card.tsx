/** THE PRE-BAKED SITE SHARE CARD.
 *
 *  The homepage OG card shows a REAL world (NOCTURNE DISTRICT through the eye)
 *  under the wordmark. Rendering that world takes up to ~14s through the
 *  render-service — which is fine exactly once, and fatal in the scrape path:
 *  on any cache miss (revalidation, fresh deploy, cold edge region) LinkedIn's
 *  and Telegram's short-fetch bots time out and keep whatever stale card they
 *  had. So the card is baked AHEAD of time — rendered, composed, and stored as
 *  finished PNG bytes in slot `og_card:site` (same rails as `world_icon:<slug>`)
 *  — and /opengraph-image serves those bytes in milliseconds, re-baking quietly
 *  in the background when the record ages out. A scraper never waits on the eye.
 *
 *  This module is the whole card: the JSX (card + fallback), the bake, and the
 *  pure staleness verdict (unit-tested offline). opengraph-image.tsx only serves. */

import { ImageResponse } from 'next/og'
import { hydrateAllScenes, loadScene, loadGameSlot, saveGameSlot } from '@/app/api/engine/store'

export const OG_CARD_SLOT = 'og_card:site'
export const OG_SIZE = { width: 1200, height: 630 }
export const OG_ALT = 'cartridge.cafe — worlds, imagined on contact'

/** Re-bake cadence: one background render a day keeps the card honest without
 *  hammering the (small software-GPU) eye. The stale card still serves while
 *  the fresh one bakes — stale-while-revalidate, never a blocking render. */
export const OG_CARD_MAX_AGE_MS = 24 * 60 * 60 * 1000

const FEATURED = 'NOCTURNE DISTRICT'

/** What we persist: the FINISHED 1200×630 card (render + text plate + wordmark
 *  already composed), so serving is a pure byte copy. */
export type OgCardRecord = { at: number; png_b64: string }

export type OgCardState = 'ok' | 'stale' | 'missing'

/** Pure staleness verdict. 'stale' still SERVES (the card is real, just aging) —
 *  it only asks for a background re-bake. Only 'missing' falls back. */
export function ogCardState(record: OgCardRecord | null | undefined, now: number): OgCardState {
  if (!record || typeof record.png_b64 !== 'string' || record.png_b64.length === 0) return 'missing'
  if (!Number.isFinite(record.at) || now - record.at > OG_CARD_MAX_AGE_MS) return 'stale'
  return 'ok'
}

export async function loadOgCard(): Promise<OgCardRecord | null> {
  try {
    const rec = (await loadGameSlot(OG_CARD_SLOT)) as OgCardRecord | undefined
    return rec && typeof rec.png_b64 === 'string' && rec.png_b64.length > 0 ? rec : null
  } catch {
    return null
  }
}

type Snap = { fields?: unknown[]; visualTypes?: unknown[]; modules?: unknown[]; worldData?: Record<string, unknown>; stepHooks?: unknown[] }

/** Photograph the featured world through the eye. Background-only now, so the
 *  timeout is generous — nothing user-facing is waiting on it. */
async function renderFeatured(): Promise<string | null> {
  const base = process.env.RENDER_SERVICE_URL
  const secret = process.env.RENDER_SECRET
  if (!base || !secret) { console.warn('[og-card] render service not configured'); return null }
  try {
    await hydrateAllScenes()
    const snap = loadScene(FEATURED) as Snap | undefined
    if (!snap || !Array.isArray(snap.fields) || snap.fields.length === 0) {
      console.warn(`[og-card] featured scene "${FEATURED}" missing or blank`)
      return null
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    const r = await fetch(base.replace(/\/+$/, '') + '/render', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: snap, size: 512, ticks: 40 }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) { console.warn(`[og-card] eye returned ${r.status}`); return null }
    const out = await r.json()
    if (!out?.ok || !out.image || (typeof out.coveragePct === 'number' && out.coveragePct < 1)) {
      console.warn(`[og-card] eye render unusable (ok=${out?.ok} image=${!!out?.image} coverage=${out?.coveragePct})`)
      return null
    }
    return `data:image/png;base64,${out.image}`
  } catch (e) {
    console.warn('[og-card] featured render failed:', e instanceof Error ? e.message : e)
    return null
  }
}

function Wordmark({ onDark }: { onDark: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 84, fontWeight: 800, letterSpacing: -2, fontFamily: 'sans-serif', textShadow: onDark ? '0 2px 24px rgba(0,0,0,0.8)' : 'none' }}>
        <span style={{ color: '#f4f1ee' }}>cartridge</span>
        <span style={{ color: '#f97316' }}>.cafe</span>
      </div>
      <div style={{ display: 'flex', marginTop: 10, fontSize: 27, letterSpacing: 8, textTransform: 'uppercase', color: '#5ab6e6', fontFamily: 'monospace', textShadow: onDark ? '0 2px 16px rgba(0,0,0,0.85)' : 'none' }}>
        worlds, imagined on contact
      </div>
    </div>
  )
}

function cardJsx(shot: string) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: '#07060a', position: 'relative' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" src={shot} width={1200} height={630} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      {/* gentle overall darken so a blown-out render doesn't glare */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'linear-gradient(to top, rgba(7,6,10,0.5) 0%, rgba(7,6,10,0.12) 55%, rgba(7,6,10,0) 100%)' }} />
      <div style={{ position: 'absolute', top: 28, left: 28, right: 28, bottom: 28, display: 'flex', border: '2px solid rgba(185,122,42,0.4)', borderRadius: 24 }} />
      {/* the TEXT PLATE — a near-solid dark panel so the wordmark reads over
          ANY render (a busy neon city used to swallow it). */}
      <div style={{ position: 'absolute', left: 56, bottom: 54, display: 'flex', flexDirection: 'column', padding: '28px 44px', borderRadius: 18, background: 'rgba(9,7,12,0.9)', border: '1px solid rgba(185,122,42,0.4)' }}>
        <Wordmark onDark />
      </div>
    </div>
  )
}

/** The wordmark-on-night card — served live only while no baked card exists yet
 *  (first boot / slot wiped), so the site card never breaks. */
export function fallbackCardResponse(headers?: Record<string, string>): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0b1020 0%, #0a0812 60%, #05040a 100%)', position: 'relative' }}>
        <div style={{ position: 'absolute', bottom: -160, left: 120, width: 940, height: 500, display: 'flex', background: 'radial-gradient(closest-side, rgba(90,182,230,0.14), rgba(90,182,230,0))' }} />
        <div style={{ position: 'absolute', bottom: -120, right: 140, width: 780, height: 440, display: 'flex', background: 'radial-gradient(closest-side, rgba(249,115,22,0.14), rgba(249,115,22,0))' }} />
        <Wordmark onDark={false} />
      </div>
    ),
    { ...OG_SIZE, headers },
  )
}

// One bake at a time: concurrent after() calls (several scrapes racing a stale
// record) share the in-flight bake instead of stacking renders on the eye.
let inflight: Promise<boolean> | null = null

/** Render the featured world, compose the finished card, store the bytes.
 *  Returns true when a fresh record was saved. A failed render saves NOTHING —
 *  the previous record (or the live fallback) keeps serving and the next
 *  request/sweep retries. */
export function bakeSiteOgCard(): Promise<boolean> {
  if (inflight) return inflight
  inflight = (async () => {
    const shot = await renderFeatured()
    if (!shot) return false
    const composed = new ImageResponse(cardJsx(shot), { ...OG_SIZE })
    const bytes = Buffer.from(await composed.arrayBuffer())
    if (bytes.length === 0) return false
    const record: OgCardRecord = { at: Date.now(), png_b64: bytes.toString('base64') }
    await saveGameSlot(OG_CARD_SLOT, record)
    return true
  })().finally(() => { inflight = null })
  return inflight
}
