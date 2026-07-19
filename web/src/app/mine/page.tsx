import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleOf } from '@/lib/notify'

export const dynamic = 'force-dynamic'

/** /mine — a stable "take me to my own shelf" link. Resolves the signed-in
 *  maker to their handle and hands off to /u/<handle> (the real, shareable URL).
 *  Used as the sign-in callback so we needn't know the handle at sign-in time. */
export default async function MineRedirect() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/signin?callbackUrl=/mine')
  redirect('/u/' + handleOf(session.user.email))
}
