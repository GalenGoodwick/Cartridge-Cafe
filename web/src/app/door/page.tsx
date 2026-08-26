// THE DOOR — DEPRECATED (Galen, Aug 26: "the battle icon goes to the old main
// view... we need to deprecate all of this for now"). The original bubble-shelf
// main is closed; / is the card main. CafeShell itself still serves /u and /hub,
// so nothing is deleted — this surface just redirects home. (It may return one
// day as EXPLORATION MODE.)
import { redirect } from 'next/navigation'

export default function CafeDoor() {
  redirect('/')
}
