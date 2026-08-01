// build-engine-v2.mjs — append the v2 ship-systems modules (phys / energy2 /
// turret / route, all tested) into battle-engine.js as nested IIFEs inside ENG.
// Repeatable: strips any previous V2 section and regenerates from the .mjs
// sources, so the tested files stay the single source of truth.
// Renames on the way in (ENG-scope collision safety):
//   phys.step → flyStep · energy2.tick → powerTick · energy2.budget → powerBudget
//   turret.fire → mountFire · turret.cool → mountCool · turret.wrap → wrapAng
//   turret's freeEdges import → freeEdgesV2 (derived from ENG's own contacts())
// Run: node pentarch/build-engine-v2.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')

/** strip import lines + `export ` keywords → plain declarations */
const strip = (src) => src
  .split('\n').filter(l => !/^import /.test(l)).join('\n')
  .replace(/^export function /gm, 'function ')
  .replace(/^export const /gm, 'const ')

const module_ = (name, src, returns, renames = {}) => {
  let body = strip(src)
  for (const [from, to] of Object.entries(renames)) {
    body = body.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
  }
  return `// ── V2/${name} (generated from ${name}.mjs — edit THAT file + rerun build-engine-v2) ──
const { ${returns.join(', ')} } = (() => {
${body}
  return { ${returns.join(', ')} }
})()
`
}

const phys = module_('phys', read('./phys.mjs'),
  ['massProps', 'edgeNormal', 'thrusters', 'wrench', 'allocate', 'netWrench', 'envelope', 'flyStep', 'DRAG', 'ANG_DRAG', 'MOUNTS', 'shipMass', 'aimGimbal'],
  { step: 'flyStep' })

const energy = module_('energy2', read('./energy2.mjs'),
  ['gridOf', 'newBank', 'powerTick', 'powerBudget', 'BROWN_GUN', 'BROWN_THRUST', 'BROWNOUT_ENTER', 'BROWNOUT_EXIT'],
  { tick: 'powerTick', budget: 'powerBudget' })

const turret = module_('turret', read('./turret.mjs'),
  ['arcOf', 'arcWidth', 'inArc', 'clampToArc', 'newMount', 'traverse', 'canFire', 'mountFire', 'mountCool', 'wrapAng', 'SECTOR_HALF', 'AIM_TOL'],
  { fire: 'mountFire', cool: 'mountCool', wrap: 'wrapAng', freeEdges: 'freeEdgesV2' })

const route = module_('route', read('./route.mjs'),
  ['arcToPoint', 'maxSpeedForKappa', 'clickCommand', 'resample', 'curvatures', 'speedProfile', 'follow', 'arcPath'])

const V2_EXPORTS = ['massProps', 'edgeNormal', 'thrusters', 'allocate', 'netWrench', 'envelope', 'flyStep', 'DRAG', 'MOUNTS', 'shipMass', 'aimGimbal',
  'gridOf', 'newBank', 'powerTick', 'powerBudget', 'BROWN_GUN', 'BROWN_THRUST',
  'arcOf', 'arcWidth', 'inArc', 'clampToArc', 'newMount', 'traverse', 'canFire', 'mountFire', 'mountCool', 'wrapAng', 'SECTOR_HALF',
  'arcToPoint', 'maxSpeedForKappa', 'clickCommand', 'resample', 'curvatures', 'speedProfile', 'follow', 'arcPath', 'freeEdgesV2']

const section = `
// ═══════════════ V2 SHIP SYSTEMS (generated — see build-engine-v2.mjs) ═══════════════
// freeEdges derived from ENG's own contacts() (turret arcs are EARNED BY PLACEMENT)
function freeEdgesV2(tiles) {
  const used = new Set()
  for (const c of contacts(tiles)) { used.add(c.i + ':' + c.ei); used.add(c.j + ':' + c.ej) }
  const out = []
  for (let i = 0; i < tiles.length; i++) for (let e = 0; e < 5; e++) if (!used.has(i + ':' + e)) out.push({ i, e })
  return out
}
${phys}
${energy}
${turret}
${route}
// ═══════════════ end V2 ═══════════════
`

let eng = readFileSync(new URL('./battle-engine.js', import.meta.url), 'utf8')
// remove a previous V2 section (regeneration)
eng = eng.replace(/\n\/\/ ═+ V2 SHIP SYSTEMS[\s\S]*?\/\/ ═+ end V2 ═+\n/, '\n')
// strip previous V2 names from the return line, then re-add
const retRe = /return \{ (makeUnit[^}]*?) \};/
const m = eng.match(retRe)
if (!m) throw new Error('ENG return line not found')
const baseNames = m[1].split(',').map(s => s.trim()).filter(n => !V2_EXPORTS.includes(n.split(':')[0].trim()))
const newRet = `return { ${[...baseNames, ...V2_EXPORTS].join(', ')} };`
eng = eng.replace(retRe, section + newRet)
writeFileSync(new URL('./battle-engine.js', import.meta.url), eng)

// self-check: evaluate + exercise
const ENG = new Function(eng + '\nreturn ENG;')()
const missing = V2_EXPORTS.filter(k => typeof ENG[k] === 'undefined')
if (missing.length) throw new Error('missing exports: ' + missing)
const t = (cx, cy, part = null, o = 0) => ({ cx, cy, th: 0, part, o, mass: 1 })
const e = ENG.envelope([t(0, 0), t(-1, 1, { thrust: 10 }, 1), t(-1, -1, { thrust: 10 }, 1)])   // nozzle backward (o=1) → thrust forward
if (!(e.aFwd > 0)) throw new Error('envelope dead')
console.log('✓ battle-engine.js regenerated with V2 —', eng.length, 'chars; envelope smoke aFwd =', e.aFwd.toFixed(2))
console.log('  next: node base/build-base.mjs   (assembles base/hook.js from parts — no hand-splicing)')
