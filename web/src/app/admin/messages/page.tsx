'use client'
// /admin/messages — the keeper's inbox for the /contact form (the teams door).
// Session-authed like the rest of /admin; the API refuses anyone else.
import { useEffect, useState } from 'react'
import Link from 'next/link'

type Msg = { id: string; email: string; message: string; context: string | null; status: string; createdAt: string }

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState<Msg[] | null>(null)
  const [err, setErr] = useState('')

  const load = () => {
    fetch('/api/admin/messages').then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error || `${r.status}`)
      return r.json()
    }).then((j) => setMessages(j.messages)).catch((e) => setErr(e.message))
  }
  useEffect(load, [])

  const mark = async (id: string, status: string) => {
    await fetch('/api/admin/messages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    load()
  }

  return (
    <main className="min-h-screen bg-black text-white/85 font-mono">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link href="/admin" className="text-[13px] tracking-[0.2em] text-amber-300/80 hover:text-amber-200">◂ admin</Link>
        <h1 className="text-2xl tracking-[0.15em] mt-3 mb-6">✉ MESSAGES</h1>
        {err && <div className="text-red-300 text-[14px] mb-4">{err}</div>}
        {messages === null && !err && <div className="text-white/40">loading…</div>}
        {messages?.length === 0 && <div className="text-white/40">no messages yet — the teams door is quiet.</div>}
        <div className="flex flex-col gap-3">
          {messages?.map((m) => (
            <div key={m.id} className={`rounded-xl border p-4 ${m.status === 'NEW' ? 'border-amber-400/50 bg-amber-400/5' : 'border-white/15 bg-white/[0.03]'}`}>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="text-[15px] text-amber-100">{m.email}</div>
                <div className="text-[11px] tracking-[0.15em] text-white/40">
                  {new Date(m.createdAt).toLocaleString()} {m.context ? `· from ${m.context}` : ''}
                </div>
              </div>
              <p className="text-[14px] text-white/80 mt-2 whitespace-pre-wrap">{m.message}</p>
              <div className="mt-3 flex gap-2">
                <a href={`mailto:${m.email}`} className="text-[12px] tracking-[0.15em] px-3 py-1.5 rounded-lg border border-white/25 hover:border-white/50">REPLY ▸</a>
                {m.status === 'NEW'
                  ? <button onClick={() => mark(m.id, 'READ')} className="text-[12px] tracking-[0.15em] px-3 py-1.5 rounded-lg border border-white/25 hover:border-white/50">MARK READ</button>
                  : <button onClick={() => mark(m.id, 'NEW')} className="text-[12px] tracking-[0.15em] px-3 py-1.5 rounded-lg border border-white/15 text-white/40 hover:text-white/70">MARK UNREAD</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
