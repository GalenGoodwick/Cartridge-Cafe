/**
 * scene-io — the SAVE / LOAD / BRANCH / VERSION lifecycle, carved out of
 * FieldEngine (carve Phase 3). Pure logic, no JSX, no React imports.
 *
 * CONTRACT (behavior-preserving): every function here is a former FieldEngine
 * useCallback body moved VERBATIM, with closed-over identifiers routed through
 * an explicit deps bag (`d`). FieldEngine keeps thin useCallback wrappers with
 * the ORIGINAL dependency arrays, and each wrapper builds `d` at call time from
 * its own closure — so memoization and the (load-bearing, documented) stale-
 * closure semantics are bit-for-bit what they were before the carve.
 */
import type { FieldSimulation } from './simulation'
import type { FieldRenderer } from './renderer'
import type { GameAudio } from './audio'
import type { WorldSandbox } from './world-sandbox'
import type { ArenaClient } from './arena-client'
import { setWorldVoice } from './cafe-audio'
import { serializeSceneDocument } from './persistence/serialize'
import { resetPatch } from '@/lib/gameStateKeys'

/* ────────────────────────────── shared dep types ───────────────────────── */

type Toast = (message: string, type?: 'success' | 'error' | 'info' | 'celebration', subtitle?: string) => void
type Ref<T> = { current: T }
export type StepHookSnapshot = { id: string; author: string; description: string; code: string }

export interface EngineRefs {
  simulationRef: Ref<FieldSimulation | null>
  rendererRef: Ref<FieldRenderer | null>
}

/* ─────────────────────────────── scene list ────────────────────────────── */

export interface RefreshSceneListDeps {
  setSavedScenes: (fn: (prev: string[]) => string[]) => void
}
export async function refreshSceneList(d: RefreshSceneListDeps) {
  try {
    const resp = await fetch('/api/engine/scene?action=list')
    const { scenes } = await resp.json()
    const next = Array.isArray(scenes) ? scenes : []
    // Only touch state when the list actually changed — this refresh polls
    d.setSavedScenes(prev => (prev.length === next.length && prev.every((n, i) => n === next[i])) ? prev : next)
  } catch { /* ignore */ }
}

/* ───────────────────────────── save (branch/version writer) ────────────── */

export interface SaveSceneAsDeps extends EngineRefs {
  allStepHookSnapshots: (sim: FieldSimulation) => StepHookSnapshot[]
}
// Save entire scene (all fields, effects, rules, hooks, world params)
/** Snapshot the live world under a given name — the branch/version writer */
// Returns the name the scene was ACTUALLY saved under (the store forks on
// overwrite, so a save onto an existing branch lands as its next version), or
// null on failure. Callers use it to follow the real branch, not a guessed one.
export async function saveSceneAs(d: SaveSceneAsDeps, sceneName: string, extraWorldData?: Record<string, unknown>): Promise<string | null> {
  const sim = d.simulationRef.current
  const renderer = d.rendererRef.current
  if (!sim) return null
  // 'used' scope = the ORCHID fix: only visuals THIS world references (attached to a
  // field or named in a hook/worldData), never the whole global renderer registry.
  // extraWorldData wins over inherited sim.worldData so a branch's `branchedFrom` is
  // stamped to its immediate parent.
  const sceneData = serializeSceneDocument(sim, renderer, {
    name: sceneName,
    stepHooks: d.allStepHookSnapshots(sim),
    visualScope: 'used',
    extraWorldData,
  })
  // no blank submissions — a branch version must contain a world
  if (!sceneData.fields.length && !sceneData.stepHooks.length && !sceneData.visualTypes.length) return null
  try {
    const r = await fetch('/api/engine/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', name: sceneName, scene: sceneData }),
    })
    if (!r.ok) return null
    const dd = await r.json().catch(() => ({} as { savedAs?: string; forkedSpace?: string }))
    // FORK PARADIGM: a save onto a canonical world now lands as a private
    // playerSpace the saver owns — follow it to its own page.
    if (dd.forkedSpace) { window.location.href = `/space/${dd.forkedSpace}`; return null }
    return (dd.savedAs as string) || sceneName   // an existing ⑂ branch may bump the version
  } catch { return null }
}

