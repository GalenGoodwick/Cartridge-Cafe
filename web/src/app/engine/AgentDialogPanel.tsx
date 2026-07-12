'use client'

import { useEffect, useRef } from 'react'

export interface DialogEntry {
  from: string
  to: string
  fromColor: [number, number, number, number]
  content: string
  data?: Record<string, unknown>
  timestamp: number
}

function colorToCSS(c: [number, number, number, number]): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
}

export default function AgentDialogPanel({ entries }: { entries: DialogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-3 py-2 text-[10px] font-mono text-muted border-b border-border flex-shrink-0">
        Dialog <span className="text-accent">{entries.length}</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
        {entries.length === 0 && (
          <div className="text-[10px] text-muted font-mono italic">No messages yet</div>
        )}
        {entries.map((e, i) => (
          <div key={i} className="text-[11px] font-mono leading-snug">
            <div className="flex items-center gap-1 mb-0.5">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: colorToCSS(e.fromColor) }}
              />
              <span style={{ color: colorToCSS(e.fromColor) }} className="font-semibold">
                {e.from}
              </span>
              <span className="text-muted">&rarr;</span>
              <span className="text-muted">{e.to}</span>
            </div>
            <div className="pl-3 text-slate-300 whitespace-pre-wrap break-words">
              {e.content}
            </div>
            {e.data && (
              <details className="pl-3 mt-1">
                <summary className="text-[9px] text-muted cursor-pointer hover:text-accent">
                  data payload
                </summary>
                <pre className="text-[9px] text-muted mt-1 p-1 bg-black/30 rounded overflow-x-auto">
                  {JSON.stringify(e.data, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
