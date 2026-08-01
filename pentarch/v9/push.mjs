// push the editable v9 base to /space/pentarch. `node v9/push.mjs`
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const KEY = process.env.PENTARCH_KEY   // export the /space/pentarch scene token — never hardcode (public repo)
const B = 'https://cartridge.cafe/api/engine/bridge'
const vis = readFileSync(join(HERE, 'visual.wgsl'), 'utf8')
const hook = readFileSync(join(HERE, 'hook.js'), 'utf8')
const r = await fetch(B, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ commands: [
    { type: 'define_visual', name: 'shipyard', wgsl: vis },
    { type: 'add_step_hook', hookId: 'yard', author: 'Claude (Fable)', description: 'v9 designer (editable base)', code: hook },
  ] }) })
console.log((await r.json()).results?.map(x => x.type + (x.error ? ' ERR' : ' ok')).join(' · '))
