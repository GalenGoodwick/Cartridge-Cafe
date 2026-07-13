'use client'

import { useEffect, useState } from 'react'

/** cartridge.cafe runs a WebGPU compute stack on a desktop-sized canvas.
 *  Small/touch screens and browsers without WebGPU can't render it, so we
 *  say so plainly instead of showing a broken black square. */
type Verdict = 'ok' | 'mobile' | 'nogpu' | null

export default function SupportGate({ children }: { children: React.ReactNode }) {
  const [verdict, setVerdict] = useState<Verdict>(null)

  useEffect(() => {
    const decide = async () => {
      const smallOrTouch =
        window.innerWidth < 820 ||
        (('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth < 1100)
      if (smallOrTouch) { setVerdict('mobile'); return }

      const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
      if (!gpu) { setVerdict('nogpu'); return }
      try {
        const adapter = await gpu.requestAdapter()
        setVerdict(adapter ? 'ok' : 'nogpu')
      } catch { setVerdict('nogpu') }
    }
    decide()
    // a phone held sideways, or a desktop window dragged tiny, re-checks
    const onResize = () => { if (window.innerWidth >= 820) decide() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // first paint: don't flash the world before we know — a quiet hearth
  if (verdict === null) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0b0908' }} aria-hidden />
    )
  }

  if (verdict === 'ok') return <>{children}</>

  const mobile = verdict === 'mobile'
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'radial-gradient(120% 90% at 50% 40%, #17100b 0%, #0b0908 70%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      color: '#e7dcc8', fontFamily: 'var(--font-mono, monospace)',
    }}>
      <div style={{
        maxWidth: 440, textAlign: 'center',
        border: '1px solid rgba(185,122,42,0.35)', borderRadius: 16,
        background: 'rgba(11,9,8,0.85)', padding: '38px 30px',
        boxShadow: '0 0 80px rgba(245,176,76,0.12)',
      }}>
        <div style={{ fontSize: 40, marginBottom: 14 }}>{mobile ? '🖥️' : '🌑'}</div>
        <div style={{
          fontFamily: 'var(--font-display, serif)', fontStyle: 'italic',
          fontSize: 30, color: '#ffdba8', marginBottom: 12,
        }}>
          {mobile ? 'the cafe needs a bigger table' : 'the windows are dark'}
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.7, color: '#c9b896', margin: 0 }}>
          {mobile ? (
            <>cartridge.cafe renders living worlds on your machine&rsquo;s GPU — it wants a
              real keyboard and a desktop-sized screen. Come find us on a laptop or
              desktop, and the doors are open.</>
          ) : (
            <>cartridge.cafe brews its worlds with WebGPU, and this browser can&rsquo;t
              reach it. Try the latest <b style={{ color: '#ffdba8' }}>Chrome</b> or{' '}
              <b style={{ color: '#ffdba8' }}>Edge</b>, or <b style={{ color: '#ffdba8' }}>Safari 26+</b> —
              then the lights come on.</>
          )}
        </p>
        <div style={{
          marginTop: 22, fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase',
          color: 'rgba(245,176,76,0.4)',
        }}>
          cartridge.cafe · open all night
        </div>
      </div>
    </div>
  )
}
