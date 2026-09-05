'use client'

import { useEffect } from 'react'
import McpBody from '@/app/McpConnectPanel'

/** CONNECT AI — ONLY MCP (Galen, Sep 5: "we go ONLY MCP. need to remove
 *  html."). The paste-a-prompt door is gone; the ONE way in is the MCP
 *  server — one command, then the server itself carries onboarding: account
 *  creation (connect_account), the first-pair gift (30 days + 2 credits),
 *  and the Deno eye ask. This wrapper owns the modal chrome. */
export default function ConnectPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm font-mono" onClick={onClose}>
      <div className="w-80 max-w-[92vw] rounded-xl border border-brass/40 bg-void/95 backdrop-blur p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[16px] tracking-[0.2em] text-flame">⚿ CONNECT AI</div>
          <button onClick={onClose} aria-label="close" className="text-glow/50 hover:text-glow text-sm leading-none px-1">×</button>
        </div>
        <McpBody />
        <p className="mt-3 pt-3 border-t border-brass/20 text-[12.5px] text-steamer/55 leading-relaxed">
          your first-ever AI registration gifts <b className="text-emerald-300/80">30 days of membership + 2 world builds</b> — the server tells your AI everything else.
        </p>
      </div>
    </div>
  )
}
