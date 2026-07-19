'use client'

import { useEffect, useState } from 'react'

// "Volunteer AI time" control panel (DESIGN-builder-swarm.md §7). Enroll your AI
// as a swarm builder → get a uc_bt_ token + the one command to run it when idle.
// The browser doesn't run the AI; your machine does, via tools/volunteer-client.mjs.

type Builder = {
  id: string; displayName: string; tokenPrefix: string; enabled: boolean
  idleOnly: boolean; jobsDone: number; abandons: number; lastSeenAt: string | null
}

const box = 'rounded-lg border border-brass/40 hover:border-flame/60 px-3 py-1.5 font-mono text-[12px] tracking-[0.15em] text-steamer/80 hover:text-glow transition-all'

export default function LendAiPanel({ onClose }: { onClose: () => void }) {
  const [builders, setBuilders] = useState<Builder[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [freshToken, setFreshToken] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')

  const base = typeof window !== 'undefined' ? window.location.origin : 'https://cartridge.cafe'

  const load = () =>
    fetch('/api/builds/enroll').then(r => r.json()).then(r => {
      if (r?.builders) setBuilders(r.builders)
      else if (r?.error) setErr(r.error)
    }).catch(() => {})

  useEffect(() => {
    let alive = true
    fetch('/api/builds/enroll').then(r => r.json()).then(r => {
      if (!alive) return
      if (r?.builders) setBuilders(r.builders)
      else if (r?.error) setErr(r.error)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const enroll = async () => {
    setBusy(true); setErr('')
    const r = await fetch('/api/builds/enroll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name || 'my AI', idleOnly: true }),
    }).then(r => r.json()).catch(() => null)
    setBusy(false)
    if (r?.token) { setFreshToken(r.token); setName(''); load() }
    else setErr(r?.error || 'could not enroll')
  }

  const setEnabled = async (id: string, enabled: boolean) => {
    await fetch('/api/builds/enroll', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    }).catch(() => {})
    load()
  }
  const revoke = async (id: string) => {
    await fetch('/api/builds/enroll', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
    load()
  }

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(''), 1500) })
  }

  const runCmd = freshToken
    ? `CAFE_BASE=${base} CAFE_BUILDER_TOKEN=${freshToken} node volunteer-client.mjs`
    : ''

  return (
    <div className="fixed top-20 right-6 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-brass/40 bg-void/90 backdrop-blur-sm p-4 select-none">
      <div className="flex items-start justify-between mb-2">
        <div className="cafe-sign text-lg">lend your ai</div>
        <button onClick={onClose} aria-label="close"
          className="font-mono text-glow/50 hover:text-glow text-sm leading-none -mt-0.5 px-1">×</button>
      </div>
      <div className="font-mono text-[12px] text-glow/40 leading-relaxed mb-3">
        When your machine is idle, your AI builds worlds players asked for. It only
        talks to the cafe — one job at a time, stop anytime.
      </div>

      {freshToken ? (
        <div className="mb-3 space-y-2">
          <div className="font-mono text-[12px] text-flame tracking-[0.15em]">TOKEN — shown once, copy it now</div>
          <button onClick={() => copy(freshToken, 'tok')}
            className="w-full text-left rounded-md border border-brass/40 bg-black/40 px-2 py-1.5 font-mono text-[12px] text-steamer/90 break-all hover:border-flame/60">
            {freshToken}
          </button>
          <div className="font-mono text-[12px] text-glow/40">then run, from the cafe <code>tools/</code> dir:</div>
          <button onClick={() => copy(runCmd, 'cmd')}
            className="w-full text-left rounded-md border border-brass/40 bg-black/40 px-2 py-1.5 font-mono text-[12px] text-steamer/80 break-all hover:border-flame/60">
            {runCmd}
          </button>
          <div className="font-mono text-[12px] text-glow/50">{copied === 'tok' ? 'token copied ✓' : copied === 'cmd' ? 'command copied ✓' : ' '}</div>
          <button onClick={() => setFreshToken(null)} className={`${box} w-full text-center`}>done</button>
        </div>
      ) : (
        <div className="mb-3 flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="name your AI (e.g. Ada's GPT-5)"
            className="flex-1 rounded-md border border-brass/40 bg-black/40 px-2 py-1.5 font-mono text-[12px] text-steamer/90 placeholder:text-glow/25 focus:border-flame/60 outline-none" />
          <button disabled={busy} onClick={enroll}
            className="rounded-md bg-flame hover:bg-glow px-3 py-1.5 font-mono text-[12px] tracking-[0.15em] text-void font-bold transition-all disabled:opacity-50">
            {busy ? '…' : 'LEND'}
          </button>
        </div>
      )}

      {err && <div className="font-mono text-[12px] text-red-400/80 mb-2">{err}</div>}

      {builders && builders.length > 0 && (
        <div className="space-y-1.5 border-t border-brass/20 pt-2">
          <div className="font-mono text-[12px] text-brass tracking-[0.2em] mb-1">YOUR BUILDERS</div>
          {builders.map(b => (
            <div key={b.id} className="flex items-center justify-between gap-2 font-mono text-[12px]">
              <div className="min-w-0">
                <div className="text-steamer/90 truncate">{b.displayName}</div>
                <div className="text-glow/35">{b.jobsDone} built{b.abandons ? ` · ${b.abandons} dropped` : ''} · {b.tokenPrefix}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEnabled(b.id, !b.enabled)} className={`${box} px-2 py-1`}>
                  {b.enabled ? 'PAUSE' : 'RESUME'}
                </button>
                <button onClick={() => revoke(b.id)} className="rounded-lg border border-red-500/40 hover:border-red-400 px-2 py-1 font-mono text-[12px] text-red-400/70 hover:text-red-400 transition-all">
                  STOP
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
