'use client'

// ⛨ THE KEEPER'S ROOM — redone in the grid's language (Galen, Aug 29: "redo
// the admin page to update to modern ui"). Same APIs, same powers, new shape:
//   · WORLDS (player spaces) lead — the real shelf, searchable.
//   · THE SCENE LIBRARY (legacy store scenes — bases, tests, the pre-space
//     era) folds closed: it's a LIBRARY now, not clutter on the shelf.
//   · VIEW opens THE GRID (the /hub viewer is gone — scenes load by name via
//     the engine's scene fallback; spaces via ?w=space:<slug>).
//   · AT A GLANCE · BRIDGE WATCH · FAULTS kept whole, restyled.
import { useEffect, useMemo, useState } from 'react'

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

const box = 'rounded-2xl border border-white/12 bg-black/40'
const chip = 'font-mono text-[10px] tracking-[0.18em] px-2.5 py-1 rounded-lg border transition-colors'

export default function AdminPage() {
  const [roots, setRoots] = useState<Root[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [openRoot, setOpenRoot] = useState('')
  const [libOpen, setLibOpen] = useState(false)
  const [q, setQ] = useState('')
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [faults, setFaults] = useState<FaultReport[] | null>(null)
  const [faultFilter, setFaultFilter] = useState('')
  // ◆ COMPANIES — proprietary/white-label tenants (provision + invoice)
  type CompanyRow = { handle: string; name: string; domain: string | null; ownerEmail: string; ownerName: string | null; ipControl: boolean; worlds: number; at: number }
  const [companies, setCompanies] = useState<CompanyRow[] | null>(null)
  const [coForm, setCoForm] = useState({ email: '', handle: '', name: '', domain: '' })
  const [coNote, setCoNote] = useState('')
  const loadCompanies = () => {
    fetch('/api/admin/company').then(r => r.ok ? r.json() : null)
      .then(d => setCompanies(Array.isArray(d?.companies) ? d.companies : []))
      .catch(() => setCompanies([]))
  }
  useEffect(loadCompanies, [])

  const loadFaults = () => {
    fetch('/api/engine/quarantine').then(r => r.ok ? r.json() : null)
      .then(d => setFaults(Array.isArray(d?.reports) ? [...d.reports].reverse() : []))
      .catch(() => setFaults([]))
  }

  useEffect(() => {
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
        for (const s of (d.spaces ?? []) as { slug: string; name: string; private: boolean; owner: string }[]) {
          rootMap.set('space:' + s.slug, { name: s.name, private: s.private, builtBy: s.owner ?? '', branches: [], space: s.slug })
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

  // THE MODERN VIEWERS — the grid is the one renderer now: a space rides
  // ?w=space:<slug>; a legacy scene loads BY NAME through the engine's scene
  // fallback. (The old /hub viewer is gone — its links were the "odd bug".)
  const viewHref = (r: { space?: string; name: string }) =>
    r.space ? `/grid?w=space:${encodeURIComponent(r.space)}&ui=games&ph=play`
      : `/grid?w=${encodeURIComponent(r.name)}&ui=games&ph=play`

  const { spaces, scenes } = useMemo(() => {
    const all = roots ?? []
    const needle = q.trim().toLowerCase()
    const hit = (r: Root) => !needle || r.name.toLowerCase().includes(needle) || (r.space ?? '').includes(needle) || r.builtBy.toLowerCase().includes(needle)
    return {
      spaces: all.filter(r => r.space && hit(r)),
      scenes: all.filter(r => !r.space && hit(r)),
    }
  }, [roots, q])

  const Row = ({ r, sub }: { r: Root; sub?: boolean }) => (
    <div className={`${box} flex items-center gap-3 px-3.5 py-2.5 mb-1.5 ${r.private ? 'opacity-60' : ''} ${sub ? 'ml-7' : ''}`}>
      <div className="flex-1 min-w-0 font-mono">
        <div className="text-[13px] text-white/90 truncate">{r.name}</div>
        <div className="text-[10px] text-white/40 truncate">
          {r.space ? `/space/${r.space}` : 'scene · legacy store'}{r.builtBy ? ` · ${r.builtBy}` : ''}
        </div>
      </div>
      {r.private && <span className={`${chip} border-red-400/40 bg-red-500/10 text-red-200/90`}>HIDDEN</span>}
      {r.branches.length > 0 && (
        <button onClick={() => setOpenRoot(openRoot === r.name ? '' : r.name)}
          className={`${chip} border-white/15 bg-black/40 text-white/60 hover:text-white`}>
          {openRoot === r.name ? '▾' : '▸'} {r.branches.length} ⑂
        </button>
      )}
      <a href={viewHref(r)} target="_blank" rel="noreferrer"
        className={`${chip} border-amber-300/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20`}>VIEW</a>
      {busy === (r.space ?? r.name) ? <span className="font-mono text-[11px] text-white/60">…</span> : <>
        <button onClick={() => toggle(r.space ? { space: r.space } : { name: r.name }, !r.private)}
          className={`${chip} ${r.private ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20' : 'border-white/20 bg-white/5 text-white/70 hover:text-white'}`}>
          {r.private ? 'PUBLISH' : 'HIDE'}
        </button>
        <button onClick={() => del(r.space ? { space: r.space } : { name: r.name }, r.name)} title="delete permanently"
          className={`${chip} border-red-400/40 bg-red-500/10 text-red-200/90 hover:bg-red-500/20`}>✕</button>
      </>}
    </div>
  )

  const BranchRow = ({ b }: { b: Branch }) => (
    <div className={`${box} flex items-center gap-3 px-3.5 py-2 mb-1.5 ml-7 ${b.private ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0 font-mono text-[12px] text-white/75 truncate">
        ⑂ {b.label} <span className="text-white/35 text-[10px]">· {b.versions} version{b.versions > 1 ? 's' : ''}</span>
      </div>
      {b.private && <span className={`${chip} border-red-400/40 bg-red-500/10 text-red-200/90`}>HIDDEN</span>}
      <a href={`/grid?w=${encodeURIComponent(b.latest)}&ui=games&ph=play`} target="_blank" rel="noreferrer"
        className={`${chip} border-amber-300/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20`}>VIEW</a>
      {busy === b.base ? <span className="font-mono text-[11px] text-white/60">…</span> : <>
        <button onClick={() => toggle({ base: b.base }, !b.private)}
          className={`${chip} ${b.private ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20' : 'border-white/20 bg-white/5 text-white/70 hover:text-white'}`}>
          {b.private ? 'PUBLISH' : 'HIDE'}
        </button>
        <button onClick={() => del({ name: b.base }, b.label)} className={`${chip} border-red-400/40 bg-red-500/10 text-red-200/90 hover:bg-red-500/20`}>✕</button>
      </>}
    </div>
  )

  const Stat = ({ label, value }: { label: string; value: number }) => (
    <div className={`${box} px-3.5 py-2 min-w-[96px]`}>
      <div className="font-mono text-[20px] text-amber-100/95">{value.toLocaleString()}</div>
      <div className="font-mono text-[9px] tracking-[0.18em] text-white/40">{label}</div>
    </div>
  )

  const fmtDur = (s: number) => (s >= 3600 ? (s / 3600).toFixed(1) + 'h' : s >= 60 ? Math.round(s / 60) + 'm' : Math.round(s) + 's')

  const Overview = () => {
    const a = analytics
    if (!stats && !a?.allTime) return null
    const label = (path: string) => { try { return decodeURIComponent(path.split('/').filter(Boolean).pop() || path) } catch { return path } }
    const worlds = new Map<string, { label: string; visitors?: number; newcomers?: number; median?: number; total?: number }>()
    for (const w of a?.worldPaths ?? []) { const l = label(w.path); worlds.set(l.toLowerCase(), { label: l, visitors: w.visitors, newcomers: w.newcomers }) }
    for (const p of a?.playtime ?? []) { const k = p.world.toLowerCase(); const e = worlds.get(k) ?? { label: p.world }; e.median = p.medianSeconds; e.total = p.totalSeconds; worlds.set(k, e) }
    const worldRows = [...worlds.values()].sort((x, y) => (y.newcomers ?? 0) - (x.newcomers ?? 0) || (y.total ?? 0) - (x.total ?? 0)).slice(0, 12)
    const win = a?.window?.hours ? `LAST ${a.window.hours}H` : 'RECENT'
    const refs = (a?.referrers ?? []).filter(r => r.source !== 'cartridge.cafe').slice(0, 8)
    return (
      <section className={`${box} p-4 mb-4`}>
        <div className="font-mono text-[10.5px] tracking-[0.2em] text-amber-200/80 mb-3">AT A GLANCE</div>
        <div className="flex flex-wrap gap-2 mb-2.5">
          {stats && <Stat label="ACCOUNTS" value={stats.users.rows_nonGuest} />}
          {stats && <Stat label="WORLDS" value={stats.worlds.total} />}
          {a?.allTime && <Stat label="VIEWS · ALL TIME" value={a.allTime.pages} />}
          {a?.allTime && <Stat label="VISITORS ≤" value={a.allTime.visitorDays} />}
          {a?.allTime && <Stat label="STRANGERS" value={a.allTime.strangerDays} />}
        </div>
        {a?.allTime?.since && (
          <div className="font-mono text-[9.5px] text-white/35 mb-4">
            since {new Date(a.allTime.since).toLocaleDateString()} · VISITORS ≤ counts distinct daily ids — an upper bound, not a head-count
          </div>
        )}
        {refs.length > 0 && (
          <>
            <div className="font-mono text-[9.5px] tracking-[0.18em] text-white/40 mb-1.5">WHERE THEY COME FROM · {win}</div>
            <div className="mb-4">
              {refs.map(r => (
                <div key={r.source} className="flex gap-2.5 py-1 border-b border-white/5 font-mono text-[11.5px]">
                  <span className={`flex-1 truncate ${r.source === '(direct)' ? 'text-white/45' : 'text-white/75'}`}>{r.source}</span>
                  <span className="text-white/70 w-24 text-right">{r.visitors.toLocaleString()} visitors</span>
                  <span className="text-white/35 w-16 text-right">{r.hits.toLocaleString()} hits</span>
                </div>
              ))}
            </div>
          </>
        )}
        {worldRows.length > 0 && (
          <>
            <div className="font-mono text-[9.5px] tracking-[0.18em] text-white/40 mb-1.5">WORLDS · {win} · newcomers &amp; how long they stay</div>
            {worldRows.map(w => (
              <div key={w.label} className="flex items-center gap-2.5 py-1 border-b border-white/5 font-mono text-[11.5px]">
                <span className="flex-1 truncate text-amber-100/90">{w.label}</span>
                <span className="text-emerald-300/90 w-16 text-right">{w.newcomers ?? 0} new</span>
                <span className="text-white/60 w-14 text-right">{w.visitors ?? '·'} vis</span>
                <span className="text-amber-200/90 w-20 text-right">{w.median != null ? fmtDur(w.median) + ' med' : '·'}</span>
              </div>
            ))}
          </>
        )}
      </section>
    )
  }

  const BridgeWatch = () => {
    if (!analytics) return null
    const { summary, bridgePerHour, topTalkers } = analytics
    const peak = Math.max(1, ...bridgePerHour.map(h => h.n))
    return (
      <section className={`${box} p-4 mb-4`}>
        <div className="font-mono text-[10.5px] tracking-[0.2em] text-amber-200/80 mb-3">TRAFFIC &amp; BRIDGE WATCH · LAST 48H</div>
        <div className="flex flex-wrap gap-2 mb-4">
          <Stat label="PAGE VIEWS" value={summary.pages} />
          <Stat label="UNIQUE STRANGERS" value={summary.strangerUniques} />
          <Stat label="AGENT / BRIDGE HITS" value={summary.agents} />
        </div>
        <div className="font-mono text-[9.5px] tracking-[0.18em] text-white/40 mb-1">BRIDGE HITS / HOUR (peak {peak.toLocaleString()})</div>
        <div className="flex items-end gap-[2px] h-12 mb-4">
          {bridgePerHour.length === 0 && <div className="font-mono text-[11px] text-white/40">no bridge traffic in the window</div>}
          {bridgePerHour.map(h => (
            <div key={h.hour} title={`${new Date(h.hour).toLocaleString()} — ${h.n.toLocaleString()} hits`}
              className={`flex-1 min-w-[2px] rounded-sm ${h.n >= peak * 0.9 ? 'bg-amber-400' : 'bg-amber-300/40'}`}
              style={{ height: `${Math.max(4, (h.n / peak) * 100)}%` }} />
          ))}
        </div>
        <div className="font-mono text-[9.5px] tracking-[0.18em] text-white/40 mb-1.5">TOP TALKERS · BY TOKEN · LAST 24H</div>
        {topTalkers.length === 0 && <div className="font-mono text-[11px] text-white/40">quiet — no agents in the last 24h</div>}
        {topTalkers.map(t => {
          const hot = t.hits >= HOT_TALKER && !t.who.startsWith('house')
          return (
            <div key={t.who} className="flex items-center gap-2.5 py-1 border-b border-white/5 font-mono text-[11.5px]">
              <span className={`w-36 truncate ${hot ? 'text-amber-300' : 'text-white/75'}`}>{hot && '⚠ '}{t.who}</span>
              <span className={`flex-1 ${hot ? 'text-amber-200' : 'text-white/60'}`}>{t.hits.toLocaleString()} hits</span>
              <span className="text-white/35 text-[10px]">last {new Date(t.last).toLocaleTimeString()}</span>
            </div>
          )
        })}
        <div className="font-mono text-[9px] text-white/30 mt-2">
          tags are type:hash (never the raw token). ⚠ = a non-house token over {HOT_TALKER.toLocaleString()} hits/24h — worth a look.
        </div>
      </section>
    )
  }

  const provision = async () => {
    if (!coForm.email.trim() || !coForm.handle.trim()) { setCoNote('email and handle are required'); return }
    setBusy('provision'); setCoNote('')
    try {
      const r = await fetch('/api/admin/company', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coForm),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) { setCoForm({ email: '', handle: '', name: '', domain: '' }); setCoNote(`✓ provisioned ${d.company?.handle} → ${d.ownerEmail}`); loadCompanies() }
      else setCoNote(d.error || 'provision failed')
    } finally { setBusy('') }
  }
  const deprovision = async (handle: string) => {
    if (!window.confirm(`Deprovision ${handle}? Releases the handle and revokes IP control (worlds are untouched).`)) return
    setBusy('deprov:' + handle)
    try {
      await fetch('/api/admin/company?handle=' + encodeURIComponent(handle), { method: 'DELETE' })
      loadCompanies()
    } finally { setBusy('') }
  }
  const invoice = async (handle: string, name: string) => {
    const amt = window.prompt(`Invoice ${name} — amount in USD (Stripe emails a net-30 invoice):`, '')
    if (!amt) return
    const desc = window.prompt('Line description:', `cartridge.cafe — ${name} white-label`) || `cartridge.cafe — ${name}`
    setBusy('inv:' + handle); setCoNote('')
    try {
      const r = await fetch('/api/admin/company/invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, amountUsd: Number(amt), description: desc }),
      })
      const d = await r.json().catch(() => ({}))
      setCoNote(r.ok ? `✓ invoice sent to ${d.sentTo}` : (d.error || 'invoice failed'))
    } finally { setBusy('') }
  }

  const Companies = () => (
    <section className={`${box} p-4 mb-4`}>
      <div className="font-mono text-[10.5px] tracking-[0.2em] text-amber-200/80 mb-1">◆ COMPANIES · PROPRIETARY TENANTS</div>
      <p className="font-mono text-[9.5px] text-white/40 mb-3">provision a white-label customer: bind a chosen handle to their account + grant IP control. they get /c/&lt;handle&gt; (and &lt;handle&gt;.cartridge.cafe once DNS is pointed). bill by Stripe invoice, net-30.</p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input value={coForm.email} onChange={e => setCoForm({ ...coForm, email: e.target.value })} placeholder="owner email (must have signed in once)"
          className="font-mono text-[12px] bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-white/85 outline-none focus:border-amber-300/50" />
        <input value={coForm.handle} onChange={e => setCoForm({ ...coForm, handle: e.target.value.toLowerCase() })} placeholder="handle (e.g. fortis)"
          className="font-mono text-[12px] bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-white/85 outline-none focus:border-amber-300/50" />
        <input value={coForm.name} onChange={e => setCoForm({ ...coForm, name: e.target.value })} placeholder="company name (FORTIS)"
          className="font-mono text-[12px] bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-white/85 outline-none focus:border-amber-300/50" />
        <input value={coForm.domain} onChange={e => setCoForm({ ...coForm, domain: e.target.value })} placeholder="custom domain (optional)"
          className="font-mono text-[12px] bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-white/85 outline-none focus:border-amber-300/50" />
      </div>
      <button onClick={provision} disabled={busy === 'provision'}
        className="font-mono text-[11px] tracking-[0.15em] px-4 py-2 rounded-lg border border-emerald-300/50 text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-40">
        {busy === 'provision' ? 'PROVISIONING…' : '✚ PROVISION COMPANY'}
      </button>
      {coNote && <div className="font-mono text-[11px] text-amber-200/90 mt-2">{coNote}</div>}
      {companies && companies.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5">
          {companies.map(c => (
            <div key={c.handle} className="flex items-center gap-2 py-1.5 border-b border-white/5 font-mono text-[11.5px]">
              <a href={`/c/${c.handle}`} className={`w-28 truncate ${c.ipControl ? 'text-amber-100' : 'text-white/40'}`}>◆ {c.handle}</a>
              <span className="flex-1 truncate text-white/55">{c.ownerEmail} · {c.worlds} world{c.worlds === 1 ? '' : 's'}{c.domain ? ' · ' + c.domain : ''}{!c.ipControl && ' · ⚠ NO IP CTRL'}</span>
              <button onClick={() => invoice(c.handle, c.name)} disabled={busy === 'inv:' + c.handle}
                className="text-[10px] tracking-[0.12em] px-2 py-1 rounded border border-white/20 text-white/70 hover:bg-white/10 disabled:opacity-40">
                {busy === 'inv:' + c.handle ? '…' : 'INVOICE'}
              </button>
              <button onClick={() => deprovision(c.handle)} disabled={busy === 'deprov:' + c.handle}
                className="text-[10px] tracking-[0.12em] px-2 py-1 rounded border border-red-400/30 text-red-200/80 hover:bg-red-500/15 disabled:opacity-40">
                {busy === 'deprov:' + c.handle ? '…' : '✕'}
              </button>
            </div>
          ))}
        </div>
      )}
      {companies && companies.length === 0 && <div className="font-mono text-[11px] text-white/35 mt-3">no companies provisioned yet.</div>}
    </section>
  )

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }}>
      <div className="max-w-[860px] mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <a href="/grid" className="font-mono text-[13px] w-9 h-9 grid place-items-center rounded-xl border bg-black/60 border-white/20 text-white/75 hover:text-white transition-colors">◂</a>
          <h1 className="font-mono text-[18px] tracking-[0.25em] text-amber-100/95">⛨ THE KEEPER&rsquo;S ROOM</h1>
        </div>
        <p className="font-mono text-[11px] text-white/40 mb-5 ml-12">every world · visibility · the bridge · faults from the field. HIDDEN = unlisted everywhere.</p>

        <Overview />
        <BridgeWatch />
        <Companies />

        {err && <div className="font-mono text-[13px] text-red-300">{err}</div>}
        {!err && !roots && <div className="font-mono text-[12px] text-white/50">fetching the shelf…</div>}

        {roots && (
          <>
            {/* ── WORLDS — the real shelf (player spaces) ── */}
            <div className="flex items-center gap-3 mb-2 mt-2">
              <div className="font-mono text-[10.5px] tracking-[0.2em] text-amber-200/80 shrink-0">WORLDS · {spaces.length}</div>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter worlds, scenes, makers…"
                className="flex-1 font-mono text-[11.5px] px-3 py-1.5 rounded-lg bg-black/50 border border-white/15 text-white/85 placeholder:text-white/30 outline-none focus:border-amber-300/50" />
            </div>
            {spaces.map(r => <Row key={'space:' + r.space} r={r} />)}
            {spaces.length === 0 && <div className="font-mono text-[11px] text-white/40 mb-3">no worlds match.</div>}

            {/* ── THE SCENE LIBRARY — the legacy store, folded (bases · tests ·
                the pre-space era). Useful as a LIBRARY; never peers of the
                shelf. Deleting here is permanent, same as ever. ── */}
            <button onClick={() => setLibOpen(o => !o)}
              className={`${box} w-full flex items-center gap-3 px-3.5 py-2.5 mt-5 mb-2 text-left hover:border-white/25 transition-colors`}>
              <span className="font-mono text-[10.5px] tracking-[0.2em] text-white/60">{libOpen ? '▾' : '▸'} THE SCENE LIBRARY · {scenes.length}</span>
              <span className="font-mono text-[10px] text-white/35">legacy store scenes — bases, tests, the pre-space era. A library, not the shelf.</span>
            </button>
            {libOpen && scenes.map(r => (
              <div key={r.name}>
                <Row r={r} />
                {openRoot === r.name && r.branches.map(b => <BranchRow key={b.base} b={b} />)}
              </div>
            ))}
          </>
        )}

        {/* ── faults from the field ── */}
        {!err && (
          <div className="mt-10">
            <div className="flex items-baseline gap-3 mb-1">
              <div className="font-mono text-[13px] tracking-[0.2em] text-red-200/90 flex-1">FAULTS FROM THE FIELD</div>
              <button onClick={loadFaults} className={`${chip} border-white/15 bg-black/40 text-white/60 hover:text-white`}>↻ REFRESH</button>
            </div>
            <p className="font-mono text-[10.5px] text-white/40 mb-3">errors from real sessions, newest first — source-documented where the engine holds the source.</p>
            {faults && faults.length > 0 && (
              <input value={faultFilter} onChange={e => setFaultFilter(e.target.value)} placeholder="filter by scene, phase, hook, message…"
                className="w-full mb-3 font-mono text-[11.5px] px-3 py-2 rounded-lg bg-black/50 border border-white/15 text-white/85 placeholder:text-white/30 outline-none focus:border-amber-300/50" />
            )}
            {!faults && <div className="font-mono text-[12px] text-white/50">reading the log…</div>}
            {faults && faults.length === 0 && <div className="font-mono text-[12px] text-emerald-300/90">no faults logged — clean skies.</div>}
            {faults && faults.filter(f => {
              if (!faultFilter.trim()) return true
              const fq = faultFilter.toLowerCase()
              return (f.scene ?? '').toLowerCase().includes(fq) || (f.phase ?? '').toLowerCase().includes(fq) || (f.url ?? '').toLowerCase().includes(fq)
                || f.hazards.some(h => (h.name ?? '').toLowerCase().includes(fq) || (h.reason ?? '').toLowerCase().includes(fq) || (h.author ?? '').toLowerCase().includes(fq))
            }).map((f, i) => {
              const p = f.phase.replace(/^cc-fault:/, '')
              const tone = p === 'gpu-lost' ? 'bg-orange-400' : p === 'hook-error' ? 'bg-amber-300' : p === 'window-error' ? 'bg-purple-300' : p === 'owns-violation' ? 'bg-emerald-300' : p === 'node-benched' ? 'bg-orange-300' : p.includes('compile') || p === 'gpu-error' ? 'bg-rose-400' : 'bg-sky-300'
              return (
                <div key={i} className={`${box} px-3.5 py-2.5 mb-2 font-mono`}>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className={`text-[9px] tracking-[0.15em] text-black font-bold rounded px-1.5 py-0.5 ${tone}`}>{p.toUpperCase()}</span>
                    {f.scene && <span className="text-[12px] text-amber-100/90">{f.scene}</span>}
                    <span className="flex-1" />
                    <span className="text-[10px] text-white/40">{new Date(f.at).toLocaleString()}</span>
                  </div>
                  {f.url && <div className="text-[10px] text-white/35 mt-1 truncate">{f.url}</div>}
                  {f.hazards.map((h, j) => (
                    <div key={j} className="mt-2">
                      <div className="text-[12px] text-red-100/90">
                        {h.name && <span className="text-red-200 font-bold">{h.name}</span>}
                        {h.author && <span className="text-emerald-300/90 text-[10px]"> · by {h.author}</span>}
                        {typeof h.line === 'number' && h.line > 0 && <span className="text-white/45 text-[10px]"> · line {h.line}{typeof h.col === 'number' ? ':' + h.col : ''}</span>}
                        {h.gpuModel && <span className="text-white/45 text-[10px]"> · {h.gpuModel}</span>}
                      </div>
                      {h.reason && <div className="text-[11px] text-white/75 mt-0.5 whitespace-pre-wrap break-words">{h.reason}</div>}
                      {h.snippet && <pre className="text-[11px] text-white/70 bg-black/60 border border-white/10 rounded-lg px-2.5 py-2 mt-1.5 overflow-x-auto">{h.snippet}</pre>}
                      {!h.snippet && h.stack && <pre className="text-[10px] text-white/45 bg-black/50 border border-white/8 rounded-lg px-2.5 py-2 mt-1.5 overflow-x-auto whitespace-pre-wrap">{h.stack}</pre>}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        <div className="mt-7 font-mono text-[9.5px] tracking-[0.3em] text-amber-200/30">CARTRIDGE.CAFE · KEEPER ONLY</div>
      </div>
    </div>
  )
}
