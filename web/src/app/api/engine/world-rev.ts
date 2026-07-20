// Per-world authored-revision signal. Bumped on EVERY bridge write (an AI, or
// any headless editor, changing a world's hooks/visuals/fields). A playing tab
// polls it and, on a bump, adopts the new authored code live — instead of
// running stale and clobbering the change on its next sync.
//
// DURABILITY: the in-memory Map alone is per-lambda. On Vercel the tab's poll
// and the bridge write that changed the world routinely land on DIFFERENT
// serverless instances, so an in-memory-only counter never appears to advance
// for the polling tab — it stays stale until a hard refresh. So every bump also
// mirrors a last-edit TIMESTAMP into a shared Neon slot (`world-rev:<key>`), and
// getWorldRev returns the max of the local counter and that durable stamp. A
// timestamp is naturally monotonic and race-free under last-write-wins (unlike a
// read-modify-write counter, which two concurrent instances would collide on).

const g = globalThis as unknown as { __worldRev?: Map<string, number> }
const revs: Map<string, number> = (g.__worldRev ??= new Map())

/** A stable key for a world: `space:<id>` or `scene:<name>`. */
export function spaceKey(spaceId: string): string { return 'space:' + spaceId }
export function sceneKey(sceneName: string): string { return 'scene:' + sceneName }

/** Advance a world's authored revision. Call after any bridge write lands.
 *  Mirrors a durable last-edit stamp so a tab polling another instance sees it. */
export function bumpWorldRev(key: string): number {
  const next = (revs.get(key) ?? 0) + 1
  revs.set(key, next)
  // fire-and-forget: the durable stamp is a cross-instance signal, never on the
  // request's critical path. Date.now() is fine here (route handler, not a
  // resumable workflow) and gives a monotonic, collision-free value.
  void persistStamp(key)
  return next
}

async function persistStamp(key: string): Promise<void> {
  try {
    const { saveGameSlot } = await import('./store')
    await saveGameSlot('world-rev:' + key, Date.now())
  } catch { /* best-effort — the in-memory counter still serves same-instance tabs */ }
}

/** Read a world's current authored revision. Returns the higher of this
 *  instance's in-memory counter and the durable cross-instance stamp, so the
 *  value is consistent no matter which serverless instance answers the poll. */
export async function getWorldRev(key: string): Promise<number> {
  const mem = revs.get(key) ?? 0
  try {
    const { loadGameSlot } = await import('./store')
    const stamp = Number((await loadGameSlot('world-rev:' + key)) as number | undefined) || 0
    return Math.max(mem, stamp)
  } catch {
    return mem
  }
}
