// THE CARD MAIN, UNCONDITIONALLY (Galen, Aug 27: "is the old main with the
// bubbles gone from prod? We dont need it — as cool as it was.") The env-gated
// cutover (CARD_MAIN=1) is retired; `/` IS the card catalog everywhere, no
// fallback. CafeShell survives ONLY as the /u/<handle> shelf + /hub renderer —
// the bubble MAIN is gone. Rollback = git revert, not an env flip.
import CardsMain from '@/app/cards/page'

export default function Main() {
  return <CardsMain />
}
