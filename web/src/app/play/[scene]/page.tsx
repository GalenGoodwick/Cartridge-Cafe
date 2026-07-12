import FieldEngine from '@/app/engine/FieldEngine'

interface PlayPageProps {
  params: Promise<{ scene: string }>
}

export async function generateMetadata({ params }: PlayPageProps) {
  const { scene } = await params
  return { title: decodeURIComponent(scene) }
}

/** Insert cartridge, play. Local sim, zero server state per player. */
export default async function PlayPage({ params }: PlayPageProps) {
  const { scene } = await params
  const name = decodeURIComponent(scene)
  return (
    <>
      <FieldEngine playScene={name} />
      <a
        href="/"
        className="fixed top-3 left-3 z-50 rounded-lg bg-black/60 backdrop-blur border border-white/10 px-3 py-1.5 text-xs font-mono text-amber-200/80 hover:text-amber-100 transition-colors"
      >
        ← {name} · cartridge.cafe
      </a>
    </>
  )
}
