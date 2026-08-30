import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdmin } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'
import { createSpaceUniqueSlug } from '@/lib/world-create'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** CARTRIDGE → SPACE MIGRATION (Galen, Aug 30: "remove scene pathway, migrate
 *  to space first"). The house-cartridge (scene) path is the legacy second way
 *  to open a world; consolidating on DB spaces kills the double path (and the
 *  scope-mismatch class of bug). This endpoint is the SAFE, dedupe-first half:
 *  it reads the bundled cartridges over HTTP (public/ is NOT in the serverless
 *  fs bundle on Vercel — fs.readFile fails there), classifies them, and — only
 *  on POST — mints a DB space for each ORPHAN game (no existing space of that
 *  slug). GET = dry run (no writes). Deleting the dead fork files + retiring the
 *  scene loader is a separate git change, done AFTER the spaces exist. */

// structural chrome in the index — NOT games, never migrated
function isStructural(name: string): boolean {
  const u = name.toUpperCase()
  return u === 'BLANK' || u === 'MAIN-COMMONS' || u === 'MAIN' || u === 'SUB-MAIN' ||
    u === 'CAFE' || u === 'INDEX' || u.startsWith('CAFE ⑂')
}

async function cartridgeNames(origin: string): Promise<string[]> {
  const r = await fetch(`${origin}/cartridges/index.json`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`index.json ${r.status}`)
  const j = (await r.json()) as { names?: string[] }
  return Array.isArray(j.names) ? j.names : []
}

async function fetchCartridge(origin: string, name: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${origin}/cartridges/${encodeURIComponent(name)}.json`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`${name}.json ${r.status}`)
  return (await r.json()) as Record<string, unknown>
}

interface GameRow { name: string; slug: string; twin: boolean }

async function classify(origin: string): Promise<{ structural: string[]; games: GameRow[] }> {
  const names = await cartridgeNames(origin)
  const structural = names.filter(isStructural)
  const gameNames = names.filter(n => !isStructural(n))
  const games: GameRow[] = []
  for (const name of gameNames) {
    const slug = slugify(name)
    const existing = await prisma.playerSpace.findUnique({ where: { slug }, select: { slug: true } })
    games.push({ name, slug, twin: !!existing })
  }
  return { structural, games }
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  try {
    const { structural, games } = await classify(req.nextUrl.origin)
    const orphans = games.filter(g => !g.twin)
    const twins = games.filter(g => g.twin)
    return NextResponse.json({
      dryRun: true,
      summary: { games: games.length, structural: structural.length, deadForks: 0, twins: twins.length, orphansToCreate: orphans.length, cartridges: games.length + structural.length },
      orphansToCreate: orphans.map(o => ({ name: o.name, slug: o.slug })),
      twinsToRepoint: twins.map(t => ({ name: t.name, slug: t.slug })),
      deadForksToDelete: [],
      structuralKept: structural,
    })
  } catch (e) {
    return NextResponse.json({ error: 'dry run failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  const owner = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null
  if (!owner) return NextResponse.json({ error: 'need a signed-in admin to own the migrated worlds' }, { status: 400 })

  const origin = req.nextUrl.origin
  const { games } = await classify(origin)
  const orphans = games.filter(g => !g.twin)
  const created: Array<{ name: string; slug: string }> = []
  const failed: Array<{ name: string; error: string }> = []
  for (const o of orphans) {
    try {
      const snapshot = await fetchCartridge(origin, o.name)
      const space = await createSpaceUniqueSlug(o.slug, (s) => ({
        name: (typeof snapshot.name === 'string' && snapshot.name) || o.name,
        slug: s,
        ownerId: owner.id,
        isPublic: false,   // born private — the keeper publishes when ready
        description: 'migrated from a house cartridge',
        snapshot: snapshot as Prisma.InputJsonValue,
      }))
      created.push({ name: o.name, slug: space.slug })
    } catch (e) {
      failed.push({ name: o.name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: true, created, failed, createdCount: created.length })
}
