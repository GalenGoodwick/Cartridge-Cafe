'use client'

// The account page wears the SAME bottom bar as the grid (Galen, Sep 5:
// "account page needs bottom bar. with back button in there. current account
// page is not uniform to ui"). One registry, one look — the ctx just says
// set:'account', so only the universal buttons show: ◂ back · share · the
// identity slot (⚙ ENGINE toggle → the grid) · ✚ create · connect · 👤.

import { useEffect, useState } from 'react'
import BottomBar from '@/app/grid/BottomBar'
import ConnectPanel from '@/app/ConnectPanel'

export default function AccountBar({ signedOut }: { signedOut: boolean }) {
  const [copied, setCopied] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [win, setWin] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1280)
  useEffect(() => {
    const onR = () => setWin(window.innerWidth)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
  const narrow = win < 700
  const tier = (win < 700 ? 0 : win < 1040 ? 1 : 2) as 0 | 1 | 2
  const go = (url: string) => { window.location.href = url }
  return (
    <>
      <BottomBar barH={64}
        ctx={{
          set: 'account', playing: false, narrow, glyphs: win < 1280, tier, canBack: true,
          signedOut, premium: false, rReset: false, aiLive: false, recOn: false,
          recSecs: 0, copied, navOpen: false, commonsOpen: false,
          instructionsOpen: false, brewIconOpen: false, title: '',
        }}
        act={{
          back: () => { if (window.history.length > 1) window.history.back(); else go('/grid') },
          edit: () => go('/grid'),
          title: () => {},
          share: async () => {
            try { await navigator.clipboard.writeText('claude mcp add cartridge-cafe -- npx -y cartridge-cafe-mcp'); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ }
          },
          commons: () => {},
          rec: () => {},
          reset: () => {},
          signIn: () => go('/auth/signin?callbackUrl=' + encodeURIComponent('/account')),
          nav: () => go('/grid?ui=engine'),
          create: () => go('/grid?ui=create'),
          connect: () => setConnectOpen(true),
          instructions: () => {},
          brewIcon: () => {},
          account: () => {},   // already here
        }} />
      {connectOpen && <ConnectPanel onClose={() => setConnectOpen(false)} />}
    </>
  )
}
