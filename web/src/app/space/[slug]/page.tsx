import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import FieldEngine from '@/app/engine/FieldEngine'
import SpaceToolbar from './SpaceToolbar'

interface SpacePageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ version?: string }>
}

export async function generateMetadata({ params }: SpacePageProps) {
  const { slug } = await params
  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { name: true, description: true, owner: { select: { name: true } } },
  })

  if (!space) return { title: 'Space Not Found' }

  return {
    title: `${space.name} — ${space.owner?.name || 'Unknown'}`,
    description: space.description || `A programmable space by ${space.owner?.name}`,
  }
}

export default async function SpacePage({ params, searchParams }: SpacePageProps) {
  const { slug } = await params
  const { version } = await searchParams
  const versionView = version ? parseInt(version, 10) : undefined

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      ownerId: true,
      isPublic: true,
      owner: { select: { id: true, name: true } },
    },
  })

  if (!space) notFound()

  // Check visibility
  const session = await getServerSession(authOptions)
  const userId = session?.user?.email
    ? (await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } }))?.id
    : null

  if (!space.isPublic && userId !== space.ownerId) notFound()

  const isOwner = userId === space.ownerId
  // viewing a save point is always read-only — syncing it would overwrite the live world
  const engineOwner = versionView !== undefined ? false : isOwner

  return (
    <>
      <FieldEngine
        spaceId={space.id}
        spaceSlug={space.slug}
        isOwner={engineOwner}
        versionView={Number.isFinite(versionView) ? versionView : undefined}
      />
      <SpaceToolbar
        slug={space.slug}
        name={space.name}
        ownerName={space.owner?.name ?? null}
        isOwner={isOwner}
        versionView={Number.isFinite(versionView) ? versionView : undefined}
      />
    </>
  )
}
