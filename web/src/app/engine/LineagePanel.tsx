'use client'

// ⑂ LINEAGE — the world's family tree + who built what (Galen, Sep 5: "put a
// lineage tab onto the engine with lineage info and edits by user").
// Two truths, two sources:
//  · LINEAGE from /api/spaces/[slug]/lineage (forkOf chain + forks — no
//    snapshot read, the detoast law)
//  · EDITS from the client's already-loaded worldData: __provenance (route-
//    stamped creator/last-editor per thing) + __nodeHist (per-rev `by`) —
//    un-spoofable route truth, never a client claim.

import { useEffect, useMemo, useState } from 'react'

type Kin = { slug: string; name: string; owner: string; at: number; isPublic: boolean }
type Prov = Record<string, { by: string; at: number; lastBy: string; lastAt: number; edits: number }>
type Hist = Record<string, Array<{ at?: number; by?: string }>>

function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

type SrvEditor = { who: string; created: number; edits: number; lastAt: number; things: string[] }

export default function LineagePanel({ slug, worldData, onClose, inline }: {
  slug: string
  worldData: Record<string, unknown> | undefined
  onClose?: () => void
  /** the engine-tab face — fills its container instead of floating as a modal */
  inline?: boolean
}) {
  const [tree, setTree] = useState<{ self: Kin; ancestors: Kin[]; forks: Kin[]; editors?: SrvEditor[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    // no client worldData (the inline tab) → ask the route to aggregate editors
    const q = worldData ? '' : '?editors=1'
    fetch(`/api/spaces/${encodeURIComponent(slug)}/lineage${q}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(setTree)
      .catch(() => setErr('lineage unavailable'))
  }, [slug, worldData])

  // EDITS BY USER — aggregate route-stamped identity over every thing
  const editors = useMemo(() => {
    const prov = (worldData?.__provenance ?? {}) as Prov
    const hist = (worldData?.__nodeHist ?? {}) as Hist
    const acc = new Map<string, { created: string[]; edits: number; lastAt: number }>()
    const bump = (who: string) => {
      const w = who || 'anon'
      let e = acc.get(w)
      if (!e) { e = { created: [], edits: 0, lastAt: 0 }; acc.set(w, e) }
      return e
    }
    for (const [key, p] of Object.entries(prov)) {
      if (!p || typeof p !== 'object') continue
      const c = bump(p.by); c.created.push(key); c.lastAt = Math.max(c.lastAt, p.at || 0)
      const l = bump(p.lastBy); l.lastAt = Math.max(l.lastAt, p.lastAt || 0)
    }
    for (const chain of Object.values(hist)) {
      if (!Array.isArray(chain)) continue
      for (const rev of chain) {
        const e = bump(String(rev?.by ?? '') || 'anon')
        e.edits++; e.lastAt = Math.max(e.lastAt, Number(rev?.at) || 0)
      }
    }
    return [...acc.entries()]
      .map(([who, e]) => ({ who, createdCount: e.created.length, things: e.created.slice(0, 6), edits: e.edits, lastAt: e.lastAt }))
      .sort((a, b) => b.lastAt - a.lastAt)
  }, [worldData])
  const shown = worldData
    ? editors
    : (tree?.editors ?? []).map(e => ({ who: e.who, createdCount: e.created, things: e.things, edits: e.edits, lastAt: e.lastAt }))

  const kinRow = (k: Kin, tag: string, self?: boolean) => (
    <div key={`${tag}-${k.slug}`} className={`flex items-baseline gap-2 py-1 ${self ? 'text-amber-100' : 'text-white/80'}`}>
      <span className="text-white/40 text-[12px] w-14 shrink-0 tracking-[0.15em]">{tag}</span>
      {k.isPublic && !self
        ? <a href={`/space/${k.slug}`} className="underline decoration-white/25 hover:decoration-white/70 truncate">{k.name}</a>
        : <span className="truncate">{k.name}{!k.isPublic && <span className="text-white/35"> (private)</span>}</span>}
      <span className="text-white/40 text-[12px] truncate">by {k.owner}</span>
      <span className="text-white/30 text-[12px] ml-auto shrink-0">{ago(k.at)}</span>
    </div>
  )

  const body = (
    <>

        {err && <div className="text-white/50 mb-3">{err}</div>}
        {tree && (
          <div className="mb-4">
            {tree.ancestors.length === 0 && <div className="text-white/45 text-[13px] mb-1">an original — not forked from anything</div>}
            {tree.ancestors.map((k, i) => kinRow(k, i === 0 ? 'ROOT' : '⑂ FORK'))}
            {kinRow(tree.self, tree.ancestors.length ? '⑂ THIS' : 'THIS', true)}
            {tree.forks.length > 0 && (
              <div className="mt-2 pt-2 border-t border-white/10">
                <div className="text-white/40 text-[12px] tracking-[0.2em] mb-1">FORKS OF THIS WORLD · {tree.forks.length}</div>
                {tree.forks.map(k => kinRow(k, '↳'))}
              </div>
            )}
          </div>
        )}

        <div className="pt-3 border-t border-white/10">
          <div className="text-white/40 text-[12px] tracking-[0.2em] mb-2">EDITS BY USER · route-verified attribution</div>
          {shown.length === 0 && <div className="text-white/45 text-[13px]">no attributed edits yet — provenance starts stamping with the next bridge push</div>}
          {shown.map(e => (
            <div key={e.who} className="py-1.5 border-b border-white/5 last:border-0">
              <div className="flex items-baseline gap-2">
                <span className={e.who === 'owner' ? 'text-amber-100' : 'text-emerald-200/90'}>{e.who}</span>
                <span className="text-white/45 text-[12px]">{e.createdCount} created · {e.edits} revs</span>
                {e.lastAt > 0 && <span className="text-white/30 text-[12px] ml-auto shrink-0">{ago(e.lastAt)}</span>}
              </div>
              {e.things.length > 0 && (
                <div className="text-white/35 text-[11px] truncate">{e.things.join(' · ')}{e.createdCount > 6 ? ` · +${e.createdCount - 6}` : ''}</div>
              )}
            </div>
          ))}
        </div>
    </>
  )
  if (inline) {
    return (
      <div className="w-full h-full overflow-y-auto p-4 font-mono text-[14px] leading-relaxed text-white/85">
        <div className="text-[11.5px] tracking-[0.2em] text-amber-200/70 mb-2">⑂ LINEAGE</div>
        {body}
      </div>
    )
  }
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="max-w-lg w-[92%] max-h-[80%] overflow-y-auto rounded-xl border border-white/15 bg-black/85 backdrop-blur p-5 font-mono text-[14px] leading-relaxed text-white/85" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[16px] tracking-[0.25em] text-white/60">⑂ LINEAGE</div>
          <button className="text-[14px] tracking-[0.15em] text-white/60 hover:text-white px-2 py-1" onClick={onClose}>CLOSE</button>
        </div>
        {body}
      </div>
    </div>
  )
}
