# PENTARCH — the build CONTRACT (freeze this; every module obeys it)

A swarm builds the modules of STRUCTURE.md in parallel. They only compose if they
agree on interfaces. This file IS that agreement. It is frozen: a module that
needs to change the contract must say so loudly, not fork it silently.

## 0. Runtime & tooling (all Node, one exception)

- Node 24. Tests: `node --test pentarch/test/`. Build: `node pentarch/build.mjs`.
- The ONLY Deno uses: the offline WGSL check (`tools/wgsl-render-check.mjs`) and
  the live bridge push. Nothing in the module/test path may reference `Deno` or
  `/tmp` — the frozen `backlog/tests/*` do (they read `/tmp/shipyard-parts.json`
  under Deno); those are REFERENCE ONLY, ported fresh into `pentarch/test/`.

## 1. The hook is ONE function-body string

The engine runs `new Function('sim','dt', HOOK)` each tick. `HOOK` is assembled by
`build.mjs` as:

```
HOOK = PRELUDE + DISPATCH
DISPATCH = "if (SC==='designer'){" + designer.SRC + "}"
         + "else if (SC==='finder'){" + finder.SRC + "}"
         + "else if (SC==='lobby'){"  + lobby.SRC  + "}"
         + "else if (SC==='battle'){" + battle.SRC + "}"
         + "else if (SC==='debrief'){"+ debrief.SRC+ "}"
         + "else {" + menu.SRC + "}"
```

- Each `mod-*.mjs` exports **`export const SRC = String.raw\`…\``** — a hook
  fragment (statements, not a function) that runs when its scene is active. It may
  read `sim`, `dt`, `wd`, `SC`, and every PRELUDE helper/global by name (they are
  lexically in scope at the injection point). It must NOT declare `const`/`let`
  names that collide across modules at the same block level — each module's SRC is
  wrapped in its own `{ }` block, so locals are safe; only PRELUDE names are global.
- Geometry is NOT re-implemented in any module. `build.mjs` inlines the bodies of
  `penta-core.mjs` and `penta-holes.mjs` (strip `export `/`import …` lines) into
  PRELUDE, so `layout`, `freeEdges`, `voids`, `contacts`, `holes`, `classify`,
  `attachPose`, `vertices`, `overlaps`, `APOTHEM`, `CIRCUM` … are all in scope.
  These `.mjs` stay the single tested source of truth (`penta-core.test.mjs`).

## 2. PRELUDE provides (build.mjs owns this; modules just call it)

```
wd                      = sim.worldData
SC                      = wd.__pw ? wd.__pw.scene : (wd.__scene || 'menu')   // the one scene switch
IN_ROOM                 = Array.isArray(wd.players)                          // arena vs local
MY_SEAT                 = wd.gpuUniforms ? (wd.gpuUniforms[15]|0) : 0
POP = []                // module pushes entities here; PRELUDE flushes → wd.gpuPopulation at end
pushEnt(x,y,a,code)     // one entity = 4 floats [x,y,a,code]  (see §4)
toUV(mx,my)             // pixel → uv in the LETTERBOX SQUARE (side=min(w,h)); preserve v9 mapping exactly
hitButton(id,ux,uy)     // rect hit-test in uv; returns bool; PRELUDE also emits the button entity (code 300+)
edgeTap(id,cond)        // sim.edge wrapper — true only on rising edge (discrete clicks)
latch(name)             // returns the delta of an input counter since last tick (spawn/fire/split fairness)
PARTS                   // the parts.mjs table, in scope (STAT/COST/HP/color/category/palette order)
statOf(part)            // → {hp,mass,thrust,energy,dps,...} from PARTS
sound(name)             // sets wd.__play_sound (one-shot; arena consumes once)
D                       = wd.__D || (wd.__D = freshDesign())   // designer persistent state (was v9 wd.__pd)
PW                      = wd.__pw                              // in-room shared state or undefined
```

Input each tick: LOCAL scenes read `wd.mouse_x/mouse_y` (pixels) + `wd.mouse_down`
+ `wd.input.pointer`. IN_ROOM scenes read the acting player's frame from
`wd.players[MY_SEAT]` (fields: `mx,my,down,spawn_n,fire_n,chat_n,ready,start`).
Discrete actions ALWAYS travel as monotonic counters (`spawn_n`…) consumed via
`latch()` — never as booleans (a tap is lost to 24Hz sampling under lag).

## 3. Shared state on `wd` (namespaces — do not cross the streams)

| key | owner | meaning |
|-----|-------|---------|
| `wd.__scene` | client/menu | local scene before a room: `menu`\|`designer`\|`finder` |
| `wd.__D` | designer | persistent design state `{tree:[{parent,edge,part}], sel, flash, …}` |
| `wd.__fleet` | designer | up to 3 saved berth designs `[tree,…]` |
| `wd.__lobby` | engine poll | finder rooms `[{room,players,capacity,started}]` |
| `wd.__joinRoom` | client set | room name → engine opens the arena socket |
| `wd.__sendDesign` | client | the berth set carried into input frames on join |
| `wd.__pw` | in-room hook | authoritative room state `{scene,host,seats,chat,started,map,units,rings,income}` |
| `wd.players` | arena | `[{seat,role,…input}]` (present ⇒ IN_ROOM) |
| `wd.__started` | in-room hook | mirrors `__pw.started`; arena `/rooms` reports it |
| `wd.__play_sound` | any | one-shot sfx name (arena consumes after broadcast) |
| `gpuUniforms[15]` | client | MY_SEAT |

