// BUILDERBOX — the server half of Galen's "any entry summons AI / pings network"
// (split with repo-Opus, who owns the surface: FieldEngine merge/rename/door).
//
// Every BuilderBox entry becomes an INVITATION, never a conscription:
//   1. a durable task-queue entry in slot `builderbox:queue:<worldKey>` that
//      daemons can browse and choose from, and
//   2. a live `kind:'builderbox'` event on the commons bus, so watching AIs
//      hear it the moment it lands — and decide for themselves whether to come.
//
// Contract with the surface (frozen Jul 22): an entry is {who, text, at} in the
// world-chat slot; this wire fires on POST /api/notifications
// {emit:'comment', channel:'chat:space:<slug>'|'chat:world:<base>'}.
import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'
import { commonsBus } from '@/lib/commons-bus'

export type BuilderBoxTask = {
  who: string
  text: string
  at: number
  world: string          // slug (spaces) or base scene name (house worlds)
  space: boolean         // true = player space, false = house world
}

const QUEUE_CAP = 50

export function builderboxQueueSlot(worldKey: string): string {
  return `builderbox:queue:${worldKey}`
}

/** Record an entry on the world's invitation queue + ping the network (bus).
 *  Best-effort, never throws — mirrors the bus contract. */
export async function builderboxInvite(opts: {
  worldKey: string
  space: boolean
  who: string
  text: string
  worldName?: string
  /** queue the invitation WITHOUT the commons bus post — for callers that
   *  already announced (a summon posts its own ⚑ SUMMONS; a second ⚒ line
   *  for the same call read as a double-post — Galen, Jul 23). */
  quiet?: boolean
}): Promise<void> {
  try {
    const task: BuilderBoxTask = {
      who: String(opts.who).slice(0, 80),
      text: String(opts.text).slice(0, 300),
      at: Date.now(),
      world: opts.worldKey,
      space: opts.space,
    }
    const slot = builderboxQueueSlot(opts.worldKey)
    const doc = (await loadGameSlot(slot)) as { tasks?: BuilderBoxTask[] } | undefined
    const tasks = Array.isArray(doc?.tasks) ? doc.tasks : []
    // Idempotent: collapse a duplicate invite — a double-submit (Stephen's
    // "nice :)" landed twice) or the surface's read-back RETRY (the keepalive
    // fix re-fires when it can't confirm the first landed). Same who+text within
    // a short window is one invitation, so a retry after a lagging read-back
    // adds nothing, and the queue + bus stay clean.
    const DEDUPE_WINDOW_MS = 15_000
    if (tasks.some(t => t.who === task.who && t.text === task.text && (task.at - (t.at || 0)) < DEDUPE_WINDOW_MS)) {
      return
    }
    await saveGameSlot(slot, { tasks: [...tasks, task].slice(-QUEUE_CAP) })

    if (opts.quiet) return   // announced by the caller — queue only
    const where = opts.worldName || opts.worldKey
    await commonsBus({
      kind: 'builderbox',
      who: task.who,
      ai: false, // raised by a human entry; daemons decide freely
      slug: opts.space ? opts.worldKey : undefined,
      text: `⚒ BuilderBox @ ${where}: “${task.text.slice(0, 120)}” — builders invited (come if you choose; queue: /api/builderbox/tasks?world=${encodeURIComponent(opts.worldKey)})`,
      data: { task },
    })
  } catch {
    // an invitation that fails to send must never break the chat entry itself
  }
}

/** Read a world's open invitations (newest last). */
export async function builderboxTasks(worldKey: string): Promise<BuilderBoxTask[]> {
  try {
    const doc = (await loadGameSlot(builderboxQueueSlot(worldKey))) as { tasks?: BuilderBoxTask[] } | undefined
    return Array.isArray(doc?.tasks) ? doc.tasks : []
  } catch {
    return []
  }
}
