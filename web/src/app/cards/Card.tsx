'use client'

// cards-card — the CARD component (MAP.cards: cards-card). MTG anatomy in the
// cafe's ember-void language: name+forks / the shader photo as the art window /
// the TYPE line as the visual anchor / tags / two-line desc / maker+base.
// Consumes EXACTLY the feed's Card shape (SPEC.cards.md) — no reaching around it.

import { useState, useRef } from 'react'
import type { Card } from '@/app/api/cards/route'
import type { CardPresence } from './presence'
import { LiveArt } from './LiveArt'

/** A stable hue from the type id — every type owns a color edge, unassigned
 *  types included (the hash is the palette; no hand-kept color table). */
export function typeHue(type: string): number {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return h % 360
}

// (deviceTier benchmark removed with the ☕ resource-rating cups — Galen, Aug 27:
//  it existed only to color the cup badge, which cards no longer show.)

/** Procedural art for a world with no baked photo yet: its own hue field +
 *  glyph — a placeholder that still reads as THAT world, never a gray box. */
function PlaceholderArt({ card }: { card: Card }) {
  const hue = typeHue(card.type || card.slug)
  return (
    <div
      className="absolute inset-0 grid place-items-center overflow-hidden"
      style={{
        background: `radial-gradient(120% 90% at 30% 20%, hsl(${hue} 45% 22%) 0%, hsl(${(hue + 40) % 360} 50% 9%) 60%, #08050a 100%)`,
      }}
    >
      <span className="font-mono text-[42px] text-white/15 select-none">
        {card.isBase ? '⑄' : (card.name[0] || '?').toUpperCase()}
      </span>
      {/* scanlines — the cafe's CRT ancestry */}
      <div className="absolute inset-0 opacity-25"
        style={{ background: 'repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.5) 2px 3px)' }} />
    </div>
  )
}