export interface SaveScenePromptedDeps extends EngineRefs {
  allStepHookSnapshots: (sim: FieldSimulation) => StepHookSnapshot[]
  showToast: Toast
  refreshSceneList: () => void
}
export async function saveScenePrompted(d: SaveScenePromptedDeps) {
  const sim = d.simulationRef.current
  const renderer = d.rendererRef.current
  if (!sim) return
  const name = window.prompt('Scene name:')
  if (!name?.trim()) return
  const sceneName = name.trim()
  const sceneData = serializeSceneDocument(sim, renderer, {
    name: sceneName,
    stepHooks: d.allStepHookSnapshots(sim),
    visualScope: 'all',
  })
  try {
    await fetch('/api/engine/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', name: sceneName, scene: sceneData }),
    })
    d.showToast(`Scene "${sceneName}" saved (${sceneData.fields.length} fields)`, 'success')
    d.refreshSceneList()
  } catch {
    d.showToast('Failed to save scene', 'error')
  }
}

/* ─────────────────────────────── branch tokens ─────────────────────────── */

export interface MintBranchTokenDeps {
  setPlugBusy: (b: boolean) => void
  setPlugToken: (t: string | null) => void
}
/** Mint a BRANCH-scoped token for a scene branch (`BASE ⑂ handle · vN`). This is
 *  the fix for "the AI overwrote main + the branch": a scoped token binds a
 *  connected AI to THIS one branch — the bridge reads/writes only its snapshot,
 *  never main or the global registry. Space worlds mint a uc_st_ token instead;
 *  branches, being file-store scenes, get a stateless uc_sc_ token here. */
export async function mintBranchToken(d: MintBranchTokenDeps, sceneName: string) {
  if (!sceneName.includes(' ⑂ ')) return null
  d.setPlugBusy(true)
  try {
    const r = await fetch('/api/engine/scene/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sceneName }),
    })
    const dd = await r.json()
    if (r.ok && dd.token) { d.setPlugToken(dd.token); return dd.token as string }
  } catch { /* ignore — briefing shows a minting-failed hint */ } finally { d.setPlugBusy(false) }
  return null
}

export interface CreateBranchDeps {
  me: string | null
  playScene?: string
  spaceSlug?: string
  lastSceneRef: Ref<string>
  saveSceneAs: (name: string, extraWorldData?: Record<string, unknown>) => Promise<string | null>
  mintBranchToken: (name: string) => Promise<string | null>
  setPlugToken: (t: string | null) => void
  setBranchCreateOpen: (b: boolean) => void
  showToast: Toast
  openPlug: () => void
}
/** FORK THIS WORLD (the fork paradigm — "create branch" retired): the remix
 *  lands as a private playerSpace the remixer OWNS — maker tag, forkOf lineage,
 *  shelf-capable — instead of an ownerless ⑂ scene. The fork's own /space page
 *  is where CONNECT AI mints its key directly. */
export async function createBranch(d: CreateBranchDeps, labelRaw: string) {
  if (!d.me) { window.location.href = '/auth/signin'; return }
  const src = d.lastSceneRef.current || d.playScene || d.spaceSlug || ''
  if (!src) { d.showToast('load a world first', 'error'); return }
  const label = labelRaw.trim().replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, ' ').slice(0, 40)
  try {
    const r = await fetch('/api/engine/scene/fork', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: src, label: label || undefined }),
    })
    const dd = await r.json().catch(() => ({} as { slug?: string; error?: string }))
    if (r.ok && dd.slug) {
      d.setBranchCreateOpen(false)
      d.showToast(`forked — it's yours now: /space/${dd.slug}`, 'success')
      window.location.href = `/space/${dd.slug}`
    } else {
      d.showToast(dd.error || 'fork failed', 'error')
    }
  } catch { d.showToast('fork failed — are you offline?', 'error') }
}

