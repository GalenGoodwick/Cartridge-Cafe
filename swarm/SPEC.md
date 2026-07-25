# VEILFIRE 3D — shooter systems + Antichamber-style horror

A dynamic-swarm build. Two tracks that share one substrate:

- **Track A — `shooter3`**: a reusable 3rd-person-shooter systems layer (raymarched
  3D world, WASD free-walk, animated population enemies, projectiles, combat,
  explosion deaths, HUD, audio). Lives as `scenes/shooter3/*` — a library + hook
  fragments, world-agnostic.
- **Track B — `veilfire`**: upgrade VEILFIRE into a multi-room Antichamber-style
  horror game built ON `shooter3` — grown Gothic rooms, a **light/dark mechanic**,
  grown demon enemies with attacks, KINDLE/monistary atmosphere. Lives as
  `scenes/veilfire/*`, assembled + deployed by `veilfire-cartridge.mjs`.

This is a **shader-raymarch** build, not meshes. The engine already has the kit.

---

## The substrate (already in the repo — reuse, do not reinvent)

- **`scenes/world3-lib.wgsl`** — the 3D raymarch kit. Your scene defines
  `fn w3_map(p: vec3f) -> vec2f` (signed distance, material id). It gives you:
  camera `mod_w3_ray(uv, ro, ta, fov)`, marcher `mod_w3_march(ro,rd,tmin,tmax,steps)`,
  normals `mod_w3_nrm`, soft shadows `mod_w3_shadow`, AO `mod_w3_ao`, light rig
  `mod_w3_light`, fog `mod_w3_fog`; SDFs `mod_w3_sphere/box/rbox/capsule/cyl/cone/
  torus/octa/plane`; architecture `mod_w3_arch/lancet/bezStrut/taperStrut`; domain
  ops `rotX/rotY/rotZ/repeat/polar`. **Camera is driven from the whiteboard:**
  `uni4(60) = (ro.xyz, fov)`, `uni4(61) = (target.xyz, _)`. Write those in the hook
  and the world walks.
- **`scenes/anim3-lib.wgsl`** — articulated animation (IK / gait / aim), stateless,
  driven per-entity. "4095 animated bodies, one dispatch." Enemies pose through this.
- **`web/src/lib/grow-rig.mjs` (`growDemonRig`)** + **`grow-building.mjs` (`grow_building`)**
  — self-posing demon rigs + grown Gothic architecture. VEILFIRE already uses both.
- **`scenes/skel-lib.wgsl`** — creature rigs → raymarched volumes.
- **Population buffer** — `worldData.gpuPopulation`, flat floats; shader reads
  `pop(i) -> vec4f` and `popCount() -> i32`. Cap **4095**, ONE dispatch. Enemies +
  projectiles live here. (Template: `scenes/pixelburst-cartridge.mjs`.)
- **Input** — `wd.input`: `moveX`/`moveY` (WASD/arrows, −1..1, forward=+moveY),
  `pointer {x,y,down,pressed,released}`, `action`/`actionHeld`. Raw `key_*`/`mouse_*`
  also available.
- **Whiteboard** — `worldData.gpuUniforms`; every visual reads `uni(i)` / `uni4(i)`.
- **Post** — `worldData.postProcess { bloomIntensity, bloomThreshold, vignetteStrength,
  vignetteRadius }` + ACES. Visuals output **linear HDR**, never tonemap themselves.
- **Audio** — `worldData.__play_sound` / `worldData.__play_music`.
- **Horror lighting recipes** — `scenes/sanctum-cartridge.mjs` projective god-rays
  (`mod_beams`, light/glass/reflection are one function); monistary torch + soft
  shadow + AO + vignette palette.
- **Death VFX** — `scenes/pixelburst-cartridge.mjs`, reversible population ember
  burst; reuse for enemy deaths / hit sparks.

## Hard constraints (design against these; exceeding quarantines the visual)

- **≤ 16 field-effect dispatches / frame.** NOT a field per enemy — draw ALL
  entities in ONE visual by looping `pop(i)`. One fullscreen `screen` field
  raymarches the world + draws the population.
- **≤ 4095 population entities.** **for-loop bound ≤ 8192.** **Uber-shader source
  ≤ 300KB.** March budget ~96 primary steps fullscreen; gate shadows (~24) and any
  secondary rays; region-gate. Watch `worldData.__budget.frameMs` (host writes it ~2s).

## Verification — THE EYE (never build blind)

