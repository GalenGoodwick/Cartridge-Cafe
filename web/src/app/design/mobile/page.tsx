'use client'

// MOBILE WRAPPER PROOF (Galen, Aug 28) — the standard mobile-first PLAY wrapper
// on the local CINDERFELL scene (no DB needed). Open in a real browser's device
// mode (DevTools → toggle device toolbar, coarse pointer) to SEE the engine in
// pure play inside the thumb-first DOM shell: no editing, no engine tools. This
// is exactly what a phone gets on a real /space world (SpaceStage's mobile
// branch mounts the same MobileWorldWrapper).
import MobileWorldWrapper from '@/app/space/[slug]/MobileWorldWrapper'

export default function MobileProof() {
  return <MobileWorldWrapper playScene="CINDERFELL" name="CINDERFELL" ownerName="Galen" />
}
