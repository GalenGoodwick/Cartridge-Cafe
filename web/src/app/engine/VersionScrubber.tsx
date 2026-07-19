'use client'

import { useState } from 'react'

/** The ONE version control, used on every world type (main, branch, brewed space).
 *  Hybrid: ◂ / ▸ step through versions; clicking the middle label opens a
 *  scrollable list to jump straight to any point. Older is left, newer is right.
 *
 *  It's presentational — the caller supplies the list and the handlers, so the
 *  same widget drives three different version stores behind one shape. */

export type VersionItem = {
  key: string
  label: string        // e.g. "LIVE", "v7"
  sub?: string         // e.g. a timestamp/author, shown dim
  active: boolean
  onPick: () => void
}

export default function VersionScrubber({
  label, total, canOlder, canNewer, onOlder, onNewer, items,
}: {
  label: string
  total: number
  canOlder: boolean
  canNewer: boolean
  onOlder: () => void
  onNewer: () => void
  items: VersionItem[]
}) {
  const [open, setOpen] = useState(false)
  const btn = 'hover:text-white px-1 disabled:opacity-30 disabled:cursor-default'
  return (
    <div className="relative">
      <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70">
        <button className={`${btn} ${canOlder ? '' : 'invisible'}`} disabled={!canOlder} title="older version" onClick={onOlder}>◂</button>
        <button
          onClick={() => setOpen(o => !o)}
          title="all versions — click to jump"
          className="tracking-[0.1em] px-1 rounded hover:bg-white/10 hover:text-white transition-colors"
        >
          {label}{total > 1 ? <span className="text-white/30">/{total}</span> : null}
        </button>
        <button className={`${btn} ${canNewer ? '' : 'invisible'}`} disabled={!canNewer} title="newer version" onClick={onNewer}>▸</button>
      </div>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-[220px] max-h-[260px] overflow-y-auto rounded-lg bg-[#0d0906]/95 backdrop-blur border border-white/15 shadow-xl py-1">
            <div className="px-3 py-1.5 text-[12px] tracking-[0.25em] text-white/40 border-b border-white/10">VERSIONS · {total}</div>
            {items.map(it => (
              <button
                key={it.key}
                onClick={() => { it.onPick(); setOpen(false) }}
                className={`w-full flex items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[12px] font-mono transition-colors ${
                  it.active ? 'bg-amber-500/15 text-amber-200' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="tracking-[0.1em]">{it.active ? '▸ ' : ''}{it.label}</span>
                {it.sub && <span className="text-white/30 text-[12px] truncate">{it.sub}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
