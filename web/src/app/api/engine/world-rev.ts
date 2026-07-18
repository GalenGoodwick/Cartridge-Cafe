// Per-world authored-revision counter. Bumped on EVERY bridge write (an AI, or
// any headless editor, changing a world's hooks/visuals/fields). A playing tab
// polls it and, on a bump, adopts the new authored code live — instead of
// running stale and clobbering the change on its next sync.
//
// In-memory + monotonic. Survives across requests in one server process; a
// serverless cold start resets it to 0, which is safe: a tab that saw a higher
// rev simply re-adopts once (idempotent — hot-applying identical code is a no-op).

const g = globalThis as unknown as { __worldRev?: Map<string, number> }
const revs: Map<string, number> = (g.__worldRev ??= new Map())

/** A stable key for a world: `space:<id>` or `scene:<name>`. */
export function spaceKey(spaceId: string): string { return 'space:' + spaceId }
export function sceneKey(sceneName: string): string { return 'scene:' + sceneName }

/** Advance a world's authored revision. Call after any bridge write lands. */
export function bumpWorldRev(key: string): number {
  const next = (revs.get(key) ?? 0) + 1
  revs.set(key, next)
  return next
}

/** Read a world's current authored revision (0 if never written this process). */
export function getWorldRev(key: string): number {
  return revs.get(key) ?? 0
}
