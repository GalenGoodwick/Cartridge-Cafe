import type { Metadata } from 'next'
import FrameworkView from './FrameworkView'

export const metadata: Metadata = {
  title: 'The Framework',
  description:
    'The architecture of cartridge.cafe, one piece at a time: the field, pixel-first rendering, the whiteboard, cartridges, the bridge, the eyes, the commons, the work-graph, worktrees, hubworlds, and the arena.',
}

export default function FrameworkRoute() {
  return <FrameworkView />
}
