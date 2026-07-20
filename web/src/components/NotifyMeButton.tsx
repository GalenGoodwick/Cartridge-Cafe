'use client'

import { useState, useEffect } from 'react'
import { usePushNotifications } from '@/hooks/usePushNotifications'

/** A one-tap "notify me" toggle wrapping the push hook. Renders nothing where
 *  push is unsupported. `variant='menu'` matches the account-dropdown rows;
 *  default is a standalone pill (build-waiting screen, members' counter). */
export function NotifyMeButton({
  label = '🔔 notify me when it’s ready',
  onLabel = '🔔 you’ll be notified',
  className = '',
  variant = 'pill',
}: { label?: string; onLabel?: string; className?: string; variant?: 'pill' | 'menu' }) {
  const { isSupported, isSubscribed, isLoading, permission, subscribe, unsubscribe } = usePushNotifications()
  const [err, setErr] = useState('')
  // iOS only delivers web-push to a home-screen (standalone) install
  const [needsInstall, setNeedsInstall] = useState(false)
  useEffect(() => {
    const iOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true
    setNeedsInstall(iOS && !standalone)
  }, [])

  if (!isSupported) return null
  // Once the browser permission is DENIED it can never be re-prompted from JS —
  // a toggle here would be a dead button. Show the honest recovery path instead.
  if (permission === 'denied' && !isSubscribed) {
    return (
      <p className={`font-mono text-[13px] text-grounds/70 ${variant === 'menu' ? 'px-3 py-2' : 'text-center'}`}>
        notifications are blocked — turn them on for this site in your browser settings.
      </p>
    )
  }

  const onClick = async () => {
    setErr('')
    if (isSubscribed) { await unsubscribe(); return }
    if (needsInstall) { setErr('on iPhone: Share → Add to Home Screen, then turn this on there'); return }
    const r = await subscribe()
    if (!r.success) setErr(r.error === 'Must be logged in to subscribe' ? 'sign in first to get notified' : (r.error || 'could not enable'))
  }

  if (variant === 'menu') {
    return (
      <button onClick={onClick} disabled={isLoading}
        className="w-full text-left px-3 py-2 rounded-lg tracking-[0.12em] text-steamer/85 hover:text-glow hover:bg-white/5 transition-colors disabled:opacity-50">
        {isLoading ? '…' : isSubscribed ? '🔔 notifications on' : '🔕 notify me of builds'}
        {err && <span className="block text-[13px] text-flame/70 tracking-normal mt-0.5">{err}</span>}
      </button>
    )
  }

  const base = 'pointer-events-auto px-3 py-1.5 rounded-lg font-mono text-[14px] tracking-[0.15em] border transition-colors disabled:opacity-50'
  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <button disabled={isLoading} onClick={onClick}
        className={`${base} ${isSubscribed
          ? 'border-emerald-300/50 bg-emerald-400/15 text-emerald-100'
          : 'border-amber-300/40 bg-amber-400/10 text-amber-100/90 hover:bg-amber-400/20'}`}>
        {isLoading ? '…' : isSubscribed ? onLabel : label}
      </button>
      {err && <span className="font-mono text-[13px] text-red-300/80">{err}</span>}
    </div>
  )
}
