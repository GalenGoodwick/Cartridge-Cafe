import { isAdmin } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'
import { createSpaceUniqueSlug, canCreateWorld } from '@/lib/world-create'
import { usersByHandle } from '@/lib/notify'
import { hydrateAllScenes, listScenes, loadScene } from '../../engine/store'
import {
  latestBranchPerLine, branchOriginMarker, forkNameFor, type ParsedBranch,
} from '@/lib/branch-to-fork'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** BRANCH → FORK back-fill. Every legacy branch scene (`BASE ⑂ handle · vN`) is
 *  ownerless — the brancher never got a world of their own (see
 *  api/engine/scene/route.ts). This mints each brancher a PRIVATE playerSpace
 *  fork of the base, seeded from their latest branch snapshot, so retiring the
 *  branch paradigm doesn't strand anyone's work.
 *
 *  GET  → DRY RUN: the plan + diagnostics, creates nothing.
 *  POST { confirm: true } → executes idempotently (re-runnable; a fork already
 *        stamped with the branch-origin marker is skipped, never duplicated).
 *  Admin only. */

type PlanItem = {
  scene: string
  base: string
  handle: string
  forkName: string
  ownerId: string | null
  ownerEmail: string | null
  baseSpaceId: string | null      // forkOf target, if the base is a real playerSpace
  status: 'ready' | 'exists' | 'unresolved-handle' | 'ambiguous-handle' | 'over-cap' | 'no-snapshot'
  note?: string
}

async function ownerAlreadyHasFork(ownerId: string, marker: string): Promise<boolean> {
  // Owner worlds are capped at 100 — a scan is cheap and avoids JSON-column
  // query gymnastics. Match on the branch-origin marker we stamp at creation.
  const rows = await prisma.playerSpace.findMany({
    where: { ownerId }, select: { snapshot: true },
  })
  for (const r of rows) {
    const wd = (r.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData
    if (wd && wd.__branchOrigin === marker) return true
  }
  return false
}

async function buildPlan(): Promise<{ items: PlanItem[]; scannedScenes: number; branchLines: number }> {
  await hydrateAllScenes()
  const all = listScenes()
  const lines = latestBranchPerLine(all)

  // resolve base playerSpaces in one pass (slugified base name → space)
  const baseSlugs = [...new Set(lines.map(l => slugify(l.base)))]
  const bases = baseSlugs.length
    ? await prisma.playerSpace.findMany({ where: { slug: { in: baseSlugs } }, select: { id: true, slug: true } })
    : []
  const baseBySlug = new Map(bases.map(b => [b.slug, b.id]))

  const items: PlanItem[] = []
  for (const p of lines) {
    const marker = branchOriginMarker(p)
    const baseSpaceId = baseBySlug.get(slugify(p.base)) ?? null
    const base: Omit<PlanItem, 'status' | 'note' | 'ownerId' | 'ownerEmail'> = {
      scene: p.scene, base: p.base, handle: p.handle, forkName: forkNameFor(p), baseSpaceId,
    }
    const users = await usersByHandle(p.handle)
    if (users.length === 0) { items.push({ ...base, ownerId: null, ownerEmail: null, status: 'unresolved-handle' }); continue }
    if (users.length > 1)  { items.push({ ...base, ownerId: null, ownerEmail: null, status: 'ambiguous-handle', note: `${users.length} users share this handle` }); continue }
    const u = users[0]
    if (!loadScene(p.scene)) { items.push({ ...base, ownerId: u.id, ownerEmail: u.email, status: 'no-snapshot' }); continue }
    if (await ownerAlreadyHasFork(u.id, marker)) { items.push({ ...base, ownerId: u.id, ownerEmail: u.email, status: 'exists' }); continue }
    const gate = await canCreateWorld(u.id)
    if (!gate.ok) { items.push({ ...base, ownerId: u.id, ownerEmail: u.email, status: 'over-cap', note: gate.error }); continue }
    items.push({ ...base, ownerId: u.id, ownerEmail: u.email, status: 'ready' })
  }
  return { items, scannedScenes: all.length, branchLines: lines.length }
}

function summarize(items: PlanItem[]) {
  const by: Record<string, number> = {}
  for (const it of items) by[it.status] = (by[it.status] || 0) + 1
  return by
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const { items, scannedScenes, branchLines } = await buildPlan()
  return NextResponse.json({ dryRun: true, scannedScenes, branchLines, willCreate: summarize(items).ready ?? 0, summary: summarize(items), items })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  const body = await req.json().catch(() => null) as { confirm?: boolean } | null
  if (!body?.confirm) return NextResponse.json({ error: 'pass { confirm: true } to execute — GET first for the dry-run plan' }, { status: 400 })

  const { items } = await buildPlan()
  const created: Array<{ slug: string; owner: string; from: string }> = []
  const failed: Array<{ scene: string; error: string }> = []

  for (const it of items) {
    if (it.status !== 'ready' || !it.ownerId) continue
    const snap = loadScene(it.scene)
    if (!snap) { failed.push({ scene: it.scene, error: 'snapshot vanished mid-run' }); continue }
    // deep-clone + stamp the idempotency marker and lineage crumb into worldData
    const cloned = JSON.parse(JSON.stringify(snap)) as { worldData?: Record<string, unknown> }
    cloned.worldData = { ...(cloned.worldData || {}) }
    cloned.worldData.__branchOrigin = branchOriginMarker({ base: it.base, handle: it.handle } as ParsedBranch)
    cloned.worldData.__branchedFrom = it.base
    try {
      const space = await createSpaceUniqueSlug(slugify(it.forkName), (slug) => ({
        name: it.forkName,
        slug,
        ownerId: it.ownerId!,
        isPublic: false,                                   // even if private — the requirement
        forkOfId: it.baseSpaceId ?? null,                  // real lineage when the base is a playerSpace
        description: `Forked from ${it.base} (migrated from branch)`,
        snapshot: cloned as unknown as Prisma.InputJsonValue,
      }))
      // lineage rung: version 1 = what the branch held at migration time
      await prisma.spaceVersion.create({
        data: { spaceId: space.id, version: 1, snapshot: cloned as unknown as Prisma.InputJsonValue, authorId: it.ownerId!, note: `Migrated from branch ${it.scene}` },
      }).catch(() => { /* version is provenance, not load-bearing — never fail the create on it */ })
      created.push({ slug: space.slug, owner: it.ownerEmail || it.ownerId!, from: it.base })
    } catch (e) {
      failed.push({ scene: it.scene, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({ ok: true, created: created.length, failed: failed.length, createdWorlds: created, failures: failed, skipped: summarize(items) })
}
