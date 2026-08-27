'use client'
// CHROME.TOPBAR — rung 3 of THE UI GRID (DESIGN-ui-grid.md), universalized.
// The world page's top band had THREE owners — FieldEngine's ◂+FocusChip at
// left, DockButton's pill at center, FieldEngine's dock stack at right —
// piling up on narrow columns and colliding pill×title anywhere under ~734px.
// This bar is the band's ONE owner at EVERY width: [◂ · FocusChip · ⚓ DOCK].
// It is a TENANT of the platform doc's chrome.topbar region (GridSlot places
// it — placement edits land in ui-grid-doc.ts, never here), and FieldEngine
// yields its own title row + drops its dock stack below the band while the
// bar stands. The phone is the same declaration against a narrower window.

import { FocusChip } from './WorldChrome'
import { deriveContext } from '@/lib/worldContext'
import type { UiGridDoc } from './ui-grid'

/** The pre-consolidation top band, as regions — kept so the overlap gate holds
 *  the OLD pileup as a permanent failing assert (the collision Galen saw is a
 *  red test, not an eyeball find). Never rendered. */
export function legacyTopBandDoc(win: { w: number; h: number }): UiGridDoc {
  // title chip width as measured live (name · maker wraps to ~300px before
  // truncation existed) — the pill's center-anchor only cleared it past ~734px
  const titleW = Math.min(300, Math.round(win.w * 0.45))
  return {
    regions: [
      { id: 'chrome.title', layer: 'cafe', z: 40, anchor: { px: { x: 12, y: 12, w: titleW, h: 56 } } },
      { id: 'chrome.dockpill', layer: 'cafe', z: 62, anchor: { px: { x: Math.round(win.w / 2 - 55), y: 16, w: 110, h: 32 } } },
      { id: 'chrome.dockrail', layer: 'cafe', z: 40, anchor: { px: { x: win.w - 108, y: 12, w: 96, h: 300 } } },
    ],
  }
}

/** THE BAR — slot content for chrome.topbar.narrow (mount via GridSlot, which
 *  owns the rect; this owns only the row). `dock` is the ⚓ slot (DockButton
 *  in bar form). */
export function WorldTopbar({ slug, name, ownerName, ownerHandle, ownerId, isOwner, versionView, dock }: {
  slug: string
  name: string
  ownerName?: string | null
  ownerHandle?: string | null
  ownerId?: string | null
  isOwner: boolean
  versionView?: number
  dock?: React.ReactNode
}) {
  const ctx = deriveContext({
    surface: 'world',
    loaded: name || slug,
    slug,
    email: null,
    spaceOwnerId: isOwner ? 'self' : 'other',
    myUserId: 'self',
    versionView,
    riding: false,
  })
  const sub = versionView !== undefined ? `save point v${versionView} · read-only` : 'main · live'
  const back = () => {
    // a version view backs out to LIVE; a live world asks the exit gate first
    // (cancelable cafe:back — SpaceStage preventDefaults and shows the dialog),
    // then falls through to the same up-never-back rule as FieldEngine's ◂.
    if (versionView !== undefined) { window.location.href = `/space/${encodeURIComponent(slug)}`; return }
    const ask = new CustomEvent('cafe:back', { cancelable: true })
    if (!window.dispatchEvent(ask)) return
    const base = (name || '').split(' ⑂ ')[0].trim()
    window.location.href = base && base !== (name || '').trim() ? `/hub/${encodeURIComponent(base)}` : '/'
  }
  return (
    <div data-cc-chrome className="w-full self-start flex items-stretch gap-1.5 px-2 pt-2 pointer-events-none">
      <button onClick={back} title="back"
        className="pointer-events-auto px-2.5 rounded-lg font-mono text-white/70 hover:text-white bg-black/55 backdrop-blur border border-white/10 hover:bg-black/80 transition-colors">◂</button>
      {/* the chip HUGS its content (shrinks + truncates when tight) — a
          flex-1 wrapper made its pill span the whole band as a fake title bar */}
      <div className="min-w-0 shrink overflow-hidden">
        <FocusChip ctx={ctx} nameOverride={name} ownerName={ownerName ?? undefined} ownerId={ownerId ?? undefined}
          ownerHandle={ownerHandle ?? undefined} subOverride={sub} liveSlug={slug} viewerIsOwner={isOwner} inline compact />
      </div>
      <div className="flex-1" />
      {dock && <div className="shrink-0 flex items-start">{dock}</div>}
    </div>
  )
}
