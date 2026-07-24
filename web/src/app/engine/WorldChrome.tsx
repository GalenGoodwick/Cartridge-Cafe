'use client'
// FocusChip — the ONE "what am I looking at" chip, on every page.
//
// DECISION (audit #7, Jul 24 2026): the full WorldChrome shell draft that lived
// here was DELETED. What the unification actually shipped survives: FocusChip
// (both shells render it) and lib/worldContext's capability table (`can()`
// gates FieldEngine's dock rows). FieldEngine's inline dock is the CANONICAL
// chrome — one implementation, capability-gated, no parallel draft rotting
// beside it. If a standalone chrome shell is wanted later, design it fresh
// against worldContext; don't resurrect the draft from git history.
//
// See DESIGN-unified-chrome.md and lib/worldContext.ts.

import { useMemo } from 'react'
import { WorldContext, tokenKind, focusSubline } from '@/lib/worldContext'

/** the FOCUS chip — the single "what am I looking at" element (was built twice:
 *  FieldEngine's chip + SpaceToolbar's badge). Exported so every host renders
 *  THIS one, not its own copy. `subOverride` lets a host supply a display sub-
 *  line the bare context can't know (e.g. a base world's "backup vN" position,
 *  or a space's human name); otherwise it's derived from ctx. */
export function FocusChip({ ctx, nameOverride, ownerName, ownerId, ownerHandle, subOverride, inline }: {
  ctx: WorldContext; nameOverride?: string; ownerName?: string; ownerId?: string; ownerHandle?: string; subOverride?: string; inline?: boolean
}) {
  const { kind, identity: id } = ctx
  const sub = subOverride ?? focusSubline(ctx)
  const branchy = kind === 'branch' || kind === 'winner'
  // the maker's name opens THEIR profile shelf (/u/<handle>) — the current maker
  // page, not the old /maker/<id> list. Only linkable when we know the handle.
  const makerHref = ownerHandle ? `/u/${encodeURIComponent(ownerHandle)}` : null
  return (
    <div className={`${inline ? '' : 'absolute left-3 top-3 z-40 '}pointer-events-none font-mono rounded-lg bg-black/55 backdrop-blur px-2.5 py-1.5 border border-white/10`}>
      <div className="text-[16px] tracking-[0.2em] text-white/85">
        {(nameOverride || id.base).toUpperCase()}
        {ownerName && <span className="text-white/45 tracking-normal"> · {makerHref
          ? <a href={makerHref} title={`${ownerName}'s worlds`} className="pointer-events-auto hover:text-white hover:underline decoration-dotted underline-offset-4 transition-colors">{ownerName}</a>
          : ownerName}</span>}
      </div>
      <div className={`text-[14px] tracking-[0.15em] mt-0.5 ${branchy ? 'text-emerald-300/80' : 'text-white/45'}`}>{sub}</div>
    </div>
  )
}
