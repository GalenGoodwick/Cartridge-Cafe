# Porting worlds from local → live

Two kinds of world, two different paths. Know which one you built.

| World type | Lives in | Ported by |
|---|---|---|
| **House / shelf worlds** (CAFE, ESPER, NOCTURNE DISTRICT, TV, the minis, branches) | `.engine-store.json` (git-tracked) → bundled to `public/cartridges/*.json` | `git push` |
| **Player spaces** (brewed worlds at `/space/<slug>`) | Neon Postgres | See "Player spaces" below — **prod ≠ local DB** |

Almost everything you build by editing the engine (cartridge scripts, the AI
bridge in dev) is a **house world**. Those ship with git. Player spaces are the
exception.

---

## House worlds — the normal path

Everything you edit locally is written into `.engine-store.json` (the live
world store). The `/play/<name>` route and the door serve from the static
`public/cartridges/*.json` bundles, so a deploy = get the bundles current, then
commit + push.

### 1. See what changed (diff)

The store JSON is one 1MB minified blob — `git diff` on it is unreadable. Diff
the **bundles** instead; they're one file per world:

```bash
node rebuild-bundles.mjs                 # regenerate bundles from the store
git status --short public/cartridges/    # which worlds changed
git diff --stat public/cartridges/       # + how big each change is
```

`rebuild-bundles.mjs` rewrites every `public/cartridges/<NAME>.json` from the
store and refreshes `index.json`. After running it, the working tree shows
exactly which worlds differ from what's committed (= what's live).

To eyeball one world's actual change (minified, but greppable):

```bash
git diff public/cartridges/"NOCTURNE DISTRICT".json
```

### 2. Ship it

```bash
node rebuild-bundles.mjs                 # (if you haven't already)
git add -A
git commit -m "..."
git push origin main                     # → Vercel builds & deploys
```

The commit carries both `.engine-store.json` (the door's shelf, force-included
into the serverless bundle via `next.config.ts`) and the bundles (what `/play`
serves). Vercel's build runs `prisma generate && next build`.

### 3. Verify it went live (not just green)

```bash
# the door has its shelf?
curl -s "https://cartridge.cafe/api/engine/scene?action=list" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['scenes']),'worlds')"
# a specific world serves its current bundle?
curl -s "https://cartridge.cafe/play/ESPER" -o /dev/null -w "%{http_code}\n"
```

---

## Player spaces — the catch

**Production and local use different Neon databases.** A world you brew locally
lives only in your local Neon; it will NOT appear on live, and vice versa.
They are not git-tracked (they're DB rows, not files).

Options, simplest first:

1. **Re-brew it on live.** Fastest for a one-off — brew the world at
   cartridge.cafe directly.
2. **Promote it to a house world.** If it's good enough to be permanent, save
   it into the store as a named scene (so it ships with git like any shelf
   world) instead of leaving it a player space.
3. **Copy the DB row** (advanced). Needs prod's `DATABASE_URL` from the Vercel
   dashboard. Copy the `PlayerSpace` row + its `snapshot` (and any
   `SpaceVersion` rows) from local Neon → prod Neon. Only worth it to move an
   already-built space you can't easily re-brew.

---

## Save-slot state (tournaments, sub-mains, bubble layout, game saves)

Lives in the Neon `EngineSlot` table (self-creates on first use — see
`store.ts`). Also **per-database**, so local and prod accumulate their own
tournament/group/layout state. This is intentional: prod is its own world. There
is nothing to port here — it fills in as players use the live site.
