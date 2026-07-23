'use client'

import { useState, useEffect, useCallback } from 'react'

type World = { slug: string; name: string; isPublic: boolean; updatedAt: number }
type Branch = { name: string; base: string; label: string | null; version: number }

/** MANAGE — the owner-only ⚙ list (Galen): one place to see and manage EVERY
 *  world and branch you've made in your player space. Worlds are your PlayerSpace
 *  rows; branches are the `BASE ⑂ you · [label ·] vN` challenger scenes scattered
 *  across every world you've branched. Each row: open · rename · delete. Reads
 *  /api/spaces/mine (owner-scoped) and mutates through the existing auth'd routes. */
export default function ManagePanel({ onClose }: { onClose: () => void }) {
  const [handle, setHandle] = useState<string>('')
  const [worlds, setWorlds] = useState<World[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)      // name/slug currently mutating
  const [editing, setEditing] = useState<string | null>(null) // row key being renamed
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/spaces/mine', { cache: 'no-store' })
      if (!r.ok) { setErr(r.status === 401 ? 'sign in to manage your worlds' : 'could not load'); setLoading(false); return }
      const d = await r.json()
      setHandle(d.handle || '')
      setWorlds(Array.isArray(d.worlds) ? d.worlds : [])
      setBranches(Array.isArray(d.branches) ? d.branches : [])
      setErr(null)
    } catch { setErr('could not load') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (editing) setEditing(null); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  const openWorld = (slug: string) => { window.location.href = '/space/' + encodeURIComponent(slug) }
  const openBranch = (name: string) => { window.location.href = '/hub/' + encodeURIComponent(name) }

  const deleteWorld = async (w: World) => {
    if (!confirm(`Delete world “${w.name}”? This can’t be undone.`)) return
    setBusy(w.slug)
    try {
      const r = await fetch('/api/spaces/' + encodeURIComponent(w.slug), { method: 'DELETE' })
      if (r.ok) setWorlds(ws => ws.filter(x => x.slug !== w.slug))
      else setErr((await r.json().catch(() => ({}))).error || 'could not delete')
    } catch { setErr('could not delete') } finally { setBusy(null) }
  }
  const deleteBranch = async (b: Branch) => {
    if (!confirm(`Delete branch “${b.base} ⑂ ${b.label ? b.label + ' · ' : ''}v${b.version}”? This can’t be undone.`)) return
    setBusy(b.name)
    try {
      const r = await fetch('/api/engine/scene', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.name }) })
      if (r.ok) setBranches(bs => bs.filter(x => x.name !== b.name))
      else setErr((await r.json().catch(() => ({}))).error || 'could not delete')
    } catch { setErr('could not delete') } finally { setBusy(null) }
  }

  const startRename = (key: string, current: string) => { setEditing(key); setDraft(current) }
  const renameWorld = async (w: World) => {
    const name = draft.trim()
    if (!name || name === w.name) { setEditing(null); return }
    setBusy(w.slug)
    try {
      const r = await fetch('/api/spaces/' + encodeURIComponent(w.slug), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      if (r.ok) setWorlds(ws => ws.map(x => x.slug === w.slug ? { ...x, name } : x))
      else setErr((await r.json().catch(() => ({}))).error || 'could not rename')
    } catch { setErr('could not rename') } finally { setBusy(null); setEditing(null) }
  }
  const renameBranch = async (b: Branch) => {
    const label = draft.trim().replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, ' ').slice(0, 40)
    const to = label ? `${b.base} ⑂ ${handle} · ${label} · v${b.version}` : `${b.base} ⑂ ${handle} · v${b.version}`
    if (to === b.name) { setEditing(null); return }
    setBusy(b.name)
    try {
      const r = await fetch('/api/engine/scene', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', name: b.name, to }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) setBranches(bs => bs.map(x => x.name === b.name ? { ...x, name: to, label: label || null } : x))
      else setErr(d.error || 'could not rename')
    } catch { setErr('could not rename') } finally { setBusy(null); setEditing(null) }
  }

  // group branches by base world so the list reads as "my challengers of X"
  const byBase = branches.reduce<Record<string, Branch[]>>((m, b) => { (m[b.base] ||= []).push(b); return m }, {})

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-mono" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/15 bg-[#0c0a09]/95 p-5 text-white/85 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[15px] tracking-[0.25em] text-white/55">⚙ MY WORLDS &amp; BRANCHES</div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-[16px] leading-none px-1">✕</button>
        </div>

        {loading ? <div className="text-white/40 text-[14px] py-6 text-center">loading…</div> : err ? (
          <div className="text-amber-300/90 text-[14px] py-4">{err}</div>
        ) : (
          <>
            {/* WORLDS */}
            <div className="text-[13px] tracking-[0.2em] text-white/35 mb-1.5">WORLDS ({worlds.length}) — spaces you own</div>
            {worlds.length === 0 ? <div className="text-white/30 text-[13px] mb-4">no worlds yet.</div> : (
              <div className="mb-4 divide-y divide-white/5">
                {worlds.map(w => {
                  const k = 'w:' + w.slug
                  return (
                    <div key={k} className="flex items-center gap-2 py-1.5">
                      {editing === k ? (
                        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={60}
                          onKeyDown={e => { if (e.key === 'Enter') renameWorld(w); if (e.key === 'Escape') setEditing(null) }}
                          className="flex-1 min-w-0 bg-black/50 border border-white/20 rounded px-2 py-1 text-[14px] text-white/90 outline-none focus:border-emerald-300/50" />
                      ) : (
                        <button onClick={() => openWorld(w.slug)} className="flex-1 min-w-0 text-left text-[14px] text-white/85 hover:text-emerald-200 truncate" title="open">
                          {w.name}{!w.isPublic && <span className="text-white/30"> · private</span>}
                        </button>
                      )}
                      <div className="flex items-center gap-1 shrink-0 text-[12px] tracking-[0.1em]">
                        {editing === k ? (
                          <button onClick={() => renameWorld(w)} disabled={busy === w.slug} className="px-1.5 py-0.5 rounded text-emerald-300 hover:bg-emerald-400/10">save</button>
                        ) : (
                          <button onClick={() => startRename(k, w.name)} className="px-1.5 py-0.5 rounded text-white/45 hover:text-white hover:bg-white/10">rename</button>
                        )}
                        <button onClick={() => deleteWorld(w)} disabled={busy === w.slug} className="px-1.5 py-0.5 rounded text-red-400/70 hover:text-red-300 hover:bg-red-500/10">delete</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* BRANCHES */}
            <div className="text-[13px] tracking-[0.2em] text-white/35 mb-1.5">BRANCHES ({branches.length}) — your challengers</div>
            {branches.length === 0 ? <div className="text-white/30 text-[13px]">no branches yet — ⑂ CREATE BRANCH on any world.</div> : (
              <div className="space-y-3">
                {Object.entries(byBase).map(([base, list]) => (
                  <div key={base}>
                    <div className="text-[12px] text-white/30 tracking-[0.15em] mb-0.5">{base.toUpperCase()}</div>
                    <div className="divide-y divide-white/5">
                      {list.map(b => {
                        const k = 'b:' + b.name
                        return (
                          <div key={k} className="flex items-center gap-2 py-1.5">
                            {editing === k ? (
                              <div className="flex-1 min-w-0 flex items-center gap-1 text-[13px] text-white/40">
                                <span className="shrink-0">⑂ {handle} ·</span>
                                <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={40}
                                  placeholder="label (optional)"
                                  onKeyDown={e => { if (e.key === 'Enter') renameBranch(b); if (e.key === 'Escape') setEditing(null) }}
                                  className="flex-1 min-w-0 bg-black/50 border border-white/20 rounded px-2 py-1 text-[13px] text-white/90 outline-none focus:border-emerald-300/50" />
                                <span className="shrink-0">· v{b.version}</span>
                              </div>
                            ) : (
                              <button onClick={() => openBranch(b.name)} className="flex-1 min-w-0 text-left text-[14px] text-white/85 hover:text-emerald-200 truncate" title="open">
                                ⑂ {b.label ? b.label + ' · ' : ''}v{b.version}
                              </button>
                            )}
                            <div className="flex items-center gap-1 shrink-0 text-[12px] tracking-[0.1em]">
                              {editing === k ? (
                                <button onClick={() => renameBranch(b)} disabled={busy === b.name} className="px-1.5 py-0.5 rounded text-emerald-300 hover:bg-emerald-400/10">save</button>
                              ) : (
                                <button onClick={() => startRename(k, b.label || '')} className="px-1.5 py-0.5 rounded text-white/45 hover:text-white hover:bg-white/10">rename</button>
                              )}
                              <button onClick={() => deleteBranch(b)} disabled={busy === b.name} className="px-1.5 py-0.5 rounded text-red-400/70 hover:text-red-300 hover:bg-red-500/10">delete</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
