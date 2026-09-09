// BRIDGE DISPATCH — the registry-keyed handler table (item 4/#7). The bridge's
// ~60 inline `cmd.type === '…'` branches migrate here one verb at a time: a
// handler is a small function keyed by verb, scope-checked against the ONE
// command registry (the same source that drives enforcement + help + the CI
// conformance tests). Unmigrated verbs return null and fall through to the
// legacy if-chain — zero behavior change per migration, monotonic shrinkage of
// the monolith.

import crypto from 'crypto'
import type { BridgeAuth } from './bridge-auth'
import { COMMAND_REGISTRY } from '@/lib/command-registry'
import { getSpaceSnapshot, applyCommandToSnapshot } from './space-store'
import type { SnapshotLike } from '@/app/engine/build-lifecycle-server'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'
import { canCreateWorld, findOwnWorldByName, resolveBirthExtras } from '@/lib/world-create'
import { commonsSystemSay } from '@/lib/commons'
import { COMMONS_HANDLERS } from './bridge-commons'
import { ASSET_HANDLERS } from './bridge-assets'

export interface HandlerCtx {
  cmd: Record<string, unknown>
  auth: BridgeAuth
  /** request origin (req.nextUrl.origin) — for links a handler mints */
  origin: string
  /** holderOf(raw token) — the anonymous builder identity for docks/regions */
  tokenHolder: string
}

export type BridgeHandler = (ctx: HandlerCtx) => Promise<Record<string, unknown>>

// ── build lifecycle (item 3's verbs — the first migrated handlers) ──

async function requireSnapshot(auth: BridgeAuth): Promise<SnapshotLike | null> {
  if (!auth.spaceId) return null
  return (await getSpaceSnapshot(auth.spaceId, true)) as SnapshotLike | null
}

const buildSpecSet: BridgeHandler = async ({ cmd, auth }) => {
  const snap = await requireSnapshot(auth)
  if (!snap) return { type: cmd.type, error: 'no world snapshot yet' }
  const { normalizeBuildSpec } = await import('@/lib/build-spec')
  const spec = normalizeBuildSpec(cmd.spec)
  await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', __internal: true, data: { spec } })
  return { ok: true, type: cmd.type, spec }
}

const buildStatus: BridgeHandler = async ({ cmd, auth }) => {
  const snap = await requireSnapshot(auth)
  if (!snap) return { type: cmd.type, error: 'no world snapshot yet' }
  const lc = await import('@/app/engine/build-lifecycle-server')
  const e = lc.evaluateFromSnapshot(snap)
  return { ok: true, type: cmd.type, stage: e.stage, revision: e.revision, ready: e.ready, required: e.required, passed: e.passed, outstanding: e.outstanding }
}

/** validate_world / complete_build: run server checks, fold external eye results
 *  (stamped to the CURRENT revision), persist the ledger, evaluate, and derive
 *  brief_done from readiness. readyRevision stamps the content revision this
 *  build was certified at, so brief_done self-clears when a later edit drifts it. */
const validateOrComplete: BridgeHandler = async ({ cmd, auth }) => {
  const s = await requireSnapshot(auth)
  if (!s) return { type: cmd.type, error: 'no world snapshot yet' }
  const lc = await import('@/app/engine/build-lifecycle-server')
  const server = lc.serverChecks(s)
  const external = lc.stampResults(s, cmd.results)
  const evidence = lc.mergeEvidence(lc.getLedger(s).evidence, [...server, ...external], lc.worldRevision(s))
  const snapEval: SnapshotLike = { ...s, worldData: { ...(s.worldData ?? {}), __build: { stage: lc.getLedger(s).stage, evidence } } }
  const e = lc.evaluateFromSnapshot(snapEval)
  await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', __internal: true, __admin: true, data: { __build: { stage: e.stage, evidence, ...(e.ready ? { readyRevision: e.revision } : {}) }, brief_done: e.ready } })
  // ICON ON READY (Galen, Sep 9: "don't forget to snapshot the world icon"):
  // a world that just became READY gets its shelf face photographed by the eye
  // (world_icon:<slug> bake) — backend, best-effort, never blocks completion.
  if (e.ready && auth.slug) {
    try {
      const { enqueueBake } = await import('@/lib/icon-bake-queue')
      enqueueBake(auth.slug, s as never)
    } catch { /* the shelf face is a courtesy */ }
  }
  const base = { ok: true, type: cmd.type, stage: e.stage, revision: e.revision, ready: e.ready, required: e.required, passed: e.passed, outstanding: e.outstanding, checksRun: [...server, ...external].map(c => `${c.check}:${c.status}`) }
  if (cmd.type === 'complete_build' && !e.ready) {
    return { ...base, refused: true, hint: `complete_build refused — ${e.outstanding.length} check(s) outstanding at revision ${e.revision}: ${e.outstanding.map(o => `${o.check}(${o.status})`).slice(0, 8).join(', ')}. Run render_probe + playthrough, then submit: validate_world {"results":[{"check":"input-response","status":"passed","environment":"playthrough"}, ...]}. A GPU that's down is 'unavailable', never a pass.` }
  }
  return base
}

