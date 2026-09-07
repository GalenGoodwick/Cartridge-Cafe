import { redirect } from 'next/navigation'
import { policyOf } from '@/lib/world-policy'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface SpacePageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ version?: string; join?: string; paid?: string; paycancel?: string; connect?: string }>
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
    redirect(`/grid?w=space:${encodeURIComponent(slug)}&ui=engine`)   // the workshop; ⚿ CONNECT AI is a tab away
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

  // OLD UI DEPRECATED (Galen, Aug 28: "deprecate all old ui") — the gates
  // above (private/members, play policy, join door) still hold this URL's law;
  // past them, THE GRID is the one renderer. paid/paycancel ride along so the
  // premium-checkout round-trip (success_url = /space/<slug>?paid=experience)
  // finishes in the grid's gate. generateMetadata still serves the OG card.
  // CONNECT INTENT (Galen, Aug 30: "we lost copy prompt in building world"):
  // a fresh world lands here as /space/<slug>?connect=1 — carry it into the
  // grid's ENGINE ⚿ CONNECT AI tab (where the paste-prompt + copy button live)
  // instead of dropping it into play mode with no prompt.
  const connecting = search.connect === '1'
  const qs = new URLSearchParams({ w: 'space:' + slug, ui: connecting ? 'engine' : 'games' })
  if (connecting) qs.set('connect', '1'); else qs.set('ph', 'play')
  if (typeof search.paid === 'string') qs.set('paid', search.paid)
  if (typeof search.paycancel === 'string') qs.set('paycancel', search.paycancel)
  // MID-FLOW arrivals (connect/checkout round-trips) still redirect — they're
  // humans in a flow. The PLAIN visit gets a REAL 200 landing (Google Search
  // Console, Sep 6: 'page with redirect' was blocking every world from the
  // index — a 307 to the client shell indexes NOTHING).
  if (connecting || search.paid || search.paycancel) redirect('/grid?' + qs.toString())

  const playUrl = '/grid?' + qs.toString()
  // the row select above is slim — fetch blurb fields for the landing only
  const meta = await prisma.playerSpace.findUnique({
    where: { slug }, select: { description: true, snapshot: true },
  })
  const wd = (meta?.snapshot as { worldData?: { instructions?: string; card?: { blurb?: string } } } | null)?.worldData
  const blurb = (wd?.card?.blurb || meta?.description || wd?.instructions || 'a little game world, built with AI on cartridge.cafe').slice(0, 300)
  return (
    <main className="min-h-screen grid place-items-center p-6" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }}>
      <div className="max-w-[520px] w-full text-center font-mono">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/spaces/icons/${encodeURIComponent(slug)}`} alt="" className="w-24 h-24 mx-auto rounded-2xl border border-white/15 mb-4" />
        <h1 className="cafe-sign text-4xl text-glow mb-2">{space.name}</h1>
        <p className="text-[14px] text-white/60 leading-relaxed mb-6">{blurb}</p>
        <a href={playUrl} className="inline-block px-8 py-3 rounded-2xl border-2 border-amber-300/70 bg-amber-400/15 text-amber-100 text-[15px] tracking-[0.2em] hover:bg-amber-400/25 transition-colors">
          ▶ PLAY {space.name.toUpperCase()}
        </a>
        <p className="text-[12px] text-white/40 mt-6">free to play · <a href="/" className="underline decoration-white/25 hover:decoration-white/60">cartridge.cafe — make little game worlds with AI</a></p>
      </div>
    </main>
  )
}
