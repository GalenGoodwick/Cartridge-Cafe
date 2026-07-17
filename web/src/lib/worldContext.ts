// worldContext — the single source of truth for "what am I looking at, and what
// does it let me do." Every chrome control on the site is a function of the four
// orthogonal axes below. Today those axes are re-derived ad hoc in FieldEngine
// (spaceId / onBranchScene / isHub / riding / isOwner / me-handle / versionView)
// AND separately in SpaceToolbar. This module computes them ONCE so one
// <WorldChrome> and one vote module can render from the result.
//
// See DESIGN-unified-chrome.md.

/** a navigation shell (main / sub-main / my-worlds) vs standing inside a world */
export type Surface = 'hub' | 'world'

/** what the loaded world IS. Drives which store backs its versions/keys. */
export type WorldKind =
  | 'house'    // a canonical house scene (CAFE, HELIOS, LIGHTHOUSE, FLUID …)
  | 'branch'   // a cafe-shell branch scene: `BASE ⑂ handle · label · vN`
  | 'space'    // a DB-backed player space: /space/<slug>
  | 'winner'   // a frozen election podium copy: `BASE ⑂ winner · vN`

/** your standing relative to the loaded world */
export type Role = 'anon' | 'juror' | 'ownerSpace' | 'ownerBranch'

/** the temporal slice being shown */
export type WorldView = 'live' | 'version' | 'branchHead' | 'readonlySave'

export interface WorldIdentity {
  /** the base world name before ' ⑂ ' (e.g. "LIGHTHOUSE") */
  base: string
  /** branch author handle, if kind === 'branch' | 'winner' */
  author?: string
  /** branch label (the segments between handle and version), if any */
  label?: string
  /** version number parsed off the name, if any */
  version?: number
  /** the DB slug, if kind === 'space' */
  slug?: string
  /** the full loadable scene/space name currently shown */
  loaded: string
}

export interface Lineage {
  original: string
  mainHolder: string
}

export interface WorldContext {
  surface: Surface
  kind: WorldKind
  role: Role
  view: WorldView
  identity: WorldIdentity
  lineage: Lineage | null
}

/** capabilities — the boolean tangle, tabulated once. `can(ctx, x)` replaces
 *  the scattered `spaceId && …` / `lastScene.includes(' ⑂ ') && ownIt` gates. */
export type Capability =
  | 'toolsPanel'    // the ⚙ WORLD TOOLS panel is offered (any viewer of a space/branch; sections inside are owner-gated)
  | 'worldTools'    // the owner-only editing sections of that panel
  | 'mintKey'       // mint an AI edit token (type varies by kind)
  | 'versions'      // open the version/save-point history (view is universal)
  | 'setHead'       // crown a version the head / make-this-live / restore
  | 'makeIcon'      // have an AI author the shelf-bubble icon shader
  | 'createBranch'  // open a new branch/challenger
  | 'deleteWorld'   // remove this world
  | 'vote'          // cast in the tournament (universal — even anon is prompted)
  | 'editLaw'       // toggle multiplayer / restart-with-R
  | 'alterLive'     // plug an AI straight into live main (space owner only)

const isOwner = (r: Role) => r === 'ownerSpace' || r === 'ownerBranch'

/** the capability table (see DESIGN-unified-chrome.md). A feature is granted by
 *  WHAT the world is + your role, never by which shell rendered it — which is
 *  exactly what closes the branch-vs-space capability gaps. */
export function can(ctx: WorldContext, cap: Capability): boolean {
  const { kind, role, view } = ctx
  // a read-only slice (a save point / an old version) grants no mutations
  const mutable = view === 'live' || view === 'branchHead'
  switch (cap) {
    case 'vote':         return true
    case 'createBranch': return ctx.surface === 'world'
    case 'versions':     return ctx.surface === 'world'
    case 'toolsPanel':   return kind === 'space' || kind === 'branch'   // offered to any viewer; sections inside gate on ownership
    case 'worldTools':   return isOwner(role) && (kind === 'space' || kind === 'branch')
    case 'editLaw':      return isOwner(role) && (kind === 'space' || kind === 'branch') && mutable
    case 'mintKey':      return isOwner(role) && (kind === 'space' || kind === 'branch')
    case 'setHead':      return isOwner(role) && (kind === 'space' || kind === 'branch') && mutable
    case 'makeIcon':     return isOwner(role) && (kind === 'space' || kind === 'branch')
    case 'deleteWorld':  return isOwner(role) && (kind === 'space' || kind === 'branch')
    case 'alterLive':    return role === 'ownerSpace' && kind === 'space' && view === 'live'
    default:             return false
  }
}

/** which AI-edit token a Connect action mints for this world. */
export function tokenKind(ctx: WorldContext): 'space' | 'branch' | null {
  if (ctx.kind === 'space') return 'space'   // uc_st_
  if (ctx.kind === 'branch') return 'branch' // uc_sc_
  return null                                 // house/winner: admin-only
}

