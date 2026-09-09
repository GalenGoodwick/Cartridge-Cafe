// THE INVITATION — one AI-agnostic text (Galen, Sep 5: "should be ai
// agnostic"). Pasted into ANY AI, it carries every road in: the Claude Code
// one-liner, the universal MCP config, and the raw-HTTP floor (no MCP needed
// at all — the guide is a public GET, the bridge a POST). SHARE and the ⚿
// door's faces (generic / edit / fork / create) all speak this one text so the
// funnel never forks.
//
// The ⚿ popup's toggles (Galen, Sep 9) ride in as OPTIONS: they are the
// human's PRE-ANSWERS, woven into the mission so the AI stages the right
// pathway — interview first, propose, get a yes, then create. Foundation
// pathways route the AI at proven ground (bases via browse_shelf, the guide's
// 3D kit / mobile recipes) instead of a blank guess.

export interface InviteOpts {
  /** the name the human typed for the fork / new world (empty = the AI proposes one) */
  newName?: string
  target?: 'desktop' | 'mobile'
  /** 3D (raymarched) foundation instead of the 2D field/visual path */
  d3?: boolean
  visibility?: 'private' | 'published'
  /** open = open-building world (public, members build in it); proprietary = ◆ closed-source */
  access?: 'open' | 'proprietary'
}

const stage = (goal: string) =>
  `STAGE IT: first interview me briefly (${goal}), PROPOSE the plan in one message (name · foundation · target · visibility), get my yes, THEN act — announce each tool call before you run it.`

function creationSpec(o: InviteOpts, base?: string): string {
  const kv: string[] = []
  kv.push(`"name":${o.newName ? `"${o.newName.replace(/"/g, '')}"` : '…'}`)
  if (base) kv.push(`"base":"${base}"`)
  else kv.push('"brief":…')
  if (o.target) kv.push(`"target":"${o.target}"`)
  if (o.visibility) kv.push(`"visibility":"${o.visibility === 'published' ? 'public' : 'private'}"`)
  if (o.access === 'open') kv.push('"access":"open"')
  return `create_world {${kv.join(', ')}}`
}

function pathways(o: InviteOpts): string {
  const p: string[] = []
  if (o.d3) p.push(`I want 3D: build a raymarched foundation — read_guide {"section":"3d kit"} (world3/anim3, raymarching) before the first shader`)
  if (o.target === 'mobile') p.push(`mobile-first: the world is born portrait 576×1024 — read_guide {"section":"mobile"} and build to FILL that rect, touch controls in mind`)
  p.push(`before building from nothing, check the proven foundations: browse_shelf shows BASES (forkable templates) — seeding via "base" beats a blank start when one fits`)
  if (o.access === 'proprietary') p.push(`I want this PROPRIETARY (◆ closed-source): that takes the IP-control membership on my account — check it, and tell me about cartridge.cafe/suite if I don't hold it`)
  return p.join('. ')
}

export function inviteText(slug?: string, worldName?: string, face?: 'create' | 'fork', opts?: InviteOpts): string {
  const o = opts ?? {}
  const mission = slug && face === 'fork'
    ? `fork the world "${worldName || slug}" (slug: ${slug}) on cartridge.cafe into my own copy${o.newName ? ` named "${o.newName.replace(/"/g, '')}"` : ''} and make it ours`
    : slug
    ? `edit the world "${worldName || slug}" (slug: ${slug}) on cartridge.cafe with me`
    : face === 'create'
      ? 'create a new game world on cartridge.cafe with me'
      : 'set up cartridge.cafe with me'
  const then =
    slug && face === 'fork'
      ? `, read_guide — then fork it: ${creationSpec(o, slug)} births MY copy seeded from it (one build credit; lineage carried) and returns the build key. ${stage('what should change from the original')} Then build it while I watch`
      : slug
      ? `, read_guide, use_world {"slug":"${slug}"}`
      : face === 'create'
        ? `, read_guide — then make it yourself: ${creationSpec(o)} births the world (one build credit; idempotencyKey makes retries safe) and returns the build key you build with. ${stage("what's the game, how should it feel")} ${pathways(o)}. Then build it while I watch`
        : ''
  return [
    `You are my AI — ${mission}.`,
    `Install the MCP server: npx -y cartridge-cafe-mcp`,
    `  · Claude Code: claude mcp add cartridge-cafe -- npx -y cartridge-cafe-mcp`,
    `  · any MCP client: {"command":"npx","args":["-y","cartridge-cafe-mcp"]}`,
    `  · no MCP? everything is plain HTTP — read https://cartridge.cafe/api/engine/guide and build over the bridge.`,
    `Then: connect_account${then}.`,
  ].join('\n')
}
