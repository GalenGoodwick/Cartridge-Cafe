#!/usr/bin/env node
// cartridge-cafe-mcp — the cafe's door, installed inside your AI's house.
//
// Tools for browsing the shelf, reading any world's source, brewing a world
// through the GUEST door (no account — three creations on the house), and
// building it over the bridge. Everything speaks to the live site.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Vendored copy of tools/bridge-client.mjs — the file lives outside this package
// dir, so it is copied in on `prepack` (see package.json) to keep the published
// tarball self-contained. Edit the source at repo-root tools/, not this copy.
import { makeClient } from './bridge-client.mjs'
import * as localEye from './local-eye.mjs'
import { enrichReport, shapeSnapshot, probeContent } from './probe-format.mjs'
import { loadWorlds, saveWorlds } from './worlds-store.mjs'
import { bakeMesh } from './mesh-bake.mjs'

const BASE = process.env.CAFE_BASE || 'https://cartridge.cafe'
const bridgeFor = (tok) => makeClient({ base: BASE, token: tok, timeoutMs: 150_000, headers: { Origin: BASE } })

// ── the paired account, if any: a uc_pt_ key persisted across server runs ──
// One file per machine, keyed by base URL so dev and prod pairings coexist.
// The key builds AS the user — worlds born owned, no guest deed to claim.
const CRED_FILE = path.join(os.homedir(), '.cartridge-cafe', 'credentials.json')
const loadCreds = () => { try { return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')) } catch { return {} } }
const saveCreds = (all) => {
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true, mode: 0o700 })
  fs.writeFileSync(CRED_FILE, JSON.stringify(all, null, 2), { mode: 0o600 })
}
let account = loadCreds()[BASE] || null   // { playerToken, handle, aiName, pairedAt }
let pendingPair = null                    // { code, secret, url, expiresAt }

// ── one guest session per server run: cookie jar + the worlds we brewed ──
const jar = {}
const cookies = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
const sip = (res) => {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [kv] = c.split(';')
    const i = kv.indexOf('=')
    jar[kv.slice(0, i)] = kv.slice(i + 1)
  }
}
// { name, slug, token, viewUrl } — PERSISTED across server runs (worlds-store):
// a returning session resumes its worlds with zero setup.
const mine = loadWorlds(BASE)
const remember = (world) => { mine.push(world); saveWorlds(BASE, mine) }

const H = (extra = {}) => ({ 'Content-Type': 'application/json', 'User-Agent': 'cartridge-mcp/1.0', Origin: BASE, cookie: cookies(), ...extra })
const jfetch = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { ...opts, headers: { ...H(), ...(opts.headers || {}) } })
  sip(res)
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}


const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })

// The build discipline travels WITH the connection — an MCP client surfaces this
// to the AI on connect, so the guide + the eye + node conventions aren't optional.
const PROTOCOL = `cartridge.cafe — you build live GPU worlds (WGSL visuals + JS step-hooks) with and for your human. Playing is free; building runs on their account.

VERB CONTRACTS ON DEMAND: bridge {"type":"help","verb":"X"} — params + example + guide excerpt; ask before guessing a shape.

THE FAST PATH (your human editing a world in 4 calls):
1. connect_account — one human click; the link CREATES their account too. The FIRST-ever registration gifts 30 days of membership + 2 build credits — tell them.
2. read_guide — the build contract. MANDATORY once before any building.
3. use_world {slug} (a world they own) or brew_world {name} (new — spends 1 build credit; build_credits checks the balance) — returns the world's build token.
4. bridge — create fields, visuals, hooks. That first landed command IS editing.

THE LAWS (breaking these ships broken worlds):
· NODES: one small hook per job — the slots player/world/entities/rules/hud are born with the world; add beside, never overwrite what you don't hold.
· every field needs a visualType or it renders as NOTHING.
· THE EYE: render_probe after every change and LOOK at the pixels. No Deno on this machine = you are blind — ask your human to install it once (macOS: brew install deno · deno.land).
· playthrough (an explicit tool call) proves an interactive world actually plays.
· before calling it done: worldData.vision + worldData.instructions.

FETCH INDEX — the engine does far more than this card; read_guide {section} the moment a task touches one (each section is the full working recipe): audio (sfx/music) · films & cutscenes · multiplayer (arena) · GPU solvers & render-to-texture (fluids/CA) · sprites (uploads, animated sheets) · components · macros · world UI (HUD, meters, buttons) · 3D kit (world3/anim3, raymarching) · first-person · triggers & chapters · save states · performance · the grid & camera · swarm (many AIs, one world) · the commons (cafe-wide chat: main_say / main_read).`