// ─── deriving the context ───

const BRANCH_SEP = ' ⑂ '   // ' ⑂ '

/** parse a loaded scene/space descriptor into identity + kind. `slug` is set
 *  when the caller knows it's a DB space (the /space/<slug> route). */
export function identify(loaded: string, slug?: string): { kind: WorldKind; identity: WorldIdentity } {
  if (slug) {
    return { kind: 'space', identity: { base: loaded || slug, slug, loaded: loaded || slug } }
  }
  const bi = loaded.indexOf(BRANCH_SEP)
  if (bi < 0) {
    return { kind: 'house', identity: { base: loaded, loaded } }
  }
  const base = loaded.slice(0, bi)
  const rest = loaded.slice(bi + BRANCH_SEP.length)
  const segs = rest.split(' · ')
  const author = segs[0].trim()                 // handle up to first ' · '
  const vm = loaded.match(/ · v(\d+)$/)
  const version = vm ? parseInt(vm[1], 10) : undefined
  // label = the segments between the handle and the trailing vN (if present)
  const mid = vm ? segs.slice(1, -1) : segs.slice(1)
  const label = mid.join(' · ').trim() || undefined
  const kind: WorldKind = author === 'winner' ? 'winner' : 'branch'
  return { kind, identity: { base, author, label, version, loaded } }
}

/** the sanitized handle for the signed-in email (matches scene-auth). */
export function handleOf(email: string | null | undefined): string | null {
  if (!email) return null
  return email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
}

/** compute the full context from the raw signals a page already has. Pure — the
 *  React hook (useWorldContext) is a thin wrapper that feeds it live state. */
export function deriveContext(args: {
  surface: Surface
  loaded: string             // the scene/space name in view
  slug?: string              // set on /space/<slug>
  email?: string | null      // signed-in identity
  spaceOwnerId?: string | null
  myUserId?: string | null
  versionView?: number | undefined  // viewing a save point
  riding?: boolean           // viewing a branch as a juror
  lineage?: Lineage | null
}): WorldContext {
  const { kind, identity } = identify(args.loaded, args.slug)
  const myHandle = handleOf(args.email)

  let role: Role = 'anon'
  if (kind === 'space') {
    if (args.spaceOwnerId && args.myUserId && args.spaceOwnerId === args.myUserId) role = 'ownerSpace'
    else if (args.riding) role = 'juror'
  } else if (kind === 'branch') {
    if (myHandle && identity.author === myHandle) role = 'ownerBranch'
    else if (args.riding) role = 'juror'
  } else if (args.riding) {
    role = 'juror'
  }

  let view: WorldView = 'live'
  if (args.versionView !== undefined) view = kind === 'space' ? 'readonlySave' : 'version'
  else if (kind === 'branch' || kind === 'winner') view = 'branchHead'

  return { surface: args.surface, kind, role, identity, view, lineage: args.lineage ?? null }
}

// ─── the one vote module's roster ───

/** who competes in the vote for this context. main/sub-main/mine vote over
 *  WORLDS; a world votes over its BRANCHES; a space votes over its SAVE-POINTS.
 *  The reckoning UI, the TDoc, and the quorum law are identical across all of
 *  them — only this roster differs. `worlds` is the caller's already-known list
 *  (shelf bubbles / pinned shelf / your worlds / a space's versions); branch
 *  arenas self-fetch and pass null here so TournamentBar uses `branchesOf`. */
export interface VoteRoster {
  slot: string
  worlds: string[] | null    // null = self-fetch the branch family (branchesOf)
  branchesOf: string | null
}

export function rosterFor(ctx: WorldContext, opts: {
  hubMode?: 'main' | 'mine' | 'submain'
  subSlug?: string
  mineWho?: string
  worlds?: string[]          // shelf/pinned/mine bubbles, or a space's versions
}): VoteRoster {
  if (ctx.surface === 'hub') {
    if (opts.hubMode === 'mine') return { slot: `tournament:mine:${opts.mineWho ?? ''}`, worlds: opts.worlds ?? [], branchesOf: null }
    if (opts.hubMode === 'submain') return { slot: opts.subSlug ? `tournament:sub:${opts.subSlug}` : 'tournament:submain', worlds: opts.worlds ?? [], branchesOf: null }
    return { slot: 'tournament:main', worlds: opts.worlds ?? [], branchesOf: null }
  }
  // inside a world:
  if (ctx.kind === 'space') {
    // a space votes over LIVE vs its own save-points (caller supplies the list)
    return { slot: `tournament:space:${ctx.identity.slug}`, worlds: opts.worlds ?? [], branchesOf: null }
  }
  // a house/branch world votes over its branch family — self-fetched
  return { slot: `tournament:world:${ctx.identity.base.toUpperCase()}`, worlds: null, branchesOf: ctx.identity.base }
}
