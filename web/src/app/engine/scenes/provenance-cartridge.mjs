// provenance-cartridge.mjs — the node-to-pixel provenance demo, in the REAL engine.
// Four fields, each a distinct "node" (a shape + a visual + provenance metadata).
// Hover any shape → the engine resolves it via the GPU per-pixel OWNER BUFFER
// (FieldEngine writes wd.__pick from sim.getFieldAtPoint, the real hit map) → the
// hook reads wd.__pick and shows the SOURCE in the HUD. Click-to-source, live.
//
// This is the FieldEngine splice (task #14) proven in a real cartridge: pixel →
// owner buffer → field/node → its visual + code, no hit-disc guessing.

const VISUAL = `
fn visual_prov_shape(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let d = length(uv);
  if (d > 0.92) { return vec4f(0.0); }
  let pulse = 0.85 + 0.15 * sin(time * 2.0 + params.x * 6.28);
  let rim = smoothstep(0.92, 0.7, d);
  return vec4f(color.rgb * (0.5 + 0.5 * rim) * pulse, 1.0);
}`;

// each field carries WHO it is + WHAT drew it. Keyed by field NAME — the bridge
// reassigns fieldId on create, but the name is stable, and __pick carries it.
const SOURCES = {
  'THE ORB':   { title: 'THE ORB', role: 'boss entity', code: 'visual_prov_shape · params.x=0.0', by: 'seed' },
  'A PILLAR':  { title: 'A PILLAR', role: 'world geometry', code: 'visual_prov_shape · params.x=0.33', by: 'seed', cand: 'geo.hallway would carve a walk-through' },
  'THE KEY':   { title: 'THE KEY', role: 'pickup', code: 'visual_prov_shape · params.x=0.66', by: 'opus-a' },
  'HUD PANEL': { title: 'HUD PANEL', role: '2D UI · drawn on top', code: 'visual_prov_shape · params.x=1.0', by: 'opus-a' },
};

const HOOK = `
const wd = sim.worldData;
wd.__provSrc = ${JSON.stringify(SOURCES)};
const pick = wd.__pick;                       // set by the engine from the GPU owner buffer
const src = (pick && pick.name && wd.__provSrc[pick.name]) || null;
const lines = [];
lines.push({ id: 'title', type: 'text', x: '3%', y: '6%', text: 'NODE-TO-PIXEL PROVENANCE — hover any shape', fontSize: '15px', color: '#ffd479' });
lines.push({ id: 'sub', type: 'text', x: '3%', y: '10%', text: 'the engine resolves each pixel to its source via the GPU owner buffer (real, not a guess)', fontSize: '11px', color: '#9d9080' });
if (src) {
  lines.push({ id: 'p_e', type: 'text', x: '3%', y: '84%', text: 'PIXEL → SOURCE', fontSize: '10px', color: '#7b8daa' });
  lines.push({ id: 'p_t', type: 'text', x: '3%', y: '88%', text: src.title + '  ·  ' + src.role, fontSize: '15px', color: '#54d2dd' });
  lines.push({ id: 'p_c', type: 'text', x: '3%', y: '92%', text: 'drawn by: ' + src.code + '   (node @' + src.by + ')', fontSize: '11px', color: '#ece5d8' });
  if (src.cand) lines.push({ id: 'p_x', type: 'text', x: '3%', y: '96%', text: '◇ candidate: ' + src.cand, fontSize: '11px', color: '#e35aa0' });
} else {
  lines.push({ id: 'p_t', type: 'text', x: '3%', y: '90%', text: pick ? ('field ' + pick.fieldId + ' (no source record)') : 'background — hover a shape', fontSize: '13px', color: '#6c6154' });
}
wd.hud = lines;
`;

const field = (id, name, x, y, r, col, px) => ({
  id, name, color: col,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  shapeType: 'circle', radius: r,
  visualTypeName: 'prov_shape', visualParams: [px, 0, 0, 0],
});

export const PROVENANCE = {
  name: 'PROVENANCE',
  visuals: [{ name: 'prov_shape', wgsl: VISUAL }],
  fields: [
    field('prov_a', 'THE ORB',   180, 220, 70, [0.36, 0.27, 0.18, 1], 0.0),
    field('prov_b', 'A PILLAR',  330, 200, 55, [0.59, 0.31, 0.15, 1], 0.33),
    field('prov_c', 'THE KEY',   270, 330, 40, [0.9,  0.75, 0.3,  1], 0.66),
    field('prov_d', 'HUD PANEL', 130, 340, 45, [0.13, 0.35, 0.55, 1], 1.0),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: { singlePlayer: true, instructions: 'Hover any shape. The engine resolves the pixel under your cursor to its SOURCE (which field/node/visual drew it) via the GPU per-pixel owner buffer — pixel → node → code. This is the node-to-pixel provenance pipeline in the real engine.' },
  stepHooks: [{ id: 'prov_inspect', author: 'opus-a', description: 'read wd.__pick (GPU owner buffer) → show pixel source in the HUD', code: HOOK }],
};
export default PROVENANCE;
