'use client'

import { useState, useEffect } from 'react'
import ConnectAiBody from '@/app/ConnectAiPanel'
import McpBody from '@/app/McpConnectPanel'

/** CONNECT AI — the ONE connect door. The PRIMARY path is paste-a-prompt: mint
 *  your player key and paste the prompt into any internet-capable AI (it acts as
 *  you, builds your worlds, chats the commons). MCP — add the cafe as an MCP
 *  server for Claude Code / Cursor — is the account-OPTIONAL developer door, so
 *  it's a lightweight secondary revealed on demand, NOT a co-equal tab. This
 *  wrapper owns the modal chrome (overlay, header, Escape/× close); each body
 *  renders only its own content. */
export default function ConnectPanel({ onClose }: { onClose: () => void }) {
  const [showMcp, setShowMcp] = useState(false)
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

        {/* PRIMARY — paste a prompt (mint your player key) */}
        <ConnectAiBody />

        {/* SECONDARY — MCP, the developer door, revealed only on demand */}
        <div className="mt-3 pt-3 border-t border-brass/20">
          {!showMcp ? (
            <button onClick={() => setShowMcp(true)}
              className="text-[13px] text-steamer/60 hover:text-glow underline underline-offset-2 decoration-brass/40">
              ⧉ Prefer an MCP client (Claude Code / Cursor)? →
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[13px] tracking-[0.12em] text-flame/80">⧉ MCP SERVER</div>
                <button onClick={() => setShowMcp(false)} className="text-[12px] text-glow/40 hover:text-glow">hide</button>
              </div>
              <McpBody />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
