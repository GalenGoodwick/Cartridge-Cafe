// PLAYTHROUGH BINDINGS (Galen, Sep 16: "bind input to struct change over
// ticks") — input-response is not one lucky delta: the world DECLARES its
// control contract as bindings, and EACH one is verified as its own driven
// segment against the struct trace:
//   worldData.probe.bindings = [
//     { name:'walk fwd', keys:['w'], key:'__np.z', dir:'+', min:2, ticks:90 }, ...
//   ]
//   node tools/playthrough-bindings.mjs <uc_st_token | snapshot.json>
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
const here = dirname(fileURLToPath(import.meta.url))
const eye = await import(join(here, '../mcp/local-eye.mjs'))
const { shapeSnapshot } = await import(join(here, '../mcp/probe-format.mjs'))

const TOKEN = process.argv[2]
if (!TOKEN) { console.error('usage: node tools/playthrough-bindings.mjs <token|snapshot.json>'); process.exit(2) }
let raw
if (TOKEN.endsWith('.json')) raw = JSON.parse(readFileSync(TOKEN, 'utf8'))
else {
  const { makeClient } = await import(join(here, '../mcp/bridge-client.mjs'))
  const c = makeClient({ base: process.env.CAFE_BASE || 'https://cartridge.cafe', token: TOKEN, timeoutMs: 120000 })
  raw = JSON.parse((await c.bridgeGet()).text)
}
const snap = shapeSnapshot(raw)
const bindings = snap.worldData?.probe?.bindings
if (!Array.isArray(bindings) || !bindings.length) {
  console.error('RED: worldData.probe.bindings missing — the world has not declared its control contract')
  process.exit(1)
}
let fails = 0
console.log('═ INPUT → STRUCT BINDINGS ═')
for (const b of bindings) {
  const ticks = b.ticks ?? 90
  const r = await eye.renderLocal(snap, {
    input: [{ from: 1, to: ticks - 10, keys: b.keys ?? [], ...(b.pointer ? { pointer: b.pointer } : {}) }],
    ticks, trace: true, size: 96, inputStart: 1,
  })
  const tr = r?.stateTrace ?? []
  const vals = tr.map(s => s?.[b.key]).filter(v => typeof v === 'number')
  const delta = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0
  const min = b.min ?? 1
  const ok = (r?.errors ?? []).length === 0 && (r?.hookErrors ?? []).length === 0 &&
    (b.dir === '+' ? delta >= min : b.dir === '-' ? delta <= -min : Math.abs(delta) >= min)
  if (!ok) fails++
  console.log(`  ${ok ? '✅' : '❌'} ${String(b.name ?? b.keys).padEnd(16)} ${b.key} Δ${delta.toFixed(2)} over ${ticks} ticks (want ${b.dir}${min})`)
}
console.log(fails ? `\nRED — ${fails} binding(s) broken` : '\nALL BINDINGS HOLD')
process.exit(fails ? 1 : 0)