// ── player-key verbs (create_world / use_world / credits_read) — moved verbatim
// from the route's auth.playerId branch. Each returns NULL when the caller has
// no player key, so non-player callers fall through to the legacy chain exactly
// as before (a space/admin token sending create_world behaves unchanged).

/** Mint a fresh uc_st_ world token for a space (raw shown once, SHA-256 stored). */
async function mintWorldToken(spaceId: string, name: string): Promise<string> {
  const raw = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  await prisma.spaceToken.create({
    data: { name, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.slice(0, 12) + '...', spaceId },
  })
  return raw
}

const createWorld: BridgeHandler = async ({ cmd, auth }) => {
  // ONE CONTRACT (item 2): the AI door speaks the same BuildSpec the Create UI
  // does — brief / target / visibility / gameplay / presentation / acceptance,
  // not name-only — mapped to birth the SAME way. A short {name} still works;
  // unstated fields default (target universal, visibility PRIVATE).
  const { normalizeBuildSpec, specToWorldData, specToBirthParams, specIsPublic } = await import('@/lib/build-spec')
  const spec = normalizeBuildSpec({
    name: cmd.name, brief: cmd.brief, target: cmd.target, visibility: cmd.visibility,
    gameplay: cmd.gameplay, presentation: cmd.presentation, acceptance: cmd.acceptance,
  })
  const name = (spec.name || 'untitled world').slice(0, 60)
  const rawName = typeof cmd.name === 'string' && cmd.name.trim().length > 0
  // caller-supplied idempotency key makes a retried create replay-safe
  const idempotencyKey = (typeof cmd.idempotencyKey === 'string' && cmd.idempotencyKey.trim())
    ? cmd.idempotencyKey.trim().slice(0, 120) : crypto.randomUUID()
  // one gate for every create path (the world cap)
  const gate = await canCreateWorld(auth.playerId!)
  if (!gate.ok) return { type: cmd.type, error: gate.error }
  // RETRY-SAFE: a repeat of the same key returns the existing world (fresh
  // build key), BEFORE the twin-guard would reject the now-existing name.
  const { createWorldIdempotent, peekCreate } = await import('@/lib/create-world-service')
  const replay = await peekCreate(idempotencyKey)
  if (replay) {
    return { ok: true, created: replay.space.slug, spaceName: replay.space.name, token: replay.token, replayed: true }
  }
  // GUARD: don't silently mint a same-name twin for the same owner. Only
  // for an INTENTIONAL name — an unnamed scratch create still works.
  if (rawName) {
    const twin = await findOwnWorldByName(auth.playerId!, name)
    if (twin) return { type: cmd.type, error: `You already own a world named "${twin.name}" (/space/${twin.slug}). Edit it with use_world {"slug":"${twin.slug}"}, or create with a different name.`, existingSlug: twin.slug }
  }
  const { isAdminUserId } = await import('@/lib/adminAuth')
  const { stripeConfigured, GEN_PRICE_USD, hasIpShield, readGenCredits } = await import('@/lib/stripe')
  const isKeeper = await isAdminUserId(auth.playerId!)
  // FORK / BASE (Galen, Sep 9 — the ⚿ door's third face): {base:"<slug>"} seeds the
  // newborn from that world through the ONE parser every birth door shares
  // (resolveBirthExtras: your own worlds or public bases/forkables only; seed
  // hygiene strips __base/forkable/policy; forkOfId carries lineage).
  let extras: Awaited<ReturnType<typeof resolveBirthExtras>>
  try {
    extras = await resolveBirthExtras(auth.playerId!, { base: cmd.base, access: cmd.access === 'open' ? 'open' : undefined, targets: spec.target === 'universal' ? undefined : spec.target })
  } catch (e) {
    const err = e as { error?: string }
    return { type: cmd.type, error: err.error || 'bad base world' }
  }
  const specWd = specToWorldData(spec, { by: auth.playerId!, at: Date.now(), ...(extras.forkOfId ? { format: String(cmd.base ?? '').trim() } : {}) })
  const worldData = { ...extras.birthData, ...specWd }
  const baseSnapshot = extras.baseSnapshot
    ? { ...(extras.baseSnapshot as Record<string, unknown>), worldData: { ...((extras.baseSnapshot as { worldData?: Record<string, unknown> }).worldData ?? {}), ...specWd } } as typeof extras.baseSnapshot
    : undefined
  const worldParams = Object.keys(extras.birthParams).length ? extras.birthParams : specToBirthParams(spec)
  // ONE CREATION, ONE PRICE + IDEMPOTENT: credit-spend and birth happen
  // atomically in the shared service; a retry never double-charges or
  // double-creates, and a failed birth refunds in-place.
  const outcome = await createWorldIdempotent({
    ownerId: auth.playerId!, idempotencyKey, isKeeper,
    birth: {
      ownerId: auth.playerId!, name, baseSlug: slugify(name),
      isPublic: specIsPublic(spec, await hasIpShield(auth.playerId!)),
      ...(Object.keys(worldData).length ? { worldData } : {}),
      ...(Object.keys(worldParams).length ? { worldParams } : {}),
      ...(baseSnapshot !== undefined ? { snapshot: baseSnapshot } : {}),
      ...(extras.forkOfId ? { forkOfId: extras.forkOfId } : {}),
    },
  })
  if (!outcome.ok) {
    if (outcome.reason === 'needPayment') {
      return { type: cmd.type, error: `creating a world costs one build credit ($${GEN_PRICE_USD}) and this account has none. Tell your human: buy credits on the ACCOUNT page (bundles are cheaper), or note the editing membership includes 2 build credits EVERY month. Check the balance anytime with {"type":"credits_read"}.`, buyAt: 'https://cartridge.cafe/account', needPayment: true, buyable: stripeConfigured(), priceUsd: GEN_PRICE_USD, credits: 0 }
    }
    if (outcome.reason === 'inFlight') {
      return { type: cmd.type, error: 'a create with this idempotency key is already in progress — retry in a moment', retryable: true }
    }
    return { type: cmd.type, error: 'world birth failed — nothing was charged (your credit was refunded)' }
  }
  const space = outcome.space, worldToken = outcome.token
  const creditsLeft = isKeeper ? null : await readGenCredits(auth.playerId!)
  // The platform speaks on its own bus: world births announce themselves.
  commonsSystemSay(`⚙ new world born: "${name}" → /space/${space.slug}`, space.slug)
  return { ok: true, created: space.slug, spaceName: name, token: worldToken, private: !space.isPublic,
    ...(creditsLeft !== null ? { creditsLeft } : {}),
    next: `now POST your build commands with Authorization: Bearer ${worldToken} — that key edits "${name}". The world is BORN WITH ITS SLOTS: blank nodes player/world/entities/rules/hud/net already exist — build WITHIN them (dock_node → replace the body → undock; update_step_hook with that hookId) instead of inventing a new anatomy. Skin every field with a visualType or it renders as nothing. Ship worldData.vision + instructions — they are the player-facing soul; declare your acceptance checks so completion can be verified.` }
}