/* ───────────────────────── world-swap hygiene + load ───────────────────── */

export interface ResetWorldIdentityDeps extends EngineRefs {
  swapAtRef: Ref<number>
  audioRef: Ref<GameAudio>
  lastSoundsDeclRef: Ref<unknown>
  soundsLoadedRef: Ref<Map<string, string>>
  warnedSoundsRef: Ref<Set<string>>
  arenaRef: Ref<ArenaClient | null>
  sandboxRef: Ref<WorldSandbox | null>
}
// ═══ WORLD-SWAP HYGIENE (Galen Jul 30 audit): a swap SWITCHES OUT the whole
//     node — it must not MERGE the new world onto the old one's identity.
//     Call this BEFORE applying any incoming snapshot at every swap site;
//     incoming re-adds the keys the new world actually declares. NOT for live
//     same-world updates (the bridge set_world_data / the 2s delta sync). ═══
export function resetWorldIdentity(d: ResetWorldIdentityDeps) {
  d.swapAtRef.current = performance.now()
  const sim = d.simulationRef.current
  if (sim) {
    const wd = sim.worldData as Record<string, unknown>
    // config keys the next world re-declares if it wants them
    for (const k of ['postProcess', 'renderScale', 'maxBufferPixels', 'noPixelSampling',
                     '__mouseLook', 'persist', 'save', 'mpManifest', 'cradleBridge',
                     '__seed', '__fixedStep', 'singlePlayer', 'multiplayer', '__glyphOn', '__channels',
                     '__play_music', '__play_sound', 'music_mod', 'tone', 'sounds',
                     'gpuUniforms', 'gpuPopulation']) {   // per-frame GPU state: the NEXT world's shader must never read the departed world's buffer (the yellow-flash-on-main ghost)
      if (k in wd) delete wd[k]
    }
  }
  // renderer config back to defaults (else the prior world's grade/scale persists)
  const r = d.rendererRef.current
  if (r) {
    r.setPostProcess({ enabled: true, bloomIntensity: 0.3, bloomThreshold: 0.8,
      vignetteStrength: 0.3, vignetteRadius: 0.8, exposure: 1.0, lightDir: [0.5, 0.7], lightIntensity: 0.0 })
    r.setRenderScale(1.0)
    r.maxBufferPixels = 2_200_000
  }
  // AUDIO is world identity too (Galen): the composed score + hosted track must
  // not outlive the world. Stopping here on EVERY swap also fixes the vote's
  // iffy audio — each candidate preview cleanly silences the last.
  try { d.audioRef.current?.stopScore(); d.audioRef.current?.stopMusic(0.12); d.audioRef.current?.onWorldSwap() } catch { /* fine */ }
  // the WATER VOICE finally has a silencer at the swap (it was silenced by ZERO
  // of the teardown sites — only by the frame loop reading an absent wd.tone,
  // which a crashed/unmounted loop never does).
  try { setWorldVoice(null) } catch { /* fine */ }
  // next world declares its own manifest; stale id->url bookkeeping must not
  // block a same-name different-url reload
  d.lastSoundsDeclRef.current = null; d.soundsLoadedRef.current.clear(); d.warnedSoundsRef.current.clear()
  // browser pointer-lock: a __mouseLook world grabbed it; release so it can't
  // outlive the world (the vote→main cursor-trap bug).
  try { if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock() } catch { /* fine */ }
  // the multiplayer socket must not survive into a non-arena world
  try { d.arenaRef.current?.close(); d.arenaRef.current = null } catch { /* fine */ }
  // ZOMBIE WORKERS (Galen: veilfire's sound started AFTER leaving it): the old
  // world's sandbox was disposed only when the NEXT world had hooks — a
  // hookless world or the hub let it keep ticking forever, its whitelisted
  // __play_music writebacks re-scoring the new world (and stacking CPU cost
  // across swaps). Dispose unconditionally; the next loader reinstalls its own.
  try { d.sandboxRef.current?.dispose(); d.sandboxRef.current = null } catch { /* fine */ }
}

