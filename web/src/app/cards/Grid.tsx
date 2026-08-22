'use client'

// cards-grid — the shader grid (MAP.cards: cards-grid). The base card is
// FEATURED top-left spanning 2x2; the family fills reading order (L→R, T→B).
// DESIGN §3: flip to literal right-to-left = `direction: rtl` on the grid.

import type { Card } from '@/app/api/cards/route'
import { WorldCardView } from './Card'

export function CardGrid({ base, cards, pngBySlug, onOpen }: {
  base: Card | null
  cards: Card[]            // feed order: base first (when present), then updatedAt desc
  pngBySlug: Map<string, string>
  onOpen: (slug: string) => void
}) {
  if (!cards.length) {
    return (
      <div className="py-24 text-center font-mono text-[13px] tracking-[0.2em] text-white/30">
        NOTHING ON THIS PAGE YET — FORK THE BASE AND BE FIRST
      </div>
    )
  }
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(215px,1fr))] [grid-auto-flow:dense]">
      {cards.map((c, i) => (
        <WorldCardView
          key={c.slug}
          card={c}
          png={pngBySlug.get(c.slug)}
          featured={!!base && c.slug === base.slug}
          index={i}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
