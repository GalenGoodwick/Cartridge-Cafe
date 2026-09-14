# PIXELS ≡ HITBOX rewire (Galen, Sep 14: "platform hitboxes are not the same as
# the colored pixels. field engine would draw these and calculate collision").
# Produces: rewired-snap.json (local proof target) + live-cmds.json (the exact
# bridge batch to fire at the live base AFTER the sandbox-geometry deploy).
import json, copy, os

HERE = os.path.dirname(os.path.abspath(__file__))
snap = json.load(open(os.path.join(HERE, 'p5-fork3-snap.json')))

# ── the standable geometry, as FIELDS (one source of truth) ──────────────────
# ground line at 940, pit gap 60..150; platform tops match the old table so the
# level plays identically — the truth just moved into the engine.
STANDS = [
    {"id": "ground-l", "w": 60,  "h": 84, "x": 30,  "y": 982},
    {"id": "ground-r", "w": 426, "h": 84, "x": 363, "y": 982},
    {"id": "plat-1",   "w": 170, "h": 22, "x": 150, "y": 811},
    {"id": "plat-2",   "w": 150, "h": 22, "x": 430, "y": 701},
    {"id": "plat-3",   "w": 140, "h": 22, "x": 200, "y": 571},
    {"id": "plat-4",   "w": 150, "h": 22, "x": 440, "y": 441},
    {"id": "plat-5",   "w": 130, "h": 22, "x": 170, "y": 321},
]

ATMO = r"""
// BASE ATMOSPHERE — sky/hills/sun + the dark underworld below the ground line.
// GEOMETRY IS NOT PAINTED HERE: ground and platforms are FIELDS the engine
// draws, so the pixels you stand on ARE the hitboxes (pixels=hitbox law,
// Sep 14). No private camera offsets either — viewbox() speaks for the ONE
// engine camera (worldData.__camera), so paint can never drift from physics.
fn visual_base_atmo(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let vb = viewbox();
  let wp = vb.xy + uv * vb.zw;                    // grid space, y down
  let sky = wp.y / 1024.0;
  var col = mix(vec3f(0.45, 0.68, 0.95), vec3f(0.85, 0.90, 0.98), sky);   // day sky
  // far hills (parallax)
  let h1 = 700.0 + 60.0 * sin(wp.x * 0.008 + 1.0);
  if (wp.y > h1) { col = mix(col, vec3f(0.55, 0.75, 0.62), 0.8); }
  let h2 = 800.0 + 40.0 * sin(wp.x * 0.013 + 4.0);
  if (wp.y > h2) { col = mix(col, vec3f(0.42, 0.65, 0.48), 0.9); }
  // sun + soft cloud band
  let sun = length(wp - vec2f(470.0, 130.0));
  col += vec3f(1.0, 0.9, 0.6) * exp(-sun * sun * 0.0004) * 0.6;
  col += vec3f(1.0) * 0.10 * smoothstep(30.0, 0.0, abs(wp.y - 240.0 - 30.0 * sin(wp.x * 0.01 + time * 0.1)));
  // below the ground line lives the dark: any gap in the ground fields (THE
  // PIT) shows this — absence of ground IS the chasm, no lanes needed.
  if (wp.y > 940.0) {
    col = mix(vec3f(0.10, 0.07, 0.12), vec3f(0.02, 0.01, 0.03), (wp.y - 940.0) / 84.0);
  }
  col = max(col, vec3f(0.06));                              // never-dark floor
  return vec4f(col, 1.0);
}
"""

PLAT = r"""
// BASE PLATFORM — drawn INSIDE its own field rect: the engine's field IS the
// hitbox, so these pixels can never lie about where you can stand. uv is
// field-local (-1..1, y down). Carve or move the FIELD to reshape the level.
fn visual_base_plat(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let v = uv.y * 0.5 + 0.5;                                 // 0 top .. 1 bottom
  var col = mix(vec3f(0.55, 0.42, 0.30), vec3f(0.40, 0.30, 0.22), v);
  if (v < 0.23) { col = vec3f(0.50, 0.70, 0.35); }          // grassy lip = the standable face
  return vec4f(col, 1.0);
}
"""

