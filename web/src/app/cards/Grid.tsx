'use client'

// cards-grid — the shader grid (MAP.cards: cards-grid). The base card is
// FEATURED top-left spanning 2x2; the family fills reading order (L→R, T→B).
// DESIGN §3: flip to literal right-to-left = `direction: rtl` on the grid.

import type { Card } from '@/app/api/cards/route'
import { WorldCardView } from './Card'
import type { CardPresence } from './presence'

export function CardGrid({ base, cards, pngBySlug, presence, onOpen, playPersona }: {
  base: Card | null
  cards: Card[]            // feed order: base first (when present), then updatedAt desc
  pngBySlug: Map<string, string>
  presence: Map<string, CardPresence>
  onOpen: (slug: string) => void
  /** PLAY persona (mode split): the card is a PRODUCT — play only; no fork/edit
   *  affordances, no build-status chips. ENGINE persona shows the workshop card. */
  playPersona?: boolean
}) {
  if (!cards.length) {
    return (
      <div className="py-24 text-center font-mono text-[13px] tracking-[0.2em] text-white/30">
        NOTHING ON THIS PAGE YET — FORK THE BASE AND BE FIRST
      </div>
    )
  }
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(215px,1fr))] [grid-auto-flow:dense]">
      {cards.map((c, i) => (
        <WorldCardView
          key={c.slug}
          card={c}
          png={pngBySlug.get(c.slug)}
          featured={!!base && c.slug === base.slug}
          index={i}
          onOpen={onOpen}
          presence={presence.get(c.slug)}
          playPersona={playPersona}
        />
      ))}
    </div>
  )
}
