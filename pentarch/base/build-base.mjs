// build-base.mjs — assemble base/hook.js from its SEPARATED parts. This is the
// base separation: each concern is one file, the hook is a generated artifact.
//
//   ../battle-engine.js      ENG — physics/energy/turret/route engine, itself
//                            generated from the tested .mjs modules by
//                            build-engine-v2.mjs. NEVER hand-edited.
//   catalogue.part.js        penta geometry helpers + the module catalogue
//                            (PARTS/V2SPEC/ORIENTABLE/…) — designer-scope truth.
//   flight.part.js           BATTLE MODE — the momentum/flight node (arcade
//                            controller, routes, power, guns). Owns its B door.
//   yard.part.js             DESIGN MODE — layout, ghosts, palette, publish, HUD.
//   (frame)                  emitted HERE: versioned state + self-healing catch.
//
// THE FRAME LAW — why "we lost the core" can never silently happen again:
//   · wd.__pd persists in worldData ACROSS hook pushes. A stale shape under a
//     new hook used to throw every tick into `catch (e) {}` → nothing published
//     → dead black yard (palette still painted; it's hardcoded in the shader).
//   · Now: HOOK_V stamps the state. Shape change → bump HOOK_V below → stale
//     state self-heals to a fresh yard on the first tick after a push.
//   · And the catch HEALS instead of swallowing: soft (back to design, relayout)
//     first, hard (fresh yard) after repeats — with the error ON the HUD.
//
// Run: node base/build-base.mjs        (writes base/hook.js, then replay-boots it)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (f) => readFileSync(join(HERE, f), 'utf8').replace(/\s+$/, '')

// bump when the __pd state SHAPE changes (fields added/renamed/battle bt shape)
const HOOK_V = 2

const hook = `try {
// ── BATTLE ENGINE — generated from the tested modules (build-engine-v2.mjs) ──
${read('../battle-engine.js')}
  const wd = sim.worldData
${read('catalogue.part.js')}
  // ── STATE FRAME (build-base.mjs) — versioned + self-healing ──
  const HOOK_V = ${HOOK_V}
  if (!wd.__pd || wd.__pd.v !== HOOK_V) wd.__pd = { v: HOOK_V, tree: [{ parent: -1, edge: -1, part: 1 }], sel: 0, rev: 0, t: 0 }
  const D = wd.__pd
  D.t += Math.min(dt, 1 / 30)
  // UNDO (U): every mutation snapshots the tree first; U walks back (cap 40)
  const pushU = () => { (D.undo = D.undo || []).push(JSON.stringify(D.tree)); if (D.undo.length > 40) D.undo.shift() }
  if (sim.edge('yard-undo', !!wd.key_u) && D.undo && D.undo.length && D.mode !== 'battle') {
    D.tree = JSON.parse(D.undo.pop()); D.sel = Math.min(D.sel, D.tree.length - 1); D.rev++; D.lastClick = null
    wd.__play_sound = [{ frequency: 360, duration: 0.08, volume: 0.1, type: 'sine' }]
  }
${read('flight.part.js')}
${read('yard.part.js')}
} catch (e) {
  // NEVER a silent black world: heal soft (back to the yard, force relayout),
  // then hard (fresh state) if it keeps throwing — and SAY SO on the HUD.
  try {
    const wd2 = sim.worldData, P = wd2.__pd
    wd2.__pderr = (wd2.__pderr || 0) + 1
    if (P && wd2.__pderr < 4) { P.mode = 'design'; P.bt = null; P.layoutRev = -999; P.sel = 0 }
    else { wd2.__pd = null; wd2.__pderr = 0 }
    wd2.hud = [{ id: 'err', type: 'text', x: '3%', y: '50%', text: 'RECOVERED: ' + String((e && e.message) || e).slice(0, 70), fontSize: '12px', color: '#ff8a7a' }]
  } catch (e2) { }
}`

writeFileSync(join(HERE, 'hook.js'), hook + '\n')

// smoke: boot the assembled hook in a fake sim — core must publish as 300
const fn = new Function('sim', 'dt', hook)
const sim = { worldData: {}, __e: {}, edge(k, v) { const w = !!this.__e[k]; this.__e[k] = !!v; return !!v && !w } }
for (let i = 0; i < 3; i++) fn(sim, 1 / 60)
const pop = sim.worldData.gpuPopulation
if (!pop || pop[3] !== 300) throw new Error('smoke failed: core not published (pop=' + (pop && pop.slice(0, 4)) + ')')
console.log('✓ base/hook.js assembled (' + hook.length + ' b) — core publishes 300, HOOK_V=' + HOOK_V)
