// OLD UI DEPRECATED (Galen, Aug 28) — MY WORLDS lives in THE GRID (the ⌂ tab
// on the shelf and in the engine). This door redirects there.
import { redirect } from 'next/navigation'

export default function Mine() {
  redirect('/grid')
}
