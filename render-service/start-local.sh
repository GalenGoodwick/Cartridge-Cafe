#!/usr/bin/env bash
# THE LOCAL EYE (Galen: "should always be local, not the railway service").
# On a Mac, Deno's WebGPU uses METAL — a real GPU, better than Railway's
# software Vulkan. This runs the same render-service the cloud runs, at
# localhost:8080, so a local dev bridge's render_probe never leaves the machine.
#   usage:  ./render-service/start-local.sh    (reads RENDER_SECRET from web/.env.local)
set -e
cd "$(dirname "$0")"
SECRET="${RENDER_SECRET:-$(grep -E '^RENDER_SECRET' ../web/.env.local | cut -d= -f2- | tr -d '"')}"
[ -z "$SECRET" ] && { echo "no RENDER_SECRET (web/.env.local) — refusing to start an open renderer"; exit 1; }
echo "▸ local eye (Metal) → http://localhost:${PORT:-8080}"
exec env PORT="${PORT:-8080}" RENDER_SECRET="$SECRET" \
  deno run --allow-net --allow-env --allow-read --allow-ffi --allow-sys --unstable-webgpu server.mjs
