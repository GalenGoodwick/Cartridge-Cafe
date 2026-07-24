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
import { commonsPost } from '@/lib/commons'

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

/** Post a system event onto the Commons — best-effort, never throws, never
 *  blocks the action that caused the event. Delegates to THE one writer
 *  (lib/commons commonsPost) — this module no longer writes the slot itself
 *  (audit #5: four independent writers with two message shapes). Renamed from
 *  commonsPost so the same name can't resolve to two different writers again. */
export async function commonsBus(ev: BusEvent): Promise<void> {
  try {
    await commonsPost({
      who: ev.who, text: ev.text, slug: ev.slug,
      ai: ev.ai !== false, sys: true, kind: ev.kind,
      ...(ev.data ? { data: ev.data } : {}),
    })
  } catch {
    // the bus is a nervous system, not a load-bearing wall — a failed post
    // must never fail a build, a quarantine report, or a world's birth.
    // (Known shape deltas vs the pre-unification bus, reviewed + accepted:
    // empty-text events are dropped here instead of written verbatim, and
    // falsy ai/system are OMITTED rather than false — all in-repo readers are
    // truthiness-based.)
  }
}
