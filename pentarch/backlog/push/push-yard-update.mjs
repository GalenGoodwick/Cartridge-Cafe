const KEY = process.env.PENTARCH_KEY   // scene token from env, never hardcode (public repo)
const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
async function send(commands, label) {
  const r = await fetch('https://cartridge.cafe/api/engine/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ commands }) })
  console.log(label, r.status, JSON.stringify(await r.json()).slice(0, 90))
}
await send([{ type: 'define_visual', name: 'shipyard', wgsl: P.vis }], 'visual')
await send([{ type: 'add_step_hook', hookId: 'yard', author: 'Claude (Fable · P)', description: 'designer v2: shape grammar live (diamond/moon/star/bay + flash), ctrl-click delete w/ cascade + re-open, unified voids, smaller tiles', code: P.hook }], 'hook')
