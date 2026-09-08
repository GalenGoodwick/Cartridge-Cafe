// bridge {type:'help'} — the PER-VERB CONTRACT CARD (Galen, Sep 5: closing the
// mega-tool's schema gap). The bridge is ONE tool with ~100 verbs, so no
// tool-call-layer schema validates a verb's params — an AI misremembering a
// shape used to find out from a runtime error. Now it can ask first:
//   bridge {type:'help'}                → every verb name, grouped
//   bridge {type:'help', verb:'X'}      → its contract card
//                                          + the LIVE guide excerpt mentioning X
// GENERATED, NOT HAND-WRITTEN (item 4): the groups and cards derive from the ONE
// command registry (@/lib/command-registry) — the same source space-store's
// param enforcement derives from and the CI conformance tests pin the MCP
// schemas + guide examples against. Help can no longer drift from the contract,
// because it IS the contract. The guide excerpt stays live-read so depth follows
// the guide even where a card is terse.

import { readFile } from 'fs/promises'
import { join } from 'path'
import { COMMAND_REGISTRY, verbGroups, contractCard } from '@/lib/command-registry'

const ALL_VERBS = Object.keys(COMMAND_REGISTRY)

/** the LIVE excerpt: first guide block that mentions the verb, plus which
 *  section to read_guide for the full recipe */
async function guideExcerpt(verb: string): Promise<{ section: string; excerpt: string } | null> {
  try {
    const md = await readFile(join(process.cwd(), 'src/app/engine/AI_ENGINE_GUIDE.md'), 'utf-8')
    const lines = md.split('\n')
    const hit = lines.findIndex(l => l.includes(verb))
    if (hit < 0) return null
    let section = 'core'
    for (let i = hit; i >= 0; i--) {
      const m = /^#{2,4} (.+)$/.exec(lines[i])
      if (m) { section = m[1].replace(/<!-- core -->/, '').trim(); break }
    }
    return { section, excerpt: lines.slice(Math.max(0, hit - 1), hit + 7).join('\n').slice(0, 900) }
  } catch { return null }
}

export async function bridgeHelp(verb?: string): Promise<Record<string, unknown>> {
  if (!verb) {
    return {
      type: 'help',
      verbs: verbGroups(),
      next: 'bridge {type:"help", verb:"<name>"} for the contract · read_guide {"section":"…"} for full recipes',
    }
  }
  const v = String(verb).trim().toLowerCase()
  const card = contractCard(v)
  const excerpt = await guideExcerpt(v)
  if (!card) {
    const near = ALL_VERBS.filter(n => n.includes(v) || v.includes(n.split('_')[0])).slice(0, 6)
    return { type: 'help', error: `no verb "${v}"`, didYouMean: near.length ? near : undefined, next: 'bridge {type:"help"} lists every verb' }
  }
  return {
    type: 'help', verb: v,
    what: card.desc,
    params: card.params,
    ...(card.example ? { example: card.example } : {}),
    ...(card.law ? { law: card.law } : {}),
    ...(excerpt ? { guideSection: excerpt.section, guideExcerpt: excerpt.excerpt, next: `read_guide {"section":"${(card.guide ?? excerpt.section).toLowerCase()}"} for the full recipe` } : card.guide ? { next: `read_guide {"section":"${card.guide}"}` } : {}),
  }
}
