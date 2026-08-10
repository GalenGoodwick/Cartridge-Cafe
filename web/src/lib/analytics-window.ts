/** Clamp a caller-supplied ?hours=N window to a sane integer. Used by the admin
 *  analytics endpoint, where the value is interpolated into a SQL interval — so it
 *  MUST resolve to a bounded integer (never NaN, never unbounded, never a string). */
export function clampHours(raw: string | null | undefined, def = 12, max = 168): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) return def   // null, '', 'abc', '0', negatives → default
  return Math.min(n, max)                         // cap the lookback (168h = 7d)
}

/** A play_session `scene` is a presence-nesting path (`main/players/space:tideglass`,
 *  `main/world:QUANTIC DOJO`, or a bare `CAFE`). Reduce it to the readable world
 *  name — the segment after the last ':' — for the playtime report. */
export function sceneWorldLabel(scene: string): string {
  const s = (scene || '').trim()
  const i = s.lastIndexOf(':')
  return (i >= 0 ? s.slice(i + 1) : s) || s
}
