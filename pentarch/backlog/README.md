# backlog — the PENTARCH v1 night, frozen

The first night proved every mechanic in isolation, then proved the anti-pattern
(one hook accreted by patching becomes unownable). This is the reference archive
the rebuild ports FROM. It is not wired into the build and is not run in CI —
`tests/` here read `/tmp/shipyard-parts.json` under Deno and stay as-is.

```
parts/       v9-parts.json          the LIVE designer v9 hook (.hook) + visual (.vis) — designer's source of truth
             arena-v1-parts.json    the v1 arena combat hook/vis
cartridges/  *-cartridge.mjs        full world cartridges (hook+vis+fields) as shipped
tests/       yard-*-test.mjs        local hook-replay tests (Deno + /tmp) — behavior spec to port
             yard-sim.mjs           the fake-sim harness (port to pentarch/test/harness.mjs, Node)
             yard-script.mjs        scripted playtest clicks
push/        push-yard-update.mjs   the bridge push helper (Deno) — reference for build.mjs --push
```

Living foundation (NOT backlog — kept, tested, imported by the build) sits one
level up: `penta-core.mjs` (+`.test.mjs`), `penta-holes.mjs`, `penta-hunt.mjs`,
`penta-specimens.json`. See `../CONTRACT.md` and `../STRUCTURE.md`.
