// node-runtime · veilfire pilot — register the nine live hooks as ordered nodes.
//
// This proves rung 1 on the world that started it all: after registering these
// orders, re-pushing ANY hook can no longer reorder execution (AT-1). It reproduces
// the exact proven-good order via DECLARED order, so no push sequence can break it.
//
// DEPLOY-GATED: the live bridge/engine/render-service must carry the node-order
// splice first (branch `node-runtime`). Until shipped, `register_node` and the
// orderHooks sort don't exist on prod, so this is a no-op there. Run only after
// Galen ships. Usage:
//   PENTARCH_KEY=uc_st_... node node-runtime/pilot/veilfire-register.mjs
// (any uc_st_ world key scoped to veilfire-3d, or a uc_pt_ player key + use_world)

const KEY = process.env.PENTARCH_KEY || process.env.VF_KEY;
const URL = process.env.BRIDGE || 'https://cartridge.cafe/api/engine/bridge';
if (!KEY) { console.error('set PENTARCH_KEY (a veilfire-3d world/scene key)'); process.exit(1); }

// The proven-good veilfire order, made declarative. base < weapons is the invariant
// the clobber violated; vf-weapons stays the final word on V.weapon.
const NODES = [
  { id: 'vf-heal',        order: 10,  owns: { uni: [] } },
  { id: 'vf-entities',    order: 20,  owns: { uni: [] } },
  { id: 'vf-blackhole',   order: 25,  owns: { uni: [[60, 61]] } },
  { id: 'vf-dragonflash', order: 27,  owns: { uni: [] } },
  { id: 'vf-timecells',   order: 28,  owns: { uni: [] } },
  { id: 'veilfire',       order: 30,  owns: { uni: [[0, 8], [15, 17], [240, 247]] } }, // base sim + camera
  { id: 'vf-crystalflow', order: 110, owns: { uni: [[100, 106]] } },                   // remapped crystal beam
  { id: 'vf-weapon3',     order: 115, owns: { uni: [] } },
  { id: 'vf-weapons',     order: 120, owns: { uni: [[69, 79]] } },                      // final word — runs last
];

async function send(commands) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ commands }),
  });
  return r.json();
}

(async () => {
  // one batched write (space-store's blood-lesson: one RMW per change)
  const res = await send(NODES.map(n => ({ type: 'register_node', id: n.id, node: n })));
  const rows = (res.results || []).map(r => `${r.node?.id || '?'}: ${r.ok ? 'ok' : 'REJECT ' + (r.error || '')}`);
  console.log('register_node ×' + NODES.length + ':\n  ' + rows.join('\n  '));

  // read back + prove order via a describe (structural) — every registered hook
  // should carry its declared order in worldData.__nodes.
  const exp = await (await fetch(URL + '?action=export', { headers: { Authorization: 'Bearer ' + KEY } })).json();
  const nodes = (exp.worldData || {}).__nodes || {};
  const ordered = Object.values(nodes).sort((a, b) => a.order - b.order).map(n => `${n.order} ${n.id}`);
  console.log('\ndeclared run order now:\n  ' + ordered.join('\n  '));
  console.log('\nAT-1: re-push any hook (e.g. base) — order above is unchanged. Probe to confirm weapons still render.');
})();
