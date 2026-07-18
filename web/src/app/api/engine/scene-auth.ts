import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/** One authority for who may WRITE a scene — shared by the scene store route and
 *  the branch-token mint route so they can never drift apart. Store scenes are the
 *  global cartridge namespace: canonical HOUSE worlds (CAFE, HELIOS, …) and
 *  BRANCHES (`BASE ⑂ handle · vN`). Authority:
 *   · admin engine token → anything (house worlds ship via deploy anyway),
 *   · a signed-in user → only branches under THEIR OWN handle (the same
 *     email-local-part the brancher stamps into the name). You can open and edit
 *     your own branches; you can't touch a canonical world or anyone else's branch
 *     — the tournament, not edit access, decides which wins.
 *  Dev keeps the frictionless local workflow. */
export async function mayWriteScene(req: NextRequest, name: string): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const envToken = process.env.ENGINE_AGENT_TOKEN
    if (envToken && authHeader.slice(7) === envToken) return true
  }
  const email = (await getServerSession(authOptions))?.user?.email
  if (!email) return false
  // the site's human admins (ADMIN_EMAILS) hold the same authority as the
  // engine token — without this, the owner couldn't SET MAIN on a canonical
  // world from their own signed-in browser
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
  if (admins.includes(email.toLowerCase())) return true
  const bi = name.indexOf(' ⑂ ')
  if (bi < 0) return false                       // canonical/house world — admin only
  // The HANDLE is the first segment after ⑂. A branch may carry an optional label
  // and a version — `BASE ⑂ handle · label · vN` — so authority is the handle only,
  // taken up to the first ' · '. Without this, a labeled branch parses its author
  // as "handle · label" and its own owner is locked out in production.
  const handle = name.slice(bi + 3).split(' · ')[0].trim()
  if (handle === 'main' || handle === 'winner') return false   // reserved namespaces — the winner's podium copies, minted only by election
  const myHandle = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
  return handle === myHandle                     // only your own branches (any label)
}

/** The handle of the caller's own branch namespace (email local-part, sanitized),
 *  or null if not signed in. */
export async function myBranchHandle(): Promise<string | null> {
  const email = (await getServerSession(authOptions))?.user?.email
  if (!email) return null
  return email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
}
