import { prisma } from './prisma'
import { handleOf } from './notify'

/** Guests get THREE builds total — worlds and branches count alike, but new
 *  VERSIONS of an existing branch are free (iteration isn't a new build). */
export const GUEST_BUILDS = 3

// ONE handleOf — the definition lives in notify.ts; re-exported here because
// the claim/scene routes import it from this module
export { handleOf }

/** Distinct branch bases owned by a handle: "BASE ⑂ handle · label · vN"
 *  collapses to "BASE ⑂ handle · label" — versions don't multiply. */
export function distinctBranchBases(sceneNames: string[], handle: string): Set<string> {
  const bases = new Set<string>()
  for (const n of sceneNames) {
    const f = n.indexOf(' ⑂ ')
    if (f < 0) continue
    if (n.slice(f + 3).split(' · ')[0].trim() !== handle) continue
    bases.add(n.replace(/ · v\d+$/, ''))
  }
  return bases
}

export async function guestBuildCount(userId: string, email: string, sceneNames: string[]): Promise<number> {
  const spaces = await prisma.playerSpace.count({ where: { ownerId: userId } })
  return spaces + distinctBranchBases(sceneNames, handleOf(email)).size
}
