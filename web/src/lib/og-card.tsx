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

// ═══════════════════════ PER-WORLD CARDS (og_card:space:<slug>) ═══════════════════════
// Same cure, generalized (Galen: "a link shows nothing" — the per-world card took
// 14s at scrape time and still fell back). Differences from the site card:
//  · staleness is the world's LOOK-SIGNATURE (iconSnapshotHash), not a clock —
//    a card re-bakes only when the world actually changed
//  · a render that fails on THIS content is recorded (failed:true) so an
//    eye-hostile world (veilfire-class) serves its template instantly forever
//    instead of re-hammering the eye on every scrape
//  · private worlds get a NAMELESS generic card — the image route is public, and
//    it must not leak a private world's pixels or name to a guessed URL

import { iconSnapshotHash } from '@/lib/icon-bake'

export type SpaceOgRecord = { at: number; hash: string; png_b64?: string; failed?: boolean }
export type SpaceOgState = 'ok' | 'stale' | 'missing' | 'failed'

export function spaceOgSlotKey(slug: string): string {
  return 'og_card:space:' + slug
}

/** Pure verdict against the world's CURRENT look-hash.
 *   ok      → serve the baked card
 *   stale   → serve it anyway, re-bake in the background (look changed)
 *   failed  → the eye already failed on THIS content: serve the template, do
 *             NOT re-bake until the world changes
 *   missing → no record: serve the template now, bake in the background */
export function spaceOgState(record: SpaceOgRecord | null | undefined, currentHash: string): SpaceOgState {
  if (!record) return 'missing'
  if (record.hash !== currentHash) return 'stale'
  if (record.failed) return 'failed'
  if (!record.png_b64) return 'missing'
  return 'ok'
}

export async function loadSpaceOgCard(slug: string): Promise<SpaceOgRecord | null> {
  try {
    const rec = (await loadGameSlot(spaceOgSlotKey(slug))) as SpaceOgRecord | undefined
    return rec && typeof rec.hash === 'string' ? rec : null
  } catch {
    return null
  }
}

function titlePlate(name: string, owner: string) {
  return (
    <div style={{ position: 'absolute', left: 56, bottom: 54, maxWidth: 900, display: 'flex', flexDirection: 'column', padding: '24px 40px', borderRadius: 18, background: 'rgba(9,7,12,0.9)', border: '1px solid rgba(185,122,42,0.4)', fontFamily: 'serif' }}>
      <div style={{ display: 'flex', fontSize: 22, letterSpacing: 7, textTransform: 'uppercase', color: '#f0b45c' }}>cartridge.cafe</div>
      <div style={{ display: 'flex', marginTop: 8, fontSize: 72, fontWeight: 700, color: '#fff', letterSpacing: -1, lineHeight: 1.02 }}>
        {name.length > 30 ? name.slice(0, 30) + '…' : name}
      </div>
      <div style={{ display: 'flex', marginTop: 6, fontSize: 30, color: '#e8dcc4', fontStyle: 'italic' }}>by {owner.length > 30 ? owner.slice(0, 30) + '…' : owner}</div>
    </div>
  )
}

function spaceCardJsx(shot: string, name: string, owner: string) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: '#07060a', position: 'relative' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" src={shot} width={1200} height={630} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'linear-gradient(to top, rgba(7,6,10,0.5) 0%, rgba(7,6,10,0.12) 55%, rgba(7,6,10,0) 100%)' }} />
      <div style={{ position: 'absolute', top: 26, left: 26, right: 26, bottom: 26, display: 'flex', border: '2px solid rgba(185,122,42,0.45)', borderRadius: 24 }} />
      {titlePlate(name, owner)}
    </div>
  )
}

/** The night TEMPLATE — instant, no eye involved. Serves while a bake runs, and
 *  permanently for eye-hostile or blank worlds. Nameless when private. */
