import { policyOf } from '@/lib/world-policy'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleOf } from '@/lib/notify'
import SpaceStage from './SpaceStage'

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

  const owner = space.owner?.name || 'someone'
  const title = `${space.name} — cartridge.cafe`
  const description = `${space.description || `A little world by ${owner}`} · Live on cartridge.cafe — best on a desktop browser.`

  return {
    title,
    description,
    openGraph: { type: 'website', title, description, siteName: 'cartridge.cafe' },
    twitter: { card: 'summary_large_image', title, description },
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
      owner: { select: { id: true, name: true, email: true } },
    },
  })

  if (!space) notFound()

  // Check visibility
  const session = await getServerSession(authOptions)
  const userId = session?.user?.email
    ? (await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } }))?.id
    : null

  if (!space.isPublic && userId !== space.ownerId) notFound()

  // THE SOCIAL CONTRACT's play gate (world-policy): a playable world whose
  // contract restricts play ('invited'/'builders') opens only to the owner and
  // the members roster (member:<handle> keys). Cheap jsonb read — never the
  // whole snapshot server-side.
  if (space.isPublic && userId !== space.ownerId) {
    const rows = await prisma.$queryRaw<{ policy: unknown }[]>`
      SELECT snapshot->'worldData'->'policy' AS policy FROM "PlayerSpace" WHERE id = ${space.id}`
    const policy = policyOf({ policy: rows[0]?.policy })
    if (policy.play !== 'everyone') {
      const email = session?.user?.email
      const handle = email ? email.split('@')[0].replace(/[^a-z0-9_-]/gi, '') : null
      const member = handle ? await prisma.spaceToken.findFirst({
        where: { spaceId: space.id, revokedAt: null, name: `member:${handle}` }, select: { id: true },
      }) : null
      if (!member) notFound()
    }
  }

  const isOwner = userId === space.ownerId
  // viewing a save point is always read-only — syncing it would overwrite the live world
  const engineOwner = versionView !== undefined ? false : isOwner

  return (
    <>
      <SpaceStage
        spaceId={space.id}
        spaceSlug={space.slug}
        engineOwner={engineOwner}
        isOwner={isOwner}
        versionView={Number.isFinite(versionView) ? versionView : undefined}
        name={space.name}
        ownerName={space.owner?.name ?? null}
        ownerId={space.owner?.id ?? null}
        ownerHandle={space.owner?.email ? handleOf(space.owner.email) : null}
      />
    </>
  )
}
