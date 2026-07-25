// VEILFIRE 3D — vf-integrate (node): compose every fragment into ONE world and
// deploy it. Antichamber-style Gothic horror shooter, raymarched, built on the
// shooter3 systems. Assembles: modules (world3 + anim3 + rooms + demons +
// enemies + projectiles + atmosphere + hud) + the visual_s3 megashader + the
// one ordered step-hook (movement → enemies → projectiles → combat → deathfx →
// audio). Exports its pieces so the loop can be probed before shipping.
//
//   Run:  VF_TOKEN=uc_st_... node veilfire-cartridge.mjs   (deploys via the bridge)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const rd = (p) => readFileSync(join(here, p), 'utf8')
const frag = (p) => rd(p).replace(/export function/g, 'function')

export const MODULES = [
  ['world3', 'world3-lib.wgsl'], ['anim3', 'anim3-lib.wgsl'],
  ['rooms', 'veilfire/rooms.wgsl'], ['demons', 'veilfire/demons.wgsl'],
  ['enemies', 'shooter3/enemies.wgsl'], ['proj', 'shooter3/projectiles.wgsl'],
  ['atmos', 'veilfire/atmosphere.wgsl'], ['hud', 'shooter3/hud.wgsl'],
].map(([name, f]) => ({ name, wgsl: rd(f) }))

export const VISUAL = { name: 's3', wgsl: rd('shooter3/render.wgsl') }

// the ONE ordered step-hook: fragments (export→plain fn) + frame orchestration
export const HOOK = [
  'shooter3/hooks/movement.mjs', 'shooter3/hooks/enemies.mjs',
  'shooter3/hooks/projectiles.mjs', 'shooter3/hooks/combat.mjs',
  'shooter3/hooks/deathfx.mjs', 'shooter3/hooks/audio.mjs',
].map(frag).join('\n') + `
try {
  const wd = sim.worldData
  if (!wd.__vf || wd.__vf.ver !== 1) wd.__vf = { ver: 1 }
  if (!Array.isArray(wd.gpuUniforms) || wd.gpuUniforms.length < 256) { const u = new Array(256).fill(0); wd.gpuUniforms = u }
  wd.__vf.pop = []
  wd.__vf.t = (wd.__vf.t || 0) + Math.min(dt, 1 / 30)
  movement(sim, dt)
  enemies(sim, dt)
  projectiles(sim, dt)
  combat(sim, dt)
  deathfx(sim, dt)
  audio(sim, dt)
  wd.gpuPopulation = wd.__vf.pop
} catch (e) {}
`

const INSTRUCTIONS = 'VEILFIRE 3D — an Antichamber-style Gothic horror shooter. WASD to walk the nave, mouse/A-D to turn, click to fire. Demons hunt you in the dark; light your bolts, drop them in ember. Raymarched, one megashader, built by a dynamic swarm.'

async function main() {
  const TOKEN = process.env.VF_TOKEN
  if (!TOKEN) { console.error('VF_TOKEN (uc_st_ world key) required'); process.exit(1) }
  const URL = process.env.VF_URL || 'https://cartridge.cafe/api/engine/bridge'
  const send = async (cmd, label) => {
    const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(Array.isArray(cmd) ? { commands: cmd } : cmd) })
    const t = await r.text()
    console.log(label || (Array.isArray(cmd) ? 'batch' : cmd.type), r.status, t.slice(0, 140))
    if (!r.ok) throw new Error(`${label}: ${r.status} ${t.slice(0, 300)}`)
    return JSON.parse(t)
  }
  await send([
    { type: 'set_world_data', data: { built_by: 'Claude Opus 4.8 (swarm)', singlePlayer: true, instructions: INSTRUCTIONS } },
    { type: 'set_world_params', params: { gravity: 0, friction: 1, collisionForce: 0, boundaryMode: 'open', gravitationalConstant: 0 } },
    ...MODULES.map(m => ({ type: 'define_module', name: m.name, wgsl: m.wgsl })),
    { type: 'define_visual', name: VISUAL.name, wgsl: VISUAL.wgsl },
  ], 'modules+visual')
  const st = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  if (!(st.fields || []).some(f => f.name === 'Scene')) {
    await send({ type: 'create_field', name: 'Scene', shape: 'rect', x: 256, y: 256, width: 512, height: 512, visualType: 's3', color: [0.02, 0.02, 0.04, 1], noHit: true }, 'field')
  }
  await send({ type: 'add_step_hook', hookId: 'veilfire', author: 'Claude Opus 4.8', description: 'VEILFIRE 3D: movement+enemies+projectiles+combat+deathfx+audio', code: HOOK }, 'hook')
  await send({ type: 'set_world_data', data: { postProcess: { bloomIntensity: 0.55, bloomThreshold: 0.55, exposure: 1.02, vignetteStrength: 0.42, vignetteRadius: 0.8 } } }, 'post')
  const v = await fetch(URL, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json())
  console.log('VERIFY fields:', (v.fields || []).map(f => f.name), '| hooks:', (v.stepHooks || []).map(h => h.id), '| modules:', (v.modules || []).length, '| visuals:', (v.visualTypes || []).map(x => x.name))
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1) })
