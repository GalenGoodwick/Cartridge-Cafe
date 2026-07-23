'use client'

import { useEffect, useState } from 'react'
import { copyText } from '@/lib/copyText'

// "Volunteer AI time" control panel (DESIGN-builder-swarm.md §7). Enroll your AI
// as a swarm builder → get a paste-to-your-AI connection prompt (token inside).
// The browser doesn't run the AI; your AI does the work over plain HTTP.

type Builder = {
  id: string; displayName: string; tokenPrefix: string; enabled: boolean
  idleOnly: boolean; jobsDone: number; abandons: number; lastSeenAt: string | null
}

const box = 'rounded-lg border border-brass/40 hover:border-flame/60 px-3 py-1.5 font-mono text-[14px] tracking-[0.15em] text-steamer/80 hover:text-glow transition-all'

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
    else setErr(r?.error || 'could not enroll — try again in a moment')
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
    copyText(text).then(ok => { setCopied(ok ? key : 'fail:' + key); setTimeout(() => setCopied(''), ok ? 1800 : 2400) })
  }

  // Paste-to-your-AI connection prompt (mirrors the world Connect-AI flow): token
  // embedded, your AI becomes a volunteer builder. No script to install.
  const connectPrompt = freshToken
    ? `Be a volunteer builder on cartridge.cafe — build worlds other people asked for, while you're free.
Base: ${base}
Header on every request: Authorization: Bearer ${freshToken}

First: GET ${base}/api/engine/guide and read it fully (markdown) — it is how to build.
Then loop, ONE job at a time, only while you are idle:
1. GET ${base}/api/builds/next -> a job {id, spaceSlug, brief} or {job:null}. If null, wait ~20s and poll again.
2. POST ${base}/api/builds/<id>/claim -> {token, leaseMs}. If not ok, skip it.
3. Build the brief with THAT token against ${base}/api/engine/bridge — their words, not yours; skin every field (visualType or it renders as nothing); make it alive; set built_by to your model.
4. Every ~30s while building, POST ${base}/api/builds/<id>/heartbeat to hold your lease. If it returns ok:false, STOP — someone else took it.
5. Done: set worldData.brief_done=true, then POST ${base}/api/builds/<id>/complete. Stopping early: POST ${base}/api/builds/<id>/release.
Only ever call these endpoints. Never touch anything else on my machine.`
    : ''

  return (
    <div className="fixed top-20 right-6 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-brass/40 bg-void/90 backdrop-blur-sm p-4 select-none">
      <div className="flex items-start justify-between mb-2">
        <div className="cafe-sign text-lg">lend your ai</div>
        <button onClick={onClose} aria-label="close"
          className="font-mono text-glow/50 hover:text-glow text-sm leading-none -mt-0.5 px-1">×</button>
      </div>
      <div className="font-mono text-[14px] text-glow/40 leading-relaxed mb-3">
        When your AI is idle, it builds worlds players asked for. It only talks to
        the cafe — one job at a time, stop anytime.
      </div>

      {freshToken ? (
        <div className="mb-3 space-y-2">
          <div className="font-mono text-[14px] text-flame tracking-[0.15em]">PASTE THIS TO YOUR AI — token is inside, shown once</div>
          <button onClick={() => copy(connectPrompt, 'prompt')}
            className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 font-mono text-[14px] tracking-[0.15em] text-void font-bold transition-all">
            {copied === 'prompt' ? 'COPIED ✓' : copied === 'fail:prompt' ? '⚠ COPY BLOCKED — select the preview' : '📋 COPY PROMPT'}
          </button>
          <details className="font-mono text-[14px] text-glow/40" open={copied === 'fail:prompt' || undefined}>
            <summary className="cursor-pointer hover:text-glow/70">preview the prompt</summary>
            <div className="mt-1 rounded-md border border-brass/30 bg-black/40 px-2 py-1.5 text-[14px] text-steamer/70 whitespace-pre-wrap break-words max-h-32 overflow-y-auto select-text">{connectPrompt}</div>
          </details>
          <button onClick={() => setFreshToken(null)} className={`${box} w-full text-center`}>done</button>
        </div>
      ) : (
        <div className="mb-3 flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="name your AI (e.g. Ada's GPT-5)"
            className="flex-1 rounded-md border border-brass/40 bg-black/40 px-2 py-1.5 font-mono text-[14px] text-steamer/90 placeholder:text-glow/25 focus:border-flame/60 outline-none" />
          <button disabled={busy} onClick={enroll}
            className="rounded-md bg-flame hover:bg-glow px-3 py-1.5 font-mono text-[14px] tracking-[0.15em] text-void font-bold transition-all disabled:opacity-50">
            {busy ? '…' : 'LEND'}
          </button>
        </div>
      )}

      {err && <div className="font-mono text-[14px] text-red-400/80 mb-2">{err}</div>}

      {builders && builders.length > 0 && (
        <div className="space-y-1.5 border-t border-brass/20 pt-2">
          <div className="font-mono text-[14px] text-brass tracking-[0.2em] mb-1">YOUR BUILDERS</div>
          {builders.map(b => (
            <div key={b.id} className="flex items-center justify-between gap-2 font-mono text-[14px]">
              <div className="min-w-0">
                <div className="text-steamer/90 truncate">{b.displayName}</div>
                <div className="text-glow/35">{b.jobsDone} built{b.abandons ? ` · ${b.abandons} dropped` : ''} · {b.tokenPrefix}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEnabled(b.id, !b.enabled)} className={`${box} px-2 py-1`}>
                  {b.enabled ? 'PAUSE' : 'RESUME'}
                </button>
                <button onClick={() => revoke(b.id)} className="rounded-lg border border-red-500/40 hover:border-red-400 px-2 py-1 font-mono text-[14px] text-red-400/70 hover:text-red-400 transition-all">
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
