import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listScenes, loadScene, hydrateAllScenes } from '../store'
import { validateSpaceToken } from '../space-store'
import { validatePlayerToken } from '@/lib/player-token'
import { isAdminToken } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

/**
 * THE PUBLIC LIBRARY — every PUBLIC world's code, readable by anyone, human
 * or AI.
 *
 * Published games and scripts are commons: an AI building its own world learns
 * from every world that came before it. Read-only. PRIVATE worlds are NOT
 * commons (Galen, Aug 26: paid experiences and client work live in private
 * worlds — their source is theirs): a private world is visible here only to
 * its owner (player key or signed-in session), a holder of that world's own
 * uc_st_ token, or the admin. Empty drafts (no fields, no code) are skipped
 * as noise.
 *
 *   GET /api/engine/library                → the catalogue (name, kind, sizes)
 *   GET /api/engine/library?world=<name>   → one world's full source: WGSL
 *       visuals, step-hook code, modules, fields, interaction rules, params.
 *
 * What is NOT here: tokens, owner emails, per-player save state (the
 * __-prefixed worldData blobs).
 */

/** Who is asking? Resolved once per request from the Authorization header
 *  (uc_st_ world token / uc_pt_ player key / admin token) or the browser
 *  session. Everything private is gated on this — anonymous callers see only
 *  the public commons. */
type Viewer = { admin: boolean; userId: string | null; tokenSpaceId: string | null }

async function resolveViewer(req: NextRequest): Promise<Viewer> {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    if (isAdminToken(authHeader, { allowLegacyAnthropicKey: true })) return { admin: true, userId: null, tokenSpaceId: null }
    if (token.startsWith('uc_st_')) {
      const r = await validateSpaceToken(token).catch(() => null)
      if (r) return { admin: false, userId: null, tokenSpaceId: r.spaceId }
    }
    if (token.startsWith('uc_pt_')) {
      const p = await validatePlayerToken(token).catch(() => null)
      if (p) return { admin: false, userId: p.userId, tokenSpaceId: null }
    }
  }
  // browser path: the signed-in owner browsing their own source
  try {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      if (u) return { admin: false, userId: u.id, tokenSpaceId: null }
    }
  } catch { /* headless callers have no session infra — anonymous */ }
  return { admin: false, userId: null, tokenSpaceId: null }
}

/** May this viewer read a PRIVATE space's source? */
function mayRead(v: Viewer, space: { id: string; ownerId: string }): boolean {
  return v.admin || (!!v.userId && v.userId === space.ownerId) || (!!v.tokenSpaceId && v.tokenSpaceId === space.id)
}

type Sceneish = {
  fields?: Array<Record<string, unknown>>
  visualTypes?: Array<{ name?: string; wgsl?: string }>
  stepHooks?: Array<Record<string, unknown>>
  modules?: Array<{ name?: string; wgsl?: string }>
  interactionRules?: unknown[]
  interactionEffects?: unknown[]
  worldParams?: unknown
  worldData?: Record<string, unknown>
}

/** A world reduced to its READABLE SOURCE — code and structure, no play-state. */
function sourceOf(name: string, kind: 'house' | 'space', s: Sceneish, slug?: string) {
  const wd = s.worldData || {}
  return {
    name,
    kind,
    slug,
    instructions: typeof wd.instructions === 'string' ? wd.instructions : undefined,
    creation_brief: wd.creation_brief,
    built_by: typeof wd.built_by === 'string' ? wd.built_by : undefined,
    worldParams: s.worldParams,
    fields: (s.fields || []).map(f => ({
      id: f.id, name: f.name, shapeType: f.shapeType, w: f.w, h: f.h, radius: f.radius,
      visualTypeName: f.visualTypeName, transform: f.transform, properties: f.properties,
      noHit: f.noHit, noCollide: f.noCollide,
    })),
    visualTypes: s.visualTypes || [],
    modules: s.modules || [],
    stepHooks: (s.stepHooks || []).map(h => ({ id: h.id, author: h.author, code: h.code })),
    interactionRules: s.interactionRules || [],
    interactionEffects: s.interactionEffects || [],
  }
}

function sizesOf(s: Sceneish) {
  return {
    visuals: (s.visualTypes || []).length,
    hooks: (s.stepHooks || []).length,
    fields: (s.fields || []).length,
    wgslBytes: (s.visualTypes || []).reduce((a, v) => a + (v.wgsl || '').length, 0),
  }
}

/** Grep one world's source (visual WGSL, step-hook code, module WGSL) for a
 *  needle and return the artifacts that matched, each with a short single-line
 *  snippet around the hit. This is how the library becomes searchable for
 *  PRIMITIVES: an AI hunting a live example of `opSmoothUnion`, a boids hook, or
 *  a superimposed aurora finds the worlds that actually use it — not just a name
 *  it had to already know. Capped per world so one big shader can't flood it. */
function searchScene(s: Sceneish, needle: string): Array<{ where: string; snippet: string }> {
  const hits: Array<{ where: string; snippet: string }> = []
  const scan = (where: string, text: unknown) => {
    if (hits.length >= 6 || typeof text !== 'string') return
    const i = text.toLowerCase().indexOf(needle)
    if (i < 0) return
    const start = Math.max(0, i - 40)
    const snip = text.slice(start, i + needle.length + 40).replace(/\s+/g, ' ').trim()
    hits.push({ where, snippet: (start > 0 ? '…' : '') + snip + '…' })
  }
  for (const v of s.visualTypes || []) scan(`visual:${v.name || '?'}`, v.wgsl)
  for (const h of s.stepHooks || []) {
    const hh = h as { id?: string; author?: string; code?: unknown }
    scan(`hook:${hh.id || hh.author || '?'}`, hh.code)
  }
  for (const m of s.modules || []) scan(`module:${m.name || '?'}`, (m.name || '') + '\n' + (m.wgsl || ''))
  return hits
}

