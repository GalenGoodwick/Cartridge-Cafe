import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { listScenes, loadScene } from '../store'

export const dynamic = 'force-dynamic'

/**
 * THE PUBLIC LIBRARY — every world's code, readable by anyone, human or AI.
 *
 * All games and scripts on the shelf are commons: an AI building its own world
 * learns from every world that came before it. Read-only. Private drafts
 * (isPublic=false spaces) stay out until their owner opens them.
 *
 *   GET /api/engine/library                → the catalogue (name, kind, sizes)
 *   GET /api/engine/library?world=<name>   → one world's full source: WGSL
 *       visuals, step-hook code, modules, fields, interaction rules, params.
 *
 * What is NOT here: tokens, owner emails, per-player save state (the
 * __-prefixed worldData blobs), or anything from private spaces.
 */

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

export async function GET(req: NextRequest) {
  const want = req.nextUrl.searchParams.get('world')

  // ── one world's source ──
  if (want) {
    // house scene first (exact name, as listed in the catalogue)
    try {
      const scene = loadScene(want) as unknown as Sceneish | null
      if (scene) return NextResponse.json({ world: sourceOf(want, 'house', scene) })
    } catch { /* not a house scene — fall through to spaces */ }

    // then a PUBLIC space, by slug or name (case-insensitive)
    const space = await prisma.playerSpace.findFirst({
      where: {
        isPublic: true,
        OR: [{ slug: want.toLowerCase() }, { name: { equals: want, mode: 'insensitive' } }],
      },
      select: { slug: true, name: true, snapshot: true },
    })
    if (space) {
      const s = (space.snapshot as unknown as Sceneish) || {}
      return NextResponse.json({ world: sourceOf(space.name, 'space', s, space.slug) })
    }
    return NextResponse.json({ error: 'World not found in the library (private drafts are not listed)' }, { status: 404 })
  }

  // ── the catalogue ──
  const worlds: Array<Record<string, unknown>> = []
  for (const name of listScenes()) {
    if (name === 'CAFE' || name === 'SUB-MAIN') continue   // hubs are doors, not games
    try {
      const s = loadScene(name) as unknown as Sceneish | null
      if (s) worlds.push({ name, kind: 'house', ...sizesOf(s) })
    } catch { /* skip unreadable */ }
  }
  const spaces = await prisma.playerSpace.findMany({
    where: { isPublic: true },
    select: { slug: true, name: true, snapshot: true },
  })
  for (const sp of spaces) {
    const s = (sp.snapshot as unknown as Sceneish) || {}
    worlds.push({ name: sp.name, kind: 'space', slug: sp.slug, ...sizesOf(s) })
  }
  return NextResponse.json({
    library: 'every world\'s code is commons — GET ?world=<name> for full source',
    count: worlds.length,
    worlds,
  })
}
