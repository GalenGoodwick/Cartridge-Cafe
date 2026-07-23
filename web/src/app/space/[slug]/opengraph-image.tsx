import { ImageResponse } from 'next/og'
import { prisma } from '@/lib/prisma'

// Per-world OG card. Phase 2 (Galen: "the OG maker reverts to a generic"): the
// card now shows a REAL render of the world — the render-service renders the
// world's own snapshot to a PNG, and we cover the card with it + a title scrim.
// The generic NOCTURNE template is the FALLBACK when the render is unavailable
// (service down, blank world, timeout) so a link never breaks.
export const runtime = 'nodejs'
export const alt = 'A world on cartridge.cafe'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

type Snap = { fields?: unknown[]; visualTypes?: unknown[]; modules?: unknown[]; worldData?: Record<string, unknown>; stepHooks?: unknown[] }

/** Render the world's own snapshot to a PNG data-URI via the render-service.
 *  Returns null on any failure — the caller falls back to the template. */
async function renderWorld(snap: Snap | null): Promise<string | null> {
  const base = process.env.RENDER_SERVICE_URL
  const secret = process.env.RENDER_SECRET
  if (!base || !secret || !snap || !Array.isArray(snap.fields) || snap.fields.length === 0) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12_000)
    const r = await fetch(base.replace(/\/+$/, '') + '/render', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      // a few ticks so time-based shaders develop past t=0 into a lit frame
      body: JSON.stringify({ state: snap, size: 512, ticks: 40 }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) return null
    const out = await r.json()
    // only use a render that actually drew something (a blank/black frame is
    // worse than the template — coveragePct<1 ≈ nothing rendered)
    if (!out?.ok || !out.image || (typeof out.coveragePct === 'number' && out.coveragePct < 1)) return null
    return `data:image/png;base64,${out.image}`
  } catch {
    return null
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const space = await prisma.playerSpace
    .findUnique({ where: { slug }, select: { name: true, snapshot: true, owner: { select: { name: true } } } })
    .catch(() => null)
  const name = space?.name || 'a world'
  const owner = space?.owner?.name || 'someone'
  const shot = await renderWorld((space?.snapshot as Snap) ?? null)

  if (shot) {
    // the REAL world, full-bleed, with a bottom scrim carrying the title
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', background: '#07060a', position: 'relative' }}>
          {/* the world render — 512² covering the 1200×630 card */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} width={1200} height={630} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          {/* bottom scrim so text stays legible over any frame */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'linear-gradient(to bottom, rgba(7,6,10,0) 40%, rgba(7,6,10,0.15) 62%, rgba(7,6,10,0.85) 100%)' }} />
          <div style={{ position: 'absolute', top: 26, left: 26, right: 26, bottom: 26, display: 'flex', border: '2px solid rgba(185,122,42,0.45)', borderRadius: 24 }} />
          <div style={{ position: 'absolute', left: 60, bottom: 54, right: 60, display: 'flex', flexDirection: 'column', fontFamily: 'serif' }}>
            <div style={{ display: 'flex', fontSize: 22, letterSpacing: 7, textTransform: 'uppercase', color: '#f0b45c' }}>cartridge.cafe</div>
            <div style={{ display: 'flex', marginTop: 8, fontSize: 74, fontWeight: 700, color: '#fff', letterSpacing: -1, lineHeight: 1.02, textShadow: '0 2px 24px rgba(0,0,0,0.7)' }}>
              {name.length > 34 ? name.slice(0, 34) + '…' : name}
            </div>
            <div style={{ display: 'flex', marginTop: 6, fontSize: 30, color: '#e8dcc4', fontStyle: 'italic', textShadow: '0 2px 16px rgba(0,0,0,0.8)' }}>by {owner.length > 30 ? owner.slice(0, 30) + '…' : owner}</div>
          </div>
        </div>
      ),
      { ...size },
    )
  }

  // FALLBACK — the NOCTURNE night template (render unavailable / blank world)
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
    { ...size },
  )
}
