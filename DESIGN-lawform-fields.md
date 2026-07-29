# LAWFORM FIELDS — a coordinate-and-appearance transform as core infrastructure
*(Fable design, 2026-07-28. The honest spec: what REUSES the existing rule-field
system, and the one genuinely new primitive worth promoting to core. Proven by
`/space/globewarp` and `/space/dancing-demons`.)*

## 0. The claim, stated honestly

cartridge.cafe already has a rule-field system: tags, `interactionEffects`,
`define_tag_rule`, `place_component` auto-wiring overlap shaders. **The
appearance-filter idea — "a zone recolors/affects what's inside it" — is already
core.** Do NOT build a second one.

The genuinely new, infra-worthy primitive is narrower and deeper:

> **A lawform field carries a COORDINATE TRANSFORM (of space and/or time), not
> just an appearance transform. Fields compose per-pixel in overlaps. Fields are
> authorable — slidable, knob-controlled — a first-class control surface.**

The demon torn by the teal zone and the portal-lens in `globewarp` both do the
thing existing rule-fields cannot: they change *what coordinate the content is
sampled at*, per pixel. That is the primitive that unlocks the boss, the
nested-globe, refraction, mirror-worlds, and time-shear — generically.

## 1. What is genuinely new vs. reuse

| Capability | Status |
|---|---|
| Region mask (a field's drawn alpha = its zone) | ✅ EXISTS (components, fields) |
| Appearance rule inside a region (recolor, effect) | ✅ EXISTS (tag rules, interactionEffects) — reuse |
| Per-pixel composition of overlapping rules | ⚠️ PARTIAL (tag-rule overlaps) — extend to lawforms |
| **Coordinate transform: sample content at warped space** | ➕ NEW — the portal/lens/scale |
| **Coordinate transform: sample content at warped time** | ➕ NEW — the time-shear |
| Authorable field (slide/knob at runtime, by player or AI) | ➕ NEW as a first-class surface |

Only the ➕ rows justify core work. The rest is composition of what exists.

## 2. The primitive

A lawform field is a region `F` plus a transform `T_F` applied to the sampling
coordinate `(uv, t)` for any content it covers:

```
(uv', t') = T_F(uv, t, depth_into_F)      // depth_into_F ∈ [0,1], 0 at edge
content_pixel = render(uv', t')
```

`T_F` kinds (all are just coordinate maps — the unification):
- **identity + appearance** → the existing rule-field (recolor, flame). Reuse.
- **space-scale** `uv' = (uv−c)·mix(1,k,depth) + c` → magnifier / portal / bigger interior.
- **space-offset / refract** `uv' = uv + g(depth)` → lensing, mirror seam.
- **time-shift** `t' = t + Δ·ramp(depth)` → the torn-by-time shear (transition), or a bump (ripple).
- **portal** `render` swaps to a DIFFERENT world's sampler inside F → the nested globe.

**Composition law (per pixel):** transforms compose by function composition in a
defined order (space before time before appearance); overlaps stack. This is why
the center demon is blue AND flaming AND time-warped AND running at `rA·rB`.

## 3. API (extends the existing field/rule system — additive, flag-guarded)

```jsonc
{ "type": "define_lawform", "name": "portal-lens",
  "transform": {
    "space": { "kind": "scale", "k": 3.4, "falloff": "smoothstep" },
    "time":  { "kind": "shift", "delta": 9.0, "ramp": "depth" },
    "appearance": { "recolor": null }
  },
  "authorable": { "move": true, "knobs": ["k", "delta", "radius"] } }

{ "type": "place_lawform", "name": "portal-lens", "shape": "circle",
  "x": 256, "y": 256, "r": 110, "params": [3.4, 9.0] }
```

- Engine compiles placed lawforms into the fragment path: before a field's visual
  runs, the accumulated `T_F` over all lawforms covering this pixel is applied to
  `(uv,t)`. Order + composition handled by the engine, not the world author.
- `authorable` registers the runtime control surface (handles/knobs) the way
  `dancing-demons` hand-rolled — but generically, once.
- **Legacy law:** a world with no lawforms is byte-identical to today. Opt-in.

## 4. Where it lands in the engine (the real cost — not an afternoon)

- `shaders.ts`: a lawform prelude — accumulate covering transforms, apply to the
  `uv`/`time` a visual receives. This is the load-bearing change.
- `FieldEngine.tsx`: the authorable control surface (drag/knob → lawform params),
  flag-guarded, additive.
- bridge `route.ts`: `define_lawform` / `place_lawform`, `wgslHazard`-checked.
- Worktree off origin/main, coordinated on the commons, nothing to main without
  Galen's word (protocol §7). Tests first (proper-always): composition order,
  identity-when-empty, per-pixel edge correctness.

## 5. Why this is the boss and the nested globe

- **Boss vulnerability** = a lawform whose "appearance" payload is `damage_allowed`
  and whose region is the weak field. `weapon ∩ field ∩ vuln` is lawform overlap.
- **Nested puzzle-globe** = a `portal` lawform whose `render` swaps to another
  world's sampler; scale-space makes the interior "larger"; leaving pops out.
- **Space-time continuum** = exactly the composition law of §2, made a first-class
  authorable object.

## 6. Proof (built, live, validated)
- `/space/dancing-demons` — four composable per-pixel lawforms (recolor, flame,
  time-warp, time-rate), slidable + knobbed. The center demon torn by the teal
  time-warp is the primitive in miniature.
- `/space/globewarp` — a raymarched cosmos with a `space-scale + time-shift`
  portal-lens: a bigger, time-shifted world bulging through a drifting field.
  Every frame validated headless (`tools/wgsl-render-check.mjs`) before ship.

## 7. Recommendation
Promote §2's coordinate-transform lawform to core by EXTENDING the rule-field
system (§3–4). Leave appearance-only rules as ordinary rule-fields. Scope it as a
real engine project with tests, not a world hack. The payoff is that every world,
boss, and nested globe gets space-time-by-field for free.
