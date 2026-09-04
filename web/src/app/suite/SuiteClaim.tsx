'use client'

import { useState } from 'react'

/** ◈ CLAIM YOUR COMPANY DOOR — the self-serve half of the suite pathway.
 *  An active IP-control holder names the company and picks the handle that
 *  becomes /c/<handle> and <handle>.cartridge.cafe. Re-claiming moves the
 *  door (the old handle is released server-side). */
export default function SuiteClaim({ current }: { current: { handle: string; name: string } | null }) {
  const [handle, setHandle] = useState(current?.handle ?? '')
  const [name, setName] = useState(current?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const claim = async () => {
    setBusy(true); setNote('')
    try {
      const r = await fetch('/api/company/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, name }),
      })
      const j = await r.json()
      if (r.ok && j.company) { window.location.href = `/c/${j.company.handle}`; return }
      setNote(j.error || 'could not claim that handle')
    } catch { setNote('network hiccup — try again') }
    setBusy(false)
  }

  return (
    <div className="mt-4 pt-4 border-t border-white/10">
      <div className="text-[13px] tracking-[0.3em] text-amber-200/70 mb-3">
        {current ? '◈ YOUR COMPANY DOOR' : '◈ CLAIM YOUR COMPANY DOOR'}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="company name"
          spellCheck={false} maxLength={60}
          className="font-mono text-[13.5px] bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-white/85 placeholder:text-white/30 w-44" />
        <input value={handle} onChange={e => setHandle(e.target.value.toLowerCase())} placeholder="handle"
          spellCheck={false} maxLength={32}
          className="font-mono text-[13.5px] bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-white/85 placeholder:text-white/30 w-36" />
        <button onClick={claim} disabled={busy || !handle}
          className="font-mono text-[13.5px] tracking-[0.12em] px-3.5 py-2 rounded-lg border border-amber-300/50 text-amber-100 hover:bg-amber-400/15 disabled:opacity-40">
          {busy ? '…' : current ? 'MOVE THE DOOR' : 'CLAIM'}
        </button>
      </div>
      <p className="font-mono text-[12.5px] text-white/45 mt-2">
        {handle ? <>your door: <span className="text-amber-200/80">{handle}.cartridge.cafe</span> · /c/{handle}</> : 'a–z, 0–9 and dashes — this becomes your subdomain.'}
      </p>
      {note && <p className="font-mono text-[12.5px] text-rose-300/80 mt-2">{note}</p>}
    </div>
  )
}