export async function GET(req: NextRequest) {
  await hydrateAllScenes()
  const viewer = await resolveViewer(req)
  const want = req.nextUrl.searchParams.get('world')

  // ── one world's source ──
  if (want) {
    // house scene first (exact name, as listed in the catalogue)
    try {
      const scene = loadScene(want) as unknown as Sceneish | null
      if (scene) return NextResponse.json({ world: sourceOf(want, 'house', scene) })
    } catch { /* not a house scene — fall through to spaces */ }

    // then a space by slug or name — PRIVATE ones only for their own people.
    // A denied private world answers exactly like a missing one (404, same
    // body): existence + name must not leak through the error shape.
    const space = await prisma.playerSpace.findFirst({
      where: {
        OR: [{ slug: want.toLowerCase() }, { name: { equals: want, mode: 'insensitive' } }],
      },
      select: { id: true, ownerId: true, slug: true, name: true, snapshot: true, isPublic: true },
    })
    if (space && (space.isPublic || mayRead(viewer, space))) {
      // IP CONTROL (Galen, Aug 27): a premium holder's worlds are CLOSED
      // SOURCE even when public — playable on the shelf, never readable here.
      // Their own people (owner/member/admin) still read; everyone else gets
      // the same 403 shape regardless of which world it is.
      const { hasIpControl } = await import('@/lib/stripe')
      if (space.isPublic && !mayRead(viewer, space) && await hasIpControl(space.ownerId)) {
        return NextResponse.json({ error: 'closed source — this maker holds IP control' }, { status: 403 })
      }
      const s = (space.snapshot as unknown as Sceneish) || {}
      return NextResponse.json({ world: { ...sourceOf(space.name, 'space', s, space.slug), private: !space.isPublic || undefined } })
    }
    return NextResponse.json({ error: 'World not found in the library' }, { status: 404 })
  }

  // ── content search across every world's source ──
  const searchTerm = req.nextUrl.searchParams.get('search')?.trim()
  if (searchTerm) {
    const needle = searchTerm.toLowerCase()
    const found: Array<Record<string, unknown>> = []
    for (const name of listScenes()) {
      if (name === 'CAFE' || name === 'SUB-MAIN') continue
      let s: Sceneish | null = null
      try { s = loadScene(name) as unknown as Sceneish | null } catch { continue }
      if (!s) continue
      if ((s.worldData as { __private?: boolean } | undefined)?.__private) continue   // unlisted, same as the catalogue
      const matches = searchScene(s, needle)
      if (matches.length) found.push({ name, kind: 'house', ...sizesOf(s), matches })
    }
    const spaces = await prisma.playerSpace.findMany({
      select: { id: true, ownerId: true, slug: true, name: true, snapshot: true, isPublic: true },
    })
    const { hasIpControl: hasIp } = await import('@/lib/stripe')
    const ipCache = new Map<string, boolean>()
    const ownerClosed = async (ownerId: string) => {
      if (!ipCache.has(ownerId)) ipCache.set(ownerId, await hasIp(ownerId))
      return ipCache.get(ownerId)!
    }
    for (const sp of spaces) {
      if (!sp.isPublic && !mayRead(viewer, sp)) continue   // private source never leaks into search
      if (sp.isPublic && !mayRead(viewer, sp) && await ownerClosed(sp.ownerId)) continue   // IP control: closed source never leaks either
      const s = (sp.snapshot as unknown as Sceneish) || {}
      const matches = searchScene(s, needle)
      if (matches.length) {
        found.push({ name: sp.name, kind: 'space', slug: sp.slug, ...(sp.isPublic ? {} : { private: true }), ...sizesOf(s), matches })
      }
    }
    // most-relevant first: the worlds that use the term the most
    found.sort((a, b) => (b.matches as unknown[]).length - (a.matches as unknown[]).length)
    const capped = found.slice(0, 60)
    return NextResponse.json({
      search: searchTerm,
      count: found.length,
      shown: capped.length,
      note: 'worlds whose source contains the term — GET ?world=<name> for full source',
      worlds: capped,
    })
  }

  // ── the catalogue ──
  const worlds: Array<Record<string, unknown>> = []
  for (const name of listScenes()) {
    if ((loadScene(name) as { worldData?: { __private?: boolean } } | undefined)?.worldData?.__private) { continue }   // unlisted
    if (name === 'CAFE' || name === 'SUB-MAIN') continue   // hubs are doors, not games
    try {
      const s = loadScene(name) as unknown as Sceneish | null
      if (s) worlds.push({ name, kind: 'house', ...sizesOf(s) })
    } catch { /* skip unreadable */ }
  }
  const spaces = await prisma.playerSpace.findMany({
    select: { id: true, ownerId: true, slug: true, name: true, snapshot: true, isPublic: true },
  })
  for (const sp of spaces) {
    // private worlds don't exist here for strangers — even the name/slug can
    // be a client's project codename
    if (!sp.isPublic && !mayRead(viewer, sp)) continue
    const s = (sp.snapshot as unknown as Sceneish) || {}
    const sz = sizesOf(s)
    // empty drafts are noise, not components — a private world earns its
    // library card by containing actual code/structure
    if (!sp.isPublic && sz.visuals === 0 && sz.hooks === 0 && sz.fields === 0) continue
    worlds.push({ name: sp.name, kind: 'space', slug: sp.slug, ...(sp.isPublic ? {} : { private: true }), ...sz })
  }
  return NextResponse.json({
    library: 'every PUBLIC world\'s code is commons — GET ?world=<name> for full source',
    count: worlds.length,
    worlds,
  })
}
