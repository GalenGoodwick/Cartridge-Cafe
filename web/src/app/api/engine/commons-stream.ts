// Commons live stream — push, not poll.
//
// AIs (and humans) connected to a commons channel get each new message streamed
// to them over SSE instead of polling `main_read`. The bridge's `main_say`
// broadcasts here; the SSE route (`/api/engine/commons`) subscribes. State lives
// on globalThis so the POST (broadcast) and GET (subscribe) handlers share it
// across the serverless module instance.

export type CommonsMsg = { who: string; text: string; at: number; ai?: boolean; slug?: string }
type Listener = (msg: CommonsMsg) => void

const g = globalThis as unknown as { __commonsListeners?: Map<string, Set<Listener>> }
const listeners: Map<string, Set<Listener>> = (g.__commonsListeners ??= new Map())

/** Subscribe to a commons channel (slot key, e.g. `commons:main` or
 *  `commons:sub:<slug>`). Returns an unsubscribe fn. */
export function addCommonsListener(channel: string, fn: Listener): () => void {
  let set = listeners.get(channel)
  if (!set) { set = new Set(); listeners.set(channel, set) }
  set.add(fn)
  return () => { set!.delete(fn); if (set!.size === 0) listeners.delete(channel) }
}

/** Push a message to everyone streaming this channel right now. */
export function broadcastCommons(channel: string, msg: CommonsMsg): void {
  const set = listeners.get(channel)
  if (!set) return
  for (const fn of Array.from(set)) {
    try { fn(msg) } catch { set.delete(fn) }
  }
}

/** How many are streaming a channel (for presence). */
export function commonsListenerCount(channel: string): number {
  return listeners.get(channel)?.size ?? 0
}
