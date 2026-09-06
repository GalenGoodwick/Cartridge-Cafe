// bridge {type:'help'} — the PER-VERB CONTRACT CARD (Galen, Sep 5: closing the
// mega-tool's schema gap). The bridge is ONE tool with ~100 verbs, so no
// tool-call-layer schema validates a verb's params — an AI misremembering a
// shape used to find out from a runtime error. Now it can ask first:
//   bridge {type:'help'}                → every verb name, grouped
//   bridge {type:'help', verb:'X'}      → curated contract (if we have one)
//                                          + the LIVE guide excerpt mentioning X
// Two sources, deliberately: CONTRACTS below are terse and hand-checked against
// the handlers; the guide excerpt keeps help fresh even where curation lags —
// the guide is the living contract, help is its index.

import { readFile } from 'fs/promises'
import { join } from 'path'

/** every dispatchable verb, harvested from bridge/route.ts + space-store.ts —
 *  grouped so a bare help call reads as a map, not a wall */
export const VERB_GROUPS: Record<string, string[]> = {
  'build (nodes law)': ['add_step_hook', 'update_step_hook', 'remove_step_hook', 'claim_node', 'release_node', 'register_node', 'node_revert', 'node_history', 'remove_node', 'dock_node', 'undock_node'],
  'visuals & shaders': ['define_visual', 'set_visual', 'undo_visual', 'define_module', 'remove_module', 'register_glsl_mod', 'remove_glsl_mod', 'create_render_target', 'destroy_render_target'],
  fields: ['create_field', 'delete_field', 'clone_field', 'list_fields', 'set_position', 'set_scale', 'set_shape', 'set_color', 'set_name', 'set_parent', 'set_property', 'move', 'field_message', 'add_tag', 'remove_tag'],
  'world doc': ['set_world_data', 'set_world_params', 'validate_world_doc', 'put_world', 'reset_world', 'reset', 'clear_all', 'set_original', 'save_experience'],
  'effects & interactions': ['add_effect', 'update_effect', 'remove_effect', 'clear_effect', 'define_interaction', 'remove_interaction', 'add_interaction_effect', 'remove_interaction_effect', 'define_state', 'define_command', 'execute_command', 'create_portal', 'grow_building'],
  sprites: ['define_sprite', 'define_sheet', 'delete_sprite', 'list_sprites'],
  'worlds & account': ['create_world', 'use_world', 'publish_world', 'unpublish_world', 'credits_read', 'world_stores', 'set_player_icon', 'set_card', 'card_types', 'propose_card_type'],
  'verify (your eyes)': ['playthrough'],
  'the commons & swarm': ['main_say', 'main_read', 'summon', 'summons_read', 'wake_watcher', 'watch', 'roundtable_say', 'roundtable_read', 'roundtable_nominate', 'node_feed', 'node_feed_read', 'swarm_map', 'swarm_dock', 'swarm_release', 'swarm_jump', 'swarm_probe', 'swarm_heal', 'claim_region', 'withdraw_region', 'resolve_region', 'regions_read'],
}

type Contract = { params: string; example: Record<string, unknown>; law?: string; guide?: string }

/** hand-checked cards for the verbs AIs misremember most — terse on purpose;
 *  the guide excerpt underneath carries the depth */
