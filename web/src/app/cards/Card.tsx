'use client'

// cards-card — the CARD component (MAP.cards: cards-card). MTG anatomy in the
// cafe's ember-void language: name+forks / the shader photo as the art window /
// the TYPE line as the visual anchor / tags / two-line desc / maker+base.
// Consumes EXACTLY the feed's Card shape (SPEC.cards.md) — no reaching around it.

import type { Card } from '@/app/api/cards/route'

/** A stable hue from the type id — every type owns a color edge, unassigned
 *  types included (the hash is the palette; no hand-kept color table). */
export function typeHue(type: string): number {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return h % 360
}

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

export function WorldCardView({ card, png, featured, index, onOpen }: {
  card: Card
  png?: string          // baked icon as a data URL (batch icons feed) — absent = placeholder
  featured?: boolean    // the base card — spans 2x2, larger art
  index: number         // deal-in stagger
  onOpen?: (slug: string) => void
}) {
  const hue = typeHue(card.type || 'untyped')
  const typed = !!card.type
  return (
    <button
      onClick={() => onOpen?.(card.slug)}
      className={`cardDeal group relative flex flex-col text-left rounded-xl overflow-hidden border bg-[#120c08]
        border-[#b97a2a]/25 hover:border-[#b97a2a]/60 transition-all duration-200 hover:-translate-y-1
        focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60
        ${featured ? 'col-span-2 row-span-2' : ''}`}
      style={{
        animationDelay: `${Math.min(index, 24) * 35}ms`,
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
        <span className="ml-auto shrink-0 font-mono text-[11px] text-white/35" title={`${card.counts.forks} forks`}>
          ⑄ {card.counts.forks}
        </span>
      </div>

      {/* the art window — the world's shader photo */}
      <div className={`relative mx-3 rounded-md overflow-hidden border border-white/10 bg-black ${featured ? 'aspect-[16/10]' : 'aspect-[16/10]'}`}>
        {png
          ? <img src={png} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.06]" />
          : <PlaceholderArt card={card} />}
        {card.isBase && (
          <span className="absolute top-1.5 left-1.5 font-mono text-[10px] tracking-[0.2em] px-1.5 py-0.5 rounded bg-black/70 border border-amber-300/50 text-amber-200">
            BASE
          </span>
        )}
      </div>

      {/* the TYPE line — the anchor */}
      <div className="px-3 pt-2 flex items-center gap-2 min-w-0">
        <span className="font-mono text-[11px] tracking-[0.18em] uppercase truncate"
          style={{ color: typed ? `hsl(${hue} 65% 68%)` : 'rgba(255,255,255,0.3)' }}>
          {typed ? card.type.replace(/-/g, ' ') : 'untyped'}
        </span>
        {card.tags.length > 0 && (
          <span className="font-mono text-[10px] text-white/35 truncate">
            {card.tags.slice(0, featured ? 6 : 3).map(t => '·' + t).join(' ')}
          </span>
        )}
      </div>

      {/* rules text */}
      <p className={`px-3 pt-1 pb-2 text-white/50 leading-snug ${featured ? 'text-[13px] line-clamp-3' : 'text-[12px] line-clamp-2'}`}>
        {card.desc || '—'}
      </p>

      {/* footer: maker · base set */}
      <div className="mt-auto px-3 pb-2.5 flex items-center gap-2 font-mono text-[10.5px] text-white/35">
        <span className="truncate">{card.maker.handle ? '@' + card.maker.handle : card.maker.name || 'the house'}</span>
        {card.base && !card.isBase && (
          <span className="ml-auto shrink-0 text-amber-200/40 truncate">of {card.base}</span>
        )}
      </div>
    </button>
  )
}
