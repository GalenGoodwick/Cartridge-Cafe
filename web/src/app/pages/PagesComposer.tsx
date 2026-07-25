'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import ShaderFrame from './ShaderFrame'
import PageBlocks, { ASPECT_CLASS } from './PageBlocks'
import { SEED_HERO, SEED_EMBER, SEED_AURORA } from './frame-shader'
import {
  ASPECTS, slugify, localBlockId,
  type Block, type BlockKind, type PageDoc,
} from '@/lib/page-types'

const LOCAL_ID = 'cc_pages_current'      // last opened server pageId
const LOCAL_ANON = 'cc_pages_v1'         // anon localStorage draft blocks

function defaultBlocks(): Block[] {
  return [
    { id: localBlockId('h'), kind: 'shader', wgsl: SEED_HERO, prompt: '', span: 2, aspect: 'wide', desc: 'the wordmark, lit' },
    { id: localBlockId('t'), kind: 'heading', text: 'Your page title', level: 1 },
    { id: localBlockId('x'), kind: 'text', text: 'A line about what this is. Edit it — or connect an AI and ask it to imagine the whole page.' },
    { id: localBlockId('e'), kind: 'shader', wgsl: SEED_EMBER, prompt: '', span: 1, aspect: 'tall', desc: 'carried fire' },
    { id: localBlockId('a'), kind: 'shader', wgsl: SEED_AURORA, prompt: '', span: 1, aspect: 'tall', desc: 'cold aurora' },
    { id: localBlockId('l'), kind: 'link', text: 'a link →', href: 'https://cartridge.cafe' },
  ]
}

type Doc = Pick<PageDoc, 'title' | 'slug' | 'published' | 'claimed' | 'blocks'> & { id: string | null }

