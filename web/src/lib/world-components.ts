// WORLD COMPONENTS — the platform-wide registry of reusable, parameterized,
// superimposable parts (Galen: give imagination a vocabulary that executes).
//
// A component is a named field recipe: a visual (its drawn alpha IS its
// pixel-perfect zone and collider), tags, and defaults. Placing one stamps a
// field; tag RULES wire overlap shaders between placed components
// automatically (fire × flammable → char) — intersections by vocabulary,
// never by pairwise bespoke code.
//
// Per the no-bias law: this file stores and matches — it prescribes nothing.
// Anyone can define components and rules; the vocabulary grows from the
// community, not from a house catalog.
import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'

export interface ComponentDef {
  name: string                       // kebab-case, unique
  wgsl: string                       // must define fn visual_c_<name>(...)
  tags: string[]
  description?: string
  defaults?: { w?: number; h?: number; color?: [number, number, number, number]; params?: [number, number, number, number] }
  author: string
  at: number
}

export interface TagRule {
  id: string
  a: string                          // tag
  b: string                          // tag (order-independent match)
  wgsl?: string                      // interactionEffect shader at overlap pixels
  spread?: number
  hooks?: unknown[]                  // behavioral hooks (see interaction effects)
  description?: string
  author: string
  at: number
}

const REG_SLOT = 'components:registry'
const RULES_SLOT = 'components:tagrules'
const MAX_COMPONENTS = 500
const MAX_RULES = 300
const MAX_WGSL = 32_000

export const COMPONENT_NAME_RE = /^[a-z0-9][a-z0-9-]{1,39}$/

export function componentVisualName(name: string): string {
  return 'c_' + name.replace(/-/g, '_')
}

export async function loadComponents(): Promise<ComponentDef[]> {
  const doc = (await loadGameSlot(REG_SLOT)) as { components?: ComponentDef[] } | undefined
  return Array.isArray(doc?.components) ? doc.components : []
}

export async function saveComponent(def: ComponentDef): Promise<{ error?: string }> {
  if (!COMPONENT_NAME_RE.test(def.name)) return { error: 'name must be kebab-case, 2-40 chars' }
  if (def.wgsl.length > MAX_WGSL) return { error: `wgsl too large (max ${MAX_WGSL} bytes)` }
  const fnName = 'visual_' + componentVisualName(def.name)
  if (!new RegExp('fn\\s+' + fnName + '\\s*\\(').test(def.wgsl)) {
    return { error: `wgsl must define fn ${fnName}(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f` }
  }
  const all = await loadComponents()
  const i = all.findIndex(c => c.name === def.name)
  if (i >= 0) all[i] = def
  else {
    if (all.length >= MAX_COMPONENTS) return { error: 'registry full' }
    all.push(def)
  }
  await saveGameSlot(REG_SLOT, { components: all })
  return {}
}

export async function loadTagRules(): Promise<TagRule[]> {
  const doc = (await loadGameSlot(RULES_SLOT)) as { rules?: TagRule[] } | undefined
  return Array.isArray(doc?.rules) ? doc.rules : []
}

export async function saveTagRule(rule: TagRule): Promise<{ error?: string }> {
  if (!rule.a || !rule.b) return { error: 'a and b tags required' }
  if (rule.wgsl && rule.wgsl.length > MAX_WGSL) return { error: 'wgsl too large' }
  const all = await loadTagRules()
  // one rule per unordered tag pair — redefining replaces
  const key = [rule.a, rule.b].sort().join('×')
  const i = all.findIndex(r => [r.a, r.b].sort().join('×') === key)
  if (i >= 0) all[i] = rule
  else {
    if (all.length >= MAX_RULES) return { error: 'rule store full' }
    all.push(rule)
  }
  await saveGameSlot(RULES_SLOT, { rules: all })
  return {}
}

/** Rules that fire between two tag sets (unordered). */
export function matchTagRules(rules: TagRule[], tagsA: string[], tagsB: string[]): TagRule[] {
  const A = new Set(tagsA)
  const B = new Set(tagsB)
  return rules.filter(r => (A.has(r.a) && B.has(r.b)) || (A.has(r.b) && B.has(r.a)))
}