export function WorldCardView({ card, png, featured, index, onOpen, presence, playPersona }: {
  card: Card
  png?: string          // baked icon as a data URL (batch icons feed) — absent = placeholder
  featured?: boolean    // the base card — spans 2x2, larger art
  index: number         // deal-in stagger
  onOpen?: (slug: string) => void
  presence?: CardPresence   // who's inside / is its maker building right now
  /** PLAY persona (Galen's mode split): the card is a PRODUCT — play it. No
   *  fork button, no build-status chips, no maker-at-work badge. */
  playPersona?: boolean
}) {
  const hue = typeHue(card.type || 'untyped')
  const typed = !!card.type
  // the art chain: LIVE shader → baked PNG → hue placeholder. A compile fail
  // or missing WebGPU demotes silently; the card never breaks.
  const [liveOk, setLiveOk] = useState(true)
  // LONG-PRESS (mobile, task #18): hold a card ~450ms → the action sheet
  // (OPEN · FORK · SHARE). A completed long-press swallows the click.
  const [sheet, setSheet] = useState(false)
  const lpRef = useRef<{ t: ReturnType<typeof setTimeout> | null; fired: boolean }>({ t: null, fired: false })
  const lpStart = () => {
    lpRef.current.fired = false
    lpRef.current.t = setTimeout(() => { lpRef.current.fired = true; setSheet(true) }, 450)
  }
  const lpEnd = () => { if (lpRef.current.t) clearTimeout(lpRef.current.t); lpRef.current.t = null }
  return (
    <>
    <button
      data-floatcard
      onClick={() => { if (lpRef.current.fired) { lpRef.current.fired = false; return } onOpen?.(card.slug) }}
      onTouchStart={lpStart} onTouchEnd={lpEnd} onTouchMove={lpEnd} onTouchCancel={lpEnd}
      onContextMenu={e => { e.preventDefault(); setSheet(true) }}
      className={`cardDeal cardBob group relative flex flex-col text-left rounded-xl overflow-hidden border bg-[#120c08]
        border-[#b97a2a]/25 hover:border-[#b97a2a]/60 transition-colors duration-200
        focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60
        ${featured ? 'max-sm:col-span-full sm:col-span-2 sm:row-span-2' : ''}`}
      style={{
        animationDelay: `${Math.min(index, 24) * 35}ms`,
        // the bob: each card hangs on its own slow phase (from its index seed)
        ['--bobDur' as string]: `${5.5 + (index % 7) * 0.7}s`,
        ['--bobDelay' as string]: `${-((index * 1.37) % 6)}s`,
        boxShadow: `0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 30px -18px rgba(0,0,0,0.9)`,
      }}
    >
      {/* the type edge — the card's color identity */}
      <div className="h-[3px] w-full shrink-0"
        style={{ background: typed ? `hsl(${hue} 70% 52%)` : 'rgba(255,255,255,0.12)' }} />

      {/* name bar */}
      <div className="flex items-baseline gap-2 px-3 pt-2.5 pb-1.5">
        <span className={`font-mono tracking-[0.12em] text-[#f0e6d2] truncate ${featured ? 'text-[19px]' : 'text-[14px]'}`}>
          {card.name.toUpperCase()}
        </span>
        {!playPersona && presence && presence.devLive && (
          <span className="shrink-0 font-mono text-[9.5px] tracking-[0.15em] px-1 py-px rounded border border-amber-300/50 text-amber-200 animate-pulse"
            title="its maker is building right now">LIVE</span>
        )}
        {!playPersona && (
        <span className="ml-auto shrink-0 font-mono text-[11px] text-white/35" title={`${card.counts.forks} forks`}>
          ⑄ {card.counts.forks}
        </span>
        )}
      </div>

      {/* the MAKER — right under the name (Galen, Aug 26: "move creator name
          under world name"), not buried in the footer */}
      <div className="px-3 -mt-1 pb-1.5 font-mono text-[10.5px] text-white/40 truncate">
        {card.maker.handle ? '@' + card.maker.handle : card.maker.name || 'the house'}
      </div>

      {/* the art window — the world's shader photo */}
      <div className={`relative mx-3 rounded-md overflow-hidden border border-white/10 bg-black ${featured ? 'aspect-[16/10]' : 'aspect-[16/10]'}`}>
        {card.iconWgsl && liveOk
          ? <LiveArt wgsl={card.iconWgsl} hue={card.hue} onFail={() => setLiveOk(false)} />
          : png
            ? <img src={png} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.06]" />
            : <PlaceholderArt card={card} />}
        {card.isBase && (
          <span className="absolute top-1.5 left-1.5 font-mono text-[10px] tracking-[0.2em] px-1.5 py-0.5 rounded bg-black/70 border border-amber-300/50 text-amber-200">
            BASE
          </span>
        )}
        {!card.playable && (
          <span className="absolute top-1.5 right-1.5 font-mono text-[10px] tracking-[0.2em] px-1.5 py-0.5 rounded bg-black/70 border border-white/25 text-white/60"
            title="only you can see this — publish it from the world">
            UNPUBLISHED
          </span>
        )}
        {presence && presence.here > 0 && (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-black/70 border border-white/15 text-amber-100/90"
            title={`${presence.here} inside right now`}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {presence.here}
          </span>
        )}
      </div>

      {/* the TYPE line — the anchor: just the type and what this IS */}
      <div className="px-3.5 pt-2.5 flex items-center gap-2 min-w-0">
        <span className="font-mono text-[11.5px] tracking-[0.18em] uppercase truncate"
          style={{ color: typed ? `hsl(${hue} 65% 68%)` : 'rgba(255,255,255,0.3)' }}>
          {typed ? card.type.replace(/-/g, ' ') : 'untyped'}
        </span>
        {/* ✦ PAID EXPERIENCE (Galen, Aug 24): a priced world wears its price —
            gold, next to the kind. Buying grants a seat at the workbench
            (co-program access); a free demo minute is inside. */}
        {card.premium !== null && (
          <span className="ml-auto shrink-0 font-mono text-[10px] tracking-[0.14em] px-1.5 py-0.5 rounded border border-yellow-300/60 text-yellow-200"
            title={`$${card.premium} once — a seat at the workbench: play it, then co-program it · free demo inside`}>
            ✦ ${card.premium}
          </span>
        )}
        {/* THE KIND — toy · world · game (Galen's taxonomy): derived from the
            anatomy when not declared (rules built → game; multiplayer/big
            grid → world; else toy). */}
        <span className={`${card.premium !== null ? '' : 'ml-auto '}shrink-0 font-mono text-[10px] tracking-[0.14em] px-1.5 py-0.5 rounded border ${
          card.kind === 'game' ? 'border-violet-300/50 text-violet-200/90'
          : card.kind === 'world' ? 'border-sky-300/40 text-sky-200/80'
          : 'border-amber-300/40 text-amber-200/70'}`}
          title={card.kind === 'game' ? 'a GAME — it has rules, goals, win and lose' : card.kind === 'world' ? 'a WORLD — a place to inhabit, often together' : 'a TOY — pick it up and play, no goals'}>
          {card.kind.toUpperCase()}
        </span>
      </div>

      {/* categories breathe on their OWN row — crew chip + tags. (The ☕
          resource-rating cups were removed — Galen, Aug 27.) */}
      {(card.edit.mode !== 'static' || card.tags.length > 0) && (
        <div className="px-3.5 pt-1.5 flex items-center gap-1.5 min-w-0">
          {!playPersona && card.edit.mode !== 'static' && (
            <span className={`shrink-0 font-mono text-[10px] tracking-[0.14em] px-1.5 py-0.5 rounded border ${
              card.edit.mode === 'open' ? 'border-emerald-300/50 text-emerald-200/90' : 'border-sky-300/40 text-sky-200/80'}`}
              title={card.edit.mode === 'open' ? 'anyone can build here' : 'a crew builds here'}>
              {card.edit.mode === 'open' ? 'OPEN EDIT' : `${card.edit.editors} EDITORS`}
            </span>
          )}
          {card.tags.length > 0 && (
            <span className="font-mono text-[10.5px] text-white/40 truncate">
              {card.tags.slice(0, featured ? 8 : 4).map(t => '·' + t).join(' ')}
            </span>
          )}
        </div>
      )}

      {/* rules text — three lines of room, four when featured */}
      <p className={`px-3.5 pt-2 pb-2.5 text-white/55 leading-relaxed ${featured ? 'text-[13px] line-clamp-4' : 'text-[12px] line-clamp-3'}`}>
        {card.desc || '—'}
      </p>

      {/* footer: base set only (the maker moved up under the name) */}
      {card.base && !card.isBase ? (
        <div className="mt-auto px-3.5 pb-3 flex items-center font-mono text-[10.5px]">
          <span className="ml-auto shrink-0 text-amber-200/40 truncate">of {card.base}</span>
        </div>
      ) : (
        <div className="mt-auto pb-3" />
      )}
    </button>
    {sheet && (
      <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={e => { e.stopPropagation(); setSheet(false) }}>
        <div className="w-full sm:w-80 sm:rounded-xl rounded-t-2xl border border-[#b97a2a]/40 bg-[#171009]/95 p-3 pb-6 sm:pb-3 font-mono"
          onClick={e => e.stopPropagation()}>
          <div className="text-[13px] tracking-[0.2em] text-amber-200/80 mb-2 truncate">{card.name}</div>
          <div className="flex flex-col gap-1.5 text-[14px]">
            <button onClick={() => { setSheet(false); onOpen?.(card.slug) }}
              className="px-3 py-2.5 rounded-lg border border-white/15 text-white/80 hover:bg-white/5 text-left">⛶ OPEN</button>
            {!playPersona && (card.isBase || card.playable) && (
              <button onClick={async () => {
                setSheet(false)
                const r = await fetch(`/api/spaces/${encodeURIComponent(card.slug)}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                const d = await r.json().catch(() => null)
                if (r.ok && d?.space?.slug) window.location.href = `/space/${d.space.slug}?connect=1`
              }}
                className="px-3 py-2.5 rounded-lg border border-emerald-300/40 text-emerald-200 hover:bg-emerald-400/10 text-left">⑄ FORK — instantly yours</button>
            )}
            {/* FULL SHARE SUITE (Galen): navigator.share opens the NATIVE sheet —
                AirDrop (one tap to a nearby Mac), Messages, mail, everything.
                No Web Share (desktop browsers) → clipboard fallback. */}
            <button onClick={async () => {
              const url = `${location.origin}/space/${card.slug}`
              setSheet(false)
              try {
                if (navigator.share) await navigator.share({ title: card.name, text: `${card.name} — play it on cartridge.cafe`, url })
                else await navigator.clipboard.writeText(url)
              } catch { /* user closed the sheet — fine */ }
            }}
              className="px-3 py-2.5 rounded-lg border border-white/15 text-white/80 hover:bg-white/5 text-left">↗ SHARE — AirDrop · message · copy</button>
            <button onClick={() => { setSheet(false); window.location.href = '/story' }}
              className="px-3 py-2.5 rounded-lg border border-amber-300/40 text-amber-200 hover:bg-amber-400/10 text-left">ⓘ MORE INFO — what this place is</button>
            <button onClick={() => setSheet(false)}
              className="px-3 py-2 rounded-lg text-white/40 hover:text-white/70 text-center">cancel</button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
