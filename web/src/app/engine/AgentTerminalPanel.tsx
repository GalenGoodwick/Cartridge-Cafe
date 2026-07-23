'use client'

import { useEffect, useRef, useState } from 'react'

export interface TerminalEntry {
  type: string
  fieldName: string
  fieldColor: [number, number, number, number]
  summary: string
  detail?: string
  author?: string
  timestamp: number
}

function colorToCSS(c: [number, number, number, number]): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
}

function TerminalLine({ entry }: { entry: TerminalEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="text-[16px] font-mono leading-snug">
      <div className="flex items-start gap-1">
        {entry.author && (
          <span className="text-amber-400/80 flex-shrink-0">[{entry.author}]</span>
        )}
        <span
          className="inline-block w-2 h-2 rounded-full flex-shrink-0 mt-1"
          style={{ backgroundColor: colorToCSS(entry.fieldColor) }}
        />
        <span style={{ color: colorToCSS(entry.fieldColor) }} className="flex-shrink-0">
          {entry.fieldName}
        </span>
        <span className="text-accent flex-shrink-0">{entry.type}</span>
        <span className="text-slate-400 break-words min-w-0 flex-1">{entry.summary}</span>
      </div>
      {entry.detail && (
        <div className="pl-3 mt-0.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[14px] text-muted hover:text-accent cursor-pointer"
          >
            {expanded ? '[ - hide code ]' : '[ + show code ]'}
          </button>
          {expanded && (
            <pre className="text-[14px] text-emerald-400/80 mt-1 p-2 bg-black/40 rounded overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
              {entry.detail}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default function AgentTerminalPanel({ entries, header = true }: { entries: TerminalEntry[]; header?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // NO auto-snapping (Galen: scrolling up to read must never be yanked back).
  // The reader scrolls freely; the CURRENT button (grey when already snapped)
  // is the ONE manual way to jump to the newest line.
  const [atBottom, setAtBottom] = useState(true)
  const checkBottom = () => {
    const el = scrollRef.current
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 8)
  }
  useEffect(() => { checkBottom() }, [entries.length])
  const toCurrent = () => { const el = scrollRef.current; if (el) { el.scrollTop = el.scrollHeight; setAtBottom(true) } }

  return (
    <div className="relative flex flex-col min-h-0 flex-1">
      <button onClick={toCurrent} disabled={atBottom}
        title={atBottom ? 'at the newest line' : 'jump to the newest line'}
        className={`absolute bottom-2 right-3 z-10 px-2 py-0.5 rounded font-mono text-[12px] tracking-[0.18em] border transition-colors ${atBottom ? 'border-white/10 text-white/25 bg-black/40 cursor-default' : 'border-amber-400/50 text-amber-300 bg-black/70 hover:bg-black/90 animate-pulse'}`}>
        ▼ CURRENT
      </button>
      {header && (
        <div className="px-3 py-2 text-[14px] font-mono text-muted border-b border-border flex-shrink-0">
          Terminal <span className="text-accent">{entries.length}</span>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={checkBottom}
        className="flex-1 overflow-y-scroll p-2 space-y-1 min-h-0 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.35)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/30 [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {entries.length === 0 && (
          <div className="text-[14px] text-muted font-mono italic">No commands yet</div>
        )}
        {entries.map((e, i) => (
          <TerminalLine key={i} entry={e} />
        ))}
      </div>
    </div>
  )
}