GROUND = r"""
// BASE GROUND — same law as platforms: the field rect is the truth. params.x =
// this field's width in grid px (cosmetic tick spacing only — geometry lives
// on the field itself, never duplicated here).
fn visual_base_ground(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let v = uv.y * 0.5 + 0.5;
  var col = mix(vec3f(0.35, 0.55, 0.30), vec3f(0.25, 0.4, 0.22), v);
  let px = (uv.x * 0.5 + 0.5) * max(params.x, 1.0);
  col += vec3f(0.08) * step(0.5, fract(px * 0.02));         // turf ticks
  return vec4f(col, 1.0);
}
"""

ACTORS = r"""
// BASE ACTORS — the avatar + population + fx overlay, drawn from the
// whiteboard alone (u0-3 player, u5 flash, u7 state, pop() entities). No
// private camera/shake offsets: viewbox() is the one engine camera, so the
// avatar is always painted exactly where physics says it stands.
fn visual_base_actors(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let vb = viewbox();
  let wp = vb.xy + uv * vb.zw;
  var col = vec4f(0.0);
  // ── entities from the population buffer: kind 0 = coin, 1 = critter ──
  for (var i = 0; i < 32; i++) {
    if (i >= popCount()) { break; }
    let e = pop(i);
    let d = wp - e.xy;
    if (dot(d, d) > 2500.0) { continue; }
    if (e.z < 0.5) {                                   // COIN: spinning disc
      let spin = abs(cos(time * 4.0 + e.w));
      let cd = length(vec2f(d.x / max(spin, 0.15), d.y));
      if (cd < 13.0) {
        let rim = smoothstep(13.0, 9.0, cd);
        col = vec4f(mix(vec3f(0.85, 0.65, 0.1), vec3f(1.0, 0.9, 0.4), rim), 1.0);
      }
    } else {                                            // CRITTER: bristly blob
      let wob = 1.0 + 0.15 * sin(time * 9.0 + e.w);
      if (length(vec2f(d.x, d.y * wob)) < 16.0) {
        col = vec4f(0.55, 0.25, 0.55, 1.0);
        if (d.y < -8.0) { col = vec4f(0.9, 0.9, 0.95, 1.0); }   // eye band
      }
    }
  }
  // ── THE AVATAR: a roundling with a face, u0/u1 pos, u2 facing, u3 hop ──
  let pp = vec2f(uni(0), uni(1));
  let pd = wp - pp;
  let squash = 1.0 + uni(3) * 0.25;
  let body = length(vec2f(pd.x / 1.15, (pd.y + 14.0) * squash)) - 16.0;
  if (body < 0.0) {
    var c = mix(vec3f(0.95, 0.55, 0.25), vec3f(1.0, 0.75, 0.45), clamp(-pd.y * 0.03, 0.0, 1.0));
    let eye = vec2f(pd.x - uni(2) * 6.0, pd.y + 18.0);
    if (length(eye - vec2f(4.0, 0.0)) < 2.6 || length(eye + vec2f(4.0, 0.0)) < 2.6) { c = vec3f(0.1); }
    col = vec4f(c, 1.0);
  }
  // fx: hit flash overlay (u5), win/lose tint (u7: 1 won gold, 2 over dusk)
  if (uni(5) > 0.01) { col = vec4f(mix(col.rgb, vec3f(1.0, 0.3, 0.2), uni(5) * 0.6), max(col.a, uni(5) * 0.35)); }
  if (uni(7) > 1.5) { col = vec4f(mix(col.rgb, vec3f(0.2, 0.1, 0.3), 0.4), max(col.a, 0.25)); }
  else if (uni(7) > 0.5) { col = vec4f(mix(col.rgb, vec3f(1.0, 0.85, 0.3), 0.3), max(col.a, 0.18)); }
  return col;
}
"""

