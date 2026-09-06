'use client'

import { useEffect, useState } from 'react'

// The plain-facts notice every visitor meets once: continuing to use the cafe
// means agreeing to the terms & privacy policy. Acknowledgement is remembered
// in the browser (localStorage) so the room only asks the first time. A bumped
// key retires an old acknowledgement whenever the deal materially changes.
const ACK_KEY = 'cafe_terms_ack_v1'

export default function TermsConsent() {
  // start hidden — we only decide to show AFTER mount, so the server-rendered
  // HTML and the first client paint match (no hydration flicker).
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(ACK_KEY) !== '1') setShow(true)
    } catch {
      // a browser with storage walled off (private mode, blocked cookies) still
      // deserves the notice — show it, it just won't be remembered next time.
      setShow(true)
    }
  }, [])

  const accept = () => {
    try { localStorage.setItem(ACK_KEY, '1') } catch { /* storage off — fine */ }
    setShow(false)
  }

  if (!show) return null

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Terms and privacy notice"
      className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-4 pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-2xl arrive rounded-xl border border-brass/30 bg-void/95 backdrop-blur px-5 py-4 shadow-2xl shadow-black/50 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
        <p className="font-mono text-[13px] leading-relaxed text-crema/70 flex-1">
          by using cartridge.cafe you agree to our{' '}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brass hover:text-flame underline underline-offset-2"
          >
            terms
          </a>{' '}
          &amp;{' '}
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brass hover:text-flame underline underline-offset-2"
          >
            privacy policy
          </a>
          .
        </p>
        <button
          onClick={accept}
          className="shrink-0 rounded-lg bg-flame/90 hover:bg-glow text-void font-mono text-[14px] tracking-[0.2em] px-5 py-2.5 transition-colors"
        >
          GOT IT
        </button>
      </div>
    </div>
  )
}