const useWorld: BridgeHandler = async ({ cmd, auth }) => {
  const slug = typeof cmd.slug === 'string' ? cmd.slug.trim() : ''
  const sp = slug ? await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true, name: true, ownerId: true, snapshot: true } }) : null
  if (!sp) return { type: cmd.type, error: `no world "${slug}"` }
  if (sp.ownerId === auth.playerId) {
    const worldToken = await mintWorldToken(sp.id, 'checked out via player key')
    return { ok: true, world: slug, spaceName: sp.name, token: worldToken,
      next: `POST build commands with Authorization: Bearer ${worldToken} to edit "${sp.name}".` }
  }
  // THE SANDBOX JOIN, REGISTERED (Galen, Sep 5: "register the user with
  // an edit slug on the world? So we can investigate mischief"). A
  // non-owner joins through the SAME law + the SAME attribution the
  // browser join door uses: sandbox-open world only, the membership
  // seat, the ban list — and the token is minted AS member:<handle>,
  // so every push lands in __provenance / __nodeHist / the roster
  // under a HUMAN-READABLE identity. Mischief → read the trail →
  // ban the handle (world-bans) + revoke the key.
  const wdJ = ((sp.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData) ?? {}
  const { effectiveBuild } = await import('@/lib/world-policy')
  const { hasIpShield, hasEditingMembership } = await import('@/lib/stripe')
  if (effectiveBuild(wdJ, await hasIpShield(sp.ownerId)) !== 'anyone') {
    return { type: cmd.type, error: `"${sp.name}" is not open to sandbox building (premium or proprietary — its creator's contract holds)` }
  }
  const joiner = await prisma.user.findUnique({ where: { id: auth.playerId! }, select: { email: true } })
  const { handleOf } = await import('@/lib/notify')
  const handle = (joiner?.email ? handleOf(joiner.email) : null) || 'member'
  // handle binds to its first claimer (audit: local-part collision)
  const { claimMemberHandle } = await import('@/lib/member-identity')
  if (!(await claimMemberHandle(sp.id, handle, auth.playerId!))) {
    return { type: cmd.type, error: `the handle "${handle}" belongs to another member on this world` }
  }
  // RE-ENTRY IS FREE (mirror of the browser join door): an existing
  // member of THIS world is never stranded by a lapsed seat — the
  // membership gates NEW joins only.
  const alreadyBuilder = await prisma.spaceToken.findFirst({
    where: { spaceId: sp.id, revokedAt: null, name: `member:${handle}` }, select: { id: true } })
  if (!alreadyBuilder && !(await hasEditingMembership(auth.playerId!))) {
    return { type: cmd.type, error: 'joining another creator’s world takes the editing membership ($10/mo; a first-ever AI pairing gifts 30 days) — your human can join on the ACCOUNT page', needPayment: true }
  }
  const { isBanned } = await import('@/lib/world-bans')
  if (await isBanned(sp.id, handle)) return { type: cmd.type, error: 'you are banned from this world' }
  const worldToken = await mintWorldToken(sp.id, `member:${handle}`)
  return { ok: true, world: slug, spaceName: sp.name, token: worldToken, member: handle,
    next: `You are REGISTERED on "${sp.name}" as member:${handle} — every push you land is attributed (provenance, node history, the roster). Build in NODES beside the existing work; the OG creator governs. POST build commands with Authorization: Bearer ${worldToken}.` }
}

