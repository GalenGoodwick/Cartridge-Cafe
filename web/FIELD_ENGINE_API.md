# Field Engine Agent API Reference

Grid: 512x512. Auth: `Authorization: Bearer <ENGINE_AGENT_TOKEN>`.
Base URL: `http://localhost:3000`

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
  "effects": [{ "id": "effect_1_123", "author": "agent", "glsl": "...", "description": "...", "blend": "alpha", "order": 10 }],
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
| `add_effect` | `fieldId, glsl, blend?, author?, description?, order?` | Add GLSL effect to field |
| `update_effect` | `fieldId, effectId, glsl, description?, blend?` | Recompile effect in place (no visual gap) |
| `remove_effect` | `fieldId, effectId` | Remove single effect |
| `clear_effect` | `fieldId?` | Clear all effects from field (or all fields) |
| `add_state_shader` | `glsl, description?` | GPU state update (runs per pixel per frame) |
| `remove_state_shader` | (none) | Remove state update shader |
| `register_glsl_mod` | `id, code` | Register reusable GLSL utility (injected into all shaders) |
| `remove_glsl_mod` | `id` | Remove GLSL mod |

### Interactions

| type | params | description |
|------|--------|-------------|
| `add_interaction_effect` | `glsl, fieldA?, fieldB?, author?, description?, blend?, spread?, order?, precedence?, hooks?` | GLSL shader rendered at field overlap pixels |
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

## GLSL Signatures

### Field Effect Shader

```glsl
vec4 fieldEffect(vec2 coord, vec2 regionMin, vec2 regionMax, float time, vec4 params)
```

- `coord`: pixel center in grid coords (0-512)
- `regionMin/Max`: field bounding box
- `time`: seconds since engine start
- `params`: field color RGBA (from `u_effectParams`)
- Returns: RGBA color. Alpha=0 is transparent. **The shader defines the field's shape via alpha.**

Available uniforms:
```glsl
uniform vec4 u_fieldTransform;    // (posX, posY, rotation, scale)
uniform vec4 u_effectBounds;      // (minX, minY, maxX, maxY)
uniform vec4 u_effectParams;      // field color RGBA
uniform sampler2D u_colorTex;     // field presence data
uniform sampler2D u_stateTex;     // shared state texture
uniform sampler2D u_fieldMask;    // field shape mask (R8)
uniform float u_time;
uniform float u_gridSize;         // 512.0
uniform vec2 u_camera;
uniform vec2 u_resolution;
uniform float u_zoom;
```

### Interaction Effect Shader

```glsl
vec4 interactionEffect(vec2 coord, vec2 regionMin, vec2 regionMax, float time, vec4 params)
```

Same as fieldEffect, plus extra uniforms:
```glsl
uniform vec4 u_fieldAColor;       // RGBA of field A
uniform vec4 u_fieldBColor;       // RGBA of field B
uniform vec4 u_fieldATransform;   // (x, y, rotation, scale) of field A
uniform vec4 u_fieldBTransform;   // (x, y, rotation, scale) of field B
uniform sampler2D u_overlapCount; // R8: field count per pixel
```

Output alpha is multiplied by the overlap mask. If `precedence: true`, underlying field pixels are cleared first.

### State Update Shader

```glsl
vec4 cellUpdate(vec2 coord, vec4 state, vec4 color, float time, float dt)
```

Runs per pixel per frame. Returns new state value (clamped 0-1). Multiple cellUpdate functions have their deltas summed (additive composition).

---

## Shader Utility Library

All shaders have these functions pre-loaded:

### Noise
```glsl
float hash11(float p)           // random [0,1]
float hash21(vec2 p)            // random [0,1] from 2D
vec2 hash22(vec2 p)             // random vec2
float vnoise(vec2 p)            // value noise [0,1]
float gnoise(vec2 p)            // gradient noise [-1,1]
float fbm(vec2 p, int octaves)  // fractal brownian motion (max 8 octaves)
vec2 warp(vec2 p, float strength, float time)  // animated domain warping
```

### SDF Primitives
```glsl
float sdCircle(vec2 p, float r)
float sdBox(vec2 p, vec2 b)
float sdRoundedBox(vec2 p, vec2 b, float r)
float sdSegment(vec2 p, vec2 a, vec2 b)
float sdEquilateralTriangle(vec2 p, float r)
float sdStar(vec2 p, float r, int n, float m)
```

### SDF Operations
```glsl
float opUnion(float d1, float d2)
float opSubtract(float d1, float d2)
float opIntersect(float d1, float d2)
float opSmoothUnion(float d1, float d2, float k)
float opSmoothSubtract(float d1, float d2, float k)
```

### Color & Transform
```glsl
vec3 hsv2rgb(vec3 c)
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d)
mat2 rot2(float angle)
vec2 regionUV(vec2 coord, vec2 regionMin, vec2 regionMax)          // [0,1]
vec2 regionUVCentered(vec2 coord, vec2 regionMin, vec2 regionMax)  // [-1,1]
vec2 regionUVAspect(vec2 coord, vec2 regionMin, vec2 regionMax)    // aspect-corrected [-1,1]
float diffuseLight(vec2 p, vec2 lightPos, float falloff)
vec3 glow(float d, vec3 col, float intensity, float radius)
```

---

## InteractionEffect Options

```json
{
  "type": "add_interaction_effect",
  "fieldA": "field_1_xxx",
  "fieldB": "field_2_xxx",
  "glsl": "vec4 interactionEffect(...) { ... }",
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
