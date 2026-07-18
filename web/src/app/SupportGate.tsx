'use client'

import { useEffect, useState } from 'react'

/** cartridge.cafe runs a WebGPU compute stack on a desktop-sized canvas.
 *  Small/touch screens and browsers without WebGPU can't render it, so we
 *  say so plainly instead of showing a broken black square. */
type Verdict = 'ok' | 'mobile' | 'nogpu' | 'blocked' | null

export default function SupportGate({ children }: { children: React.ReactNode }) {
  const [verdict, setVerdict] = useState<Verdict>(null)
  const [why, setWhy] = useState('')

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
      // the escape hatch was used before and the engine worked → trust the
      // machine over the probe from then on
      try { if (sessionStorage.getItem('cc-gate-override') === '1') { setVerdict('ok'); return } } catch { /* private mode */ }
      // MOBILE-FIRST: we no longer wall off touch/small screens by size. Modern
      // phones (iOS 18+ Safari, recent Android Chrome) run the WebGPU stack, and
      // the app renders a phone layout for them. The ONLY gate is capability —
      // does this browser actually have a reachable GPU? Probe everyone the same.
      const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const gpu = (navigator as unknown as { gpu?: { requestAdapter(opts?: unknown): Promise<unknown> } }).gpu
      if (!gpu) {
        // no WebGPU API at all. On a phone that almost always means an older
        // mobile browser — steer them to an update, not to "get a laptop".
        if (touch) { setWhy('navigator.gpu missing — mobile browser has no WebGPU'); report('mobile-nogpu', 'navigator.gpu missing on touch device'); setVerdict('mobile'); return }
        setWhy('navigator.gpu missing — this browser build has no WebGPU API'); report('nogpu', 'navigator.gpu missing — browser has no WebGPU API'); setVerdict('nogpu'); return
      }
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
        // on touch a blocked adapter is still best explained as "newer browser"
        if (touch) { setWhy(why2); report('mobile-blocked', why2); setVerdict('mobile'); return }
        setVerdict('blocked'); setWhy(why2)
        report('blocked', why2)
      } catch (e) {
        const w2 = 'requestAdapter threw: ' + String(e).slice(0, 80)
        setWhy(w2); report(touch ? 'mobile-blocked' : 'blocked', w2)
        setVerdict(touch ? 'mobile' : 'blocked')
      }
    }
    decide()
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
        <div style={{ fontSize: 40, marginBottom: 14 }}>{mobile ? '📱' : '🌑'}</div>
        <div style={{
          fontFamily: 'var(--font-display, serif)', fontStyle: 'italic',
          fontSize: 30, color: '#ffdba8', marginBottom: 12,
        }}>
          {mobile ? 'your browser is one version short' : 'the windows are dark'}
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.7, color: '#c9b896', margin: 0 }}>
          {mobile ? (
            <>cartridge.cafe brews its worlds with WebGPU, and this phone browser can&rsquo;t
              reach it yet. Update to <b style={{ color: '#ffdba8' }}>iOS 18+ Safari</b> or the{' '}
              <b style={{ color: '#ffdba8' }}>latest Chrome</b>, and the doors open right here on
              your phone — no laptop needed.</>
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
        {/* the probe can be wrong on any device — let the machine overrule it.
            If the world renders after stepping in, the gate mis-detected. */}
        <div style={{ marginTop: 16, fontSize: 10, color: 'rgba(201,184,150,0.45)', lineHeight: 1.6 }}>
          {why || 'webgpu probe failed'}
        </div>
        <button
          onClick={() => { try { sessionStorage.setItem('cc-gate-override', '1') } catch { /* private mode */ } window.location.reload() }}
          style={{
            marginTop: 18, padding: '8px 18px', borderRadius: 10, cursor: 'pointer',
            border: '1px solid rgba(185,122,42,0.5)', background: 'rgba(185,122,42,0.12)',
            color: '#ffdba8', fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.15em',
          }}>
          STEP IN ANYWAY
        </button>
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
