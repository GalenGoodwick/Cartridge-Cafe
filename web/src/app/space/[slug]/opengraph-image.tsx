import { ImageResponse } from 'next/og'
import { prisma } from '@/lib/prisma'

// Per-world OG card, on the same NOCTURNE night backdrop as the site card, with
// the world's name + owner. Default until a real icon snapshot exists (phase 2).
export const runtime = 'nodejs'
export const alt = 'A world on cartridge.cafe'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const space = await prisma.playerSpace
    .findUnique({ where: { slug }, select: { name: true, owner: { select: { name: true } } } })
    .catch(() => null)
  const name = space?.name || 'a world'
  const owner = space?.owner?.name || 'someone'

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
