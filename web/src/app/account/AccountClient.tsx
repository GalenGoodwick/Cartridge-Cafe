'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'

const box = 'rounded-xl border border-[#b97a2a]/25 bg-[#0d0906]/70 p-5'
const h2 = 'font-mono text-[12px] tracking-[0.3em] text-amber-200/70 mb-3'
const btn = 'font-mono text-[13px] tracking-[0.12em] px-3.5 py-2 rounded-lg border transition-colors'

export default function AccountClient(p: {
  email: string
  name: string | null
  memberSince: string
  member: boolean
  hasSubscription: boolean
  renewsAt: number | null
  endsAt: number | null
  priceUsd: number
  buyable: boolean
  genCredits: number
  entitlements: string[]
  worldCount: number
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [delOpen, setDelOpen] = useState(false)
  const [delConfirm, setDelConfirm] = useState('')
  const [delResult, setDelResult] = useState<{ deletedWorlds: string[]; preservedWorlds: string[] } | null>(null)

  const post = async (path: string, body?: unknown) => {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    return { ok: r.ok, data: await r.json().catch(() => ({})) as { url?: string; error?: string; deletedWorlds?: string[]; preservedWorlds?: string[] } }
  }

  const portal = async () => {
    setBusy('portal'); setNote('')
    const { ok, data } = await post('/api/account/portal')
    if (ok && data.url) { window.location.href = data.url; return }
    setNote(data.error || 'could not open the billing portal'); setBusy(null)
  }
  const join = async () => {
    setBusy('join'); setNote('')
    const { ok, data } = await post('/api/membership')
    if (ok && data.url) { window.location.href = data.url; return }
    setNote(data.error || 'could not start the membership'); setBusy(null)
  }
  const doDelete = async () => {
    setBusy('delete'); setNote('')
    const { ok, data } = await post('/api/account/delete', { confirm: delConfirm })
    if (ok) {
      setDelResult({ deletedWorlds: data.deletedWorlds ?? [], preservedWorlds: data.preservedWorlds ?? [] })
      setTimeout(() => signOut({ callbackUrl: '/' }), 6000)
    } else {
      setNote(data.error || 'deletion failed'); setBusy(null)
    }
  }

  const fmt = (ms: number) => new Date(ms).toLocaleDateString()

  if (delResult) {
    return (
      <main className="min-h-screen" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
        <div className="mx-auto max-w-xl px-6 py-24 font-mono text-white/80">
          <h1 className="cafe-sign text-3xl text-glow mb-4">account deleted</h1>
          <p className="text-[15px] leading-relaxed mb-3">Your subscription is canceled, your sign-in methods are erased, and your personal data is gone.</p>
          {delResult.deletedWorlds.length > 0 && <p className="text-[13px] text-white/50 mb-2">worlds deleted: {delResult.deletedWorlds.join(', ')}</p>}
          {delResult.preservedWorlds.length > 0 && <p className="text-[13px] text-white/50 mb-2">preserved for their co-builders (no longer linked to you): {delResult.preservedWorlds.join(', ')}</p>}
          <p className="text-[13px] text-white/40 mt-6">signing you out…</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <div className="mx-auto max-w-2xl px-6 py-14 font-mono">
        <a href="/" className="text-[13px] tracking-[0.2em] text-amber-200/60 hover:text-amber-200">◂ cartridge.cafe</a>
        <h1 className="cafe-sign text-4xl text-glow mt-4 mb-8">account</h1>

        <div className="flex flex-col gap-5">
          {/* WHO */}
          <section className={box}>
            <h2 className={h2}>THIS ACCOUNT</h2>
            <div className="text-[15px] text-white/85">{p.email}</div>
            {p.name && <div className="text-[13px] text-white/45 mt-1">{p.name}</div>}
            <div className="text-[12px] text-white/35 mt-2">
              since {new Date(p.memberSince).toLocaleDateString()} · {p.worldCount} world{p.worldCount === 1 ? '' : 's'}
              {p.genCredits > 0 && <> · {p.genCredits} generation credit{p.genCredits === 1 ? '' : 's'}</>}
            </div>
          </section>

          {/* MEMBERSHIP */}
          <section className={box}>
            <h2 className={h2}>MEMBERSHIP</h2>
            {p.member ? (
              <>
                <div className="text-[15px] text-emerald-300/90 mb-1">● editing membership — active</div>
                {p.renewsAt && <div className="text-[12px] text-white/40">renews {fmt(p.renewsAt)} · ${p.priceUsd}/mo</div>}
                {p.endsAt && <div className="text-[12px] text-amber-200/70">cancels at period end — access until {fmt(p.endsAt)}</div>}
                {p.hasSubscription ? (
                  <button onClick={portal} disabled={busy !== null}
                    className={`${btn} mt-4 border-amber-300/50 text-amber-100 hover:bg-amber-400/15 disabled:opacity-40`}>
                    {busy === 'portal' ? '…' : 'MANAGE SUBSCRIPTION'}
                  </button>
                ) : (
                  <div className="text-[12px] text-white/40 mt-3">your seat is granted (no billing on this account)</div>
                )}
                <p className="text-[11.5px] leading-relaxed text-white/35 mt-3">
                  manage subscription opens Stripe&rsquo;s secure portal — update your card, download invoices, or cancel anytime.
                  canceling keeps your seat until the period ends; your worlds and credit stay yours forever.
                </p>
              </>
            ) : (
              <>
                <div className="text-[14px] text-white/60 mb-1">playing is free. the ${p.priceUsd}/mo editing membership is the seat to build on open building worlds.</div>
                {p.buyable
                  ? <button onClick={join} disabled={busy !== null}
                      className={`${btn} mt-3 border-cyan-300/50 text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-40`}>
                      {busy === 'join' ? '…' : `JOIN · $${p.priceUsd}/mo`}
                    </button>
                  : <div className="text-[12px] text-white/35 mt-2">payments are not configured on this deployment</div>}
              </>
            )}
            {p.entitlements.length > 0 && (
              <div className="text-[11.5px] text-white/30 mt-3">purchases on record: {p.entitlements.join(', ')}</div>
            )}
          </section>

          {/* DATA RIGHTS */}
          <section className={box}>
            <h2 className={h2}>YOUR DATA</h2>
            <p className="text-[13px] leading-relaxed text-white/55 mb-4">
              everything the cafe holds about you, yours to take or erase — see the{' '}
              <a href="/privacy" className="text-amber-200/80 hover:text-amber-200 underline decoration-dotted underline-offset-4">privacy policy</a>{' '}
              and <a href="/terms" className="text-amber-200/80 hover:text-amber-200 underline decoration-dotted underline-offset-4">terms</a>.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="/api/account/export"
                className={`${btn} border-white/20 text-white/75 hover:bg-white/10`}>
                ⬇ DOWNLOAD MY DATA
              </a>
              <button onClick={() => setDelOpen(true)}
                className={`${btn} border-red-400/40 text-red-200/90 hover:bg-red-500/15`}>
                ✕ DELETE MY ACCOUNT
              </button>
            </div>
            <p className="text-[11.5px] leading-relaxed text-white/35 mt-3">
              download = one JSON file of your profile, worlds, purchases, and community data (world code exports live in each world&rsquo;s cartridge export).
              deletion cancels billing immediately, erases your sign-in and personal data, and deletes your worlds — except public open-building
              worlds others have built on, which stay with the commons, no longer linked to you.
            </p>
          </section>

          <div className="flex items-center justify-between">
            <button onClick={() => signOut({ callbackUrl: '/' })} className="font-mono text-[12px] text-white/40 hover:text-white/70">sign out</button>
            <div className="text-[11px] text-white/25">questions: hello@cartridge.cafe</div>
          </div>

          {note && <div className="font-mono text-[13px] text-amber-200/90">{note}</div>}
        </div>
      </div>

      {/* DELETE CONFIRM — destructive, so it demands the email typed back */}
      {delOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => busy !== 'delete' && setDelOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-red-400/30 bg-[#100808]/97 p-6 font-mono" onClick={e => e.stopPropagation()}>
            <div className="text-red-300/90 tracking-[0.2em] text-[14px] mb-3">✕ DELETE THIS ACCOUNT</div>
            <p className="text-[13px] leading-relaxed text-white/60 mb-2">
              this cancels your subscription immediately, erases your sign-in and personal data, and deletes your worlds.
              public open-building worlds that others built on are preserved for their co-builders, unlinked from you.
            </p>
            <p className="text-[13px] text-white/60 mb-3">there is no undo. type <span className="text-white/90">{p.email}</span> to confirm:</p>
            <input value={delConfirm} onChange={e => setDelConfirm(e.target.value)} placeholder={p.email} autoFocus
              className="w-full bg-black/50 border border-white/15 rounded px-3 py-2 text-[14px] text-white/85 outline-none focus:border-red-300/50 mb-4" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelOpen(false)} disabled={busy === 'delete'}
                className={`${btn} border-white/20 text-white/70 hover:bg-white/10`}>keep my account</button>
              <button onClick={doDelete}
                disabled={busy === 'delete' || delConfirm.trim().toLowerCase() !== p.email.toLowerCase()}
                className={`${btn} border-red-400/50 bg-red-500/15 text-red-200 hover:bg-red-500/25 disabled:opacity-30`}>
                {busy === 'delete' ? 'deleting…' : 'DELETE FOREVER'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
