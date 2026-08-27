import { redirect } from 'next/navigation'
import { policyOf } from '@/lib/world-policy'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleOf } from '@/lib/notify'
import SpaceStage from './SpaceStage'

interface SpacePageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ version?: string; join?: string }>
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
  const search = await searchParams
  const { version } = search
  const versionView = typeof version === 'string' ? parseInt(version, 10) : undefined

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

  // THE JOIN DOOR (one-time invite links, task #5): ?join=<secret> consumed
  // BEFORE any gate — a valid invite mints membership (member:<handle> key
  // row) and from that moment every gate below sees a member. Signed-out
  // holders bounce through sign-in and return with the join intact.
  const joinSecret = typeof search?.join === 'string' ? search.join : null
  if (joinSecret) {
    if (!session?.user?.email) {
      redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/space/${slug}?join=${joinSecret}`)}`)
    }
    const email = session.user.email
    const handle = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
    if (userId && userId !== space.ownerId && handle) {
      const { loadGameSlot, saveGameSlot } = await import('../../api/engine/store')
      const crypto = (await import('crypto')).default
      const slot = `invites:${space.id}`
      const list = ((await loadGameSlot(slot)) as Array<{ h: string; at: number; used?: { by: string; at: number } }> | undefined) ?? []
      const h = crypto.createHash('sha256').update(joinSecret).digest('hex')
      const inv = list.find(i => i.h === h && !i.used)
      const { isBanned } = await import('@/lib/world-bans')
      if (inv && !(await isBanned(space.id, handle))) {
        const already = await prisma.spaceToken.findFirst({ where: { spaceId: space.id, revokedAt: null, name: `member:${handle}` }, select: { id: true } })
        if (!already) {
          const raw = `uc_st_${crypto.randomBytes(16).toString('hex')}`
          await prisma.spaceToken.create({ data: {
            name: `member:${handle}`,
            tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
            tokenPrefix: raw.slice(0, 12) + '...',
            spaceId: space.id,
          } })
        }
        inv.used = { by: handle, at: Date.now() }
        await saveGameSlot(slot, list)
      }
    }
    // every join path ENDS IN CO-REGISTRATION (Galen's law): the new member
    // lands with the CONNECT AI terminal opening — their key mints there and
    // the paste-prompt walks their AI through the guide. Same door as a fork.
    redirect(`/space/${slug}?connect=1`)
  }

  if (!space.isPublic && userId !== space.ownerId) {
    // an unpublished CREW world still opens for its members (SHARED WORLDS law)
    const email = session?.user?.email
    const handle = email ? email.split('@')[0].replace(/[^a-z0-9_-]/gi, '') : null
    const member = handle ? await prisma.spaceToken.findFirst({
      where: { spaceId: space.id, revokedAt: null, name: `member:${handle}` }, select: { id: true },
    }) : null
    if (!member) notFound()
  }

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

  // THE GRID (task #20): one cheap jsonb read — the engine must be BORN at
  // the world's declared size, so the server hands it down as a prop. Same read
  // grabs worldData.fit — a 'mobile' world renders in a portrait phone frame on
  // desktop (SpaceStage), so the client must know its declared fit up front.
  const gridRows = await prisma.$queryRaw<{ g: string | null; fit: string | null }[]>`
    SELECT snapshot->'worldParams'->>'gridSize' AS g,
           snapshot->'worldData'->>'fit' AS fit
    FROM "PlayerSpace" WHERE id = ${space.id}`
  const gridParsed = gridRows[0]?.g ? parseInt(gridRows[0].g, 10) : NaN
  const gridSize = Number.isFinite(gridParsed) && gridParsed >= 64 && gridParsed <= 4096 ? gridParsed : undefined
  // the targets matrix, both halves: 'mobile' → phone frame on desktop;
  // 'desktop' → the door notice on a phone. worldData.fit is the declaration.
  const fit = gridRows[0]?.fit === 'mobile' ? 'mobile' : gridRows[0]?.fit === 'desktop' ? 'desktop' : undefined

  const isOwner = userId === space.ownerId
  // viewing a save point is always read-only — syncing it would overwrite the live world
  const engineOwner = versionView !== undefined ? false : isOwner

  return (
    <>
      <SpaceStage
        spaceId={space.id}
        spaceSlug={space.slug}
        gridSize={gridSize}
        fit={fit}
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
