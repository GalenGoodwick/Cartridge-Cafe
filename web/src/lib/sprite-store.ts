// SPRITE STORE — per-world uploaded pixel art (Galen, Aug 26 post-Fortis:
// "sprite pipeline and ui for sprite viewing/upload to rip … animated sprite
// sheet uploads"). ONE pipeline for every entry path (universal-pipelines law):
// the bridge commands (define_sprite/define_sheet) and the owner UI both land
// here.
//
// Pixels live in the slot store (`sprites:<spaceId>` — the icon-PNG precedent),
// NEVER in worldData. worldData.sprites carries only the small metadata the
// renderer + builders need ({rev, slots, clips}); it is a plain (non-dunder)
// key on purpose so the hot-swap adopt carries it into live tabs.
//
// A SHEET is one uploaded png. RIP = slice it into cols×rows cells, each cell a
// SLOT (`name.0` … `name.n-1`); fps registers the whole strip as a CLIP for
// spriteAnim(). A plain sprite is a 1×1 sheet.

import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'

export interface SpriteSheet {
  id: string
  name: string
  png_b64: string          // the uploaded png, base64 (no data: prefix)
  cols: number
  rows: number
  fps?: number             // present → the ripped strip is an animation clip
  at: number
}

export interface SpriteDoc { sheets: SpriteSheet[] }

// caps (MAP: ≤64 sheets/world · ≤4096 slots · ≤8M px total ≈ 32MB atlas)
export const MAX_SHEETS = 64
export const MAX_SLOTS = 4096
export const MAX_SHEET_BYTES = 4 * 1024 * 1024   // one png ≤ 4MB
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024  // all pngs ≤ 24MB

const slotOf = (spaceId: string) => 'sprites:' + spaceId

export async function readSprites(spaceId: string): Promise<SpriteDoc> {
  const d = (await loadGameSlot(slotOf(spaceId)).catch(() => undefined)) as SpriteDoc | undefined
  return d && Array.isArray(d.sheets) ? d : { sheets: [] }
}

/** Add (or replace, by name) one sheet. Returns the new doc + the metadata that
 *  belongs in worldData.sprites, or a human error. */
export async function putSheet(
  spaceId: string,
  sheet: { name: string; png_b64: string; cols?: number; rows?: number; fps?: number },
): Promise<{ ok: true; doc: SpriteDoc; meta: WorldSpritesMeta } | { ok: false; error: string }> {
  const name = (sheet.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!name) return { ok: false, error: 'sheet name required (a-z, 0-9, _, -)' }
  const png = (sheet.png_b64 || '').replace(/^data:image\/\w+;base64,/, '')
  if (!png) return { ok: false, error: 'png (base64) required' }
  const bytes = Math.floor(png.length * 0.75)
  if (bytes > MAX_SHEET_BYTES) return { ok: false, error: `sheet too large (${Math.round(bytes / 1024)}KB — max ${MAX_SHEET_BYTES / 1024}KB)` }
  const cols = Math.max(1, Math.min(64, Math.floor(sheet.cols ?? 1)))
  const rows = Math.max(1, Math.min(64, Math.floor(sheet.rows ?? 1)))
  const doc = await readSprites(spaceId)
  const rest = doc.sheets.filter(s => s.name !== name)
  if (rest.length >= MAX_SHEETS) return { ok: false, error: `sheet cap reached (${MAX_SHEETS})` }
  const total = rest.reduce((n, s) => n + Math.floor(s.png_b64.length * 0.75), 0) + bytes
  if (total > MAX_TOTAL_BYTES) return { ok: false, error: `world sprite budget exceeded (${Math.round(total / 1048576)}MB — max ${MAX_TOTAL_BYTES / 1048576}MB)` }
  const next: SpriteDoc = {
    sheets: [...rest, {
      id: name, name, png_b64: png, cols, rows,
      ...(sheet.fps ? { fps: Math.max(1, Math.min(60, Math.floor(sheet.fps))) } : {}),
      at: Date.now(),
    }],
  }
  const meta = spritesMeta(next)
  if (meta.slots.length > MAX_SLOTS) return { ok: false, error: `slot cap reached (${MAX_SLOTS})` }
  await saveGameSlot(slotOf(spaceId), next)
  return { ok: true, doc: next, meta }
}

export async function deleteSheet(spaceId: string, name: string): Promise<{ doc: SpriteDoc; meta: WorldSpritesMeta }> {
  const doc = await readSprites(spaceId)
  const next: SpriteDoc = { sheets: doc.sheets.filter(s => s.name !== (name || '').trim().toLowerCase()) }
  await saveGameSlot(slotOf(spaceId), next)
  return { doc: next, meta: spritesMeta(next) }
}

// ── the metadata mirror for worldData.sprites ──
export interface WorldSpritesMeta {
  rev: number
  slots: Array<{ name: string; i: number; sheet: string; cell: [number, number] }>
  clips: Array<{ name: string; first: number; n: number; fps: number }>
}

/** Deterministic slot order: sheets by name, cells row-major — the SAME order
 *  the client atlas builder uses, so slot indexes agree everywhere. */
export function spritesMeta(doc: SpriteDoc): WorldSpritesMeta {
  const sheets = [...doc.sheets].sort((a, b) => a.name < b.name ? -1 : 1)
  const slots: WorldSpritesMeta['slots'] = []
  const clips: WorldSpritesMeta['clips'] = []
  for (const sh of sheets) {
    const first = slots.length
    const n = sh.cols * sh.rows
    for (let r = 0; r < sh.rows; r++) for (let c = 0; c < sh.cols; c++) {
      slots.push({ name: n === 1 ? sh.name : `${sh.name}.${r * sh.cols + c}`, i: slots.length, sheet: sh.name, cell: [c, r] })
    }
    if (sh.fps && n > 1) clips.push({ name: sh.name, first, n, fps: sh.fps })
  }
  return { rev: Date.now(), slots, clips }
}