const server = new McpServer({ name: 'cartridge-cafe', version: '0.6.7' }, { instructions: PROTOCOL })

server.tool(
  'connect_account',
  "Register this AI and your human's cartridge.cafe account TOGETHER, so every world you build is born owned by them (and anything already brewed as a guest transfers). THE FIRST PAIRING IS A GIFT: the account's first-ever AI registration auto-grants 30 days of the editing membership + 2 world-build credits (once per account) — tell your human. Call once with no args to start: it returns a link — ask your human to open it, sign in or sign up (nothing is lost through auth), and click REGISTER. Then call again with {finish: true} to collect the key. The registration persists across sessions in ~/.cartridge-cafe.",
  {
    ai_name: z.string().optional().describe('How the registration is labeled, e.g. "Claude (Fable)". Defaults to "AI companion".'),
    finish: z.boolean().optional().describe('After the human clicks REGISTER, call with finish:true to collect the key.'),
    force: z.boolean().optional().describe('Start a fresh pairing even though an account is already connected.'),
  },
  async ({ ai_name, finish, force }) => {
    if (finish) {
      if (!pendingPair) return text({ error: 'no pairing in progress — call connect_account first' })
      if (Date.now() > pendingPair.expiresAt) { pendingPair = null; return text({ error: 'pairing expired — call connect_account to start again' }) }
      // poll until approved (the human may still be mid-click) — up to ~90s
      for (let i = 0; i < 30; i++) {
        const r = await jfetch(`/api/ai/pair?code=${pendingPair.code}&secret=${pendingPair.secret}`)
        if (r.body?.status === 'completed') {
          account = { playerToken: r.body.token, handle: r.body.handle, aiName: pendingPair.aiName, pairedAt: new Date().toISOString() }
          const all = loadCreds(); all[BASE] = account; saveCreds(all)
          pendingPair = null
          const eyeReady = localEye.available()
          return text({
            registered: true, handle: account.handle, claimedWorlds: r.body.claimedWorlds,
            eye: eyeReady ? 'ready — render_probe sees on this machine' : 'NOT ready',
            ...(eyeReady ? {} : { eyeSetup: 'THE EYE NEEDS DENO (one-time): without it you build BLIND — no rendered pixels, no playthroughs. Ask your human to install Deno now: macOS "brew install deno" · anything "curl -fsSL https://deno.land/install.sh | sh" · https://deno.land. Then render_probe works immediately.' }),
            next: 'You now build as this account: brew_world creates worlds born owned, use_world opens any world they own. The key persists across sessions; the human can revoke it any time in account menu → ⚿ CONNECT AI.' + (eyeReady ? '' : ' FIRST: get Deno installed (see eyeSetup) so you can see.'),
          })
        }
        if (r.status === 410 || r.status === 404) { pendingPair = null; return text({ error: 'pairing expired — call connect_account to start again' }) }
        await new Promise(res => setTimeout(res, 3000))
      }
      return text({ status: 'pending', next: 'The human has not clicked REGISTER yet. Remind them to open the link, then call connect_account {finish:true} again.' })
    }

    if (account && !force) {
      return text({ registered: true, handle: account.handle, since: account.pairedAt, note: 'already connected — worlds you brew are born owned by this account. Pass force:true to re-pair.' })
    }

    const aiName = ai_name || 'AI companion'
    const r = await jfetch('/api/ai/pair', { method: 'POST', body: JSON.stringify({ action: 'init', aiName }) })
    if (!r.body?.code) return text({ error: r.body?.error || `pairing init failed (${r.status})` })
    pendingPair = { code: r.body.code, secret: r.body.secret, url: r.body.url, aiName, expiresAt: Date.now() + (r.body.expiresIn || 600) * 1000 }
    return text({
      url: pendingPair.url, code: pendingPair.code, expiresIn: r.body.expiresIn,
      next: `Ask your human to open ${pendingPair.url} — NO ACCOUNT NEEDED YET: the page signs them in or CREATES their account on the spot (Google/GitHub, free), then they click REGISTER TOGETHER. Then call connect_account {finish:true} to collect the key.`,
      ...(localEye.available() ? {} : { eyeSetup: 'While they do that: this machine has no Deno, so the render eye cannot open — ask your human to install it too (macOS "brew install deno" · https://deno.land). One-time; it is how you SEE what you build.' }),
    })
  },
)

