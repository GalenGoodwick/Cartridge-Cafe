'use client'

import { useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import AccountBar from './AccountBar'

const box = 'rounded-xl border border-[#b97a2a]/25 bg-[#0d0906]/70 p-5'
const h2 = 'font-mono text-[13px] tracking-[0.3em] text-amber-200/70 mb-3'
const btn = 'font-mono text-[14px] tracking-[0.12em] px-3.5 py-2 rounded-lg border transition-colors'

/** THE INVITE (Galen, Sep 5: "I need this prompt on my admin account page") —
 *  the send-to-anyone onboarding text with a promo code baked in. Keeper-only
 *  surface below; mirrors ~/Desktop/cafe-invite-prompt.txt — update together. */
const inviteText = (code: string) => `━━━ CARTRIDGE.CAFE INVITE ━━━
The game platform where you and your AI build live GPU worlds together, in the browser.

ONE COMMAND (Claude Code, Cursor, any MCP client):

    claude mcp add cartridge-cafe -- npx -y cartridge-cafe-mcp

Then tell your AI: "set up cartridge.cafe with me." It creates your account with
you, and your first-ever AI registration gifts 30 days of membership + 2 world
builds automatically.

BONUS CODE (redeem at cartridge.cafe/account → PROMO CODE, once per account):

    ${code}

Playing every world is free forever: https://cartridge.cafe
`

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
  ipControl: boolean
  ipBuyable: boolean
  worldCount: number
  isAdmin: boolean
  memberUntil: number | null
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [delOpen, setDelOpen] = useState(false)
  const [delConfirm, setDelConfirm] = useState('')
  const [delResult, setDelResult] = useState<{ deletedWorlds: string[]; preservedWorlds: string[] } | null>(null)
  const [promoInput, setPromoInput] = useState('')
  const [inviteCopied, setInviteCopied] = useState('')
  const [promoNote, setPromoNote] = useState('')
  const [minted, setMinted] = useState<string | null>(null)
  const [codes, setCodes] = useState<Array<{ code: string; credits: number; memberDays: number; maxUses: number | null; used: number; permanent?: boolean }>>([])
  // ✚ BUILD CREDITS — moved here from the dockstar (Galen, Sep 5)
  const [buyQty, setBuyQty] = useState(1)
  // ◆ the company room link (Galen, Sep 5: 'on account page should be link to
  // personal page if they have it')
  const [myCompany, setMyCompany] = useState<{ handle: string; name?: string } | null>(null)
  useEffect(() => {
    fetch('/api/company/claim', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.company?.handle) setMyCompany(d.company) }).catch(() => {})
  }, [])
  const [bundle, setBundle] = useState<{ bundles: Record<number, number>; genUsd: number; free: boolean; buyable: boolean; credits: number } | null>(null)
  useEffect(() => {
    fetch('/api/generate').then(r => (r.ok ? r.json() : null))
      .then(g => g && setBundle({ bundles: g.bundles ?? { 1: 5, 3: 12, 5: 18, 10: 30 }, genUsd: g.priceUsd ?? 5, free: !!g.free, buyable: !!g.buyable, credits: g.credits ?? 0 }))
      .catch(() => {})
  }, [])
  const buyCredits = async () => {
    setBusy('credits'); setNote('')
    const { ok, data } = await post('/api/generate/buy', { qty: buyQty })
    if (ok && data.url) { window.location.href = data.url; return }
    setNote(data.error || 'could not open checkout'); setBusy(null)
  }
  useEffect(() => {
    if (!p.isAdmin) return
    fetch('/api/promo').then(r => (r.ok ? r.json() : null))
      .then(d => setCodes(Array.isArray(d?.codes) ? d.codes : [])).catch(() => {})
  }, [p.isAdmin, minted])

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
  const cancel = async () => {
    if (!window.confirm('Cancel your editing membership? Billing stops now; your seat lasts until the period ends.')) return
    setBusy('cancel'); setNote('')
    const { ok, data } = await post('/api/account/cancel')
    if (ok) { window.location.reload(); return }
    setNote(data.error || 'could not cancel — try MANAGE SUBSCRIPTION'); setBusy(null)
  }
  const join = async () => {
    setBusy('join'); setNote('')
    const { ok, data } = await post('/api/membership')
    if (ok && data.url) { window.location.href = data.url; return }
    setNote(data.error || 'could not start the membership'); setBusy(null)
  }
  const redeem = async () => {
    setBusy('redeem'); setPromoNote('')
    const { ok, data } = await post('/api/promo/redeem', { code: promoInput })
    if (ok) { window.location.reload(); return }
    setPromoNote(data.error || 'could not redeem that code'); setBusy(null)
  }
  const mint = async () => {
    setBusy('mint'); setPromoNote('')
    const r = await fetch('/api/promo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json().catch(() => ({})) as { code?: string; error?: string }
    if (r.ok && d.code) setMinted(d.code)
    else setPromoNote(d.error || 'could not mint a code')
    setBusy(null)
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
        <div className="mx-auto max-w-xl px-6 py-24 pb-28 font-mono text-white/80">
          <h1 className="cafe-sign text-3xl text-glow mb-4">account deleted</h1>
          <p className="text-[15px] leading-relaxed mb-3">Your subscription is canceled, your sign-in methods are erased, and your personal data is gone.</p>
          {delResult.deletedWorlds.length > 0 && <p className="text-[14px] text-white/60 mb-2">worlds deleted: {delResult.deletedWorlds.join(', ')}</p>}
          {delResult.preservedWorlds.length > 0 && <p className="text-[14px] text-white/60 mb-2">preserved for their co-builders (no longer linked to you): {delResult.preservedWorlds.join(', ')}</p>}
          <p className="text-[14px] text-white/50 mt-6">signing you out…</p>
        </div>
        <AccountBar signedOut={false} />
    </main>
    )
  }

  return (
    <main className="min-h-screen" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <div className="mx-auto max-w-2xl px-6 py-14 pb-28 font-mono">
        <h1 className="cafe-sign text-4xl text-glow mt-4 mb-8">account</h1>

        <div className="flex flex-col gap-5">
          {/* WHO */}
          <section className={box}>
            <h2 className={h2}>THIS ACCOUNT</h2>
            <div className="text-[15px] text-white/85">{p.email}</div>
            {p.name && <div className="text-[14px] text-white/55 mt-1">{p.name}</div>}
            <div className="text-[13px] text-white/45 mt-2">
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
                {p.renewsAt && <div className="text-[13px] text-white/50">renews {fmt(p.renewsAt)} · ${p.priceUsd}/mo</div>}
                {p.endsAt && <div className="text-[13px] text-amber-200/70">cancels at period end — access until {fmt(p.endsAt)}</div>}
                {p.hasSubscription ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button onClick={portal} disabled={busy !== null}
                      className={`${btn} border-amber-300/50 text-amber-100 hover:bg-amber-400/15 disabled:opacity-40`}>
                      {busy === 'portal' ? '…' : 'MANAGE SUBSCRIPTION'}
                    </button>
                    {!p.endsAt && (
                      <button onClick={cancel} disabled={busy !== null}
                        className={`${btn} border-white/20 text-white/70 hover:bg-white/10 disabled:opacity-40`}>
                        {busy === 'cancel' ? '…' : 'CANCEL MEMBERSHIP'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-[13px] text-white/50 mt-3">
                    {p.memberUntil
                      ? <>promo seat — live editing until {fmt(p.memberUntil)} (no billing; your credits and worlds are yours forever)</>
                      : <>your seat is granted (no billing on this account)</>}
                  </div>
                )}
                <p className="text-[12.5px] leading-relaxed text-white/45 mt-3">
                  cancel membership stops billing in one click — your seat lasts until the period ends, and your worlds and
                  credit stay yours forever. manage subscription opens Stripe&rsquo;s secure portal for your card and invoices
                  (canceling works there too).
                </p>
              </>
            ) : (
              <>
                <div className="text-[14px] text-white/70 mb-1">playing is free. the ${p.priceUsd}/mo editing membership is the seat to build on open building worlds.</div>
                {p.buyable
                  ? <button onClick={join} disabled={busy !== null}
                      className={`${btn} mt-3 border-cyan-300/50 text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-40`}>
                      {busy === 'join' ? '…' : `JOIN · $${p.priceUsd}/mo`}
                    </button>
                  : <div className="text-[13px] text-white/45 mt-2">payments are not configured on this deployment</div>}
              </>
            )}
            {p.entitlements.length > 0 && (
              <div className="text-[12.5px] text-white/40 mt-3">purchases on record: {p.entitlements.join(', ')}</div>
            )}
            {/* IP CONTROL — the premium tier over the platform commons */}
            <div className="mt-4 pt-4 border-t border-white/10">
              {p.ipControl ? (
                <>
                  <div className="text-[14px] text-amber-200/90">◆ IP control — active</div>
                  {myCompany && (
                    <a href={`/company/${myCompany.handle}`}
                      className={`${btn} inline-block mt-2 border-amber-300/50 text-amber-100 hover:bg-amber-400/15`}>
                      ◆ OPEN {(myCompany.name || myCompany.handle).toUpperCase()} — THE PRIVATE ROOM
                    </a>
                  )}
                  <p className="text-[12.5px] leading-relaxed text-white/45 mt-1">
                    your worlds are closed source: playable on the shelf, never readable or reusable by others.
                    your company space (name it, claim your subdomain) lives in the <a href="/suite" className="text-amber-200/80 underline hover:text-amber-100">◆ suite</a>.
                  </p>
                </>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-white/45">
                  standard deal: your published worlds&rsquo; code is open source <em>within the platform</em>, attributed through lineage.
                  {p.ipBuyable
                    ? <> the <a href="/suite" className="text-amber-200/80 underline hover:text-amber-100">◆ IP control membership</a> ($100/mo) closes your source + adds your company space.</>
                    : <> a ◆ IP control membership (closed source + company space) is coming.</>}
                </p>
              )}
            </div>
          </section>

          {/* ⚙ THE ENGINE — a maker's door back to their workshop (Galen, Sep 5) */}
          {p.worldCount > 0 && (
            <section className={box}>
              <h2 className={h2}>YOUR ENGINE</h2>
              <p className="text-[13px] text-white/55 mb-3">{p.worldCount} world{p.worldCount === 1 ? '' : 's'} on your deed — open the workshop.</p>
              <a href="/grid?ui=engine" className={`${btn} inline-block border-sky-300/50 text-sky-100 hover:bg-sky-400/15`}>⚙ OPEN YOUR ENGINE</a>
            </section>
          )}

          {/* ✚ BUILD CREDITS — count + buy (moved from the dockstar, Sep 5) */}
          <section className={box}>
            <h2 className={h2}>BUILD CREDITS</h2>
            <div className="text-[20px] text-amber-100 tabular-nums mb-1">
              {bundle ? (bundle.free ? '∞' : bundle.credits) : p.genCredits}
              <span className="text-[12px] text-white/50 ml-2">{bundle?.free ? 'keeper' : 'world births'}</span>
            </div>
            <div className="text-[13px] text-white/55 mb-3">every world your AI creates spends one · membership months grant two each · credits never expire</div>
            {bundle?.buyable && !bundle.free && (
              <>
                <div className="flex gap-1.5 mb-2 max-w-[300px]">
                  {[1, 3, 5, 10].map(q => (
                    <button key={q} onClick={() => setBuyQty(q)}
                      className={`flex-1 py-1.5 rounded-lg border font-mono text-[13px] tabular-nums transition-colors ${
                        buyQty === q ? 'border-amber-300/60 bg-amber-400/15 text-amber-100' : 'border-white/10 text-white/55 hover:border-white/25'}`}>
                      ×{q}
                    </button>
                  ))}
                </div>
                {(() => {
                  const total = bundle.bundles[buyQty] ?? bundle.genUsd * buyQty
                  const saved = bundle.genUsd * buyQty - total
                  return (
                    <button onClick={buyCredits} disabled={busy !== null}
                      className={`${btn} border-amber-300/50 text-amber-100 hover:bg-amber-400/15 disabled:opacity-40`}>
                      {busy === 'credits' ? '…' : <>BUY {buyQty} · ${total}{saved > 0 && <span className="text-emerald-200/90"> · save ${saved}</span>}</>}
                    </button>
                  )
                })()}
              </>
            )}
          </section>

          {/* ✉ CONTACT — moved from the dockstar (Sep 5) */}
          <section className={box}>
            <h2 className={h2}>CONTACT</h2>
            <p className="text-[13px] text-white/55 mb-3">reach the keeper — teams · questions · trouble.</p>
            <a href="/contact" className={`${btn} inline-block border-white/20 text-white/80 hover:bg-white/10`}>✉ OPEN CONTACT</a>
          </section>

          {/* PROMO CODES — redeem for everyone; mint + roster for the keeper */}
          <section className={box} id="promo">
            <h2 className={h2}>PROMO CODE</h2>
            <div className="flex flex-wrap gap-2">
              <input value={promoInput} onChange={e => setPromoInput(e.target.value.toUpperCase())}
                placeholder="CAFE-XXXX-XXXX" spellCheck={false}
                className="flex-1 min-w-[190px] bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-[14px] tracking-[0.08em] text-white/85 outline-none focus:border-amber-300/50" />
              <button onClick={redeem} disabled={busy !== null || promoInput.trim().length < 6}
                className={`${btn} border-amber-300/50 text-amber-100 hover:bg-amber-400/15 disabled:opacity-40`}>
                {busy === 'redeem' ? '…' : 'REDEEM'}
              </button>
            </div>
            <p className="text-[12.5px] leading-relaxed text-white/45 mt-2">
              a promo code lands its build credits on your account for keeps and starts its included stretch of live
              editing on the spot. one redemption per code per account.
            </p>
            {promoNote && <div className="text-[14px] text-amber-200/90 mt-2">{promoNote}</div>}
            {p.isAdmin && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-[13px] text-white/60">keeper: mint a code — 2 build credits + 30 days live edit per redeemer, unlimited redeemers</div>
                  <button onClick={mint} disabled={busy !== null}
                    className={`${btn} border-emerald-300/50 text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-40`}>
                    {busy === 'mint' ? '…' : '✚ GENERATE CODE'}
                  </button>
                  <button onClick={async () => {
                    if (!window.confirm('Mint a LIFETIME code? One redemption = permanent free membership (revocable only by you).')) return
                    setBusy('mint'); setPromoNote('')
                    try {
                      const r = await fetch('/api/promo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permanent: true, maxUses: 1, credits: 2 }) })
                      const d = await r.json()
                      if (r.ok && d?.code) { setMinted(d.code); fetch('/api/promo').then(x => x.json()).then(x => setCodes(Array.isArray(x?.codes) ? x.codes : [])).catch(() => {}) } else setPromoNote(d?.error || 'mint failed')
                    } catch { setPromoNote('mint failed — offline?') }
                    setBusy(null)
                  }} disabled={busy !== null}
                    className={`${btn} border-amber-300/60 text-amber-100 hover:bg-amber-400/15 disabled:opacity-40`}>
                    {busy === 'mint' ? '…' : '∞ LIFETIME CODE'}
                  </button>
                </div>
                {minted && (
                  <button onClick={() => navigator.clipboard?.writeText(minted).catch(() => {})}
                    className="mt-3 w-full text-left rounded-lg border border-emerald-300/40 bg-emerald-400/10 px-3 py-2.5 text-[16px] tracking-[0.12em] text-emerald-100 select-all"
                    title="click to copy">
                    {minted} <span className="text-[11px] text-white/50 float-right mt-1">click to copy</span>
                  </button>
                )}
                {minted && (
                  <button onClick={() => { navigator.clipboard?.writeText(inviteText(minted)).then(() => { setInviteCopied(minted); setTimeout(() => setInviteCopied(''), 1800) }).catch(() => {}) }}
                    className={`mt-2 w-full py-2.5 rounded-lg border text-[13px] tracking-[0.16em] transition-colors ${inviteCopied === minted ? 'border-emerald-300/70 bg-emerald-400/25 text-emerald-100' : 'border-emerald-300/50 bg-emerald-500/90 text-black font-bold hover:bg-emerald-400'}`}>
                    {inviteCopied === minted ? '\u2713 INVITE COPIED \u2014 SEND IT' : '\u29c9 COPY THE FULL INVITE (this code baked in)'}
                  </button>
                )}
                {codes.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1">
                    {codes.map(c => (
                      <div key={c.code} className="flex items-center justify-between gap-2 text-[13px] text-white/65">
                        <span className="tracking-[0.1em] select-all">{c.code}</span>
                        <span className="text-white/45 flex-1 text-right">{c.credits} credits · {c.memberDays}d edit · used {c.used}{c.maxUses != null ? `/${c.maxUses}` : ''}</span>
                        <button onClick={() => { navigator.clipboard?.writeText(inviteText(c.code)).then(() => { setInviteCopied(c.code); setTimeout(() => setInviteCopied(''), 1800) }).catch(() => {}) }}
                          className={`px-2.5 py-1 rounded-md border text-[11px] tracking-[0.14em] transition-colors shrink-0 ${inviteCopied === c.code ? 'border-emerald-300/70 text-emerald-200' : 'border-emerald-300/40 text-emerald-200/80 hover:bg-emerald-400/15'}`}>
                          {inviteCopied === c.code ? '\u2713' : '\u29c9 INVITE'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* DATA RIGHTS */}
          <section className={box}>
            <h2 className={h2}>YOUR DATA</h2>
            <p className="text-[14px] leading-relaxed text-white/65 mb-4">
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
            <p className="text-[12.5px] leading-relaxed text-white/45 mt-3">
              download = one JSON file of your profile, worlds, purchases, and community data (world code exports live in each world&rsquo;s cartridge export).
              deletion cancels billing immediately and erases your sign-in and personal data. your worlds are never deleted —
              they stay with the cafe, no longer linked to you (private ones stay private).
            </p>
          </section>

          <div className="flex items-center justify-between">
            <button onClick={() => signOut({ callbackUrl: '/' })} className="font-mono text-[13px] text-white/50 hover:text-white/70">sign out</button>
            <a href="/grid?ui=main&chat=1" className="text-[12px] text-white/35 hover:text-white/70">questions? ask in the commons ↗</a>
          </div>

          {note && <div className="font-mono text-[14px] text-amber-200/90">{note}</div>}
        </div>
      </div>

      {/* DELETE CONFIRM — destructive, so it demands the email typed back */}
      {delOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => busy !== 'delete' && setDelOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-red-400/30 bg-[#100808]/97 p-6 font-mono" onClick={e => e.stopPropagation()}>
            <div className="text-red-300/90 tracking-[0.2em] text-[14px] mb-3">✕ DELETE THIS ACCOUNT</div>
            <p className="text-[14px] leading-relaxed text-white/70 mb-2">
              this cancels your subscription immediately and erases your sign-in and personal data. your worlds are NOT
              deleted — they stay with the cafe, unlinked from you (private ones stay private, unreachable).
            </p>
            <p className="text-[14px] text-white/70 mb-3">there is no undo. type <span className="text-white/90">{p.email}</span> to confirm:</p>
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
      <AccountBar signedOut={false} />
    </main>
  )
}