export interface LoadSceneDeps extends EngineRefs {
  resetWorldIdentity: () => void
  lastSceneRef: Ref<string>
  setPlugToken: (t: string | null) => void
  setRiding: (v: string | null) => void
  setWorldLoading: (b: boolean) => void
  fadeToBlack: () => Promise<void>
  liftWhenSettled: (guard?: () => boolean) => void
  audioRef: Ref<GameAudio>
  cachedOverlapMasksRef: Ref<Map<string, Uint8Array>>
  installHooks: (sim: FieldSimulation, stepHooks: StepHookSnapshot[] | undefined, worldData: Record<string, unknown> | undefined) => void
  setRunning: (b: boolean) => void
  getModCode: () => string | undefined
  updateSelectionMask: (fieldId: string | null) => void
  syncFields: () => void
  showToast: Toast
}
// Load a saved scene (replaces current state)
export async function loadScene(d: LoadSceneDeps, sceneName: string, preScene?: unknown) {
  d.resetWorldIdentity()
  const sim = d.simulationRef.current
  const renderer = d.rendererRef.current
  if (!sim || !renderer) return
  // Verify the target EXISTS before switching to it. The version scroller can ask
  // for v(n+1); if there is no such version we must NOT advance the counter to a
  // scene that isn't there ("a version number can't count up with nothing to
  // switch to"). Fetch first; mutate refs only once the scene is confirmed.
  // preScene: main's version scroller hands in a timestamped backup snapshot
  // directly (it has no scene NAME to fetch by) — skip the fetch and use it.
  // It may arrive AS the snapshot object (version scroller) OR wrapped in an
  // envelope { snapshot } / { scene } (the space snapshot endpoint, via
  // hotLoadSpaceVersion). Unwrap either — a raw envelope has no .fields, so it
  // silently loads a 0-field world and the tab goes BLACK on every live reload.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let scene: any = preScene
    ? ((preScene as { scene?: unknown; snapshot?: unknown }).scene || (preScene as { snapshot?: unknown }).snapshot || preScene)
    : preScene
  if (!scene) {
    try {
      const resp = await fetch(`/api/engine/scene?name=${encodeURIComponent(sceneName)}`)
      scene = (await resp.json()).scene
    } catch { d.showToast('Failed to load scene', 'error'); return }
  }
  if (!scene) {
    // A deep link to a deleted/renamed scene (orphan) — don't leave the visitor
    // staring at black. Signal the shell to show a soft "gone" landing. This is
    // the SAME fetch a valid world succeeds on, so it never fires for a real one.
    d.showToast(`Scene "${sceneName}" not found`, 'error')
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cafe:scene-gone', { detail: sceneName }))
    return
  }

  // Confirmed — now switch. Navigating to a DIFFERENT scene/version invalidates
  // any minted connect token (HMAC-bound to the scene you left); drop it so the
  // next CONNECT AI mints one for where you are now.
  if (sceneName !== d.lastSceneRef.current) d.setPlugToken(null)
  d.lastSceneRef.current = sceneName
  d.setRiding(sceneName.includes(' ⑂ ') ? sceneName : null)
  // Veil the swap: until the NEW uber-shader compiles, the old pipeline would
  // paint the incoming fields with the departed world's shaders.
  d.setWorldLoading(true)
  await d.fadeToBlack()   // dim the departing world first — travel happens under black
  try {
    // Clear current state — including the old world's audio
    d.audioRef.current.stopScore()
    d.audioRef.current.stopMusic(0.2)
    delete sim.worldData['__play_sound']
    delete sim.worldData['__play_music']
    for (const field of sim.fields.values()) {
      renderer.removeAllFieldEffects(field.id)
    }
    for (const key of Array.from(renderer.getFieldEffectKeys())) {
      if (key.startsWith('ix_')) { renderer.removeFieldEffect(key); renderer.removeFieldMask(key) }
    }
    sim.clearAll()
    sim.fields.clear()
    d.rendererRef.current?.resetWorldUniforms()   // a new world starts with a clean uniform whiteboard — no bleed from the last scene
    sim.interactionRules = []
    sim.interactionEffects = []
    sim.stepHooks.clear()
    sim.tweens.clear()
    sim.timers.clear()
    sim.collisionCallbacks.clear()
    d.cachedOverlapMasksRef.current = new Map()

    // A scene is a complete world — reset the shader registries so visuals
    // from previously loaded scenes don't accumulate forever (every stale
    // visual bloats the uber-shader and slows each recompile).
    renderer.clearRegistries()

    // Restore MODULES first, then visuals. Registering a visual kicks off a
    // recompile; if its modules aren't in the registry yet, the compile fails
    // and the isolation sweep QUARANTINES the visual for calling module
    // functions that were still in flight ("unresolved call target mod_*" on
    // every reload of a module-built world — the bare-rectangle bug).
    if (scene.modules) {
      for (const m of scene.modules) {
        renderer.registerModule(m.name, m.wgsl)
      }
    }
    if (scene.visualTypes) {
      for (const vt of scene.visualTypes) {
        renderer.registerVisualType(vt.name, vt.wgsl)
      }
    }

    // Restore scene
    sim.restoreFromSnapshots(scene.fields || [])
    // Name is authoritative — resolve visual types against this session's
    // registry (numeric IDs shift between sessions)
    for (const field of sim.fields.values()) {
      if (field.visualTypeName) {
        const runtimeId = renderer.resolveVisualType(field.visualTypeName)
        if (runtimeId !== undefined) field.visualType = runtimeId
      }
    }
    if (scene.worldParams) sim.setWorldParams(scene.worldParams)
    if (scene.worldData) Object.assign(sim.worldData, scene.worldData)
    // Transient input state must never arrive via a scene
    for (const k of Object.keys(sim.worldData)) {
      if (k.startsWith('key_') || k.startsWith('mouse_')) delete sim.worldData[k]
    }
    if (scene.interactionRules) sim.interactionRules = scene.interactionRules
    if (scene.interactionEffects) {
      for (const ie of scene.interactionEffects) sim.addInteractionEffect(ie)
    }
    if (scene.stepHooks) d.installHooks(sim, scene.stepHooks, scene.worldData as Record<string, unknown> | undefined)
    // Any world with RENDERABLE content boots running — not just ones with
    // hooks. A visual-only world (fields with visuals, no stepHook) otherwise
    // draws a single frame and idles to black. Content, not logic, is the test.
    const hasContent = (scene.stepHooks?.length ?? 0) > 0 || (scene.fields || []).some((f: { visualTypeName?: string }) => f.visualTypeName)
    if (hasContent && !sim.running) {
      sim.running = true
      d.setRunning(true)
    }

    // Recompile effects
    for (const field of sim.fields.values()) {
      for (const effect of field.effects) {
        await renderer.compileFieldEffect(`${field.id}_${effect.id}`, field.id, effect.wgsl, d.getModCode())
      }
    }

    d.updateSelectionMask(null)
    d.syncFields()
    d.showToast(`Scene "${sceneName}" loaded (${scene.fields?.length || 0} fields)`, 'success')
  } catch {
    d.showToast(`Failed to load "${sceneName}"`, 'error')
  } finally {
    d.liftWhenSettled()
  }
}

