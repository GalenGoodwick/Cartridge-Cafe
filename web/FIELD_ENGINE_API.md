# Field Engine Agent API Reference

Grid: 512x512. Auth: `Authorization: Bearer <ENGINE_AGENT_TOKEN>`.
Base URL: `http://localhost:3000`

> **Shaders are WGSL (WebGPU), not GLSL.** This doc predates the WebGPU engine;
> shader params named `glsl` still work as legacy aliases, but `wgsl` is the
> primary param and all shader code must be WGSL. The authoritative, current
> agent doc is `src/app/engine/AI_ENGINE_GUIDE.md` — prefer it, and prefer
> `define_visual` + `visualType` (the `visual_NAME` signature) over raw
> `add_effect` for new work.

---

## Endpoints

### GET /api/engine/bridge

Returns full engine state: fields, worldParams, worldData, interactionEffects, stepHooks, glslMods.

Query params: `?fieldId=xxx` (single field), `?name=Alpha` (by name), `?cell=128,256` (cell sample).

Response shape:
```json
{
  "fields": [ FieldSnapshot... ],
  "fieldCount": 3,
  "worldParams": { "gravity": 0, "friction": 0, "collisionForce": 0, "boundaryMode": "open", "bounciness": 0.5, "gravitationalConstant": 0 },
  "worldData": { ... },
  "interactionEffects": [ ... ],
  "stepHooks": [ ... ],
  "glslMods": [ ... ]
}
```

Each FieldSnapshot:
```json
{
  "id": "field_1_123",
  "name": "Alpha",
  "color": [0.9, 0.3, 0.1, 1.0],
  "transform": { "x": 256, "y": 256, "rotation": 0, "scale": 1.0, "vx": 0, "vy": 0, "vr": 0 },
  "effects": [{ "id": "effect_1_123", "author": "agent", "wgsl": "...", "description": "...", "blend": "alpha", "order": 10 }],
  "memory": [ ... ],
  "proximity": [{ "fieldId": "field_2_456", "fieldName": "Beta", "distance": -5, "direction": [0.7, 0.7], "overlapping": true }],
  "properties": { "hp": 100 },
  "stateAtCenter": { "r": 0.5, "g": 0.3, "b": 0.8, "a": 1.0 },
  "renderedPixels": { "width": 16, "height": 16, "pixels": [r,g,b,a,...] }
}
```

### POST /api/engine/bridge

Send commands. Single: `{ "type": "...", ... }`. Batch: `{ "commands": [ ... ] }`.

---

## Commands

### Field Management

| type | params | description |
|------|--------|-------------|
| `create_field` | `name?, color?: [r,g,b,a], x?, y?, parentFieldId?` | Create a new field |
| `delete_field` | `fieldId` | Delete field and all its effects |
| `set_position` | `fieldId, x, y` | Move field to absolute position |
| `set_color` | `fieldId, color: [r,g,b,a]` | Set field color (components 0-1) |
| `set_scale` | `fieldId, scale` | Set field scale (1.0 = default) |
| `set_name` | `fieldId, name` | Rename field |
| `set_parent` | `fieldId, parentFieldId?` | Attach/detach parent (child moves with parent) |
| `move` | `fieldId, dx, dy` | Relative movement |
| `clone_field` | `fieldId, name?, color?, offsetX?, offsetY?` | Duplicate field with all effects |
| `apply_force` | `fieldId, fx, fy` | Apply impulse force |
| `list_fields` | (none) | Print field list to terminal |

### Shader Effects

