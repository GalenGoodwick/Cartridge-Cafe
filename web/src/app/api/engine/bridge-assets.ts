// BRIDGE ASSETS — sprite + audio upload verbs (item 4/#7, phase 4), moved
// VERBATIM from bridge/route.ts. One shared ◆ premium gate replaces the two
// copy-pasted inline gates (importing REAL media rides the IP-control
// membership; shader-made art stays free — the gate is on uploads, not
// creativity; admin owners pass, the keeper demos). Every handler returns NULL
// without a space token so non-space callers keep their exact legacy routing.

import type { BridgeAuth } from './bridge-auth'
import type { BridgeHandler } from './bridge-dispatch'
import { applyCommandToSnapshot } from './space-store'

/** the ◆ PREMIUM SUITE gate (Galen, Aug 27): returns the refusal message, or
 *  null when the world owner holds IP control (or is the keeper). */
async function premiumGate(auth: BridgeAuth, what: string): Promise<string | null> {
  const { hasIpControl } = await import('@/lib/stripe')
  const { isAdminUserId } = await import('@/lib/adminAuth')
  const ownerId = auth.ownerId
  const allowed = ownerId ? (await hasIpControl(ownerId)) || (await isAdminUserId(ownerId)) : false
  return allowed ? null : what
}

// ── SPRITES (Galen, Aug 26 — the Fortis ask): the AI's door into the ONE
// sprite pipeline (lib/sprite-store shares it with the owner UI route).
// define_sheet {name, png, cols, rows, fps?} uploads + RIPS a sheet into
// slots name.0..n-1 (+ an anim clip when fps set); define_sprite is the
// 1×1 case. Metadata mirrors into worldData.sprites (rev → live tabs
// repack the atlas); sprite(i,uv)/spriteAnim(...) sample it in any visual.
const defineSpriteOrSheet: BridgeHandler = async ({ cmd, auth }) => {
  const refused = await premiumGate(auth, 'asset imports are a ◆ premium-suite feature (coming soon) — the world owner will need the IP control membership')
  if (refused) return { type: cmd.type, error: refused }
  const { putSheet } = await import('@/lib/sprite-store')
  const one = cmd.type === 'define_sprite'
  const out = await putSheet(auth.spaceId!, {
    name: String(cmd.name ?? ''),
    png_b64: String(cmd.png ?? cmd.png_b64 ?? ''),
    cols: one ? 1 : Number(cmd.cols) || 1,
    rows: one ? 1 : Number(cmd.rows) || 1,
    fps: one ? undefined : Number(cmd.fps) || undefined,
  })
  if (!out.ok) return { type: cmd.type, error: out.error }
  await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', data: { sprites: out.meta } }).catch(() => {})
  return { type: cmd.type, ok: true, slots: out.meta.slots.map(s => ({ name: s.name, i: s.i })), clips: out.meta.clips }
}

// ♪ AUDIO uploads (Galen, Sep 5) — same ◆ premium gate as sprites
const defineTrack: BridgeHandler = async ({ cmd, auth }) => {
  const refused = await premiumGate(auth, 'audio uploads are a ◆ premium-suite feature — the world owner needs the IP control membership')
  if (refused) return { type: cmd.type, error: refused }
  const { saveTrack, trackUrl, AUDIO_MIMES } = await import('@/lib/audio-store')
  const mime = String(cmd.mime ?? '') || AUDIO_MIMES[String(cmd.ext ?? '').toLowerCase()] || ''
  const r = await saveTrack(auth.spaceId!, String(cmd.name ?? ''), String(cmd.b64 ?? cmd.mp3 ?? '').replace(/^data:[^,]*,/, ''), mime)
  if (!r.ok) return { type: cmd.type, error: r.error }
  const u = trackUrl(String(auth.slug ?? ''), r.track)
  return { ok: true, type: cmd.type, name: r.track.name, bytes: r.track.bytes, url: u,
    next: `wire it: set_world_data {"data":{"sounds":{"${r.track.name}":"${u}"}}} for sfx your hooks fire via wd.__play_sound={id:"${r.track.name}"}, or {"data":{"__play_music":{"url":"${u}","loop":true}}} for the world's music` }
}

const listTracks: BridgeHandler = async ({ cmd, auth }) => {
  const { readAudio, trackUrl } = await import('@/lib/audio-store')
  const doc = await readAudio(auth.spaceId!)
  return { ok: true, type: cmd.type, tracks: doc.tracks.map(t => ({ name: t.name, mime: t.mime, bytes: t.bytes, url: trackUrl(String(auth.slug ?? ''), t) })) }
}

const listSprites: BridgeHandler = async ({ cmd, auth }) => {
  const { readSprites, spritesMeta } = await import('@/lib/sprite-store')
  const doc = await readSprites(auth.spaceId!)
  const meta = spritesMeta(doc)
  return { type: cmd.type, ok: true, sheets: doc.sheets.map(s => ({ name: s.name, cols: s.cols, rows: s.rows, fps: s.fps ?? null })), slots: meta.slots.map(s => ({ name: s.name, i: s.i })), clips: meta.clips }
}

const deleteSprite: BridgeHandler = async ({ cmd, auth }) => {
  const { deleteSheet } = await import('@/lib/sprite-store')
  const { meta } = await deleteSheet(auth.spaceId!, String(cmd.name ?? ''))
  await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', data: { sprites: meta } }).catch(() => {})
  return { type: cmd.type, ok: true, slots: meta.slots.length }
}

export const ASSET_HANDLERS: Record<string, BridgeHandler> = {
  define_sprite: defineSpriteOrSheet,
  define_sheet: defineSpriteOrSheet,
  define_track: defineTrack,
  list_tracks: listTracks,
  list_sprites: listSprites,
  delete_sprite: deleteSprite,
}
