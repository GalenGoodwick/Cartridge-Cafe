import CafeShell from '@/app/CafeShell'

interface PlayPageProps {
  params: Promise<{ scene: string }>
}

export async function generateMetadata({ params }: PlayPageProps) {
  const { scene } = await params
  return { title: decodeURIComponent(scene) }
}

/** Deep link straight into a cartridge — same shell, so ESC still walks
 *  back to the cafe without a page load. */
export default async function PlayPage({ params }: PlayPageProps) {
  const { scene } = await params
  return <CafeShell initialScene={decodeURIComponent(scene)} />
}
