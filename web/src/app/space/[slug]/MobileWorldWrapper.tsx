'use client'

// THE MOBILE WRAPPER (Galen, Aug 28) — "a standard mobile-first wrapper for
// worlds... mobile is just for playing mobile products; all editing and engine
// tools are moot on mobile." A phone gets THIS instead of the desktop chrome:
// the engine in PURE PLAY (mobilePlay — no dock/rail/edit/builderbox, no
// EXIT/REC overlay) inside a thin, thumb-first DOM shell. Standard DOM, not
// shader chrome. Play-only; nothing here creates or edits.
//
// The engine still renders the world on mobile WebGPU (Galen's ruling: "the
// engine, play-only"); the perf caps (30fps + 1.2M px) already keep it light,
// and a targets:mobile game is authored under stricter presets so it fits.
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'

export default function MobileWorldWrapper({ spaceId, spaceSlug, playScene, gridSize, name, ownerName }: {
  spaceId?: string
  spaceSlug?: string
  playScene?: string   // house-scene / proof mount (no DB) — FieldEngine takes either
  gridSize?: number
  name: string
  ownerName: string | null
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [instrOpen, setInstrOpen] = useState(false)

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ height: '100dvh', background: '#04050b' }}>
      {/* THE PLAY SURFACE — engine in pure play; touch controls mount themselves */}
      <FieldEngine
        spaceId={spaceId}
        spaceSlug={spaceSlug}
        playScene={playScene}
        gridSize={gridSize}
        spaceName={name}
        spaceOwnerName={ownerName}
        isOwner={false}
        hooksTrusted={!!playScene}
        mobilePlay
      />

      {/* THIN PLAY CHROME — thumb-first, safe-area aware, above the canvas */}
      <div
        className="fixed top-0 inset-x-0 z-[120] flex items-center gap-2 px-3 pointer-events-none"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 8px)', paddingBottom: 8 }}
      >
        <button
          onClick={() => router.push('/')}
          aria-label="back"
          className="pointer-events-auto w-11 h-11 grid place-items-center rounded-2xl bg-black/55 backdrop-blur border border-white/12 text-white/85 text-[18px] active:bg-black/75"
        >◂</button>
        <div className="min-w-0 flex-1 px-1">
          <div className="font-mono text-[13px] tracking-[0.12em] text-white/90 truncate">{name}</div>
          {ownerName && <div className="font-mono text-[10px] text-white/40 truncate">{ownerName}</div>}
        </div>
        <button
          onClick={() => setMenuOpen(o => !o)}
          aria-label="menu"
          className={`pointer-events-auto w-11 h-11 grid place-items-center rounded-2xl backdrop-blur border text-[18px] ${menuOpen ? 'bg-white/15 border-amber-300/50 text-white' : 'bg-black/55 border-white/12 text-white/85'} active:bg-black/75`}
        >⋯</button>
      </div>

      {/* THE PLAY MENU — only play-relevant, mobile-safe actions. NO editing,
          NO engine tools (moot on mobile). Slips down from the ⋯. */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-[121]" onClick={() => setMenuOpen(false)} />
          <div
            className="fixed z-[122] right-3 rounded-2xl overflow-hidden shadow-2xl border border-white/12 bg-[#0d0c14]/97 backdrop-blur"
            style={{ top: 'calc(max(env(safe-area-inset-top), 8px) + 52px)', minWidth: 200 }}
          >
            {[
              { label: '? instructions', on: () => { setInstrOpen(true); setMenuOpen(false) } },
              { label: '↗ share', on: async () => { try { await navigator.share?.({ url: window.location.href, title: name }) } catch { try { await navigator.clipboard.writeText(window.location.href) } catch { /* ignore */ } } setMenuOpen(false) } },
              { label: '⟳ restart', on: () => { window.location.reload() } },
            ].map(item => (
              <button key={item.label} onClick={item.on}
                className="w-full text-left font-mono text-[14px] tracking-[0.1em] px-4 py-3.5 text-white/85 border-b border-white/8 active:bg-white/10">
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* INSTRUCTIONS — the one play-time reference, mobile sheet */}
      {instrOpen && (
        <div className="fixed inset-0 z-[130] flex items-end" onClick={() => setInstrOpen(false)}>
          <div
            className="w-full max-h-[70dvh] overflow-y-auto rounded-t-3xl bg-[#0d0c14] border-t border-white/12 p-5 pb-8"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[13px] tracking-[0.2em] text-white/60">INSTRUCTIONS</span>
              <button onClick={() => setInstrOpen(false)} className="w-9 h-9 grid place-items-center text-white/50 text-[18px]">✕</button>
            </div>
            <MobileInstructions slug={spaceSlug ?? ''} />
          </div>
        </div>
      )}
    </div>
  )
}

// world instructions live in worldData.instructions; the engine publishes them
// to a stable slot. For the wrapper we read them from the world snapshot API
// (cheap, cached) — a pure-DOM read, no engine dependency.
function MobileInstructions({ slug }: { slug: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (!slug) { setText('(proof scene — instructions load on a real world)'); return }
    let stop = false
    fetch(`/api/spaces/${encodeURIComponent(slug)}/snapshot`)
      .then(r => r.json())
      .then(d => {
        if (stop) return
        const wd = (d?.snapshot?.worldData ?? {}) as Record<string, unknown>
        const t = wd.instructions
        setText(typeof t === 'string' && t.trim() ? t : 'No instructions for this world yet.')
      })
      .catch(() => { if (!stop) setText('Could not load instructions.') })
    return () => { stop = true }
  }, [slug])
  return <div className="font-mono text-[14px] leading-relaxed text-white/80 whitespace-pre-wrap">{text ?? '…'}</div>
}
