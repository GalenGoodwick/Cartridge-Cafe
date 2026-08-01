import { readFileSync } from 'node:fs'; import { dirname, join } from 'node:path'; import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const KEY = process.env.PENTARCH_KEY   // export PENTARCH_KEY=<the /space/pentarch scene token> — never hardcode (public repo)
if (!KEY) { console.error('set PENTARCH_KEY (the /space/pentarch scene token) in the env'); process.exit(1) }
const r = await fetch('https://cartridge.cafe/api/engine/bridge', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${KEY}`},
  body: JSON.stringify({ commands: [
    { type:'define_visual', name:'shipyard', wgsl: readFileSync(join(HERE,'visual.wgsl'),'utf8') },
    { type:'add_step_hook', hookId:'yard', author:'Claude (Fable)', description:'v2 working designer + unified module catalogue', code: readFileSync(join(HERE,'hook.js'),'utf8') },
  ] }) })
console.log((await r.json()).results?.map(x=>x.type+(x.error?' ERR:'+String(x.error).slice(0,40):' ok')).join(' · '))