export const CONTRACTS: Record<string, Contract> = {
  add_step_hook: {
    params: 'hookId (NEW, yours) · code (JS body: (state, dt, worldData, api)) · order? (number, lower runs first)',
    example: { type: 'add_step_hook', hookId: 'my-enemies', code: 'const wd = worldData; /* one small job */', order: 50 },
    law: 'one small hook per job, NEVER a monolith; the engine stamps the node to YOU and rejects writes to nodes you do not hold',
    guide: 'build-in-nodes',
  },
  update_step_hook: {
    params: 'hookId (one you hold) · code — full replacement body',
    example: { type: 'update_step_hook', hookId: 'my-enemies', code: '/* new body */' },
    law: 'claim_node {id} first if your claim lapsed; foreign nodes are refused',
  },
  claim_node: { params: 'id (hookId)', example: { type: 'claim_node', id: 'my-enemies' }, law: 'take or refresh a node; release_node when done' },
  register_node: {
    params: 'id · owns? ({uni: [[start,end]…]} — your gpuUniforms lanes)',
    example: { type: 'register_node', id: 'my-fx', owns: { uni: [[40, 47]] } },
    law: 'overlapping a declared lane is rejected — declare BEFORE writing packed uniforms',
  },
  define_visual: {
    params: 'name · wgsl (fn — see guide for the exact signature) — every FIELD needs a visualType or it renders as NOTHING',
    example: { type: 'define_visual', name: 'ember-glow', wgsl: 'fn ember_glow(...) -> vec4f { ... }' },
    law: 'each layer its OWN superimposed field, not one mega-shader; verify with render_probe after EVERY change',
    guide: 'visuals',
  },
  define_module: {
    params: 'name · wgsl (shared helper fns) — persists; use for bodies too big for one visual',
    example: { type: 'define_module', name: 'noise-lib', wgsl: 'fn hash21(p: vec2f) -> f32 { ... }' },
  },
  create_field: {
    params: 'id? · position {x,y,z} · shape? · scale? · visualType (REQUIRED to be visible) · properties?',
    example: { type: 'create_field', position: { x: 0, y: 2, z: 0 }, visualType: 'ember-glow' },
    guide: 'fields',
  },
  set_world_data: {
    params: 'data (object, MERGED into worldData) — instructions/vision/ui/premium ride here',
    example: { type: 'set_world_data', data: { instructions: 'WASD moves…' } },
    law: 'premium pricing needs ◆ IP control; internal __keys are route-owned and refused',
  },
  create_world: {
    params: 'name — births a NEW world (spends 1 build credit; keeper exempt)',
    example: { type: 'create_world', name: 'tidepool' },
    law: 'out of credits → the error carries buyAt; credits_read checks the wallet',
  },
  use_world: {
    params: 'slug — resume a world you own, or JOIN an open-sandbox world (mints your member:<handle> key; membership required)',
    example: { type: 'use_world', slug: 'tidepool' },
    law: 'every push on a joined world is attributed to your handle (provenance + lineage)',
  },
  playthrough: {
    params: 'input (timeline: [{t, press?, release?, move?}…]) · ticks — runs REAL hooks over time, returns the state trace',
    example: { type: 'playthrough', input: [{ t: 0, press: 'w' }, { t: 60, release: 'w' }], ticks: 120 },
    law: 'render_probe is one frame; playthrough is the play — interactive claims need it',
    guide: 'verification',
  },
  define_sprite: {
    params: 'name · png (base64) — 4MB/sheet, 24MB/world cap; needs the owner on ◆ premium suite for uploads',
    example: { type: 'define_sprite', name: 'hero', png: '<base64>' },
    guide: 'sprites',
  },
  define_sheet: {
    params: 'name · png · cols · rows · fps? — rips a strip into sheet.N slots; sprite(i,uv)/spriteAnim sample them',
    example: { type: 'define_sheet', name: 'hero-run', png: '<base64>', cols: 8, rows: 1, fps: 12 },
    guide: 'sprites',
  },
  main_say: { params: 'text — speak on the cafe-wide commons', example: { type: 'main_say', text: 'shipping a reef world' }, guide: 'the commons' },
  publish_world: { params: '(none) — OG creator only; proprietary worlds stay private', example: { type: 'publish_world' } },
  credits_read: { params: '(none) — your build-credit wallet + buyAt', example: { type: 'credits_read' } },
  node_revert: { params: 'id · rev? — roll a node back down its history chain', example: { type: 'node_revert', id: 'my-enemies' } },
}

const ALL_VERBS = Object.values(VERB_GROUPS).flat()

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
      verbs: VERB_GROUPS,
      next: 'bridge {type:"help", verb:"<name>"} for the contract · read_guide {"section":"…"} for full recipes',
    }
  }
  const v = String(verb).trim().toLowerCase()
  const contract = CONTRACTS[v]
  const excerpt = await guideExcerpt(v)
  if (!contract && !ALL_VERBS.includes(v)) {
    const near = ALL_VERBS.filter(n => n.includes(v) || v.includes(n.split('_')[0])).slice(0, 6)
    return { type: 'help', error: `no verb "${v}"`, didYouMean: near.length ? near : undefined, next: 'bridge {type:"help"} lists every verb' }
  }
  return {
    type: 'help', verb: v,
    ...(contract ? { params: contract.params, example: contract.example, ...(contract.law ? { law: contract.law } : {}) } : {}),
    ...(excerpt ? { guideSection: excerpt.section, guideExcerpt: excerpt.excerpt, next: `read_guide {"section":"${(contract?.guide ?? excerpt.section).toLowerCase()}"} for the full recipe` } : contract?.guide ? { next: `read_guide {"section":"${contract.guide}"}` } : {}),
  }
}
