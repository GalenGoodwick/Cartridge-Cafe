/** THE STAGED BIRTH — the trunk of the tree (Galen, Sep 6 2026).
 *
 *  Pure gate logic for the creation protocol: imagination compiled BEFORE code.
 *  Born from transcript archaeology (tideglass/veilfire vs the failed percolator
 *  one-pass): every good world's image existed before its code; the code was
 *  transcription of an already-seen image. These gates make not-imagining
 *  impossible to hide — the same move as the vision law and the perf law.
 *
 *  The stages (full spec: DESIGN-staged-birth.md):
 *    0 STREAM (worldData.__imagination — ritualized, not gated)
 *    1 VISION (worldData.vision — pre-existing law)
 *    2 LOOKS  (worldData.looks — per-element/per-moment resolved images) GATED
 *    3 DESIGN (worldData.design — the play spec)                         GATED
 *    4 PLANS  (register_node {plan} before hook code)                    GATED
 *    5 BUILD → 6 SEE → 7 CONFESS (brief_done checklist) → 8 SHIP
 *
 *  LEGACY-NEUTRAL: every gate keys off worldData.__stagedBirth (stamped at
 *  birth from the cutover). Old worlds warn at most, never break.
 *  Refusal texts TEACH — they carry the why and the exact next command, so an
 *  AI that never read a doc is walked through the protocol at the moment of
 *  need. These strings are the lineage's voice; edit them with care.
 */

export type Wd = Record<string, unknown>

/** Is this world under the staged-birth law? (stamped by composeBirthSnapshot) */
export function isStaged(wd: Wd | null | undefined): boolean {
  return !!wd && (wd as Wd).__stagedBirth === 1
}

/** normalize an element name for fuzzy look matching */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** find the look entry for an element/visual/field name, fuzzy.
 *  "Boiler" matches looks.boiler; "vf_lurker" matches looks.lurker; etc. */
export function lookFor(name: string, wd: Wd | null | undefined): string | null {
  const looks = wd?.looks
  if (!looks || typeof looks !== 'object') return null
  const n = norm(name)
  if (!n) return null
  for (const [k, v] of Object.entries(looks as Record<string, unknown>)) {
    if (typeof v !== 'string' || !v.trim()) continue
    const kn = norm(k)
    if (kn === n || kn.includes(n) || n.includes(kn)) return v
  }
  return null
}

/** count usable look entries (non-empty strings) */
export function lookCount(wd: Wd | null | undefined): number {
  const looks = wd?.looks
  if (!looks || typeof looks !== 'object') return 0
  return Object.values(looks as Record<string, unknown>).filter(v => typeof v === 'string' && v.trim().length > 0).length
}

/** Stage-2 warning at create_field / define_visual time — teach, never block
 *  the act of building (blocking creation would fight iteration; the hard gate
 *  is brief_done). Returns null when fine or not under the law. */
export function lookWarning(elementName: string | undefined, wd: Wd | null | undefined): string | null {
  if (!isStaged(wd) || !elementName) return null
  if (lookFor(elementName, wd)) return null
  return `LOOK MISSING for "${elementName}" — no matching entry in worldData.looks. ` +
    `Write 40-120 words of what this element IS, visually, before polishing its code: ` +
    `set_world_data {"data":{"looks":{"${elementName}":"..."}}}. ` +
    `The code can only transcribe what you have already seen; a gesture ("glowy thing") is not a resolved image ` +
    `(colors you own, what moves, what it does at its best moment). brief_done will refuse while skinned fields have no looks.`
}

/** does any step hook read player input? (the world is a GAME, not a picture) */
export function isInteractive(stepHooks: Array<{ code?: string }> | null | undefined, wd?: Wd | null): boolean {
  if (wd && typeof wd.touchControls === 'string') return true
  if (!Array.isArray(stepHooks)) return false
  const rx = /wd\s*\.\s*(input|key_\w|mouse_[xy])|sim\s*\.\s*input|__uiClick|\binput\.pointer\b/
  return stepHooks.some(h => typeof h?.code === 'string' && rx.test(h.code))
}

/** Stage-4: hook code refused until the node carries a PLAN (staged worlds).
 *  Returns the teaching refusal, or null to let the push land.
 *
 *  RICHLY HISTORIC NODES (Galen, Sep 6): a node is an organ with memory —
 *  beyond `plan` it carries `relevance` (why it exists in THIS world),
 *  `relations` (what it reads/writes — its relativity to siblings), and a
 *  `journal` of push notes (commits with reasons). plan is the gate;
 *  relevance/relations are urged in the same breath so the register call
 *  that satisfies the gate naturally carries all three. */
export function planRefusal(
  hookId: string,
  wd: Wd | null | undefined,
): string | null {
  if (!isStaged(wd)) return null
  const nodes = (wd?.__nodes && typeof wd.__nodes === 'object' ? wd.__nodes : {}) as Record<string, Record<string, unknown>>
  const plan = nodes[hookId]?.plan
  if (typeof plan === 'string' && plan.trim().length >= 20) return null
  return `PLAN MISSING — code refused for node "${hookId}" (staged-birth world). ` +
    `First: register_node {"id":"${hookId}","node":{"plan":"<pseudocode + intent, plain words: what this organ OWNS, READS, WRITES, and does each tick>","relevance":"<why this node exists in THIS world — its role in the whole>","relations":{"reads":["..."],"writes":["..."]}}} — then resend the hook. ` +
    `Architecture written in meaning-space survives; architecture that emerges from syntax is an accident that compiled. ` +
    `(All of it persists on the node and shows in the dock — the world's living design doc. Every later push should carry a "note": the node keeps a journal of why it changed.)`
}