const creditsRead: BridgeHandler = async ({ auth }) => {
  // THE CREDIT TOOL (Galen, Sep 5): the AI reads its human's build-credit
  // balance + prices in one call, so "can I create?" is answerable
  // before a create is refused — and the broke answer is relayable.
  const { readGenCredits, GEN_PRICE_USD, GEN_BUNDLES, stripeConfigured } = await import('@/lib/stripe')
  return { ok: true, type: 'credits_read', credits: await readGenCredits(auth.playerId!),
    priceUsd: GEN_PRICE_USD, bundles: GEN_BUNDLES, buyable: stripeConfigured(),
    buyAt: 'https://cartridge.cafe/account',
    next: 'create_world {name} spends ONE credit (the keeper is exempt). Bundles are cheaper per credit — your human buys them on the account page.' }
}

export const BRIDGE_HANDLERS: Record<string, BridgeHandler> = {
  build_spec_set: buildSpecSet,
  build_status: buildStatus,
  validate_world: validateOrComplete,
  complete_build: validateOrComplete,
  create_world: createWorld,
  use_world: useWorld,
  credits_read: creditsRead,
  ...COMMONS_HANDLERS,
  ...ASSET_HANDLERS,
}

/** verbs that carry their ORIGINAL scope guard + exact refusal message inside
 *  the handler (moved verbatim) — the generic registry scope check skips them. */
const SELF_GUARDED = new Set(Object.keys(COMMONS_HANDLERS))

/** verbs whose legacy blocks were gated `&& isSpaceScoped` — without a space
 *  token they FELL THROUGH (to the player whitelist / global path), never
 *  erred. Dispatch declines (null) to keep that routing byte-identical. */
const SPACE_FALLTHROUGH = new Set([...Object.keys(ASSET_HANDLERS), 'node_feed', 'node_feed_read'])

/** verbs that require a PLAYER key: without one, dispatch declines (null) and
 *  the legacy chain keeps its exact historical behavior for that caller. */
const PLAYER_VERBS = new Set(['create_world', 'use_world', 'credits_read'])

/** Try the handler table. Returns the result to push, or null when the verb is
 *  not migrated (caller falls through to the legacy chain). Scope comes from the
 *  registry: a 'space'/'owner' verb without a space token is refused HERE, once,
 *  instead of per-handler. */
export async function dispatchBridgeCommand(ctx: HandlerCtx): Promise<Record<string, unknown> | null> {
  const verb = String(ctx.cmd.type ?? '')
  const handler = BRIDGE_HANDLERS[verb]
  if (!handler) return null
  if (PLAYER_VERBS.has(verb) && !ctx.auth.playerId) return null // legacy chain keeps its behavior
  if (SPACE_FALLTHROUGH.has(verb) && !ctx.auth.spaceId) return null // `&& isSpaceScoped` legacy routing
  const scope = COMMAND_REGISTRY[verb]?.scope
  if (!SELF_GUARDED.has(verb) && (scope === 'space' || scope === 'owner') && !ctx.auth.spaceId) {
    return { type: verb, error: `${verb} needs a world token (uc_st_) — it acts on a specific world` }
  }
  return handler(ctx)
}