`render_probe` now binds **real population data** (render-core.mjs:271-276, 338-343)
and drives **scripted input clips** (`opts.input`, `opts.inputStart`) — so a
population-driven, WASD-walking, camera-moving 3D world IS probe-verifiable, both a
static frame and motion across ticks. Every node's `tests` say exactly what probe +
input to run and what the frame/struct must show. A node is green only when the eye
confirms it — no exceptions. (Still stubbed headless: feedback `prevHere/prevAt`,
`sampleTarget*`, `cafeIcon` — don't rely on those for verification.)

Local run: `deno run -A --unstable-webgpu tools/render-probe.mjs --state <s>.json
--ticks N --input <clip> --out f.png`. `swarm/probe.mjs` (verify-harness node) wraps
this per node.

---

## THE ONE TRUTH — shared contracts (every node imports these; do not diverge)

### Whiteboard layout (`uni(i)` floats; world3 reserves 60-62 for the camera)
```
0  time
1  playerX      2  playerY      3  playerZ        // player world pos
4  playerYaw    5  playerPitch                     // facing (radians)
6  playerHP01   7  ammo         8  score
9  roomId       10 lightLevel01 11 lanternFuel01   // light/dark mechanic
12 dread01      13 enemyCount   14 gameState       // 0 play · 1 dead · 2 win
15 muzzleFlashT 16 hitFlashT    17 shakeAmt        // feedback timers
18 fogDensity   19 reloadT      20 lastFireT
21..31 reserved (room flags / objectives)
60 uni4: (camRo.x, camRo.y, camRo.z, fov)          // world3 camera — REQUIRED
61 uni4: (camTarget.x, camTarget.y, camTarget.z, _)
```

### Population layout — TWO consecutive entries per entity (8 floats), 3D-capable
```
pop(2i)   = (x, y, z, kind)     kind: 0 empty · 1 enemyWalker · 2 enemyFlyer
                                       · 3 projPlayer · 4 projEnemy · 5 deathBit
pop(2i+1) = (hp01, animPhase, yaw, flags)
```
The visual loops `for i in 0..popCount()/2` and branches on `kind`. The hook writes
both slots per entity. **Open contract question for `enemies`:** reconcile this with
`anim3-lib`'s actual per-entity input — if anim3 wants (x,y,angle,aux) 2D, either
adapt anim3's driver or document the mapping here BEFORE building enemies. Resolve in
the `contracts` node and update this section; downstream nodes read it as law.

### File ownership (the clobber law — edit ONLY your node's files)
```
shooter3/render.wgsl       renderer-mega   (visual_s3: raymarch world + draw pop)
shooter3/enemies.wgsl      enemies         (enemy SDF/anim draw + AI helpers)
shooter3/projectiles.wgsl  projectiles     (projectile draw)
shooter3/deathfx.wgsl      death-fx        (ember burst / sparks draw)
shooter3/hud.wgsl          hud             (char5x7 health/ammo/score/crosshair)
shooter3/hooks/movement.mjs   movement     (WASD + collision + 3p camera)
shooter3/hooks/enemies.mjs    enemies      (spawn + AI + attack sim)
shooter3/hooks/projectiles.mjs projectiles (fire + travel + lifespan)
shooter3/hooks/combat.mjs     combat       (hit-test, HP, damage, score)
shooter3/hooks/deathfx.mjs    death-fx     (spawn death bits, shake)
shooter3/hooks/audio.mjs      audio        (sfx/music triggers)
veilfire/rooms.wgsl        vf-rooms        (w3_map room graph, grown arch)
veilfire/lightdark.wgsl    vf-lightdark    (carried light, dark zones, god-rays)
veilfire/demons.wgsl       vf-demons       (demon rig draw + horror AI helpers)
veilfire/atmosphere.wgsl   vf-atmosphere   (fog/torch/AO/vignette/embers)
veilfire-cartridge.mjs     vf-integrate    (assemble modules+visual+hook, deploy)
swarm/SPEC.md              contracts       (THIS FILE — the one truth)
swarm/probe.mjs            verify-harness  (per-node eye harness)
```
Hooks are JS fragments each exporting a `function(sim, dt, G)` slice; `vf-integrate`
composes them into the one step-hook string, in order: movement → enemies →
projectiles → combat → deathfx → lightdark → audio. Shared state on `sim.worldData.__vf`
(version-guarded — see the PIXELBURST `ver` lesson).

---

## Build order (dependency waves)
1. `contracts` (this doc), `verify-harness`
2. `world3-base` (a room renders, camera walks from whiteboard)
3. `movement`, `vf-rooms` (parallel)
4. `renderer-mega` (megashader: world + population branch)
5. `enemies`, `projectiles` (parallel)
6. `combat`, `death-fx`, `hud`, `audio` (parallel)
7. `vf-lightdark`, `vf-demons`, `vf-atmosphere` (parallel)
8. `vf-integrate` (assemble + deploy + full playtest probe)

Coordinate on the commons; claim a node before editing; a node is green only when
the eye agrees. Opus builds; this spec is authored by Claude (Fable).