/* ─────────────────────────── version scroll / hot-load ─────────────────── */

export interface GoBaseVerDeps {
  playScene?: string
  baseVers: number[]
  handleLoadScene: (sceneName: string, preScene?: unknown) => Promise<void>
  setBaseVerPos: (n: number) => void
}
/** MAIN version scroller step: pos 0 = LIVE, 1..N = backups (newest→oldest).
 *  Loads a timestamped backup snapshot in place (via handleLoadScene's preScene)
 *  — non-destructive: browsing an old version never overwrites the live world. */
export async function goBaseVer(d: GoBaseVerDeps, pos: number) {
  const cur = d.playScene || ''
  if (!cur || pos < 0 || pos > d.baseVers.length) return
  if (pos === 0) { await d.handleLoadScene(cur); d.setBaseVerPos(0); return }   // back to LIVE
  const ts = d.baseVers[pos - 1]   // pos 1 → newest backup
  try {
    const j = await fetch(`/api/engine/scene?action=version&name=${encodeURIComponent(cur)}&timestamp=${ts}`).then(r => r.json())
    if (j?.scene) { await d.handleLoadScene(cur, j.scene); d.setBaseVerPos(pos) }
  } catch { /* offline — leave where we are */ }
}

export interface HotLoadSpaceVersionDeps {
  resetWorldIdentity: () => void
  spaceSlug?: string
  reloadingRef: Ref<boolean>
  pendingReloadRef: Ref<{ v: number | undefined } | null>
  renderedRevRef: Ref<number>
  lastFieldsRef?: Ref<string>   // hot-swap field-diff baseline (re-set on full load)
  hotLoadSpaceVersionRef: Ref<((v: number | undefined) => Promise<void>) | null>
  handleLoadScene: (sceneName: string, preScene?: unknown) => Promise<void>
  greetInstructions: (worldId: string) => void
  setSpaceVer: (v: number | undefined) => void
}
/** #3 — hot-swap a SPACE version in place (no reload), the same way the vote
 *  reckoning previews a `space:` snapshot: fetch it, hand it to the proven
 *  clear+restore (handleLoadScene), and mark the client version so ctx.view
 *  (and thus the read-only gates) follow. Owner-only — the owner's own hooks
 *  are trusted; a visitor keeps the server-rendered reload path so an
 *  untrusted version's JS never auto-installs. */
