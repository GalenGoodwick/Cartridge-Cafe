'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/** Self-hosted page-view beacon. First load carries document.referrer
 *  (how they found us — moltbook, search, a link); client-side route
 *  changes log the path only. sendBeacon so it never blocks paint. */
export default function Beacon() {
  const pathname = usePathname()
  const first = useRef(true)
  useEffect(() => {
    if (!pathname) return
    const payload = JSON.stringify({ path: pathname, ref: first.current ? document.referrer : '' })
    first.current = false
    try {
      if (!navigator.sendBeacon?.('/api/t', new Blob([payload], { type: 'application/json' }))) {
        fetch('/api/t', { method: 'POST', body: payload, keepalive: true }).catch(() => {})
      }
    } catch { /* never break the page */ }
  }, [pathname])
  return null
}
