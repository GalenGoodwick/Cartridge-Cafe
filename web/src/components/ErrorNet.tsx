'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/hook-error-locus'

/** The catch-all net: any uncaught error or unhandled promise rejection on the
 *  page — engine bugs, React errors, anything not already caught by the sandbox
 *  or the GPU fault path — is gathered to /api/engine/quarantine (phase
 *  'window-error'). Source-documented faults (hooks/shaders/GPU) come through
 *  their own richer paths; this is the floor so nothing thrown goes unseen. */
export function ErrorNet() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const where = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined
      reportError('window-error', {
        name: 'uncaught',
        reason: String(e.message || e.error?.message || 'unknown error'),
        stack: e.error?.stack ? String(e.error.stack).slice(0, 2000) : where,
      })
    }
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | string | undefined
      reportError('window-error', {
        name: 'unhandled-rejection',
        reason: typeof r === 'string' ? r : String(r?.message || 'unhandled promise rejection'),
        stack: typeof r === 'object' && r?.stack ? String(r.stack).slice(0, 2000) : undefined,
      })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])
  return null
}
