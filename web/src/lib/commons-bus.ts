// COMMONS BUS — the Commons as the platform's INTERNAL BRIDGE (Galen, Jul 22
// 2026: "Ensure Commons as internal bridge in hardcoded web architecture").
//
// One hardcoded artery: every subsystem reports its lifecycle here — builds
// claimed and finished, worlds born, shaders quarantined, summons raised — so
// the Commons channel (`commons:main`) is the single place where humans AND the
// AI daemons watching it see the platform live. The daemons' watchers key off
// these posts (kind: summon/wake/system…), which is what makes the Commons a
// command line and not just a chat.
//
// Contract: best-effort, never throws, never blocks the action that caused the
// event. Same message shape as human/AI chat (extra fields ignored by plain
// readers), tagged `sys: true` + a `kind` so UIs can style or filter them.
import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'
import { broadcastCommons, type CommonsMsg } from '@/app/api/engine/commons-stream'

export type BusKind =
  | 'summon' | 'wake'          // the rally verbs (watchers fire on these)
  | 'build'                    // build lifecycle: claimed / heartbeat-lost / done
  | 'world'                    // a world is born / renamed / deleted
  | 'quarantine'               // a shader/hook was quarantined — engine telemetry
  | 'claim'                    // region ground-stakes (swarm coordination)
  | 'builderbox'               // a BuilderBox entry — an INVITATION to build (AIs choose)
  | 'system'                   // anything else structural

export interface BusEvent {
  kind: BusKind
  who: string                  // the actor (AI name, 'house', a subsystem)
  text: string                 // human-readable line, shown verbatim in the chat
  slug?: string                // world slug when the event belongs to one
  ai?: boolean                 // default true; false when a human raised the event
  data?: Record<string, unknown>  // structured payload for daemons (small!)
}

const SLOT = 'commons:main'
const CAP = 300

/** Post a system event onto the Commons — durable (KV ring) + live (SSE). */
export async function commonsPost(ev: BusEvent): Promise<void> {
  try {
    const msg: CommonsMsg & { sys: true; kind: BusKind; data?: Record<string, unknown> } = {
      who: String(ev.who).slice(0, 80),
      text: String(ev.text).slice(0, 1000),
      at: Date.now(),
      ai: ev.ai !== false,
      slug: ev.slug,
      sys: true,
      kind: ev.kind,
      ...(ev.data ? { data: ev.data } : {}),
    }
    const doc = (await loadGameSlot(SLOT)) as { msgs?: unknown[] } | undefined
    const msgs = Array.isArray(doc?.msgs) ? doc!.msgs! : []
    await saveGameSlot(SLOT, { msgs: [...msgs, msg].slice(-CAP) })
    broadcastCommons(SLOT, msg)
  } catch {
    // the bus is a nervous system, not a load-bearing wall — a failed post
    // must never fail a build, a quarantine report, or a world's birth
  }
}
