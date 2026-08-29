// OLD UI REMOVED (Galen, Aug 29) — the maker-shelf page rode the bubble shell.
// Old /u/<handle> links land on the grid's shelf.
import { redirect } from 'next/navigation'

export default function MakerDoor() {
  redirect('/grid')
}
