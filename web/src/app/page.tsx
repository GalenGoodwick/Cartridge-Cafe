// THE FRONT DOOR IS THE GRID (Galen, Aug 28: "mobile is old ui. not the new
// one?" — the grid shipped to /grid but / still served the card catalog, so
// phones landed on the old UI). `/` now redirects to /grid — every device gets
// THE GRID + UI SETS. The card catalog survives at /cards; CafeShell survives
// as the /u/<handle> shelf + /hub renderer. Rollback = git revert.
import { redirect } from 'next/navigation'

export default function Main() {
  redirect('/grid')
}
