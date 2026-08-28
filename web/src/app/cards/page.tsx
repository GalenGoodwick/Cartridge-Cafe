// OLD UI DEPRECATED (Galen, Aug 28) — the card catalog's job moved into THE
// GRID's shelf tabs. The catalog component is parked (catalog-retired.tsx,
// unrouted, code preserved); this door redirects.
import { redirect } from 'next/navigation'

export default function Cards() {
  redirect('/grid')
}