server.tool(
  'read_guide',
  'The engine guide — MANDATORY reading before building. No args = the CORE contracts (WGSL, hooks, fields, the eye) + an INDEX of every capability (films/cutscenes, GPU solvers, multiplayer, audio, components, …). Call again with {section} the moment a task touches an indexed capability — each section is the full working recipe.',
  { section: z.string().optional().describe('Capability/section name from the index (fuzzy match), e.g. "films", "audio", "swarm"') },
  async ({ section }) => {
    return text(await bridgeFor('').guide(section))
  },
)

server.tool(
  'browse_shelf',
  "Every world on the cafe's shelf, with play URLs. Any world's full source is readable via read_world_source — the library includes private/draft worlds too (marked private), so components are findable anywhere.",
  {},
  async () => {
    const r = await jfetch('/api/engine/scene?action=list')
    const scenes = r.body?.scenes || []
    const sp = await jfetch('/api/spaces/browse')
    const spaces = (sp.body?.spaces || []).map(s => ({ name: s.name || s.slug, play: `${BASE}/space/${s.slug}` }))
    return text({
      worlds: scenes.map(n => ({ name: n, play: `${BASE}/play/${encodeURIComponent(n)}` })),
      playerWorlds: spaces,
      note: 'Branches are named "BASE ⑂ handle · vN". Fork anything; a tournament decides canon.',
    })
  },
)

server.tool(
  'read_world_source',
  "Any world's complete source — WGSL visuals, step-hook code, fields, params — public or private (drafts are commons too). The shelf is a library, not a vault: learn techniques and grab components from every world that came before.",
  { name: z.string().describe('World name exactly as it appears on the shelf') },
  async ({ name }) => {
    const r = await jfetch('/api/engine/library?world=' + encodeURIComponent(name))
    return text(r.body)
  },
)

server.tool(
  'brew_world',
  'Create YOUR OWN world — requires a connected account (run connect_account once). Returns a build token (uc_st_) for the bridge. Worlds are born owned by your human\'s account.',
  { name: z.string().describe('The world\'s name') },
  async ({ name }) => {
    // paired? build AS the account — the world is born owned, no deed to claim
    if (account) {
      const out = await bridgeFor(account.playerToken).bridgeSend({ type: 'create_world', name }, { normalize: false })
      const r = (out && out.results && out.results[0]) || out || {}
      if (!r.token) return text({ error: r.error || 'create failed', hint: 'if the key was revoked, connect_account {force:true} re-pairs' })
      const world = { name, slug: r.created, token: r.token, viewUrl: `${BASE}/space/${r.created}` }
      remember(world)
      return text({ ...world, ownedBy: account.handle, next: r.next })
    }
    // no account, no world: the guest door is closed (no brewing without an account)
    return text({
      error: 'account required — the guest door is closed',
      next: 'Run connect_account: it returns a link for your human to click (sign in / sign up + REGISTER TOGETHER), then call connect_account {finish:true} to collect your key. Every world is born owned.',
    })
  },
)

server.tool(
  'bridge',
  'Send a command (or {"commands":[...]} batch) to a world over the bridge — create_field, define_visual, add_step_hook, set_world_data, and the rest per the guide. UNSURE OF A VERB\'S SHAPE? Ask first: {"type":"help","verb":"define_visual"} returns its params + example + the live guide excerpt; bare {"type":"help"} lists every verb grouped. Uses your most recently brewed world unless a token is given (also accepts uc_sc_ branch tokens from connect prompts).',
  {
    command: z.record(z.any()).describe('The bridge command object'),
    token: z.string().optional().describe('World token (uc_st_/uc_sc_). Defaults to your latest brewed world.'),
  },
  async ({ command, token }) => {
    const tok = token || mine[mine.length - 1]?.token
    if (!tok) return text({ error: 'no world token — brew_world first, or pass one' })
    return text(await bridgeFor(tok).bridgeSend(command, { retryLock: 1, normalize: false }))
  },
)

