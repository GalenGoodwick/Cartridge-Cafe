// fork-policy — THE ONE TRUTH for "may this world be forked?" (Galen, Aug 30:
// "fork off by default"). Forkability FLIPS from opt-in to DEFAULT-ON. The old
// law was allowlist: a world forked only if it was a house base or the maker
// flipped a switch. The new law is denylist: EVERY world forks EXCEPT the three
// kinds Galen named —
//   • premium     — a paid product (worldData.premium.usd > 0); its price is IP
//   • proprietary — the owner holds IP control, or the world declares itself closed
//   • live edit   — an open building world (policy.build === 'anyone'); you JOIN
//                   and build on it, you don't copy it out from under the crew
// Everything else is forkable. A maker may still opt OUT explicitly (the World
// Tools switch writes worldData.forkable === false). Bases fork by nature.
//
// Every fork decision — the server gate, the space payload, the client button,
// the catalog feed — routes through canFork(). No parallel copy of this rule.

export interface ForkFacts {
  /** worldData.premium.usd > 0 — a paid product, never forkable */
  premium: boolean
  /** the owner holds IP control, or the world declares itself closed */
  proprietary: boolean
  /** policy.build === 'anyone' — an open building world (join, don't fork) */
  liveEdit: boolean
  /** worldData.forkable === false — the maker's explicit opt-out */
  explicitOff: boolean
  /** worldData.__base === true — a house/maker base, the start-here surface */
  base: boolean
}

/** THE DECISION. Bases always fork (that's their purpose). Otherwise the
 *  maker's explicit OFF wins; failing that, a world forks unless it is premium,
 *  proprietary, or an open live-edit world. Default: forkable. */
export function canFork(f: ForkFacts): boolean {
  if (f.base) return true
  if (f.explicitOff) return false
  return !f.premium && !f.proprietary && !f.liveEdit
}

/** Derive the fork facts from a world's worldData plus the owner's IP-control
 *  standing (a per-account entitlement the worldData can't carry). The single
 *  place worldData is read for forkability — canFork never parses worldData. */
export function forkFactsOf(
  wd: Record<string, unknown> | null | undefined,
  ownerHasIpControl: boolean,
): ForkFacts {
  const w = wd ?? {}
  const prem = w.premium as { usd?: number } | undefined
  // read policy.build DIRECTLY (as the cards feed derives buildMode) — an open
  // building world is decided by its build seat, not a fully-normalized policy
  const build = (w.policy as { build?: unknown } | undefined)?.build
  return {
    premium: typeof prem?.usd === 'number' && prem.usd > 0,
    proprietary: ownerHasIpControl || w.proprietary === true || w.closed === true,
    liveEdit: build === 'anyone',
    explicitOff: w.forkable === false,
    base: w.__base === true,
  }
}

/** The one-shot: worldData + IP standing → forkable? (server gate / payload). */
export function worldIsForkable(
  wd: Record<string, unknown> | null | undefined,
  ownerHasIpControl: boolean,
): boolean {
  return canFork(forkFactsOf(wd, ownerHasIpControl))
}

/** THE ROUTE GATE — the same decision as canFork, but with a reason for the
 *  refusal so the fork routes can tell the user WHY. `ok` is true exactly when
 *  worldIsForkable is: the boolean authority stays canFork, this only names the
 *  cause. (world-policy.canForkWorld delegates here — one decision, no drift.) */
export function forkGate(
  wd: Record<string, unknown> | null | undefined,
  ownerHasIpControl = false,
): { ok: true } | { ok: false; error: string } {
  const f = forkFactsOf(wd, ownerHasIpControl)
  if (canFork(f)) return { ok: true }
  // not forkable — report the cause in canFork's own precedence
  if (f.explicitOff) return { ok: false, error: 'the maker turned forking off for this world' }
  if (f.premium) return { ok: false, error: 'this is a premium world — buy it to play; it can’t be forked' }
  if (f.proprietary) return { ok: false, error: 'this world’s source is proprietary — it can’t be forked' }
  if (f.liveEdit) return { ok: false, error: 'this is a live-edit world — everyone builds the ONE world together; it can’t be forked' }
  return { ok: false, error: 'this world can’t be forked' }
}
