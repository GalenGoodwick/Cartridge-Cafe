'use client'

import { useEffect, useState } from 'react'

type W = { name: string; private: boolean; timestamp: number; builtBy: string }

/** The keeper's shelf — every world, one switch: on main, or private. */
export default function AdminPage() {
  const [worlds, setWorlds] = useState<W[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  const load = () => {
    fetch('/api/admin/worlds').then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setWorlds(d.worlds))
      .catch(e => setErr(e === 403 ? 'This room is for the keeper. Sign in with the keeper account.' : 'could not load the shelf'))
  }
  useEffect(load, [])

  const toggle = async (w: W) => {
    setBusy(w.name)
    await fetch('/api/admin/worlds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: w.name, private: !w.private }),
    }).catch(() => {})
    setBusy(''); load()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0b0908', color: '#e7dcc8', fontFamily: 'monospace', padding: '40px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ fontSize: 26, fontStyle: 'italic', color: '#ffdba8', marginBottom: 4 }}>the keeper&rsquo;s shelf</div>
        <div style={{ fontSize: 11, color: '#c9b89680', marginBottom: 28 }}>
          PUBLIC worlds stand on main — the shelf, the arena, the constellation. PRIVATE worlds are unlisted everywhere; their direct /play link still works.
        </div>
        {err && <div style={{ color: '#ff8080', fontSize: 13 }}>{err}</div>}
        {!err && !worlds && <div style={{ color: '#c9b896', fontSize: 12 }}>fetching the shelf…</div>}
        {worlds && worlds.map(w => (
          <div key={w.name} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', marginBottom: 6,
            border: '1px solid rgba(185,122,42,0.25)', borderRadius: 10, background: w.private ? 'rgba(20,14,10,0.9)' : 'rgba(28,22,14,0.6)',
            opacity: w.private ? 0.65 : 1,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#e7dcc8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
              {w.builtBy && <div style={{ fontSize: 9, color: '#c9b89660' }}>{w.builtBy}</div>}
            </div>
            <button onClick={() => toggle(w)} disabled={busy === w.name} style={{
              fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.15em', cursor: 'pointer',
              padding: '6px 14px', borderRadius: 8,
              border: w.private ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(120,220,140,0.5)',
              background: w.private ? 'rgba(255,255,255,0.05)' : 'rgba(60,160,90,0.15)',
              color: w.private ? '#c9b896' : '#9be3a8',
            }}>
              {busy === w.name ? '…' : w.private ? 'PRIVATE — publish?' : 'ON MAIN — hide?'}
            </button>
          </div>
        ))}
        <div style={{ marginTop: 26, fontSize: 9, letterSpacing: '0.25em', color: 'rgba(245,176,76,0.4)' }}>CARTRIDGE.CAFE · KEEPER ONLY</div>
      </div>
    </div>
  )
}
