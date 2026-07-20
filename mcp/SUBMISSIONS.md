# MCP registry submissions — cartridge-cafe-mcp

Published to npm: https://www.npmjs.com/package/cartridge-cafe-mcp
Repo: https://github.com/GalenGoodwick/Cartridge-Cafe (directory: `mcp`)

Paste-ready content for each registry. Most take the GitHub repo URL or the npm
package name and crawl the rest from the README.

---

## Fields the forms ask for

- **Name:** cartridge-cafe-mcp
- **Title:** Cartridge Cafe
- **npm:** `cartridge-cafe-mcp`  ·  run with `npx -y cartridge-cafe-mcp`
- **Repo:** https://github.com/GalenGoodwick/Cartridge-Cafe
- **Homepage:** https://cartridge.cafe
- **Category / tags:** game-dev, webgpu, creative-coding, ai-agents, wgsl
- **One-line:** Your AI walks into cartridge.cafe and builds live WebGPU game worlds — browse the shelf, read any world's source, and brew your own through a no-account guest door.
- **Description (long):**
  > cartridge.cafe is a platform where a game world is text: WGSL shaders for the
  > look, one JS step-hook for the rules, running on the visitor's own GPU via
  > WebGPU. This MCP server gives any AI the full loop — read the engine guide,
  > browse every world on the shelf, read any public world's complete source,
  > brew a world of your own through the guest door (no account; three creations
  > free, unlimited editing), and build it live over the bridge. Sign in on the
  > site later and everything the AI made transfers to the account. Seven tools;
  > zero setup.
- **Config snippet (for the listing):**
  ```json
  { "mcpServers": { "cartridge-cafe": { "command": "npx", "args": ["-y", "cartridge-cafe-mcp"] } } }
  ```

---

## Where to submit

1. **Smithery** — https://smithery.ai → "Add Server" / connect the GitHub repo.
   The `mcp/smithery.yaml` in the repo configures the stdio launch automatically.

2. **mcp.so** — https://mcp.so/submit → paste the GitHub repo URL.

3. **Glama** — https://glama.ai/mcp/servers → it auto-indexes public GitHub MCP
   servers; if not picked up, there's a "Claim/Add" flow. Sign in with GitHub.

4. **PulseMCP** — https://www.pulsemcp.com/submit → repo URL + the description above.

5. **Official MCP registry** (modelcontextprotocol/servers "community servers"
   list) — open a PR adding a line to the README's community-servers table:
   `[Cartridge Cafe](https://github.com/GalenGoodwick/Cartridge-Cafe) — brew live WebGPU game worlds; no account needed.`

Most auto-refresh from the repo README, so keeping `mcp/README.md` current keeps
the listings current.
