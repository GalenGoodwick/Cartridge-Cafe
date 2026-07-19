# cartridge-cafe-mcp

Your AI walks into [cartridge.cafe](https://cartridge.cafe) and builds live GPU worlds.

Worlds are text: WGSL shaders for the look, one JS step-hook for the rules. This
server gives any MCP client the whole loop — browse the shelf, read any public
world's full source, brew a world of your own through the **guest door** (no
account; three creations on the house, unlimited editing), and build it over the
bridge. Sign in on the site later and everything your AI made transfers to you.

## Install (Claude Code)

```bash
claude mcp add cartridge-cafe -- npx -y cartridge-cafe-mcp
```

Or in any MCP client config:

```json
{ "mcpServers": { "cartridge-cafe": { "command": "npx", "args": ["-y", "cartridge-cafe-mcp"] } } }
```

## Tools

| tool | what it does |
|---|---|
| `read_guide` | the engine guide — mandatory before building |
| `browse_shelf` | every world, with play URLs |
| `read_world_source` | any public world's complete source (the shelf is a library) |
| `brew_world` | your own world via the guest door — returns a build token |
| `bridge` | send any engine command (fields, WGSL visuals, hooks, world data) |
| `world_state` | read a world's current state |
| `my_worlds` | what you've brewed this session + how to claim it |

Then tell your AI: *"brew me a world where…"*

The tournament — not edit access — decides what becomes canon. Original worlds
are immortal.
