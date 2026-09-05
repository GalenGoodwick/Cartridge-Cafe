'use client'
// /contact — the teams door. Linked from the terms and the games bar; messages
// land on the keeper's /admin/messages page. Email is required: it is the reply path.
import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function ContactForm() {
  const params = useSearchParams()
  const context = params.get('from') || ''
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [err, setErr] = useState('')

  const send = async () => {
    setState('sending')
    try {
      const r = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, message, context }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'something went wrong'); setState('error'); return }
      setState('sent')
    } catch { setErr('network hiccup — try again'); setState('error') }
  }

  if (state === 'sent') {
    return (
      <div className="rounded-xl border border-brass/40 bg-black/30 p-6">
        <div className="text-[15px] tracking-[0.2em] text-flame mb-2">MESSAGE SENT</div>
        <p className="text-[17px] text-crema/80">Thank you. We read everything and reply by email.</p>
        <Link href="/" className="inline-block mt-4 text-[14px] tracking-[0.2em] text-brass hover:text-flame">◂ back to the cafe</Link>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-brass/40 bg-black/30 p-6">
      <label className="block text-[13px] tracking-[0.2em] text-crema/50 mb-1">YOUR EMAIL</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
        className="w-full bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-[16px] text-crema mb-4 outline-none focus:border-brass" />
      <label className="block text-[13px] tracking-[0.2em] text-crema/50 mb-1">YOUR MESSAGE</label>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6}
        placeholder="Teams, licensing, private development chambers, exhibits, anything."
        className="w-full bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-[16px] text-crema mb-4 outline-none focus:border-brass" />
      {state === 'error' && <div className="text-[14px] text-red-300 mb-3">{err}</div>}
      <button onClick={send} disabled={state === 'sending'}
        className="font-mono text-[14px] tracking-[0.25em] px-5 py-2.5 rounded-xl border bg-brass/20 border-brass/60 text-crema hover:bg-brass/30 disabled:opacity-50">
        {state === 'sending' ? 'SENDING…' : 'SEND ▸'}
      </button>
    </div>
  )
}

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-void text-crema/80" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <div className="mx-auto max-w-xl px-6 py-16 font-mono">
        <Link href="/" className="text-[14px] tracking-[0.2em] text-brass hover:text-flame">◂ cartridge.cafe</Link>
        <h1 className="cafe-sign text-4xl text-glow mt-5 mb-2">contact</h1>
        <p className="text-[17px] text-crema/70 mb-6">For teams, private development chambers, exhibits, and everything else with a person on the other end.</p>
        <Suspense fallback={null}><ContactForm /></Suspense>
      </div>
    </main>
  )
}
