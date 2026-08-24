// cards-registry — the generated type list as a LIVE registry + the three card
// bridge verbs (DESIGN-card-main.md §2; contracts in swarm/SPEC.cards.md).
// The registry is game slot `cardtypes:index`: seeded from SEED_CARD_TYPES on
// first read, grown by builders' propose_card_type — generated in both senses.
// All slot I/O rides loadGameSlot/saveGameSlot (never a parallel store), and
// the set_card write rides applyCommandToSnapshot — the one snapshot path
// every bridge write uses, which bumps __bridge_rev so open tabs adopt it.

import { loadGameSlot, saveGameSlot } from './store'
import { applyCommandToSnapshot } from './space-store'
import { SEED_CARD_TYPES, proposeType, validateCard, type CardType } from '@/lib/cards'

/** The registry slot shape — SPEC.cards.md: `{ v:1, types:[{id,label,desc?}] }`. */
export interface TypeRegistry { v: 1; types: CardType[] }

const REGISTRY_SLOT = 'cardtypes:index'

/** Read the live type registry, seeding SEED_CARD_TYPES on first read. A
 *  malformed or empty slot RE-SEEDS instead of serving garbage — the type
 *  vocabulary must never come back empty (set_card and the publish gate would
 *  deadlock on an unpickable type). Entries are kept only if well-formed, so a
 *  half-corrupt slot degrades to its sane rows rather than poisoning callers. */
export async function readTypeRegistry(): Promise<TypeRegistry> {
  const doc = (await loadGameSlot(REGISTRY_SLOT)) as { v?: unknown; types?: unknown } | undefined
  const raw = doc && Array.isArray(doc.types) ? doc.types : []
  const types = raw.filter((t): t is CardType =>
    !!t && typeof t === 'object'
    && typeof (t as CardType).id === 'string' && (t as CardType).id.length > 0
    && typeof (t as CardType).label === 'string')
  if (doc?.v === 1 && types.length > 0) return { v: 1, types }
  const seeded: TypeRegistry = { v: 1, types: SEED_CARD_TYPES }
  await saveGameSlot(REGISTRY_SLOT, seeded)
  return seeded
}

/** card_types — return the vocabulary. The AI building a world picks from this
 *  list before set_card / publish_world; any authed caller may read it. */
export async function handleCardTypes(): Promise<Record<string, unknown>> {
  const reg = await readTypeRegistry()
  return {
    type: 'card_types', v: reg.v, count: reg.types.length, types: reg.types,
    next: 'pick one → set_card {cardType:"<id>", tags?:[...]}; nothing fits → propose_card_type {label, desc?}',
  }
}

/** propose_card_type {label, desc?} — grow the vocabulary when nothing fits.
 *  Deduped + normalized by proposeType (curation = admin prune later). A label
 *  that normalizes to nothing usable is refused; an existing id is a friendly
 *  no-op (ok:true, added:false) pointing the caller at set_card. */
export async function handleProposeCardType(cmd: { label?: unknown; desc?: unknown }): Promise<Record<string, unknown>> {
  const label = typeof cmd.label === 'string' ? cmd.label.trim() : ''
  const desc = typeof cmd.desc === 'string' ? cmd.desc : undefined
  if (!label) {
    return { type: 'propose_card_type', ok: false, error: 'propose_card_type needs { label } (desc optional) — card_types shows what already exists' }
  }
  const reg = await readTypeRegistry()
  const { registry, added, id } = proposeType(reg.types, label, desc)
  if (!added && !registry.some(t => t.id === id)) {
    return { type: 'propose_card_type', ok: false, error: `"${label}" does not normalize to a usable type id (≥3 chars of a-z 0-9 -) — try a plainer label` }
  }
  if (added) await saveGameSlot(REGISTRY_SLOT, { v: 1, types: registry } satisfies TypeRegistry)
  return {
    type: 'propose_card_type', ok: true, added, id,
    next: added
      ? `"${id}" joined the vocabulary — set_card {cardType:"${id}"} stamps it on a world`
      : `"${id}" was already in the vocabulary — set_card {cardType:"${id}"} uses it`,
  }
}

/** set_card — stamp worldData.card = {type, tags} on the caller's world after
 *  validating against the LIVE registry (validateCard is the one truth shared
 *  with the publish gate). The card type rides `cardType` (or nested
 *  `card:{type,tags}`) because the bridge envelope's own `type` is the verb.
 *  Persisted via applyCommandToSnapshot so __bridge_rev bumps exactly like
 *  every other bridge write — open tabs hot-adopt the card. */
export async function handleSetCard(spaceId: string, cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nested = (cmd.card && typeof cmd.card === 'object' ? cmd.card : undefined) as { type?: unknown; tags?: unknown; kind?: unknown } | undefined
  const candidate = { type: nested?.type ?? cmd.cardType, tags: nested?.tags ?? cmd.tags, kind: nested?.kind ?? cmd.kind }
  const reg = await readTypeRegistry()
  const v = validateCard(candidate, reg.types)
  if (!v.ok) {
    return { type: 'set_card', ok: false, error: v.error, usage: 'set_card {cardType:"<id from card_types>", tags?:["2d","multiplayer"], kind?:"toy"|"world"|"game"}' }
  }
  await applyCommandToSnapshot(spaceId, { type: 'set_world_data', data: { card: v.card } })
  return {
    type: 'set_card', ok: true, card: v.card,
    next: 'card facts stamped on worldData.card — publish_world requires them; the /cards grid serves them.',
  }
}

/** The PUBLISH gate's card check (SEAM-B calls this; pure over its inputs so
 *  the gate is testable without the bridge). Null = publishable; a string = the
 *  exact refusal, pointing the builder at the fix. */
export function publishCardError(
  wd: Record<string, unknown>,
  registry: TypeRegistry,
): string | null {
  const card = wd.card
  if (!card || typeof card !== 'object') {
    return 'worldData.card — every published world is a CARD with a mandatory type: card_types lists the vocabulary, then set_card {cardType:"<id>", tags?:[...]}'
  }
  const v = validateCard(card as { type?: unknown; tags?: unknown }, registry.types)
  return v.ok ? null : v.error
}
