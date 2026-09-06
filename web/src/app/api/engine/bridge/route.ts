import { isAdminToken } from '@/lib/adminAuth'
import { renderSnapshot } from '@/lib/render-service'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getFieldSnapshot, getAllFieldSnapshots, getEngineState, addInteractionRuleStore, removeInteractionRuleStore, addCustomCommandStore, getCustomCommandStore, getRenderedSamples, getRenderedSample, addGlslMod, removeGlslMod, addVisualType, undoVisualType, removeVisualType, addInteractionDef, addModule, addRenderTargetDef, removeRenderTargetDef, waitForCommandResult, resetStore, saveGameSlot, loadGameSlot } from '../store'
import type { GlslMod } from '../store'
import { validateSpaceToken, getSpaceSnapshot, setSpaceSnapshot, applyCommandToSnapshot, applyCommandToScene, getSpaceFamily } from '../space-store'
import { placeholderSeedCommands } from '@/app/engine/placeholder-nodes'
import { solveUi, type UiTree, type UiNode } from '@/app/engine/ui-solver'
import { resetWorld, worldStores, setOriginal } from '@/lib/worldSave'
import { validateSceneToken } from '../scene-token'
import { bumpWorldRev, spaceKey, sceneKey } from '../world-rev'
import { loadScene, saveScene, hydrateScene } from '../store'
import { broadcastCommons, commonsListenerCount } from '../commons-stream'
import { commonsPost, commonsRead, commonsSystemSay } from '@/lib/commons'
import { prisma } from '@/lib/prisma'
import { mirrorWorldBlurb } from '../world-blurb'
import { logVisit } from '@/lib/visits'
import { bridgeOverLimit } from '@/lib/bridge-rate'
import { validatePlayerToken } from '@/lib/player-token'
import { warmSpaceOgCard } from '@/lib/og-card'
import { slugify } from '@/lib/slug'
import { canCreateWorld, createSpaceUniqueSlug, findOwnWorldByName } from '@/lib/world-create'
import { claimRegion, resolveRegion, withdrawRegion, readRegions, registerWatcher, readWatchers, readSummons, broadcastSummon, regionWarningForPoint, holderOf } from '../regions-store'
import { feedAppend, type FeedLine } from '@/lib/node-dock'   // co-build: dock internals feed ring
import { setSwarmMap, readSwarmMap, dockNode, jumpTarget, releaseNode, healDependents, attachServerEvidence, mapSummary } from '../swarm-store'
import { handleCardTypes, handleProposeCardType, handleSetCard } from '../cards-registry'   // SEAM-A (cards)
import { validateWorldDoc, worldDocFacets, type WorldDoc } from '@/app/engine/world-config'   // unified world: pure schema
import { worldSolve, planRects } from '@/app/engine/world-solve'                              // unified world: pure solve

export const maxDuration = 120   // render probes ride this route — lavapipe needs ~25-60s (see render-service.ts)

/** A stable, non-reversible tag for the caller's token — its TYPE plus an 8-char
 *  hash of the token itself. Lets the admin bridge-watch see per-token volume
 *  ("who is hammering") WITHOUT storing the raw token. Computed pre-auth (cheap),
 *  so it also tags callers whose token later fails validation. */
function tokenTag(authHeader: string): string {
  const token = authHeader.slice(7)
  const type = token.startsWith('uc_st_') ? 'space'
    : token.startsWith('uc_pt_') ? 'player'
    : token.startsWith('uc_it_') ? 'icon'
    : token === process.env.ENGINE_AGENT_TOKEN ? 'house'
    : 'other'
  return `${type}:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 8)}`
}

interface BridgeAuth {
  authorized: boolean
  spaceId: string | null    // null = legacy global mode
  ownerId: string | null
  iconUserId?: string       // uc_it_ icon token — may ONLY brew this player's icon
  playerId?: string         // uc_pt_ player key — chat the commons + create/checkout YOUR OWN worlds
  slug?: string
  spaceName?: string
  sceneName?: string        // set = branch-scoped (file-store scene); read/write isolated to it
  memberHandle?: string     // set = a member:<handle> crew key (build yes, demolish no)
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
    const memberHandle = result.tokenName?.startsWith('member:') ? result.tokenName.slice(7) : undefined
    return { authorized: true, spaceId: result.spaceId, ownerId: result.ownerId, slug: result.slug, spaceName: result.spaceName, memberHandle }
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

