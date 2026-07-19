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
    <div className="text-[13px] font-mono leading-snug">
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
        <span className="text-slate-400 break-words">{entry.summary}</span>
      </div>
      {entry.detail && (
        <div className="pl-3 mt-0.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[12px] text-muted hover:text-accent cursor-pointer"
          >
            {expanded ? '[ - hide code ]' : '[ + show code ]'}
          </button>
          {expanded && (
            <pre className="text-[12px] text-emerald-400/80 mt-1 p-2 bg-black/40 rounded overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
              {entry.detail}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default function AgentTerminalPanel({ entries }: { entries: TerminalEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-3 py-2 text-[12px] font-mono text-muted border-b border-border flex-shrink-0">
        Terminal <span className="text-accent">{entries.length}</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
        {entries.length === 0 && (
          <div className="text-[12px] text-muted font-mono italic">No commands yet</div>
        )}
        {entries.map((e, i) => (
          <TerminalLine key={i} entry={e} />
        ))}
      </div>
    </div>
  )
}
