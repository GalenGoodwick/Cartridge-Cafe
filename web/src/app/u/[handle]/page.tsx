import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleOf } from '@/lib/notify'
import CafeShell from '@/app/CafeShell'

export const dynamic = 'force-dynamic'

/** /u/<handle> — a maker's shelf. The SAME spatial cafe everywhere, filtered to
 *  this maker's worlds: your own handle is editable ("MY WORLDS"); anyone else's
 *  is the same spatial deed, read-only. Every maker looks the same — a spatial
 *  shelf you can enter, never a flat profile list. (Follow lives on each of their
 *  worlds' pages.) The handle is the one stamped into every branch (⑂ handle · vN). */
export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const session = await getServerSession(authOptions)
  const viewerHandle = session?.user?.email ? handleOf(session.user.email) : null
  if (viewerHandle && viewerHandle === handle) return <CafeShell initialMine />
  return <CafeShell initialMineHandle={handle} />
}