WORLD = r"""
// PHYSICS (load-bearing, the 'world' slot) — gravity + integration + landing
// on STANDABLE FIELDS. The engine's fields are the ONE geometry: what it
// draws is exactly what you stand on (pixels ≡ hitbox, Galen's law Sep 14).
// No shadow tables — reshape the level by moving/resizing/carving fields.
const wd = sim.worldData;
if (!wd.__phys) wd.__phys = { g: 1500 };
const P = wd.__p; if (!P) return;
const dt2 = Math.min(dt, 1/30);
const I = P.intent || { ax: 0, jump: false };
P.vx += (I.ax * 900 - P.vx * 6) * dt2;
P.vy += wd.__phys.g * dt2;
if (I.jump && P.ground) { P.vy = -640; P.ground = false; (wd.__ev = wd.__ev || []).push({ t: 'jump' }); }
P.x += P.vx * dt2; P.y += P.vy * dt2;
if (P.x < 20) { P.x = 20; P.vx = 0; } if (P.x > 556) { P.x = 556; P.vx = 0; }
P.ground = false;
// land on any standable rect FIELD: top face only, feet within the drawn span
for (const f of sim.fields.values()) {
  if (!(f.properties && f.properties.standable) || f.shapeType !== 'rect') continue;
  const sc = (f.transform && f.transform.scale) || 1;
  const w = (f.w || 0) * sc, top = (f.transform.y || 0) - ((f.h || 0) * sc) * 0.5;
  if (P.vy >= 0 && Math.abs(P.x - f.transform.x) < w * 0.5 + 8 && P.y >= top - 2 && P.y <= top + Math.max(14, P.vy * dt2 + 6)) {
    P.y = top; P.vy = 0; P.ground = true;
  }
}
P.hop = P.ground ? Math.max(0, (P.hop || 0) - dt2 * 6) : Math.min(1, (P.hop || 0) + dt2 * 4);
if (P.y > 1100) { (wd.__ev = wd.__ev || []).push({ t: 'fell' }); P.x = 288; P.y = 900; P.vx = 0; P.vy = 0; }
"""

CAMERA = r"""
// CAMERA (removable) — a gentle vertical look-ahead through the ENGINE'S OWN
// camera (worldData.__camera): one coordinate owner, so the view and the
// hitboxes can never disagree. The engine smooths and clamps whatever we ask.
const wd = sim.worldData;
const P = wd.__p; if (!P) { delete wd.__camera; return; }
wd.__camera = { x: 288, y: Math.max(312, Math.min(512, P.y - 220)) };
"""

FX = r"""
// FX (removable) — juice from events: the hit/goal FLASH. Positional shake was
// carved ON PURPOSE: a paint offset is a lie about where things are (pixels ≡
// hitbox). If your vision wants shake, nudge worldData.__camera instead.
const wd = sim.worldData;
if (!wd.__fx) wd.__fx = { flash: 0 };
const F = wd.__fx;
const dt2 = Math.min(dt, 1/30);
F.flash = Math.max(0, F.flash - dt2 * 2.5);
for (const ev of (wd.__ev || [])) {
  if (ev.t === 'hit' || ev.t === 'fell') F.flash = 1;
  if (ev.t === 'coin') F.flash = Math.max(F.flash, 0.25);
}
"""

UPLINK = r"""
// UPLINK (load-bearing) — the ONE writer of the whiteboard + population.
// Slimmer now: geometry (ground/platforms/pit) is FIELDS the engine draws —
// no geometry lanes. Lanes: u0-3 player, u5 flash, u7 rules state. Runs LAST.
const wd = sim.worldData;
const U = new Array(64).fill(0);
const P = wd.__p || { x: 288, y: 900, face: 1, hop: 0 };
U[0] = P.x; U[1] = P.y; U[2] = P.face || 1; U[3] = P.hop || 0;
U[5] = wd.__fx ? wd.__fx.flash : 0;
U[7] = wd.__rules ? wd.__rules.state : 0;
wd.gpuUniforms = U;
const POP = [];
if (wd.__ents) {
  for (const c of wd.__ents.coins) if (!(c.up > 0)) POP.push(c.x, c.y, 0, (c.x + c.y) * 0.01);
  const K = wd.__ents.critter; if (K) POP.push(K.x, K.y - 14, 1, K.x * 0.05);
}
wd.gpuPopulation = POP;
wd.__ev = [];   // the event list is per-tick; uplink (last) clears it
"""

