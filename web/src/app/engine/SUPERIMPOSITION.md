# Superimposition — Field Leak Architecture

## What it is

The uber-shader evaluates all superimposed fields at every pixel in a single compute pass. Fields don't composite independently. Each field can **see what's already been rendered** at the current pixel by previous fields in the loop, via the `behind` parameter.

This creates a pipeline where fields perceive and respond to each other through the shared canvas — not through explicit messaging or interaction rules, but through visual contamination.

## The `behind` parameter

Every visual type function receives a 6th argument:

```wgsl
fn visual_NAME(
  uv: vec2f,        // local UV (-1..1) within field bounds
  sdf: f32,         // signed distance to field boundary
  color: vec4f,     // field's base color
  time: f32,        // frame time in seconds
  params: vec4f,    // 4 custom parameters from visualParams
  behind: vec4f,    // rgb + alpha of everything already rendered at this pixel
) -> vec4f
```

`behind.rgb` is the accumulated color from all earlier fields in the array.
`behind.a` is the accumulated presence (alpha).

When `behind.a == 0.0`, nothing has been rendered here yet — this field is painting on empty canvas. When `behind.a > 0.0`, another field is already present, and this field can see its output.

## How the loop works

```
resultColor  = vec3(0)
resultPresence = 0

for each field:
    behind = vec4(resultColor, resultPresence)     // what's already here
    visual = visual_TYPE(uv, sdf, color, time, params, behind)

    if visual.a > 0.01:
        resultColor    = visual.rgb                 // overwrite color
        resultPresence = max(resultPresence, visual.a)  // keep strongest alpha
```

Key asymmetry: **color overwrites, alpha accumulates**. This is intentional. It means:

- The last field's color wins, but any field's alpha can dominate
- A dim field rendered after a bright one inherits the bright one's opacity
- At overlap boundaries, neither field fully owns the pixel

## The leak

When field A (alpha=1.0) is followed by field B (alpha=0.3 at its edge):

- `resultColor` = B's color (A's is gone)
- `resultPresence` = max(1.0, 0.3) = 1.0 (A's alpha survives)
- Final pixel: **B's color at A's opacity**

Field A's presence "ghost-writes" field B's compositing. This is not a bug — it's a structural property of separating color and alpha into independent operations on coupled output.

## Using `behind` intentionally

A visual type that ignores `behind` behaves normally — it doesn't know or care about other fields. But a visual type that reads `behind` can:

### React to presence

```wgsl
// Glow brighter where another field is already present
let boost = behind.a;
return vec4f(color.rgb * (1.0 + boost * 2.0), a);
```

### Blend with what's underneath

```wgsl
// Mix with the field behind instead of overwriting
let c = mix(behind.rgb, myColor, 0.5);
return vec4f(c, a);
```

### Create interference

```wgsl
// Treat both as waves, constructive/destructive interference
let wave_self = myColor * 2.0 - 1.0;    // remap 0..1 to -1..1
let wave_behind = behind.rgb * 2.0 - 1.0;
let interference = (wave_self + wave_behind) * 0.5 + 0.5;  // back to 0..1
return vec4f(interference, a);
```

### Dodge / avoid

```wgsl
// Become transparent where another field exists
if (behind.a > 0.5) { return vec4f(0.0); }
return vec4f(color.rgb, a);
```

### Echo / shadow

```wgsl
// Render the behind field's color with your own shape
if (behind.a > 0.01) {
    return vec4f(behind.rgb * 0.5, a);  // dim echo
}
return vec4f(color.rgb, a);
```

## Order matters

Field evaluation order is determined by array position in the `superFields` storage buffer, which follows the order fields were created. Reordering changes which field sees which `behind` value.

- Field 0: always sees `behind = vec4(0, 0, 0, 0)` — empty canvas
- Field 1: sees field 0's output (if present at this pixel)
- Field N: sees the accumulated result of fields 0..N-1

This is a **pipeline**, not a graph. Information flows in one direction: earlier fields influence later ones, never the reverse. Field 0 can never see field 1.

## Relationship to interaction effects

The `behind` leak is implicit — it happens automatically for any overlapping fields. Interaction effects (`dispatchInteraction`) are explicit — they require a defined interaction type and replace both fields' visuals at overlap pixels.

Both systems coexist. The `behind` leak happens during field evaluation (the loop). Interaction effects happen after the loop, potentially overriding the leaked result.

## Philosophy

Traditional compositing treats each layer as independent: compute all layers, then blend. Superimposition breaks this by making each layer aware of what came before. The canvas has memory.

This means fields don't just coexist in space — they **perceive** each other through the medium they share. A field painted over another carries traces of what was there. The overlap is not a blend of two independent outputs but a response to presence.
