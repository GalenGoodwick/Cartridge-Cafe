# VEILFIRE NEO — the vertical slice: LOOK (the nave, answering the imagine
# layers) then BEHAVIOR (spine + the first pull-bound room). ONE GEO table
# generates shader constants AND JS physics — the two cannot disagree.
import json, urllib.request, os
HERE = os.path.dirname(os.path.abspath(__file__))
WT = open(os.path.join(HERE, 'neo-token.txt')).read().strip()
URL = "https://cartridge.cafe/api/engine/bridge"
def post(cmds):
    r = urllib.request.Request(URL, data=json.dumps({"commands": cmds}).encode(),
        headers={"Authorization": "Bearer " + WT, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=180))
def show(label, r):
    for x in r["results"]:
        print(label, "→", json.dumps({k: v for k, v in x.items() if k in ('ok','phase','error','untrue','left','next','wrongPhase')})[:180])

GEO = {  # the nave — tall beyond need (the dream's first feeling)
    "hx": 10.0, "hy": 14.0, "z0": 0.0, "z1": 60.0,      # half-width · HEIGHT · length
    "colX": 6.0, "colSp": 8.0, "colZ0": 8.0, "colN": 7, "colR": 1.1,
    "rays": [15.0, 30.0, 45.0],                            # god-ray z positions
    "eyeH": 1.7, "start": {"x": 0.0, "z": 4.0},
}

NAVE = r"""
// NEO NAVE (LOOK) — the imagine layers, answered:
//   palette: drowned-iron stone · lantern #ffb454 the ONE ally color
//   atmosphere: three full-height god-rays, climbing dust, lantern falloff
//   motion: dust climbs; everything else holds still and lets you dread
//   hero prep: the far end darkens toward the archway (light gives up first)
// Lanes: u0-2 eye · u3 yaw · u4 pitch · u5 lantern flicker. Budget: 56 steps.
const N_HX = %HX%; const N_HY = %HY%; const N_Z1 = %Z1%;
const N_CX = %CX%; const N_CSP = %CSP%; const N_CZ0 = %CZ0%; const N_CN = %CN%; const N_CR = %CR%;
const N_RAYS = array<f32, 3>(%RAYS%);

fn nv_hash(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn nv_map(p: vec3f) -> f32 {
  // the nave air volume: tall box, ribs implied by cosine flutes in the walls
  let flute = 0.25 * cos(p.z * 0.8) * cos(p.y * 0.5);
  var d = -(min(min(N_HX - abs(p.x) + flute, N_HY - abs(p.y - N_HY * 0.5)), min(p.z + 0.0, N_Z1 - p.z)));
  // column rows, domain-repeated down the nave
  let zi = clamp(floor((p.z - N_CZ0) / N_CSP + 0.5), 0.0, f32(N_CN - 1));
  let pz = N_CZ0 + zi * N_CSP;
  let taper = 1.0 + 0.06 * p.y;      // columns swell gently upward — weight overhead
  let c1 = length(p.xz - vec2f(N_CX, pz)) - N_CR * taper * 0.09 * (12.0 - min(p.y, 11.0));
  let c2 = length(p.xz - vec2f(-N_CX, pz)) - N_CR * taper * 0.09 * (12.0 - min(p.y, 11.0));
  d = min(d, max(min(c1, c2), p.y - (N_HY - 1.5)));
  return d;
}
fn nv_norm(p: vec3f) -> vec3f {
  let e = 0.03;
  return normalize(vec3f(
    nv_map(p + vec3f(e, 0., 0.)) - nv_map(p - vec3f(e, 0., 0.)),
    nv_map(p + vec3f(0., e, 0.)) - nv_map(p - vec3f(0., e, 0.)),
    nv_map(p + vec3f(0., 0., e)) - nv_map(p - vec3f(0., 0., e))));
}
fn visual_neo_nave(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let vb = viewbox();
  let aspect = vb.w / max(vb.z, 0.001);
  let eye = vec3f(uni(0), uni(1), uni(2));
  let yaw = uni(3); let pitch = uni(4);
  let cy = cos(yaw); let sy = sin(yaw); let cp = cos(pitch); let sp = sin(pitch);
  let fwd = vec3f(sy * cp, -sp, cy * cp);
  let right = vec3f(cy, 0.0, -sy);
  let up = cross(right, fwd);
  let rd = normalize(fwd * 1.2 + right * uv.x + up * (-uv.y) * aspect);
  var t = 0.02; var hit = false;
  for (var i = 0; i < 56; i++) {
    let d = nv_map(eye + rd * t);
    if (d < 0.004 * t + 0.004) { hit = true; break; }
    t += d * 0.92;
    if (t > 90.0) { break; }
  }
  // drowned-iron base — dark, never black (the law keeps a floor)
  var col = vec3f(0.030, 0.034, 0.042);
  let lantern = vec3f(1.0, 0.706, 0.329);                 // the ONE ally color
  let flick = 0.85 + 0.15 * uni(5);
  if (hit) {
    let p = eye + rd * t;
    let n = nv_norm(p);
    // stone: drowned iron, faint mineral variance
    var alb = mix(vec3f(0.208, 0.230, 0.262), vec3f(0.160, 0.180, 0.210), nv_hash(floor(p * 2.0)) * 0.6);
    // the lantern loves you: warm inverse-square, the only light you own
    let toE = eye - p; let dE = length(toE);
    let lam = max(dot(n, toE / max(dE, 0.001)), 0.0);
    var lit = alb * lam * lantern * (3.2 * flick) / (1.0 + dE * dE * 0.055);
    // god-rays strike the floor and near walls — cold daylight from above
    var rayGain = 0.0;
    for (var k = 0; k < 3; k++) { rayGain = max(rayGain, exp(-abs(p.z - N_RAYS[k]) * 0.55) * exp(-abs(p.x) * 0.30)); }
    lit += alb * vec3f(0.75, 0.82, 0.95) * rayGain * max(n.y, 0.0) * 1.4;
    // ambient: the nave remembers light dimly; the far end gives up first
    lit += alb * vec3f(0.05, 0.055, 0.07) * (1.0 - clamp(p.z / N_Z1, 0.0, 1.0) * 0.7);
    col = lit;
  }
  // volumetric: the rays themselves + climbing dust (gravity negotiable)
  var glow = vec3f(0.0);
  var tt = 0.4;
  for (var i = 0; i < 12; i++) {
    let sp2 = eye + rd * tt;
    var g = 0.0;
    for (var k = 0; k < 3; k++) { g = max(g, exp(-abs(sp2.z - N_RAYS[k]) * 0.9) * exp(-abs(sp2.x) * 0.5)); }
    let inside = step(abs(sp2.x), N_HX) * step(0.0, sp2.y) * step(sp2.y, N_HY);
    let dust = step(0.992, nv_hash(floor(sp2 * 6.0 - vec3f(0.0, time * 0.5, 0.0))));  // dust CLIMBS
    glow += (vec3f(0.72, 0.80, 0.95) * g * 0.030 + vec3f(1.0) * dust * g * 0.5) * inside;
    tt += min(t, 40.0) / 12.0;
  }
  col += glow;
  // lantern halo in the air right around you
  col += lantern * 0.045 * flick / (1.0 + dot(uv, uv) * 3.0);
  col = max(col, vec3f(0.035));                            // never-dark
  return vec4f(pow(col, vec3f(0.88)), 1.0);
}
"""
NAVE = (NAVE.replace("%HX%", str(GEO["hx"])).replace("%HY%", str(GEO["hy"])).replace("%Z1%", str(GEO["z1"]))
            .replace("%CX%", str(GEO["colX"])).replace("%CSP%", str(GEO["colSp"])).replace("%CZ0%", str(GEO["colZ0"]))
            .replace("%CN%", str(GEO["colN"])).replace("%CR%", str(GEO["colR"]))
            .replace("%RAYS%", ", ".join(str(z) for z in GEO["rays"])))

