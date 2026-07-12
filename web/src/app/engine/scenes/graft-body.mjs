// Graft the Cradle Body into the garden-and-window scene, then load it live.
import { readFileSync } from 'fs'
const BASE = 'http://localhost:3000'
const SCRATCH = '/private/tmp/claude-501/-Users-galengoodwick/8538c5a8-2f10-4792-bb68-07a15805c631/scratchpad'
const wgsl = readFileSync(`${SCRATCH}/cradle-body.wgsl`, 'utf8')

const WANDER = `
try {
  const wd = sim.worldData
  wd.__cbT = (wd.__cbT || 0) + dt
  const t0 = wd.__cbT
  let body = null
  for (const f of sim.fields.values()) if ((f.name || '').startsWith('Cradle Body')) { body = f; break }
  if (body) {
    const t = body.transform
    // Slow, dreamlike wander
    t.vx += Math.sin(t0 * 0.21 + 1.3) * 3.2 * dt
    t.vy += Math.cos(t0 * 0.17) * 3.2 * dt
    // Shy: soft repulsion from garden fields (also keeps clear of destroy rules)
    for (const o of sim.fields.values()) {
      if (o === body || !o.name) continue
      if (o.name.startsWith('Cradle')) continue
      const dx = t.x - o.transform.x, dy = t.y - o.transform.y
      const d = Math.hypot(dx, dy) || 1
      if (d < 75) { t.vx += dx / d * 34 * dt; t.vy += dy / d * 34 * dt }
    }
    // Stay in the garden, below the window
    if (t.x < 70) t.vx += 22 * dt
    if (t.x > 442) t.vx -= 22 * dt
    if (t.y < 180) t.vy += 22 * dt
    if (t.y > 442) t.vy -= 22 * dt
    const v = Math.hypot(t.vx, t.vy)
    if (v > 13) { t.vx *= 13 / v; t.vy *= 13 / v }
  }
} catch (e) { /* keep the sim alive */ }
`

// 1. Pull the saved scene
const res = await fetch(`${BASE}/api/engine/scene?name=${encodeURIComponent('window')}`)
const { scene } = await res.json()
if (!scene) { console.error('scene not found'); process.exit(1) }

// 2. Graft: visual type, body field, wander hook (idempotent)
scene.visualTypes = (scene.visualTypes || []).filter(v => v.name !== 'cradle_body')
scene.visualTypes.push({ name: 'cradle_body', wgsl })
if (!scene.visualTypes.some(v => v.name === 'cradle_window')) {
  const winWgsl = readFileSync('/Users/galengoodwick/Documents/GitHub/unionchant/web/src/app/engine/scenes/cradle-window.wgsl', 'utf8')
  scene.visualTypes.push({ name: 'cradle_window', wgsl: winWgsl })
}
scene.worldData = { ...(scene.worldData || {}), cradleBridge: true }
scene.name = 'garden-and-window'

scene.fields = (scene.fields || []).filter(f => !(f.name || '').startsWith('Cradle Body'))
scene.fields.push({
  id: 'cradle_body_f', name: 'Cradle Body', color: [0.15, 0.7, 0.55, 1],
  effects: [], memory: [], proximity: [], properties: { superimpose: true },
  transform: { x: 256, y: 330, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  shapeType: 'circle', radius: 44,
  visualTypeName: 'cradle_body',
  visualParams: [0.85, 0.6, 0, 0],
})

scene.stepHooks = (scene.stepHooks || []).filter(h => h.id !== 'cradle_body_wander' && h.id !== 'lumen_core')
scene.stepHooks.push({ id: 'cradle_body_wander', author: 'fable', description: 'The Cradle Body drifts through the garden, shy of the colony', code: WANDER })
// Peaceful garden: no annihilation rules in this scene (wild ecology lives in 'abc')
scene.interactionRules = []
scene.timestamp = Date.now()

// 3. Save back
const save = await fetch(`${BASE}/api/engine/scene`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ action: 'save', name: 'garden-and-window', scene }),
})
console.log('scene grafted:', save.status, await save.text(), '| fields:', scene.fields.length, '| hooks:', scene.stepHooks.map(h => h.id))