  // Legacy global token path (admin) — THE one check (lib/adminAuth, audit #6)
  if (isAdminToken('Bearer ' + token, { allowLegacyAnthropicKey: true })) {
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
  // NO SIZE CEILING (Galen, Aug 7: "we don't need a ceiling") — big shaders are
  // legitimate; the real GPU hazards are the loop/array patterns below. A 1MB
  // sanity net stays only to catch accidental garbage pastes, not real art.
  if (wgsl.length > 1_000_000) return `shader is ${wgsl.length}B — that is not a shader, that is a paste accident`
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
  // BUILTIN REDECLARATION — the quarantine class that broke the front door
  // (Jul 22: a world visual inlined `fn vnoise`/`fn fbm`; the headless probe has
  // no builtin library so it compiled there, but the hub composites player
  // visuals into its uber-shader WHERE THE BUILTINS EXIST → redeclaration →
  // the visual quarantined live). Catch it at the door and teach the fix.
  const redeclared = [...wgsl.matchAll(/fn\s+(\w+)\s*\(/g)].map(m => m[1]).filter(f => WGSL_BUILTINS.has(f))
  if (redeclared.length) {
    return `"${redeclared.join('", "')}" ${redeclared.length > 1 ? 'are' : 'is a'} built-in engine function${redeclared.length > 1 ? 's' : ''} — redeclaring ${redeclared.length > 1 ? 'them' : 'it'} breaks the composed uber-shader (it compiles in a headless probe but QUARANTINES in the live hub). Rename with a unique prefix, e.g. fn ${name.slice(0, 4)}_${redeclared[0]}(...). Builtins are already available — you may simply call ${redeclared[0]}() without defining it.`
  }
  return null
}

/** Every function the engine's shader prelude already provides — a visual that
 *  re-defines one of these names duplicates it in the composed module. */
const WGSL_BUILTINS = new Set([
  'hash11', 'hash21', 'hash22', 'hash31', 'hash33',
  'vnoise', 'vnoise3', 'gnoise', 'simplex2d',
  'fbm', 'fbm3', 'fbm4', 'fbm5', 'fbm6', 'fbm3d', 'fbm3v', 'fbm4v', 'fbm5v', 'fbm6v', 'warp',
  'voronoi', 'voronoiEdge',
  'sdCircle', 'sdBox', 'sdRoundedBox', 'sdSegment', 'sdEquilateralTriangle', 'sdStar',
  'opUnion', 'opSubtract', 'opIntersect', 'opSmoothUnion', 'opSmoothSubtract',
  'hsv2rgb', 'palette', 'colorRamp', 'rot2', 'rotate', 'polar', 'glsl_mod', 'glsl_mod2',
  'circleMask', 'softGlow', 'ring', 'glow', 'diffuseLight',
  'char5x7', 'printInt', 'regionUV', 'regionUVCentered', 'regionUVAspect',
  'pop', 'popCount', 'prevHere', 'prevAt', 'pix', 'sampleTarget', 'sampleTargetUV', 'uni', 'uni4',
])

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
  // NOTE: the ANTHROPIC fallback here is a SENDER-side value; the agent route's
  // check accepts only ENGINE_AGENT_TOKEN, so the fallback only matters if that
  // env var is unset (dev). Kept as-was; kill together with allowLegacyAnthropicKey.
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

/** Where a placing command drops content, in 0..512 grid space (null if it
 *  carries no position). Used for warn-mode region enforcement. */
function cmdPoint(cmd: Record<string, unknown>): { x: number; y: number } | null {
  const pos = (cmd.position ?? cmd.transform) as { x?: unknown; y?: unknown } | undefined
  const x = Number(cmd.x ?? pos?.x)
  const y = Number(cmd.y ?? pos?.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
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
type DescribeSnap = { fields?: Array<Record<string, unknown>>; visualTypes?: Array<{ name?: string; wgsl?: string }>; modules?: unknown[]; stepHooks?: Array<{ id?: string }>; worldData?: Record<string, unknown>; worldParams?: Record<string, unknown> } | null | undefined
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
  // WORLD UI validation (the guide's ?section=world ui) — run the REAL solver so a
  // malformed tree comes back as words instead of rendering as nothing.
  // hud is DEPRECATED (Galen, Aug 29: the ui-solver is THE way): nudge every
  // world still on the DOM layer toward the one authority.
  if (Array.isArray(wd['hud']) && (wd['hud'] as unknown[]).length > 0 && wd['ui'] == null) {
    warnings.push('worldData.hud is the DEPRECATED DOM layer — use worldData.ui (THE UI SYSTEM: solved, engine-pixel, aligned; guide ?section=world ui)')
  }
  const uiTree = wd['ui'] as UiTree | undefined
  if (uiTree != null) {
    if (typeof uiTree !== 'object' || !Array.isArray(uiTree.root)) {
      warnings.push('worldData.ui is not a { root: [...] } tree — it renders as NOTHING (schema: guide ?section=world ui)')
    } else {
      try {
        const solved = solveUi({ ui: uiTree })
        if (solved.boxes.length + solved.runs.length + solved.meters.length === 0) {
          warnings.push('worldData.ui solved to ZERO panels/text — check kinds (panel·col·row·text·meter·button·spacer·slot) and that panels have children')
        }
        const KINDS = new Set(['panel', 'col', 'row', 'text', 'meter', 'button', 'spacer', 'slot', 'slider'])
        const uiWalk = (nodes: UiNode[] | undefined): void => {
          for (const nd of nodes ?? []) {
            if (nd && typeof nd === 'object') {
              if (!KINDS.has(nd.kind as string)) warnings.push(`ui node kind "${String(nd.kind)}" is unknown — it renders as NOTHING (kinds: panel·col·row·text·meter·button·spacer·slot·slider)`)
              if (nd.kind === 'button' && !nd.click) warnings.push(`ui button "${nd.id ?? nd.text ?? '?'}" has no click action — presses go nowhere (add click: "<action>", read wd.__uiClick in a hook)`)
              if ((nd.kind === 'button' || nd.kind === 'meter' || nd.kind === 'slot') && !nd.id) warnings.push(`ui ${nd.kind} ("${nd.text ?? nd.label ?? '?'}") has no id — it can't be tracked in __uiRects or overridden`)
              uiWalk(nd.children)
            }
          }
        }
        uiWalk(uiTree.root)
      } catch (e) {
        warnings.push('worldData.ui failed to solve: ' + (e as Error).message + ' (schema: guide ?section=world ui)')
      }
    }
  }
  const broken = visuals.filter(v => v.name && !renderable.has(v.name)).map(v => v.name)
  if (broken.length) warnings.push(`visual(s) with no "fn visual_" body (won't render): ${broken.join(', ')}`)

  // THE SQUISH LAW (Galen, Aug 23: resizing "squished the shader instead of
  // adjusting the frame"): a SCREEN-shaped field's quad inherits the CANVAS
  // aspect, so square-uv math ((uv+1)*256 idioms) draws circles as ellipses on
  // any non-square window. World-unit fields are aspect-safe for free; screen
  // fields must map through viewbox(). Warn per offending field so a headless
  // builder hears it BEFORE a player resizes.
  const wgslOf = new Map(visuals.map(v => [v.name, v.wgsl ?? '']))
  for (const fr of fields) {
    const f = fr as { name?: string; shapeType?: string; visualTypeName?: string; visualType?: unknown }
    if (f.shapeType !== 'screen') continue
    const vt = f.visualTypeName || (typeof f.visualType === 'string' ? f.visualType : null)
    const w = vt ? wgslOf.get(vt) : null
    if (w && /\buv\b/.test(w) && !/viewbox\s*\(/.test(w)) {
      warnings.push(`SQUISH: screen-canvas field "${f.name}" uses visual "${vt}" whose wgsl reads uv WITHOUT viewbox() — square-uv math distorts at any non-square window. Map into world units: let wp = viewbox().xy + uv * viewbox().zw; (field uv is y-down like the grid — negate uv.y ONLY if your math is y-up)`)
    }
  }

  // PHYSICS BOUNCE (Galen: "fields are all bouncing around"). Default worldParams
  // ship collisionForce:50 + solid bounds, so overlapping fields get shoved
  // apart — and a world-covering backdrop overlaps EVERYTHING, so its own scene
  // used to bounce. The engine now auto-PINS fullscreen backdrops (static: they
  // apply force but never move), but smaller unpinned fields under active physics
  // still drift/collide — so surface it here as the bug it is.
  const wp = snapshot?.worldParams ?? {}
  const physicsMoves = Number(wp.gravity ?? 0) !== 0 || Number(wp.collisionForce ?? 0) !== 0 || Number(wp.gravitationalConstant ?? 0) !== 0
  const dim = (f: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) { const v = Number(f[k]); if (v) return v } return 0 }
  const isFull = (f: Record<string, unknown>) =>
    f.shapeType === 'screen' || (dim(f, 'w', 'width') >= 460 && dim(f, 'h', 'height') >= 460) || dim(f, 'radius') >= 230
  if (physicsMoves) {
    const hasBackdrop = fields.some(isFull)
    const loose = fields.filter(f => !isFull(f) && (f.properties as Record<string, unknown> | undefined)?.static !== true).length
    if (hasBackdrop) {
      warnings.push(`physics is ACTIVE (collisionForce=${wp.collisionForce ?? 0}, gravity=${wp.gravity ?? 0}) with a fullscreen backdrop — the backdrop is auto-pinned so it won't drift, but if the SCENE looks like it's bouncing it's the smaller overlapping fields being shoved apart. Fix: pin scenery with property {"static":true}, or set_world_params {"collisionForce":0} if you don't want field-field collisions.`)
    } else if (loose >= 3) {
      warnings.push(`${loose} unpinned fields with physics ACTIVE (collisionForce=${wp.collisionForce ?? 0}) — overlapping fields will be shoved apart and bounce. Pin static scenery with property {"static":true}, or set_world_params {"collisionForce":0}.`)
    }
  }
  // THE PERF LAW (Galen, Aug 26: "how do we stop AIs from making games laggy?").
  // __budget was advisory-only; surface it HERE so a headless builder hears the
  // measured cost of what it built — before a player pays it.
  const budget = wd.__budget as { frameMs?: number; fields?: number; effects?: number; at?: number; hooks?: Record<string, number> } | undefined
  const budgetMs = Number(budget?.frameMs ?? 0)
  if (budgetMs > 25) {
    const fresh = Number(budget?.at ?? 0) > Date.now() - 10 * 60_000
    const hk = Object.entries(budget?.hooks ?? {}).sort((a, b) => b[1] - a[1])[0]
    warnings.push(`PERF: this world MEASURES ${Math.round(budgetMs)}ms/frame${fresh ? '' : ' (stale — from a past live session)'}${hk ? ` — heaviest node: ${hk[0]} at ${hk[1]}ms/tick` : ''} — the budget is ~25ms; past it the render-scale governor trades sharpness for survival, and a FRESH measurement >40ms refuses brief_done. Cheapen: fewer march steps, region-gate the scene SDF (early-return rooms the ray isn't in), populations in gpuPopulation.`)
  }
  if (fields.length > 6) {
    warnings.push(`PERF: ${fields.length} fields — every field is a real GPU pass. A POPULATION (flock/bullets/crowd/particles) belongs in gpuPopulation (up to 4095 entities, ONE buffer), never a field per entity.`)
  }
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

/** #12 — the eyes over HTTP. The caller now lives in @/lib/render-service so
 *  icon-baking and any other server code share it; kept here as a thin alias to
 *  preserve the existing call-sites and comments below. */
const renderViaService = renderSnapshot

export async function GET(req: NextRequest) {
  { const _auth = req.headers.get('authorization'); if (_auth) { const _ua = req.headers.get('user-agent'); logVisit({ kind: _ua?.includes('cartridge-mcp') ? 'mcp' : 'agent', path: '/api/engine/bridge:GET', ua: _ua, ip: req.headers.get('x-forwarded-for')?.split(',')[0], who: tokenTag(_auth) }) } }
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

  // ADMIN + ?slug= — the arena-service's world loader: an authoritative server
  // (ARENA_SECRET = admin token) reads ANY space's snapshot by slug to boot a
  // room. Admin auth is the only path where every scope field is null, so this
  // can never widen a player/space/scene token's reach.
  {
    const slugParam = req.nextUrl.searchParams.get('slug')
    if (slugParam && !auth.spaceId && !auth.sceneName && !auth.playerId) {
      const sp = await prisma.playerSpace.findUnique({ where: { slug: slugParam }, select: { id: true, name: true } }).catch(() => null)
      if (!sp) return NextResponse.json({ error: 'space not found' }, { status: 404 })
      const snapshot = await getSpaceSnapshot(sp.id)
      return NextResponse.json({
        space: { slug: slugParam, name: sp.name, viewUrl: req.nextUrl.origin + '/space/' + slugParam },
        spaceId: sp.id,
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
// SWARM TURNS: a builder holding an ACCEPTED region claim takes a SHORT lock
// instead — the regions layer already carved the space, so the world lock only
// needs to serialize each write burst, not a whole build session. Many region-
// holders then interleave at seconds granularity ("the swarm is a queue" fix).
const REGION_TURN_TTL = 12_000
// a command changes the world if it's a build op (define_/create_/set_/… ), not a
// read or roundtable-chat command — only those contend for the lock.
const MUTATING = /^(define_|create_|set_|add_|update_|clear_|delete_|remove_|destroy_|inject_|paint|spawn_|move_|link_|unlink_)/
// NODE-GATE: commands whose effect is gated by node holds. The route stamps the
// un-spoofable builder identity (holderOf(token)) onto these before they reach the
// persist chokepoint — the client-supplied `author` field is never trusted for access.
const NODE_CMDS = new Set(['add_step_hook', 'update_step_hook', 'claim_node', 'release_node', 'register_node', 'remove_node', 'dock_node', 'undock_node', 'node_history', 'node_revert'])
// destructive verbs also carry the identity stamps: the persist chokepoint
// enforces holder/owner-only removal (grief gate — a crew builds, never wipes)
const GRIEF_CMDS = new Set(['remove_step_hook', 'delete_field', 'reset', 'destroy_render_target'])
// (put_world + set_world_data ALSO get the identity stamps — they read them in the store)

export async function POST(req: NextRequest) {
  { const _auth = req.headers.get('authorization')
    if (_auth) {
      const _tag = tokenTag(_auth)
      const _ua = req.headers.get('user-agent')
      logVisit({ kind: _ua?.includes('cartridge-mcp') ? 'mcp' : 'agent', path: '/api/engine/bridge:POST', ua: _ua, ip: req.headers.get('x-forwarded-for')?.split(',')[0], who: _tag })
      // Generous GLOBAL per-token throttle: a single token can't spam the bridge
      // (and its AI spend) relentlessly. One shared DB tally across all Vercel
      // instances, so it holds even when requests fan out. House token exempt —
      // the swarm builds at volume. Self-clearing per minute (see bridge-rate).
      if (!_tag.startsWith('house:') && await bridgeOverLimit(_tag)) {
        return NextResponse.json({ error: 'Too many bridge requests — slow down (max ~180/min per token).' }, { status: 429 })
      }
    }
  }
  const auth = await authorize(req)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    // ── THE UNIFIED WORLD — pure request/response verbs (guide: "THE UNIFIED
    // WORLD"). validate/solve run the SAME schema + solver the engine renders
    // from, so a remote AI gets the identical dry-run loop a local one has:
    // declare → validate (named errors) → solve (planRects per viewport) →
    // build → eye. Pure reads: intercepted BEFORE presence/claim-lock — they
    // never contend for a world and mutate nothing.
    if (commands.length === 1 && (commands[0].type === 'validate_world_doc' || commands[0].type === 'solve_world_doc')) {
      const cmd = commands[0]
      const doc = cmd.doc as WorldDoc | undefined
      if (!doc || typeof doc !== 'object' || !Array.isArray((doc as WorldDoc).layout?.regions)) {
        return NextResponse.json({ error: 'send {type:"' + String(cmd.type) + '", doc:{id,name,render,layout:{regions:[...]}}} — see guide section "THE UNIFIED WORLD"' }, { status: 400 })
      }
      if (doc.layout.regions.length > 64) {
        return NextResponse.json({ error: 'layout.regions capped at 64' }, { status: 400 })
      }
      if (cmd.type === 'validate_world_doc') {
        const errors = validateWorldDoc(doc)
        return NextResponse.json({ ok: errors.length === 0, errors, facets: worldDocFacets(doc), scope: 'unified-world' })
      }
      // solve_world_doc: one viewport or a matrix (capped) — the dry-run eye
      const list = (Array.isArray(cmd.viewports) ? cmd.viewports : [cmd.viewport ?? { w: 1344, h: 800 }])
        .slice(0, 8)
        .filter((v): v is { w: number; h: number } => !!v && typeof (v as { w?: unknown }).w === 'number' && typeof (v as { h?: unknown }).h === 'number')
      if (list.length === 0) return NextResponse.json({ error: 'send viewport:{w,h} or viewports:[{w,h},...] (max 8)' }, { status: 400 })
      const state = (cmd.state && typeof cmd.state === 'object') ? cmd.state as Record<string, unknown> : undefined
      const solves = list.map(vp => {
        const plan = worldSolve(doc, vp, state)
        return { viewport: vp, ok: plan.ok, errors: plan.errors, culled: plan.culled, supported: plan.supported, rects: planRects(plan) }
      })
      return NextResponse.json({ scope: 'unified-world', solves })
    }

    // AI PRESENCE — a working AI has a body. Dock it in its world's head-count only
    // on a BUILD command (mutating), not on reads/keepalives/commons-polls — else a
    // watcher holding a world token (e.g. a `main_read` loop) shows "developer live"
    // forever on a world nobody is building. Truthful by construction: a fresh row
    // means real work is landing right now. Fire-and-forget: never fail a build.
    if (auth.spaceName && commands.some(c => typeof c.type === 'string' && MUTATING.test(c.type))) {
      const scene = String(auth.spaceName).toUpperCase().slice(0, 120)
      prisma.$executeRawUnsafe(
        `INSERT INTO cc_presence (id, scene, seen) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET scene = $2, seen = now()`,
        'ai:' + (auth.slug || scene.toLowerCase()), scene,
      ).catch(() => {})
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
      // region-holders get a short TURN, everyone else the full session lock
      const hasRegion = await readRegions(auth.spaceId).then(cs => cs.some(c => c.holder === holder && c.status === 'accepted')).catch(() => false)
      await saveGameSlot(key, { holder, until: now + (hasRegion ? REGION_TURN_TTL : BUILD_LOCK_TTL), who: auth.slug || null }).catch(() => {})
    }

    const results: unknown[] = []
    const isSpaceScoped = !!auth.spaceId
    const isSceneScoped = !!auth.sceneName   // branch token: headless, isolated to one scene
    // AI-VIEW scope key — one string the BuilderBox's ◈ AI VIEW panel polls for this
    // world's focus/eye beacons. Spaces key by spaceId; house/scene worlds key by
    // 'scene:<base-slug>' so the panel works on AI-built house content too. The UI
    // derives the identical key from its own scene name (FieldEngine cellBase()).
    const aiScope = auth.spaceId
      ? auth.spaceId
      : (auth.sceneName ? 'scene:' + auth.sceneName.split(' ⑂ ')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) : null)

    // #4 atomic batch: snapshot the world BEFORE the batch; if any command throws
    // mid-way, we revert to this so a half-applied batch never persists.
    if (isSceneScoped) await hydrateScene(auth.sceneName!)   // this lambda may have never seen the branch
    const rollback = isSpaceScoped
      ? await getSpaceSnapshot(auth.spaceId!, true).then(snap => (snap ? JSON.parse(JSON.stringify(snap)) : null)).catch(() => null)
      : isSceneScoped
        ? (() => { const s = loadScene(auth.sceneName!); return s ? JSON.parse(JSON.stringify(s)) : null })()
        : null
    let batchAbort: { cmd: unknown; error: string } | null = null
    let briefDoneAccepted = false
    // Shader compile rejects surfaced by the live tab (define_visual/module that
    // return 200 but fail the WGSL compile → a BLACK screen). Collected here so
    // the failure is published to the human's ◈ AI VIEW panel, not just returned
    // in the API response the headless builder may never read.
    const shaderErrors: { name: string; type: string; error: string }[] = []

    // Provenance cross-check: stamp the User-Agent of the FIRST agent to post a
    // build command to this world (self-reported worldData.built_by is separate,
    // and can be spoofed; this is the unspoofed hint). Best-effort — never blocks.
    if (isSpaceScoped) {
      try {
        const snap = await getSpaceSnapshot(auth.spaceId!)
        const wd = (snap?.worldData ?? {}) as Record<string, unknown>
        if (!wd.__built_ua) {
          const ua = (req.headers.get('user-agent') || 'unknown').slice(0, 200)
          await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', __internal: true, data: { __built_ua: ua, __built_at: Date.now() } })
        }
        // AI HEARTBEAT (Galen, Aug 26: "no indication on if you are connected") —
        // stamp the last AI-command time so the world page can say, truthfully,
        // "an AI is working here". Unspoofed (server-side, key-authed), throttled
        // to one write per 10s so chatty builders don't double every batch.
        if (Number(wd.__ai_last_cmd ?? 0) < Date.now() - 10_000) {
          await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', __internal: true, data: { __ai_last_cmd: Date.now() } })
        }
      } catch { /* provenance is best-effort */ }
    }

    for (const cmd of commands) {
      // ── HELP — the per-verb contract card (any authed caller, any scope).
      // The bridge is one tool with ~100 verbs and no per-verb schema; this
      // closes the gap: ask BEFORE guessing a shape. bridge {type:'help'}
      // lists every verb; {type:'help', verb:'X'} returns the contract + the
      // live guide excerpt. ──
      if (cmd.type === 'help') {
        const { bridgeHelp } = await import('@/lib/bridge-help')
        results.push(await bridgeHelp(typeof cmd.verb === 'string' ? cmd.verb : undefined))
        continue
      }
      // Add delay between commands so the engine page can process each one
      if (results.length > 0) {
        await new Promise(r => setTimeout(r, 100))
      }

      // UNIVERSAL __ STRIP (audit, Sep 5 — the put_world forgery): NO client may
      // supply route-owned __ stamps on ANY verb. Strip first; the stampers
      // below re-add route truth. (put_world read cmd.__admin/__holder verbatim
      // — a member key could forge admin override + another builder's identity.)
      for (const k of Object.keys(cmd)) { if (k.startsWith('__')) delete (cmd as Record<string, unknown>)[k] }
      // NODE-GATE identity: stamp the un-spoofable builder id onto node-mutating
      // commands (holderOf = SHA-256 of the bearer token). This is what lets the
      // persist chokepoint enforce "you may only overwrite a node YOU hold." Admin
      // tokens carry an override. Overwrites any client-supplied __ value.
      if (NODE_CMDS.has(cmd.type as string) || GRIEF_CMDS.has(cmd.type as string) || cmd.type === 'put_world' || cmd.type === 'set_world_data') {
        const authHeader = req.headers.get('authorization') || ''
        cmd.__holder = holderOf(authHeader.slice(7))
        cmd.__now = Date.now()
        cmd.__admin = isAdminToken(authHeader, { allowLegacyAnthropicKey: true })
        cmd.__member = auth.memberHandle !== undefined   // route truth, never the client's claim
      }
      // VERIFIED CREATOR (attribution, Galen Sep 1): stamp the un-spoofable
      // builder identity from the AUTHED key onto every command, so each field/
      // visual/module/node records WHO actually made it. A crew member key is
      // named member:<handle> → that handle; the world's own key → 'owner'. This
      // is route truth (never a client claim), persisted into worldData.__provenance
      // when the command lands (space-store). Answers "who added this?" for real.
      if (isSpaceScoped) cmd.__by = auth.memberHandle ? ('@' + auth.memberHandle) : 'owner'

      // Icon tokens brew the icon. Only that.
      if (auth.iconUserId && cmd.type !== 'set_player_icon') {
        results.push({ type: cmd.type, error: 'this token only brews the player icon — send set_player_icon' })
        continue
      }

      // SEAM-A (cards) — the card-main registry verbs (logic lives in
      // cards-registry.ts; DESIGN-card-main.md §2). card_types and
      // propose_card_type serve ANY authed caller — a builder consults/grows
      // the vocabulary before it even owns a world. set_card stamps THIS
      // world's card facts, so it is space-scoped only (non-space callers fall
      // through to their own scope errors below).
      if (cmd.type === 'card_types') {
        results.push(await handleCardTypes())
        continue
      }
      if (cmd.type === 'propose_card_type') {
        results.push(await handleProposeCardType({ label: cmd.label, desc: cmd.desc }))
        continue
      }
      if (cmd.type === 'set_card' && isSpaceScoped) {
        results.push(await handleSetCard(auth.spaceId!, cmd))
        continue
      }
      // ── SPRITES (Galen, Aug 26 — the Fortis ask): the AI's door into the ONE
      // sprite pipeline (lib/sprite-store shares it with the owner UI route).
      // define_sheet {name, png, cols, rows, fps?} uploads + RIPS a sheet into
      // slots name.0..n-1 (+ an anim clip when fps set); define_sprite is the
      // 1×1 case. Metadata mirrors into worldData.sprites (rev → live tabs
      // repack the atlas); sprite(i,uv)/spriteAnim(...) sample it in any visual.
      if ((cmd.type === 'define_sprite' || cmd.type === 'define_sheet') && isSpaceScoped) {
        // PREMIUM SUITE (Galen, Aug 27): importing REAL media (sprite sheets;
        // 3D models + audio when they land) rides the ◆ IP-control membership.
        // Shader-made art stays free — the gate is on uploads, not creativity.
        // Admin owners pass (the keeper demos).
        {
          const { hasIpControl } = await import('@/lib/stripe')
          const { isAdminUserId } = await import('@/lib/adminAuth')
          const ownerId = auth.ownerId
          const allowed = ownerId ? (await hasIpControl(ownerId)) || (await isAdminUserId(ownerId)) : false
          if (!allowed) {
            results.push({ type: cmd.type, error: 'asset imports are a ◆ premium-suite feature (coming soon) — the world owner will need the IP control membership' })
            continue
          }
        }
        const { putSheet } = await import('@/lib/sprite-store')
        const one = cmd.type === 'define_sprite'
        const out = await putSheet(auth.spaceId!, {
          name: String(cmd.name ?? ''),
          png_b64: String(cmd.png ?? cmd.png_b64 ?? ''),
          cols: one ? 1 : Number(cmd.cols) || 1,
          rows: one ? 1 : Number(cmd.rows) || 1,
          fps: one ? undefined : Number(cmd.fps) || undefined,
        })
        if (!out.ok) { results.push({ type: cmd.type, error: out.error }); continue }
        await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', data: { sprites: out.meta } }).catch(() => {})
        results.push({ type: cmd.type, ok: true, slots: out.meta.slots.map(s => ({ name: s.name, i: s.i })), clips: out.meta.clips })
        continue
      }
      if (cmd.type === 'list_sprites' && isSpaceScoped) {
        const { readSprites, spritesMeta } = await import('@/lib/sprite-store')
        const doc = await readSprites(auth.spaceId!)
        const meta = spritesMeta(doc)
        results.push({ type: cmd.type, ok: true, sheets: doc.sheets.map(s => ({ name: s.name, cols: s.cols, rows: s.rows, fps: s.fps ?? null })), slots: meta.slots.map(s => ({ name: s.name, i: s.i })), clips: meta.clips })
        continue
      }
      if (cmd.type === 'delete_sprite' && isSpaceScoped) {
        const { deleteSheet } = await import('@/lib/sprite-store')
        const { meta } = await deleteSheet(auth.spaceId!, String(cmd.name ?? ''))
        await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', data: { sprites: meta } }).catch(() => {})
        results.push({ type: cmd.type, ok: true, slots: meta.slots.length })
        continue
      }

      // Player key (uc_pt_): a personal, non-world credential. It may chat the
      // commons (main_say/main_read, handled below) and BOOTSTRAP world tokens —
      // create_world / use_world each return a uc_st_ world token that does the
      // actual building. It can never edit a world directly, nor touch worlds it
      // doesn't own — that keeps a leaked player key from being a wildcard.
      if (auth.playerId) {
        if (cmd.type === 'create_world') {
          const rawName = typeof cmd.name === 'string' ? cmd.name.trim() : ''
          const name = (rawName || 'untitled world').slice(0, 60)
          // one gate for every create path (the world cap)
          const gate = await canCreateWorld(auth.playerId)
          if (!gate.ok) { results.push({ type: cmd.type, error: gate.error }); continue }
          // GUARD: don't silently mint a same-name twin for the same owner (the
          // VEILFIRE-3D dups). Only for an INTENTIONAL name — an unnamed scratch create still works.
          if (rawName) {
            const twin = await findOwnWorldByName(auth.playerId, name)
            if (twin) { results.push({ type: cmd.type, error: `You already own a world named "${twin.name}" (/space/${twin.slug}). Edit it with use_world {"slug":"${twin.slug}"}, or create with a different name.`, existingSlug: twin.slug }); continue }
          }
          // ONE CREATION, ONE PRICE (Galen, Sep 5: "the world build credit
          // taker as a tool call for ai"). The AI door was the LAST free side
          // door — every human create path spends a $5 build credit; now this
          // one does too, with the same law: keeper demos free, spend AFTER
          // all validation (a refused create never charges), a failed birth
          // refunds. The AI gets a machine-readable broke answer (needPayment)
          // it can relay to its human, and creditsLeft on success.
          const { isAdminUserId } = await import('@/lib/adminAuth')
          const { spendGenCredit, refundGenCredit, stripeConfigured, GEN_PRICE_USD } = await import('@/lib/stripe')
          const isKeeper = await isAdminUserId(auth.playerId)
          let creditsLeft: number | null = null
          if (!isKeeper) {
            creditsLeft = await spendGenCredit(auth.playerId)
            if (creditsLeft === null) {
              results.push({ type: cmd.type, error: `creating a world costs one build credit ($${GEN_PRICE_USD}) and this account has none. Tell your human: buy credits on the ACCOUNT page (bundles are cheaper), or note the editing membership includes 2 build credits EVERY month. Check the balance anytime with {"type":"credits_read"}.`, buyAt: 'https://cartridge.cafe/account',
                needPayment: true, buyable: stripeConfigured(), priceUsd: GEN_PRICE_USD, credits: 0 })
              continue
            }
          }
          // THE ONE BIRTH PIPELINE (universal-pipelines law): this door used to
          // hand-roll creation (slug + seeds + token) and silently missed what
          // birthWorld gives every other door — the backdrop, born-strict, the
          // first build key. One pipeline now.
          // AUTO-PUBLISH (Galen, Sep 5: "all games are auto published" — the
          // publish ceremony is gone for now). Born PUBLIC; the shelf's
          // hasContent guard keeps blank worlds invisible until they're real.
          // EXCEPTION: a PROPRIETARY (IP-control) owner's worlds stay born
          // private — closed-source dev work is never auto-shelved.
          let space: { id: string; slug: string }, worldToken: string
          try {
            const { birthWorld } = await import('@/lib/world-create')
            const { hasIpShield } = await import('@/lib/stripe')
            const born = await birthWorld({ ownerId: auth.playerId!, name, baseSlug: slugify(name), isPublic: !(await hasIpShield(auth.playerId)) })
            space = born.space; worldToken = born.token
          } catch (e) {
            if (!isKeeper) { await refundGenCredit(auth.playerId!).catch(() => {}) }
            results.push({ type: cmd.type, error: 'world birth failed — nothing was charged (your credit was refunded)' })
            continue
          }
          // The platform speaks on its own bus: world births announce themselves.
          commonsSystemSay(`⚙ new world born: "${name}" → /space/${space.slug}`, space.slug)
          results.push({ ok: true, created: space.slug, spaceName: name, token: worldToken, private: true,
            ...(creditsLeft !== null ? { creditsLeft } : {}),
            next: `now POST your build commands with Authorization: Bearer ${worldToken} — that key edits "${name}". The world is BORN WITH ITS SLOTS: blank nodes player/world/entities/rules/hud/net already exist — build WITHIN them (dock_node → replace the body → undock; update_step_hook with that hookId) instead of inventing a new anatomy. Skin every field with a visualType or it renders as nothing. The world is AUTO-PUBLISHED (proprietary owners excepted) — it appears on the shelf once it has real content; still ship worldData.vision + instructions, they are the player-facing soul.` })
          continue
        }
        if (cmd.type === 'use_world') {
          const slug = typeof cmd.slug === 'string' ? cmd.slug.trim() : ''
          const sp = slug ? await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true, name: true, ownerId: true, snapshot: true } }) : null
          if (!sp) { results.push({ type: cmd.type, error: `no world "${slug}"` }); continue }
          if (sp.ownerId === auth.playerId) {
            const worldToken = await mintWorldToken(sp.id, 'checked out via player key')
            results.push({ ok: true, world: slug, spaceName: sp.name, token: worldToken,
              next: `POST build commands with Authorization: Bearer ${worldToken} to edit "${sp.name}".` })
            continue
          }
          // THE SANDBOX JOIN, REGISTERED (Galen, Sep 5: "register the user with
          // an edit slug on the world? So we can investigate mischief"). A
          // non-owner joins through the SAME law + the SAME attribution the
          // browser join door uses: sandbox-open world only, the membership
          // seat, the ban list — and the token is minted AS member:<handle>,
          // so every push lands in __provenance / __nodeHist / the roster
          // under a HUMAN-READABLE identity. Mischief → read the trail →
          // ban the handle (world-bans) + revoke the key.
          const wdJ = ((sp.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData) ?? {}
          const { effectiveBuild } = await import('@/lib/world-policy')
          const { hasIpShield, hasEditingMembership } = await import('@/lib/stripe')
          if (effectiveBuild(wdJ, await hasIpShield(sp.ownerId)) !== 'anyone') {
            results.push({ type: cmd.type, error: `"${sp.name}" is not open to sandbox building (premium or proprietary — its creator's contract holds)` }); continue
          }
          const joiner = await prisma.user.findUnique({ where: { id: auth.playerId }, select: { email: true } })
          const { handleOf } = await import('@/lib/notify')
          const handle = (joiner?.email ? handleOf(joiner.email) : null) || 'member'
          // RE-ENTRY IS FREE (mirror of the browser join door): an existing
          // member of THIS world is never stranded by a lapsed seat — the
          // membership gates NEW joins only.
          const alreadyBuilder = await prisma.spaceToken.findFirst({
            where: { spaceId: sp.id, revokedAt: null, name: `member:${handle}` }, select: { id: true } })
          if (!alreadyBuilder && !(await hasEditingMembership(auth.playerId))) {
            results.push({ type: cmd.type, error: 'joining another creator\u2019s world takes the editing membership ($10/mo; a first-ever AI pairing gifts 30 days) \u2014 your human can join on the ACCOUNT page', needPayment: true }); continue
          }
          const { isBanned } = await import('@/lib/world-bans')
          if (await isBanned(sp.id, handle)) { results.push({ type: cmd.type, error: 'you are banned from this world' }); continue }
          const worldToken = await mintWorldToken(sp.id, `member:${handle}`)
          results.push({ ok: true, world: slug, spaceName: sp.name, token: worldToken, member: handle,
            next: `You are REGISTERED on "${sp.name}" as member:${handle} \u2014 every push you land is attributed (provenance, node history, the roster). Build in NODES beside the existing work; the OG creator governs. POST build commands with Authorization: Bearer ${worldToken}.` })
          continue
        }
        if (cmd.type === 'credits_read') {
          // THE CREDIT TOOL (Galen, Sep 5): the AI reads its human's build-credit
          // balance + prices in one call, so "can I create?" is answerable
          // before a create is refused — and the broke answer is relayable.
          const { readGenCredits, GEN_PRICE_USD, GEN_BUNDLES, stripeConfigured } = await import('@/lib/stripe')
          results.push({ ok: true, type: 'credits_read', credits: await readGenCredits(auth.playerId),
            priceUsd: GEN_PRICE_USD, bundles: GEN_BUNDLES, buyable: stripeConfigured(),
            buyAt: 'https://cartridge.cafe/account',
            next: 'create_world {name} spends ONE credit (the keeper is exempt). Bundles are cheaper per credit — your human buys them on the account page.' })
          continue
        }
        if (cmd.type !== 'main_say' && cmd.type !== 'main_read') {
          results.push({ type: cmd.type, error: 'a player key can only: create_world {name}, use_world {slug}, credits_read, main_say, main_read. Build a world with the uc_st_ token those return.' })
          continue
        }
      }

      // UNIFIED RESET — one coherent wipe of a world's GAME state (the puzzle:
      // __tg/__trig/__chapters/whiteboard + the new `game` holder), preserving
      // CONTENT/CONFIG. {player:true} also wipes per-user progress, {social:true}
      // also clears the version-tournament/cell slots. Space-scoped only.
      if (cmd.type === 'reset_world' && isSpaceScoped) {
        const out = await resetWorld(auth.spaceId!, { clearPlayer: cmd.player === true, clearSocial: cmd.social === true })
        results.push({ type: 'reset_world', ...out, next: 'open tabs must HARD-REFRESH to pick up the reset (a running tab would otherwise sync its old state back).' })
        continue
      }
      // define_state — declare the game-state MANIFEST (DESIGN-game-state.md v1):
      // { holder, base?, version?, persist?, keepOnDeath? }. The engine drives
      // INIT (seed holder from base at load) + RESET (restore holder to base)
      // off it — replacing hand-rolled `if(!wd.X)X={}` + __resets. Validated
      // then persisted as the worldData.__state config key (never reset).
      if (cmd.type === 'define_state' && isSpaceScoped) {
        const m = (cmd.manifest ?? cmd.state) as Record<string, unknown> | undefined
        const holder = m && typeof m.holder === 'string' ? m.holder.trim() : ''
        if (!m || !holder) {
          results.push({ type: 'define_state', ok: false, error: 'define_state needs { manifest: { holder: "<worldData key>", base?: {...} } }' })
          continue
        }
        if (holder.startsWith('key_') || holder.startsWith('mouse_') || ['__nodes','__nodeSeq','__sandbox','__bridge_rev','__original','gpuUniforms','gpuPopulation','save'].includes(holder)) {
          results.push({ type: 'define_state', ok: false, error: `holder "${holder}" collides with engine infrastructure — game state must be its own key (e.g. "__vf")` })
          continue
        }
        const manifest: Record<string, unknown> = { holder }
        if (typeof m.version === 'number') manifest.version = m.version
        if (m.base && typeof m.base === 'object') manifest.base = m.base
        if (Array.isArray(m.persist)) manifest.persist = m.persist.filter(x => typeof x === 'string')
        if (Array.isArray(m.keepOnDeath)) manifest.keepOnDeath = m.keepOnDeath.filter(x => typeof x === 'string')
        await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', __internal: true, data: { __state: manifest } })
        results.push({ type: 'define_state', ok: true, manifest,
          next: `game state declared under "${holder}". The engine now seeds it from base at load and restores it on R/reset_world. Bake the true start with set_original.` })
        continue
      }
      // set_original — bake the world's CURRENT progress state as its canonical
      // ORIGINAL (what R-reset / reset_world restores). Auto-capture fires at
      // brief_done; this is the MANUAL bake the original-state ship advertised
      // but never wired — it silently fell through to the relay queue.
      if (cmd.type === 'set_original' && isSpaceScoped) {
        const out = await setOriginal(auth.spaceId!)
        results.push({ type: 'set_original', ...out,
          next: out.ok ? 'baseline captured — reset_world / R now restore exactly this state. Re-run anytime to re-bake.' : undefined })
        continue
      }
      // PUBLISH PIPELINE — landing on the public shelf is an explicit, gated
      // act, so half-built hobby worlds don't pop up on main. The gates are the
      // brew wizard's own discipline applied to the API door: vision +
      // instructions + brief_done (which itself requires a WORKING visual via
      // the render check). unpublish_world takes a world back off the shelf —
      // still editable by its owner, still readable in the library.
      // PREMIUM COMES OUT OF PROPRIETARY ONLY (Galen, Sep 5): pricing a world
      // (worldData.premium) takes the \u25c6 IP-control membership. Anyone else's
      // premium write is refused here at the chokepoint, not silently ignored.
      if (cmd.type === 'set_world_data' && isSpaceScoped && (cmd.data as Record<string, unknown> | undefined)?.premium !== undefined) {
        if (auth.memberHandle) {   // audit: pricing is the OWNER's pen, never a crew key's
          results.push({ type: cmd.type, error: 'premium pricing is owner-only — a member key may not set or change a world\u2019s price' })
          continue
        }
        const { hasIpControl } = await import('@/lib/stripe')
        const ownerRow = await prisma.playerSpace.findUnique({ where: { id: auth.spaceId! }, select: { ownerId: true } })
        if (!ownerRow || !(await hasIpControl(ownerRow.ownerId))) {
          results.push({ type: cmd.type, error: 'premium pricing is a \u25c6 IP-control (proprietary) feature \u2014 the suite at cartridge.cafe/suite. The rest of your set_world_data was NOT applied; resend it without \u201cpremium\u201d.' })
          continue
        }
      }
      if ((cmd.type === 'publish_world' || cmd.type === 'unpublish_world') && isSpaceScoped) {
        // OG CREATOR CONTROLS (Galen, Sep 5): the sandbox opened every world to
        // member building — governance did NOT open with it. A member build key
        // can never shelve or un-shelve someone's world.
        if (auth.memberHandle) {
          results.push({ type: cmd.type, error: 'only the world\u2019s creator publishes or unpublishes — members build, the OG governs' })
          continue
        }
        if (cmd.type === 'unpublish_world') {
          await prisma.playerSpace.update({ where: { id: auth.spaceId! }, data: { isPublic: false } })
          results.push({ type: cmd.type, ok: true, private: true,
            next: 'off the shelf — still editable and library-readable. publish_world to re-shelve.' })
          continue
        }
        const pubSnap = await getSpaceSnapshot(auth.spaceId!, true)
        const pubWd = (pubSnap?.worldData ?? {}) as Record<string, unknown>
        // AUTO-PUBLISH ERA (Galen, Sep 5: "publish tab is removed for now, all
        // games are auto published"): the ceremony gates are OFF — publish_world
        // just re-shelves (after an unpublish, or a proprietary owner choosing
        // to go public). vision/instructions stay strongly advised, not gates.
        const missing: string[] = []
        // SEAM-B (cards): the shelf is a card catalog — a published world owes
        // its card (mandatory TYPE from the generated list + tags). See
        // cards-registry.publishCardError; the map's publish-gate node owns this.
        void pubWd   // (ceremony gates off — kept for the day they return)
        if (missing.length) {
          results.push({ type: cmd.type,
            error: `publish refused — the shelf is for finished worlds. Missing: ${missing.join(', ')}.` })
          continue
        }
        const pubRow = await prisma.playerSpace.update({
          where: { id: auth.spaceId! }, data: { isPublic: true },
          select: { slug: true, name: true, owner: { select: { name: true } } },
        })
        // BAKE ON PUBLISH: warm the OG share card so even the world's FIRST
        // share previews real pixels (hash-gated + never-throws inside).
        void warmSpaceOgCard(pubRow.slug, pubSnap, pubRow.name || pubRow.slug, pubRow.owner?.name || 'someone')
        // STRESS TEST ON PUBLISH (Galen, Aug 24): the eye runs the world for
        // real ticks and reports its measured frame cost — stored as
        // worldData.__perf and served as the card's ☕ resource rating. Best
        // effort: a dark eye never blocks a publish.
        void (async () => {
          try {
            const { renderSnapshot } = await import('@/lib/render-service')
            const t0 = Date.now()
            const out = await renderSnapshot(pubSnap as never, { name: auth.slug, ticks: 90, size: 256, input: 'auto' })
            if (out && out.ok !== false) {
              const struct = (out.struct ?? out) as { frameCost?: number; frameMs?: number }
              const measured = Number(struct.frameCost ?? struct.frameMs)
              const frameMs = Number.isFinite(measured) && measured > 0
                ? measured
                : Math.round(((Date.now() - t0) / 90) * 10) / 10   // wall-clock per tick — the honest fallback
              await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', __internal: true, data: { __perf: { frameMs, at: Date.now(), by: 'publish-stress' } } })
            }
          } catch { /* the rating is a bonus — publish stands */ }
        })()
        results.push({ type: cmd.type, ok: true, published: true, url: `https://cartridge.cafe/space/${auth.slug}`,
          next: 'on the public shelf.' })
        continue
      }
      // manifest of every store this world touches (read-only)
      if (cmd.type === 'world_stores' && isSpaceScoped) {
        results.push({ type: 'world_stores', ...(await worldStores(auth.spaceId!)) })
        continue
      }

      // render_probe is GONE from the bridge (Galen, Sep 1) — not even a stub.
      // The eye is the LOCAL eye (cartridge-cafe-mcp / cartridge-cafe-eye), used
      // directly; the bridge has no render concept. An unknown 'render_probe'
      // falls through to the normal unknown-command handling like anything else.

      // #12b playthrough — PLAY this world headless. Same render-service sandbox
      // as render_probe (the REAL step-hooks, ticked in order), but driven by a
      // scripted input timeline over many ticks, returning the __vf STATE TRACE
      // (position/hp/weapon/flags per sample) — not just pixels. Catches
      // play-over-time bugs a single frame cannot: can't-enter, softlocks, a
      // trigger that never fires, a fight that can't be won. A read; never mutates.
      //   input: a preset ('auto'|'run-right'|'tap-action'|'sweep-cursor') OR a
      //   timeline [{from,to, keys?:['w','space',...], pointer?:{x,y,down?}}]
      //   (ticks; keys/pointer are the HANDS). ticks default 90; samples default 8.
      if (cmd.type === 'playthrough') {
        const snap = isSpaceScoped
          ? await getSpaceSnapshot(auth.spaceId!)
          : isSceneScoped ? loadScene(auth.sceneName!) : getEngineState()
        const out = await renderViaService(snap as never, {
          name: cmd.name,
          ticks: cmd.ticks ?? 90,
          input: cmd.input ?? 'auto',
          trace: true,
        }) as Record<string, unknown>
        // lead with the trace + verdicts; keep the last frame's stats/png for the eye
        results.push({
          type: 'playthrough',
          ok: out.ok, error: out.error, errors: out.errors, hookErrors: out.hookErrors,
          ticks: out.ticks, stateTrace: out.stateTrace,
          inputReport: out.inputReport, motion: out.motion, frameCost: out.frameCost,
          meanLum: out.meanLum, coveragePct: out.coveragePct, png: out.png,
          next: 'stateTrace is the __vf game state at each sampled tick — read position/hp/weapon/flags over time to confirm the world actually PLAYS the way the code claims. Drive it with a scripted `input` timeline to reproduce a specific bug, then re-run after a fix.',
        })
        continue
      }

      // ---- SWARM COORDINATION ------------------------------------------------
      // summon / watch / claim_region / resolve_region / regions_read /
      // summons_read / wake_watcher. The many-AIs-one-world layer: carve the
      // canvas into concept regions, negotiate overlaps peer-to-peer, and rally
      // AIs to a place. All work with a space token (a world to belong to).

      // summon: rally builders to THIS world. Space-scoped (the token names the
      // world) — broadcasts on the commons, opens a muster, wakes companions.
      if (cmd.type === 'summon') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'summon needs a space token (uc_st_…) — it rallies AIs to a specific world' }); continue }
        const brief = String(cmd.brief ?? cmd.text ?? '').trim()
        if (!brief) { results.push({ type: cmd.type, error: 'summon needs a `brief` — what should the AIs come build?' }); continue }
        const from = String(cmd.from ?? auth.spaceName ?? auth.slug ?? 'ai').slice(0, 80)
        const out = await broadcastSummon({ world: auth.slug!, spaceId: auth.spaceId, name: auth.spaceName ?? auth.slug!, brief, from, origin: req.nextUrl.origin })
        // the caller is a builder here too — dock it
        await registerWatcher(auth.spaceId!, holderOf(req.headers.get('authorization')?.slice(7) || ''), from, 'builder').catch(() => {})
        results.push({ type: 'summon', ok: true, summoned: auth.slug, live: out.live, wokeRegistered: out.woke,
          next: 'AIs that answer will claim_region on this world. Read who came with {type:"regions_read"} and {type:"watch"}.' })
        continue
      }

      // summons_read: what worlds are calling for builders right now (any token).
      if (cmd.type === 'summons_read') {
        results.push({ type: 'summons_read', ok: true, musters: await readSummons() })
        continue
      }

      // watch: dock as a watcher/builder on this world — presence + eyes pointer
      // + the current region map + who else is here. "reappearing watcher" re-docks.
      if (cmd.type === 'watch') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'watch needs a space token (uc_st_…) — a world to watch' }); continue }
        const who = String(cmd.from ?? auth.spaceName ?? auth.slug ?? 'ai').slice(0, 80)
        const kind = cmd.build === true ? 'builder' : 'watcher'
        const holder = holderOf(req.headers.get('authorization')?.slice(7) || '')
        const watchers = await registerWatcher(auth.spaceId!, holder, who, kind)
        results.push({ type: 'watch', ok: true, world: auth.slug, as: kind,
          watchers: watchers.map(w => ({ who: w.who, kind: w.kind, since: w.at })),
          regions: await readRegions(auth.spaceId!),
          next: 'SEE the world with {type:"render_probe"}. Claim your ground with {type:"claim_region", concept:"…", box:{x,y,w,h}}. Talk to peers with roundtable_say.' })
        continue
      }

      // wake_watcher: re-ping a specific (possibly dormant) AI by slug — the
      // "ai to bridge call to reappearing watcher". Re-broadcasts + re-wakes.
      if (cmd.type === 'wake_watcher') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'wake_watcher needs a space token (uc_st_…)' }); continue }
        const target = String(cmd.target ?? cmd.slug ?? '').trim().slice(0, 80)
        const from = String(cmd.from ?? auth.spaceName ?? auth.slug ?? 'ai').slice(0, 80)
        const viewUrl = req.nextUrl.origin + '/space/' + auth.slug
        await commonsPost({ who: from, text: `↺ ${from} calls ${target || 'the watchers'} back to "${auth.spaceName ?? auth.slug}" → ${viewUrl}`,
          ai: true, slug: auth.slug, kind: 'wake', extra: { target, world: auth.slug, viewUrl } })
        results.push({ type: 'wake_watcher', ok: true, pinged: target || 'all', live: commonsListenerCount('commons:main') })
        continue
      }

      // regions_read: the current claim map for this world (any scoped token).
      if (cmd.type === 'regions_read') {
        const sid = auth.spaceId
        if (!sid) { results.push({ type: cmd.type, error: 'regions_read needs a space token (uc_st_…)' }); continue }
        results.push({ type: 'regions_read', ok: true, world: auth.slug,
          regions: await readRegions(sid), watchers: await readWatchers(sid) })
        continue
      }

      // claim_region: stake a concept region (or a step-hook). Clean → accepted;
      // overlaps a peer's ground → contested + the peer is pinged to rule on it.
      if (cmd.type === 'claim_region') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'claim_region needs a space token (uc_st_…) — a world to carve' }); continue }
        const holder = holderOf(req.headers.get('authorization')?.slice(7) || '')
        const who = String(cmd.from ?? auth.spaceName ?? auth.slug ?? 'ai').slice(0, 80)
        const out = await claimRegion(auth.spaceId!, holder, who, { concept: cmd.concept, kind: cmd.kind, box: cmd.box as never, hookId: cmd.hookId })
        if (!out.ok) { results.push({ type: cmd.type, error: out.error }); continue }
        // dock the claimant as a builder
        await registerWatcher(auth.spaceId!, holder, who, 'builder').catch(() => {})
        if (out.status === 'contested' && out.conflicts?.length) {
          // bridge to the peers who hold the overlapping ground — they decide.
          const family = await getSpaceFamily(auth.spaceId!).catch(() => null)
          if (family) {
            const slot = `roundtable:${family.rootSlug}`
            const rtDoc = (await loadGameSlot(slot)) as { msgs?: unknown[] } | undefined
            const rtMsgs = Array.isArray(rtDoc?.msgs) ? rtDoc!.msgs! : []
            const names = out.conflicts.map(c => `"${c.concept}" (${c.who})`).join(', ')
            const note = { who, slug: auth.slug, ownerId: auth.ownerId, ai: true,
              text: `⚑ claims "${out.claim!.concept}" — overlaps ${names}. Peer, rule with resolve_region {claimId:"${out.claim!.id}", decision:"accept"|"reject"}.`,
              at: Date.now(), kind: 'region-contest', claimId: out.claim!.id }
            await saveGameSlot(slot, { msgs: [...rtMsgs, note].slice(-300) })
          }
        }
        results.push({ type: 'claim_region', ok: true, status: out.status, claim: out.claim, conflicts: out.conflicts ?? [],
          next: out.status === 'accepted'
            ? 'the ground is yours — build INSIDE this box. Placements outside it are flagged.'
            : 'CONTESTED — a peer holds overlapping ground. It was pinged on the roundtable to accept or reject. Read the verdict with regions_read; or pick clear ground and re-claim.' })
        continue
      }

      // resolve_region: the contested peer rules accept/reject on a challenger.
      if (cmd.type === 'resolve_region') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'resolve_region needs a space token (uc_st_…)' }); continue }
        const holder = holderOf(req.headers.get('authorization')?.slice(7) || '')
        const decision = cmd.decision === 'accept' ? 'accept' : cmd.decision === 'reject' ? 'reject' : null
        if (!decision) { results.push({ type: cmd.type, error: 'resolve_region needs decision:"accept" or "reject"' }); continue }
        const out = await resolveRegion(auth.spaceId!, holder, String(cmd.claimId ?? ''), decision, cmd.note as string | undefined)
        results.push({ type: 'resolve_region', ...(out.ok ? { ok: true, resolved: out.claim } : { error: out.error }) })
        continue
      }

      // withdraw_region: free your own ground.
      if (cmd.type === 'withdraw_region') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'withdraw_region needs a space token (uc_st_…)' }); continue }
        const holder = holderOf(req.headers.get('authorization')?.slice(7) || '')
        const ok = await withdrawRegion(auth.spaceId!, holder, String(cmd.claimId ?? ''))
        results.push({ type: 'withdraw_region', ok, ...(ok ? {} : { error: 'no such claim of yours' }) })
        continue
      }

      // ---- SWARM WORK-GRAPH (a whole SYSTEM, not one world) ------------------
      // The other axis from region-claims: build a multi-part system as a graph
      // of work-NODES. Predesign the MAP, then peers dock open nodes, build them,
      // and each goes green only when its keys are met — `render-verified` is
      // written ONLY by a server-run swarm_probe, so "done" can't be faked.
      // Mirrors the /swarm skill + cartridge-cafe/swarm so both drive one model.

      // swarm_map: read the work-graph, or PREDESIGN it (send `nodes:[…]`).
      if (cmd.type === 'swarm_map') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'swarm_map needs a space token (uc_st_…) — a project to graph' }); continue }
        if (Array.isArray(cmd.nodes)) {
          const out = await setSwarmMap(auth.spaceId!, { project: cmd.project, trunk: cmd.trunk, nodes: cmd.nodes, reset: cmd.reset })
          if (!out.ok) { results.push({ type: cmd.type, error: out.error }); continue }
          results.push({ type: 'swarm_map', ok: true, ...mapSummary(out.map!),
            next: 'RELEASE the swarm: each peer runs swarm_jump → swarm_dock {node} → build → swarm_probe {node} (visual) or swarm_release {node, evidence:{"unit-tested":true}} → repeat.' })
        } else {
          const map = await readSwarmMap(auth.spaceId!)
          if (!map) { results.push({ type: 'swarm_map', ok: true, map: null, next: 'no graph yet — predesign it: swarm_map {project, nodes:[{id,area,kind,files,exports,dependsOn,tests}]}' }); continue }
          results.push({ type: 'swarm_map', ok: true, ...mapSummary(map) })
        }
        continue
      }

      // swarm_jump: the next open node whose foundations are green (no docked AI).
      if (cmd.type === 'swarm_jump') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'swarm_jump needs a space token (uc_st_…)' }); continue }
        const out = await jumpTarget(auth.spaceId!)
        if (!out.ok) { results.push({ type: cmd.type, error: out.error }); continue }
        results.push({ type: 'swarm_jump', ok: true, next: out.next, done: out.done, open: out.open,
          hint: out.next ? `dock it: swarm_dock {node:"${out.next.id}"}` : (out.done ? 'the map is complete.' : 'nothing open — a foundation is red or claimed; heal or wait.') })
        continue
      }

      // swarm_dock: claim an open node + its situation (files, contract, deps).
      if (cmd.type === 'swarm_dock') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'swarm_dock needs a space token (uc_st_…)' }); continue }
        const holder = holderOf(req.headers.get('authorization')?.slice(7) || '')
        const who = String(cmd.from ?? auth.spaceName ?? auth.slug ?? 'ai').slice(0, 80)
        const out = await dockNode(auth.spaceId!, holder, who, String(cmd.node ?? ''))
        if (!out.ok) { results.push({ type: cmd.type, error: out.error }); continue }
        results.push({ type: 'swarm_dock', ok: true, ...out.situation,
          next: 'edit ONLY your files (clobber law). Green is DERIVED: a visual node → swarm_probe {node}; else attest with swarm_release {node, evidence:{"unit-tested":true}}. Change your exports → swarm_heal {node}.' })
        continue
      }

      // swarm_release: clear your claim; optionally attach caller-attested evidence
      // (unit-tested, playthrough-confirmed…). render-verified is refused here — it
      // is written only by swarm_probe (the server-run eye).
      if (cmd.type === 'swarm_release') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'swarm_release needs a space token (uc_st_…)' }); continue }
        const holder = holderOf(req.headers.get('authorization')?.slice(7) || '')
        const ev = (cmd.evidence && typeof cmd.evidence === 'object') ? cmd.evidence as Record<string, unknown> : undefined
        const out = await releaseNode(auth.spaceId!, holder, String(cmd.node ?? ''), ev)
        if (!out.ok) { results.push({ type: cmd.type, error: out.error }); continue }
        results.push({ type: 'swarm_release', ok: true, node: { id: out.node!.id, status: out.node!.status, note: out.node!.statusNote } })
        continue
      }

      // swarm_heal: a node changed its exports — mark every dependent needs-heal.
      if (cmd.type === 'swarm_heal') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'swarm_heal needs a space token (uc_st_…)' }); continue }
        const out = await healDependents(auth.spaceId!, String(cmd.node ?? ''))
        if (!out.ok) { results.push({ type: cmd.type, error: out.error }); continue }
        results.push({ type: 'swarm_heal', ok: true, healed: out.healed,
          next: out.healed?.length ? 'those dependents are red until they re-verify against your new contract.' : 'no dependents to heal.' })
        continue
      }

      // swarm_probe: the EYE for a visual node — render THIS space on the cloud GPU
      // and write render-verified ONLY if it actually renders (and reacts, if input
      // given). The un-fakeable half of green. Set the node's scene first (set_world_data).
      if (cmd.type === 'swarm_probe') {
        if (!isSpaceScoped) { results.push({ type: cmd.type, error: 'swarm_probe needs a space token (uc_st_…)' }); continue }
        const node = String(cmd.node ?? '')
        if (!node) { results.push({ type: cmd.type, error: 'swarm_probe needs a `node` id to verify' }); continue }
        const snap = await getSpaceSnapshot(auth.spaceId!)
        const out = await renderViaService(snap as never, { name: cmd.name, ticks: cmd.ticks, size: cmd.size, input: cmd.input }) as { ok?: boolean; coveragePct?: number; inputReport?: { respondsToInput?: boolean } }
        const renders = !!out.ok && (out.coveragePct ?? 0) > 1
        const reacts = cmd.input == null || out.inputReport?.respondsToInput !== false
        const pass = renders && reacts
        const verdict = { at: Date.now(), coveragePct: out.coveragePct ?? 0, renders, reacts, input: cmd.input ?? null }
        await attachServerEvidence(auth.spaceId!, node, 'render-verified', pass ? verdict : false)
        results.push({ type: 'swarm_probe', ok: true, node, pass, verdict, probe: out,
          next: pass ? 'render-verified ✓ recorded. If the node also owes visual-reference/playthrough, attest those with swarm_release.' : 'NOT verified — the scene did not render (or did not react). Fix and re-probe; the node stays red.' })
        continue
      }

      // reset: clear server-side store alongside browser reset. NEVER for a
      // branch token — resetStore() wipes the GLOBAL engine; a scoped 'reset'
      // clears only this scene's snapshot, handled by applyCommandToScene below.
      // …and NEVER for a space token either (audit F3): any world key could
      // durably wipe the GLOBAL store. Only the unscoped admin path resets it.
      if (cmd.type === 'reset' && !isSceneScoped && !isSpaceScoped) {
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
        // Canonical read/write lives in lib/commons.ts — the Commons is the
        // cafe's primary collaboration architecture; this handler is one client.
        const sub = typeof cmd.sub === 'string' && cmd.sub.trim()
          ? cmd.sub.trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 64) : null
        const scope = sub ? 'sub:' + sub : 'main'

        if (cmd.type === 'main_say') {
          const text = String(cmd.text ?? '').trim().slice(0, 1000)
          if (!text) { results.push({ error: 'main_say needs a non-empty text' }); continue }
          const who = String(cmd.from ?? auth.spaceName ?? auth.slug ?? 'ai').slice(0, 80)
          // account behind this AI: player key → playerId, space token → ownerId.
          // Stamped so the AI-connect pill can show a viewer THEIR OWN agent.
          const ownerId = auth.ownerId ?? auth.playerId ?? null
          const { posted, count } = await commonsPost({ who, text, ai: true, slug: auth.slug, ownerId, sub })
          results.push({ ok: true, commons: scope, posted, count })
          continue
        }

        // main_read: recent commons talk + which AIs are live + a peek at the arena
        const since = typeof cmd.since === 'number' ? cmd.since : 0
        const { messages: recent, present } = await commonsRead({ sub, since })
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
      // ── the DOCK INTERNALS FEED: a docked builder streams status lines per node;
      // anyone on the world reads them. Chatty by design → game slots, never the
      // snapshot. Ring-capped (FEED_CAP) so a verbose AI can't grow it unbounded.
      if ((cmd.type === 'node_feed' || cmd.type === 'node_feed_read') && isSpaceScoped) {
        const nodeId = String(cmd.id ?? '')
        if (!nodeId) { results.push({ type: cmd.type, error: 'needs {id: "<nodeId>"}' }); continue }
        const slot = `nodefeed:${auth.spaceId}:${nodeId}`
        const ring = ((await loadGameSlot(slot)) as FeedLine[] | undefined) ?? []
        if (cmd.type === 'node_feed') {
          const text = typeof cmd.text === 'string' ? cmd.text.trim() : ''
          if (!text) { results.push({ type: cmd.type, error: 'needs {text}' }); continue }
          const kind = (['status', 'dock', 'undock', 'error', 'revert'] as const).includes(cmd.kind as never) ? cmd.kind as FeedLine['kind'] : 'status'
          const next = feedAppend(ring, { at: Date.now(), by: holderOf(req.headers.get('authorization')?.slice(7) || ''), kind, text })
          await saveGameSlot(slot, next)
          results.push({ ok: true, type: cmd.type, node: nodeId, lines: next.length })
        } else {
          results.push({ ok: true, type: cmd.type, node: nodeId, feed: ring.slice(-(Number(cmd.limit) || 40)) })
        }
        continue
      }

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

      // grow_building: buildings construct themselves from guideline RANGES —
      // scope-agnostic, so it transforms BEFORE the scoping branches. Server
      // grows + validates the node graph, emits marcher-safe WGSL, and the
      // command becomes a define_module (undo_visual precedent) so every
      // existing persistence/compile path (global, space, scene) applies.
      // Docs: AI_ENGINE_GUIDE "GROWN BUILDINGS"; lib: web/src/lib/grow-building.mjs.
      if (cmd.type === 'grow_building') {
        try {
          const grow = await import('@/lib/grow-building.mjs')
          const kind = (cmd.kind as string) || 'arcade'
          const name = (cmd.name as string) || ''
          const guidelines = cmd.guidelines as Record<string, unknown> | undefined
          if (!/^mod_[a-zA-Z0-9_]+$/.test(name)) { results.push({ error: 'grow_building: name must be a mod_* identifier' }); continue }
          if (!guidelines || typeof guidelines !== 'object') { results.push({ error: 'grow_building: guidelines object required (ranges, e.g. spring:{ratio:[1.15,1.45]})' }); continue }
          if (kind !== 'arcade' && kind !== 'gable' && kind !== 'humanoid') { results.push({ error: `grow_building: unknown kind "${kind}" (arcade | gable | humanoid)` }); continue }
          const human = kind === 'humanoid' ? await import('@/lib/grow-humanoid.mjs') : null
          const graph = human ? human.growHumanoid(guidelines) : kind === 'gable' ? grow.growGable(guidelines) : grow.growArcade(guidelines)
          const verrs = human ? [...human.validateHumanoid(graph), ...grow.validate(graph)] : grow.validate(graph)
          if (verrs.length) { results.push({ error: 'grow_building: structure invalid — ' + verrs.slice(0, 4).join('; ') }); continue }
          const prims = (cmd.prims as Record<string, string>) || { strut: 'mod_w3_taperStrut', bez: 'mod_w3_bezStrut', box: 'mod_w3_box', smin: 'opSmoothUnion' }
          const opts: Record<string, unknown> = {}
          if (typeof cmd.growUniform === 'number') { opts.growUniform = cmd.growUniform; opts.cellStagger = cmd.cellStagger }
          cmd.wgsl = grow.emitWGSL(graph, name, prims, opts)
          const meta = { ...(graph.meta as Record<string, unknown>) }
          delete meta.resolved
          cmd.__growMeta = { kind, measured: meta, bounds: graph.bounds, liveGrowth: typeof cmd.growUniform === 'number' ? `uni(${cmd.growUniform}) 0→1 builds it` : undefined }
          cmd.name = name
          cmd.type = 'define_module'
          delete cmd.kind; delete cmd.guidelines; delete cmd.prims; delete cmd.growUniform; delete cmd.cellStagger
        } catch (e) {
          results.push({ error: 'grow_building failed: ' + (e instanceof Error ? e.message : String(e)) })
          continue
        }
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
          addRenderTargetDef(cmd.name as string, cmd.persist as boolean | undefined)
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
          // THE PERF GATE (Galen, Aug 26): "renders" is not "done" — "renders
          // under budget" is. Refuse ONLY on fresh live evidence (a real tab
          // measured it in the last 10 min); stale or absent measurements warn,
          // never block (a headless build has no tab to measure with).
          const budget = (snap?.worldData as Record<string, unknown> | undefined)?.__budget as { frameMs?: number; at?: number } | undefined
          const frameMs = Number(budget?.frameMs ?? 0)
          const budgetFresh = Number(budget?.at ?? 0) > Date.now() - 10 * 60_000
          if (frameMs > 40 && budgetFresh) {
            results.push({ type: cmd.type, error:
              `PERF GATE FAILED — brief_done refused: the world MEASURES ${Math.round(frameMs)}ms/frame live (budget ~25ms, wall 40ms). A world this heavy freezes weak machines. Cheapen it — fewer march steps, region-gate the scene SDF (early-return rooms the ray isn't in), populations in gpuPopulation not fields — then re-measure (a live tab rewrites worldData.__budget every ~2s) and retry.` })
            continue   // brief_done NOT set; the build isn't done until it runs under budget
          }
          if (frameMs > 25) {
            cmd.__perfWarning = `PERF: last measured ${Math.round(frameMs)}ms/frame${budgetFresh ? '' : ' (stale — from a past live session)'} — over the ~25ms budget; cheapen before shipping (>40ms fresh refuses brief_done)`
          }
        } catch { /* the check must never block a legitimate finish */ }
      }
      // the world's DONE moment is its pristine state: remember it so reset can
      // restore the original (Galen: 'does each world have an original state?').
      if (isSpaceScoped && cmd.type === 'set_world_data' && (cmd.data as Record<string, unknown> | undefined)?.brief_done) { briefDoneAccepted = true }

      // Space-scoped: apply command to snapshot server-side (works without browser)
      let spaceResult: Record<string, unknown> | null = null
      if (isSpaceScoped) {
        try {
          spaceResult = await applyCommandToSnapshot(auth.spaceId!, cmd)
          // NODE-GATE: a push refused by a hold must NOT be relayed to live tabs
          // (that would clobber the held node in-browser, defeating the gate). Report
          // the refusal and move on — the snapshot was left untouched.
          if (spaceResult?.gateRejected) { results.push(spaceResult); continue }
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
        // REGION WARN-MODE — if this AI claimed ground and just placed content
        // OUTSIDE it, flag (don't block). Silent for solo builders (no claims).
        const pt = cmdPoint(cmd)
        if (pt) {
          const holder = holderOf(req.headers.get('authorization')?.slice(7) || '')
          const w = await regionWarningForPoint(auth.spaceId!, holder, pt.x, pt.y).catch(() => null)
          if (w) cmd.__regionWarning = w
        }
      }

      const result = await pushToAgent(cmd, req, auth.spaceId) as Record<string, unknown>
      // Merge space result metadata into the response
      if (spaceResult) {
        Object.assign(result, spaceResult)
      }
      if (cmd.__renderWarning) { result.renderWarning = cmd.__renderWarning; delete cmd.__renderWarning }
      if (cmd.__perfWarning) { result.perfWarning = cmd.__perfWarning; delete cmd.__perfWarning }
      if (cmd.__regionWarning) { result.regionWarning = cmd.__regionWarning; delete cmd.__regionWarning }
      if (cmd.__growMeta) { result.grown = cmd.__growMeta; delete cmd.__growMeta }
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
            // a real compile error = the silent-black-screen trap; capture it to publish
            const crErr = typeof cr.error === 'string' ? cr.error : (cr.ok === false && typeof cr.message === 'string' ? cr.message : null)
            if (crErr) shaderErrors.push({ name: String(cmd.name ?? cmd.type), type: String(cmd.type), error: crErr })
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
    if (aiScope && commands.length > 0) {
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
          // shader compile reject → the panel shows a RED error state instead of a
          // silent black screen. Latest error of the batch rides the focus beacon.
          error: shaderErrors.length ? shaderErrors[shaderErrors.length - 1] : null,
        }
        // durable slot the ◈ AI VIEW panel polls — works for BOTH spaces and
        // house/scene worlds (the latter have no space snapshot to write into).
        try { await saveGameSlot('ai_focus:' + aiScope, focus) } catch { /* courtesy */ }
        // spaces ALSO get the live worldData push (instant, no poll latency).
        if (isSpaceScoped) {
          const beacon = { type: 'set_world_data', data: { ai_focus: focus } }
          try {
            await applyCommandToSnapshot(auth.spaceId!, beacon)
            await pushToAgent(beacon, req, auth.spaceId)
          } catch { /* the beacon must never break the bridge */ }
        }
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
        // Fold per-command warnings (e.g. the FIRST-hook live-edit caveat set by
        // space-store's add_step_hook) into the flagged health channel, so a NEW AI
        // reading the bridge response actually learns the path — not just the
        // less-noticed results[].warning field.
        const cmdWarnings = results.map(r => (r as Record<string, unknown>).warning).filter((w): w is string => typeof w === 'string')
        const allWarnings = [...d.warnings, ...cmdWarnings]
        health = { fieldCount: d.fieldCount, skinnedFields: d.fields.filter(f => f.skinned).length, warnings: allWarnings }
        if (allWarnings.length) health.next = 'Fix these, then {type:"render_probe"} to SEE the actual rendered pixels (struct + base64 PNG) before set_world_data brief_done.'
      } catch { /* health is a courtesy */ }
    }
    // capture the ORIGINAL after brief_done lands: reset restores to this forever
    if (briefDoneAccepted && auth.spaceId) {
      try { await setOriginal(auth.spaceId) } catch { /* capture is best-effort */ }
      // mirror the builder's own blurb (worldData.blurb — the AI wrote it as it
      // finished, its own tokens) into the description column for share cards.
      await mirrorWorldBlurb(auth.spaceId)
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
