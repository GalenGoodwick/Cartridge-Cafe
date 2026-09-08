import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMMAND_REGISTRY, knownParams, verbGroups, contractCard } from '@/lib/command-registry'

// Item 4 — the ONE command registry. These are the CI teeth that make drift
// impossible: the enforced whitelist, the help cards, the MCP schema, and the
// guide's JSON examples must all agree with THIS file — or the build goes red.

const ROOT = join(process.cwd())

describe('command registry — internal coherence', () => {
  it('every example matches its own contract (type === name, keys ⊆ params)', () => {
    for (const [name, spec] of Object.entries(COMMAND_REGISTRY)) {
      if (!spec.example) continue
      expect(spec.example.type, `${name}: example.type`).toBe(name)
      if (spec.params) {
        const allowed = new Set(['type', ...Object.keys(spec.params)])
        for (const k of Object.keys(spec.example)) {
          expect(allowed.has(k), `${name}: example key "${k}" not in its params contract`).toBe(true)
        }
      }
    }
  })

  it('every enforced entry has params; groups and cards derive', () => {
    for (const [name, spec] of Object.entries(COMMAND_REGISTRY)) {
      if (spec.enforce) expect(spec.params, `${name}: enforce without params`).toBeTruthy()
    }
    expect(Object.values(verbGroups()).flat().length).toBe(Object.keys(COMMAND_REGISTRY).length)
    expect(contractCard('create_field')!.params).toContain('visualType')
    expect(contractCard('nonexistent_verb')).toBeNull()
  })
})

describe('conformance — space-store enforcement', () => {
  // Transition proof (one-time, Sep 8): before the rewire, a source-level diff
  // verified the registry-derived sets EXACTLY matched all 26 literal
  // KNOWN_PARAMS sets, key for key. Now the literal is gone — space-store
  // derives from the registry, so equality holds by construction. What remains
  // testable: the wiring itself, and the derived map's shape.
  it('space-store derives its whitelist from the registry (no literal to drift)', () => {
    const src = readFileSync(join(ROOT, 'src/app/api/engine/space-store.ts'), 'utf8')
    expect(src).toContain("import { knownParams } from '@/lib/command-registry'")
    expect(src).toContain('const KNOWN_PARAMS: Record<string, Set<string>> = knownParams()')
    expect(src).not.toContain('new Set([\'type\'') // the old literal is really gone
  })

  it('the derived whitelist covers the historically-enforced command set', () => {
    const kp = knownParams()
    for (const name of ['create_field', 'set_visual', 'set_world_data', 'define_visual', 'put_world', 'move', 'update_effect']) {
      expect(kp[name], `${name} lost enforcement`).toBeTruthy()
      expect(kp[name].has('type')).toBe(true)
    }
    expect(Object.keys(kp).length).toBe(26)
  })
})

describe('conformance — bridge route coverage', () => {
  it('every verb the bridge route dispatches is in the registry', () => {
    const src = readFileSync(join(ROOT, 'src/app/api/engine/bridge/route.ts'), 'utf8')
    const verbs = new Set<string>()
    for (const m of src.matchAll(/cmd\.type === '([a-z_]+)'/g)) verbs.add(m[1])
    // false positives from type-guards, not commands:
    const notCommands = new Set(['string'])
    const missing = [...verbs].filter(v => !notCommands.has(v) && !COMMAND_REGISTRY[v])
    expect(missing, `bridge verbs missing from the registry: ${missing.join(', ')}`).toEqual([])
  })
})

describe('conformance — MCP schemas', () => {
  it('brew_world zod keys EXACTLY match the registry create_world params', () => {
    const src = readFileSync(join(ROOT, '..', 'mcp', 'index.mjs'), 'utf8')
    // the brew_world schema object literal: keys at the top level between the
    // tool description and the handler
    const start = src.indexOf("'brew_world'")
    expect(start).toBeGreaterThan(0)
    const block = src.slice(start, src.indexOf('async (', start))
    const keys = new Set<string>()
    for (const m of block.matchAll(/^\s{4}(\w+): z\./gm)) keys.add(m[1])
    const registryKeys = new Set(Object.keys(COMMAND_REGISTRY.create_world.params!))
    expect([...keys].sort(), 'MCP brew_world schema ≠ registry create_world contract').toEqual([...registryKeys].sort())
  })
})

describe('conformance — guide examples', () => {
  it('every JSON command example in the guide parses and conforms to the registry', () => {
    const md = readFileSync(join(ROOT, 'src/app/engine/AI_ENGINE_GUIDE.md'), 'utf8')
    const found: Array<{ verb: string; keys: string[] }> = []
    for (const m of md.matchAll(/^\{"type": "([a-z_]+)".*\}$/gm)) {
      let obj: Record<string, unknown>
      try { obj = JSON.parse(m[0]) } catch { expect.fail(`guide example does not parse: ${m[0].slice(0, 80)}`) ; continue }
      found.push({ verb: m[1], keys: Object.keys(obj) })
    }
    expect(found.length).toBeGreaterThan(5) // the guide really has examples
    for (const { verb, keys } of found) {
      const spec = COMMAND_REGISTRY[verb]
      expect(spec, `guide documents unknown verb "${verb}"`).toBeTruthy()
      if (spec?.params) {
        const allowed = new Set(['type', ...Object.keys(spec.params)])
        for (const k of keys) expect(allowed.has(k), `guide ${verb} example uses undocumented param "${k}"`).toBe(true)
      }
    }
  })
})
