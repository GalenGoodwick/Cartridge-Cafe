import { ImageResponse } from 'next/og'

// Site-wide default OG card, in NOCTURNE's key — a neon night, a glowing horizon,
// faint rain. Pure gradients + glow (no shader), so it renders on the edge.
// (Phase 2: swap the backdrop for a captured NOCTURNE still.)
export const runtime = 'edge'
export const alt = 'cartridge.cafe — little worlds, served as single files'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#07060a', position: 'relative', fontFamily: 'serif' }}>
        {/* neon horizon glows */}
        <div style={{ position: 'absolute', bottom: -180, left: 100, width: 1000, height: 520, display: 'flex', background: 'radial-gradient(closest-side, rgba(90,200,255,0.20), rgba(90,200,255,0))' }} />
        <div style={{ position: 'absolute', bottom: -140, right: 120, width: 820, height: 460, display: 'flex', background: 'radial-gradient(closest-side, rgba(220,110,235,0.18), rgba(220,110,235,0))' }} />
        {/* faint rain */}
        {[140, 320, 520, 700, 900, 1060].map((x, i) => (
          <div key={i} style={{ position: 'absolute', top: 60, left: x, width: 2, height: 210, display: 'flex', transform: 'rotate(9deg)', background: 'linear-gradient(rgba(200,225,255,0.14), rgba(200,225,255,0))' }} />
        ))}
        {/* the neon horizon line */}
        <div style={{ position: 'absolute', bottom: 196, left: 60, right: 60, height: 3, display: 'flex', background: 'linear-gradient(90deg, rgba(90,200,255,0), rgba(90,200,255,0.9), rgba(220,110,235,0.9), rgba(220,110,235,0))', boxShadow: '0 0 22px rgba(120,200,255,0.55)' }} />
        {/* brass frame */}
        <div style={{ position: 'absolute', top: 30, left: 30, right: 30, bottom: 30, display: 'flex', border: '2px solid rgba(185,122,42,0.5)', borderRadius: 26 }} />

        <div style={{ display: 'flex', fontSize: 96, fontWeight: 700, color: '#ffdba8', letterSpacing: -2, textShadow: '0 0 30px rgba(245,176,76,0.45)' }}>cartridge.cafe</div>
        <div style={{ display: 'flex', marginTop: 20, fontSize: 36, color: '#c9b896', fontStyle: 'italic' }}>little worlds, served as single files</div>

        <div style={{ display: 'flex', marginTop: 44, gap: 18 }}>
          {['#5ac8ff', '#ffdba8', '#dc6eeb', '#8bd0c7', '#f5b04c', '#e08b5a'].map((c, i) => (
            <div key={i} style={{ display: 'flex', width: 28, height: 28, borderRadius: 999, background: c, boxShadow: `0 0 20px ${c}` }} />
          ))}
        </div>
      </div>
    ),
    { ...size },
  )
}
