/** Clamp a caller-supplied ?hours=N window to a sane integer. Used by the admin
 *  analytics endpoint, where the value is interpolated into a SQL interval — so it
 *  MUST resolve to a bounded integer (never NaN, never unbounded, never a string). */
export function clampHours(raw: string | null | undefined, def = 12, max = 168): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) return def   // null, '', 'abc', '0', negatives → default
  return Math.min(n, max)                         // cap the lookback (168h = 7d)
}
