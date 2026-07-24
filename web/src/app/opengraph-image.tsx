import { ImageResponse } from 'next/og'
import { hydrateAllScenes, loadScene } from './api/engine/store'

// The SITE share card (cartridge.cafe). Galen: the old static logo PNG was "super
// generic" — so the homepage card now shows a REAL world (the render-service
// renders a featured scene to a frame) under the wordmark + tagline. The featured
// world is NOCTURNE DISTRICT (Galen's pick). Falls back to the wordmark-on-night
// card if the render is unavailable, so the site card never breaks.
export const runtime = 'nodejs'
export const alt = 'cartridge.cafe — worlds, imagined on contact'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const FEATURED = 'NOCTURNE DISTRICT'

type Snap = { fields?: unknown[]; visualTypes?: unknown[]; modules?: unknown[]; worldData?: Record<string, unknown>; stepHooks?: unknown[] }

async function renderFeatured(): Promise<string | null> {
  const base = process.env.RENDER_SERVICE_URL
  const secret = process.env.RENDER_SECRET
  if (!base || !secret) return null
  try {
    await hydrateAllScenes()
    const snap = loadScene(FEATURED) as Snap | undefined
    if (!snap || !Array.isArray(snap.fields) || snap.fields.length === 0) return null
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 14_000)
    const r = await fetch(base.replace(/\/+$/, '') + '/render', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: snap, size: 512, ticks: 40 }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) return null
    const out = await r.json()
    if (!out?.ok || !out.image || (typeof out.coveragePct === 'number' && out.coveragePct < 1)) return null
    return `data:image/png;base64,${out.image}`
  } catch {
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

export default async function Image() {
  const shot = await renderFeatured()

  if (shot) {
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', background: '#07060a', position: 'relative' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} width={1200} height={630} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          {/* gentle overall darken so a blown-out render doesn't glare */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'linear-gradient(to top, rgba(7,6,10,0.5) 0%, rgba(7,6,10,0.12) 55%, rgba(7,6,10,0) 100%)' }} />
          <div style={{ position: 'absolute', top: 28, left: 28, right: 28, bottom: 28, display: 'flex', border: '2px solid rgba(185,122,42,0.4)', borderRadius: 24 }} />
          {/* the TEXT PLATE — a near-solid dark panel so the wordmark reads over
              ANY render (a busy neon city used to swallow it). */}
          <div style={{ position: 'absolute', left: 56, bottom: 54, display: 'flex', flexDirection: 'column', padding: '28px 44px', borderRadius: 18, background: 'rgba(9,7,12,0.9)', border: '1px solid rgba(185,122,42,0.4)' }}>
            <Wordmark onDark />
          </div>
        </div>
      ),
      { ...size },
    )
  }

  // FALLBACK — wordmark on the night gradient (render unavailable)
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0b1020 0%, #0a0812 60%, #05040a 100%)', position: 'relative' }}>
        <div style={{ position: 'absolute', bottom: -160, left: 120, width: 940, height: 500, display: 'flex', background: 'radial-gradient(closest-side, rgba(90,182,230,0.14), rgba(90,182,230,0))' }} />
        <div style={{ position: 'absolute', bottom: -120, right: 140, width: 780, height: 440, display: 'flex', background: 'radial-gradient(closest-side, rgba(249,115,22,0.14), rgba(249,115,22,0))' }} />
        <Wordmark onDark={false} />
      </div>
    ),
    { ...size },
  )
}
