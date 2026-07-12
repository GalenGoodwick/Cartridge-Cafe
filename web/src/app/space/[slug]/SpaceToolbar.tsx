'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface VersionMeta {
  id: string
  version: number
  note: string | null
  createdAt: string
  author: { id: string; name: string | null } | null
}

interface SpaceToolbarProps {
  slug: string
  name: string
  ownerName: string | null
  isOwner: boolean
  versionView?: number
}

/** Floating world chrome: save points, history, remix, call-a-vote.
 *  Sits over the engine without touching it. */
export default function SpaceToolbar({ slug, name, ownerName, isOwner, versionView }: SpaceToolbarProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<VersionMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [flagOpen, setFlagOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiToken, setAiToken] = useState<string | null>(null)
  const [flagReason, setFlagReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<{
    aiActive: boolean
    lastSeen: string | null
    agentName: string | null
    aiFocus?: { action?: string; fieldId?: string; fieldName?: string; at?: number } | null
    playerFocus?: { fieldId?: string; fieldName?: string; at?: number } | null
  }>({ aiActive: false, lastSeen: null, agentName: null })

  const loadVersions = useCallback(async () => {
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/versions`)
      if (r.ok) setVersions((await r.json()).versions || [])
    } catch { /* offline is fine */ }
  }, [slug])

  useEffect(() => { if (open) loadVersions() }, [open, loadVersions])

  // AI presence heartbeat — token lastUsedAt ticks on every bridge call
  useEffect(() => {
    let mounted = true
    const poll = async () => {
      try {
        const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/activity`)
        if (r.ok && mounted) setAiStatus(await r.json())
      } catch { /* offline is fine */ }
    }
    poll()
    const t = setInterval(poll, 10_000)
    return () => { mounted = false; clearInterval(t) }
  }, [slug])

  const aiSeenAgo = aiStatus.lastSeen ? Math.round((Date.now() - new Date(aiStatus.lastSeen).getTime()) / 60000) : null

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500) }

  const savePoint = async () => {
    const note = window.prompt('Note for this save point (optional):') ?? undefined
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      const d = await r.json()
      if (r.ok) { flash(`Saved as v${d.version.version}`); loadVersions() }
      else flash(d.error || 'Save failed')
    } finally { setBusy(false) }
  }

  const restore = async (version: number) => {
    if (!window.confirm(`Restore v${version} as the live world?`)) return
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/versions/${version}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply' }),
      })
      if (r.ok) { flash(`v${version} is live — reloading`); setTimeout(() => { window.location.href = `/space/${slug}` }, 800) }
      else flash((await r.json()).error || 'Restore failed')
    } finally { setBusy(false) }
  }

  const remix = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      if (r.ok) { window.location.href = `/space/${d.space.slug}` }
      else flash(d.error || 'Remix failed (sign in?)')
    } finally { setBusy(false) }
  }

  const callVote = async () => {
    if (!flagReason.trim()) { flash('Say what the conflict is'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: flagReason.trim() }),
      })
      const d = await r.json()
      if (r.ok) { setFlagOpen(false); router.push(`/chants/${d.deliberationId}`) }
      else flash(d.error || 'Could not open a resolution')
    } finally { setBusy(false) }
  }

  const connectAI = async () => {
    setAiOpen(o => !o)
    if (aiToken) return
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'AI agent' }),
      })
      const d = await r.json()
      if (r.ok) setAiToken(d.token)
      else flash(d.error || 'Could not mint a token')
    } finally { setBusy(false) }
  }

  const aiInstructions = aiToken
    ? `Connect to my Unity Chant world "${name}":\nPOST commands to ${typeof window !== 'undefined' ? window.location.origin : ''}/api/engine/bridge\nheader: Authorization: Bearer ${aiToken}\nFull docs: GET ${typeof window !== 'undefined' ? window.location.origin : ''}/api/engine/guide (markdown). GET the bridge URL returns world state. worldData.player_focus = what I have selected — follow it. Fields are INVISIBLE until given a visualType.`
    : ''

  const btn = 'px-2.5 py-1 rounded text-xs font-medium bg-white/10 hover:bg-white/20 text-white/90 transition-colors disabled:opacity-40'

  return (
    <div className="fixed top-14 right-4 z-50 flex flex-col items-end gap-2 font-sans">
      {/* header chip */}
      <div className="flex items-center gap-2 rounded-lg bg-black/60 backdrop-blur px-3 py-2 border border-white/10">
        <div className="text-sm text-white/90">
          <span className="font-semibold">{name}</span>
          {ownerName && <span className="text-white/50"> · {ownerName}</span>}
          {versionView !== undefined && (
            <span className="ml-2 rounded bg-amber-500/20 text-amber-300 px-1.5 py-0.5 text-[11px]">save point v{versionView} · read-only</span>
          )}
          {aiStatus.aiActive ? (
            <span className="ml-2 inline-flex items-center gap-1 rounded bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {aiStatus.agentName || 'AI'} connected
            </span>
          ) : aiSeenAgo !== null && aiSeenAgo < 10 ? (
            <span className="ml-2 inline-flex items-center gap-1 rounded bg-white/5 text-white/40 px-1.5 py-0.5 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
              AI seen {aiSeenAgo <= 1 ? 'just now' : `${aiSeenAgo}m ago`}
            </span>
          ) : null}
        </div>
      </div>

      {/* actions */}
      <div className="flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur px-2 py-1.5 border border-white/10">
        {versionView !== undefined ? (
          <>
            <a href={`/space/${slug}`} className={btn}>Back to live</a>
            {isOwner && <button className={btn} disabled={busy} onClick={() => restore(versionView)}>Make this live</button>}
          </>
        ) : (
          <>
            {isOwner && <button className={btn} disabled={busy} onClick={savePoint}>Save point</button>}
            {isOwner && <button className={btn} disabled={busy} onClick={connectAI}>Connect AI</button>}
            <button className={btn} onClick={() => setOpen(o => !o)}>History</button>
            <button className={btn} disabled={busy} onClick={remix}>Remix</button>
            <button className={btn} disabled={busy} onClick={() => setFlagOpen(o => !o)}>Call a vote</button>
            <a href="/worlds" className={btn}>Worlds</a>
          </>
        )}
      </div>

      {/* focus chips — who is working on what */}
      {(() => {
        const fresh = (at?: number) => at !== undefined && Date.now() - at < 120_000
        const ai = aiStatus.aiFocus
        const pl = aiStatus.playerFocus
        if (!fresh(ai?.at) && !fresh(pl?.at)) return null
        return (
          <div className="flex flex-col items-end gap-1">
            {fresh(ai?.at) && (
              <div className="inline-flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur border border-emerald-400/20 px-2.5 py-1 text-[11px] text-emerald-200/90">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                AI \u2192 {ai?.fieldName || ai?.fieldId || 'the world'}{ai?.action ? ` \u00b7 ${String(ai.action).replace(/_/g, ' ')}` : ''}
              </div>
            )}
            {fresh(pl?.at) && !isOwner && (
              <div className="inline-flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur border border-sky-400/20 px-2.5 py-1 text-[11px] text-sky-200/90">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                {ownerName || 'player'} \u2192 {pl?.fieldName || pl?.fieldId}
              </div>
            )}
          </div>
        )
      })()}

      {msg && <div className="rounded bg-black/70 text-white/90 text-xs px-3 py-1.5 border border-white/10">{msg}</div>}

      {/* history drawer */}
      {open && (
        <div className="w-72 max-h-80 overflow-y-auto rounded-lg bg-black/75 backdrop-blur border border-white/10 p-2 space-y-1">
          {versions.length === 0 && <div className="text-xs text-white/50 p-2">No save points yet.</div>}
          {versions.map(v => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-white/5">
              <div className="min-w-0">
                <div className="text-xs text-white/90 truncate">v{v.version}{v.note ? ` — ${v.note}` : ''}</div>
                <div className="text-[10px] text-white/40">
                  {v.author?.name || 'unknown'} · {new Date(v.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <a className={btn} href={`/space/${slug}?version=${v.version}`}>View</a>
                {isOwner && <button className={btn} disabled={busy} onClick={() => restore(v.version)}>Restore</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* connect-AI panel */}
      {aiOpen && (
        <div className="w-80 rounded-lg bg-black/80 backdrop-blur border border-white/10 p-3 space-y-2">
          <div className="text-xs text-white/80 font-medium">Plug an AI into this world</div>
          {aiToken ? (
            <>
              <div className="text-[11px] text-white/60">
                This is your world&apos;s key — any AI holding it can build here. Shown once; revoke anytime from tokens.
              </div>
              <pre className="text-[10px] text-white/80 bg-white/5 border border-white/10 rounded p-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{aiInstructions}</pre>
              <button
                className={btn}
                onClick={() => { navigator.clipboard.writeText(aiInstructions); flash('Copied — paste it to your AI') }}
              >
                Copy instructions
              </button>
            </>
          ) : (
            <div className="text-[11px] text-white/50">Minting a world key…</div>
          )}
        </div>
      )}

      {/* call-a-vote dialog */}
      {flagOpen && (
        <div className="w-72 rounded-lg bg-black/80 backdrop-blur border border-white/10 p-3 space-y-2">
          <div className="text-xs text-white/80">
            Open a resolution: the two latest save points become a live-demo ballot and a cell votes.
          </div>
          <textarea
            value={flagReason}
            onChange={e => setFlagReason(e.target.value)}
            placeholder="What's the conflict?"
            className="w-full h-16 rounded bg-white/5 border border-white/10 text-xs text-white/90 p-2 outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <button className={btn} onClick={() => setFlagOpen(false)}>Cancel</button>
            <button className={btn} disabled={busy} onClick={callVote}>Open resolution</button>
          </div>
        </div>
      )}
    </div>
  )
}
