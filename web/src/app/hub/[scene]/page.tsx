import CafeShell from '@/app/CafeShell'

interface HubPageProps {
  params: Promise<{ scene: string }>
}

export async function generateMetadata({ params }: HubPageProps) {
  const { scene } = await params
  const name = decodeURIComponent(scene)
  // the world's own instructions are its best description — first line wins
  let description: string | undefined
  try {
    const { hydrateScene, loadScene } = await import('@/app/api/engine/store')
    await hydrateScene(name)
    const wd = (loadScene(name) as { worldData?: { instructions?: string } } | undefined)?.worldData
    const first = String(wd?.instructions || '').split('\n').find(l => l.trim())
    if (first) description = first.trim().slice(0, 160)
  } catch { /* store napping — title still stands */ }
  const title = name.split(' ⑂ ')[0]
  return {
    title,
    ...(description ? { description } : {}),
    openGraph: { title: `${title} · cartridge.cafe`, ...(description ? { description } : {}) },
    twitter: { title: `${title} · cartridge.cafe`, ...(description ? { description } : {}) },
  }
}

/** Deep link straight into a cartridge — same shell, so ESC still walks
 *  back to the cafe without a page load. (Formerly /play/[scene]; /play/* now
 *  308-redirects here via next.config, so old links and bookmarks still land.) */
export default async function HubPage({ params }: HubPageProps) {
  const { scene } = await params
  return <CafeShell initialScene={decodeURIComponent(scene)} />
}