GEO_JS = "const GEO = " + json.dumps(GEO) + ";"

# ═══ LOOK ═══
show("dock look", post([{"type": "dock_phase", "id": "look"}]))
show("nave visual", post([{"type": "define_visual", "name": "neo_nave", "wgsl": NAVE}]))
show("wear it", post([{"type": "set_visual", "fieldId": "scene", "visualType": "neo_nave"}]))
show("validate", post([{"type": "validate_world", "results": []}]))

# ═══ BEHAVIOR (dock after LOOK's gate — attempted below; if the visual gate
# refuses undock, we stop honestly and report) ═══
PLAYER = GEO_JS + r"""
// SPINE · player — FPS walk + mouse-look intent. Owns __np (neo player).
const wd = sim.worldData;
wd.__fixedStep = 1/60; if (wd.__seed === undefined) wd.__seed = 7;
wd.__mouseLook = true;
if (!wd.__np) wd.__np = { x: GEO.start.x, y: GEO.eyeH, z: GEO.start.z, yaw: 0, pitch: 0.04, vx: 0, vz: 0 };
const P = wd.__np; const inp = wd.input || {};
P.yaw += (inp.lookX || 0) * 0.0032;
P.pitch = Math.max(-1.15, Math.min(1.15, P.pitch + (inp.lookY || 0) * 0.003));
P.mx = inp.moveX || 0; P.mz = inp.moveY || 0;
"""
PHYS = GEO_JS + r"""
// PROFILE · phys-cathedral — collision against the SAME nave map the shader
// marches (generated from one GEO table). Pulled by room-nave.
const wd = sim.worldData; const P = wd.__np; if (!P) return;
const dt2 = Math.min(dt, 1/30);
const flute = (z, y) => 0.25 * Math.cos(z * 0.8) * Math.cos(y * 0.5);
const map = (x, y, z) => {
  let d = Math.min(Math.min(GEO.hx - Math.abs(x) + flute(z, y), GEO.hy - Math.abs(y - GEO.hy * 0.5)), Math.min(z, GEO.z1 - z));
  const zi = Math.max(0, Math.min(GEO.colN - 1, Math.round((z - GEO.colZ0) / GEO.colSp)));
  const pz = GEO.colZ0 + zi * GEO.colSp;
  const taper = 1 + 0.06 * y;
  const r = GEO.colR * taper * 0.09 * (12 - Math.min(y, 11));
  const c = Math.min(Math.hypot(x - GEO.colX, z - pz), Math.hypot(x + GEO.colX, z - pz)) - r;
  return Math.min(d, Math.max(c, y - (GEO.hy - 1.5)));
};
const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
const wx = (P.mz || 0) * sy + (P.mx || 0) * cy;
const wz = (P.mz || 0) * cy - (P.mx || 0) * sy;
P.vx += (wx * 3.6 - P.vx) * dt2 * 8;
P.vz += (wz * 3.6 - P.vz) * dt2 * 8;
const nx = P.x + P.vx * dt2, nz = P.z + P.vz * dt2;
if (map(nx, P.y, P.z) > 0.35) P.x = nx; else P.vx = 0;
if (map(P.x, P.y, nz) > 0.35) P.z = nz; else P.vz = 0;
"""
LANTERN = r"""
// PROFILE · lantern — the flicker of the one light that loves you. Owns u5.
const wd = sim.worldData;
if (wd.__lan === undefined) wd.__lan = 0.5;
wd.__lan += (Math.sin(Date.now ? 0 : 0) === 0 ? ((sim.rand ? sim.rand() : 0.5) - 0.5) * 0.3 : 0);
wd.__lan = Math.max(0, Math.min(1, wd.__lan * 0.92 + (sim.rand ? sim.rand() : 0.5) * 0.08));
"""
UPLINK = r"""
// SPINE · uplink — lanes u0-2 eye · u3 yaw · u4 pitch · u5 lantern. LAST.
const wd = sim.worldData;
const U = new Array(64).fill(0);
const P = wd.__np || { x: 0, y: 1.7, z: 4, yaw: 0, pitch: 0 };
U[0] = P.x; U[1] = P.y; U[2] = P.z; U[3] = P.yaw; U[4] = P.pitch;
U[5] = wd.__lan === undefined ? 0.5 : wd.__lan;
wd.gpuUniforms = U;
wd.__ev = [];
"""
def behavior():
    show("dock behavior", post([{"type": "dock_phase", "id": "behavior"}]))
    show("hooks", post([
        {"type": "add_step_hook", "hookId": "player", "author": "Claude Opus 4.8", "description": "NEO spine: player (walk + look intent)", "code": PLAYER},
        {"type": "add_step_hook", "hookId": "prof-phys-cathedral", "author": "Claude Opus 4.8", "description": "NEO profile: cathedral physics — the one nave map (pulled by room-nave)", "code": PHYS},
        {"type": "add_step_hook", "hookId": "prof-lantern", "author": "Claude Opus 4.8", "description": "NEO profile: lantern flicker (pulled by room-nave)", "code": LANTERN},
        {"type": "add_step_hook", "hookId": "uplink", "author": "Claude Opus 4.8", "description": "NEO spine: uplink — lanes, runs last", "code": UPLINK},
    ]))
    show("records", post([
        {"type": "register_node", "id": "room-nave", "node": {"kind": "room", "uses": ["prof-phys-cathedral", "prof-lantern"], "desc": "the nave: taller than it needs to be"}},
        {"type": "register_node", "id": "prof-phys-cathedral", "node": {"kind": "profile", "desc": "collision vs the one nave map"}},
        {"type": "register_node", "id": "prof-lantern", "node": {"kind": "profile", "owns": {"uni": [[5, 5]]}, "desc": "the ally light"}},
        {"type": "register_node", "id": "fact-player-start", "node": {"kind": "fact", "desc": "spawn", "data": {"x": 0, "z": 4, "yaw": 0}}},
        {"type": "register_node", "id": "player", "node": {"kind": "spine", "owns": {"uni": [[0, 4]]}}},
        {"type": "register_node", "id": "uplink", "node": {"kind": "spine"}},
    ]))
    show("status", post([{"type": "build_status"}]))

# LOOK's gate needs visual evidence — run behavior() only if undock succeeds later.
import sys
if '--behavior' in sys.argv: behavior()
