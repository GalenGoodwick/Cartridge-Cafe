#!/usr/bin/env node
// cite.mjs — query the citation zone. When an AI defines a NEW scene and builds
// out its worktree, it checks here first for proven, reusable components from
// prior tree nodes rather than rebuilding. This is how the tree compounds.
//
//   node swarm/cite.mjs [keyword]

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const { components } = JSON.parse(readFileSync(join(here, 'COMPONENTS.json'), 'utf8'))
const q = (process.argv[2] || '').toLowerCase()
const hay = (c) => (c.id + ' ' + c.kind + ' ' + c.reuse + ' ' + (c.exports || []).join(' ')).toLowerCase()
const hits = components.filter((c) => !q || hay(c).includes(q))

console.log(`\nCITATION ZONE — ${hits.length}/${components.length} component${hits.length === 1 ? '' : 's'}${q ? ` matching "${q}"` : ''}`)
for (const c of hits) {
  console.log(`\n  ⟐ ${c.id}   [${c.kind}]   ← ${c.from}`)
  console.log(`    ${c.reuse}`)
  console.log(`    exports: ${(c.exports || []).join(', ')}`)
  console.log(`    proven:  ${c.proven}`)
  console.log(`    cite:    ${c.cite}`)
  if (c.compose) console.log(`    compose: ${c.compose}`)
}
console.log()
