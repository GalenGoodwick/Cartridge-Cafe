// worldSave.ts — the UNIFIED SAVE HOLDER for a world.
//
// THE THREE RESETS (deliberate, distinct contracts — audit #11):
//   1. resetWorld (HERE) — the OWNER's game-state reset: category law below
//      (restore PROGRESS from __original, clear DERIVED, never touch CONFIG).
//   2. {type:'reset'} bridge command — the guide's documented NUCLEAR reset:
//      "clears everything" (space-store case 'reset'). A builder verb for
//      wipe-and-rebuild; it obeys no category law BY CONTRACT.
//   3. resetStore() — the GLOBAL engine-store wipe (admin/scene tooling only).
// Same word, three operations. Do not "unify" them — renaming would break the
// documented builder contract; this header is the map.
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
import { PRESERVED_KEYS, resetPatch, captureOriginal, progressKeysOf } from '@/lib/gameStateKeys'

export interface ResetOpts {
  clearPlayer?: boolean   // also wipe per-user progress (worldData.save)
  clearSocial?: boolean   // also wipe the version-tournament / cell slots
}

export interface ResetResult {
  ok: boolean
  error?: string
  cleared: string[]              // worldData keys wiped or restored
  restoredFromOriginal?: boolean // true if a captured __original was restored (vs cleared)
  social: string[]               // engineSlots wiped
  rev: number                    // the new __bridge_rev (so callers know open tabs must reload)
}

/** THE reset. Returns a world's GAME state to its ORIGINAL (restores from
 *  worldData.__original if the world captured one, else clears so the hook
 *  re-inits its defaults), clearing DERIVED keys, preserving CONTENT/CONFIG.
 *  Optionally wipes per-player + social. Applied through the snapshot mutator so
 *  __bridge_rev bumps — open tabs reload instead of syncing old state back. */
export async function resetWorld(spaceId: string, opts: ResetOpts = {}): Promise<ResetResult> {
  const snap = await getSpaceSnapshot(spaceId, true)
  if (!snap) return { ok: false, error: 'no snapshot', cleared: [], social: [], rev: 0 }
  const wd = (snap.worldData ?? {}) as Record<string, unknown>

  // one patch: restore-from-original where defined, delete otherwise (see
  // gameStateKeys.resetPatch — shared verbatim with the client R-key path).
  const patch = resetPatch(wd, { clearPlayer: opts.clearPlayer })

  // apply through the bridge mutator (bumps __bridge_rev, persists, invalidates cache)
  await applyCommandToSnapshot(spaceId, { type: 'set_world_data', data: patch })

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
  const restored = wd.__original && typeof wd.__original === 'object'
  return { ok: true, cleared: Object.keys(patch), restoredFromOriginal: !!restored, social, rev }
}

/** Capture the world's CURRENT progress state as its canonical ORIGINAL, so a
 *  later reset returns to exactly this (not just an empty re-init). The owner
 *  calls this once the world is in its intended starting state. */
export async function setOriginal(spaceId: string): Promise<{ ok: boolean; error?: string; captured: string[] }> {
  const snap = await getSpaceSnapshot(spaceId, true)
  if (!snap) return { ok: false, error: 'no snapshot', captured: [] }
  const wd = (snap.worldData ?? {}) as Record<string, unknown>
  const original = captureOriginal(wd)
  await applyCommandToSnapshot(spaceId, { type: 'set_world_data', data: { __original: original } })
  return { ok: true, captured: Object.keys(original) }
}

/** A MANIFEST of every store a world touches — so a reset (or a human) is never
 *  guessing where state lives. Read-only. */
export async function worldStores(spaceId: string): Promise<Record<string, unknown>> {
  const snap = await getSpaceSnapshot(spaceId, true)
  const wd = (snap?.worldData ?? {}) as Record<string, unknown>
  const sp = await prisma.playerSpace.findUnique({ where: { id: spaceId }, select: { slug: true, name: true } })
  const up = (sp?.name || '').toUpperCase()
  const keys = Object.keys(wd)
  const gameKeys = progressKeysOf(wd)
  const versions = sp ? await prisma.spaceVersion.count({ where: { spaceId } }).catch(() => 0) : 0
  return {
    snapshot: {
      hasOriginal: '__original' in wd,
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