export async function hotLoadSpaceVersion(d: HotLoadSpaceVersionDeps, v: number | undefined) {
  d.resetWorldIdentity()
  if (!d.spaceSlug) return
  // Already mid-load: queue this request (latest wins) instead of interleaving
  // a second clear+restore over the first — that interleave tears the grid.
  if (d.reloadingRef.current) { d.pendingReloadRef.current = { v }; return }
  // Pause the 2s sync while the reload settles: handleLoadScene tears the renderer
  // down (0 visuals) and reinstalls hooks over several frames; a sync firing in
  // that window persists an empty/hookless world and renders it dark for everyone.
  d.reloadingRef.current = true
  try {
    const q = v === undefined ? '' : `?version=${v}`
    const r = await fetch(`/api/spaces/${encodeURIComponent(d.spaceSlug)}/snapshot${q}`, { cache: 'no-store' })
    if (!r.ok) return
    const data = await r.json()          // { snapshot: {...} }
    // Viewing a SAVE POINT presents the world FRESH, not mid-game: a version
    // snapshot carries the live worldData — chapters, triggers, whatever the
    // hook persisted — so vote previews resumed someone's half-finished run.
    // Engine state (__chapters/__trig) always resets; a world lists its own
    // game-state keys in worldData.__resets (e.g. TIDEGLASS resets '__tg').
    // A RESTART (R) reloads the page with a one-shot sessionStorage flag so the
    // live snapshot's saved game-state is stripped on the way back in — a plain
    // reload alone re-fetches __tg intact ("reset didn't purge the save").
    let resetFlag = false
    try {
      if (sessionStorage.getItem('cc-reset:' + d.spaceSlug)) { resetFlag = true; sessionStorage.removeItem('cc-reset:' + d.spaceSlug) }
    } catch { /* private mode */ }
    if (v !== undefined || resetFlag) {
      const wd = (data?.snapshot as { worldData?: Record<string, unknown> } | undefined)?.worldData
      if (wd) {
        if (resetFlag) {
          // RESTART (R): return to ORIGINAL — restore from wd.__original where the
          // world captured one, else delete so the hook re-inits. Same resetPatch
          // the server reset uses, so R and reset_world behave identically.
          const patch = resetPatch(wd)
          for (const [k, val] of Object.entries(patch)) { if (val === null) delete wd[k]; else wd[k] = val }
        } else {
          // a version VIEW only clears transient engine progress so the saved state shows
          const extra = Array.isArray(wd.__resets) ? wd.__resets as string[] : []
          for (const k of ['__chapters', '__trig', ...extra]) delete wd[k]
        }
      }
    }
    await d.handleLoadScene(`space:${d.spaceSlug}`, data)
    // record the rev we just rendered so the auto-load poll baselines on what's
    // actually on screen (this is the SAME __bridge_rev the snapshot?rev=1 poll reads)
    d.renderedRevRef.current = Number((data?.snapshot as { worldData?: { __bridge_rev?: unknown } } | undefined)?.worldData?.__bridge_rev) || 0
    if (d.lastFieldsRef) d.lastFieldsRef.current = JSON.stringify((data?.snapshot as { fields?: unknown } | undefined)?.fields ?? [])
    d.greetInstructions(`space:${d.spaceSlug}`)   // pop instructions on first entry to this space
    d.setSpaceVer(v)
    window.history.replaceState(null, '', v === undefined ? `/space/${d.spaceSlug}` : `/space/${d.spaceSlug}?version=${v}`)
  } catch { /* leave where we are */ }
  finally {
    // release AFTER the load actually finished (not a fixed timer from entry):
    // hold the sync-pause a beat for the recompile to settle, then run the
    // newest queued request, if any — so a legit follow-up edit still adopts.
    setTimeout(() => {
      d.reloadingRef.current = false
      const p = d.pendingReloadRef.current
      d.pendingReloadRef.current = null
      if (p) d.hotLoadSpaceVersionRef.current?.(p.v)
    }, 1500)
  }
}

