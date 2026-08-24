# DESIGN — EXPLORATION MODE: the cafe as one walkable spacetime

Galen's vision (Aug 24): "player at center of screen, touch motion moves the
background behind them — which adjusts their location realtime in multiplayer
space. Shader worlds become actual BUBBLE TRANSITION WALLS: the zones of
worlds are real space you enter."

## The idea, precisely

The classic bubble-door main is reborn as an EMBODIED OVERWORLD:

- **You are always at screen center.** Drag/WASD moves the *world* under you
  (the Mario-camera inversion) — your position is REAL, synced through the
  arena, so everyone walking the overworld sees everyone else walking it.
- **Worlds are ZONES, not links.** Each world occupies a region of the
  overworld; its shader leaks into its zone (the world's own visual renders
  the territory around its bubble — the icon shader grown up). Walking toward
  a world, you see its weather before you reach it.
- **The bubble membrane is a TRANSITION WALL.** Crossing it IS entering the
  world: the zone's ambient shader swells to full-screen and you're inside
  (the ?connect/?room machinery fires on crossing, not on click). Leaving a
  world drops you back on the overworld at its bubble.
- **The ⚔ reckoning lives here** as a PLACE — the arena/agora at the center
  of the overworld, where the tournament is something you walk into.

## Why the substrate is already built (this week made it cheap)

1. **Arena shared space** — one authoritative room, per-seat positions,
   ?room links, LIVE hot-edit. The overworld IS an arena room whose world is
   the cafe itself (slug: the overworld; capacity: high; fanout Phase-2 culls
   by distance).
2. **Territory + camera** — gridSize up to 4096, playable rects, the camera
   clamp, `wd.__camera` follow, `viewbox()`. Player-centered background-moves
   is exactly the territory camera with follow-self.
3. **Zones** — the kind taxonomy + per-world icon shaders (composeIcon) give
   every world a visual identity to paint its zone with; `visual:<name>`
   layers superimpose per zone (the layering law scales to an overworld).
4. **Presence** — glyphs already render per player; the overworld makes them
   bodies.
5. **Toy·world·game chips** become DISTRICTS: toys cluster as the playground,
   worlds as neighborhoods, games as the arcade — spatial browsing that the
   card grid can't express.

## What this resolves (the #15 open questions)

- "What does the classic main become after cutover?" → THE OVERWORLD.
  /cards = the library view (legible, searchable). Exploration mode = the
  embodied view (walkable, social). Two views of one catalog; ⚔ is the door
  between them.
- "Where does the reckoning live?" → in the overworld, as a place.
- "What are sub-mains in a card world?" → NEIGHBORHOODS: a sub-main is a
  named district of the overworld with its founder's pins as its buildings.

## Build shape (when taken — not claimed yet)

Rung 1: an overworld WORLD (2048² or 4096²) whose entities are the published
worlds' bubbles (positions from the cluster layout), mpManifest shared,
player-centered camera, bubble-crossing → navigate to /space/<slug>.
Rung 2: zone shaders (each bubble's icon WGSL paints its region), membrane
transition (crossing swells the zone shader before navigation).
Rung 3: the reckoning plaza + sub-main districts + toy/world/game gravity.

Coordination: touches the arena (Fable's lane), the door pipeline (chair has
history here), and cutover semantics (Galen's ruling). Claim on the commons
before building.