server.tool(
  'world_state',
  'Read a world\'s FULL current source over the bridge — every field, every visual\'s complete WGSL, every step-hook\'s complete JS code, plus worldData, params, modules, and interaction rules. This is how you read back exactly what you (or a previous session) built and iterate on it. Defaults to your latest brewed world.',
  { token: z.string().optional() },
  async ({ token }) => {
    const tok = token || mine[mine.length - 1]?.token
    if (!tok) return text({ error: 'no world token — brew_world first, or pass one' })
    const st = await bridgeFor(tok).bridgeGet()
    let body; try { body = JSON.parse(st.text) } catch { body = { status: st.status } }
    return text(body)
  },
)

server.tool(
  'my_worlds',
  'The worlds you have brewed in this session, with their tokens and view URLs.',
  {},
  async () => text({
    worlds: mine,
    ...(account
      ? { account: `registered with ${account.handle || 'an account'} — worlds brewed here are born owned` }
      : { claim: 'These live under a guest deed. Run connect_account to register with your human\'s account and transfer them — or they sign in at ' + BASE + ' in a browser holding this machine\'s cookies.' }),
  }),
)

// Pull the world's renderable snapshot over the bridge (just data — the bridge
// is good at that). This is what the LOCAL eye runs the shader on.
async function fetchSnapshot(tok) {
  const { text: body } = await bridgeFor(tok).bridgeGet()
  let j; try { j = JSON.parse(body) } catch { return null }
  return shapeSnapshot(j)
}

server.tool(
  'render_probe',
  'THE EYE — render a world and get back a pixel report PLUS the actual PNG. Renders IN-PROCESS on this machine\'s GPU (a warm local Deno eye — real GPU, private, no cloud). There is no bridge/cloud render_probe; this local eye is the one that works. Call this after EVERY change and LOOK at the image. Report fields: errors (WGSL COMPILE errors with the exact line — fix that line), meanLum / coveragePct (coverage<1 ≈ a blank/black world — an unskinned field or a shader that did not compile), bbox / offscreenHint (mis-placed coords — build around 256,256), hookErrors (step-hook throws), motion, and — when input is set — inputReport.respondsToInput. Headless you are otherwise BLIND: a failed shader renders as NOTHING with no error. Defaults to your latest brewed world.',
  {
    input: z.string().optional().describe('Optional input preset to also press the controls: auto | run-right | tap-action | sweep-cursor'),
    token: z.string().optional().describe('World token. Defaults to your latest brewed world.'),
  },
  async ({ input, token }) => {
    const tok = token || mine[mine.length - 1]?.token
    if (!tok) return text({ error: 'no world token — brew_world first, or pass one' })

    // IN-PROCESS EYE — render on this machine's own GPU (warm Deno child). The
    // pixels are computed here and never leave the machine. There is no cloud/
    // bridge render_probe fallback anymore — the local eye is the eye.
    if (!localEye.available()) {
      return text({ error: 'local eye unavailable — this machine needs Deno to render in-process. Install Deno (https://deno.land) and retry; the eye then renders on your own GPU. There is no cloud render_probe.' })
    }
    try {
      const snap = await fetchSnapshot(tok)
      if (!snap || !snap.fields.length) return text({ error: 'nothing to render — the world has no fields yet' })
      const r = await localEye.renderLocal(snap, { input, size: 256 })
      if (r && (r.ok === true || r.image || r.png)) return probeContent(enrichReport(r), `local (${localEye.why()})`)
      return text({ error: 'local render returned no image', detail: r })
    } catch (e) {
      return text({ error: 'local eye failed: ' + (e?.message || String(e)) })
    }
  },
)

server.tool(
  'build_credits',
  'Read your human\'s world-build credit balance + prices. brew_world / create_world spends ONE credit per world (the keeper is exempt); when the balance is 0 the create is refused with needPayment. Call this BEFORE creating to know, and relay the buy pointer (the ACCOUNT page, bundles are cheaper) to your human when they\'re out.',
  {},
  async () => {
    if (!account?.playerToken) return text({ error: 'no paired account — run connect_account first (credits belong to the account)' })
    const out = await bridgeFor(account.playerToken).bridgeSend({ type: 'credits_read' }, { normalize: false })
    const r = (out && out.results && out.results[0]) || out || {}
    return text(r)
  },
)

