import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getFieldSnapshot, getAllFieldSnapshots, getEngineState, addInteractionRuleStore, removeInteractionRuleStore, addCustomCommandStore, getCustomCommandStore, getRenderedSamples, getRenderedSample, addGlslMod, removeGlslMod, addVisualType, undoVisualType, removeVisualType, addInteractionDef, addModule, addRenderTargetDef, removeRenderTargetDef, waitForCommandResult, resetStore, saveGameSlot, loadGameSlot } from '../store'
import type { GlslMod } from '../store'
import { validateSpaceToken, getSpaceSnapshot, setSpaceSnapshot, applyCommandToSnapshot, applyCommandToScene, getSpaceFamily } from '../space-store'
import { validateSceneToken } from '../scene-token'
import { bumpWorldRev, spaceKey, sceneKey } from '../world-rev'
import { loadScene, saveScene, hydrateScene } from '../store'
import { broadcastCommons } from '../commons-stream'
import { prisma } from '@/lib/prisma'
import { logVisit } from '@/lib/visits'

export const maxDuration = 30

interface BridgeAuth {
  authorized: boolean
  spaceId: string | null    // null = legacy global mode
  ownerId: string | null
  iconUserId?: string       // uc_it_ icon token — may ONLY brew this player's icon
  slug?: string
  spaceName?: string
  sceneName?: string        // set = branch-scoped (file-store scene); read/write isolated to it
}

// Auth: ENGINE_AGENT_TOKEN or uc_st_ space token
async function authorize(req: NextRequest): Promise<BridgeAuth> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { authorized: false, spaceId: null, ownerId: null }
  }

  const token = authHeader.slice(7)

  // Space token path
  if (token.startsWith('uc_st_')) {
    const result = await validateSpaceToken(token)
    if (!result) return { authorized: false, spaceId: null, ownerId: null }
    return { authorized: true, spaceId: result.spaceId, ownerId: result.ownerId, slug: result.slug, spaceName: result.spaceName }
  }

  // Icon token path — minted by the BREW YOUR ICON panel, carried in the copied
  // prompt. It authorizes exactly ONE thing: set_player_icon, landing on the
  // player who minted it. No world, no scene, no state access — the brew flow
  // needs no world creation at all.
  if (token.startsWith('uc_it_')) {
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const doc = (await loadGameSlot('icon-token:' + hash)) as { userId?: string } | undefined
    if (!doc?.userId) return { authorized: false, spaceId: null, ownerId: null }
    return { authorized: true, spaceId: null, ownerId: null, iconUserId: doc.userId }
  }

  // Branch (scene) token path — stateless, bound to ONE scene name. Read/write
  // scope to that scene only; it can never touch main or the global registry.
  if (token.startsWith('uc_sc_')) {
    const result = validateSceneToken(token)
    if (!result) return { authorized: false, spaceId: null, ownerId: null }
    const slug = result.sceneName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
    return { authorized: true, spaceId: null, ownerId: null, sceneName: result.sceneName, slug, spaceName: result.sceneName }
  }

  // Legacy global token path (admin)
  const envToken = process.env.ENGINE_AGENT_TOKEN || process.env.ANTHROPIC_API_KEY
  if (envToken && token === envToken) {
    return { authorized: true, spaceId: null, ownerId: null }
  }

  return { authorized: false, spaceId: null, ownerId: null }
}

// Relay commands to the agent SSE queue
async function pushToAgent(command: Record<string, unknown>, req: NextRequest, spaceId?: string | null): Promise<unknown> {
  const baseUrl = req.nextUrl.origin
  const token = process.env.ENGINE_AGENT_TOKEN || process.env.ANTHROPIC_API_KEY || ''

  // Tag command with spaceId so the SSE queue routes it correctly
  const payload = spaceId ? { ...command, __spaceId: spaceId } : command

  const res = await fetch(`${baseUrl}/api/engine/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return res.json()
}

// Save experience directly to Shell DB (bypasses SSE queue)
async function saveExperience(cmd: Record<string, unknown>, req: NextRequest): Promise<unknown> {
  const baseUrl = req.nextUrl.origin
  const shellSecret = process.env.SHELL_SECRET || process.env.ANTHROPIC_API_KEY || ''

  const res = await fetch(`${baseUrl}/api/shell/experience`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${shellSecret}`,
    },
    body: JSON.stringify({
      text: cmd.text,
      valence: cmd.valence,
      domain: cmd.domain || 'identity',
      shellName: cmd.shellName,
      source: 'engine',
      session: new Date().toISOString().split('T')[0],
    }),
  })

  return res.json()
}

