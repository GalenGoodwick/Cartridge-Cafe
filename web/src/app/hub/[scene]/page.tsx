// OLD UI REMOVED (Galen, Aug 29: "2 old sitewide ui — safe to remove"). The
// bubble-hub renderer is gone; old /hub/<SCENE> links land in THE GRID. Hub
// scenes that mattered were ferried to real spaces (slugified names), so the
// slug guess usually lands the exact world; otherwise the shelf is right there.
import { redirect } from 'next/navigation'

export default async function HubDoor({ params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params
  const slug = decodeURIComponent(scene).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  redirect(slug ? `/grid?w=space:${encodeURIComponent(slug)}&ui=games&ph=play` : '/grid')
}
