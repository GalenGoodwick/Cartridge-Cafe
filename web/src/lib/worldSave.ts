// worldSave.ts — the UNIFIED SAVE HOLDER for a world.
//
// A world's persistent state was scattered across stores with no common owner,
// so a "reset" only ever cleared ONE of them (worldData.__tg) and left the rest
// (triggers, chapters, the version-tournament, per-player saves) dirty — a
// half-reset every time. This module is the single authority: it KNOWS every
// store a world uses, categorizes them, and offers one coherent reset/manifest.
//
// The category law:
//   CONTENT — the buildable world (fields/visuals/hooks/modules snapshot arrays)
//             + CONFIG keys (icon, instructions, flags). NEVER wiped by a reset;
//             this is the world itself, and it's what versions capture.
//   GAME    — runtime/progress state (the puzzle: __tg/__trig/__chapters/edges,
//             the whiteboard, quarantine/error scratch). Wiped by a reset.
//   PLAYER  — per-user progress (worldData.save, when persist). Wiped only on a
//             deep reset (clearPlayer), since it's each person's own progress.
//   SOCIAL  — the version-tournament, cell, chat, flags. Community state in
//             engineSlots, NOT in worldData. Wiped only on clearSocial.
//
// New games should keep ALL their shared state under `worldData.game` (a single
// object) so it resets as one unit; the legacy scattered keys below are cleared
// too, so nothing built before this migrates cleanly.

import { prisma } from '@/lib/prisma'
import { getSpaceSnapshot, applyCommandToSnapshot } from '@/app/api/engine/space-store'
import { deleteGameSlot } from '@/app/api/engine/store'
import { GAME_STATE_KEYS, PRESERVED_KEYS } from '@/lib/gameStateKeys'

export { GAME_STATE_KEYS, PRESERVED_KEYS }

export interface ResetOpts {
  clearPlayer?: boolean   // also wipe per-user progress (worldData.save)
  clearSocial?: boolean   // also wipe the version-tournament / cell slots
}

export interface ResetResult {
  ok: boolean
  error?: string
  cleared: string[]       // worldData keys wiped
  social: string[]        // engineSlots wiped
  rev: number             // the new __bridge_rev (so callers know open tabs must reload)
}

/** THE reset. Clears a world's GAME state (and optionally player + social) in
 *  one coherent pass, preserving CONTENT/CONFIG. Applied through the snapshot
 *  mutator so __bridge_rev bumps — open tabs then reload instead of syncing the
 *  old state back over the reset. */
export async function resetWorld(spaceId: string, opts: ResetOpts = {}): Promise<ResetResult> {
  const snap = await getSpaceSnapshot(spaceId, true)
  if (!snap) return { ok: false, error: 'no snapshot', cleared: [], social: [], rev: 0 }
  const wd = (snap.worldData ?? {}) as Record<string, unknown>

  // the world may declare extra reset keys (worldData.__resets); honor them, but
  // never let a declaration wipe a preserved CONFIG key.
  const declared = (Array.isArray(wd.__resets) ? (wd.__resets as string[]) : [])
  const targets = new Set<string>([...GAME_STATE_KEYS, ...declared])
  if (opts.clearPlayer) targets.add('save')
  const dataNull: Record<string, unknown> = {}
  for (const k of targets) {
    if (PRESERVED_KEYS.has(k)) continue
    if (k in wd) dataNull[k] = null   // set_world_data null = delete (documented contract)
  }

  // apply through the bridge mutator (bumps __bridge_rev, persists, invalidates cache)
  await applyCommandToSnapshot(spaceId, { type: 'set_world_data', data: dataNull })

  const social: string[] = []
  if (opts.clearSocial) {
    const sp = await prisma.playerSpace.findUnique({ where: { id: spaceId }, select: { slug: true, name: true } })
    if (sp) {
      const up = (sp.name || '').toUpperCase()
      for (const slot of [`tournament:space:${sp.slug}`, `cell:${up}`]) {
        try { if (await deleteGameSlot(slot)) social.push(slot) } catch { /* best-effort */ }
      }
    }
  }

  const after = await getSpaceSnapshot(spaceId, true)
  const rev = Number((after?.worldData as Record<string, unknown> | undefined)?.__bridge_rev) || 0
  return { ok: true, cleared: Object.keys(dataNull), social, rev }
}

/** A MANIFEST of every store a world touches — so a reset (or a human) is never
 *  guessing where state lives. Read-only. */
export async function worldStores(spaceId: string): Promise<Record<string, unknown>> {
  const snap = await getSpaceSnapshot(spaceId, true)
  const wd = (snap?.worldData ?? {}) as Record<string, unknown>
  const sp = await prisma.playerSpace.findUnique({ where: { id: spaceId }, select: { slug: true, name: true } })
  const up = (sp?.name || '').toUpperCase()
  const keys = Object.keys(wd)
  const gameKeys = keys.filter(k => (GAME_STATE_KEYS as readonly string[]).includes(k) || (Array.isArray(wd.__resets) && (wd.__resets as string[]).includes(k)))
  const versions = sp ? await prisma.spaceVersion.count({ where: { spaceId } }).catch(() => 0) : 0
  return {
    snapshot: {
      content: { fields: (snap?.fields ?? []).length, visualTypes: (snap?.visualTypes ?? []).length, stepHooks: (snap?.stepHooks ?? []).length, modules: (snap?.modules ?? []).length },
      configKeys: keys.filter(k => PRESERVED_KEYS.has(k)),
      gameKeys,
      hasUnifiedHolder: 'game' in wd,
      persist: !!wd.persist,
    },
    versions,
    social: { versionTournament: `tournament:space:${sp?.slug}`, cell: `cell:${up}` },
    perPlayer: wd.persist ? 'worldData.save (per user, per world)' : null,
  }
}
