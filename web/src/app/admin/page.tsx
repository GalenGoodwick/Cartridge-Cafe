'use client'

import { useEffect, useState } from 'react'

type W = { name: string; private: boolean; timestamp: number; builtBy: string }
type Branch = { base: string; label: string; versions: number; private: boolean; latest: string }
type Root = { name: string; private: boolean; builtBy: string; branches: Branch[]; space?: string }
type Talker = { who: string; hits: number; last: string }
type Analytics = {
  summary: { pages: number; strangerUniques: number; agents: number }
  bridgePerHour: { hour: string; n: number }[]
  topTalkers: Talker[]
  window?: { hours: number }
  allTime?: { pages: number; visitorDays: number; strangerDays: number; since: string | null }
  referrers?: { source: string; hits: number; visitors: number }[]
  worldPaths?: { path: string; hits: number; visitors: number; strangers: number; newcomers: number }[]
  playtime?: { world: string; scene: string; sessions: number; totalSeconds: number; medianSeconds: number; newcomerSeconds: number }[]
}
type Stats = {
  users: { rows_nonGuest: number; guests: number; newRows_7d: number }
  worlds: { total: number; public: number; new_7d: number }
}
type Hazard = { name?: string; reason?: string; phase?: string; line?: number; col?: number; snippet?: string; author?: string; gpuModel?: string; stack?: string }
type FaultReport = { at: string; phase: string; url?: string; scene?: string; hazards: Hazard[] }
// A non-house token doing more than this in 24h is worth a glance — well above
// the normal per-token build cadence, the shape a runaway loop would take.
const HOT_TALKER = 800

/** The keeper's shelf — one row per WORLD, branches folded beneath their base,
 *  each toggle covering every version of what it names. */