# ── manifest: fields join the map; geometry visuals are load-bearing ─────────
def manifest(backdrop_id):
    stand_hint = "carve/move/resize freely — the field IS the hitbox; a gap in the ground is a pit"
    return {"v": 1, "cell": "2d-mobile", "entries": [
        {"kind": "hook", "id": "player", "role": "input+intent (keys + touch)", "removable": "load-bearing", "carveHint": "the player's will — replace its input mapping, never remove it"},
        {"kind": "hook", "id": "world", "role": "physics: gravity, integration, landing on standable FIELDS", "removable": "load-bearing", "carveHint": "geometry lives on the fields (properties.standable) — reshape the level there, not here"},
        {"kind": "hook", "id": "uplink", "role": "packs the whiteboard + population; clears events", "removable": "load-bearing", "carveHint": "every visual reads its lanes; extend it when you add state"},
        {"kind": "hook", "id": "camera", "role": "vertical look-ahead via worldData.__camera (the engine camera)", "removable": True, "carveHint": "carve for a fixed frame"},
        {"kind": "hook", "id": "entities", "role": "coins + one critter; emits coin/stomp/hit events", "removable": True, "carveHint": "carve for a pure movement toy, or replace with your creatures"},
        {"kind": "hook", "id": "rules", "role": "score, lives, win/lose, restart", "removable": True, "deps": [], "carveHint": "carve for a goal-less world"},
        {"kind": "hook", "id": "hud", "role": "solver-banded hearts/score/end-screens", "removable": True, "carveHint": "carve for a clean screen"},
        {"kind": "hook", "id": "fx", "role": "hit/goal flash from events (no positional shake — pixels ≡ hitbox)", "removable": True, "carveHint": "carve if juice fights your mood"},
        {"kind": "hook", "id": "audio", "role": "events → sound ids", "removable": True, "carveHint": "define_track real sounds, or carve"},
        {"kind": "hook", "id": "save", "role": "best score persistence", "removable": True, "carveHint": "carve if nothing should persist"},
        {"kind": "field", "id": backdrop_id, "role": "the frame: atmosphere visual (screen space)", "removable": "load-bearing"},
        {"kind": "field", "id": "actors", "role": "avatar + entities + fx layer", "removable": "load-bearing"},
        {"kind": "field", "id": "ground-l", "role": "standable ground, left of THE PIT", "removable": True, "carveHint": stand_hint},
        {"kind": "field", "id": "ground-r", "role": "standable ground, right of THE PIT — the SPAWN FLOOR", "removable": "load-bearing", "carveHint": "the player spawns over this at x=288: carving it is an endless fall (harness-proven). Move/shrink it freely — the field IS the hitbox — or carve with force after placing another standable under the spawn"},
        {"kind": "field", "id": "plat-1", "role": "platform (lowest)", "removable": True, "carveHint": stand_hint},
        {"kind": "field", "id": "plat-2", "role": "platform", "removable": True, "carveHint": stand_hint},
        {"kind": "field", "id": "plat-3", "role": "platform", "removable": True, "carveHint": stand_hint},
        {"kind": "field", "id": "plat-4", "role": "platform", "removable": True, "carveHint": stand_hint},
        {"kind": "field", "id": "plat-5", "role": "platform (highest)", "removable": True, "carveHint": stand_hint},
        {"kind": "visual", "id": "base_atmo", "role": "sky/hills/underworld painter (geometry-free)", "removable": "load-bearing", "carveHint": "REPLACE for your look — it paints atmosphere only, never collision"},
        {"kind": "visual", "id": "base_actors", "role": "avatar/population/fx painter", "removable": "load-bearing", "carveHint": "REPLACE the shapes; keep the lane reads"},
        {"kind": "visual", "id": "base_plat", "role": "platform face", "removable": "load-bearing", "carveHint": "carving it leaves INVISIBLE collision — replace its look instead, or carve the plat-N fields"},
        {"kind": "visual", "id": "base_ground", "role": "ground face", "removable": "load-bearing", "carveHint": "carving it leaves INVISIBLE collision — replace its look instead, or carve the ground fields"},
        {"kind": "visual", "id": "base_bg", "role": "birth-legacy backdrop shader (unused by any field)", "removable": True, "carveHint": "the born default — carve freely"},
    ], "probe": {"drive": [{"from": 0, "to": 80, "keys": ["d"]}, {"from": 90, "to": 110, "keys": ["w"]}, {"from": 120, "to": 200, "keys": ["a"]}], "moveKey": "__p.x", "minDelta": 40}}

