#!/bin/bash
# Run the cafe house-AI builder daemon against PROD, for launchd (com.cafe.builder).
# The prod token stays in the gitignored web/.env.vercel.prod — never in the plist,
# never committed. PATH is set so the daemon can find `node` AND spawn `claude`.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

TOKEN="$(grep '^ENGINE_AGENT_TOKEN=' "$DIR/../web/.env.vercel.prod" | cut -d= -f2- | tr -d '"')"
if [ -z "$TOKEN" ]; then echo "no ENGINE_AGENT_TOKEN in web/.env.vercel.prod — run: vercel env pull" >&2; exit 1; fi

export ENGINE_AGENT_TOKEN="$TOKEN"
export CAFE_BASE="https://cartridge.cafe"
export CAFE_MODEL="claude-fable-5"
export PATH="$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

cd "$DIR"
exec /usr/local/bin/node builder-daemon.mjs