/* ────────────────────────────── delete / browse ────────────────────────── */

export interface DeleteSceneDeps {
  showToast: Toast
  refreshSceneList: () => void
}
// Delete a saved scene
export async function deleteScene(d: DeleteSceneDeps, sceneName: string) {
  try {
    await fetch('/api/engine/scene', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sceneName }),
    })
    d.showToast(`Scene "${sceneName}" deleted`, 'success')
    d.refreshSceneList()
  } catch {
    d.showToast(`Failed to delete "${sceneName}"`, 'error')
  }
}

export type BranchHead = { name: string; author: string; v: number }
export interface LoadBranchHeadsDeps {
  lastSceneRef: Ref<string>
  playScene?: string
  spaceSlug?: string
  setBranchList: (l: BranchHead[]) => void
}
/** The branch heads of the current base world — one entry per branch (its
 *  newest version). Shared by the ≡ BRANCHES panel and the ◂/▸ quick-browse
 *  arrows on ⑂ BRANCH. */
export async function loadBranchHeads(d: LoadBranchHeadsDeps): Promise<BranchHead[]> {
  const base = (d.lastSceneRef.current || d.playScene || d.spaceSlug || '').split(' ⑂ ')[0]
  if (!base) return [] as BranchHead[]
  try {
    const { scenes } = await fetch('/api/engine/scene?action=list').then(r => r.json())
    const heads = new Map<string, BranchHead>()
    for (const n of scenes as string[]) {
      const m = n.match(/^(.+) ⑂ (.+) · v(\d+)$/)
      if (!m || m[1] !== base) continue
      if (m[2] === 'main' || m[2].startsWith('main · ')) continue   // legacy throne copies aren't browsable branches
      const cur = heads.get(m[2])
      if (!cur || +m[3] > cur.v) heads.set(m[2], { name: n, author: m[2], v: +m[3] })
    }
    // the WINNER'S PODIUM rides first — the elected copy stands before main
    // and the branches (main itself always stays the original maker's)
    const list = [...heads.values()].sort((a, b) => {
      const aw = a.author === 'winner' ? 1 : 0, bw = b.author === 'winner' ? 1 : 0
      if (aw !== bw) return bw - aw
      return b.v - a.v
    })
    d.setBranchList(list)
    return list
  } catch { d.setBranchList([]); return [] }
}

