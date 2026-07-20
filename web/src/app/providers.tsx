'use client'

import { SessionProvider } from 'next-auth/react'
import { ToastProvider } from '@/components/Toast'
import { AutoClaimDeed } from './AutoClaimDeed'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AutoClaimDeed />
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  )
}
