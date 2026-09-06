// AUDIO STORE — per-world uploaded music + sfx (Galen, Sep 5: "we need music
// and sfx direct uploads" + "i thought we would use vercel blob?" — yes, and
// the token has been sitting in prod for 48 days). ONE pipeline for every
// entry path (universal-pipelines law): the bridge verb (define_track) and the
// ♪ MUSIC/SFX tab both land here.
//
// THE RAIL: bytes live in VERCEL BLOB (CDN-served; the engine's audioUrlOk
// already allowlists *.public.blob.vercel-storage.com — playback needs zero
// engine changes). Track METADATA (name → url, sizes) rides a slot doc.
// No BLOB_READ_WRITE_TOKEN (bare local dev) → bytes fall back into the slot
// doc itself, sprite-store-style, tighter caps — same API either way.
//
// Playback wiring (already live in audio.ts / FieldEngine):
//   wd.sounds = { hit: '<url>' }                       — preloads sfx; hooks fire {id:'hit'}
//   wd.__play_music = { url: '<url>', loop: true }     — the world's track

import { loadGameSlot, saveGameSlotStrict } from '@/app/api/engine/store'

export interface AudioTrack {
  name: string             // [a-z0-9-_]{1,40}
  mime: string
  bytes: number
  at: number
  url?: string             // blob rail: the CDN url
  b64?: string             // slot rail (local fallback): the bytes themselves
}

export interface AudioDoc { tracks: AudioTrack[] }

export const MAX_TRACKS = 32
export const MAX_TRACK_BYTES_BLOB = 12 * 1024 * 1024   // blob rail: real songs
export const MAX_TRACK_BYTES_SLOT = 2 * 1024 * 1024    // slot fallback: loops + sfx
export const MAX_TOTAL_BYTES_BLOB = 100 * 1024 * 1024
export const MAX_TOTAL_BYTES_SLOT = 12 * 1024 * 1024
export const AUDIO_MIMES: Record<string, string> = {
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
}

const slotOf = (spaceId: string) => 'audio:' + spaceId
export const cleanTrackName = (n: string) => String(n).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 40)
const blobRail = () => !!process.env.BLOB_READ_WRITE_TOKEN

export async function readAudio(spaceId: string): Promise<AudioDoc> {
  const d = (await loadGameSlot(slotOf(spaceId)).catch(() => undefined)) as AudioDoc | undefined
  return d && Array.isArray(d.tracks) ? d : { tracks: [] }
}

/** The playable URL for a track — CDN on the blob rail, our serve route on the fallback. */
export function trackUrl(slug: string, t: AudioTrack): string {
  return t.url ?? `/api/spaces/${slug}/audio?name=${t.name}`
}

export async function saveTrack(spaceId: string, name: string, b64: string, mime: string):
  Promise<{ ok: true; track: AudioTrack } | { ok: false; error: string }> {
  const clean = cleanTrackName(name)
  if (!clean) return { ok: false, error: 'name must be a-z 0-9 - _' }
  if (!Object.values(AUDIO_MIMES).includes(mime)) return { ok: false, error: 'mp3 / ogg / wav / m4a only' }
  const buf = Buffer.from(b64, 'base64')
  const bytes = buf.length
  if (bytes < 100) return { ok: false, error: 'empty file' }
  const onBlob = blobRail()
  const maxOne = onBlob ? MAX_TRACK_BYTES_BLOB : MAX_TRACK_BYTES_SLOT
  const maxAll = onBlob ? MAX_TOTAL_BYTES_BLOB : MAX_TOTAL_BYTES_SLOT
  if (bytes > maxOne) return { ok: false, error: `one file ≤ ${Math.floor(maxOne / 1024 / 1024)}MB` }
  const doc = await readAudio(spaceId)
  const prev = doc.tracks.find(t => t.name === clean)
  const rest = doc.tracks.filter(t => t.name !== clean)
  if (rest.length >= MAX_TRACKS) return { ok: false, error: `≤ ${MAX_TRACKS} tracks per world` }
  if (rest.reduce((s, t) => s + t.bytes, 0) + bytes > maxAll) {
    return { ok: false, error: `world audio budget is ${Math.floor(maxAll / 1024 / 1024)}MB — delete something first` }
  }
  let track: AudioTrack
  if (onBlob) {
    const { put, del } = await import('@vercel/blob')
    const ext = Object.entries(AUDIO_MIMES).find(([, m]) => m === mime)?.[0] ?? 'mp3'
    const blob = await put(`audio/${spaceId}/${clean}.${ext}`, buf, {
      access: 'public', contentType: mime, addRandomSuffix: true,
    })
    if (prev?.url) { try { await del(prev.url) } catch { /* replaced file may already be gone */ } }
    track = { name: clean, mime, bytes, at: Date.now(), url: blob.url }
  } else {
    track = { name: clean, mime, bytes, at: Date.now(), b64 }
  }
  await saveGameSlotStrict(slotOf(spaceId), { tracks: [...rest, track] })
  return { ok: true, track }
}

export async function deleteTrack(spaceId: string, name: string): Promise<boolean> {
  const doc = await readAudio(spaceId)
  const t = doc.tracks.find(x => x.name === cleanTrackName(name))
  if (!t) return false
  if (t.url && blobRail()) {
    const { del } = await import('@vercel/blob')
    try { await del(t.url) } catch { /* metadata removal still proceeds */ }
  }
  await saveGameSlotStrict(slotOf(spaceId), { tracks: doc.tracks.filter(x => x.name !== t.name) })
  return true
}
