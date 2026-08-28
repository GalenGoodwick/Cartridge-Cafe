import type { Viewport } from 'next'

// THE GRID: browser zoom is BLOCKED (Galen: zooming throws off the UI — the
// frame/inset math assumes 1:1 CSS pixels). Pinch-zoom off at the viewport
// level; the page adds JS guards for ctrl+wheel / gesture zoom on desktop.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function GridLayout({ children }: { children: React.ReactNode }) {
  return children
}
