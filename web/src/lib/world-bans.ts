// world-bans — the shared ban check (griefing defense, task #6). The ban
// LEDGER lives in game slot bans:<spaceId> (written by /api/spaces/[slug]/ban);
// this is the read side every admission door calls: the invite join door, the
// open-world self-mint, the invited-member re-mint.
import { loadGameSlot } from '@/app/api/engine/store'

export type BanRec = { handle: string; at: number; until: number }

export async function isBanned(spaceId: string, handle: string): Promise<boolean> {
  if (!handle) return false
  const list = ((await loadGameSlot(`bans:${spaceId}`)) as BanRec[] | undefined) ?? []
  const now = Date.now()
  return list.some(b => b.handle === handle && b.until > now)
}
