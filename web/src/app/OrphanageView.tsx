'use client'

import { useEffect, useState } from 'react'

/** THE ORPHANAGE (Galen) — a home for hidden worlds. Building, blank, unlisted,
 *  or your-own-private worlds gather here: you can see the orphan exists, but
 *  you cannot walk in. Tiles are deliberately NON-CLICKABLE — the door stays
 *  shut; a world leaves the orphanage only when its maker makes it real +
 *  public. Fed by GET /api/hub/orphanage (privacy-correct: others' private
 *  worlds are never listed). */

type Orphan = { name: string; slug: string; why: 'building' | 'blank' | 'private' | 'unlisted'; mine: boolean }

const WHY_LABEL: Record<Orphan['why'], string> = {
  building: 'an AI is still building it',
  blank: 'nothing in it yet',
  private: 'yours — kept private',
  unlisted: 'unlisted',
}

export default function OrphanageView({ onClose }: { onClose: () => void }) {
  const [orphans, setOrphans] = useState<Orphan[] | null>(null)

  useEffect(() => {
    fetch('/api/hub/orphanage')
      .then(r => r.json())
      .then(j => setOrphans(Array.isArray(j?.orphans) ? j.orphans : []))
      .catch(() => setOrphans([]))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-24 bg-void/75 backdrop-blur-sm"
      onClick={onClose}>
      <div className="relative w-[520px] max-w-[92vw] max-h-[70vh] flex flex-col border border-brass/40 rounded-xl bg-void/95 shadow-[0_0_60px_rgba(180,140,255,0.14)]"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-white/10">
          <div className="font-mono text-[13px] tracking-[0.22em] text-[#b48cff]/90">⌂ THE ORPHANAGE</div>
          <div className="font-mono text-[12px] text-white/40 mt-1 leading-relaxed">
            hidden worlds live here — building, blank, or kept private. you can see them; you can&apos;t enter them.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {orphans === null ? (
            <div className="font-mono text-[13px] text-white/30 px-2 py-6 text-center">gathering the orphans…</div>
          ) : orphans.length === 0 ? (
            <div className="font-mono text-[13px] text-white/30 px-2 py-6 text-center leading-relaxed">
              no orphans right now — every world has a home on the shelves.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {orphans.map(o => (
                // NON-CLICKABLE by design — a div, never a button. The orphan is
                // shown, never opened. cursor-not-allowed says so at a glance.
                <li key={o.slug}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 cursor-not-allowed select-none"
                  title="hidden — you can see it exists, but not enter it">
                  <span className="font-mono text-[14px] tracking-[0.08em] text-white/55 truncate">
                    <span className="text-white/30 mr-1.5">🔒</span>{o.name.toLowerCase()}
                  </span>
                  <span className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded border ${o.mine ? 'border-[#b48cff]/40 text-[#b48cff]/80' : 'border-white/15 text-white/35'}`}>
                    {WHY_LABEL[o.why]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button onClick={onClose}
          className="font-mono text-[13px] tracking-[0.18em] text-white/45 hover:text-white/80 py-2.5 border-t border-white/10 transition-colors">
          ← BACK
        </button>
      </div>
    </div>
  )
}