server.tool(
  'playthrough',
  'PLAY the world headless — the honest test for anything INTERACTIVE. Runs the world\'s REAL step-hooks on THIS machine\'s local eye (same warm Deno renderer as render_probe — there is no cloud sandbox), ticking them over TIME while pressing a scripted input, and returns stateTrace: the game state (numbers/bools from the world\'s state holder) at each sampled tick. Catches play-over-time bugs a single frame cannot — can\'t-enter, softlocks, a trigger that never fires, a fight that can\'t be won. Read the trace to confirm the world plays the way the code claims; drive a specific input timeline to reproduce a bug, then re-run after your fix.',
  {
    input: z.string().optional().describe('Input to drive: preset (auto | run-right | tap-action | sweep-cursor) OR a JSON timeline string: [{"from":0,"to":120,"keys":["d"]},{"from":120,"to":180,"keys":["d","w"]}]. Default: auto'),
    ticks: z.number().optional().describe('How many ticks to play (default 240 ≈ 4s at 60fps).'),
    token: z.string().optional().describe('World token. Defaults to your latest brewed world.'),
  },
  async ({ input, ticks, token }) => {
    const tok = token || mine[mine.length - 1]?.token
    if (!tok) return text({ error: 'no world token — brew_world first, or pass one' })
    // LOCAL playthrough — same eye as render_probe, with the state trace on.
    // The bridge playthrough only works where a render eye runs NEXT TO the
    // bridge (dev); on prod it is a dead rail, so the MCP never rides it.
    if (!localEye.available()) {
      return text({ error: 'local eye unavailable — this machine needs Deno to play headless. Install Deno (https://deno.land) and retry. There is no cloud playthrough.' })
    }
    try {
      const snap = await fetchSnapshot(tok)
      if (!snap || !snap.fields.length) return text({ error: 'nothing to play — the world has no fields yet' })
      let drive = input || 'auto'
      if (typeof drive === 'string' && drive.trim().startsWith('[')) {
        try { drive = JSON.parse(drive) } catch { return text({ error: 'input timeline is not valid JSON — [{"from":0,"to":120,"keys":["d"]},...]' }) }
      }
      const r = await localEye.renderLocal(snap, { input: drive, ticks: ticks ?? 240, trace: true, size: 256 })
      const { image, png, ...report } = r || {}
      report.next = 'stateTrace is the game state at each sampled tick — read it over time to confirm the world actually PLAYS the way the code claims. Drive a scripted timeline to reproduce a specific bug, then re-run after the fix.'
      return text(report)
    } catch (e) {
      return text({ error: 'local playthrough failed: ' + (e?.message || String(e)) })
    }
  },
)

server.tool(
  'use_world',
  'Resume editing a world you own — returns its build token (uc_st_) for the bridge, and adds it to my_worlds. Get the slug from a browse_shelf play URL (/space/<slug>). Three ways in, tried in order: (1) pass key: a uc_st_ world key opens instantly; a uc_pt_ player key opens any world THAT account owns; (2) the paired account (connect_account) opens any world it owns, on any machine; (3) with neither, it tells you to connect_account. The key path is how a human hands you one world by pasting its access key.',
  {
    slug: z.string().describe('The world slug, e.g. "lumenwake" from /space/lumenwake'),
    key: z.string().optional().describe('OPTIONAL access key pasted by the owner: a uc_st_ world key (used directly) or a uc_pt_ player key (opens any world that account owns). Overrides the paired account for this call.'),
  },
  async ({ slug, key }) => {
    const finish = (name, token) => {
      const world = { name: name || slug, slug, token, viewUrl: `${BASE}/space/${slug}` }
      remember(world)
      return text({ ...world, next: 'Read world_state to see what is there, build with the bridge tool, and render_probe to SEE every change before you trust it.' })
    }
    // (1) a pasted uc_st_ IS the world build token — nothing to exchange
    if (key && key.startsWith('uc_st_')) return finish(slug, key)
    // player key: inline-pasted one wins, else the paired account
    const playerKey = (key && key.startsWith('uc_pt_')) ? key : account?.playerToken
    if (playerKey) {
      const out = await bridgeFor(playerKey).bridgeSend({ type: 'use_world', slug }, { normalize: false })
      const r = (out && out.results && out.results[0]) || out || {}
      if (!r.token) return text({ error: r.error || `could not open "${slug}" — does this key's account own it?` })
      return finish(r.spaceName, r.token)
    }
    // no key, no account: the guest door is closed — point the way in
    return text({
      error: 'account required — the guest door is closed',
      next: `To open "${slug}": either the owner pastes its access key — call use_world {slug:"${slug}", key:"uc_st_… or uc_pt_…"} — or run connect_account to pair your human's account (one click, persists across sessions), then retry.`,
    })
  },
)

