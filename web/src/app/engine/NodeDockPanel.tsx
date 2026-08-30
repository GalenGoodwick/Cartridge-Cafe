// engine/NodeDockPanel.tsx — THE DOCK PANEL (co-build rung 4): the world's
// nodes as a living roster. Hold states, per-node history timelines with
// owner revert, and each node's internals feed. Data comes from the nodes
// route (server truth — the same snapshot the bridge writes), refreshed on
// open and after every revert.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { NODE_HOLD_TTL } from './node-gate'

interface NodeRow {
  id: string
  kind: 'hook' | 'visual' | 'module'
  rev: number
  holder: string | null
  heldAt: number | null
  history: Array<{ rev: number; at: number; by: string; note?: string; bad: boolean; codeBytes: number }>
  feed?: Array<{ at: number; by: string; kind: string; text: string }>
}

const KIND_GLYPH = { hook: '⚙', visual: '◍', module: '▣' } as const

function age(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export function NodeDockPanel({ spaceSlug, isOwner, onClose, showToast }: {
  spaceSlug: string
  isOwner: boolean
  onClose: () => void
  showToast: (msg: string, type?: string, sub?: string) => void
}) {
  const [rows, setRows] = useState<NodeRow[] | null>(null)
  const [now, setNow] = useState(Date.now())
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback((feedFor?: string) => {
    const q = feedFor ? `?feed=${encodeURIComponent(feedFor)}` : ''
    fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/nodes${q}`)
      .then(r => r.json())
      .then((d: { nodes?: NodeRow[]; now?: number }) => {
        if (d.nodes) {
          setRows(prev => (feedFor && prev
            ? prev.map(p => d.nodes!.find(n => n.id === p.id) ?? p)   // keep order, adopt feeds
            : d.nodes) ?? [])
          if (d.now) setNow(d.now)
        }
      })
      .catch(() => setRows(r => r ?? []))
  }, [spaceSlug])
  useEffect(() => { load() }, [load])

  const revert = async (id: string, rev: number) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/nodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, rev }),
      })
      const d = await r.json()
      if (r.ok) {
        showToast(`"${id}" reverted to rev ${d.revertedTo}`, 'success', 'the restore lands as a new version; the live world adopts it on the next sync beat')
        load(openId ?? undefined)
      } else showToast(d.error || 'revert failed', 'error')
    } catch { showToast('revert failed — are you offline?', 'error') }
    setBusy(false)
  }

  const holdChip = (n: NodeRow) => {
    if (!n.holder) return <span className="px-1.5 rounded border border-white/15 text-white/45">FREE</span>
    const stale = !n.heldAt || now - n.heldAt > NODE_HOLD_TTL
    return stale
      ? <span className="px-1.5 rounded border border-amber-300/40 text-amber-200/70" title={`held by ${n.holder}… but idle — takeable`}>STALE</span>
      : <span className="px-1.5 rounded border border-sky-300/40 text-sky-200/80" title={`held fresh by ${n.holder}…`}>HELD · {n.holder}</span>
  }

  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[26rem] max-h-[82vh] overflow-y-auto rounded-xl bg-black/85 backdrop-blur border border-white/10 font-mono text-white/80 shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 text-[14px] tracking-[0.25em] text-white/60">
        <span>⬢ NODES — who builds what</span>
        <button onClick={onClose} aria-label="close" className="text-white/50 hover:text-white text-sm leading-none px-1">×</button>
      </div>
      {rows === null ? (
        <div className="px-3 py-6 text-center text-[14px] tracking-[0.2em] text-white/40">READING THE ROSTER…</div>
      ) : rows.length === 0 ? (
        <div className="px-3 py-5 text-[14px] leading-relaxed text-white/50">
          no nodes yet — every hook an AI pushes becomes a node here, with its own history, hold, and feed.
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {rows.map(n => {
            // SUB-NODES (Galen): "world:atrium" nests under "world" when the
            // parent slot exists — a sub-node is a FULL node (own history,
            // hold, heal); the tree is just how the anatomy reads.
            const sep = n.kind === 'hook' ? n.id.indexOf(':') : -1
            const parent = sep > 0 ? n.id.slice(0, sep) : null
            const isChild = !!(parent && rows.some(r => r.id === parent))
            return (
            <div key={n.id} className={isChild ? 'pl-5 border-l border-white/5 ml-3' : ''}>
              <button
                onClick={() => { const next = openId === n.id ? null : n.id; setOpenId(next); if (next && !n.feed) load(next) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13.5px] hover:bg-white/5 transition-colors">
                <span className="text-white/50">{KIND_GLYPH[n.kind]}</span>
                <span className="text-white/85 truncate flex-1">{n.id}</span>
                <span className="text-white/40">v{n.rev}</span>
                <span className="text-[12px]">{holdChip(n)}</span>
                <span className="text-white/35">{openId === n.id ? '▾' : '▸'}</span>
              </button>
              {openId === n.id && (
                <div className="px-3 pb-2.5 space-y-2">
                  {/* HISTORY — the timeline; owner may revert to any good rev */}
                  <div className="space-y-0.5">
                    {[...n.history].reverse().map(h => {
                      const current = h.rev === n.history[n.history.length - 1]?.rev
                      return (
                        <div key={h.rev} className={`flex items-center gap-2 text-[13.5px] leading-snug ${h.bad ? 'text-red-300/50' : current ? 'text-amber-200/90' : 'text-white/65'}`}>
                          <span className="w-8 shrink-0">v{h.rev}</span>
                          <span className="w-9 shrink-0 text-white/40">{age(h.at, now)}</span>
                          <span className="shrink-0 text-white/45">{h.by.slice(0, 8)}</span>
                          <span className="truncate flex-1">{h.bad ? '✕ marked bad' : (h.note || `${h.codeBytes}b`)}{current ? ' · live' : ''}</span>
                          {isOwner && !h.bad && !current && (
                            <button disabled={busy} onClick={() => void revert(n.id, h.rev)}
                              className="shrink-0 px-1.5 rounded border border-emerald-300/40 text-emerald-200/80 hover:bg-emerald-400/15 text-[12px] disabled:opacity-40 transition-colors">
                              ↩ revert
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {n.history.length === 0 && <div className="text-[13px] text-white/40">no history yet</div>}
                  </div>
                  {/* FEED — the node's internals: dock/undock/status/error/revert lines */}
                  {n.feed && n.feed.length > 0 && (
                    <div className="pt-1 border-t border-white/5 space-y-0.5">
                      {n.feed.slice(-8).map((f, i) => (
                        <div key={i} className="text-[13px] leading-snug text-white/55">
                          <span className="text-white/35">{age(f.at, now)} </span>
                          <span className={f.kind === 'error' ? 'text-red-300/60' : f.kind === 'revert' ? 'text-amber-200/60' : 'text-white/40'}>{f.kind}</span>
                          <span className="text-white/65"> · {f.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )})}
        </div>
      )}
      <div className="px-3 py-2 border-t border-white/10 text-[13px] leading-relaxed text-white/40">
        every AI push is a version here. HELD = a builder is docked (fresh); STALE holds are takeable; a bad rev is never a revert target. {isOwner ? 'revert restores as a NEW version — history is append-only.' : 'the owner can revert any node to a good version.'}
      </div>
    </div>
  )
}
