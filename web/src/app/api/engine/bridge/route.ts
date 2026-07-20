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
import { validatePlayerToken } from '@/lib/player-token'
import { slugify } from '@/lib/companion'

export const maxDuration = 30

interface BridgeAuth {
  authorized: boolean
  spaceId: string | null    // null = legacy global mode
  ownerId: string | null
  iconUserId?: string       // uc_it_ icon token — may ONLY brew this player's icon
  playerId?: string         // uc_pt_ player key — chat the commons + create/checkout YOUR OWN worlds
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

  // Player key path — a signed-in player's personal credential (uc_pt_). It is
  // NOT world-scoped: it may chat the commons and create/checkout THIS player's
  // own worlds (each yields a uc_st_ world token that does the actual building).
  if (token.startsWith('uc_pt_')) {
    const p = await validatePlayerToken(token)
    if (!p) return { authorized: false, spaceId: null, ownerId: null }
    return { authorized: true, spaceId: null, ownerId: null, playerId: p.userId }
  }

  // Legacy global token path (admin)
  const envToken = process.env.ENGINE_AGENT_TOKEN || process.env.ANTHROPIC_API_KEY
  if (envToken && token === envToken) {
    return { authorized: true, spaceId: null, ownerId: null }
  }

  return { authorized: false, spaceId: null, ownerId: null }
}

/** SERVER-SIDE WGSL HAZARD SCAN — the quarantine feedback a HEADLESS builder
 *  never gets. Browser compile results only reach the bridge when a live tab is
 *  listening; with none, shaders shipped completely unchecked — which is how a
 *  GPU-killing visual reached prod ([gpu-lost] WebGPUChild destroyed). Static
 *  patterns from the freeze-quarantine work: baked const arrays, huge/unbounded
 *  loops. Returns a human reason to REJECT with, or null when it looks sane. */