| type | params | description |
|------|--------|-------------|
| `define_visual` | `name, wgsl` | Register a visual type; fields with matching `visualType` render with it (preferred path) |
| `add_effect` | `fieldId, wgsl, blend?, author?, description?, order?` | Add WGSL effect to field (`glsl` accepted as legacy alias) |
| `update_effect` | `fieldId, effectId, wgsl, description?, blend?` | Recompile effect in place (no visual gap) |
| `remove_effect` | `fieldId, effectId` | Remove single effect |
| `clear_effect` | `fieldId?` | Clear all effects from field (or all fields) |
| `add_state_shader` | `wgsl, description?` | GPU state update (runs per pixel per frame) |
| `remove_state_shader` | (none) | Remove state update shader |
| `register_glsl_mod` | `id, code` | Register reusable WGSL utility (injected into all shaders; command name is historical) |
| `remove_glsl_mod` | `id` | Remove WGSL mod |

### Interactions

| type | params | description |
|------|--------|-------------|
| `add_interaction_effect` | `wgsl, fieldA?, fieldB?, author?, description?, blend?, spread?, order?, precedence?, hooks?` | WGSL shader rendered at field overlap pixels |
| `remove_interaction_effect` | `effectId` | Remove interaction shader |
| `define_interaction` | `rule: { trigger, effect, fieldA?, fieldB?, triggerDistance?, effectParams?, description? }` | Behavioral interaction rule |
| `remove_interaction` | `ruleId` | Remove interaction rule |

### Communication

| type | params | description |
|------|--------|-------------|
| `field_message` | `fromFieldId, toFieldId, content, data?` | Send message between fields (logged to memory) |
| `set_world_data` | `data: { key: value }` | Write to shared worldData store |
| `set_property` | `fieldId, key, value` | Set per-field property |
| `set_world_params` | `params: { gravity?, friction?, collisionForce?, boundaryMode?, bounciness?, gravitationalConstant? }` | Configure physics |

### Step Hooks (Per-frame JavaScript)

| type | params | description |
|------|--------|-------------|
| `add_step_hook` | `hookId, code, author?, description?` | Register per-frame JS execution |
| `update_step_hook` | `hookId, code, description?` | Recompile hook in place |
| `remove_step_hook` | `hookId` | Remove step hook |

### Lightweight Effects

| type | params | description |
|------|--------|-------------|
| `spawn_effect` | `x, y, effectType?, color?, size?, intensity?, offsets?` | Stamp visual effect at position |
| `spawn_projectile` | `x, y, vx?, vy?, effectType?, color?, size?, intensity?, lifetime?` | Create moving particle |
| `clear_effects` | `x, y, radius?` | Erase effects in radius |

---

## WGSL Signatures

### Visual Type Shader (preferred — via `define_visual`)

```wgsl
fn visual_NAME(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f
```

See `src/app/engine/AI_ENGINE_GUIDE.md` for the full contract, available
uniforms, and examples.

### Field Effect Shader (legacy — via `add_effect`)

```wgsl
fn fieldEffect(coord: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f
```

- `coord`: pixel center in grid coords (0-512)
- `regionMin/Max`: field bounding box
- `time`: seconds since engine start
- `params`: field color RGBA
- Returns: RGBA color. Alpha=0 is transparent. **The shader defines the field's shape via alpha.**

### Interaction Effect Shader

```wgsl
fn interactionEffect(coord: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f
```

Output alpha is multiplied by the overlap mask. If `precedence: true`, underlying field pixels are cleared first.

### State Update Shader

```wgsl
fn cellUpdate(coord: vec2f, state: vec4f, color: vec4f, time: f32, dt: f32) -> vec4f
```

Runs per pixel per frame. Returns new state value (clamped 0-1). Multiple cellUpdate functions have their deltas summed (additive composition).

---

## Shader Utility Library

All shaders have these functions pre-loaded:

### Entity Population
```wgsl
fn pop(i: i32) -> vec4f                  // entity i: [x, y, angle, aux]
fn popCount() -> i32                     // how many entities are live
```
Step hooks publish up to 4095 entities as flat floats (4 per entity) via
`worldData.gpuPopulation`; one shader draws them all — never one field per entity.
See `src/app/engine/AI_ENGINE_GUIDE.md` § Entity Populations.

