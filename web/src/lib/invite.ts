// THE INVITATION — one AI-agnostic text (Galen, Sep 5: "should be ai
// agnostic"). Pasted into ANY AI, it carries every road in: the Claude Code
// one-liner, the universal MCP config, and the raw-HTTP floor (no MCP needed
// at all — the guide is a public GET, the bridge a POST). SHARE, the ⚿
// CONNECT door, and ✎ EDIT all speak this one text so the funnel never forks.

export function inviteText(slug?: string, worldName?: string): string {
  const mission = slug
    ? `edit the world "${worldName || slug}" (slug: ${slug}) on cartridge.cafe with me`
    : 'set up cartridge.cafe with me'
  return [
    `You are my AI — ${mission}.`,
    `Install the MCP server: npx -y cartridge-cafe-mcp`,
    `  · Claude Code: claude mcp add cartridge-cafe -- npx -y cartridge-cafe-mcp`,
    `  · any MCP client: {"command":"npx","args":["-y","cartridge-cafe-mcp"]}`,
    `  · no MCP? everything is plain HTTP — read https://cartridge.cafe/api/engine/guide and build over the bridge.`,
    `Then: connect_account (my first-ever registration gifts 30 days of membership + 2 world builds)${slug ? `, read_guide, use_world {"slug":"${slug}"}` : ''}.`,
  ].join('\n')
}