# ── build the rewired snapshot (local proof target) ──────────────────────────
out = copy.deepcopy(snap)
backdrop = next(f for f in out['fields'] if f.get('name') == 'backdrop')
backdrop_id = backdrop['id']
backdrop['shapeType'] = 'screen'          # screen-space frame: viewbox() owns the mapping
backdrop.pop('w', None); backdrop.pop('h', None)
backdrop['renderOrder'] = 0
actors = next(f for f in out['fields'] if f.get('id') == 'actors')
actors['renderOrder'] = 20
stand_fields = []
for s in STANDS:
    vis = 'base_ground' if s['id'].startswith('ground') else 'base_plat'
    stand_fields.append({
        'id': s['id'], 'name': s['id'], 'shapeType': 'rect', 'w': s['w'], 'h': s['h'],
        'visualTypeName': vis, 'visualParams': [s['w'], 0, 0, 0], 'renderOrder': 10,
        'transform': {'x': s['x'], 'y': s['y'], 'vr': 0, 'vx': 0, 'vy': 0, 'scale': 1, 'rotation': 0},
        'properties': {'standable': True}, 'noHit': True, 'noCollide': True,
    })
# order: backdrop, stands, actors — renderOrder makes it explicit either way
out['fields'] = [backdrop] + stand_fields + [actors]
vts = {v['name']: v for v in out['visualTypes']}
vts['base_atmo']['wgsl'] = ATMO
vts['base_actors']['wgsl'] = ACTORS
out['visualTypes'] = list(vts.values()) + [
    {'name': 'base_plat', 'wgsl': PLAT},
    {'name': 'base_ground', 'wgsl': GROUND},
]
hooks = {str(h.get('hookId') or h.get('id')): h for h in out['stepHooks']}
for hid, code in (('world', WORLD), ('camera', CAMERA), ('fx', FX), ('uplink', UPLINK)):
    hooks[hid]['code'] = code
out['worldData']['baseManifest'] = manifest(backdrop_id)

json.dump(out, open(os.path.join(HERE, 'rewired-snap.json'), 'w'))

# ── the LIVE batch (fire after the sandbox-geometry deploy) ──────────────────
cmds = [
    {'type': 'define_visual', 'name': 'base_atmo', 'wgsl': ATMO},
    {'type': 'define_visual', 'name': 'base_actors', 'wgsl': ACTORS},
    {'type': 'define_visual', 'name': 'base_plat', 'wgsl': PLAT},
    {'type': 'define_visual', 'name': 'base_ground', 'wgsl': GROUND},
]
for s in STANDS:
    vis = 'base_ground' if s['id'].startswith('ground') else 'base_plat'
    cmds.append({'type': 'create_field', 'fieldId': s['id'], 'name': s['id'], 'shapeType': 'rect',
                 'w': s['w'], 'h': s['h'], 'x': s['x'], 'y': s['y'],
                 'noHit': True, 'noCollide': True, 'properties': {'standable': True}})
    cmds.append({'type': 'set_visual', 'fieldId': s['id'], 'visualType': vis,
                 'visualParams': [s['w'], 0, 0, 0], 'renderOrder': 10})
cmds.append({'type': 'set_visual', 'fieldId': 'actors', 'visualType': 'base_actors', 'renderOrder': 20})
cmds.append({'type': 'set_visual', 'fieldId': backdrop_id, 'visualType': 'base_atmo', 'renderOrder': 0})
# backdrop → screen space (shape change): update_field if supported
cmds.append({'type': 'update_field', 'fieldId': backdrop_id, 'shapeType': 'screen'})
for hid, code in (('world', WORLD), ('camera', CAMERA), ('fx', FX), ('uplink', UPLINK)):
    cmds.append({'type': 'claim_node', 'id': hid})
    cmds.append({'type': 'update_step_hook', 'hookId': hid, 'author': 'Claude Opus 4.8',
                 'description': f'base-2d-mobile: {hid} (pixels=hitbox rewire)', 'code': code})
cmds.append({'type': 'set_world_data', 'data': {'baseManifest': manifest(backdrop_id)}})
json.dump(cmds, open(os.path.join(HERE, 'live-cmds.json'), 'w'), indent=1)
print('rewired-snap.json:', len(out['fields']), 'fields,', len(out['visualTypes']), 'visuals,', len(out['stepHooks']), 'hooks,', len(manifest(backdrop_id)['entries']), 'manifest entries')
print('live-cmds.json:', len(cmds), 'commands')
