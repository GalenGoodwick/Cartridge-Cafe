import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { handleOf } from '@/lib/notify'

interface MakerPageProps {
  params: Promise<{ key: string }>
}

/** Resolve a maker from either form the old UI linked with:
 *  - a User id (space owner links from the title box)
 *  - a branch handle (the email prefix branches are signed with) */
async function resolveMaker(key: string) {
  const byId = await prisma.user.findUnique({ where: { id: key }, select: { email: true } })
  if (byId) return byId
  return prisma.user.findFirst({
    where: { email: { startsWith: `${key}@` } },
    select: { email: true },
  })
}

/** /maker/[key] is DEPRECATED — the maker page now lives at /u/<handle>.
 *  Resolve whoever the old link pointed at and redirect to their profile. */
export default async function MakerPage({ params }: MakerPageProps) {
  const { key } = await params
  const maker = await resolveMaker(decodeURIComponent(key))
  if (!maker?.email) notFound()
  redirect(`/u/${handleOf(maker.email)}`)
}
