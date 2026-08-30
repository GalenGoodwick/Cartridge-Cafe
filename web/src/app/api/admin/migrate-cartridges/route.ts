import fs from 'fs/promises'
import path from 'path'
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
 *  it reads the bundled cartridges, classifies them, and — only on POST — mints
 *  a DB space for each ORPHAN game (one with no existing space of that slug).
 *  GET = dry run (no writes). Deleting the dead fork files + retiring the scene
 *  loader is a separate git change, done AFTER the spaces exist. */

const CART_DIR = () => path.join(process.cwd(), 'public', 'cartridges')

// structural chrome — NOT games, never migrated (app scaffolding + the index)
function isStructural(name: string): boolean {
  const u = name.toUpperCase()
  return name === 'index' || u === 'CAFE' || u === 'MAIN' || u === 'MAIN-COMMONS' ||
    u === 'SUB-MAIN' || u === 'BLANK' || u.startsWith('CAFE ⑂')
}
// legacy branch/fork snapshots (NAME ⑂ handle · v1) — dead artifacts, delete-in-repo
function isFork(name: string): boolean { return name.includes(' ⑂ ') }

async function cartridgeNames(): Promise<string[]> {
  const files = await fs.readdir(CART_DIR())
  return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
}

interface GameRow { name: string; slug: string; twin: boolean; twinSlug?: string }

async function classify(): Promise<{ structural: string[]; forks: string[]; games: GameRow[] }> {
  const names = await cartridgeNames()
  const structural = names.filter(isStructural)
  const forks = names.filter(n => !isStructural(n) && isFork(n))
  const gameNames = names.filter(n => !isStructural(n) && !isFork(n))
  const games: GameRow[] = []
  for (const name of gameNames) {
    const slug = slugify(name)
    const existing = await prisma.playerSpace.findUnique({ where: { slug }, select: { slug: true } })
    games.push({ name, slug, twin: !!existing, twinSlug: existing?.slug })
  }
  return { structural, forks, games }
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const { structural, forks, games } = await classify()
  const orphans = games.filter(g => !g.twin)
  const twins = games.filter(g => g.twin)
  return NextResponse.json({
    dryRun: true,
    summary: { cartridges: structural.length + forks.length + games.length, structural: structural.length, deadForks: forks.length, games: games.length, twins: twins.length, orphansToCreate: orphans.length },
    orphansToCreate: orphans.map(o => ({ name: o.name, slug: o.slug })),
    twinsToRepoint: twins.map(t => ({ name: t.name, slug: t.slug })),
    deadForksToDelete: forks,
    structuralKept: structural,
  })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  const owner = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null
  if (!owner) return NextResponse.json({ error: 'need a signed-in admin to own the migrated worlds' }, { status: 400 })

  const { games } = await classify()
  const orphans = games.filter(g => !g.twin)
  const created: Array<{ name: string; slug: string }> = []
  const failed: Array<{ name: string; error: string }> = []
  for (const o of orphans) {
    try {
      const raw = await fs.readFile(path.join(CART_DIR(), o.name + '.json'), 'utf8')
      const snapshot = JSON.parse(raw) as Record<string, unknown>
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
