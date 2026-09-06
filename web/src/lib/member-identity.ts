// MEMBER HANDLE ↔ USER BINDING (audit, Sep 5): the member:<handle> name was
// derived from the email local-part ALONE — bob@attacker.com could inherit
// bob@gmail.com's seat on any world (fee skip + closed-world re-entry + the
// revoke-and-remint path locking the real bob out). A handle on a world now
// binds to the FIRST userId that claims it, durably; anyone else colliding
// gets refused. Legacy rows (pre-binding) bind to the first verified claimer.

import { loadGameSlot, saveGameSlotStrict } from '@/app/api/engine/store'

const slot = (spaceId: string, handle: string) => `memberuid:${spaceId}:${handle.toLowerCase()}`

/** True iff `handle` on `spaceId` is unclaimed, or already bound to `userId`.
 *  Claims it (durably) when unclaimed. False = another user's seat. */
export async function claimMemberHandle(spaceId: string, handle: string, userId: string): Promise<boolean> {
  const key = slot(spaceId, handle)
  const doc = (await loadGameSlot(key)) as { uid?: string } | undefined
  if (doc?.uid) return doc.uid === userId
  await saveGameSlotStrict(key, { uid: userId, at: Date.now() })
  return true
}
