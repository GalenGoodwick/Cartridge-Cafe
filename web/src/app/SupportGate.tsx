'use client'

import { useEffect, useState } from 'react'

/** cartridge.cafe runs a WebGPU compute stack on a desktop-sized canvas.
 *  Small/touch screens and browsers without WebGPU can't render it, so we
 *  say so plainly instead of showing a broken black square. */
type Verdict = 'ok' | 'mobile' | 'nogpu' | 'blocked' | null

export default function SupportGate({ children }: { children: React.ReactNode }) {
  const [verdict, setVerdict] = useState<Verdict>(null)
  const [why, setWhy] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let reported = false
    const report = (verdict: string, reason: string) => {
      // a dark window nobody tells us about stays dark forever — every gate
      // rejection lands in the quarantine feed with the why, so "a user says
      // it's dark" comes with data instead of hearsay
      if (reported) return
      reported = true
      try {
        void fetch('/api/engine/quarantine', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
          body: JSON.stringify({ phase: 'support-gate', url: window.location?.href, hazards: [{ name: verdict, reason: reason + ' · ' + (navigator.userAgent || '').slice(0, 140) }] }),
        }).catch(() => {})
      } catch { /* telemetry never blocks the gate */ }
    }
    const decide = async () => {
      // pure-DOM rooms need no GPU — the keeper's panel must open on any machine
      try { if (window.location.pathname.startsWith('/admin')) { setVerdict('ok'); return } } catch { /* ssr */ }
      // the escape hatch was used before and the engine worked → trust the
      // machine over the probe from then on
      try { if (sessionStorage.getItem('cc-gate-override') === '1') { setVerdict('ok'); return } } catch { /* private mode */ }
      // DESKTOP-ONLY: the cafe is a full-resolution WebGPU compute stack — the
      // live hub sim plus every world's icon shader. That is a desktop-GPU
      // workload; phones that entered it FROZE hard. Until a real mobile
      // optimization pass exists (resolution downscale, shader culling, atlas
      // limits), we wall off small/touch screens by size, gracefully. A curious
      // visitor on a big touchscreen laptop can still STEP IN ANYWAY.
      const smallOrTouch =
        window.innerWidth < 820 ||
        (('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth < 1100)
      if (smallOrTouch) { setVerdict('mobile'); return }

      const gpu = (navigator as unknown as { gpu?: { requestAdapter(opts?: unknown): Promise<unknown> } }).gpu
      if (!gpu) { setVerdict('nogpu'); setWhy('navigator.gpu missing — this browser build has no WebGPU API'); report('nogpu', 'navigator.gpu missing — browser has no WebGPU API'); return }
      try {
        const adapter = await gpu.requestAdapter()
        if (adapter) { setVerdict('ok'); return }
        // WebGPU exists but the GPU is unreachable — the "I AM on Chrome" case.
        // A software fallback adapter distinguishes "driver/acceleration blocked"
        // from "no adapter of any kind".
        const fallback = await gpu.requestAdapter({ forceFallbackAdapter: true }).catch(() => null)
        // WebGL2 is the tell: alive while WebGPU is dead = WebGPU specifically
        // is switched off (enterprise policy / flag — common on managed
        // machines); both dead = acceleration is off entirely. Pins the cause
        // without asking the visitor anything.
        let gl2 = 'dead'
        try { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); if (g) { const dbg = g.getExtension('WEBGL_debug_renderer_info'); gl2 = 'alive · ' + String(dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)).slice(0, 60) } } catch { /* dead */ }
        const why2 = fallback
          ? 'hardware adapter: none · software fallback: present — acceleration off or GPU blocklisted'
          : gl2 === 'dead'
            ? 'no adapter + WebGL2 dead — graphics acceleration is OFF entirely: chrome://settings/system → use graphics acceleration → Relaunch'
            : 'no WebGPU adapter but WebGL2 is ' + gl2 + ' — WebGPU itself is switched off: chrome://flags/#enable-unsafe-webgpu, or an admin policy on a managed machine'
        setVerdict('blocked'); setWhy(why2)
        report('blocked', why2)
      } catch (e) { const w2 = 'requestAdapter threw: ' + String(e).slice(0, 80); setVerdict('blocked'); setWhy(w2); report('blocked', w2) }
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
  const blocked = verdict === 'blocked'
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
        <div style={{ fontSize: 48, marginBottom: 14 }}>{mobile ? '🖥️' : '🌑'}</div>
        <div style={{
          fontFamily: 'var(--font-display, serif)', fontStyle: 'italic',
          fontSize: 36, color: '#ffdba8', marginBottom: 12,
        }}>
          {mobile ? 'the cafe needs a bigger table' : 'the windows are dark'}
        </div>
        <p style={{ fontSize: 16, lineHeight: 1.7, color: '#c9b896', margin: 0 }}>
          {mobile ? (
            <>cartridge.cafe renders living worlds on your machine&rsquo;s GPU — a desktop-sized
              job that phones can&rsquo;t carry yet. Come find us on a laptop or desktop, and the
              doors are open.</>
          ) : blocked ? (
            <>your browser speaks WebGPU, but it can&rsquo;t reach your graphics card.
              Usually one of these relights it:<br /><br />
              <b style={{ color: '#ffdba8' }}>1.</b> chrome://settings/system →
              turn ON <b style={{ color: '#ffdba8' }}>&ldquo;Use graphics acceleration&rdquo;</b> → Relaunch<br />
              <b style={{ color: '#ffdba8' }}>2.</b> update your graphics driver
              (NVIDIA / AMD / Intel), then restart<br />
              <b style={{ color: '#ffdba8' }}>3.</b> check <b style={{ color: '#ffdba8' }}>chrome://gpu</b> —
              &ldquo;WebGPU&rdquo; should say <i>Hardware accelerated</i></>
          ) : (
            <>cartridge.cafe brews its worlds with WebGPU, and this browser can&rsquo;t
              reach it. Try the latest <b style={{ color: '#ffdba8' }}>Chrome</b> or{' '}
              <b style={{ color: '#ffdba8' }}>Edge</b>, or <b style={{ color: '#ffdba8' }}>Safari 26+</b> —
              then the lights come on.</>
          )}
        </p>
        {mobile && (
          <button
            onClick={() => { try { void navigator.clipboard?.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ } }}
            style={{
              marginTop: 20, padding: '9px 18px', borderRadius: 10, cursor: 'pointer',
              border: '1px solid rgba(185,122,42,0.5)', background: 'rgba(185,122,42,0.14)',
              color: '#ffdba8', fontFamily: 'inherit', fontSize: 13, letterSpacing: '0.12em',
            }}>
            {copied ? 'LINK COPIED ✓' : '⧉ COPY LINK — OPEN ON YOUR COMPUTER'}
          </button>
        )}
        {!mobile && (
          <>
            <div style={{ marginTop: 16, fontSize: 12, color: 'rgba(201,184,150,0.45)', lineHeight: 1.6 }}>
              {why || 'webgpu probe failed'}
            </div>
            {/* the probe can be wrong — let the machine overrule it. If the
                world renders after stepping in, the gate mis-detected. */}
            <button
              onClick={() => { try { sessionStorage.setItem('cc-gate-override', '1') } catch { /* private mode */ } window.location.reload() }}
              style={{
                marginTop: 18, padding: '8px 18px', borderRadius: 10, cursor: 'pointer',
                border: '1px solid rgba(185,122,42,0.5)', background: 'rgba(185,122,42,0.12)',
                color: '#ffdba8', fontFamily: 'inherit', fontSize: 13, letterSpacing: '0.15em',
              }}>
              STEP IN ANYWAY
            </button>
          </>
        )}
        <div style={{
          marginTop: 22, fontSize: 12, letterSpacing: '0.25em', textTransform: 'uppercase',
          color: 'rgba(245,176,76,0.4)',
        }}>
          cartridge.cafe · open all night
        </div>
      </div>
    </div>
  )
}