export function spaceTemplateResponse(name: string, owner: string, headers?: Record<string, string>): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#07060a', position: 'relative', fontFamily: 'serif' }}>
        <div style={{ position: 'absolute', bottom: -180, left: 100, width: 1000, height: 520, display: 'flex', background: 'radial-gradient(closest-side, rgba(90,200,255,0.18), rgba(90,200,255,0))' }} />
        <div style={{ position: 'absolute', bottom: -140, right: 120, width: 820, height: 460, display: 'flex', background: 'radial-gradient(closest-side, rgba(220,110,235,0.16), rgba(220,110,235,0))' }} />
        <div style={{ position: 'absolute', bottom: 150, left: 60, right: 60, height: 3, display: 'flex', background: 'linear-gradient(90deg, rgba(90,200,255,0), rgba(90,200,255,0.85), rgba(220,110,235,0.85), rgba(220,110,235,0))', boxShadow: '0 0 20px rgba(120,200,255,0.5)' }} />
        <div style={{ position: 'absolute', top: 30, left: 30, right: 30, bottom: 30, display: 'flex', border: '2px solid rgba(185,122,42,0.5)', borderRadius: 26 }} />
        <div style={{ display: 'flex', fontSize: 24, letterSpacing: 8, textTransform: 'uppercase', color: '#b97a2a' }}>cartridge.cafe</div>
        <div style={{ display: 'flex', marginTop: 24, fontSize: 88, fontWeight: 700, color: '#ffdba8', letterSpacing: -1, maxWidth: 1020, textAlign: 'center', lineHeight: 1.05, textShadow: '0 0 30px rgba(245,176,76,0.4)' }}>
          {name.length > 42 ? name.slice(0, 42) + '…' : name}
        </div>
        <div style={{ display: 'flex', marginTop: 20, fontSize: 34, color: '#c9b896', fontStyle: 'italic' }}>by {owner.length > 30 ? owner.slice(0, 30) + '…' : owner}</div>
      </div>
    ),
    { ...OG_SIZE, headers },
  )
}

async function renderSnap(snap: Snap): Promise<string | 'unusable' | null> {
  const base = process.env.RENDER_SERVICE_URL
  const secret = process.env.RENDER_SECRET
  if (!base || !secret) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    const r = await fetch(base.replace(/\/+$/, '') + '/render', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: snap, size: 512, ticks: 40 }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) return null                    // transient (eye down) — retry next scrape
    const out = await r.json()
    if (!out?.ok) return null
    // the eye RAN and the world drew nothing usable — a settled verdict for this content
    if (!out.image || (typeof out.coveragePct === 'number' && out.coveragePct < 1)) return 'unusable'
    return `data:image/png;base64,${out.image}`
  } catch {
    return null                               // abort/timeout — transient, retry later
  }
}

// one bake per slug at a time; racing scrapes share it
const spaceInflight = new Map<string, Promise<boolean>>()

/** Render + compose + store a world's card. Persists a FAILURE record when the
 *  eye ran and the world drew nothing (so we stop asking until it changes);
 *  persists nothing on transient errors (eye down) so the next scrape retries. */
export function bakeSpaceOgCard(slug: string, snap: Snap, hash: string, name: string, owner: string): Promise<boolean> {
  const running = spaceInflight.get(slug)
  if (running) return running
  const job = (async () => {
    if (!Array.isArray(snap.fields) || snap.fields.length === 0) {
      await saveGameSlot(spaceOgSlotKey(slug), { at: Date.now(), hash, failed: true } satisfies SpaceOgRecord)
      return false
    }
    const shot = await renderSnap(snap)
    if (shot === null) { console.warn(`[og-card] space ${slug}: transient render failure`); return false }
    if (shot === 'unusable') {
      await saveGameSlot(spaceOgSlotKey(slug), { at: Date.now(), hash, failed: true } satisfies SpaceOgRecord)
      console.warn(`[og-card] space ${slug}: world rendered nothing — template recorded`)
      return false
    }
    const composed = new ImageResponse(spaceCardJsx(shot, name, owner), { ...OG_SIZE })
    const bytes = Buffer.from(await composed.arrayBuffer())
    if (bytes.length === 0) return false
    await saveGameSlot(spaceOgSlotKey(slug), { at: Date.now(), hash, png_b64: bytes.toString('base64') } satisfies SpaceOgRecord)
    return true
  })().finally(() => { spaceInflight.delete(slug) })
  spaceInflight.set(slug, job)
  return job
}

export function spaceLookHash(snap: unknown): string {
  return iconSnapshotHash(snap as never)
}

/** BAKE ON PUBLISH: warm a world's card the moment it goes public, so even the
 *  FIRST share previews real pixels. Hash-gated (skips when the stored card
 *  already matches the current look) and fire-and-forget at every call site —
 *  it must never block or fail a publish. */
export async function warmSpaceOgCard(slug: string, snap: unknown, name: string, owner: string): Promise<void> {
  try {
    const s = (snap ?? {}) as Snap
    const hash = spaceLookHash(s)
    const state = spaceOgState(await loadSpaceOgCard(slug), hash)
    if (state === 'ok' || state === 'failed') return   // fresh, or a settled verdict for this content
    await bakeSpaceOgCard(slug, s, hash, name, owner)
  } catch { /* warm-up is a courtesy — the read-time self-heal covers everything */ }
}