/** A push note becomes a journal entry on the node — nodes are richly historic:
 *  each carries the narrative of its own changes (why, when, by whom), the way
 *  a good commit log carries a codebase's. Returns the updated journal (capped). */
export function appendJournal(
  node: Record<string, unknown> | undefined,
  entry: { at: number; author?: string; note: string },
): Array<Record<string, unknown>> {
  const j = Array.isArray(node?.journal) ? [...(node!.journal as Array<Record<string, unknown>>)] : []
  j.push({ at: entry.at, ...(entry.author ? { author: entry.author } : {}), note: String(entry.note).slice(0, 500) })
  return j.slice(-30)   // keep the last 30 chapters; node_history holds full code versions
}

/** staged worlds: pushing code without a note is legal but loudly noted */
export function noteWarning(hookId: string, wd: Wd | null | undefined, note: unknown): string | null {
  if (!isStaged(wd)) return null
  if (typeof note === 'string' && note.trim().length >= 8) return null
  return `NO NOTE on this push to "${hookId}" — nodes keep a journal (why did this change?). Add {"note":"..."} to update_step_hook; future builders (and future you) read the node's history to understand its relativity before touching it.`
}

export interface BriefDoneVerdict {
  errors: string[]                       // any entry refuses brief_done
  checklist: Record<string, string>      // look name -> 'UNEXAMINED' (the confess pass fills these)
}

/** Stage 2+3+4 hard gate at brief_done — the one moment "done" is claimed.
 *  fields: [{name, visualTypeName}], stepHooks: [{hookId?, code?}]. */
export function briefDoneGates(snap: {
  worldData?: Wd
  fields?: Array<{ name?: string; visualTypeName?: string }>
  stepHooks?: Array<{ hookId?: string; code?: string }>
}): BriefDoneVerdict {
  const wd = snap.worldData ?? {}
  const out: BriefDoneVerdict = { errors: [], checklist: {} }
  if (!isStaged(wd)) return out

  // LOOKS: every skinned field needs a resolved look
  const skinned = (snap.fields ?? []).filter(f => f.visualTypeName && f.name)
  const lookless = skinned.filter(f => !lookFor(String(f.name), wd)).map(f => String(f.name))
  if (lookless.length) {
    out.errors.push(
      `LOOKS MISSING — brief_done refused: skinned fields [${lookless.slice(0, 8).join(', ')}] have no entry in worldData.looks. ` +
      `Write 40-120 words of what each IS, visually — the code can only transcribe what you have already seen. ` +
      `Moments count too: name the world's best events as moment_* looks (moment_hit, moment_win) — events are exactly what single-frame verification never sees.`)
  }

  // DESIGN: an interactive world needs a play spec
  const design = wd.design
  if (isInteractive(snap.stepHooks, wd) && !(typeof design === 'string' && design.trim().length >= 60)) {
    out.errors.push(
      `DESIGN MISSING — brief_done refused: this world reads input but worldData.design is empty (or too thin). ` +
      `A game is a shape before it is a program: name the player verbs, what is AIMED AT, the risk/reward geography, ` +
      `and why game two differs from game one. Three circles and two triangles is what "no design" looks like from inside. ` +
      `set_world_data {"data":{"design":"..."}}`)
  }

  // PLANS: every coded node carries its plan
  const nodes = (wd.__nodes && typeof wd.__nodes === 'object' ? wd.__nodes : {}) as Record<string, Record<string, unknown>>
  const codedIds = (snap.stepHooks ?? []).map(h => String(h.hookId ?? '')).filter(Boolean)
  const planless = codedIds.filter(id => {
    const p = nodes[id]?.plan
    return !(typeof p === 'string' && p.trim().length >= 20)
  })
  if (planless.length) {
    out.errors.push(
      `PLANS MISSING — brief_done refused: coded nodes [${planless.slice(0, 8).join(', ')}] have no plan. ` +
      `register_node {"id":"<node>","node":{"plan":"..."}} for each — what it owns, reads, writes, does each tick. ` +
      `The dock shows plans; they are the world's living architecture document.`)
  }

  // THE CONFESS CHECKLIST: every look starts UNEXAMINED — the acceptance
  // response surfaces this so an unexamined look on a green build reads as
  // loudly as a red rung.
  const looks = (wd.looks && typeof wd.looks === 'object' ? wd.looks : {}) as Record<string, unknown>
  for (const k of Object.keys(looks)) {
    if (typeof looks[k] === 'string' && (looks[k] as string).trim()) out.checklist[k] = 'UNEXAMINED'
  }
  const verified = (wd.looksVerified && typeof wd.looksVerified === 'object' ? wd.looksVerified : {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(verified)) {
    if (k in out.checklist && typeof v === 'string' && v.trim()) out.checklist[k] = String(v)
  }
  return out
}