## 4. Entity encoding — `pushEnt(x,y,a,code)` → `[x,y,a,code]`, 4 floats each

`shader.mjs` is the ONLY decoder of `code`. Single registry (extends STRUCTURE.md):

```
0..5          designer tile, part index = code           (a = select/flash tint)
60..68        ghost outline, seat = code-60              (a = legal?1:0)
71..75        sealed-shape heartbeat, shape = code-71    (a = pulse phase)
76..80        shape outline, shape = code-76             (a = fract vertex count / len)
100+seat      beam,  a = length·(fract) , seat in int    (battle)
200+owner     capture ring, a = hold fraction            (battle)
part + (seat+2)*100   battle tile (seat-rimmed hull tile)
300..319      UI button, id = code-300                   (a = pressed?1:0)
```

Convention: `a` (3rd float) is the per-code aux param above. Positions in uv-ish
world units; the visual maps world→screen with the same letterbox square as input.

## 5. Visual — `shader.mjs` builds `fn visual_pentarch(...)`

Signature the engine + check tool call (see `tools/wgsl-render-check.mjs`):
`visual_pentarch(uv: vec2f, _p: f32, _c: vec4f, time: f32, _a: vec4f, _b: vec4f) -> vec4f`.
Reads `popCount()`, `pop(i)->vec4f`, `uni(i)->f32`. Self-verify offline:
`deno run --unstable-webgpu -A tools/wgsl-render-check.mjs --visualInline <file> --name pentarch --out /tmp/pentarch-vis.png`
→ must report `ok:true`, `blank:false`. Port v9's decoder (backlog/parts/v9-parts.json
`.vis`) for tiles/ghosts/outlines/voids; extend for rings/beams/buttons.

## 6. build.mjs

`node build.mjs` → assemble PRELUDE+DISPATCH, inline geometry, write
`pentarch/dist/hook.js` + `pentarch/dist/visual.wgsl`, run `node --test pentarch/test/`,
run the WGSL check. Exit non-zero on any failure. `--push` (ONLY on Galen's word)
POSTs `define_visual{name:'pentarch'}` + `add_step_hook` to the bridge with scene
key `uc_st_<PENTARCH_SCENE_TOKEN>`. Default NEVER pushes.

## 7. Tests — `pentarch/test/`

Shared harness `pentarch/test/harness.mjs` (port `backlog/tests/yard-sim.mjs` to
Node, no Deno/no /tmp): builds the hook via `import { assembleHook } from '../build.mjs'`,
wraps in `new Function('sim','dt',hook)`, exposes `tick(mx,my,down)`, `uvpx(ux,uy)`,
and a fake `sim` with `edge`/`trigger`/`getFieldByName`/`rand`. Every backlog
`yard-*-test` has a ported equivalent asserting the SAME behavior against the built
hook. `node --test` green is the gate between rebuild steps.

## 8. Scenes own these blocks (who writes what)

- **menu** (`mod-menu`, folded into build prelude or tiny module): title, PLAY→designer, berths summary, `design`/`fleet` corner pads (persistent chrome).
- **designer** (`mod-designer`): port v9 hook logic — ghosts/blanks/palette tabs/select/double-click delete/route-aware removal/shape grammar/flash/live stats/berths. Rename `wd.__pd`→`wd.__D`. All yard-* behaviors preserved.
- **finder** (`mod-finder`): render `wd.__lobby`, NEW SERVER + berth picker, set `wd.__joinRoom`+`wd.__sendDesign`. Istrolid browser layout (Official/Community sections, `<mode> <Name>` naming).
- **lobby** (`mod-lobby`): seats + host(lowest seat) + drawn START button + quickchat (number keys→canned lines in `PW.chat`) + mode/map picker (host). Live map behind translucent panel.
- **battle** (`mod-battle`): spawn-from-berths at cost from income, BLOOP steering, capture rings, per-tile guns/damage/route-shed, star super-weapon, win→debrief.
- **debrief** (`mod-debrief`, tiny): scoreboard, REMATCH(host)/LEAVE.

## 9. Chrome law (Istrolid, from Galen's screenshots)

Persistent top bar (scene tabs left · matchup center · chat/controls right) and
bottom corner pads (`design` bottom-left, `fleet` bottom-right) render in EVERY
scene — PRELUDE draws them so no module forgets. Panels are translucent overlays
over the live scene; NEVER a dead text screen (that was the war-room bug). Every
illegal action states its reason inline (red banner): "would overlap",
"disconnected", "not enough ⬡".
