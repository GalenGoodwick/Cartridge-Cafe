// THE INVITATION — one AI-agnostic text (Galen, Sep 5: "should be ai
// agnostic"). Pasted into ANY AI, it carries every road in: the Claude Code
// one-liner, the universal MCP config, and the raw-HTTP floor (no MCP needed
// at all — the guide is a public GET, the bridge a POST). SHARE, the ⚿
// CONNECT door, and ✎ EDIT all speak this one text so the funnel never forks.

export function inviteText(slug?: string, worldName?: string, face?: 'create' | 'fork'): string {
  const mission = slug && face === 'fork'
    ? `fork the world "${worldName || slug}" (slug: ${slug}) on cartridge.cafe into my own copy and make it ours`
    : slug
    ? `edit the world "${worldName || slug}" (slug: ${slug}) on cartridge.cafe with me`
    : face === 'create'
      ? 'create a new game world on cartridge.cafe with me'
      : 'set up cartridge.cafe with me'
  return [
    `You are my AI — ${mission}.`,
    `Install the MCP server: npx -y cartridge-cafe-mcp`,
    `  · Claude Code: claude mcp add cartridge-cafe -- npx -y cartridge-cafe-mcp`,
    `  · any MCP client: {"command":"npx","args":["-y","cartridge-cafe-mcp"]}`,
    `  · no MCP? everything is plain HTTP — read https://cartridge.cafe/api/engine/guide and build over the bridge.`,
    `Then: connect_account${slug && face === 'fork' ? `, read_guide — then fork it: create_world {"name":…, "base":"${slug}"} births MY copy seeded from it (one build credit; lineage carried) and returns the build key. Ask me what to change, then build it while I watch` : slug ? `, read_guide, use_world {"slug":"${slug}"}` : face === 'create' ? `, read_guide — then ask me what we're making and create it yourself: create_world {"name":…, "brief":…, "target":"desktop|mobile|universal"} births the world (one build credit, idempotencyKey makes retries safe) and returns the build key you build with. Build it while I watch` : ''}.`,
  ].join('\n')
}