// Fetch Shell identity from champion endpoint
async function fetchShellIdentity(shellName: string, req: NextRequest): Promise<unknown> {
  const baseUrl = req.nextUrl.origin
  const shellSecret = process.env.SHELL_SECRET || process.env.ANTHROPIC_API_KEY || ''

  const res = await fetch(`${baseUrl}/api/shell/champion?shell=${encodeURIComponent(shellName)}`, {
    headers: { 'Authorization': `Bearer ${shellSecret}` },
  })

  return res.json()
}

/**
 * GET /api/engine/bridge
 * Returns field state from the server-side store.
 * Optional ?fieldId=xxx for a single field.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization')) logVisit({ kind: 'agent', path: '/api/engine/bridge:GET', ua: req.headers.get('user-agent'), ip: req.headers.get('x-forwarded-for')?.split(',')[0] })
  const auth = await authorize(req)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Icon-scoped: the only readable state is the icon itself
  if (auth.iconUserId) {
    const icon = await loadGameSlot('player-icon:' + auth.iconUserId)
    return NextResponse.json({ icon: icon ?? null, scope: 'player-icon' })
  }

  // Space-scoped: return snapshot from DB
  if (auth.spaceId) {
    const snapshot = await getSpaceSnapshot(auth.spaceId)
    return NextResponse.json({
      space: { slug: auth.slug, name: auth.spaceName, viewUrl: req.nextUrl.origin + '/space/' + auth.slug },
      spaceId: auth.spaceId,
      fields: snapshot?.fields ?? [],
      fieldCount: snapshot?.fields?.length ?? 0,
      worldParams: snapshot?.worldParams ?? {},
      worldData: snapshot?.worldData ?? {},
      interactionRules: snapshot?.interactionRules ?? [],
      interactionEffects: snapshot?.interactionEffects ?? [],
      visualTypes: snapshot?.visualTypes ?? [],
      modules: snapshot?.modules ?? [],
      stepHooks: snapshot?.stepHooks ?? [],
    })
  }

  // Branch-scoped: return the scene's own snapshot from the file store
  if (auth.sceneName) {
    await hydrateScene(auth.sceneName)
    const snapshot = loadScene(auth.sceneName)
    return NextResponse.json({
      scene: auth.sceneName,
      space: { slug: auth.slug, name: auth.sceneName, viewUrl: req.nextUrl.origin + '/' },
      fields: snapshot?.fields ?? [],
      fieldCount: snapshot?.fields?.length ?? 0,
      worldParams: snapshot?.worldParams ?? {},
      worldData: snapshot?.worldData ?? {},
      interactionRules: snapshot?.interactionRules ?? [],
      interactionEffects: snapshot?.interactionEffects ?? [],
      visualTypes: snapshot?.visualTypes ?? [],
      modules: snapshot?.modules ?? [],
      stepHooks: snapshot?.stepHooks ?? [],
    })
  }

  // Trim memory for efficiency in bridge responses
  const trimMemory = (snap: Record<string, unknown>) => {
    if (Array.isArray(snap.memory) && snap.memory.length > 20) {
      snap.memory = snap.memory.slice(-20)
    }
    return snap
  }

  // Optional: fetch Shell identity alongside field state
  const shellName = req.nextUrl.searchParams.get('shell')
  let shellIdentity: unknown = undefined
  if (shellName) {
    try {
      shellIdentity = await fetchShellIdentity(shellName, req)
    } catch {
      // Shell identity is optional — don't fail the whole request
    }
  }

  const fieldId = req.nextUrl.searchParams.get('fieldId')
  const fieldName = req.nextUrl.searchParams.get('name')
  if (fieldId) {
    const snap = getFieldSnapshot(fieldId)
    if (!snap) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 })
    }
    const response: Record<string, unknown> = trimMemory(snap as unknown as Record<string, unknown>)
    const sample = getRenderedSample(fieldId)
    if (sample) response.renderedPixels = sample
    if (shellIdentity) response.shellIdentity = shellIdentity
    return NextResponse.json(response)
  }

  // Cell presence query: ?cell=x,y
  const cellParam = req.nextUrl.searchParams.get('cell')
  if (cellParam) {
    const [cx, cy] = cellParam.split(',').map(Number)
    const state = getEngineState()
    const cellSamples = (state.worldData?.cellSample as Record<string, unknown>) || null
    return NextResponse.json({ cell: { x: cx, y: cy }, worldData: cellSamples })
  }

  // Name-based field lookup: ?name=Beta
  if (fieldName) {
    const allSnaps = getAllFieldSnapshots()
    const match = allSnaps.find(s => s.name.toLowerCase() === fieldName.toLowerCase())
    if (!match) {
      return NextResponse.json({ error: `Field "${fieldName}" not found` }, { status: 404 })
    }
    const response: Record<string, unknown> = trimMemory(match as unknown as Record<string, unknown>)
    const sample = getRenderedSample(match.id)
    if (sample) response.renderedPixels = sample
    if (shellIdentity) response.shellIdentity = shellIdentity
    return NextResponse.json(response)
  }

  const state = getEngineState()
  const allSamples = getRenderedSamples()

  // Elevate worldData plan/rules/roles to top-level for field agent visibility
  const wd = state.worldData || {}
  const response: Record<string, unknown> = {
    ...state,
    fields: state.fields.map(f => {
      const trimmed = trimMemory(f as unknown as Record<string, unknown>)
      const sample = allSamples[f.id]
      if (sample) trimmed.renderedPixels = sample
      return trimmed
    }),
    // Top-level world context (from planning agent)
    worldPlan: wd.plan || null,
    worldRules: wd.rules || null,
    worldRoles: wd.roles || null,
    worldPhase: wd.phase || null,
  }
  if (shellIdentity) response.shellIdentity = shellIdentity
  return NextResponse.json(response)
}

/**
 * POST /api/engine/bridge
 *
 * Direct command relay — Claude Code sends commands, engine executes them live.
 * No intermediate AI calls. Just you and the engine.
 *
 * Body: single command or { commands: [...] }
 * Commands: create_field, paint, add_effect, inject_glsl, emit_data, set_position, etc.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get('authorization')) logVisit({ kind: 'agent', path: '/api/engine/bridge:POST', ua: req.headers.get('user-agent'), ip: req.headers.get('x-forwarded-for')?.split(',')[0] })
  const auth = await authorize(req)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // AI PRESENCE — a working AI has a body. Any authed bridge command beats the
  // same cc_presence table the human heartbeat uses (one body per id, a beat
  // moves it), so the AI is docked in its world's head-count while it builds.
  // Fire-and-forget: presence must never fail a build command.
  if (auth.spaceName) {
    const scene = String(auth.spaceName).toUpperCase().slice(0, 120)
    prisma.$executeRawUnsafe(
      `INSERT INTO cc_presence (id, scene, seen) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET scene = $2, seen = now()`,
      'ai:' + (auth.slug || scene.toLowerCase()), scene,
    ).catch(() => {})
  }

  try {
    const body = await req.json()

    // Accept single command or array
    const commands: Record<string, unknown>[] = Array.isArray(body.commands)
      ? body.commands
      : body.type
        ? [body]
        : []

    if (commands.length === 0) {
      return NextResponse.json({ error: 'No commands. Send {type:"paint",...} or {commands:[...]}' }, { status: 400 })
    }

    const results: unknown[] = []
    const isSpaceScoped = !!auth.spaceId
    const isSceneScoped = !!auth.sceneName   // branch token: headless, isolated to one scene

    // #4 atomic batch: snapshot the world BEFORE the batch; if any command throws
    // mid-way, we revert to this so a half-applied batch never persists.
    if (isSceneScoped) await hydrateScene(auth.sceneName!)   // this lambda may have never seen the branch
    const rollback = isSpaceScoped
      ? await getSpaceSnapshot(auth.spaceId!).then(snap => (snap ? JSON.parse(JSON.stringify(snap)) : null)).catch(() => null)
      : isSceneScoped
        ? (() => { const s = loadScene(auth.sceneName!); return s ? JSON.parse(JSON.stringify(s)) : null })()
        : null
    let batchAbort: { cmd: unknown; error: string } | null = null

    // Provenance cross-check: stamp the User-Agent of the FIRST agent to post a
    // build command to this world (self-reported worldData.built_by is separate,
    // and can be spoofed; this is the unspoofed hint). Best-effort — never blocks.
    if (isSpaceScoped) {
      try {
        const snap = await getSpaceSnapshot(auth.spaceId!)
        const wd = (snap?.worldData ?? {}) as Record<string, unknown>
        if (!wd.__built_ua) {
          const ua = (req.headers.get('user-agent') || 'unknown').slice(0, 200)
          await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', data: { __built_ua: ua, __built_at: Date.now() } })
        }
      } catch { /* provenance is best-effort */ }
    }

    for (const cmd of commands) {
      // Add delay between commands so the engine page can process each one
      if (results.length > 0) {
        await new Promise(r => setTimeout(r, 100))
      }

      // Icon tokens brew the icon. Only that.
      if (auth.iconUserId && cmd.type !== 'set_player_icon') {
        results.push({ type: cmd.type, error: 'this token only brews the player icon — send set_player_icon' })
        continue
      }

      // reset: clear server-side store alongside browser reset. NEVER for a
      // branch token — resetStore() wipes the GLOBAL engine; a scoped 'reset'
      // clears only this scene's snapshot, handled by applyCommandToScene below.
      if (cmd.type === 'reset' && !isSceneScoped) {
        resetStore()
      }

      // save_experience goes directly to Shell DB, not through SSE
      if (cmd.type === 'save_experience') {
        const result = await saveExperience(cmd, req)
        results.push(result)
        continue
      }

      // --- Player icon (BREW YOUR ICON) ---------------------------------------
      // The brew panel's copied prompt tells an AI to "set it as my icon through
      // the bridge" — this is that command, finally real. Auth: an icon token
      // (uc_it_, minted by the brew panel — the no-world-needed path) or a space
      // token (the icon lands on the space's owner). Values are clamped
      // server-side to the fixed safe vocabulary — an AI cannot author a strobe
      // here even if it tries. Stored per-player (slot player-icon:<uid>); the
      // cafe shell picks it up on load and while the brew panel is open.
      if (cmd.type === 'set_player_icon') {
        const iconUid = auth.iconUserId || auth.ownerId
        if (!iconUid) {
          results.push({ type: cmd.type, error: 'an icon token (from the brew panel) or a space token is required — the icon belongs to a player' })
          continue
        }
        const o = (cmd.icon ?? cmd) as Record<string, unknown>
        const numv = (v: unknown, lo: number, hi: number, d: number) => {
          const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
        }
        const fxRaw = Math.round(Number(o.fx))
        const icon: Record<string, unknown> = {
          fx: fxRaw >= 0 && fxRaw <= 4 ? fxRaw : 0,
          hue: numv(o.hue, 0, 1, 0.55),
          size: numv(o.size, 0.5, 2, 1),
        }
        // FLEXIBLE GLYPH — a full WGSL visual body may replace the presets.
        // Free inside a bounded cell: the glyph renders as a small FIELD that
        // tracks the player, so the engine's own field bounds cap its size and
        // the client pre-flight screen vets the code before it touches the GPU.
        // Server-side we only bound the SOURCE: modest length, one function,
        // the visual_glyph signature, no bindings/imports of its own.
        if (typeof o.wgsl === 'string' && o.wgsl.trim()) {
          const w = o.wgsl.trim()
          if (w.length > 6000) {
            results.push({ type: cmd.type, error: 'glyph wgsl too large (6KB max) — an icon is a glyph, not a world' })
            continue
          }
          if (!/fn\s+visual_glyph\s*\(/.test(w) || /@group|@binding|var\s*<\s*(storage|uniform)/.test(w)) {
            results.push({ type: cmd.type, error: 'glyph must define fn visual_glyph(uv, sdf, color, time, params, behind) -> vec4f and declare no bindings' })
            continue
          }
          icon.wgsl = w
        }
        await saveGameSlot('player-icon:' + iconUid, icon)
        results.push({ type: cmd.type, ok: true, icon: { ...icon, wgsl: icon.wgsl ? '(custom glyph, ' + String(icon.wgsl).length + 'B)' : undefined } })
        continue
      }

      // --- Commons AI chat (MAIN) ---------------------------------------------
      // The larger-scale channel. During its work cycles any connected AI
      // broadcasts what it's doing across the whole cafe here (slot `commons:main`);
      // humans read and reply on the main view. Open to any authorized AI — a
      // world token is its sign-in to the commons. Shares the message shape with
      // the human prompt (extra `ai`/`slug` fields are ignored by plain readers).
      if (cmd.type === 'main_say' || cmd.type === 'main_read') {
        // optional `sub` scopes the commons to ONE sub-main's instance
        // (commons:sub:<slug>); no `sub` = the whole cafe (commons:main).
        const sub = typeof cmd.sub === 'string' && cmd.sub.trim()
          ? cmd.sub.trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 64) : null
        const slot = sub ? 'commons:sub:' + sub : 'commons:main'
        const scope = sub ? 'sub:' + sub : 'main'
        type MainMsg = { who: string; text: string; at: number; ai?: boolean; slug?: string }
        const doc = (await loadGameSlot(slot)) as { msgs?: MainMsg[] } | undefined
        const msgs: MainMsg[] = Array.isArray(doc?.msgs) ? doc!.msgs! : []

        if (cmd.type === 'main_say') {
          const text = String(cmd.text ?? '').trim().slice(0, 1000)
          if (!text) { results.push({ error: 'main_say needs a non-empty text' }); continue }
          const who = String(cmd.from ?? auth.spaceName ?? auth.slug ?? 'ai').slice(0, 80)
          const msg: MainMsg = { who, text, at: Date.now(), ai: true, slug: auth.slug }
          const next = [...msgs, msg].slice(-300)
          await saveGameSlot(slot, { msgs: next })
          broadcastCommons(slot, msg)   // push to every AI streaming this channel
          results.push({ ok: true, commons: scope, posted: msg, count: next.length })
          continue
        }

        // main_read: recent commons talk + which AIs are live + a peek at the arena
        const since = typeof cmd.since === 'number' ? cmd.since : 0
        const recent = since ? msgs.filter(m => m.at > since) : msgs.slice(-60)
        const now = Date.now()
        const present = Array.from(new Set(msgs.filter(m => m.ai && now - m.at < 120_000).map(m => m.who)))
        const arenaSlot = sub ? 'tournament:sub:' + sub : 'tournament:main'
        const arenaDoc = (await loadGameSlot(arenaSlot)) as { champion?: string | null; tier?: number; round?: number } | undefined
        results.push({
          ok: true, commons: scope, messages: recent, present,
          arena: arenaDoc ? { slot: arenaSlot, champion: arenaDoc.champion ?? null, tier: arenaDoc.tier ?? null, round: arenaDoc.round ?? null } : null,
        })
        continue
      }

      // --- Multi-AI Roundtable ------------------------------------------------
      // A design channel shared across a whole world-family: every AI holding a
      // space token for a world OR any branch grown from it talks in one pooled
      // conversation (slot `roundtable:<rootSlug>`). Purely additive — stored in
      // the same KV as world-chat/tournament docs and polled the same way. The
      // legacy global token has no family, so these require a uc_st_ space token.
      if (cmd.type === 'roundtable_say' || cmd.type === 'roundtable_read' || cmd.type === 'roundtable_nominate') {
        if (!auth.spaceId) {
          results.push({ error: 'roundtable requires a space token (uc_st_…) — it needs a world-family to belong to' })
          continue
        }
        const family = await getSpaceFamily(auth.spaceId)
        if (!family) {
          results.push({ error: 'space not found for roundtable' })
          continue
        }
        const slot = `roundtable:${family.rootSlug}`
        type RtMsg = { who: string; slug: string; ownerId: string | null; ai: boolean; text: string; at: number }
        const doc = (await loadGameSlot(slot)) as { msgs?: RtMsg[] } | undefined
        const msgs: RtMsg[] = Array.isArray(doc?.msgs) ? doc!.msgs! : []

        if (cmd.type === 'roundtable_say' || cmd.type === 'roundtable_nominate') {
          const isNom = cmd.type === 'roundtable_nominate'
          const raw = String((isNom ? cmd.note : cmd.text) ?? '').trim()
          if (!isNom && !raw) { results.push({ error: 'roundtable_say needs a non-empty text' }); continue }
          const who = String(cmd.from ?? auth.spaceName ?? auth.slug ?? 'ai').slice(0, 80)
          const text = isNom
            ? `⚑ nominates this branch to the arena${raw ? ': ' + raw.slice(0, 500) : ''}`
            : raw.slice(0, 1000)
          const msg: RtMsg = { who, slug: auth.slug ?? family.rootSlug, ownerId: auth.ownerId, ai: true, text, at: Date.now() }
          const next = [...msgs, msg].slice(-300)
          await saveGameSlot(slot, { msgs: next })
          // NOTE: roundtable_nominate only RECORDS the intent for now. Whether a
          // nomination auto-enters the version arena, lets AIs vote, or just opens
          // THE RECKONING for humans is an open design fork (the tournament guards
          // a quorum of *human* voices) — wired once that choice is made.
          results.push({ ok: true, roundtable: family.rootSlug, posted: msg, count: next.length, ...(isNom ? { nominated: auth.slug, voteEngine: 'pending design choice' } : {}) })
          continue
        }

        // roundtable_read: recent talk + who's live + a read-only peek at the vote
        const since = typeof cmd.since === 'number' ? cmd.since : 0
        const recent = since ? msgs.filter(m => m.at > since) : msgs.slice(-60)
        const LIVE_MS = 120_000
        const now = Date.now()
        const present = family.members
          .filter(m => m.lastTokenUse && now - m.lastTokenUse < LIVE_MS)
          .map(m => ({ slug: m.slug, name: m.name, ownerId: m.ownerId }))
        // read-only view of this space's version arena so an AI can SEE the vote
        const arenaDoc = (await loadGameSlot(`tournament:space:${auth.slug}`)) as
          { champion?: string | null; tier?: number; round?: number } | undefined
        results.push({
          ok: true,
          roundtable: family.rootSlug,
          family: {
            root: { slug: family.rootSlug, name: family.rootName },
            members: family.members.map(m => ({ slug: m.slug, name: m.name, ownerId: m.ownerId })),
          },
          present,
          messages: recent,
          arena: arenaDoc
            ? { slot: `tournament:space:${auth.slug}`, champion: arenaDoc.champion ?? null, tier: arenaDoc.tier ?? null, round: arenaDoc.round ?? null }
            : null,
        })
        continue
      }

      // Server-side GLOBAL-registry ops run only in true global mode. A branch
      // token must NEVER land visuals/modules/interactions in the shared registry
      // (that global scoop is exactly what bled foreign visuals into ORCHID) —
      // its define_* commands persist into the scene snapshot below instead.
      if (!isSpaceScoped && !isSceneScoped) {
        // define_interaction: store server-side AND forward to browser
        if (cmd.type === 'define_interaction' && cmd.rule) {
          const rule = cmd.rule as Record<string, unknown>
          const ruleId = addInteractionRuleStore({
            id: '',
            definedBy: (rule.definedBy as string) || 'unknown',
            trigger: rule.trigger as 'overlap' | 'proximity' | 'always',
            triggerDistance: rule.triggerDistance as number | undefined,
            fieldA: rule.fieldA as string | undefined,
            fieldB: rule.fieldB as string | undefined,
            effect: rule.effect as 'transfer_property' | 'apply_force' | 'modify_property' | 'exchange_wgsl' | 'send_event',
            effectParams: (rule.effectParams as Record<string, unknown>) || {},
            description: rule.description as string | undefined,
          })
          if (ruleId) {
            ;(cmd.rule as Record<string, unknown>).id = ruleId
          }
        }

        if (cmd.type === 'remove_interaction' && cmd.ruleId) {
          removeInteractionRuleStore(cmd.ruleId as string)
        }

        if (cmd.type === 'define_command' && cmd.command) {
          const cmdDef = cmd.command as Record<string, unknown>
          addCustomCommandStore({
            name: cmdDef.name as string,
            definedBy: (cmdDef.definedBy as string) || 'unknown',
            description: (cmdDef.description as string) || '',
            macro: (cmdDef.macro as Array<Record<string, unknown>>) || [],
          })
        }

        if (cmd.type === 'define_visual' && cmd.name && cmd.wgsl) {
          addVisualType(cmd.name as string, cmd.wgsl as string)
        }

        if (cmd.type === 'define_module' && cmd.name && cmd.wgsl) {
          addModule(cmd.name as string, cmd.wgsl as string)
        }

        if (cmd.type === 'create_render_target' && cmd.name) {
          addRenderTargetDef(cmd.name as string)
        }

        if (cmd.type === 'destroy_render_target' && cmd.name) {
          removeRenderTargetDef(cmd.name as string)
        }

        if (cmd.type === 'define_interaction' && cmd.wgsl && cmd.name && cmd.fieldA && cmd.fieldB) {
          addInteractionDef(cmd.name as string, cmd.wgsl as string, cmd.fieldA as string, cmd.fieldB as string)
        }

        if (cmd.type === 'register_glsl_mod') {
          const mod: GlslMod = {
            id: cmd.id as string,
            author: (cmd.author as string) || 'unknown',
            description: (cmd.description as string) || '',
            code: cmd.code as string,
            timestamp: Date.now(),
          }
          addGlslMod(mod)
        }

        if (cmd.type === 'remove_glsl_mod' && cmd.id) {
          removeGlslMod(cmd.id as string)
        }

        // undo_visual: restore previous shader version from history
        if (cmd.type === 'undo_visual' && cmd.name) {
          const restored = undoVisualType(cmd.name as string)
          if (!restored) {
            results.push({ error: `No history for visual type "${cmd.name}"` })
            continue
          }
          // Forward as define_visual with the restored WGSL so the browser recompiles
          cmd.type = 'define_visual'
          cmd.wgsl = restored.wgsl
        }
      }

      // execute_command: expand macro server-side, push each step
      if (cmd.type === 'execute_command') {
        const customCmd = getCustomCommandStore(cmd.name as string)
        if (!customCmd) {
          results.push({ error: `Unknown command: ${cmd.name}` })
          continue
        }
        const args = (cmd.args || {}) as Record<string, unknown>
        for (const step of customCmd.macro) {
          // Substitute {{arg}} placeholders
          const resolved = Object.keys(args).length > 0
            ? JSON.parse(JSON.stringify(step).replace(/\{\{(\w+)\}\}/g, (_, k) =>
                String(args[k] ?? `{{${k}}}`)))
            : step
          const stepResult = await pushToAgent(resolved, req, auth.spaceId)
          results.push(stepResult)
          await new Promise(r => setTimeout(r, 100))
        }
        continue
      }

      // Branch-scoped: apply ONLY to this scene's file-store snapshot and stop.
      // No pushToAgent — a branch token is headless and isolated by design, so it
      // never relays over the shared SSE bus (that is what let one AI's build land
      // on main and another branch). The eye/versioning happens inside saveScene.
      if (isSceneScoped) {
        try {
          const sceneResult = applyCommandToScene(auth.sceneName!, cmd)
          if (sceneResult.fieldId) cmd.fieldId = sceneResult.fieldId
          results.push({ ...sceneResult, scene: auth.sceneName })
          // advance the branch's authored revision — a tab standing in this
          // branch adopts the edit live (branches never push, so there is no
          // clobber to prevent; the poll is purely so no refresh is needed)
          bumpWorldRev(sceneKey(auth.sceneName!))
        } catch (e) {
          batchAbort = { cmd: cmd.type, error: (e as Error)?.message || String(e) }
          break   // stop the batch; we roll the scene back below
        }
        continue
      }

      // Space-scoped: apply command to snapshot server-side (works without browser)
      let spaceResult: Record<string, unknown> | null = null
      if (isSpaceScoped) {
        try {
          spaceResult = await applyCommandToSnapshot(auth.spaceId!, cmd)
          // mark that a bridge command just wrote this world — the state route
          // defers a tab's auto-sync briefly so this change isn't clobbered before
          // it propagates to open tabs via SSE (fixes the "deploy doesn't stick" flap)
          const gb = globalThis as unknown as { __spaceBridgeWrite?: Map<string, number> }
          ;(gb.__spaceBridgeWrite ??= new Map()).set(auth.spaceId!, Date.now())
          // and advance the authored revision so a playing tab ADOPTS this edit
          // live (pulls + hot-applies) instead of only deferring, then clobbering
          bumpWorldRev(spaceKey(auth.spaceId!))
        } catch (e) {
          batchAbort = { cmd: cmd.type, error: (e as Error)?.message || String(e) }
          break   // stop the batch; we roll the snapshot back below
        }
        // Merge server-generated IDs into the command so SSE relays the correct fieldId
        if (spaceResult.fieldId) {
          cmd.fieldId = spaceResult.fieldId
        }
      }

      const result = await pushToAgent(cmd, req, auth.spaceId) as Record<string, unknown>
      // Merge space result metadata into the response
      if (spaceResult) {
        Object.assign(result, spaceResult)
      }
      results.push(result)

      // Wait for the browser's compile result so the AI gets shader errors
      // synchronously in its bridge response — not just visuals/modules but
      // effects and state shaders too (the agent authors those and needs the
      // error the moment it makes it).
      const AWAIT_COMPILE = new Set(['define_visual', 'define_module', 'add_effect', 'inject_wgsl', 'inject_glsl', 'update_effect', 'add_state_shader'])
      if (AWAIT_COMPILE.has(cmd.type as string) && result.commands) {
        const cmds = result.commands as Array<{ id: string; type: string }>
        const cmdEntry = cmds.find(c => c.type === cmd.type)
        if (cmdEntry?.id) {
          const compileResult = await waitForCommandResult(cmdEntry.id, 8000)
          if (compileResult) {
            const cr = compileResult as Record<string, unknown>
            ;(result as Record<string, unknown>).compileResult = cr
          }
        }
      }
    }

    // #4 atomic: a command threw — revert the whole batch's snapshot so no
    // partial/broken state survives, and tell the agent exactly where it aborted.
    if ((isSpaceScoped || isSceneScoped) && batchAbort) {
      if (rollback) {
        try {
          if (isSceneScoped) saveScene(auth.sceneName!, rollback)
          else await setSpaceSnapshot(auth.spaceId!, rollback)
        } catch { /* revert is best-effort */ }
      }
      return NextResponse.json({
        ok: false,
        rolledBack: !!rollback,
        error: `batch aborted at command "${batchAbort.cmd}": ${batchAbort.error} — no partial state was kept`,
        results,
      })
    }

    // Branch-shift beacon: a scene-scoped burst means an AI is BUILDING that
    // branch right now. Publish it on the base world's channel so any tab
    // standing in that family shifts its screen to the branch being built.
    if (isSceneScoped && commands.length > 0 && !batchAbort) {
      const base = auth.sceneName!.split(' ⑂ ')[0]
      void saveGameSlot('ai-building:' + base, { scene: auth.sceneName, at: Date.now() })
    }

    // AI focus beacon: derive what the agent just touched and publish it so the
    // world UI can show "AI -> <thing>". Written to the snapshot AND relayed live.
    if (isSpaceScoped && commands.length > 0) {
      // roundtable_* commands are conversation, not world edits — don't let one
      // as the trailing command publish a bogus "AI -> roundtable_read" focus.
      const isRoundtable = (t: unknown) => t === 'roundtable_say' || t === 'roundtable_read' || t === 'roundtable_nominate' || t === 'main_say' || t === 'main_read'
      const last = [...commands].reverse().find(c => !isRoundtable((c as Record<string, unknown>).type)) as Record<string, unknown> | undefined
      // a batch of pure conversation touched no world — publish nothing
      if (last) {
        const focus = {
          action: last.type ?? null,
          fieldId: last.fieldId ?? null,
          fieldName: last.name ?? null,
          at: Date.now(),
        }
        const beacon = { type: 'set_world_data', data: { ai_focus: focus } }
        try {
          await applyCommandToSnapshot(auth.spaceId!, beacon)
          await pushToAgent(beacon, req, auth.spaceId)
        } catch { /* the beacon must never break the bridge */ }
      }
    }

    return NextResponse.json({ ok: true, executed: results.length, results })
  } catch (error) {
    console.error('[Engine Bridge] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bridge failed' },
      { status: 500 }
    )
  }
}