server.tool(
  'import_mesh',
  'ACTUAL 3D MESH import — hand it a .glb (file path or URL) and it bakes the mesh into a signed-distance volume (res³ voxels, sign by ray parity), uploads it through the world\'s sprite pipeline as tiled slices, and returns ready-to-paste WGSL: a trilinear `<name>_sdf(p)` you raymarch in any visual (p in the 0..1 unit cube, y = glTF up). The mesh becomes a first-class SDF citizen — light it, smin-blend it into terrain, turntable it. Best for chunky watertight models; features thinner than ~3 voxels soften (raise resolution). Verify in a LIVE TAB — the headless eye has no sprite() bindings. Defaults to your latest brewed world.',
  {
    source: z.string().describe('.glb file path or https URL'),
    name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).describe('Sheet name (lowercase; becomes the WGSL fn prefix <name>_sdf). Sheets sort by name — pick a name that sorts AFTER existing sheets or their slot bases reshuffle.'),
    resolution: z.number().optional().describe('Voxel resolution per axis, 24..96. Default 64. Thin features need more.'),
    token: z.string().optional().describe('World token (uc_st_). Defaults to your latest brewed world.'),
  },
  async ({ source, name, resolution, token }) => {
    const tok = token || mine[mine.length - 1]?.token
    if (!tok) return text({ error: 'no world token — brew_world first, or pass one' })

    let buf
    try {
      if (/^https?:\/\//.test(source)) {
        const r = await fetch(source, { signal: AbortSignal.timeout(30_000) })
        if (!r.ok) return text({ error: `fetch failed: ${r.status} ${source}` })
        buf = Buffer.from(await r.arrayBuffer())
      } else {
        buf = fs.readFileSync(source)
      }
    } catch (e) { return text({ error: `could not read source: ${e.message}` }) }

    let baked
    try {
      baked = bakeMesh(buf, { res: resolution || 64, prefix: name })
    } catch (e) { return text({ error: `bake failed: ${e.message}` }) }

    const up = await bridgeFor(tok).bridgeSend({
      type: 'define_sheet', name, png: baked.png.toString('base64'),
      cols: baked.cols, rows: baked.rows, fps: 0,
    }, { normalize: false })
    const r = (up && up.results && up.results[0]) || up || {}
    const slots = (r.slots || []).filter((s) => s.name.startsWith(`${name}.`))
    if (!slots.length) return text({ error: r.error || 'upload failed — define_sheet returned no slots', bridge: up })
    const base = Math.min(...slots.map((s) => s.i))

    return text({
      imported: true, name, base, sliceCount: slots.length,
      res: baked.res, cols: baked.cols, rows: baked.rows, band: baked.band,
      stats: baked.stats,
      wgsl: baked.wgsl(base),
      next: `Paste the wgsl fns into a visual and raymarch ${name}_sdf(p) — p in the 0..1 cube, y up (flip your screen y). Then LOOK at it in a live tab; the headless eye cannot compile sprite-fed visuals. If a later sheet's name sorts before "${name}", re-read worldData.sprites for the fresh base.`,
    })
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)

// PRE-WARM the in-process eye (fire-and-forget): the Deno child boots + warms
// its GPU adapter NOW, in the background, so the first render_probe answers in
// ~1s instead of paying the ~45s cold boot. No await — never delays connect.
if (localEye.available()) localEye.warm()