export default function AdminPage() {
  const [roots, setRoots] = useState<Root[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [openRoot, setOpenRoot] = useState('')
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [faults, setFaults] = useState<FaultReport[] | null>(null)
  const [faultFilter, setFaultFilter] = useState('')

  // fault log — errors gathered from real users' sessions, source-documented
  // where the engine holds the source (hooks, shaders, GPU loss). Newest first.
  const loadFaults = () => {
    fetch('/api/engine/quarantine').then(r => r.ok ? r.json() : null)
      .then(d => setFaults(Array.isArray(d?.reports) ? [...d.reports].reverse() : []))
      .catch(() => setFaults([]))
  }

  useEffect(() => {
    // one richer pull: 48h bridge watch + lifetime totals + traffic sources +
    // who-played-what over the last day (newcomers & playtime).
    fetch('/api/admin/analytics?paths=1&alltime=1&refs=1&hours=24').then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setAnalytics(d) }).catch(() => {})
    fetch('/api/admin/stats').then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setStats(d) }).catch(() => {})
    loadFaults()
  }, [])

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
    <span style={{ fontSize: 10, letterSpacing: '0.2em', color: '#ffb0b0', border: '1px solid rgba(255,120,120,0.45)', background: 'rgba(120,30,30,0.25)', borderRadius: 5, padding: '2px 6px' }}>HIDDEN</span>
  )

  const View = ({ scene, small }: { scene: string; small?: boolean }) => (
    <a href={scene.startsWith('space:') ? `/space/${scene.slice(6)}` : `/hub/${encodeURIComponent(scene)}`} target="_blank" rel="noreferrer" style={{
      fontFamily: 'inherit', fontSize: small ? 11 : 12, letterSpacing: '0.15em', textDecoration: 'none',
      padding: small ? '4px 10px' : '6px 14px', borderRadius: 8, whiteSpace: 'nowrap',
      border: '1px solid rgba(245,176,76,0.4)', background: 'rgba(185,122,42,0.12)', color: '#ffdba8',
    }}>VIEW</a>
  )

  const Btn = ({ priv, onClick, small }: { priv: boolean; onClick: () => void; small?: boolean }) => (
    <button onClick={onClick} style={{
      fontFamily: 'inherit', fontSize: small ? 11 : 12, letterSpacing: '0.15em', cursor: 'pointer',
      padding: small ? '4px 10px' : '6px 14px', borderRadius: 8, whiteSpace: 'nowrap',
      border: priv ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(120,220,140,0.5)',
      background: priv ? 'rgba(255,255,255,0.05)' : 'rgba(60,160,90,0.15)',
      color: priv ? '#c9b896' : '#9be3a8',
    }}>{priv ? 'PRIVATE — publish?' : 'ON MAIN — hide?'}</button>
  )

  const Del = ({ onClick, small }: { onClick: () => void; small?: boolean }) => (
    <button onClick={onClick} title="delete permanently" style={{
      fontFamily: 'inherit', fontSize: small ? 11 : 12, letterSpacing: '0.15em', cursor: 'pointer',
      padding: small ? '4px 9px' : '6px 11px', borderRadius: 8, whiteSpace: 'nowrap',
      border: '1px solid rgba(255,120,120,0.4)', background: 'rgba(120,30,30,0.2)', color: '#ffb0b0',
    }}>✕ DELETE</button>
  )

  const Stat = ({ label, value }: { label: string; value: number }) => (
    <div style={{ padding: '8px 14px', border: '1px solid rgba(185,122,42,0.25)', borderRadius: 10, background: 'rgba(28,22,14,0.6)', minWidth: 96 }}>
      <div style={{ fontSize: 22, color: '#ffdba8' }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#c9b89670' }}>{label}</div>
    </div>
  )

  const fmtDur = (s: number) => (s >= 3600 ? (s / 3600).toFixed(1) + 'h' : s >= 60 ? Math.round(s / 60) + 'm' : Math.round(s) + 's')

  // AT A GLANCE — accounts, lifetime reach, where traffic comes from, and which
  // worlds newcomers played + how long they stayed. Merges worldPaths (visits,
  // newcomers) with playtime (sessions, median dwell) keyed by the world label.
  const Overview = () => {
    const a = analytics
    if (!stats && !a?.allTime) return null
    const label = (path: string) => { try { return decodeURIComponent(path.split('/').filter(Boolean).pop() || path) } catch { return path } }
    const worlds = new Map<string, { label: string; visitors?: number; newcomers?: number; median?: number; total?: number }>()
    for (const w of a?.worldPaths ?? []) { const l = label(w.path); worlds.set(l.toLowerCase(), { label: l, visitors: w.visitors, newcomers: w.newcomers }) }
    for (const p of a?.playtime ?? []) { const k = p.world.toLowerCase(); const e = worlds.get(k) ?? { label: p.world }; e.median = p.medianSeconds; e.total = p.totalSeconds; worlds.set(k, e) }
    const worldRows = [...worlds.values()].sort((x, y) => (y.newcomers ?? 0) - (x.newcomers ?? 0) || (y.total ?? 0) - (x.total ?? 0)).slice(0, 12)
    const win = a?.window?.hours ? `LAST ${a.window.hours}H` : 'RECENT'
    const refs = (a?.referrers ?? []).filter(r => r.source !== 'cartridge.cafe').slice(0, 8)   // drop internal nav
    return (
      <div style={{ marginBottom: 30, padding: '16px 18px', border: '1px solid rgba(185,122,42,0.3)', borderRadius: 12, background: 'rgba(20,14,10,0.55)' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.2em', color: '#ffb25a', marginBottom: 12 }}>AT A GLANCE</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          {stats && <Stat label="ACCOUNTS" value={stats.users.rows_nonGuest} />}
          {stats && <Stat label="GUESTS" value={stats.users.guests} />}
          {stats && <Stat label="WORLDS" value={stats.worlds.total} />}
          {a?.allTime && <Stat label="VIEWS · ALL TIME" value={a.allTime.pages} />}
          {a?.allTime && <Stat label="VISITORS ≤" value={a.allTime.visitorDays} />}
          {a?.allTime && <Stat label="STRANGERS" value={a.allTime.strangerDays} />}
        </div>
        {a?.allTime?.since && (
          <div style={{ fontSize: 10, color: '#c9b89655', marginBottom: 16 }}>
            since {new Date(a.allTime.since).toLocaleDateString()} · <b>VISITORS ≤</b> counts distinct daily ids (a returning person once per day) — an upper bound, not a head-count
          </div>
        )}
        {refs.length > 0 && (
          <>
            <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#c9b89660', marginBottom: 6 }}>WHERE THEY COME FROM · {win}</div>
            <div style={{ marginBottom: 16 }}>
              {refs.map(r => (
                <div key={r.source} style={{ display: 'flex', gap: 10, padding: '4px 4px', borderBottom: '1px solid rgba(185,122,42,0.1)' }}>
                  <span style={{ flex: 1, fontSize: 13, color: r.source === '(direct)' ? '#c9b89690' : '#d8cbb2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.source}</span>
                  <span style={{ fontSize: 13, color: '#c9b896', width: 88, textAlign: 'right' }}>{r.visitors.toLocaleString()} visitors</span>
                  <span style={{ fontSize: 11, color: '#c9b89660', width: 70, textAlign: 'right' }}>{r.hits.toLocaleString()} hits</span>
                </div>
              ))}
            </div>
          </>
        )}
        {worldRows.length > 0 && (
          <>
            <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#c9b89660', marginBottom: 6 }}>WORLDS · {win} · newcomers &amp; how long they stay</div>
            <div>
              {worldRows.map(w => (
                <div key={w.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 4px', borderBottom: '1px solid rgba(185,122,42,0.1)' }}>
                  <span style={{ flex: 1, fontSize: 13, color: '#ffdba8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.label}</span>
                  <span style={{ fontSize: 12, color: '#9be3a8', width: 62, textAlign: 'right' }}>{w.newcomers ?? 0} new</span>
                  <span style={{ fontSize: 12, color: '#c9b896', width: 58, textAlign: 'right' }}>{w.visitors ?? '·'} vis</span>
                  <span style={{ fontSize: 12, color: '#ffb25a', width: 78, textAlign: 'right' }}>{w.median != null ? fmtDur(w.median) + ' med' : '·'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  const BridgeWatch = () => {
    if (!analytics) return null
    const { summary, bridgePerHour, topTalkers } = analytics
    const peak = Math.max(1, ...bridgePerHour.map(h => h.n))
    return (
      <div style={{ marginBottom: 30, padding: '16px 18px', border: '1px solid rgba(185,122,42,0.3)', borderRadius: 12, background: 'rgba(20,14,10,0.55)' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.2em', color: '#ffb25a', marginBottom: 12 }}>TRAFFIC &amp; BRIDGE WATCH · LAST 48H</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <Stat label="PAGE VIEWS" value={summary.pages} />
          <Stat label="UNIQUE STRANGERS" value={summary.strangerUniques} />
          <Stat label="AGENT / BRIDGE HITS" value={summary.agents} />
        </div>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#c9b89660', marginBottom: 5 }}>BRIDGE HITS / HOUR (peak {peak.toLocaleString()})</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 48, marginBottom: 16 }}>
          {bridgePerHour.length === 0 && <div style={{ fontSize: 12, color: '#c9b89660' }}>no bridge traffic in the window</div>}
          {bridgePerHour.map(h => (
            <div key={h.hour} title={`${new Date(h.hour).toLocaleString()} — ${h.n.toLocaleString()} hits`}
              style={{ flex: 1, minWidth: 2, height: `${Math.max(3, (h.n / peak) * 100)}%`,
                background: h.n >= peak * 0.9 ? '#ff9a4a' : 'rgba(245,176,76,0.45)', borderRadius: 1 }} />
          ))}
        </div>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#c9b89660', marginBottom: 6 }}>TOP TALKERS · BY TOKEN · LAST 24H</div>
        {topTalkers.length === 0 && <div style={{ fontSize: 12, color: '#c9b89660' }}>quiet — no agents in the last 24h</div>}
        {topTalkers.map(t => {
          const hot = t.hits >= HOT_TALKER && !t.who.startsWith('house')
          return (
            <div key={t.who} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 4px', borderBottom: '1px solid rgba(185,122,42,0.1)' }}>
              <span style={{ fontSize: 13, color: hot ? '#ff9a4a' : '#d8cbb2', width: 130 }}>{hot && '⚠ '}{t.who}</span>
              <span style={{ flex: 1, fontSize: 13, color: hot ? '#ffb25a' : '#c9b896' }}>{t.hits.toLocaleString()} hits</span>
              <span style={{ fontSize: 11, color: '#c9b89660' }}>last {new Date(t.last).toLocaleTimeString()}</span>
            </div>
          )
        })}
        <div style={{ fontSize: 10, color: '#c9b89650', marginTop: 8 }}>
          tags are type:hash (never the raw token). ⚠ = a non-house token over {HOT_TALKER.toLocaleString()} hits/24h — worth a look.
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0b0908', color: '#e7dcc8', fontFamily: 'monospace', padding: '40px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ fontSize: 31, fontStyle: 'italic', color: '#ffdba8', marginBottom: 4 }}>the keeper&rsquo;s shelf</div>
        <div style={{ fontSize: 13, color: '#c9b89680', marginBottom: 28 }}>
          One row per world. A branch&rsquo;s switch covers all its versions. PRIVATE = unlisted everywhere; the direct /hub link still works.
        </div>
        <Overview />
        <BridgeWatch />
        {err && <div style={{ color: '#ff8080', fontSize: 16 }}>{err}</div>}
        {!err && !roots && <div style={{ color: '#c9b896', fontSize: 14 }}>fetching the shelf…</div>}
        {roots && roots.map(r => (
          <div key={r.space ? 'space:' + r.space : r.name} style={{ marginBottom: 6 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px',
              border: '1px solid rgba(185,122,42,0.25)', borderRadius: 10,
              background: r.private ? 'rgba(20,14,10,0.9)' : 'rgba(28,22,14,0.6)', opacity: r.private ? 0.65 : 1,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                {/* show the slug on player-space rows so same-named spaces (the veilfire-3d twins) are distinguishable — the row used to show only the display name */}
                {r.space && <div style={{ fontSize: 11, color: '#c9b896', opacity: 0.55, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>/space/{r.space}</div>}
                {r.builtBy && <div style={{ fontSize: 11, color: '#c9b89660' }}>{r.builtBy}</div>}
              </div>
              {r.private && <Hidden />}
              {r.branches.length > 0 && (
                <button onClick={() => setOpenRoot(openRoot === r.name ? '' : r.name)} style={{
                  fontFamily: 'inherit', fontSize: 11, color: '#c9b896', background: 'none',
                  border: '1px solid rgba(185,122,42,0.3)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                }}>{openRoot === r.name ? '▾' : '▸'} {r.branches.length} branch{r.branches.length > 1 ? 'es' : ''}</button>
              )}
              <View scene={r.space ? 'space:' + r.space : r.name} />
              {busy === (r.space ?? r.name) ? <span style={{ fontSize: 12 }}>…</span> : <>
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
                <div style={{ flex: 1, fontSize: 13, color: '#d8cbb2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ⑂ {b.label} <span style={{ color: '#c9b89650', fontSize: 11 }}>· {b.versions} version{b.versions > 1 ? 's' : ''}</span>
                </div>
                {b.private && <Hidden />}
                <View small scene={b.latest} />
                {busy === b.base ? <span style={{ fontSize: 12 }}>…</span> : <>
                  <Btn small priv={b.private} onClick={() => toggle({ base: b.base }, !b.private)} />
                  <Del small onClick={() => del({ name: b.base }, b.label)} />
                </>}
              </div>
            ))}
          </div>
        ))}
        {/* ── fault log: every error gathered from real sessions ────────── */}
        {!err && (
          <div style={{ marginTop: 44 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
              <div style={{ fontSize: 24, fontStyle: 'italic', color: '#ffb0a8', flex: 1 }}>faults from the field</div>
              <button onClick={loadFaults} style={{ fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.15em', color: '#c9b896', background: 'none', border: '1px solid rgba(185,122,42,0.3)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>↻ REFRESH</button>
            </div>
            <div style={{ fontSize: 13, color: '#c9b89680', marginBottom: 16 }}>
              Errors reported by real users&rsquo; sessions, newest first — source-documented where the engine holds the source.
            </div>
            {faults && faults.length > 0 && (
              <input value={faultFilter} onChange={e => setFaultFilter(e.target.value)} placeholder="filter by scene, phase, hook, message…"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 14, fontFamily: 'inherit', fontSize: 13, color: '#e7dcc8', background: 'rgba(20,14,10,0.8)', border: '1px solid rgba(185,122,42,0.25)', borderRadius: 8, padding: '8px 12px' }} />
            )}
            {!faults && <div style={{ color: '#c9b896', fontSize: 14 }}>reading the log…</div>}
            {faults && faults.length === 0 && <div style={{ color: '#9be3a8', fontSize: 14 }}>no faults logged — clean skies.</div>}
            {faults && faults.filter(f => {
              if (!faultFilter.trim()) return true
              const q = faultFilter.toLowerCase()
              return (f.scene ?? '').toLowerCase().includes(q) || (f.phase ?? '').toLowerCase().includes(q) || (f.url ?? '').toLowerCase().includes(q)
                || f.hazards.some(h => (h.name ?? '').toLowerCase().includes(q) || (h.reason ?? '').toLowerCase().includes(q) || (h.author ?? '').toLowerCase().includes(q))
            }).map((f, i) => {
              const p = f.phase.replace(/^cc-fault:/, '')   // faults arrive prefixed by the forwarder
              const phaseColor = p === 'gpu-lost' ? '#ff8a6a' : p === 'hook-error' ? '#ffcf6a' : p === 'window-error' ? '#d98aff' : p === 'owns-violation' ? '#6ad9a0' : p === 'node-benched' ? '#ffa94d' : p.includes('compile') || p === 'gpu-error' ? '#ff6a9a' : '#8ab4ff'
              return (
                <div key={i} style={{ marginBottom: 8, border: '1px solid rgba(185,122,42,0.2)', borderRadius: 10, background: 'rgba(24,16,12,0.7)', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, letterSpacing: '0.15em', color: '#1a1109', background: phaseColor, borderRadius: 5, padding: '2px 7px', fontWeight: 700 }}>{p.toUpperCase()}</span>
                    {f.scene && <span style={{ fontSize: 13, color: '#ffdba8' }}>{f.scene}</span>}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: '#c9b89670' }}>{new Date(f.at).toLocaleString()}</span>
                  </div>
                  {f.url && <div style={{ fontSize: 11, color: '#c9b89660', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.url}</div>}
                  {f.hazards.map((h, j) => (
                    <div key={j} style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 13, color: '#ffd0c8' }}>
                        {h.name && <span style={{ color: '#ffb0a8', fontWeight: 700 }}>{h.name}</span>}
                        {h.author && <span style={{ color: '#9be3a8', fontSize: 11 }}> · by {h.author}</span>}
                        {typeof h.line === 'number' && h.line > 0 && <span style={{ color: '#c9b89680', fontSize: 11 }}> · line {h.line}{typeof h.col === 'number' ? ':' + h.col : ''}</span>}
                        {h.gpuModel && <span style={{ color: '#c9b89680', fontSize: 11 }}> · {h.gpuModel}</span>}
                      </div>
                      {h.reason && <div style={{ fontSize: 12, color: '#e7dcc8cc', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{h.reason}</div>}
                      {h.snippet && <pre style={{ fontSize: 12, color: '#d8cbb2', background: 'rgba(10,7,5,0.7)', border: '1px solid rgba(185,122,42,0.15)', borderRadius: 6, padding: '8px 10px', marginTop: 6, overflowX: 'auto', whiteSpace: 'pre' }}>{h.snippet}</pre>}
                      {!h.snippet && h.stack && <pre style={{ fontSize: 11, color: '#c9b89699', background: 'rgba(10,7,5,0.5)', border: '1px solid rgba(185,122,42,0.1)', borderRadius: 6, padding: '8px 10px', marginTop: 6, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{h.stack}</pre>}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        <div style={{ marginTop: 26, fontSize: 11, letterSpacing: '0.25em', color: 'rgba(245,176,76,0.4)' }}>CARTRIDGE.CAFE · KEEPER ONLY</div>
      </div>
    </div>
  )
}
