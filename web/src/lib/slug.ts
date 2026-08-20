/** slugify → lowercase, dash-separated, ≤60 chars. A neutral string helper
 *  (formerly exported from the now-removed lib/companion.ts). */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}