export interface StepBranchDeps {
  loadBranchHeads: () => Promise<BranchHead[]>
  lastSceneRef: Ref<string>
  spaceSlug?: string
  playScene?: string
  handleLoadScene: (sceneName: string, preScene?: unknown) => Promise<void>
  showToast: Toast
}
/** ◂/▸ on the BRANCH button: step the ring [main, branch, branch, …] — quick
 *  browsing for everyone, owner or visitor. Looking is free. */
export async function stepBranch(d: StepBranchDeps, dir: 1 | -1) {
  const list = await d.loadBranchHeads()
  if (list.length === 0) { d.showToast('no branches yet — ⑂ BRANCH to open one', 'info'); return }
  const ring = ['main', ...list.map(b => b.name)]
  const cur = d.lastSceneRef.current || ''
  const curAuthor = cur.match(/^.+ ⑂ (.+) · v\d+$/)?.[1] ?? ''
  // riding a branch that vanished → findIndex -1 → idx 0 → treated as main
  const idx = curAuthor ? Math.max(0, 1 + list.findIndex(b => b.author === curAuthor)) : 0
  const next = ring[(idx + dir + ring.length) % ring.length]
  if (next === 'main') {
    // on a space, main is the space's own snapshot — not a scene by that name
    if (d.spaceSlug) window.location.href = `/space/${encodeURIComponent(d.spaceSlug)}`
    else d.handleLoadScene(cur.split(' ⑂ ')[0] || (d.playScene || ''))
  } else d.handleLoadScene(next)
}

/* ──────────────────────────────── lineage ──────────────────────────────── */

export type LineageEntry = { name: string; by?: string | null; kind: string; slug?: string }
export interface LoadLineageDeps {
  lastSceneRef: Ref<string>
  playScene?: string
  spaceSlug?: string
  setLineageBusy: (b: boolean) => void
  setLineageTrail: (t: LineageEntry[]) => void
  setLineageRemixes: (r: { name: string; slug: string }[]) => void
}
// LINEAGE TRAIL — where this world came from (walks branchedFrom / forkOfId),
// plus the remixes that grew FROM it (the downstream side).
export async function loadLineage(d: LoadLineageDeps) {
  d.setLineageBusy(true)
  try {
    const cur = d.lastSceneRef.current || d.playScene || ''
    const q = cur.includes(' ⑂ ') ? `scene=${encodeURIComponent(cur)}`
            : d.spaceSlug ? `space=${encodeURIComponent(d.spaceSlug)}`
            : cur ? `scene=${encodeURIComponent(cur)}` : ''
    if (!q) { d.setLineageTrail([]); d.setLineageRemixes([]); return }
    const r = await fetch(`/api/engine/lineage/trail?${q}`)
    const dd = await r.json().catch(() => ({}))
    d.setLineageTrail(Array.isArray(dd.trail) ? dd.trail : [])
    d.setLineageRemixes(Array.isArray(dd.remixes) ? dd.remixes : [])
  } catch { d.setLineageTrail([]); d.setLineageRemixes([]) } finally { d.setLineageBusy(false) }
}