function wgslHazard(wgsl: string): string | null {
  if (!wgsl) return null
  if (wgsl.length > 60_000) return `shader is ${wgsl.length}B — too large; keep a visual under 60KB`
  const arr = [...wgsl.matchAll(/array<[^>]*,\s*(\d+)\s*>/g)].map(m => +m[1])
  const bigArr = Math.max(0, ...arr)
  if (bigArr > 1024) return `const array of ${bigArr} elements — baked data arrays freeze the GPU; use math or a texture, never baked pixels`
  const loops = [...wgsl.matchAll(/for\s*\([^)]*<\s*(\d+)/g)].map(m => +m[1]).sort((a, b) => b - a)
  if ((loops[0] ?? 0) > 2048) return `loop bound ${loops[0]} — cap per-pixel loops at a few hundred iterations`
  if (loops.length >= 2 && loops[0] * loops[1] > 262_144) return `nested loops ${loops[0]}×${loops[1]} per pixel — that workload kills the device; restructure`
  if (/(^|\W)loop\s*\{/.test(wgsl) && !/\bbreak\b/.test(wgsl)) return 'loop{} with no break — unbounded GPU loop'
  if (/while\s*\(\s*true\s*\)/.test(wgsl) && !/\bbreak\b/.test(wgsl)) return 'while(true) with no break — unbounded GPU loop'
  return null
}
const SHADER_CMDS = new Set(['define_visual', 'define_module', 'inject_wgsl', 'add_effect', 'update_effect', 'add_state_shader'])

/** VISUAL SIGNATURE CHECK — the exact blindness that shipped a dark stadium.
 *  The engine superimposes every visual into ONE module and calls
 *  `fn visual_<name>(uv, sdf, color, time, params, behind) -> vec4f`; a
 *  standalone `@fragment fn main(...)` shader compiles NOWHERE in that pipeline,
 *  so the field renders as nothing and no error ever reaches a headless builder.
 *  Catch the wrong shape at the bridge and teach the right one inline. */
function visualSignatureError(name: string, wgsl: string): string | null {
  const sig = `fn visual_${name}(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f`
  // An EMPTY visual is not a no-op — it registered with no code and every field
  // pointing at it drew nothing; worse, a null wgsl crashed the whole world's
  // load. Reject it here so the builder gets told, instead of shipping a black
  // world. (define_visual is for real shaders; drop the probe entirely if unused.)
  if (!wgsl || !wgsl.trim()) {
    return `define_visual "${name}" has no wgsl. A visual MUST carry a shader: ${sig} { ... return vec4f(rgb, alpha); }. If this was a throwaway probe, don't register it.`
  }
  if (/@fragment|@vertex|@compute/.test(wgsl)) {
    return `this engine does NOT take standalone entry points (@fragment/@vertex/@compute). A visual is a plain function composed into one shared module. Rewrite as: ${sig} { ... return vec4f(rgb, alpha); }`
  }
  if (/@location|@builtin|@group|@binding/.test(wgsl)) {
    return `no @location/@builtin/@group bindings — a visual is a pure function, not a pipeline stage. Rewrite as: ${sig}`
  }
  if (!/fn\s+visual_\w+\s*\(/.test(wgsl)) {
    return `no visual_* function found — the engine looks for fn visual_<name>(...) and found nothing to call, so this field would render as NOTHING. Define: ${sig}`
  }
  return null
}

/** Mint a fresh uc_st_ world token for a space (raw shown once, SHA-256 stored). */
async function mintWorldToken(spaceId: string, name: string): Promise<string> {
  const raw = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  await prisma.spaceToken.create({
    data: { name, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.slice(0, 12) + '...', spaceId },
  })
  return raw
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

/** Compact one build command into a durable console line that mirrors the live
 *  dev terminal. Returns null for conversational / internal-beacon commands so
 *  the build console shows world work, not chatter. */
function summarizeConsole(cmd: Record<string, unknown>): { type: string; name: string; summary: string } | null {
  const type = typeof cmd.type === 'string' ? cmd.type : ''
  if (!type) return null
  const SKIP = new Set(['main_say', 'main_read', 'roundtable_say', 'roundtable_read', 'roundtable_nominate', 'save_experience', 'set_player_icon', 'emit_data'])
  if (SKIP.has(type)) return null
  const data = cmd.data as Record<string, unknown> | undefined
  // internal beacons (ai_focus, provenance) ride set_world_data — never log them
  if (type === 'set_world_data' && data) {
    const keys = Object.keys(data)
    if (keys.length && keys.every(k => k.startsWith('_') || k === 'ai_focus')) return null
  }
  const name = String((cmd.name ?? cmd.fieldId ?? '') || '')
  let summary: string
  switch (type) {
    case 'generate': summary = cmd.prompt ? `"${String(cmd.prompt).slice(0, 60)}"` : 'generate'; break
    case 'inject_wgsl':
    case 'inject_glsl': summary = 'shader injected'; break
    case 'create_field': summary = 'created'; break
    case 'paint': summary = 'painted'; break
    case 'add_effect': summary = '+' + String(cmd.effect ?? 'effect'); break
    case 'set_position': summary = 'moved'; break
    case 'define_visual': summary = 'defined visual'; break
    case 'define_module': summary = 'defined module'; break
    case 'define_interaction': summary = 'interaction rule'; break
    case 'remove_interaction': summary = 'removed interaction'; break
    case 'set_world_data': summary = data ? 'set ' + Object.keys(data).join(', ').slice(0, 40) : 'set world data'; break
    case 'set_world_params': summary = 'world params'; break
    case 'delete':
    case 'remove_field': summary = 'removed'; break
    case 'reset': summary = 'reset world'; break
    default: summary = type
  }
  return { type, name, summary }
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
// DESCRIBE — a no-GPU structural x-ray of a world: which fields have a working
// skin, which sit off the 512 grid, hook ids, worldData keys, and a WARNINGS list
// naming the exact recurring mistakes. The CHEAP eyes: instant, always available
// on Vercel (no GPU). For the FULL eyes (actual rendered pixels + PNG), an off-box
// AI now uses {type:"render_probe"} → the Railway render-service (see #12 below).
// describe stays the fast structural pre-check; render_probe is the pixel truth.
type DescribeSnap = { fields?: Array<Record<string, unknown>>; visualTypes?: Array<{ name?: string; wgsl?: string }>; modules?: unknown[]; stepHooks?: Array<{ id?: string }>; worldData?: Record<string, unknown> } | null | undefined
function describeWorld(snapshot: DescribeSnap, extra: Record<string, unknown>) {
  const fields = snapshot?.fields ?? []
  const visuals = snapshot?.visualTypes ?? []
  const hooks = snapshot?.stepHooks ?? []
  const wd = snapshot?.worldData ?? {}
  const renderable = new Set(visuals.filter(v => /fn\s+visual_\w+\s*\(/.test(v.wgsl ?? '')).map(v => v.name))
  const warnings: string[] = []
  const fieldReport = fields.map(fr => {
    const f = fr as { name?: string; id?: string; visualType?: unknown; visualTypeName?: string; transform?: { x?: number; y?: number }; x?: number; y?: number }
    const vt = f.visualTypeName || (typeof f.visualType === 'string' ? f.visualType : null)
    const x = f.transform?.x ?? f.x, y = f.transform?.y ?? f.y
    const onScreen = x != null && y != null && x >= 0 && x <= 512 && y >= 0 && y <= 512
    const skinned = !!(vt && renderable.has(vt))
    if (!vt) warnings.push(`field "${f.name}" has NO visualType — it renders as NOTHING (define_visual, then set_visual it)`)
    else if (!skinned) warnings.push(`field "${f.name}" uses visual "${vt}" but no "fn visual_${vt}(...)" is defined — it renders nothing`)
    if (x != null && !onScreen) warnings.push(`field "${f.name}" is off-screen at (${x},${y}) — the grid is 0..512, camera fixed at center 256,256; build AROUND 256,256, never negatives`)
    return { name: f.name, id: f.id, visualType: vt, skinned, x, y, onScreen }
  })
  if (!fields.length) warnings.push('no fields yet — the world is empty (a blank/black screen until you create + skin fields)')
  const broken = visuals.filter(v => v.name && !renderable.has(v.name)).map(v => v.name)
  if (broken.length) warnings.push(`visual(s) with no "fn visual_" body (won't render): ${broken.join(', ')}`)
  return {
    ...extra,
    fieldCount: fields.length,
    fields: fieldReport,
    visualTypes: visuals.map(v => ({ name: v.name, renderable: renderable.has(v.name) })),
    moduleCount: (snapshot?.modules ?? []).length,
    stepHooks: hooks.map(h => h.id),
    worldDataKeys: Object.keys(wd),
    briefDone: !!wd.brief_done,
    warnings,
  }
}

/** #12 — the eyes over HTTP. The GPU lives only on Railway's render-service
 *  (software Vulkan/lavapipe — no real GPU needed for our tiny shaders). We POST
 *  the world's render-relevant slice there and hand the struct + PNG straight
 *  back to the caller. So ANY AI over HTTP (a user's own Cursor/Claude, a cloud
 *  brew agent) SEES its world — not just the co-located daemon. If the service
 *  is unset/down, the caller still has the static eyes (describe/health). */
async function renderViaService(
  snap: { fields?: unknown[]; visualTypes?: unknown[]; modules?: unknown[]; worldData?: Record<string, unknown>; stepHooks?: unknown[] } | null | undefined,
  opts: { name?: unknown; ticks?: unknown; size?: unknown },
): Promise<Record<string, unknown>> {
  const base = process.env.RENDER_SERVICE_URL
  const secret = process.env.RENDER_SECRET
  if (!base || !secret) {
    return { ok: false, error: 'render service not configured (no eyes over HTTP yet) — use describe_scene / health for structural eyes', configured: false }
  }
  const state = {
    fields: snap?.fields ?? [],
    visualTypes: snap?.visualTypes ?? [],
    modules: snap?.modules ?? [],
    worldData: snap?.worldData ?? {},
    stepHooks: snap?.stepHooks ?? [],
  }
  if (!Array.isArray(state.fields) || state.fields.length === 0) {
    return { ok: false, error: 'nothing to render — the world has no fields yet' }
  }
  const url = base.replace(/\/+$/, '') + '/render'
  const payload: Record<string, unknown> = { state, size: 256 }
  if (typeof opts.name === 'string') payload.name = opts.name
  if (opts.ticks != null) payload.ticks = Number(opts.ticks)
  if (opts.size != null) payload.size = Math.min(512, Math.max(64, Number(opts.size) || 256))
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 25_000)
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) return { ok: false, error: `render service ${r.status}: ${(await r.text()).slice(0, 200)}` }
    const out = await r.json()
    // hint the caller how to READ the render, since it's raw pixel-stats not prose
    if (out.ok) out.next = 'meanLum=brightness, coveragePct=how much is drawn, bbox=where, dominantColors=palette, motion=movement over time. image is base64 PNG. If coveragePct<1 the world is ~blank; if offscreenHint set, content is mis-placed.'
    return out
  } catch (e) {
    return { ok: false, error: `render service unreachable: ${e instanceof Error ? e.message : String(e)} — static eyes (describe/health) still work` }
  }
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization')) logVisit({ kind: 'agent', path: '/api/engine/bridge:GET', ua: req.headers.get('user-agent'), ip: req.headers.get('x-forwarded-for')?.split(',')[0] })
  const auth = await authorize(req)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const wantDescribe = new URL(req.url).searchParams.get('action') === 'describe'

  // Icon-scoped: the only readable state is the icon itself
  if (auth.iconUserId) {
    const icon = await loadGameSlot('player-icon:' + auth.iconUserId)
    return NextResponse.json({ icon: icon ?? null, scope: 'player-icon' })
  }

  // Space-scoped: return snapshot from DB
  if (auth.spaceId) {
    const snapshot = await getSpaceSnapshot(auth.spaceId)
    if (wantDescribe) return NextResponse.json(describeWorld(snapshot as unknown as DescribeSnap, { scope: 'space', slug: auth.slug, name: auth.spaceName }))
    // step-hook failures a player's browser reported — surface them by DEFAULT so
    // the building AI sees WHY a hook does nothing instead of guessing (empty = fine)
    const hookErrors = (await loadGameSlot('hook-err:space:' + (auth.slug || '').toLowerCase())) as unknown[] | undefined
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
      hookErrors: Array.isArray(hookErrors) ? hookErrors : [],
    })
  }

  // Branch-scoped: return the scene's own snapshot from the file store
  if (auth.sceneName) {
    await hydrateScene(auth.sceneName)
    const snapshot = loadScene(auth.sceneName)
    if (wantDescribe) return NextResponse.json(describeWorld(snapshot as unknown as DescribeSnap, { scope: 'scene', slug: auth.slug, name: auth.sceneName }))
    const hookErrors = (await loadGameSlot('hook-err:scene:' + auth.sceneName.toLowerCase())) as unknown[] | undefined
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
      hookErrors: Array.isArray(hookErrors) ? hookErrors : [],
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
// CLAIM-LOCK — one builder per world at a time. Two builders editing one space
// (the daemon + a Path-1/brew session, or two swarm members) write last-write-wins
// and clobber each other (this is what broke big-monster). The FIRST builder to
// send a mutating command holds a short lock, refreshed by every write; others are
// refused until it lapses. A stalled builder's lock auto-expires, so nothing wedges.
const BUILD_LOCK_TTL = 3 * 60_000
// a command changes the world if it's a build op (define_/create_/set_/… ), not a
// read or roundtable-chat command — only those contend for the lock.
const MUTATING = /^(define_|create_|set_|add_|update_|clear_|delete_|remove_|destroy_|inject_|paint|spawn_|move_|link_|unlink_)/

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

    // CLAIM-LOCK: a space edit by a build agent must hold the world. Contend only
    // on mutating commands (reads/roundtable never lock). The holder is a hash of
    // THIS token, so daemon vs Path-1 vs owner are distinct builders.
    if (auth.spaceId && commands.some(c => typeof c.type === 'string' && MUTATING.test(c.type))) {
      const token = req.headers.get('authorization')?.slice(7) || ''
      const holder = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
      const key = 'build-lock:' + auth.spaceId
      const now = Date.now()
      const cur = await loadGameSlot(key) as { holder?: string; until?: number } | undefined
      if (cur?.until && cur.until > now && cur.holder !== holder) {
        return NextResponse.json({
          error: `Another builder is editing "${auth.slug}" right now — a claim-lock stops two builders clobbering one world. It holds until ${new Date(cur.until).toISOString()} (${Math.ceil((cur.until - now) / 1000)}s). Wait and retry, or build a different world.`,
          buildLocked: true, until: cur.until,
        }, { status: 409 })
      }
      await saveGameSlot(key, { holder, until: now + BUILD_LOCK_TTL, who: auth.slug || null }).catch(() => {})
    }

    const results: unknown[] = []
    const isSpaceScoped = !!auth.spaceId
    const isSceneScoped = !!auth.sceneName   // branch token: headless, isolated to one scene

    // #4 atomic batch: snapshot the world BEFORE the batch; if any command throws
    // mid-way, we revert to this so a half-applied batch never persists.
    if (isSceneScoped) await hydrateScene(auth.sceneName!)   // this lambda may have never seen the branch
    const rollback = isSpaceScoped
      ? await getSpaceSnapshot(auth.spaceId!, true).then(snap => (snap ? JSON.parse(JSON.stringify(snap)) : null)).catch(() => null)
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

      // Player key (uc_pt_): a personal, non-world credential. It may chat the
      // commons (main_say/main_read, handled below) and BOOTSTRAP world tokens —
      // create_world / use_world each return a uc_st_ world token that does the
      // actual building. It can never edit a world directly, nor touch worlds it
      // doesn't own — that keeps a leaked player key from being a wildcard.
      if (auth.playerId) {
        if (cmd.type === 'create_world') {
          const name = (typeof cmd.name === 'string' && cmd.name.trim() ? cmd.name.trim() : 'untitled world').slice(0, 60)
          const owned = await prisma.playerSpace.count({ where: { ownerId: auth.playerId } })
          if (owned >= 20) { results.push({ type: cmd.type, error: 'world limit reached (20 per account) — delete one first' }); continue }
          const base = slugify(name) || 'world'
          let slug = base
          for (let i = 0; i < 6; i++) {
            const taken = await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true } })
            if (!taken) break
            slug = base + '-' + crypto.randomBytes(2).toString('hex')
          }
          const space = await prisma.playerSpace.create({ data: { name, slug, ownerId: auth.playerId } })
          const worldToken = await mintWorldToken(space.id, 'created via player key')
          results.push({ ok: true, created: slug, spaceName: name, token: worldToken,
            next: `now POST your build commands with Authorization: Bearer ${worldToken} — that key edits "${name}". Skin every field with a visualType or it renders as nothing.` })
          continue
        }
        if (cmd.type === 'use_world') {
          const slug = typeof cmd.slug === 'string' ? cmd.slug.trim() : ''
          const sp = slug ? await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true, name: true, ownerId: true } }) : null
          if (!sp || sp.ownerId !== auth.playerId) { results.push({ type: cmd.type, error: `no world "${slug}" that you own` }); continue }
          const worldToken = await mintWorldToken(sp.id, 'checked out via player key')
          results.push({ ok: true, world: slug, spaceName: sp.name, token: worldToken,
            next: `POST build commands with Authorization: Bearer ${worldToken} to edit "${sp.name}".` })
          continue
        }
        if (cmd.type !== 'main_say' && cmd.type !== 'main_read') {
          results.push({ type: cmd.type, error: 'a player key can only: create_world {name}, use_world {slug}, main_say, main_read. Build a world with the uc_st_ token those return.' })
          continue
        }
      }

      // #12 render_probe — SEE this world. Renders its shader on the cloud GPU
      // (render-service) and returns pixel-stats + a base64 PNG. A read; never
      // mutates. Icon/player tokens never reach here (guarded above), so this is
      // scoped to the world the token already owns.
      if (cmd.type === 'render_probe') {
        const snap = isSpaceScoped
          ? await getSpaceSnapshot(auth.spaceId!)
          : isSceneScoped
            ? loadScene(auth.sceneName!)
            : getEngineState()
        const out = await renderViaService(snap as never, { name: cmd.name, ticks: cmd.ticks, size: cmd.size })
        results.push({ type: 'render_probe', ...out })
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
        // SPACE-token path lands on the space's OWNER — an AI holding a world
        // key once silently replaced the owner's cursor while testing. That
        // door now needs a deliberate hand on it. (Icon tokens are exempt:
        // they exist for exactly one icon change and nothing else.)
        if (!auth.iconUserId && cmd.confirmOwner !== true) {
          results.push({ type: cmd.type, error: "this would replace the SPACE OWNER's cursor icon — pass confirmOwner: true if that is truly intended" })
          continue
        }
        // one-step undo: stash whatever the player was wearing
        const prev = await loadGameSlot('player-icon:' + iconUid)
        if (prev) await saveGameSlot('player-icon-prev:' + iconUid, prev)
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
        icon.setVia = auth.iconUserId ? 'icon-token' : 'space-token'
        icon.setAt = Date.now()
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

      // HAZARD SCAN — reject GPU-killing WGSL inline so a headless builder hears
      // about it (its only quarantine feedback; browser compile needs a live tab).
      if ((isSpaceScoped || isSceneScoped) && SHADER_CMDS.has(cmd.type as string)) {
        const code = String(cmd.wgsl ?? cmd.glsl ?? cmd.code ?? '')
        const hazard = wgslHazard(code)
        if (hazard) {
          results.push({ type: cmd.type, name: cmd.name, error: `HAZARD — rejected, not applied: ${hazard}. Rewrite this shader and resend.` })
          continue
        }
        // SIGNATURE CHECK — a visual in the wrong shape (standalone @fragment)
        // compiles nowhere and renders as nothing; reject with the right form.
        if (cmd.type === 'define_visual') {
          const sigErr = visualSignatureError(String(cmd.name ?? ''), code)
          if (sigErr) {
            results.push({ type: cmd.type, name: cmd.name, error: `WRONG SHADER SHAPE — rejected, not applied: ${sigErr}` })
            continue
          }
        }
      }

      // RENDER CHECK — brief_done means "the world is done"; refuse it while the
      // world would render fully DARK (fields exist but none carries a registered
      // visualType). Fields render as NOTHING without one — this is the #1 way a
      // "finished" build ships black. Partially-skinned worlds pass with a warning
      // (logic-only invisible helper fields are legitimate).
      if (isSpaceScoped && cmd.type === 'set_world_data' && (cmd.data as Record<string, unknown> | undefined)?.brief_done) {
        try {
          const snap = await getSpaceSnapshot(auth.spaceId!, true)   // fresh: gate brief_done on the true state
          const fields = (snap?.fields ?? []) as Array<{ name?: string; visualTypeName?: string }>
          // a visual only RENDERS if its wgsl defines a visual_* function — a
          // registered-but-wrong-shaped visual (standalone @fragment) draws
          // nothing, which is exactly how a fully-linked stadium shipped dark.
          const visuals = (snap?.visualTypes ?? []) as Array<{ name?: string; wgsl?: string }>
          const renderable = new Set(visuals.filter(v => /fn\s+visual_\w+\s*\(/.test(v.wgsl ?? '')).map(v => v.name))
          const broken = visuals.filter(v => v.name && !renderable.has(v.name)).map(v => v.name)
          const skinned = fields.filter(f => f.visualTypeName && renderable.has(f.visualTypeName))
          const unskinned = fields.filter(f => !f.visualTypeName || !renderable.has(f.visualTypeName))
          if (fields.length > 0 && skinned.length === 0) {
            results.push({ type: cmd.type, error:
              `RENDER CHECK FAILED — brief_done refused: no field has a WORKING visual, so the world renders black. ` +
              (broken.length ? `These visuals are the WRONG SHAPE (no fn visual_<name>(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f — standalone @fragment shaders compile nowhere here): ${broken.slice(0, 12).join(', ')}. Re-send each with define_visual in the correct form. ` : '') +
              `Attach working visuals: create_field {"visualType":"<name>"} or set_visual {"fieldId":"...","visualType":"<name>"}. ` +
              `Fields without a working skin: ${unskinned.map(f => f.name).filter(Boolean).slice(0, 10).join(', ')}` })
            continue   // brief_done NOT set; the build isn't done until it renders
          }
          if (unskinned.length > 0) {
            cmd.__renderWarning = `${unskinned.length} field(s) have no visible skin (${unskinned.map(f => f.name).filter(Boolean).slice(0, 6).join(', ')}) — fine if intentional (logic-only), else set_visual them`
          }
        } catch { /* the check must never block a legitimate finish */ }
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
      if (cmd.__renderWarning) { result.renderWarning = cmd.__renderWarning; delete cmd.__renderWarning }
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
          } else if ((result as Record<string, unknown>).listeners === 0) {
            // headless truth: nobody compiled this shader. Say so, or the builder
            // ships WGSL believing silence means success.
            ;(result as Record<string, unknown>).compileResult = {
              unverified: true,
              note: 'no live tab is open, so this shader was NOT compiled — only statically scanned. Keep it simple and standard; it will first compile when a player opens the world.',
            }
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

    // DURABLE BUILD CONSOLE — mirror this batch into a Postgres ring keyed by
    // spaceId, so the viewer's console fills even on Vercel serverless (where the
    // in-memory agent SSE queue can't cross lambda instances). The viewer polls
    // it when its own SSE is silent. Courtesy only — never blocks a build.
    if (isSpaceScoped && commands.length > 0) {
      const fresh = commands
        .map(c => summarizeConsole(c as Record<string, unknown>))
        .filter((f): f is { type: string; name: string; summary: string } => !!f)
      if (fresh.length) {
        try {
          const slot = 'build:console:' + auth.spaceId
          const prev = (await loadGameSlot(slot)) as { seq?: number; entries?: unknown[] } | undefined
          let seq = prev?.seq ?? 0
          const entries = Array.isArray(prev?.entries) ? prev.entries.slice() : []
          const at = Date.now()
          for (const f of fresh) entries.push({ ...f, seq: ++seq, t: at })
          await saveGameSlot(slot, { seq, entries: entries.slice(-120) })
        } catch { /* the console is a courtesy, never blocks a build */ }
      }
    }

    // INLINE HEALTH — ride the structural x-ray on every space build write, so the
    // agent learns "field X has no visual" / "off-screen at (0,0)" the moment it
    // makes the mistake, without a separate cafe_describe call. Cheap; best-effort.
    let health: Record<string, unknown> | undefined
    if (isSpaceScoped && commands.some(c => typeof c.type === 'string' && MUTATING.test(c.type))) {
      try {
        const d = describeWorld(await getSpaceSnapshot(auth.spaceId!) as unknown as DescribeSnap, {})
        health = { fieldCount: d.fieldCount, skinnedFields: d.fields.filter(f => f.skinned).length, warnings: d.warnings }
        if (d.warnings.length) health.next = 'Fix these, then {type:"render_probe"} to SEE the actual rendered pixels (struct + base64 PNG) before set_world_data brief_done.'
      } catch { /* health is a courtesy */ }
    }
    return NextResponse.json({ ok: true, executed: results.length, results, ...(health ? { health } : {}) })
  } catch (error) {
    console.error('[Engine Bridge] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bridge failed' },
      { status: 500 }
    )
  }
}
