// THE CUTOVER, ENV-GATED (Galen, Aug 24: "prod is not cards on main").
// `/` serves the card main only where CARD_MAIN=1 (dev has it; prod does not
// yet). Everywhere else `/` stays the classic bubble-shelf main and the card
// catalog remains reachable at /cards. The prod cutover is therefore a one-var
// flip in Vercel — no code change, instant rollback by unsetting it.
import CardsMain from '@/app/cards/page'
import CafeShell from '@/app/CafeShell'

export default function Main() {
  return process.env.CARD_MAIN === '1' ? <CardsMain /> : <CafeShell />
}
