# cartridge.cafe

Little worlds, served as single files. Brewed by people and their AIs.

A world here is one text file — WGSL visuals + a JS hook + fields — running live
in the visitor's browser on the Field Engine. Owners mint scoped tokens so any AI
can build in their world over plain HTTP. Save points are append-only; remixes
carry lineage.

## Run

```
cd web
npm install
cp .env.example .env.local   # fill in
npx prisma db push
npm run dev
```

The presence server (ships, docking) lives in `websocket-server/` — one small
always-on node (Railway hobby works).

## Map

- `/` — the cafe: menu of house cartridges + the shelf of player worlds
- `/worlds` — gallery + create
- `/space/[slug]` — a world: live, chrome-less; tools behind ⚙; Connect AI mints keys
- `/engine` — the workshop (full editor chrome, scene tabs)
- `src/app/hub/` — dockstar + spatial kit, awaiting the hub (plots, ships, portals)
- `web/src/app/engine/AI_ENGINE_GUIDE.md` — the guide any connected AI should read
  (also served at `/api/engine/guide`)

## Coming

Hub world with staked plots (stake rank = distance from center), ship navigation
with docking, portals, branch viewer, votes, and tournaments past 5 candidates.
Stake source is pluggable: points first, $CART (Solana) when it launches.
