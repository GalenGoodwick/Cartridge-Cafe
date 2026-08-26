# SPRITE PIPELINE — the MAP (node law: claimed nodes, owned files)

Galen, Aug 26 (post-Fortis): "lets work on the sprite pipeline and ui for sprite
viewing/upload to rip. also we need animated sprite sheet uploads."

Design (rides the sibling's rung-3 spec + the iconBuf discovery): the super bind
group is AT the 8-storage-buffer WebGPU cap, so sprites ride `iconBuf` — the
existing RGBA8-in-u32 storage buffer bound to every visual. A world is either
the cafe hub (icon bubbles in iconBuf) or a player world (its SPRITE ATLAS in
iconBuf); never both. Contiguous per-sprite pixels + a rect header — no 2D
packing. Upload path = the existing `uploadIconAtlas()` (grows buffer,
invalidates bind group).

Atlas layout: `[0]=count · [1+i*4..]=rect{offset,w,h,flags} · then pixels row-major`.

| node | owns | state |
|---|---|---|
| spr-wgsl | shaders.ts: sprCount/spriteSize/sprite/spriteAnim | claimed: opus |
| spr-store | lib/sprite-store.ts (slot `sprites:<spaceId>`, limits) | claimed: opus |
| spr-api | api/spaces/[slug]/sprites (GET public · POST/DELETE owner) | claimed: opus |
| spr-bridge | bridge: define_sprite / define_sheet / list_sprites / delete_sprite | claimed: opus |
| spr-loader | FieldEngine: fetch+decode+pack → uploadIconAtlas on wd.sprites.rev | claimed: opus |
| spr-panel | SpritesPanel.tsx (upload · view · RIP grid · anim preview) | claimed: opus |
| spr-guide | AI_ENGINE_GUIDE.md section | claimed: opus |
| spr-eye | render-service atlas support (cloud probe sees sprites) | OPEN — flagged blind spot |

Metadata (syncs, non-dunder so hot-swap carries it): `worldData.sprites =
{rev, slots:[{name,i,w,h,sheet}], clips:[{name,first,n,fps}]}` — pixels never
enter worldData (slot store only).

Sheet RIP: `define_sheet {name, png, cols, rows, fps?}` slices into cols×rows
slots (`name.0..n-1`) + registers a clip when fps given. Caps: ≤64 sheets/world,
≤4096 slots, ≤8M px total (32MB atlas).