export default function PagesComposer() {
  const { status } = useSession()
  const signedIn = status === 'authenticated'

  const [doc, setDoc] = useState<Doc | null>(null)
  const [editing, setEditing] = useState(true)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showPublish, setShowPublish] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [paidPending, setPaidPending] = useState(false)

  // deep-links: /pages#connect opens the AI modal, /pages#claim the claim modal
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash === '#connect') setShowConnect(true)
    if (window.location.hash === '#claim') setShowPublish(true)
  }, [])

  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const docRef = useRef<Doc | null>(null)
  useEffect(() => { docRef.current = doc }, [doc])

  // ── bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'loading') return
    let cancelled = false

    function adoptServer(d: PageDoc) {
      safeSet(LOCAL_ID, d.id)
      if (!cancelled) setDoc({ id: d.id, title: d.title, slug: d.slug, published: d.published, claimed: d.claimed, blocks: d.blocks })
    }

    async function boot() {
      if (!signedIn) {
        const blocks = readAnonDraft() ?? defaultBlocks()
        if (!cancelled) setDoc({ id: null, title: titleFrom(blocks), slug: null, published: false, blocks })
        return
      }

      // the admin bar on a live page links here as /pages?page=<id>
      const wanted = new URLSearchParams(window.location.search).get('page')
      if (wanted) {
        const got = await fetchDoc(wanted)
        if (got) return adoptServer(got)
      }
      const localId = safeGet(LOCAL_ID)
      if (localId) {
        const got = await fetchDoc(localId)
        if (got) return adoptServer(got)
      }
      // MIGRATE the anonymous draft: "sign in to publish" must never mean
      // "sign in and lose the page you just built". If this browser holds an
      // anon draft that isn't just the stock template, it becomes the server
      // page — cleared from localStorage only after the server confirms.
      const anonBlocks = readAnonDraft()
      if (anonBlocks && !isStockTemplate(anonBlocks)) {
        const migrated = await fetch('/api/pages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: titleFrom(anonBlocks), blocks: anonBlocks }),
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        if (migrated?.doc) {
          try { localStorage.removeItem(LOCAL_ANON) } catch { /* noop */ }
          return adoptServer(migrated.doc)
        }
      }
      const list = await fetch('/api/pages').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if (list?.pages?.length) {
        const got = await fetchDoc(list.pages[0].id)
        if (got) return adoptServer(got)
      }
      const created = await fetch('/api/pages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled page', blocks: defaultBlocks() }),
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if (created?.doc) adoptServer(created.doc)
    }
    boot()
    return () => { cancelled = true }
     
  }, [status, signedIn])

  // ── autosave ────────────────────────────────────────────────────────────────
  const scheduleSave = useCallback((next: Doc) => {
    dirty.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (!next.id) {
        try { localStorage.setItem(LOCAL_ANON, JSON.stringify({ blocks: next.blocks })) } catch { /* quota */ }
        dirty.current = false
        return
      }
      setSaveState('saving')
      try {
        const res = await fetch(`/api/pages/${next.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: next.title, blocks: next.blocks }),
        })
        setSaveState(res.ok ? 'saved' : 'error')
      } catch { setSaveState('error') }
      dirty.current = false
    }, 700)
  }, [])

  const mutate = useCallback((fn: (d: Doc) => Doc) => {
    setDoc((prev) => {
      if (!prev) return prev
      const next = fn(prev)
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // ── live poll: pull AI-answered frames while editing ────────────────────────
  useEffect(() => {
    if (!signedIn || !doc?.id || !editing) return
    const id = doc.id
    const t = setInterval(async () => {
      if (dirty.current || saveState === 'saving') return
      if (!docRef.current?.blocks.some((b) => b.kind === 'shader' && b.awaiting)) return
      const server = await fetchDoc(id)
      if (!server) return
      setDoc((prev) => {
        if (!prev) return prev
        let changed = false
        const blocks = prev.blocks.map((b) => {
          if (b.kind !== 'shader' || !b.awaiting) return b
          const s = server.blocks.find((x) => x.id === b.id && x.kind === 'shader') as typeof b | undefined
          if (s && !s.awaiting && s.wgsl && s.wgsl !== b.wgsl) { changed = true; return { ...b, wgsl: s.wgsl, desc: s.desc || b.desc, awaiting: false } }
          return b
        })
        return changed ? { ...prev, blocks } : prev
      })
    }, 2500)
    return () => clearInterval(t)
     
  }, [signedIn, doc?.id, editing, saveState])

  // ── after a Stripe return (?paid=page): the money is taken, so the modal
  // shows an honest "finishing your publish…" state (never the buy button
  // again) and polls until the webhook lands. Webhook + Stripe retries make
  // eventual publish certain barring a flagged conflict.
  useEffect(() => {
    if (!doc?.id || typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('paid') !== 'page') return
    const id = doc.id
    setPaidPending(true)
    setShowPublish(true)
    window.history.replaceState({}, '', '/pages')
    let tries = 0
    const t = setInterval(async () => {
      tries++
      const server = await fetchDoc(id)
      if (server?.claimed) {
        setDoc((d) => (d ? { ...d, published: true, claimed: true, slug: server.slug, blocks: server.blocks } : d))
        setPaidPending(false)
        clearInterval(t)
      } else if (tries >= 40) {   // ~60s — stop hammering; message stays honest
        clearInterval(t)
      }
    }, 1500)
    return () => clearInterval(t)

  }, [doc?.id])

  // ── block ops ────────────────────────────────────────────────────────────────
  const updateBlock = (id: string, patch: Partial<Block>) =>
    mutate((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...patch } as Block : b)) }))
  const removeBlock = (id: string) => mutate((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }))
  const moveBlock = (id: string, dir: -1 | 1) => mutate((d) => {
    const i = d.blocks.findIndex((b) => b.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= d.blocks.length) return d
    const blocks = [...d.blocks];[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
    return { ...d, blocks }
  })
  const addBlock = (kind: BlockKind) => mutate((d) => ({ ...d, blocks: [...d.blocks, freshBlock(kind)] }))

  async function imagine(id: string, prompt: string) {
    if (!prompt.trim() || prompt.trim().length < 3) return
    if (!doc?.id) { alert('Sign in to have an AI imagine frames.'); return }
    updateBlock(id, { awaiting: true } as Partial<Block>)
    try {
      const res = await fetch(`/api/pages/${doc.id}/imagine`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId: id, prompt }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        updateBlock(id, { awaiting: false } as Partial<Block>)
        alert(data?.error || `Error ${res.status}`)
      }
    } catch {
      updateBlock(id, { awaiting: false } as Partial<Block>)
    }
  }

  if (!doc) return <Splash />

  return (
    <div className="min-h-dvh bg-[#0A0D13] text-[#E9EFF7]">
      <header className="sticky top-0 z-20 border-b border-[#1c2941] bg-[#0A0D13]/90 backdrop-blur px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[#FFB25A]">✦</span>
          <input
            value={doc.title}
            onChange={(e) => mutate((d) => ({ ...d, title: e.target.value }))}
            disabled={!editing}
            className="min-w-0 flex-1 bg-transparent font-semibold tracking-tight outline-none disabled:opacity-100"
            placeholder="page title"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SaveBadge state={saveState} signedIn={signedIn} />
          <Link href="/p" className={btnGhost}>browse</Link>
          {doc.slug && <a href={`/p/${doc.slug}`} target="_blank" rel="noreferrer" className={btnGhost}>view live ↗</a>}
          <button onClick={() => setEditing((e) => !e)} className={btnGhost}>{editing ? 'preview' : 'edit'}</button>
          {editing && <button onClick={() => setShowConnect(true)} className={btnGhost}>connect AI</button>}
          {editing && (
            <button onClick={() => setShowPublish(true)} className={doc.claimed ? btnGhost : btnAccent}>
              {doc.claimed ? 'claimed ✓' : 'claim — $10'}
            </button>
          )}
        </div>
      </header>

      {!editing ? (
        <PageBlocks blocks={doc.blocks} title={doc.title} />
      ) : (
        <main className="mx-auto w-full max-w-3xl px-3 py-4">
          <div className="grid grid-cols-2 gap-3">
            {doc.blocks.map((b) => (
              <EditBlock
                key={b.id}
                block={b}
                onUpdate={(patch) => updateBlock(b.id, patch)}
                onRemove={() => removeBlock(b.id)}
                onMove={(dir) => moveBlock(b.id, dir)}
                onImagine={(p) => imagine(b.id, p)}
              />
            ))}
          </div>
          <Palette onAdd={addBlock} />
          <p className="mt-6 text-center text-[11px] font-mono text-[#3f4f63]">
            {!signedIn
              ? 'saved to this browser · sign in and it goes live instantly'
              : doc.slug
                ? <>live at <a href={`/p/${doc.slug}`} target="_blank" rel="noreferrer" className="text-[#55677E] underline underline-offset-2 hover:text-[#FFB25A]">/p/{doc.slug}</a>{doc.claimed ? ' · claimed forever' : ' · $10 claims a permanent name + the shelf'}</>
                : 'saving takes it live at its own address'}
          </p>
        </main>
      )}

      {showPublish && <PublishModal doc={doc} signedIn={signedIn} paidPending={paidPending} onClose={() => setShowPublish(false)}
        onPublished={(slug) => setDoc((d) => (d ? { ...d, published: true, claimed: true, slug } : d))} />}
      {showConnect && <ConnectModal pageId={doc.id} signedIn={signedIn} onClose={() => setShowConnect(false)} />}
    </div>
  )
}

// ─── editable block ────────────────────────────────────────────────────────────

function EditBlock({ block: b, onUpdate, onRemove, onMove, onImagine }: {
  block: Block
  onUpdate: (patch: Partial<Block>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  onImagine: (prompt: string) => void
}) {
  const [err, setErr] = useState<string | null>(null)

  if (b.kind === 'shader') {
    return (
      <div className={`relative overflow-hidden rounded-lg border border-[#1c2941] bg-black ${b.span === 2 ? 'col-span-2' : 'col-span-1'} ${ASPECT_CLASS[b.aspect]}`}>
        <ShaderFrame wgsl={b.wgsl} className="absolute inset-0" onCompile={setErr} />
        {b.awaiting && (
          <div className="absolute inset-x-0 top-0 z-10 bg-[#12203a]/90 px-2 py-1 text-[10px] font-mono text-[#8fb2e0] animate-pulse">awaiting your AI…</div>
        )}
        {err && !b.awaiting && (
          <div className="absolute inset-x-0 top-0 z-10 bg-[#2a0f0f]/90 px-2 py-1 text-[10px] font-mono text-[#ff9b7a] line-clamp-2">{err}</div>
        )}
        <div className="absolute right-2 top-2 z-10 flex gap-1">
          <IconBtn label={b.span === 2 ? 'span 2' : 'span 1'} onClick={() => onUpdate({ span: b.span === 1 ? 2 : 1 } as Partial<Block>)} />
          <IconBtn label={b.aspect} onClick={() => onUpdate({ aspect: ASPECTS[(ASPECTS.indexOf(b.aspect) + 1) % 3] } as Partial<Block>)} />
          <IconBtn label="↑" onClick={() => onMove(-1)} />
          <IconBtn label="↓" onClick={() => onMove(1)} />
          <IconBtn label="✕" onClick={onRemove} danger />
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent p-2">
          <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/50 backdrop-blur px-2 py-1.5">
            <span className="font-mono text-[11px] text-[#FF6A2B] shrink-0">imagine›</span>
            <input
              value={b.prompt}
              onChange={(e) => onUpdate({ prompt: e.target.value } as Partial<Block>)}
              onKeyDown={(e) => { if (e.key === 'Enter') onImagine(b.prompt) }}
              placeholder="a cold field at dusk…"
              className="min-w-0 flex-1 bg-transparent text-xs text-[#E9EFF7] placeholder:text-[#55677E] outline-none"
            />
            <button onClick={() => onImagine(b.prompt)} disabled={b.awaiting}
              className="shrink-0 rounded bg-[#FF6A2B] px-2 py-1 text-[11px] font-semibold text-[#140a04] disabled:opacity-50">
              {b.awaiting ? '…' : '→'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const controls = (
    <div className="absolute right-2 top-2 z-10 flex gap-1">
      <IconBtn label="↑" onClick={() => onMove(-1)} />
      <IconBtn label="↓" onClick={() => onMove(1)} />
      <IconBtn label="✕" onClick={onRemove} danger />
    </div>
  )
  return (
    <div className="col-span-2 relative rounded-lg border border-dashed border-[#26364e] bg-[#0d1219] p-3">
      {controls}
      {b.kind === 'heading' && (
        <div className="flex items-center gap-2 pr-24">
          <select value={b.level} onChange={(e) => onUpdate({ level: Number(e.target.value) as 1 | 2 | 3 } as Partial<Block>)}
            className="rounded bg-black/40 border border-[#26364e] px-1 py-0.5 text-[11px] font-mono text-[#7E93AC]">
            <option value={1}>H1</option><option value={2}>H2</option><option value={3}>H3</option>
          </select>
          <input value={b.text} onChange={(e) => onUpdate({ text: e.target.value } as Partial<Block>)}
            placeholder="Heading" className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-[#55677E]" />
        </div>
      )}
      {b.kind === 'text' && (
        <textarea value={b.text} onChange={(e) => onUpdate({ text: e.target.value } as Partial<Block>)}
          placeholder="Write a paragraph…" rows={3}
          className="w-full resize-y bg-transparent pr-24 text-sm leading-relaxed text-[#c7d3e0] outline-none placeholder:text-[#55677E]" />
      )}
      {(b.kind === 'link' || b.kind === 'button') && (
        <div className="flex flex-col gap-1.5 pr-24 sm:flex-row">
          <input value={b.text} onChange={(e) => onUpdate({ text: e.target.value } as Partial<Block>)}
            placeholder={b.kind === 'button' ? 'Button label' : 'Link text'}
            className="min-w-0 flex-1 rounded bg-black/30 border border-[#26364e] px-2 py-1 text-sm outline-none placeholder:text-[#55677E]" />
          <input value={b.href} onChange={(e) => onUpdate({ href: e.target.value } as Partial<Block>)}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded bg-black/30 border border-[#26364e] px-2 py-1 text-xs font-mono text-[#7E93AC] outline-none placeholder:text-[#55677E]" />
        </div>
      )}
    </div>
  )
}

function Palette({ onAdd }: { onAdd: (k: BlockKind) => void }) {
  const items: { k: BlockKind; label: string }[] = [
    { k: 'shader', label: '✦ shader frame' },
    { k: 'heading', label: '＋ heading' },
    { k: 'text', label: '＋ text' },
    { k: 'link', label: '＋ link' },
    { k: 'button', label: '＋ button' },
  ]
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((it) => (
        <button key={it.k} onClick={() => onAdd(it.k)}
          className="rounded-lg border border-dashed border-[#2a3a54] py-3 text-xs font-mono text-[#7E93AC] hover:text-[#FFB25A] hover:border-[#FF6A2B]/50 transition-colors">
          {it.label}
        </button>
      ))}
    </div>
  )
}

// ─── claim modal ──────────────────────────────────────────────────────────────
// The page is ALREADY LIVE at its auto address. This modal is where the $10
// happens: choose the permanent name (claim), or — once claimed — move to a
// new one for free (the entitlement travels with the page).

function PublishModal({ doc, signedIn, paidPending, onClose, onPublished }: {
  doc: Doc; signedIn: boolean; paidPending?: boolean; onClose: () => void; onPublished: (slug: string) => void
}) {
  const [slug, setSlug] = useState(doc.claimed ? doc.slug || '' : slugify(doc.title) || '')
  const [avail, setAvail] = useState<{ ok: boolean; reason?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [claimedUrl, setClaimedUrl] = useState(doc.claimed && doc.slug ? `/p/${doc.slug}` : '')
  const [err, setErr] = useState('')

  // the post-payment poll flips doc.claimed while this modal is open
  useEffect(() => {
    if (doc.claimed && doc.slug) setClaimedUrl(`/p/${doc.slug}`)
  }, [doc.claimed, doc.slug])

  const picking = !claimedUrl || renaming
  useEffect(() => {
    if (!signedIn || !doc.id || !slug || !picking) { setAvail(null); return }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/pages/${doc.id}/publish?slug=${encodeURIComponent(slug)}`).then((r) => r.json()).catch(() => null)
      setAvail(r)
    }, 350)
    return () => clearTimeout(t)
  }, [slug, signedIn, doc.id, picking])

  async function claim() {
    if (!doc.id) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/pages/${doc.id}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const data = await res.json()
      if (data.checkout) { window.location.href = data.checkout; return }
      if (data.claimed || data.published) {
        setClaimedUrl(data.url || `/p/${slug}`)
        setRenaming(false)
        onPublished(slug)
      } else setErr(data.error || `Error ${res.status}`)
    } catch { setErr('Network error') } finally { setBusy(false) }
  }

  const wasClaimed = !!doc.claimed
  return (
    <Modal onClose={onClose} title={
      paidPending && !claimedUrl ? 'Payment received'
      : claimedUrl && !renaming ? 'Your address is claimed'
      : wasClaimed ? 'Move to a new address'
      : 'Claim your address — $10'
    }>
      {!signedIn ? (
        <SignInNudge what="claim your page's address" />
      ) : paidPending && !claimedUrl ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-[#c7d3e0]">Payment received — anchoring your address…</p>
          <p className="text-xs font-mono text-[#55677E] animate-pulse">done in a moment</p>
          <p className="text-[11px] text-[#55677E]">Taking long? Your payment is recorded — refresh in a minute and it will be claimed.</p>
        </div>
      ) : claimedUrl && !renaming ? (
        <div className="space-y-3">
          <p className="text-sm text-[#c7d3e0]">Yours, permanently:</p>
          <a href={claimedUrl} target="_blank" rel="noreferrer" className="block break-all rounded bg-black/40 border border-[#26364e] px-3 py-2 font-mono text-sm text-[#FFB25A]">
            {typeof window !== 'undefined' ? window.location.origin : ''}{claimedUrl}
          </a>
          <p className="text-xs text-[#7E93AC]">On the shelf, in the sitemap, hosted forever. Every edit goes live instantly.</p>
          <button onClick={() => { setRenaming(true); setSlug(doc.slug || '') }} className={btnGhost + ' w-full'}>
            ↻ move to a new address (free)
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {!wasClaimed && doc.slug && (
            <p className="text-xs text-[#7E93AC]">
              Your page is live at <span className="font-mono text-[#c7d3e0]">/p/{doc.slug}</span> — a provisional address.
              Claiming names it, anchors it forever, and puts it on the shelf.
            </p>
          )}
          <label className="block text-sm text-[#7E93AC]">{wasClaimed ? 'New address' : 'Choose your address'}</label>
          <div className="flex items-center gap-1 rounded bg-black/40 border border-[#26364e] px-2 py-1.5">
            <span className="font-mono text-xs text-[#55677E]">cartridge.cafe/p/</span>
            <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="my-page"
              className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none" />
          </div>
          {avail && (
            <p className={`text-xs font-mono ${avail.ok ? 'text-[#5fbf7f]' : 'text-[#ff9b7a]'}`}>
              {avail.ok ? '✓ available' : `✕ ${avail.reason}`}
            </p>
          )}
          {!wasClaimed && (
            <p className="text-xs text-[#7E93AC]">$10 one-time. No subscription. Renaming later is free.</p>
          )}
          {wasClaimed && doc.slug && (
            <p className="text-xs text-[#7E93AC]">Free — your claim moves with the page. The old address (<span className="font-mono">/p/{doc.slug}</span>) is released.</p>
          )}
          {err && <p className="text-xs text-[#ff9b7a]">{err}</p>}
          <button onClick={claim} disabled={busy || !avail?.ok}
            className="w-full rounded-md bg-[#FF6A2B] py-2 text-sm font-semibold text-[#140a04] disabled:opacity-40">
            {busy ? 'working…' : wasClaimed ? 'Move address' : 'Claim for $10'}
          </button>
          {wasClaimed && (
            <button onClick={() => setRenaming(false)} className={btnGhost + ' w-full'}>cancel</button>
          )}
        </div>
      )}
    </Modal>
  )
}

// ─── connect-AI modal ─────────────────────────────────────────────────────────

function ConnectModal({ pageId, signedIn, onClose }: { pageId: string | null; signedIn: boolean; onClose: () => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://cartridge.cafe'

  async function mint() {
    if (!pageId) return
    setBusy(true)
    try {
      const r = await fetch(`/api/pages/${pageId}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      if (d.token) setToken(d.token)
    } finally { setBusy(false) }
  }

  const snippet = token
    ? `Your AI can author this page. Give it this token and these two calls:

TOKEN=${token}
PAGE=${origin}/api/pages/${pageId}

# read the page (find blocks where "awaiting" is true — they want a shader)
curl -s -H "Authorization: Bearer $TOKEN" $PAGE

# write frames/content back (send the full block list)
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"blocks": [ ... ]}' $PAGE

Each shader block needs self-contained WGSL:
  fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f`
    : ''

  return (
    <Modal onClose={onClose} title="Connect an AI to this page">
      {!signedIn ? (
        <SignInNudge what="connect an AI" />
      ) : !token ? (
        <div className="space-y-3">
          <p className="text-sm text-[#c7d3e0]">
            Mint a page token, hand it to your AI (Claude Code or any agent), and it can read and author this page live — imagining shader frames and writing copy. You’ll see its edits appear here.
          </p>
          <button onClick={mint} disabled={busy} className="w-full rounded-md bg-[#FF6A2B] py-2 text-sm font-semibold text-[#140a04] disabled:opacity-40">
            {busy ? 'minting…' : 'Mint a page token'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-[#ff9b7a]">Shown once — copy it now.</p>
          <textarea readOnly value={snippet} rows={12}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full resize-none rounded bg-black/50 border border-[#26364e] p-2 font-mono text-[11px] text-[#c7d3e0] outline-none" />
          <button onClick={() => navigator.clipboard?.writeText(snippet)} className={btnGhost}>copy</button>
        </div>
      )}
    </Modal>
  )
}

// ─── small pieces ────────────────────────────────────────────────────────────

const btnGhost = 'shrink-0 rounded-md border border-[#26364e] px-3 py-1.5 text-xs font-mono text-[#7E93AC] hover:text-[#E9EFF7] hover:border-[#3a5075] transition-colors'
const btnAccent = 'shrink-0 rounded-md bg-[#FF6A2B] px-3 py-1.5 text-xs font-semibold text-[#140a04] hover:bg-[#ff7d44] transition-colors'

function IconBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`rounded border px-1.5 py-0.5 text-[10px] font-mono backdrop-blur transition-colors ${
        danger ? 'border-[#5a2020] bg-black/40 text-[#ff9b7a] hover:bg-[#3a1010]' : 'border-white/10 bg-black/40 text-[#c7d3e0] hover:bg-black/70'
      }`}>{label}</button>
  )
}

function SaveBadge({ state, signedIn }: { state: 'idle' | 'saving' | 'saved' | 'error'; signedIn: boolean }) {
  if (!signedIn) return <span className="text-[10px] font-mono text-[#55677E]">local</span>
  const map = { idle: '', saving: 'saving…', saved: 'saved', error: 'save failed' } as const
  const col = state === 'error' ? 'text-[#ff9b7a]' : 'text-[#55677E]'
  return <span className={`text-[10px] font-mono ${col}`}>{map[state]}</span>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#26364e] bg-[#0d1219] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} className="text-[#55677E] hover:text-[#E9EFF7]">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SignInNudge({ what }: { what: string }) {
  return (
    <div className="space-y-3 text-center">
      <p className="text-sm text-[#c7d3e0]">Sign in to {what}.</p>
      <a href={`/auth/signin?callbackUrl=${encodeURIComponent('/pages')}`}
        className="inline-block rounded-md bg-[#FF6A2B] px-5 py-2 text-sm font-semibold text-[#140a04]">Sign in</a>
    </div>
  )
}

function Splash() {
  return <div className="min-h-dvh grid place-items-center bg-[#0A0D13] text-[#55677E] font-mono text-sm">loading…</div>
}

// ─── helpers ────────────────────────────────────────────────────────────────

function freshBlock(kind: BlockKind): Block {
  const id = localBlockId(kind[0])
  switch (kind) {
    case 'shader': return { id, kind: 'shader', wgsl: SEED_AURORA, prompt: '', span: 1, aspect: 'tall', desc: 'new frame' }
    case 'heading': return { id, kind: 'heading', text: 'New heading', level: 2 }
    case 'text': return { id, kind: 'text', text: 'New paragraph.' }
    case 'link': return { id, kind: 'link', text: 'a link →', href: 'https://' }
    case 'button': return { id, kind: 'button', text: 'Get started', href: 'https://' }
  }
}

function titleFrom(blocks: Block[]): string {
  const h = blocks.find((b) => b.kind === 'heading') as { text: string } | undefined
  return h?.text || 'Untitled page'
}

function readAnonDraft(): Block[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_ANON)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.blocks) && parsed.blocks.length) return parsed.blocks
  } catch { /* corrupt draft */ }
  return null
}

/** Content signature ignoring ids — is this draft still just the untouched
 *  stock template? (Ids are random per defaultBlocks() call.) */
function blockSig(blocks: Block[]): string {
  return JSON.stringify(blocks.map((b) => {
    switch (b.kind) {
      case 'shader': return [b.kind, b.wgsl, b.span, b.aspect]
      case 'heading': return [b.kind, b.text, b.level]
      case 'link': case 'button': return [b.kind, b.text, b.href]
      default: return [b.kind, b.text]
    }
  }))
}
function isStockTemplate(blocks: Block[]): boolean {
  return blockSig(blocks) === blockSig(defaultBlocks())
}

async function fetchDoc(id: string): Promise<PageDoc | null> {
  try {
    const r = await fetch(`/api/pages/${id}`)
    if (!r.ok) return null
    const d = await r.json()
    return d?.doc ?? null
  } catch { return null }
}

function safeGet(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* quota */ } }
