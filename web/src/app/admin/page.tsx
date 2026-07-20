'use client'

import { useEffect, useState } from 'react'

type W = { name: string; private: boolean; timestamp: number; builtBy: string }
type Branch = { base: string; label: string; versions: number; private: boolean; latest: string }
type Root = { name: string; private: boolean; builtBy: string; branches: Branch[]; space?: string }

/** The keeper's shelf — one row per WORLD, branches folded beneath their base,
 *  each toggle covering every version of what it names. */
export default function AdminPage() {
  const [roots, setRoots] = useState<Root[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [openRoot, setOpenRoot] = useState('')

  const load = () => {
    fetch('/api/admin/worlds').then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => {
        const ws: W[] = d.worlds
        const strip = (n: string) => n.replace(/ · v\d+$/, '')
        const rootMap = new Map<string, Root>()
        for (const w of ws) {
          if (!w.name.includes(' ⑂ ')) rootMap.set(w.name, { name: w.name, private: w.private, builtBy: w.builtBy, branches: [] })
        }
        const brMap = new Map<string, { base: string; rootName: string; versions: W[] }>()
        for (const w of ws) {
          if (!w.name.includes(' ⑂ ')) continue
          const base = strip(w.name)
          const rootName = w.name.split(' ⑂ ')[0]
          if (!brMap.has(base)) brMap.set(base, { base, rootName, versions: [] })
          brMap.get(base)!.versions.push(w)
        }
        for (const b of brMap.values()) {
          const root = rootMap.get(b.rootName) ?? (() => { const r = { name: b.rootName, private: false, builtBy: '', branches: [] as Branch[] }; rootMap.set(b.rootName, r); return r })()
          const latest = b.versions.reduce((m, v) => {
            const vn = parseInt(v.name.slice(v.name.lastIndexOf(' · v') + 4), 10) || 0
            return vn > m.vn ? { vn, name: v.name } : m
          }, { vn: -1, name: b.versions[0].name })
          root.branches.push({ base: b.base, label: b.base.split(' ⑂ ')[1] ?? b.base, versions: b.versions.length, private: b.versions.every(v => v.private), latest: latest.name })
        }
        // player spaces sit on the same shelf — their visibility is the isPublic column
        for (const s of (d.spaces ?? []) as { slug: string; name: string; private: boolean; owner: string }[]) {
          rootMap.set('space:' + s.slug, { name: s.name, private: s.private, builtBy: s.owner ? `space · ${s.owner}` : 'space', branches: [], space: s.slug })
        }
        setRoots([...rootMap.values()].sort((a, b) => a.name.localeCompare(b.name)))
      })
      .catch(e => setErr(e === 403 ? 'This room is for the keeper. Sign in with the keeper account.' : 'could not load the shelf'))
  }
  useEffect(load, [])

  const toggle = async (key: { name?: string; base?: string; space?: string }, priv: boolean) => {
    setBusy(key.name ?? key.base ?? key.space ?? '')
    await fetch('/api/admin/worlds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...key, private: priv }),
    }).catch(() => {})
    setBusy(''); load()
  }

  const del = async (key: { space?: string; name?: string }, label: string) => {
    if (!confirm(`Delete "${label}" permanently? This cannot be undone.`)) return
    setBusy(key.space ?? key.name ?? '')
    const r = await fetch('/api/admin/worlds', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(key),
    }).catch(() => null)
    if (r && !r.ok) alert('Delete failed: ' + (await r.text().catch(() => r.status)))
    setBusy(''); load()
  }

  const Hidden = () => (
    <span style={{ fontSize: 8, letterSpacing: '0.2em', color: '#ffb0b0', border: '1px solid rgba(255,120,120,0.45)', background: 'rgba(120,30,30,0.25)', borderRadius: 5, padding: '2px 6px' }}>HIDDEN</span>
  )

  const View = ({ scene, small }: { scene: string; small?: boolean }) => (
    <a href={scene.startsWith('space:') ? `/space/${scene.slice(6)}` : `/hub/${encodeURIComponent(scene)}`} target="_blank" rel="noreferrer" style={{
      fontFamily: 'inherit', fontSize: small ? 9 : 10, letterSpacing: '0.15em', textDecoration: 'none',
      padding: small ? '4px 10px' : '6px 14px', borderRadius: 8, whiteSpace: 'nowrap',
      border: '1px solid rgba(245,176,76,0.4)', background: 'rgba(185,122,42,0.12)', color: '#ffdba8',
    }}>VIEW</a>
  )

  const Btn = ({ priv, onClick, small }: { priv: boolean; onClick: () => void; small?: boolean }) => (
    <button onClick={onClick} style={{
      fontFamily: 'inherit', fontSize: small ? 9 : 10, letterSpacing: '0.15em', cursor: 'pointer',
      padding: small ? '4px 10px' : '6px 14px', borderRadius: 8, whiteSpace: 'nowrap',
      border: priv ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(120,220,140,0.5)',
      background: priv ? 'rgba(255,255,255,0.05)' : 'rgba(60,160,90,0.15)',
      color: priv ? '#c9b896' : '#9be3a8',
    }}>{priv ? 'PRIVATE — publish?' : 'ON MAIN — hide?'}</button>
  )

  const Del = ({ onClick, small }: { onClick: () => void; small?: boolean }) => (
    <button onClick={onClick} title="delete permanently" style={{
      fontFamily: 'inherit', fontSize: small ? 9 : 10, letterSpacing: '0.15em', cursor: 'pointer',
      padding: small ? '4px 9px' : '6px 11px', borderRadius: 8, whiteSpace: 'nowrap',
      border: '1px solid rgba(255,120,120,0.4)', background: 'rgba(120,30,30,0.2)', color: '#ffb0b0',
    }}>✕ DELETE</button>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0b0908', color: '#e7dcc8', fontFamily: 'monospace', padding: '40px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ fontSize: 26, fontStyle: 'italic', color: '#ffdba8', marginBottom: 4 }}>the keeper&rsquo;s shelf</div>
        <div style={{ fontSize: 11, color: '#c9b89680', marginBottom: 28 }}>
          One row per world. A branch&rsquo;s switch covers all its versions. PRIVATE = unlisted everywhere; the direct /hub link still works.
        </div>
        {err && <div style={{ color: '#ff8080', fontSize: 13 }}>{err}</div>}
        {!err && !roots && <div style={{ color: '#c9b896', fontSize: 12 }}>fetching the shelf…</div>}
        {roots && roots.map(r => (
          <div key={r.name} style={{ marginBottom: 6 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px',
              border: '1px solid rgba(185,122,42,0.25)', borderRadius: 10,
              background: r.private ? 'rgba(20,14,10,0.9)' : 'rgba(28,22,14,0.6)', opacity: r.private ? 0.65 : 1,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                {r.builtBy && <div style={{ fontSize: 9, color: '#c9b89660' }}>{r.builtBy}</div>}
              </div>
              {r.private && <Hidden />}
              {r.branches.length > 0 && (
                <button onClick={() => setOpenRoot(openRoot === r.name ? '' : r.name)} style={{
                  fontFamily: 'inherit', fontSize: 9, color: '#c9b896', background: 'none',
                  border: '1px solid rgba(185,122,42,0.3)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                }}>{openRoot === r.name ? '▾' : '▸'} {r.branches.length} branch{r.branches.length > 1 ? 'es' : ''}</button>
              )}
              <View scene={r.space ? 'space:' + r.space : r.name} />
              {busy === (r.space ?? r.name) ? <span style={{ fontSize: 10 }}>…</span> : <>
                <Btn priv={r.private} onClick={() => toggle(r.space ? { space: r.space } : { name: r.name }, !r.private)} />
                <Del onClick={() => del(r.space ? { space: r.space } : { name: r.name }, r.name)} />
              </>}
            </div>
            {openRoot === r.name && r.branches.map(b => (
              <div key={b.base} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', margin: '4px 0 0 26px',
                border: '1px solid rgba(185,122,42,0.15)', borderRadius: 8,
                background: b.private ? 'rgba(20,14,10,0.8)' : 'rgba(24,19,13,0.5)', opacity: b.private ? 0.6 : 0.95,
              }}>
                <div style={{ flex: 1, fontSize: 11, color: '#d8cbb2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ⑂ {b.label} <span style={{ color: '#c9b89650', fontSize: 9 }}>· {b.versions} version{b.versions > 1 ? 's' : ''}</span>
                </div>
                {b.private && <Hidden />}
                <View small scene={b.latest} />
                {busy === b.base ? <span style={{ fontSize: 10 }}>…</span> : <>
                  <Btn small priv={b.private} onClick={() => toggle({ base: b.base }, !b.private)} />
                  <Del small onClick={() => del({ name: b.base }, b.label)} />
                </>}
              </div>
            ))}
          </div>
        ))}
        <div style={{ marginTop: 26, fontSize: 9, letterSpacing: '0.25em', color: 'rgba(245,176,76,0.4)' }}>CARTRIDGE.CAFE · KEEPER ONLY</div>
      </div>
    </div>
  )
}