### Noise
```wgsl
fn hash11(p: f32) -> f32                 // random [0,1]
fn hash21(p: vec2f) -> f32               // random [0,1] from 2D
fn hash22(p: vec2f) -> vec2f             // random vec2
fn vnoise(p: vec2f) -> f32               // value noise [0,1]
fn gnoise(p: vec2f) -> f32               // gradient noise [-1,1]
fn fbm(p: vec2f, octaves: i32) -> f32    // fractal brownian motion (max 8 octaves)
fn fbm3(p: vec2f) -> f32                 // fbm shorthands: fbm3..fbm6
fn warp(p: vec2f, strength: f32, time: f32) -> vec2f  // animated domain warping
```

### SDF Primitives
```wgsl
fn sdCircle(p: vec2f, r: f32) -> f32
fn sdBox(p: vec2f, b: vec2f) -> f32
fn sdRoundedBox(p: vec2f, b: vec2f, r: f32) -> f32
fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32
fn sdEquilateralTriangle(p: vec2f, r: f32) -> f32
fn sdStar(p: vec2f, r: f32, n: i32, m: f32) -> f32
```

### SDF Operations
```wgsl
fn opUnion(d1: f32, d2: f32) -> f32
fn opSubtract(d1: f32, d2: f32) -> f32
fn opIntersect(d1: f32, d2: f32) -> f32
fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32
fn opSmoothSubtract(d1: f32, d2: f32, k: f32) -> f32
```

### Color & Transform
```wgsl
fn hsv2rgb(c: vec3f) -> vec3f
fn palette(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f
fn rot2(angle: f32) -> mat2x2f
fn regionUV(coord: vec2f, regionMin: vec2f, regionMax: vec2f) -> vec2f          // [0,1]
fn regionUVCentered(coord: vec2f, regionMin: vec2f, regionMax: vec2f) -> vec2f  // [-1,1]
fn regionUVAspect(coord: vec2f, regionMin: vec2f, regionMax: vec2f) -> vec2f    // aspect-corrected [-1,1]
fn diffuseLight(p: vec2f, lightPos: vec2f, falloff: f32) -> f32
fn glow(d: f32, col: vec3f, intensity: f32, radius: f32) -> vec3f
```

---

## InteractionEffect Options

```json
{
  "type": "add_interaction_effect",
  "fieldA": "field_1_xxx",
  "fieldB": "field_2_xxx",
  "wgsl": "fn interactionEffect(...) -> vec4f { ... }",
  "blend": "alpha",
  "spread": 5,
  "precedence": true,
  "hooks": [
    { "type": "memory", "target": "both", "message": "Fields are interacting!", "cooldown": 2.0 },
    { "type": "modify_property", "target": "A", "property": "hp", "value": 90, "cooldown": 1.0 },
    { "type": "apply_force", "target": "B", "fx": 0, "fy": -10, "cooldown": 0.5 },
    { "type": "webhook", "url": "https://example.com/hook", "cooldown": 5.0 }
  ]
}
```

- `fieldA/fieldB`: null = any field. Both null = triggers for all overlapping pairs.
- `spread`: pixel dilation beyond exact overlap (0 = overlap only).
- `precedence`: if true, clears underlying field rendering at overlap pixels before drawing interaction.
- `hooks`: behavioral side-effects triggered each frame while interaction is active, with per-hook cooldowns.

---

## Key Notes

1. **fieldId can be a name** — the engine resolves names to IDs automatically
2. **Fields are invisible until they have an effect** — no default shader
3. **The shader defines the field's shape** — return alpha=0 for transparent pixels
4. **Compile errors** go to `worldData.last_compile_error` and the terminal
5. **worldData is shared** — all agents read/write it for coordination
6. **Memory is trimmed** to last 20 entries in bridge GET responses
7. **Rendered pixels** — 16x16 downsampled screenshot of each field, updated every ~1s
8. **Step hook code** is JavaScript with access to `sim`, `dt`, `time`, and all fields
