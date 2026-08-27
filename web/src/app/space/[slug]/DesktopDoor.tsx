'use client'

// THE DESKTOP DOOR — one component, every mount (SpaceStage's world door + the
// unified executor when a plan's `supported` verdict says no). A phone visitor
// at a desktop-built world's door gets an honest notice: copy-link to move to a
// computer, or step in anyway. The `why` line comes from the SAME verdict the
// solver stamps on plans (targetsSupport) — one source of truth for the words.
import { useState } from 'react'

export default function DesktopDoor({ name, why, onStepIn }: { name: string; why?: string; onStepIn: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: 'radial-gradient(120% 90% at 50% 40%, rgba(23,16,11,0.96) 0%, rgba(11,9,8,0.97) 70%)', fontFamily: 'var(--font-mono, monospace)' }}>
      <div className="max-w-[360px] w-full text-center rounded-2xl px-7 py-9"
        style={{ border: '1px solid rgba(185,122,42,0.35)', background: 'rgba(11,9,8,0.85)', boxShadow: '0 0 80px rgba(245,176,76,0.12)', color: '#e7dcc8' }}>
        <div className="text-[44px] mb-3">🖥️</div>
        <div className="text-[26px] mb-3" style={{ fontFamily: 'var(--font-display, serif)', fontStyle: 'italic', color: '#ffdba8' }}>
          this world wants a bigger table
        </div>
        <p className="text-[14px] leading-relaxed m-0" style={{ color: '#c9b896' }}>
          <b style={{ color: '#ffdba8' }}>{name}</b> was built for a desktop screen —
          its maker tagged it that way. {why ? <>({why})</> : 'It may sprawl or fight your thumbs here.'}
        </p>
        <button
          onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* fine */ } }}
          className="mt-5 w-full px-4 py-2.5 rounded-xl text-[13px] tracking-[0.12em]"
          style={{ border: '1px solid rgba(185,122,42,0.5)', background: 'rgba(185,122,42,0.14)', color: '#ffdba8' }}>
          {copied ? 'LINK COPIED ✓' : '⧉ COPY LINK — OPEN ON YOUR COMPUTER'}
        </button>
        <button onClick={onStepIn}
          className="mt-2.5 w-full px-4 py-2.5 rounded-xl text-[13px] tracking-[0.15em]"
          style={{ border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(201,184,150,0.75)' }}>
          STEP IN ANYWAY
        </button>
      </div>
    </div>
  )
}
