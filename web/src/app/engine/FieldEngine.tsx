'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import { signIn } from 'next-auth/react'
import ChatWorld from '../ChatWorld'
import { io, type Socket } from 'socket.io-client'
import { FieldRenderer } from './renderer'
import { deriveContext, can, type WorldContext } from '@/lib/worldContext'
import { FocusChip } from './WorldChrome'
import type { FieldEffectData } from './renderer'
import { FieldSimulation } from './simulation'
import { WorldSandbox } from './world-sandbox'
import { FieldInput } from './input'
import Toolbar from './Toolbar'
import VersionScrubber from './VersionScrubber'
import PromptPanel from './PromptPanel'
import type { DialogEntry } from './AgentDialogPanel'
import AgentTerminalPanel from './AgentTerminalPanel'
import type { TerminalEntry } from './AgentTerminalPanel'
import type { BrushState, Camera, Field, FieldEffect, SelectionState, GenerationState, InteractionEffect, CameraFollow, HudElement, SuperFieldGPU } from './types'
import { DEFAULT_GRID_SIZE } from './types'
import { GameAudio } from './audio'
import SpaceManagementOverlay from './SpaceManagementOverlay'
import SpaceBreadcrumb from './SpaceBreadcrumb'
import { useToast } from '@/components/Toast'
// DEFAULT_FIELD_EFFECT_GLSL removed — fields are invisible until agents give them a shader

let fieldCounter = 0
function genFieldId() {
  return `field_${++fieldCounter}_${Date.now()}`
}

let effectCounter = 0
function genEffectId() {
  return `effect_${++effectCounter}_${Date.now()}`
}

// Reusable Set for per-frame interaction key cleanup (avoids allocation every frame)
const _reusableKeySet = new Set<string>()

/** Convert screen pixel coordinates to float grid coordinates (no flooring) */
function screenToGrid(
  screenX: number, screenY: number,
  canvasRect: DOMRect,
  camera: { x: number; y: number },
  zoom: number,
  gridSize: number = DEFAULT_GRID_SIZE
): { x: number; y: number } {
  const normX = (screenX - canvasRect.left) / canvasRect.width
  const normY = (screenY - canvasRect.top) / canvasRect.height
  const aspect = canvasRect.width / canvasRect.height
  const gridRange = gridSize / zoom

  if (aspect > 1) {
    return {
      x: camera.x + (normX - 0.5) * gridRange * aspect,
      y: camera.y + (normY - 0.5) * gridRange,
    }
  } else {
    return {
      x: camera.x + (normX - 0.5) * gridRange,
      y: camera.y + (normY - 0.5) * gridRange / aspect,
    }
  }
}

const DEFAULT_HUES = [190, 30, 120, 280, 0, 60, 330, 210]

function hueToRgba(hue: number): [number, number, number, number] {
  const h = hue / 360
  const s = 0.75
  const l = 0.6
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 1/6) { r = c; g = x }
  else if (h < 2/6) { r = x; g = c }
  else if (h < 3/6) { g = c; b = x }
  else if (h < 4/6) { g = x; b = c }
  else if (h < 5/6) { r = x; b = c }
  else { r = c; b = x }
  return [r + m, g + m, b + m, 1.0]
}

/** Wrap interaction WGSL for the field effect pipeline.
 *  Interaction shaders define `fn interactionEffect(coord, regionMin, regionMax, time, params) → vec4f`.
 *  This wrapper adapts it to `fn fieldEffect(...)` expected by the field pipeline. */
function wrapInteractionWgsl(interactionWgsl: string): string {
  return `
// Per-pixel overlap mask: 1.0 where both parent fields' dilated presence overlaps, 0.0 elsewhere.
fn overlapMask(coord: vec2f) -> f32 {
  // textureSampleLevel: field effects run in a COMPUTE pipeline, where
  // textureSample (implicit derivatives) is illegal — this was the silent
  // killer that blacked out any world with an interaction effect.
  return textureSampleLevel(fieldMask, texSampler, coord / frame.gridSize, 0.0).r;
}

${interactionWgsl}

fn fieldEffect(coord: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let eff = interactionEffect(coord, regionMin, regionMax, time, params);
  let mask = overlapMask(coord);
  return vec4f(eff.rgb, eff.a * mask);
}`
}

interface FieldEngineProps {
  spaceId?: string
  spaceSlug?: string
  /** the space's human name + owner — so the ONE FOCUS chip titles a space
   *  exactly like it titles a world (SpaceToolbar used to own this). */
  spaceName?: string
  spaceOwnerName?: string | null
  spaceOwnerId?: string | null
  spaceOwnerHandle?: string | null
  isOwner?: boolean
  /** View a historical save point instead of the live world (read-only demo mode) */
  versionView?: number
  /** Load this saved scene on mount and just play it — local sim, no server state, no chrome */
  playScene?: string
  /** May this SPACE's stored JS hooks run? A space hook runs in the visitor's
   *  browser, so untrusted-author JS is XSS. The server decides: true for the
   *  owner or a trusted author. False → the shader still renders (GPU is safe),
   *  the JS brain is simply not installed. House cartridges are always trusted. */
  hooksTrusted?: boolean
  /** Shrink the engine's root to this inset (px from each viewport edge) so the
   *  world reflows into a framed box — the vote UI slides panels into the margins
   *  and the constellation resizes to what's left, instead of being overlaid. */
  viewport?: { top: number; right: number; bottom: number; left: number } | null
  /** Reports the bottom (y px) of the top-right UI dock whenever it resizes, so
   *  the shell can seat the in-world VOTE button directly under it — beneath the
   *  AI plugged/unplugged lamp — instead of at a guessed fixed offset. */
  onDockRect?: (bottom: number) => void
  onBuilding?: (building: boolean) => void
  /** Live-cursor presence ROOM override for the hub. On the cafe hub every
   *  sub-view (main / player-worlds directory / a sub-main / MY WORLDS) is one
   *  playScene='CAFE', so without this they'd all share the 'cursors:CAFE' room
   *  and a person browsing a sub-main would show as a LIVE cursor on main.
   *  CafeShell passes a per-sub-view key (e.g. 'CAFE/sub/<slug>') so cursors
   *  stay docked inside their own view; nesting on main is the docked-orb count,
   *  a separate system (/api/presence). Unset → the default spaceId||playScene. */
  presenceKey?: string
}

/** Engine build marker — bump when engine-level fixes land, so a running tab
 *  can PROVE which build it holds (shown in the fault banner + console). */
const ENGINE_BUILD = 'e5-fx-dbg'

// downloaded scenes, cached by playScene name — the vote reckoning flicks between
// five candidates, and this spares the network/DB on every re-hover. It caches the
// DOWNLOAD only; one scene runs at a time. Dev hot-reload deletes an entry on edit.
const scenePreloadCache = new Map<string, unknown>()

// the shelf's icon atlas, cached as plain pixels across visits to main — leaving
// a world and coming back re-uploads this instead of re-fetching the roster and
// re-rendering ~64 world shaders behind spinners. Survives client-side navigation.
let cafeIconCache: { sig: string; atlas: Uint32Array; slots: Record<string, number> } | null = null

// The module cache dies with the page, and leaving a world for MAIN is a full
// navigation — so the shelf re-rendered every icon on every return. Persist the
// finished atlas (~1MB) in localStorage: rendered once per MACHINE, not per tab —
// new tabs and restarts get instant faces (sessionStorage died with each tab).
function iconCacheSave(c: NonNullable<typeof cafeIconCache>): void {
  try {
    const bytes = new Uint8Array(c.atlas.buffer, c.atlas.byteOffset, c.atlas.byteLength)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    localStorage.setItem('cc:cafeIconAtlas:v6', JSON.stringify({ sig: c.sig, slots: c.slots, b64: btoa(bin) }))
  } catch { /* quota or private mode — cache stays page-local */ }
}
function iconCacheLoad(): typeof cafeIconCache {
  try {
    const raw = localStorage.getItem('cc:cafeIconAtlas:v6')
    if (!raw) return null
    const { sig, slots, b64 } = JSON.parse(raw) as { sig: string; slots: Record<string, number>; b64: string }
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { sig, slots, atlas: new Uint32Array(bytes.buffer) }
  } catch { return null }
}

// BREWED GLYPH — the player's cursor WGSL, wrapped to fill the hub shader's
// mod_playerglyph container (a no-op until swapped). Shared by the scene
// loader (overlay BEFORE the first compile — one compile per hub entry, no
// second stall) and the cafe:icon watcher (recompile only on a real change).
const playerGlyphWgsl = (): string | null => {
  if (typeof window === 'undefined') return null
  const ic = (window as unknown as { __cafeIcon?: { wgsl?: string } }).__cafeIcon
  return typeof ic?.wgsl === 'string' && /fn\s+visual_glyph\s*\(/.test(ic.wgsl) ? ic.wgsl : null
}
const wrapPlayerGlyph = (wgsl: string): string =>
  wgsl + '\nfn mod_playerglyph(uv: vec2f, t: f32) -> vec4f { return visual_glyph(uv, 0.0, vec4f(1.0), t, vec4f(0.0), vec4f(0.0)); }'
// OTHER players' glyphs arrive over presence and share ONE uber-shader — every
// function a glyph declares is renamed into its slot's namespace so two
// players' visual_glyph (and any helpers) can coexist. Slots pg0..pg2.
const wrapOtherGlyph = (wgsl: string, slot: number): string => {
  let code = wgsl
  const names = new Set(Array.from(wgsl.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*\(/g), m => m[1]))
  for (const n of names) code = code.replace(new RegExp('\\b' + n + '\\b', 'g'), `${n}_pg${slot}`)
  return code + `\nfn mod_pg${slot}(uv: vec2f, t: f32) -> vec4f { return visual_glyph_pg${slot}(uv, 0.0, vec4f(1.0), t, vec4f(0.0), vec4f(0.0)); }`
}

export default function FieldEngine({ spaceId, spaceSlug, spaceName, spaceOwnerName, spaceOwnerId, spaceOwnerHandle, isOwner, versionView, playScene, hooksTrusted, viewport, onDockRect, onBuilding, presenceKey }: FieldEngineProps = {}) {
  useEffect(() => { console.log(`[engine] build ${ENGINE_BUILD}`) }, [])
  const { showToast } = useToast()

  useEffect(() => {
    const onFocus = () => { windowFocusedRef.current = true }
    const onBlur = () => { windowFocusedRef.current = false }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Every world carries instructions (worldData.instructions) behind a mandatory
  // top-right button — a world you can enter is a world you can learn.
  // Convention: key entry first (every input, one per line), then the point.
  const [instrOpen, setInstrOpen] = useState(false)
  const [instrEdit, setInstrEdit] = useState(false)
  // greet a player entering a game with its instructions, once per world (not on
  // reloads/version-swaps of the same world, not on the CAFE/SUB-MAIN nav hubs)
  const greetedInstrRef = useRef<string | null>(null)
  const greetInstructions = (worldId: string) => {
    if (!worldId || worldId === 'CAFE' || worldId === 'SUB-MAIN') return
    if (greetedInstrRef.current === worldId) return
    const instr = String(simulationRef.current?.worldData?.instructions || '').trim()
    if (!instr) return
    greetedInstrRef.current = worldId
    setInstrOpen(true)
  }
  const [instrDraft, setInstrDraft] = useState('')
  // ── branches: every world can be branched by anyone signed in; versions are
  // cut by the EYE — a watcher that snapshots each settled burst of AI edits ──
  const [me, setMe] = useState<string | null>(null)
  const [myName, setMyName] = useState('')   // display name (== chat `who`), so the world-chat door can exclude YOUR own posts
  const [aiPulse, setAiPulse] = useState(0)
  const [plugOpen, setPlugOpen] = useState(false)
  const [plugToken, setPlugToken] = useState<string | null>(null)
  const [plugBusy, setPlugBusy] = useState(false)
  const [plugBrief, setPlugBrief] = useState('')   // "what should the AI build here?" — embedded in the connect prompt
  // ALTER — the owner's CONNECT AI on a live space edits MAIN directly (a space
  // token is live-scoped, there is no eye on the DB path). The warning box makes
  // that explicit before any token is handed out; a pre-alter save point is kept.
  const [alterWarnOpen, setAlterWarnOpen] = useState(false)
  // MAKE ICON — the maker's AI authors a tiny self-contained shader for this
  // world's shelf bubble (same copy-prompt-to-AI flow as CONNECT AI / brew)
  const [mkIconOpen, setMkIconOpen] = useState(false)
  const [mkIconDesc, setMkIconDesc] = useState('')
  const [mkIconCopied, setMkIconCopied] = useState(false)
  const [mkIconSet, setMkIconSet] = useState(false)
  // spectators can browse branches without signing in — looking is free
  const [branchesOpen, setBranchesOpen] = useState(false)
  // game worlds collapse their meta-UI (branch/branches/connect/vote/restart)
  // behind a single dock; back/tools/sound/instructions + the game HUD stay out.
  const [uiDockOpen, setUiDockOpen] = useState(false)   // the world greets CLEAN; ✎ EDIT opens the controls (connect AI, tools, branch, vote)
  const [editCoach, setEditCoach] = useState(false)     // one-time coach naming each EDIT-dock control
  useEffect(() => {
    if (!uiDockOpen) return
    try { if (localStorage.getItem('cc-edit-coached')) return } catch { return }
    setEditCoach(true)
  }, [uiDockOpen])
  const dismissEditCoach = () => {
    setEditCoach(false)
    try { localStorage.setItem('cc-edit-coached', '1') } catch { /* private mode */ }
  }
  // REMIX hidden for now (users-first phase; returns as PAID remix). Keeping the
  // state declared but referenced so the commented button re-enables cleanly.
  const [remixArm, setRemixArm] = useState(false)
  void remixArm; void setRemixArm

  // ESC closes the topmost open panel and stops there — it must never fall
  // through a modal into "leave this world" (the shell's ESC handler)
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (alterWarnOpen) setAlterWarnOpen(false)
      else if (plugOpen) setPlugOpen(false)
      else if (instrOpen) { setInstrOpen(false); setInstrEdit(false) }
      else if (branchesOpen) setBranchesOpen(false)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onEsc, { capture: true })
    return () => window.removeEventListener('keydown', onEsc, { capture: true })
  }, [alterWarnOpen, plugOpen, instrOpen, branchesOpen])

  // tell the shell when a panel is up so its overlays (count pills, hover
  // cards) duck out from under the modal
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('cafe:modal', { detail: plugOpen || instrOpen || branchesOpen || alterWarnOpen }))
  }, [plugOpen, instrOpen, branchesOpen, alterWarnOpen])
  const [branchList, setBranchList] = useState<Array<{ name: string; author: string; v: number }>>([])
  // every world gets a chat — one commons per family (voting discussion included)
  const [worldChatOpen, setWorldChatOpen] = useState(false)
  // ── VERSIONS browser (save-points): a space's own version history on main ──
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versionList, setVersionList] = useState<Array<{ version: number; note: string | null; createdAt: string; author?: { name: string | null } | null }>>([])
  const [versionBusy, setVersionBusy] = useState(false)
  const loadVersions = useCallback(async () => {
    if (!spaceSlug) return
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/versions`).then(x => x.json())
      // versions are 1-based; drop any v0/negative a legacy or flag-time path may
      // have left in the data so the ◂/▸ stepper can't land on a "version 0"
      setVersionList(Array.isArray(r.versions) ? r.versions.filter((v: { version: number }) => v.version >= 1) : [])
    } catch { setVersionList([]) }
  }, [spaceSlug])
  // load up front on a space: the ⏱ VERSIONS ◂/▸ arrows need the roster to step
  useEffect(() => { loadVersions() }, [loadVersions])
  // ── the CELL: viewers gather, five unlock the vote, every branch has a table ──
  type CellDoc = { viewers: Record<string, number>; votes: Record<string, string[]>; discussion: Record<string, Array<{ who: string; text: string; at: number }>> }
  const [cellData, setCellData] = useState<CellDoc>({ viewers: {}, votes: {}, discussion: {} })
  const [cellDraft, setCellDraft] = useState('')
  const [discOpen, setDiscOpen] = useState<string | null>(null)
  const [riding, setRiding] = useState<string | null>(null)
  // the space page's title box shows WHAT is being viewed — tell it when we
  // ride a branch (or step back to main). Detail = full scene name or null.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('cafe:viewing', { detail: riding }))
  }, [riding])
  // the lineage throne: who currently holds MAIN for this world, and the immortal
  // original. When the tournament snags main from the founder, we reassure them —
  // their original is never gone; the ★ bookmark always returns them to it.
  const [worldLineage, setWorldLineage] = useState<{ original: string; mainHolder: string } | null>(null)
  const [winnerTakesMain, setWinnerTakesMain] = useState(false)   // owner opt-in: a popular challenger can take main
  const [verMax, setVerMax] = useState(1)   // highest existing version of the ridden branch — bounds the ▸ scroller
  const [verList, setVerList] = useState<number[]>([])   // the versions that ACTUALLY exist (deletions leave holes)
  // learn which versions this branch actually has, so the scroller can never
  // offer a step to a version that isn't there — v±1 arithmetic loaded ghosts.
  useEffect(() => {
    if (!riding) { setVerMax(1); setVerList([]); return }
    const m = riding.match(/^(.*) · v(\d+)$/)
    const ident = m ? m[1] : riding
    let stop = false
    fetch('/api/engine/scene?action=list').then(r => r.json()).then(({ scenes }) => {
      if (stop) return
      const vs: number[] = []
      for (const nm of (scenes || []) as string[]) {
        const sm = nm.match(/^(.*) · v(\d+)$/)
        if (sm && sm[1] === ident && +sm[2] >= 1) vs.push(+sm[2])   // versions are 1-based; never a v0
      }
      vs.sort((a, b) => a - b)
      setVerList(vs)
      setVerMax(vs.length ? vs[vs.length - 1] : 1)
    }).catch(() => {})
    return () => { stop = true }
  }, [riding])
  // ── MAIN's version scroller: a base world's own save-point history (the eye's
  // backups), stepped with ◂/▸ just like a branch — main was missing this tab. ──
  const [baseVers, setBaseVers] = useState<number[]>([])   // backup timestamps, newest first
  const [baseVerPos, setBaseVerPos] = useState(0)          // 0 = LIVE; 1..N = backups (newest→oldest)
  useEffect(() => {
    const cur = playScene || ''
    // base worlds only — not a branch (⑂), not the CAFE hub, not a DB space page.
    // (uses playScene==='CAFE' directly — isHub is declared later in the component)
    if (!cur || cur.includes(' ⑂ ') || cur === 'CAFE' || spaceSlug) { setBaseVers([]); setBaseVerPos(0); return }
    let stop = false
    fetch(`/api/engine/scene?action=versions&name=${encodeURIComponent(cur)}`).then(r => r.json()).then(j => {
      if (stop) return
      const vs = (Array.isArray(j.versions) ? j.versions : [])
        .map((v: { timestamp: number }) => v.timestamp).sort((a: number, b: number) => b - a)
      setBaseVers(vs); setBaseVerPos(0)
    }).catch(() => {})
    return () => { stop = true }
  }, [playScene, spaceSlug])
  const whoRef = useRef('')
  useEffect(() => {
    // a guest's per-player saves key off THIS token, so it must be strong +
    // stable per browser. 4 chars collided (birthday paradox ~1500 guests) and
    // an empty one pooled everyone into one shared save. 16 chars + reuse the
    // existing presence id (cc:pid) so a browser has ONE stable guest identity.
    let anon = ''
    try { anon = localStorage.getItem('cc-anon') || '' } catch { /* fine */ }
    if (!anon || anon.replace(/^anon-?/i, '').length < 8) {
      let pid = ''
      try { pid = localStorage.getItem('cc:pid') || '' } catch { /* fine */ }
      anon = 'anon-' + (pid || (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)))
      try { localStorage.setItem('cc-anon', anon) } catch { /* private mode: in-memory only, no cross-guest leak */ }
    }
    whoRef.current = me ? me.split('@')[0] : anon
  }, [me])
  // spaceSlug fallback: on a space page the scene refs are unset until you branch/load,
  // so the branch base (== the space slug) must come from spaceSlug or every branch view
  // (list, "main", the cell/vote) resolves an empty base and shows nothing.
  const cellBase = () => (lastSceneRef.current || playScene || spaceSlug || '').split(' ⑂ ')[0]

  // AUTO-SAVE — per-player progress as INFRASTRUCTURE, opt-in. A world sets
  // `worldData.persist = true` to become a "resume where you left off" world;
  // then `worldData.save` is the player's private slice — the engine loads it on
  // entry and writes it back on change (debounced) + on leave, scoped per-user
  // per-world. Default (no flag) = fresh every visit (arcade-style), nothing
  // saved. The world just reads/writes worldData.save; everything else stays
  // shared/transient.
  const persistOn = () => !!simulationRef.current?.worldData?.['persist']
  const autoSaveSerRef = useRef('')
  const autoSaveAtRef = useRef(0)
  const autoSaveReadyRef = useRef(false)   // gate: don't persist until the load resolves (else the default overwrites the real save)
  const hookErrAtRef = useRef(0)           // last hook-error timestamp forwarded to the server (bridge-visible)
  useEffect(() => {
    if (!spaceSlug && !playScene) return
    let stopped = false
    autoSaveSerRef.current = ''; autoSaveAtRef.current = 0; autoSaveReadyRef.current = false
    const slotOf = () => `${(lastSceneRef.current || playScene || spaceSlug || '').split(' ⑂ ')[0]}:__autosave`
    // 1) LOAD the player's save into worldData.save — ONLY for persist worlds
    const tryLoad = (attempt = 0) => {
      if (stopped) return
      const sim = simulationRef.current
      if (!sim) { if (attempt < 40) setTimeout(() => tryLoad(attempt + 1), 200); return }
      if (!sim.worldData?.['persist']) return   // arcade-style: no persistence, fresh each visit
      fetch(`/api/engine/save?scope=user&anon=${encodeURIComponent(whoRef.current || '')}&slot=${encodeURIComponent(slotOf())}`)
        .then(r => r.json())
        .then(j => {
          const s = simulationRef.current
          if (!stopped && s && j?.data != null) { s.worldData['save'] = j.data; autoSaveSerRef.current = JSON.stringify(j.data) }
        })
        .catch(() => {})
        .finally(() => { autoSaveReadyRef.current = true })   // now the frame loop may persist changes
    }
    tryLoad()
    // 2) FLUSH on leave — a final save so nothing since the last debounce is lost.
    // NOT a reset: it persists the current state. Only for persist worlds.
    const flush = () => {
      if (!persistOn()) return
      const sv = simulationRef.current?.worldData?.['save']
      if (sv === undefined) return
      try {
        fetch('/api/engine/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
          body: JSON.stringify({ slot: slotOf(), data: sv, scope: 'user', anon: whoRef.current }) }).catch(() => {})
      } catch { /* leaving anyway */ }
    }
    window.addEventListener('pagehide', flush)
    return () => { stopped = true; window.removeEventListener('pagehide', flush); flush() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceSlug, playScene])
  // NOTE: cellData now carries only presence (viewers) + discussion. Voting was
  // a SECOND tally here (a parallel quorum-of-5 nobody counted) — removed. The
  // one and only vote is the ⚔ reckoning (TournamentBar / the tournament doc).
  // the WORLD ARENA's view of the ridden branch — tier, cell, votes, podium.
  // Shown in the dock so a branch owner sees their tournament standing without
  // opening the reckoning; explicit filler when the branch has no votes yet.
  const [arenaDoc, setArenaDoc] = useState<{ tier?: number; cells?: Array<{ worlds: string[]; votes: Record<string, string> }>; champion?: string | null } | null>(null)
  useEffect(() => {
    if (!riding) { setArenaDoc(null); return }
    let stop = false
    const load = () => fetch(`/api/engine/save?slot=${encodeURIComponent('tournament:world:' + cellBase().toUpperCase())}`)
      .then(r => r.json()).then(j => { if (!stop) setArenaDoc(j?.data || null) }).catch(() => {})
    load()
    const t = setInterval(load, 10000)
    return () => { stop = true; clearInterval(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riding])

  const loadCellDoc = useCallback(async (): Promise<CellDoc> => {
    try {
      const j = await fetch(`/api/engine/save?slot=${encodeURIComponent('cell:' + cellBase())}`).then(r => r.json())
      const d = j?.data || {}
      return { viewers: d.viewers || {}, votes: d.votes || {}, discussion: d.discussion || {} }
    } catch { return { viewers: {}, votes: {}, discussion: {} } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene])
  const saveCellDoc = useCallback((doc: CellDoc) => {
    fetch('/api/engine/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: 'cell:' + cellBase(), data: doc }),
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene])
  useEffect(() => {
    if (!branchesOpen && !riding) return
    let stop = false
    const beat = async () => {
      const doc = await loadCellDoc()
      const now = Date.now()
      for (const k of Object.keys(doc.viewers)) if (now - doc.viewers[k] > 12000) delete doc.viewers[k]
      doc.viewers[whoRef.current] = now
      if (!stop) { saveCellDoc(doc); setCellData(doc) }
    }
    beat()
    const iv = setInterval(beat, 3000)
    return () => { stop = true; clearInterval(iv) }
  }, [branchesOpen, riding, loadCellDoc, saveCellDoc])
  const lastSceneRef = useRef<string>('')
  // the lineage base of the world in view — what set-main / promote / main-rule key by
  const lineageBase = (spaceId ? (spaceName || spaceSlug || '') : (lastSceneRef.current || playScene || '')).split(' ⑂ ')[0].trim()
  const aiDirtyRef = useRef(false)
  const aiLastEditRef = useRef(0)
  const bridgeToastRef = useRef(0)   // rate-limits the "AI editing live" toast
  const eyeCheckRef = useRef(0)
  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json())
      .then(s => { setMe(s?.user?.email || s?.user?.name || null); setMyName(s?.user?.name || '') }).catch(() => {})
  }, [])
  // a freshly brewed (blank) world no longer pops the how-to box — while the
  // AI is building it, the owner just sees a working spinner (rendered below).
  // Focus throttle: a WATCHING viewer gets full rate (spectators give no input) —
  // only an unfocused-but-visible window drops to ~10fps. Hidden tabs pause free (rAF).
  const windowFocusedRef = useRef(typeof document !== 'undefined' ? document.hasFocus() : true)
  // Lossless frame memoization: fingerprint of everything the pixels depend on
  const frameFingerprintRef = useRef('')
  // SSE liveness: last time the agent stream said anything (pings count)
  const lastSSEMsgRef = useRef(Date.now())
  // last time a real BUILD COMMAND arrived over SSE (pings/beacons don't count) —
  // when this goes stale but a build is happening, the durable console poll owns
  // the terminal (prod: the in-memory SSE queue can't cross serverless instances)
  const lastSSECmdRef = useRef(Date.now())
  const lastConsoleSeqRef = useRef(0)
  const lastParticleRef = useRef(0)
  const rendererRef = useRef<FieldRenderer | null>(null)
  const pendingAtlasRef = useRef<Uint32Array | null>(null)   // door bubble-face atlas, re-applied on renderer (re)init
  const simulationRef = useRef<FieldSimulation | null>(null)
  // a world flagged worldData.__sandbox runs its hook in a sealed Web Worker
  // instead of new Function on the main thread — no DOM, no network reach.
  const sandboxRef = useRef<WorldSandbox | null>(null)
  // mirror of the world's JS hooks so a LIVE add/remove/update during a build
  // (owner watching over SSE) can re-install the sandbox from the full set.
  const liveHooksRef = useRef<Map<string, { id: string; author: string; description: string; code: string }>>(new Map())
  const installHooks = useCallback((sim: FieldSimulation, stepHooks: { id: string; author: string; description: string; code: string }[] | undefined, worldData: Record<string, unknown> | undefined) => {
    sandboxRef.current?.dispose()
    sandboxRef.current = null
    liveHooksRef.current = new Map((stepHooks || []).map(h => [h.id, h]))
    // __sandbox = untrusted author (AI / player world). Its JS runs ONLY in the
    // sealed Worker — never new Function on the main thread, which would hand it
    // the visitor's cookies + same-origin fetch. Canonical/admin worlds omit the
    // flag and keep the proven main-thread path.
    if (worldData?.__sandbox && stepHooks && stepHooks.length > 0) {
      const box = new WorldSandbox()
      box.load(stepHooks.map(h => ({ id: h.id, code: h.code })))   // all hooks, isolated
      if (box.active) {
        sandboxRef.current = box
        return   // the sandbox owns the hooks — do NOT compile them on the main thread
      }
      // sandbox REQUIRED but the Worker couldn't spawn (CSP / no Worker support).
      // Do NOT fall back to the main thread for untrusted code — leave the hooks
      // un-run so the world stays safe (static) rather than becoming an XSS vector.
      console.warn('[sandbox] required but Worker unavailable — untrusted hooks skipped')
      return
    }
    for (const h of stepHooks || []) sim.addStepHook(h.id, h.author, h.description, h.code)
  }, [])
  /** EVERY hook this world owns — including sandbox-owned ones. A __sandbox
   *  world's hooks run in the sealed Worker (mirrored in liveHooksRef) and are
   *  NEVER registered in sim, so sim.getStepHookSnapshots() is EMPTY for them.
   *  Any save/sync that reads sim alone silently ERASES the world's hooks from
   *  the DB (the KINDLE frozen-cursor bug: the owner tab's own 2s sync wiped the
   *  hook it was running). All persist paths must read THIS union instead. */
  const allStepHookSnapshots = useCallback((sim: FieldSimulation) => {
    const snaps = sim.getStepHookSnapshots()
    const seen = new Set(snaps.map(h => h.id))
    for (const h of liveHooksRef.current.values()) if (!seen.has(h.id)) snaps.push({ ...h })
    return snaps
  }, [])
  const inputRef = useRef<FieldInput | null>(null)
  const animFrameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  const lastFrameRef = useRef<number>(0)
  // GPU/frame budget meter — EMA of frame ms, published to worldData.__budget
  // every 2s so builders (human or AI, via the bridge) SEE cost before it hangs
  const frameMsEmaRef = useRef<number>(16)
  const budgetWroteRef = useRef<number>(0)
  const budgetWarnedRef = useRef<boolean>(false)
  // RENDER-SCALE GOVERNOR — an internal multiplier on the world's declared
  // renderScale. It eases DOWN under sustained load (fewer pixels → the GPU
  // recovers) and recovers UP when frames are comfortable, so a heavy world
  // degrades gracefully instead of freezing the tab.
  const autoScaleRef = useRef<number>(1)       // 1 = full res; floor ~0.55
  const govAdjAtRef = useRef<number>(0)         // last adjustment time (cooldown, anti-thrash)
  const govNotifiedRef = useRef<boolean>(false) // told the player once this session
  // device-tier START: weak/mobile GPUs begin a notch down so the first heavy
  // frames can't spike into a freeze before the governor reacts (it recovers to
  // full on its own if the device can actually handle it).
  useEffect(() => {
    try {
      const weak = (navigator.hardwareConcurrency || 8) <= 4 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
      if (weak) autoScaleRef.current = 0.8
    } catch { /* fine */ }
  }, [])
  const lastSampleTimeRef = useRef<number>(0)
  const lastPresenceRef = useRef<number>(0)
  const cachedOverlapMasksRef = useRef<Map<string, Uint8Array>>(new Map())
  const failedIxEffectsRef = useRef<Set<string>>(new Set())
  const renderedSamplesRef = useRef<Map<string, { width: number; height: number; pixels: number[] }>>(new Map())
  // Hook-initiated room transitions: hooks set worldData.__loadScene = 'Name';
  // the frame loop consumes it via this ref (assigned before the render loop starts)
  const loadSceneRef = useRef<((name: string) => void) | null>(null)

  // WGSL mods — reusable shader utilities registered by agents
  const wgslModsRef = useRef<Map<string, { id: string; code: string }>>(new Map())

  // Track which fields have had their step state initialized on GPU (don't re-upload every frame)
  const stepStateInitializedRef = useRef<Set<string>>(new Set())


  // Camera follow mode
  const cameraFollowRef = useRef<CameraFollow | null>(null)

  // Audio system
  const audioRef = useRef<GameAudio>(new GameAudio())
  // audio dies with its world: Web Audio sources keep playing after React
  // unmounts, so leaving the page must close the context explicitly
  useEffect(() => {
    const audio = audioRef.current
    return () => { audio.destroy(); sandboxRef.current?.dispose() }
  }, [])
  // ── fault surface: when the world goes down, SAY WHY on screen ──
  const [fault, setFault] = useState<{ kind: string; message: string } | null>(null)
  const frameCrashRef = useRef(false)
  useEffect(() => {
    const onFault = (e: Event) => {
      const det = (e as CustomEvent).detail as { kind: string; message: string }
      // FIRST fault wins the banner — later faults are usually echoes of it
      setFault(prev => prev ?? det)
      try {
        const log = JSON.parse(localStorage.getItem('cc-fault-log') || '[]')
        log.unshift({ ...det, scene: lastSceneRef.current || playScene || spaceSlug || 'unknown', at: new Date().toISOString() })
        localStorage.setItem('cc-fault-log', JSON.stringify(log.slice(0, 8)))
        localStorage.setItem('cc-last-fault', JSON.stringify(log[0]))
      } catch { /* fine */ }
    }
    window.addEventListener('cc:fault', onFault)
    return () => window.removeEventListener('cc:fault', onFault)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the cafe mute switch rules world audio too — one button, all sound
  useEffect(() => {
    const audio = audioRef.current
    try { if (localStorage.getItem('cc-mute')) audio.setVolume(0) } catch { /* fine */ }
    const onMute = (e: Event) => audio.setVolume((e as CustomEvent).detail ? 0 : 1)
    // world sounds fire from the frame loop, where browsers refuse to birth an
    // AudioContext — the player's first real gesture unlocks it here instead
    const onGesture = () => audio.unlock()
    window.addEventListener('pointerdown', onGesture, { capture: true })
    window.addEventListener('keydown', onGesture, { capture: true })
    window.addEventListener('cafe:muted', onMute)
    // the door's bubble faces: the shell builds a packed screenshot atlas and
    // hands it here; the renderer folds it into the super pass so faces are
    // drawn by the same shader as the bubbles (never a detachable overlay).
    // Late arrivals + late-mounted renderer both covered: cache and re-apply.
    const applyAtlas = (data: Uint32Array) => {
      pendingAtlasRef.current = data
      rendererRef.current?.uploadIconAtlas(data)
    }
    const onAtlas = (e: Event) => {
      const d = (e as CustomEvent).detail as Uint32Array | undefined
      if (d && d.length) applyAtlas(d)
    }
    // a just-mounted door may have missed the shell's one-shot dispatch
    const staged = (window as unknown as { __cafeIconAtlas?: Uint32Array }).__cafeIconAtlas
    if (staged && staged.length) applyAtlas(staged)
    window.addEventListener('cafe:icon-atlas', onAtlas)
    return () => {
      window.removeEventListener('cafe:muted', onMute)
      window.removeEventListener('pointerdown', onGesture, { capture: true })
      window.removeEventListener('keydown', onGesture, { capture: true })
      window.removeEventListener('cafe:icon-atlas', onAtlas)
    }
  }, [])

  // true while a hub scene draws the player's own cursor glyph — the OS cursor
  // is hidden then, and the pointer handlers must not flash it back to 'grab'.
  const hubCursorRef = useRef(false)
  // BREWED GLYPH CURSOR — the flexible half of BREW YOUR ICON. The hub shader
  // (CAFE / SUB-MAIN) draws the cursor icon itself and ships a no-op module
  // slot, `mod_playerglyph`. When the brewed icon carries custom WGSL (an AI
  // set it via set_player_icon), that module is simply replaced with the
  // player's code — the shader then draws the glyph in the exact seat the
  // presets use (the hook packs fx = -1 so the preset stands down). One
  // container, no extra fields, no transform plumbing.
  useEffect(() => {
    const MOD = 'playerglyph'
    const NOOP = 'fn mod_playerglyph(uv: vec2f, t: f32) -> vec4f { return vec4f(0.0); }'
    const apply = () => {
      const sim = simulationRef.current
      const renderer = rendererRef.current
      if (!sim || !renderer) return
      // the slot only exists in the hub scenes — elsewhere there is nothing to fill
      const inHub = sim.fields.has('cf_world_f') || sim.fields.has('cf_submain_f')
      // HIDE THE OS CURSOR in the hub: the shader draws the player's glyph AT the
      // pointer, so the browser's own arrow/hand would just double it up. Games
      // and the editor keep the normal cursor. hubCursorRef stops the pointer
      // handlers from flashing 'grab' back on after a click.
      hubCursorRef.current = inHub
      const cv = canvasRef.current
      if (cv) cv.style.cursor = inHub ? 'none' : 'grab'
      if (!inHub) { if (sim.worldData.__glyphOn) delete sim.worldData.__glyphOn; return }
      const wgsl = playerGlyphWgsl()
      const code = wgsl ? wrapPlayerGlyph(wgsl) : NOOP
      // scene loads re-register the cartridge's no-op — compare the LIVE registry,
      // not a local memo, and only recompile when the slot actually changes
      const current = renderer.getAllModules().find(m => m.name === MOD)?.wgsl
      if (current !== code) renderer.registerModule(MOD, code)
      if (wgsl) sim.worldData.__glyphOn = 1
      else if (sim.worldData.__glyphOn) delete sim.worldData.__glyphOn
    }
    window.addEventListener('cafe:icon', apply)
    const iv = setInterval(apply, 1500)
    apply()
    return () => { window.removeEventListener('cafe:icon', apply); clearInterval(iv) }
  }, [])

  // HUD elements (driven by worldData['hud'])
  const hudContainerRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)   // the top-right UI dock — its bottom seats the VOTE button
  const hudElementCacheRef = useRef<Map<string, HTMLElement>>(new Map())
  const nameToIdRef = useRef<Map<string, string>>(new Map())
  const lastFieldCountRef = useRef<number>(0)

  // Report the UI dock's live bottom (it grows/shrinks as the dock opens and as
  // buttons appear) so the shell can seat the VOTE button right beneath it. A
  // hidden dock (voting viewport) measures 0 → the shell uses its own fallback.
  useEffect(() => {
    if (!onDockRect) return
    const el = dockRef.current
    if (!el) return
    const report = () => { const r = el.getBoundingClientRect(); onDockRect(r.height > 0 ? r.bottom : 0) }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onDockRect])

  // Camera
  const gridSize = DEFAULT_GRID_SIZE
  const cameraRef = useRef<Camera>({ x: gridSize / 2, y: gridSize / 2, zoom: 1 })
  const [, forceUpdate] = useState(0)

  // 2D/3D render mode
  // 3D mode removed: the superimposed 2D path carries full 3D via raymarched
  // visuals (see the scene library) — a second pipeline was pure overhead.
  const renderMode = '2d' as const
  const renderModeRef = useRef<'2d' | '3d'>('2d')
  const camera3DRef = useRef({ pos: [gridSize / 2, gridSize / 2, 150] as [number, number, number], pitch: -0.6, yaw: 0, fov: 1.047 })
  const isOrbiting = useRef(false)

  // Brush state
  const [brush, setBrush] = useState<BrushState>({
    tool: 'brush',
    size: 4,
    activeFieldId: null,
  })

  // Fields (mirrored from simulation for React rendering)
  const [fields, setFields] = useState<Map<string, Field>>(new Map())
  const [running, setRunning] = useState(false)

  // Selection state
  const [selection, setSelection] = useState<SelectionState>({
    selectedFieldId: null,
    selectionMask: new Uint8Array(DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE),
  })

  // Designer sidebar state
  const [terminalOpen, setTerminalOpen] = useState(false)
  // the floating BUILD CONSOLE — opened from the EDIT menu or auto during a build,
  // closed with its ✕. buildConsoleClosedRef remembers a manual close so the
  // auto-open doesn't fight it (the old auto-open-once latch was the buggy part).
  const [buildConsoleOpen, setBuildConsoleOpen] = useState(false)
  const buildConsoleClosedRef = useRef(false)
  // WebGPU unavailable or lost — show a human answer, not a black void
  const [gpuFailed, setGpuFailed] = useState(false)

  // World mode: the world is just the world — editor chrome hides behind a toggle
  const [chromeVisible, setChromeVisible] = useState(!spaceId && !playScene)
  // (public/private moved into the merged WORLD TOOLS panel — the embedded
  //  SpaceManagementOverlay's "visibility" is the single front-door control)
  // DIRECT EDIT KEYS: the branch/version scene name being keyed (empty = current branch)
  // ONE toolbox everywhere — WORLD TOOLS also serves a ⑂ branch that is YOURS
  // (matches the ownership rule the legacy chip row used: handle in the branch name)
  const ownBranchTools = (() => {
    const cur = lastSceneRef?.current || ''
    const bm = cur.match(/ ⑂ ([^·]+?)(?: ·|$)/)
    const myHandle = me ? me.split('@')[0].replace(/[^a-z0-9_-]/gi, '') : null
    return !spaceId && !!bm && !!myHandle && bm[1].trim() === myHandle
  })()
  // the panel itself shows to EVERY viewer of a space or branch — ownership only
  // unlocks the editing sections (same UI, ownership-gated tools)
  const onBranchScene = !spaceId && (lastSceneRef?.current || '').includes(' ⑂ ')

  // which space version is on the glass, CLIENT-side — starts at the server
  // prop, then the ⏱ scrubber hot-swaps it in place (no reload). Because ctx.view
  // derives from THIS, hot-swapping to an old version flips can(ctx,'editLaw') &c.
  // to read-only automatically — no separate gating to thread.
  const [spaceVer, setSpaceVer] = useState<number | undefined>(versionView)
  // a LIVE versionView prop (the space page's vote-preview) hot-swaps the world:
  // candidates in THE RECKONING load as you focus them, LIVE returns you home
  const verPropRef = useRef(versionView)
  useEffect(() => {
    if (verPropRef.current === versionView) return
    verPropRef.current = versionView
    if (spaceSlug) hotLoadSpaceVersionRef.current?.(versionView)
  }, [versionView, spaceSlug])
  const hotLoadSpaceVersionRef = useRef<((v: number | undefined) => Promise<void>) | null>(null)

  // THE UNIFIED CONTEXT — computed once, read at render (refs are live). Every
  // chrome gate below asks `can(ctx, …)` instead of re-deriving the spaceId /
  // branch / riding / owner tangle. See lib/worldContext.ts + DESIGN-unified-chrome.md.
  const ctx: WorldContext = deriveContext({
    surface: (playScene === 'CAFE' || playScene === 'SUB-MAIN') ? 'hub' : 'world',
    loaded: riding || lastSceneRef?.current || playScene || spaceSlug || '',
    slug: spaceSlug,
    email: me,
    // FieldEngine already knows ownership as booleans — synthesize ids so
    // deriveContext resolves the same role it always did.
    spaceOwnerId: isOwner ? 'self' : 'other',
    myUserId: 'self',
    versionView: spaceId ? spaceVer : versionView,
    riding: !!riding,
  })

  // Saved scenes list (server-side persistent)
  const [savedScenes, setSavedScenes] = useState<string[]>([])
  // Writer lease: this tab's identity for global-world sync. When another
  // session holds the lease, our syncs 409 and we go read-only (worldLocked).
  const clientIdRef = useRef(`tab_${Math.random().toString(36).slice(2, 10)}`)
  const takeoverRef = useRef(false)
  const [worldLocked, setWorldLocked] = useState(false)

  // Generation state — UI-only loading tracker, WGSL lives on Field objects
  const [generation, setGeneration] = useState<GenerationState>({
    loading: false,
    error: null,
    targetFieldId: null,
  })

  // Pointer state for panning (Space + drag to pan)
  const pointerDown = useRef(false)
  const isPanning = useRef(false)

  // ── Player presence: every viewer is an orb on everyone else's screen. ──
  // Tabs report their cursor ~4×/s; the server answers with up to 25 others
  // (the cap per viewing instance). Others also land in worldData.presence,
  // so a world's hook or shader can react to visitors without engine changes.
  const [presenceOthers, setPresenceOthers] = useState<Array<{ id: string; x: number; y: number; hue: number }>>([])
  // pids rendered at least once THIS world — a pip snaps to place on first sight
  // (no CSS transition) so it never slides in from a stale/off-screen position.
  const seenPipsRef = useRef<Set<string>>(new Set())
  const [presenceOff, setPresenceOff] = useState(false)
  const presenceOffRef = useRef(false)
  const [, setToolsTick] = useState(0)
  useEffect(() => {
    try { const v = !!localStorage.getItem('cc-presence-off'); setPresenceOff(v); presenceOffRef.current = v } catch { /* fine */ }
  }, [])
  // after a pip has rendered once, mark it seen so its NEXT position change
  // animates (snap only on the very first frame it appears)
  useEffect(() => { for (const o of presenceOthers) seenPipsRef.current.add(o.id) }, [presenceOthers])
  const presenceIdRef = useRef<string>('')
  // other players' brewed-glyph seats (pid → slot 0-2, pid → wgsl). Lives at
  // component level so the scene loader can re-overlay live seats after a
  // reload re-registers the cartridge's no-op modules.
  const otherGlyphsRef = useRef<{ slots: Map<string, number>; code: Map<string, string> }>({ slots: new Map(), code: new Map() })
  useEffect(() => {
    if (!presenceIdRef.current) {
      // ONE DOCK PER PLAYER (the Unity Chant law): identity is the person, not
      // the tab. All of a player's tabs share this id, so their signals merge
      // into a single cursor — and your own other tabs vanish for you entirely
      // (self-skip). Signed-in id wins; otherwise a per-browser id persists.
      const who = (window as unknown as { __cafeWho?: { id?: string } }).__cafeWho
      let pid = who?.id || ''
      if (!pid) {
        try {
          pid = localStorage.getItem('cc:pid') || ''
          if (!pid) { pid = Math.random().toString(36).slice(2, 10); localStorage.setItem('cc:pid', pid) }
        } catch { pid = Math.random().toString(36).slice(2, 10) }
      }
      presenceIdRef.current = pid
    }
    const id = presenceIdRef.current
    // presenceKey scopes the LIVE-cursor room per hub sub-view so a person
    // browsing a sub-main / player-worlds directory doesn't bleed onto main as a
    // live cursor (they nest on main as a docked orb via /api/presence instead).
    const world = spaceId || presenceKey || playScene || 'global'
    // entering a new world: drop the previous world's pips + snap-tracking, so no
    // cursor animates in from where it stood in the world you just left
    setPresenceOthers(prev => (prev.length ? [] : prev))
    seenPipsRef.current = new Set()
    // Presence over the Railway Socket.IO server (persistent → shared in
    // PRODUCTION, unlike the per-instance in-memory HTTP route). Cursors ride the
    // same room protocol as the hub (join-instance / position → player-moved).
    // Others land in worldData.presence in the {id,x,y,hue} grid shape the cafe
    // shader already reads. The room key ('cursors:'+world) is the sharding seam:
    // for >~25 players, join 'cursors:'+world+'#2', etc. Hue is derived from each
    // id, so colors are stable without threading color through every move.
    // dev seam: localStorage cc-presence-url points ONE tab at a local server
    // (server.js changes can be exercised without touching everyone's env)
    let presenceOverride: string | null = null
    try { presenceOverride = localStorage.getItem('cc-presence-url') } catch { /* fine */ }
    const PRESENCE_URL = presenceOverride || process.env.NEXT_PUBLIC_PRESENCE_URL || 'http://localhost:8080'
    const instance = 'cursors:' + world
    const hueOf = (pid: string) => { let h = 0; for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) % 360; return h }
    // OTHER players' BREWED GLYPHS — their cursor WGSL rides presence (auth →
    // room player). Up to 3 seats: each gets a namespaced module (mod_pg0-2)
    // in the uber-shader; everyone past that dances as a comet. Seats are
    // sticky per player id so a busy room doesn't thrash recompiles. A fresh
    // room starts with fresh seats.
    const og = otherGlyphsRef.current
    og.slots.clear(); og.code.clear()
    const glyphSlots = og.slots
    const glyphOf = og.code
    const noteGlyph = (pid: string, glyph: unknown) => {
      if (pid === id) return
      const w = typeof glyph === 'string' && glyph.length <= 8192 && /fn\s+visual_glyph\s*\(/.test(glyph) ? glyph : null
      if (!w) { glyphOf.delete(pid); return }
      if (glyphOf.get(pid) === w && glyphSlots.has(pid)) return
      glyphOf.set(pid, w)
      let slot = glyphSlots.get(pid)
      if (slot === undefined) {
        const used = new Set(glyphSlots.values())
        for (let s = 0; s < 3; s++) if (!used.has(s)) { slot = s; break }
        if (slot === undefined) return   // no seat free — comet for them
        glyphSlots.set(pid, slot)
      }
      const renderer = rendererRef.current
      if (!renderer) return
      const code = wrapOtherGlyph(w, slot)
      if (renderer.getAllModules().find(m => m.name === 'pg' + slot)?.wgsl !== code) renderer.registerModule('pg' + slot, code)
    }
    // Entity interpolation: buffer timestamped samples per player, then each frame
    // render each one ~INTERP_DELAY ms in the PAST, blending the two samples that
    // straddle that time. Sparse network updates → perfectly smooth curved motion
    // (the standard game networking approach).
    const INTERP_DELAY = 110
    type Sample = { t: number; rx: number; ry: number }
    const buffers = new Map<string, Sample[]>()
    // activity = the position actually CHANGING. Old clients broadcast on an
    // interval even while parked, so sample arrival time proves nothing.
    const lastAct = new Map<string, { x: number; y: number; t: number }>()
    const pushSample = (pid: string, rx: number, ry: number) => {
      const now = Date.now()
      const prev = lastAct.get(pid)
      if (!prev || Math.hypot(rx - prev.x, ry - prev.y) > 0.004) lastAct.set(pid, { x: rx, y: ry, t: now })
      let buf = buffers.get(pid)
      if (!buf) { buf = []; buffers.set(pid, buf) }
      buf.push({ t: now, rx, ry })
      const cutoff = now - 1000
      while (buf.length > 2 && buf[0].t < cutoff) buf.shift()   // keep ~1s of history
    }
    const sampleAt = (buf: Sample[], t: number): { rx: number; ry: number } => {
      const n = buf.length
      if (n === 1 || t >= buf[n - 1].t) return buf[n - 1]   // ahead of newest → hold
      if (t <= buf[0].t) return buf[0]
      for (let i = n - 1; i > 0; i--) {
        if (buf[i - 1].t <= t) {
          const a = buf[i - 1], b = buf[i], span = b.t - a.t
          const f = span > 0 ? (t - a.t) / span : 0
          return { rx: a.rx + (b.rx - a.rx) * f, ry: a.ry + (b.ry - a.ry) * f }
        }
      }
      return buf[0]
    }
    // DOM-pip path (non-cafe worlds, already CSS-smoothed): latest sample per player.
    const publish = () => {
      const arr: Array<{ id: string; x: number; y: number; hue: number }> = []
      for (const [pid, buf] of buffers) {
        if (pid === id || buf.length === 0) continue
        const last = buf[buf.length - 1]
        if (Date.now() - (lastAct.get(pid)?.t ?? 0) > 60000) continue   // parked cursor — let it vanish
        arr.push({ id: pid, x: last.rx * gridSize, y: last.ry * gridSize, hue: hueOf(pid) })
        if (arr.length >= 25) break
      }
      setPresenceOthers(prev => (prev.length === 0 && arr.length === 0) ? prev : arr)
    }
    // quiet rooms get no events, so the idle filter needs its own heartbeat
    const idleSweep = setInterval(publish, 10000)
    console.log('[cursors] connecting to', PRESENCE_URL, 'room', instance, 'as', id)
    const socket: Socket = io(PRESENCE_URL, { transports: ['websocket', 'polling'], reconnection: true })
    const announce = () => {
      socket.emit('auth', { userId: id, name: id, color: `hsl(${hueOf(id)},70%,60%)`, spaceSlug: world, glyph: playerGlyphWgsl() })
    }
    socket.on('connect', () => {
      console.log('[cursors] connected', socket.id)
      announce()
      socket.emit('join-instance', { instance })
    })
    // icon brewed mid-session → re-auth; the server updates the live room
    // player and re-announces, so peers pick the new glyph up without a rejoin
    const onIconChange = () => { if (socket.connected) announce() }
    window.addEventListener('cafe:icon', onIconChange)
    // sign-out on the way out: a closed tab leaves the room immediately
    const onPageHide = () => { try { socket.disconnect() } catch { /* gone anyway */ } }
    window.addEventListener('pagehide', onPageHide)
    socket.on('connect_error', (e: Error) => console.warn('[cursors] connect_error →', PRESENCE_URL, e.message))
    socket.on('instance-state', ({ players: list }: { players: Array<{ id: string; rx?: number; ry?: number; glyph?: string | null; idleMs?: number }> }) => {
      const ids = new Set(list.map(p => p.id))
      for (const pid of Array.from(buffers.keys())) if (!ids.has(pid)) buffers.delete(pid)
      for (const p of list) {
        pushSample(p.id, p.rx ?? 0.5, p.ry ?? 0.5)
        noteGlyph(p.id, p.glyph)
        // joining must not resurrect the parked: backdate their activity by the
        // server-reported idle time so an already-still player never shows
        if (p.idleMs && p.idleMs > 0) lastAct.set(p.id, { x: p.rx ?? 0.5, y: p.ry ?? 0.5, t: Date.now() - p.idleMs })
      }
      publish()
    })
    socket.on('player-joined', ({ player }: { player: { id: string; rx?: number; ry?: number; glyph?: string | null } }) => { pushSample(player.id, player.rx ?? 0.5, player.ry ?? 0.5); noteGlyph(player.id, player.glyph); publish() })
    socket.on('player-left', ({ playerId }: { playerId: string }) => { buffers.delete(playerId); lastAct.delete(playerId); publish() })
    socket.on('player-moved', ({ playerId, rx, ry }: { playerId: string; rx: number; ry: number }) => { pushSample(playerId, rx, ry); publish() })
    // per-frame: write the INTERPOLATED positions to worldData.presence for the
    // cafe shader (no React state here — safe at 60fps).
    let raf = 0
    const interp = () => {
      const sim = simulationRef.current
      const wdp = sim?.worldData
      if (sim && wdp && !(wdp['singlePlayer'] === true || wdp['multiplayer'] === false) && !presenceOffRef.current) {
        const renderT = Date.now() - INTERP_DELAY
        const others: Array<{ id: string; x: number; y: number; hue: number; slot: number }> = []
        for (const [pid, buf] of buffers) {
          if (pid === id || buf.length === 0) continue
          // still for 60s = gone; their next real move brings them back
          if (renderT - (lastAct.get(pid)?.t ?? 0) > 60000) continue
          const s = sampleAt(buf, renderT)
          // slot = which mod_pg seat holds this player's brewed glyph (-1 = comet)
          const slot = glyphOf.has(pid) ? (glyphSlots.get(pid) ?? -1) : -1
          others.push({ id: pid, x: s.rx * gridSize, y: s.ry * gridSize, hue: hueOf(pid), slot })
          if (others.length >= 25) break
        }
        wdp['presence'] = others
      }
      raf = requestAnimationFrame(interp)
    }
    raf = requestAnimationFrame(interp)
    // broadcast our cursor often (only when it moves) — dense samples let the
    // receiver interpolate a smooth curve instead of jumping. Gated by single/off.
    let lastX = -1, lastY = -1
    const iv = setInterval(() => {
      const sim = simulationRef.current
      const wdp = sim?.worldData
      // single-player or presence-off: don't broadcast, and hide others locally.
      if ((wdp && (wdp['singlePlayer'] === true || wdp['multiplayer'] === false)) || presenceOffRef.current) {
        if (wdp && wdp['presence']) delete wdp['presence']
        setPresenceOthers(prev => (prev.length ? [] : prev))
        return
      }
      const mx = sim?.worldData['mouse_x'], my = sim?.worldData['mouse_y']
      const x = typeof mx === 'number' ? mx : gridSize / 2
      const y = typeof my === 'number' ? my : gridSize / 2
      if (x === lastX && y === lastY) return   // idle → don't spam the socket
      lastX = x; lastY = y
      socket.emit('position', { rx: x / gridSize, ry: y / gridSize })
    }, 66)
    return () => { clearInterval(iv); cancelAnimationFrame(raf); window.removeEventListener('cafe:icon', onIconChange)
      clearInterval(idleSweep); window.removeEventListener('pagehide', onPageHide); socket.disconnect() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, playScene, presenceKey])
  const spaceHeld = useRef(false)
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Drag state for fields
  const draggingFieldId = useRef<string | null>(null)
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragStartScreen = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Pixel hover tooltip
  const [pixelInfo, setPixelInfo] = useState<{
    screenX: number; screenY: number
    gridX: number; gridY: number
    r: number; g: number; b: number; a: number
    fields: string[]
  } | null>(null)
  const pixelInfoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Get concatenated WGSL mod code from all registered mods */
  const getModCode = useCallback((): string | undefined => {
    const mods = wgslModsRef.current
    if (mods.size === 0) return undefined
    return Array.from(mods.values()).map(m => m.code).join('\n')
  }, [])

  // Sync fields from simulation to React state
  const syncFields = useCallback(() => {
    const sim = simulationRef.current
    if (!sim) return
    setFields(new Map(sim.fields))
  }, [])

  // Update selection mask and upload to GPU
  const updateSelectionMask = useCallback((fieldId: string | null) => {
    const renderer = rendererRef.current
    if (!renderer) return
    const mask = new Uint8Array(gridSize * gridSize)
    renderer.uploadSelectionData(mask)
    setSelection({ selectedFieldId: fieldId, selectionMask: mask })
  }, [])

  // No default shader — fields are invisible until an agent adds an effect

  // Create field
  const handleCreateField = useCallback(() => {
    const sim = simulationRef.current
    if (!sim) return
    const id = genFieldId()
    const hue = DEFAULT_HUES[sim.fields.size % DEFAULT_HUES.length]
    const color = hueToRgba(hue)
    const name = `Field ${sim.fields.size + 1}`
    sim.createField(id, name, color)

    setBrush(prev => ({ ...prev, activeFieldId: id }))
    syncFields()
  }, [syncFields])

  // Delete field — removes all effects
  const handleDeleteField = useCallback((id: string) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim) return

    // Remove all effect programs for this field
    if (renderer) renderer.removeAllFieldEffects(id)

    sim.removeField(id)
    if (selection.selectedFieldId === id) {
      updateSelectionMask(null)
    }
    setBrush(prev => {
      if (prev.activeFieldId === id) {
        const remaining = Array.from(sim.fields.keys())
        return { ...prev, activeFieldId: remaining[0] || null }
      }
      return prev
    })
    syncFields()
  }, [syncFields, selection.selectedFieldId, updateSelectionMask])

  // (player_focus removed — it was low-value for AI building and unreliable to
  // pick in raymarched worlds. Agents build from the creation_brief.)

  // Select field (toolbar click)
  const handleSelectField = useCallback((id: string) => {
    setBrush(prev => ({ ...prev, activeFieldId: id }))
    updateSelectionMask(id)
  }, [updateSelectionMask])

  // Save field + children to library (explicit action via button)
  const handleSaveToLibrary = useCallback((fieldId: string) => {
    const sim = simulationRef.current
    if (!sim) return
    const field = sim.fields.get(fieldId)
    if (!field) return
    const allSnaps = sim.generateSnapshots()
    const snap = allSnaps.find(s => s.id === fieldId)
    if (!snap) return
    const groupIds = new Set<string>([fieldId])
    let changed = true
    while (changed) {
      changed = false
      for (const s of allSnaps) {
        if (s.parentFieldId && groupIds.has(s.parentFieldId) && !groupIds.has(s.id)) {
          groupIds.add(s.id)
          changed = true
        }
      }
    }
    const groupSnaps = allSnaps.filter(s => groupIds.has(s.id))
    try {
      const existing: unknown[] = JSON.parse(localStorage.getItem('fieldLibrary') || '[]')
      const filtered = existing.filter((f: unknown) => !groupIds.has((f as { id: string }).id))
      filtered.push(...groupSnaps)
      localStorage.setItem('fieldLibrary', JSON.stringify(filtered))
      const childCount = groupSnaps.length - 1
      const label = childCount > 0 ? `"${field.name}" + ${childCount} children` : `"${field.name}"`
      showToast(`Saved ${label} to library`, 'success')
    } catch { /* ignore */ }
  }, [showToast])

  // Refresh saved scenes list from server
  const refreshSceneList = useCallback(async () => {
    try {
      const resp = await fetch('/api/engine/scene?action=list')
      const { scenes } = await resp.json()
      const next = Array.isArray(scenes) ? scenes : []
      // Only touch state when the list actually changed — this refresh polls
      setSavedScenes(prev => (prev.length === next.length && prev.every((n, i) => n === next[i])) ? prev : next)
    } catch { /* ignore */ }
  }, [])

  // Save entire scene (all fields, effects, rules, hooks, world params)
  /** Snapshot the live world under a given name — the branch/version writer */
  // Returns the name the scene was ACTUALLY saved under (the store forks on
  // overwrite, so a save onto an existing branch lands as its next version), or
  // null on failure. Callers use it to follow the real branch, not a guessed one.
  const saveSceneAs = useCallback(async (sceneName: string, extraWorldData?: Record<string, unknown>): Promise<string | null> => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim) return null
    const fields = sim.generateSnapshots()
    const stepHooks = allStepHookSnapshots(sim)
    // extraWorldData wins over the inherited sim.worldData — so a branch's
    // `branchedFrom` is stamped to ITS immediate parent, not the grandparent it
    // inherited (walk the chain for full genealogy; the name still flattens to root).
    const worldData = { ...sim.worldData, ...(extraWorldData || {}) }
    // ONLY the visuals THIS world uses. The renderer registry is GLOBAL — every
    // visual from every world visited this session — so grabbing it whole scoops
    // foreign visuals (fluid_base, garnet, …) into a branch snapshot (the ORCHID
    // branch bug). Keep visuals attached to a field, or named in a hook/worldData
    // (dynamic swaps); drop the rest.
    const used = new Set<string>()
    for (const f of fields) { const vn = (f as { visualTypeName?: string }).visualTypeName; if (vn) used.add(vn) }
    const hay = JSON.stringify(stepHooks) + JSON.stringify(worldData)
    const sceneData = {
      name: sceneName,
      fields,
      worldParams: sim.getWorldParams(),
      worldData,
      stepHooks,
      interactionRules: [...sim.interactionRules],
      interactionEffects: [...sim.interactionEffects],
      visualTypes: renderer
        ? renderer.getAllVisualTypes()
            .filter(vt => used.has(vt.name) || hay.includes(vt.name))
            .map(vt => ({ name: vt.name, wgsl: vt.wgsl }))
        : [],
      modules: renderer ? renderer.getAllModules().map(m => ({ name: m.name, wgsl: m.wgsl })) : [],
      timestamp: Date.now(),
    }
    // no blank submissions — a branch version must contain a world
    if (!sceneData.fields.length && !sceneData.stepHooks.length && !sceneData.visualTypes.length) return null
    try {
      const r = await fetch('/api/engine/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', name: sceneName, scene: sceneData }),
      })
      if (!r.ok) return null
      const d = await r.json().catch(() => ({} as { savedAs?: string }))
      return (d.savedAs as string) || sceneName   // fork-on-overwrite may bump the version
    } catch { return null }
  }, [])

  /** Mint a BRANCH-scoped token for a scene branch (`BASE ⑂ handle · vN`). This is
   *  the fix for "the AI overwrote main + the branch": a scoped token binds a
   *  connected AI to THIS one branch — the bridge reads/writes only its snapshot,
   *  never main or the global registry. Space worlds mint a uc_st_ token instead;
   *  branches, being file-store scenes, get a stateless uc_sc_ token here. */
  const mintBranchToken = useCallback(async (sceneName: string) => {
    if (!sceneName.includes(' ⑂ ')) return null
    setPlugBusy(true)
    try {
      const r = await fetch('/api/engine/scene/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sceneName }),
      })
      const d = await r.json()
      if (r.ok && d.token) { setPlugToken(d.token); return d.token as string }
    } catch { /* ignore — briefing shows a minting-failed hint */ } finally { setPlugBusy(false) }
    return null
  }, [])

  // (branch-key copy lives in WORLD TOOLS → DIRECT EDIT KEYS now, via mintBranchToken)

  /** CREATE BRANCH, the methodical way (same contract as brewing a world):
   *  1 · name it in a real panel (blank = your default branch) · 2 · the branch
   *  opens and the CONNECT AI box appears with its scoped key + briefing.
   *  An optional LABEL lets you field several distinct challengers of one world
   *  (`BASE ⑂ handle · label · v1`). Re-branching an existing name doesn't
   *  clobber it — the store forks to the next version and we follow that name. */
  const [branchCreateOpen, setBranchCreateOpen] = useState(false)
  const [branchLabel, setBranchLabel] = useState('')
  const [branchBrief, setBranchBrief] = useState('')   // optional: hand the branch to the house AI

  // LINEAGE TRAIL — where this world came from (walks branchedFrom / forkOfId),
  // plus the remixes that grew FROM it (the downstream side).
  const [lineageTrail, setLineageTrail] = useState<null | { name: string; by?: string | null; kind: string; slug?: string }[]>(null)
  const [lineageRemixes, setLineageRemixes] = useState<{ name: string; slug: string }[]>([])
  const [lineageBusy, setLineageBusy] = useState(false)
  const loadLineage = useCallback(async () => {
    setLineageBusy(true)
    try {
      const cur = lastSceneRef.current || playScene || ''
      const q = cur.includes(' ⑂ ') ? `scene=${encodeURIComponent(cur)}`
              : spaceSlug ? `space=${encodeURIComponent(spaceSlug)}`
              : cur ? `scene=${encodeURIComponent(cur)}` : ''
      if (!q) { setLineageTrail([]); setLineageRemixes([]); return }
      const r = await fetch(`/api/engine/lineage/trail?${q}`)
      const d = await r.json().catch(() => ({}))
      setLineageTrail(Array.isArray(d.trail) ? d.trail : [])
      setLineageRemixes(Array.isArray(d.remixes) ? d.remixes : [])
    } catch { setLineageTrail([]); setLineageRemixes([]) } finally { setLineageBusy(false) }
  }, [playScene, spaceSlug])
  const createBranch = useCallback(async (labelRaw: string) => {
    if (!me) { window.location.href = '/auth/signin'; return }
    const src = lastSceneRef.current || playScene || spaceSlug || ''
    if (!src) { showToast('load a world first', 'error'); return }
    const base = src.split(' ⑂ ')[0]
    const user = me.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
    const label = labelRaw.trim().replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, ' ').slice(0, 40)
    const name = label ? `${base} ⑂ ${user} · ${label} · v1` : `${base} ⑂ ${user} · v1`
    // stamp the IMMEDIATE parent (src), not the flattened root — full genealogy
    const savedAs = await saveSceneAs(name, { branchedFrom: src, branchedBy: user, branchedAt: Date.now() })
    if (savedAs) {
      lastSceneRef.current = savedAs      // follow the real (possibly fork-bumped) name
      setPlugToken(null)                  // fresh branch → fresh scoped key
      mintBranchToken(savedAs)            // scope the AI to the branch that actually exists
      setBranchCreateOpen(false)
      showToast(`branch opened: ${savedAs} — the eye is watching`, 'success')
      setPlugOpen(true)   // step 2 of the method: connect your AI
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, playScene, spaceSlug, saveSceneAs, mintBranchToken])
  const handleBranch = useCallback(() => {
    if (!me) { window.location.href = '/auth/signin'; return }
    setBranchLabel(''); setBranchBrief('')
    setBranchCreateOpen(v => !v)
  }, [me])

  /** CREATE BRANCH + hand it to the house AI: fork the branch (so it exists and
   *  the owner can write it), then queue its brief for the swarm. Branches are
   *  scenes, so this goes through /api/builds/enqueue-scene (uc_sc_), not the
   *  world creation_brief path. */
  const branchWithHouseAi = useCallback(async (labelRaw: string, briefRaw: string) => {
    if (!me) { window.location.href = '/auth/signin'; return }
    const brief = briefRaw.trim()
    if (brief.length < 20) { showToast('write a longer brief first (what should it build?)', 'error'); return }
    const src = lastSceneRef.current || playScene || spaceSlug || ''
    if (!src) { showToast('load a world first', 'error'); return }
    const base = src.split(' ⑂ ')[0]
    const user = me.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
    const label = labelRaw.trim().replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, ' ').slice(0, 40)
    const name = label ? `${base} ⑂ ${user} · ${label} · v1` : `${base} ⑂ ${user} · v1`
    const savedAs = await saveSceneAs(name, { branchedFrom: src, branchedBy: user, branchedAt: Date.now() })
    if (!savedAs) { showToast('could not open the branch', 'error'); return }
    lastSceneRef.current = savedAs
    const r = await fetch('/api/builds/enqueue-scene', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneName: savedAs, brief }),
    }).then(x => x.json()).catch(() => null)
    setBranchCreateOpen(false)
    if (r?.ok) showToast(`house AI queued for your branch — it builds live: ${savedAs}`, 'success')
    else showToast(r?.error || 'could not queue the house AI', 'error')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, playScene, spaceSlug, saveSceneAs])

  /** ALTER, confirmed: keep a pre-alter save point (identical saves dedup), mint
   *  the live-scoped token, open the plug box. The altered world IS main — the
   *  save point is the way back. */
  const beginAlter = useCallback(async () => {
    if (!spaceSlug) return
    setAlterWarnOpen(false)
    try {
      await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'before alter' }),
      })
    } catch { /* the save point is a courtesy, not a gate */ }
    if (!plugToken) {
      setPlugBusy(true)
      try {
        const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'live alter' }),
        })
        const d = await r.json()
        if (r.ok) setPlugToken(d.token)
      } finally { setPlugBusy(false) }
    }
    setPlugOpen(true)
  }, [spaceSlug, plugToken])

  const handleSaveScene = useCallback(async () => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim) return
    const name = window.prompt('Scene name:')
    if (!name?.trim()) return
    const sceneName = name.trim()
    const sceneData = {
      name: sceneName,
      fields: sim.generateSnapshots(),
      worldParams: sim.getWorldParams(),
      worldData: { ...sim.worldData },
      stepHooks: allStepHookSnapshots(sim),
      interactionRules: [...sim.interactionRules],
      interactionEffects: [...sim.interactionEffects],
      visualTypes: renderer ? renderer.getAllVisualTypes().map(vt => ({ name: vt.name, wgsl: vt.wgsl })) : [],
      modules: renderer ? renderer.getAllModules().map(m => ({ name: m.name, wgsl: m.wgsl })) : [],
      timestamp: Date.now(),
    }
    try {
      await fetch('/api/engine/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', name: sceneName, scene: sceneData }),
      })
      showToast(`Scene "${sceneName}" saved (${sceneData.fields.length} fields)`, 'success')
      refreshSceneList()
    } catch {
      showToast('Failed to save scene', 'error')
    }
  }, [showToast, refreshSceneList])

  // The threshold: every world swap fades to BLACK first, travels under black,
  // and fades back in only when the new pipeline is ready. A designed moment of
  // dark instead of a race against the shader compiler (the "blue flash").
  const [swapFade, setSwapFade] = useState(false)
  const fadeToBlack = useCallback(async () => {
    setSwapFade(true)
    await new Promise(r => setTimeout(r, 340))   // let the fade fully land before teardown
  }, [])
  /** Lift the curtain only when the new world has genuinely SETTLED: pipeline
   *  compiled AND (if it has hooks) the first hook frames have fed the
   *  whiteboard — a compiled shader with all-zero uniforms is its own alien
   *  flash. Then one settle beat so the first visible frame is a real one. */
  const liftWhenSettled = useCallback((guard?: () => boolean) => {
    const rr = rendererRef.current
    const t0 = Date.now()
    const tick = () => {
      if (guard && !guard()) { setWorldLoading(false); return }   // superseded — the newer load owns the curtain
      const sim = simulationRef.current
      const hooksNeedFrames = (sim?.stepHooks?.size ?? 0) > 0 && !sim?.worldData?.gpuUniforms
      const ready = rr ? rr.isSuperReady() && !hooksNeedFrames : true
      if (ready || Date.now() - t0 > 4000) {
        setTimeout(() => { setWorldLoading(false); setSwapFade(false) }, 260)   // settle beat
        return
      }
      setTimeout(tick, 60)
    }
    tick()
  }, [])

  // Load a saved scene (replaces current state)
  const handleLoadScene = useCallback(async (sceneName: string, preScene?: unknown) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
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
      } catch { showToast('Failed to load scene', 'error'); return }
    }
    if (!scene) {
      // A deep link to a deleted/renamed scene (orphan) — don't leave the visitor
      // staring at black. Signal the shell to show a soft "gone" landing. This is
      // the SAME fetch a valid world succeeds on, so it never fires for a real one.
      showToast(`Scene "${sceneName}" not found`, 'error')
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cafe:scene-gone', { detail: sceneName }))
      return
    }

    // Confirmed — now switch. Navigating to a DIFFERENT scene/version invalidates
    // any minted connect token (HMAC-bound to the scene you left); drop it so the
    // next CONNECT AI mints one for where you are now.
    if (sceneName !== lastSceneRef.current) setPlugToken(null)
    lastSceneRef.current = sceneName
    setRiding(sceneName.includes(' ⑂ ') ? sceneName : null)
    // Veil the swap: until the NEW uber-shader compiles, the old pipeline would
    // paint the incoming fields with the departed world's shaders.
    setWorldLoading(true)
    await fadeToBlack()   // dim the departing world first — travel happens under black
    try {
      // Clear current state — including the old world's audio
      audioRef.current.stopScore()
      audioRef.current.stopMusic(0.2)
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
      rendererRef.current?.resetWorldUniforms()   // a new world starts with a clean uniform whiteboard — no bleed from the last scene
      sim.interactionRules = []
      sim.interactionEffects = []
      sim.stepHooks.clear()
      sim.tweens.clear()
      sim.timers.clear()
      sim.collisionCallbacks.clear()
      cachedOverlapMasksRef.current = new Map()

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
      if (scene.stepHooks) installHooks(sim, scene.stepHooks, scene.worldData as Record<string, unknown> | undefined)
      // Any world with RENDERABLE content boots running — not just ones with
      // hooks. A visual-only world (fields with visuals, no stepHook) otherwise
      // draws a single frame and idles to black. Content, not logic, is the test.
      const hasContent = (scene.stepHooks?.length ?? 0) > 0 || (scene.fields || []).some((f: { visualTypeName?: string }) => f.visualTypeName)
      if (hasContent && !sim.running) {
        sim.running = true
        setRunning(true)
      }

      // Recompile effects
      for (const field of sim.fields.values()) {
        for (const effect of field.effects) {
          await renderer.compileFieldEffect(`${field.id}_${effect.id}`, field.id, effect.wgsl, getModCode())
        }
      }

      updateSelectionMask(null)
      syncFields()
      showToast(`Scene "${sceneName}" loaded (${scene.fields?.length || 0} fields)`, 'success')
    } catch {
      showToast(`Failed to load "${sceneName}"`, 'error')
    } finally {
      liftWhenSettled()
    }
  }, [showToast, getModCode, syncFields, updateSelectionMask, fadeToBlack, liftWhenSettled])

  /** MAIN version scroller step: pos 0 = LIVE, 1..N = backups (newest→oldest).
   *  Loads a timestamped backup snapshot in place (via handleLoadScene's preScene)
   *  — non-destructive: browsing an old version never overwrites the live world. */
  const goBaseVer = useCallback(async (pos: number) => {
    const cur = playScene || ''
    if (!cur || pos < 0 || pos > baseVers.length) return
    if (pos === 0) { await handleLoadScene(cur); setBaseVerPos(0); return }   // back to LIVE
    const ts = baseVers[pos - 1]   // pos 1 → newest backup
    try {
      const j = await fetch(`/api/engine/scene?action=version&name=${encodeURIComponent(cur)}&timestamp=${ts}`).then(r => r.json())
      if (j?.scene) { await handleLoadScene(cur, j.scene); setBaseVerPos(pos) }
    } catch { /* offline — leave where we are */ }
  }, [playScene, baseVers, handleLoadScene])

  // true while a hot-reload is tearing down + recompiling — the 2s sync must not
  // fire in this window or it persists a half-built (empty/hookless) world.
  const reloadingRef = useRef(false)
  // hot-loads must be SERIAL. At build-end two mechanisms both pull the finished
  // world (the build-status poll AND the rev watcher whose baseline missed the
  // final brief_done bumps) — two overlapping clear+restores interleave and leave
  // the grid torn ("worked when entering fresh, failed on the final load"). A
  // second request during a load queues (latest wins) and runs after.
  const pendingReloadRef = useRef<{ v: number | undefined } | null>(null)
  // The __bridge_rev of the snapshot this tab has ACTUALLY rendered. A ref, so it
  // survives effect re-mounts — the auto-load poll baselines against THIS (what's
  // on screen), never a fresh server read. Seeding the baseline from a fresh poll
  // instead let a re-mount that happened right after an AI edit adopt the new rev
  // as "already seen" and silently swallow the update (stale tab, no reload).
  // Set from the fetched SNAPSHOT (not the live sim's worldData, which a reload
  // doesn't reliably re-stamp), so it can't drift into a reload-every-10s loop.
  const renderedRevRef = useRef(-1)

  /** #3 — hot-swap a SPACE version in place (no reload), the same way the vote
   *  reckoning previews a `space:` snapshot: fetch it, hand it to the proven
   *  clear+restore (handleLoadScene), and mark the client version so ctx.view
   *  (and thus the read-only gates) follow. Owner-only — the owner's own hooks
   *  are trusted; a visitor keeps the server-rendered reload path so an
   *  untrusted version's JS never auto-installs. */
  const hotLoadSpaceVersion = useCallback(async (v: number | undefined) => {
    if (!spaceSlug) return
    // Already mid-load: queue this request (latest wins) instead of interleaving
    // a second clear+restore over the first — that interleave tears the grid.
    if (reloadingRef.current) { pendingReloadRef.current = { v }; return }
    // Pause the 2s sync while the reload settles: handleLoadScene tears the renderer
    // down (0 visuals) and reinstalls hooks over several frames; a sync firing in
    // that window persists an empty/hookless world and renders it dark for everyone.
    reloadingRef.current = true
    try {
      const q = v === undefined ? '' : `?version=${v}`
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/snapshot${q}`, { cache: 'no-store' })
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
        if (sessionStorage.getItem('cc-reset:' + spaceSlug)) { resetFlag = true; sessionStorage.removeItem('cc-reset:' + spaceSlug) }
      } catch { /* private mode */ }
      if (v !== undefined || resetFlag) {
        const wd = (data?.snapshot as { worldData?: Record<string, unknown> } | undefined)?.worldData
        if (wd) {
          const extra = Array.isArray(wd.__resets) ? wd.__resets as string[] : []
          for (const k of ['__chapters', '__trig', ...extra]) delete wd[k]
        }
      }
      await handleLoadScene(`space:${spaceSlug}`, data)
      // record the rev we just rendered so the auto-load poll baselines on what's
      // actually on screen (this is the SAME __bridge_rev the snapshot?rev=1 poll reads)
      renderedRevRef.current = Number((data?.snapshot as { worldData?: { __bridge_rev?: unknown } } | undefined)?.worldData?.__bridge_rev) || 0
      greetInstructions(`space:${spaceSlug}`)   // pop instructions on first entry to this space
      setSpaceVer(v)
      window.history.replaceState(null, '', v === undefined ? `/space/${spaceSlug}` : `/space/${spaceSlug}?version=${v}`)
    } catch { /* leave where we are */ }
    finally {
      // release AFTER the load actually finished (not a fixed timer from entry):
      // hold the sync-pause a beat for the recompile to settle, then run the
      // newest queued request, if any — so a legit follow-up edit still adopts.
      setTimeout(() => {
        reloadingRef.current = false
        const p = pendingReloadRef.current
        pendingReloadRef.current = null
        if (p) hotLoadSpaceVersionRef.current?.(p.v)
      }, 1500)
    }
  }, [spaceSlug, handleLoadScene])
  hotLoadSpaceVersionRef.current = hotLoadSpaceVersion

  // AUTO-LOAD — the eye's counterpart in the tab. Every bridge write bumps the
  // world's __bridge_rev; a tab's own 2s sync round-trips that number unchanged,
  // so server-ahead means exactly one thing: an AI wrote something this tab
  // never ingested (SSE dropped, mid-burst quarantine, laptop slept). Instead
  // of silently syncing its stale world back OVER the fresh build — the old
  // failure — the tab reloads itself. Nobody should ever have to hard-refresh
  // to see what their AI built.
  useEffect(() => {
    if (!spaceSlug) return
    // Compare the server's rev to the rev this tab actually RENDERED
    // (renderedRevRef — a ref, so a re-mount can't reset it and re-baseline onto
    // an unshown edit). hotLoadSpaceVersion updates that ref when it lands, so a
    // real change fires exactly once and never loops. renderedRevRef < 0 means we
    // haven't loaded a snapshot yet — wait for the mount load to seed it.
    const iv = setInterval(async () => {
      if (document.hidden) return
      if (spaceVer !== undefined) return           // pinned to a save point — stay put
      if (renderedRevRef.current < 0) return       // not loaded yet — nothing rendered to compare against
      try {
        const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/snapshot?rev=1`, { cache: 'no-store' })
        if (!r.ok) return
        const { rev } = await r.json() as { rev?: number }
        if (typeof rev !== 'number') return
        // during a BUILD every command bumps the rev — hold (the build-end catch-up,
        // or the first poll after, adopts the finished world in one shot). Don't
        // touch renderedRevRef: it still reflects what's on screen.
        if (buildJobActiveRef.current) return
        // reload ONCE per real change, and only after edits settle. The reload
        // advances renderedRevRef to `rev`, so this same rev never fires twice.
        if (rev > renderedRevRef.current && Date.now() - aiLastEditRef.current > 4000) {
          showToast('⚡ this world was just updated — reloading', 'success')
          hotLoadSpaceVersion(undefined)
        }
      } catch { /* next heartbeat */ }
    }, 10000)
    return () => clearInterval(iv)
  }, [spaceSlug, spaceVer, hotLoadSpaceVersion, showToast])

  // Delete a saved scene
  const handleDeleteScene = useCallback(async (sceneName: string) => {
    try {
      await fetch('/api/engine/scene', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sceneName }),
      })
      showToast(`Scene "${sceneName}" deleted`, 'success')
      refreshSceneList()
    } catch {
      showToast(`Failed to delete "${sceneName}"`, 'error')
    }
  }, [showToast, refreshSceneList])

  /** The branch heads of the current base world — one entry per branch (its
   *  newest version). Shared by the ≡ BRANCHES panel and the ◂/▸ quick-browse
   *  arrows on ⑂ BRANCH. */
  const loadBranchHeads = useCallback(async () => {
    const base = (lastSceneRef.current || playScene || spaceSlug || '').split(' ⑂ ')[0]
    if (!base) return [] as Array<{ name: string; author: string; v: number }>
    try {
      const { scenes } = await fetch('/api/engine/scene?action=list').then(r => r.json())
      const heads = new Map<string, { name: string; author: string; v: number }>()
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
      setBranchList(list)
      return list
    } catch { setBranchList([]); return [] }
  }, [playScene, spaceSlug])

  /** ◂/▸ on the BRANCH button: step the ring [main, branch, branch, …] — quick
   *  browsing for everyone, owner or visitor. Looking is free. */
  // know the family on arrival — the BROWSE arrows only render when there is
  // actually somewhere to browse to
  useEffect(() => {
    if (!playScene && !spaceSlug) return
    loadBranchHeads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene, spaceSlug, riding])

  const stepBranch = useCallback(async (dir: 1 | -1) => {
    const list = await loadBranchHeads()
    if (list.length === 0) { showToast('no branches yet — ⑂ BRANCH to open one', 'info'); return }
    const ring = ['main', ...list.map(b => b.name)]
    const cur = lastSceneRef.current || ''
    const curAuthor = cur.match(/^.+ ⑂ (.+) · v\d+$/)?.[1] ?? ''
    // riding a branch that vanished → findIndex -1 → idx 0 → treated as main
    const idx = curAuthor ? Math.max(0, 1 + list.findIndex(b => b.author === curAuthor)) : 0
    const next = ring[(idx + dir + ring.length) % ring.length]
    if (next === 'main') {
      // on a space, main is the space's own snapshot — not a scene by that name
      if (spaceSlug) window.location.href = `/space/${encodeURIComponent(spaceSlug)}`
      else handleLoadScene(cur.split(' ⑂ ')[0] || (playScene || ''))
    } else handleLoadScene(next)
  }, [loadBranchHeads, spaceSlug, playScene, handleLoadScene, showToast])

  // Play mode: the screen, heard. Every ~600ms sample the rendered frame at
  // 8x8 and dispatch its mood (brightness, warmth, busy-ness) for the audio
  // layer. Skipped when the tab is hidden.
  useEffect(() => {
    if (!playScene) return
    let stop = false
    const tick = async () => {
      if (stop) return
      const renderer = rendererRef.current
      if (renderer && !document.hidden) {
        try {
          const mood = await renderer.sampleMood(8)
          if (mood) window.dispatchEvent(new CustomEvent('cafe:mood', { detail: mood }))
        } catch { /* readback is best-effort */ }
      }
      if (!stop) setTimeout(tick, 600)
    }
    const t = setTimeout(tick, 1500)
    return () => { stop = true; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene])

  // Hubs (main and sub-mains) are navigation, not worlds: no branching there.
  // A world that publishes portals declares itself a hub.
  const [isHub, setIsHub] = useState(false)
  useEffect(() => {
    // the main door is ALWAYS a hub — no branch or version chrome there,
    // only the sub-main space link. Other worlds declare hubness via portals.
    setIsHub(playScene === 'CAFE')
    // grace: the departing hub's hook can dispatch a frame or two past the
    // scene change — a stale portals event must not brand the NEW world a hub
    const bornAt = Date.now()
    const onPortals = () => { if (Date.now() - bornAt > 600) setIsHub(true) }
    window.addEventListener('cafe:portals', onPortals)
    return () => window.removeEventListener('cafe:portals', onPortals)
  }, [playScene])

  // Follow the throne for the world we're in: who holds MAIN, and the immortal
  // original. Polled so a promotion mid-session surfaces the reassurance + bookmark.
  useEffect(() => {
    const base = (lastSceneRef.current || playScene || spaceSlug || '').split(' ⑂ ')[0]
    if (!base || isHub || playScene === 'CAFE' || playScene === 'SUB-MAIN') { setWorldLineage(null); return }
    let stop = false
    const load = () => fetch(`/api/engine/save?action=load&slot=${encodeURIComponent('lineage:' + base.toUpperCase())}`)
      .then(r => r.json())
      .then(d => { if (!stop && d?.data?.original) setWorldLineage({ original: d.data.original, mainHolder: d.data.mainHolder || d.data.original }) })
      .catch(() => {})
    load()
    const t = setInterval(load, 20000)
    return () => { stop = true; clearInterval(t) }
  }, [playScene, spaceSlug, riding, isHub])

  // the owner's overturn rule for this world (winner-takes-main opt-in)
  useEffect(() => {
    if (!lineageBase || isHub) { setWinnerTakesMain(false); return }
    let stop = false
    fetch(`/api/engine/lineage/main-rule?base=${encodeURIComponent(lineageBase)}`)
      .then(r => r.json())
      .then(d => { if (!stop) setWinnerTakesMain(!!d?.winnerTakesMain) })
      .catch(() => {})
    return () => { stop = true }
  }, [lineageBase, isHub, chromeVisible])

  // Reassure the FOUNDER when their world's main gets snagged. The founder is the
  // owner of the immortal original (its handle). If that's you and a challenger now
  // holds main, we say so ONCE — the work isn't gone; ★ ORIGINAL always returns you.
  useEffect(() => {
    if (!worldLineage || !me) return
    const { original, mainHolder } = worldLineage
    if (!original || mainHolder === original) return   // still the founder's throne
    const om = original.match(/ ⑂ ([^·]+?)(?: ·|$)/)   // handle of a branch-original (house worlds have none)
    const founderHandle = om ? om[1].trim() : null
    const myHandle = me.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
    if (!founderHandle || founderHandle !== myHandle) return
    const key = `snag-toast:${original}:${mainHolder}`
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1') } catch { /* private mode → toast each visit */ }
    showToast('A challenger won MAIN — but your original is immortal.', 'info', 'Nothing is lost. Tap ★ ORIGINAL to return to it anytime.')
  }, [worldLineage, me, showToast])

  // Play mode: the shell can freeze the world (back-button confirm dialog)
  useEffect(() => {
    if (!playScene) return
    const onPause = (e: Event) => {
      const sim = simulationRef.current
      if (sim) sim.running = !(e as CustomEvent).detail
    }
    window.addEventListener('cafe:pause', onPause)
    return () => window.removeEventListener('cafe:pause', onPause)
  }, [playScene])

  // Press R to reset the world to the start — only when the world opts in
  // (worldData.rResetKey, toggled in world tools). Ignored while typing.
  useEffect(() => {
    if (!playScene && !spaceId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const sim = simulationRef.current
      if (!sim || !sim.worldData.rResetKey) return
      const saveKey = playScene || spaceSlug
      if (saveKey) { try { localStorage.removeItem(`cc-save-${saveKey}`) } catch { /* fine */ } }
      if (spaceId) {
        // space world: the only reliable restart is a real page reload. Every
        // in-tab reload (hotLoadSpaceVersion) MERGES the snapshot onto live
        // worldData (Object.assign) while the sim keeps ticking, so run-state
        // survived the "reset" (and a __fresh poke blanked some hooks). A hard
        // refresh boots the world clean from an empty worldData and always lands
        // at the beginning — so that's what we do. spaceVer is preserved in the
        // URL, so a save-point view reloads that same version fresh.
        // The one-shot cc-reset flag survives the reload; the load then strips the
        // world's declared __resets keys (e.g. TIDEGLASS's __tg) out of the live
        // snapshot, so the SAVE is purged too — a plain reload keeps __tg.
        try { if (spaceSlug) sessionStorage.setItem('cc-reset:' + spaceSlug, '1') } catch { /* private mode */ }
        window.location.reload()
      } else {
        // reset: forget this session's run state + saved stash, then reload fresh
        for (const k of Object.keys(sim.worldData)) if (k.startsWith('__')) delete sim.worldData[k]
        playLoadedRef.current = null   // force the load effect to re-run this scene
        setReloadTick(v => v + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playScene, spaceId, spaceSlug, spaceVer])

  // Play mode and spaces: the world IS the screen. Fit the 512 grid to the
  // viewport (contain: the whole world visible, void beyond it) on mount and
  // resize. zoom is world-cells-per-short-axis (gridRange = gridSize / zoom),
  // resolution-independent — contain is zoom = 1 on every screen; the old
  // Math.min(w,h)/gridSize treated zoom as pixels-per-cell and cropped ~40%
  // on any viewport taller than the grid.
  useEffect(() => {
    if (!playScene && !spaceId) return
    const fit = () => {
      cameraRef.current.x = gridSize / 2
      cameraRef.current.y = gridSize / 2
      cameraRef.current.zoom = 1
    }
    fit()
    const t = setTimeout(fit, 300)   // after the canvas settles
    window.addEventListener('resize', fit)
    return () => { clearTimeout(t); window.removeEventListener('resize', fit) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene, spaceId])

  // Play mode: load a saved scene into the local sim and run it.
  // Reacts to playScene changes — the world swaps in place (portal travel).
  const playLoadedRef = useRef<string | null>(null)
  // dev hot-reload: bumping this re-runs the load effect below, live-swapping
  // the cartridge without a page refresh — the ideal loop for iterating worlds.
  const [reloadTick, setReloadTick] = useState(0)
  const [worldLoading, setWorldLoading] = useState(false)   // true while an existing world's fields are being fetched/restored
  // report the blank-and-building state upward (aiPulse ticks ~1/s) so the space
  // chrome can hide affordances (SHARE) that make no sense on a world that isn't real yet
  const lastBuildingRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (!onBuilding) return
    const sim = simulationRef.current
    const blank = (sim?.fields?.size ?? 0) === 0
    const b = blank && !!sim?.worldData?.creation_brief && !sim?.worldData?.brief_done
    if (lastBuildingRef.current !== b) { lastBuildingRef.current = b; onBuilding(b) }
  }, [aiPulse, onBuilding])
  useEffect(() => {
    if (!playScene || playLoadedRef.current === playScene) return
    const prevScene = playLoadedRef.current
    playLoadedRef.current = playScene

    const loadPlayScene = async () => {
      const sim = simulationRef.current
      const renderer = rendererRef.current
      if (!sim || !renderer) { setTimeout(loadPlayScene, 500); return }
      // a direct URL visit IS a ride: without this, the branch dock (owner
      // chips, version scrubber, SET AS HEAD, branch key) only appeared when
      // you browsed to the branch from inside the shell
      lastSceneRef.current = playScene
      setRiding(playScene.includes(' ⑂ ') ? playScene : null)
      // world-scoped UI never travels: panels opened in the departed world
      // (instructions, branches, versions, the ⚙ tools box) close at the door
      setInstrOpen(false)
      setBranchesOpen(false)
      setVersionsOpen(false)
      setChromeVisible(false)
      setWorldLoading(true)
      await fadeToBlack()   // the departing world dims out BEFORE teardown — no last-frame flash
      if (playLoadedRef.current !== playScene) return   // superseded during the fade
      try {
        // save data survives the swap: stash the departing scene's game state
        // (the __-prefixed worldData blobs) so re-entering a game resumes it
        if (prevScene) {
          const stash: Record<string, unknown> = {}
          for (const k of Object.keys(sim.worldData)) {
            // pending audio triggers are transient — never stash a sound
            if (k === '__play_sound' || k === '__play_music') continue
            if (k.startsWith('__')) stash[k] = sim.worldData[k]
          }
          try { localStorage.setItem(`cc-save-${prevScene}`, JSON.stringify(stash)) } catch { /* full/blocked */ }
        }

        // teardown the previous scene COMPLETELY — restoreFromSnapshots only
        // adds, so every old field must be removed by hand. The old world's
        // music must not follow the player through the door.
        audioRef.current.stopScore()
        audioRef.current.stopMusic(0.2)
        for (const id of Array.from(sim.fields.keys())) {
          renderer.removeAllFieldEffects(id)
          sim.removeField(id)
        }
        sim.stepHooks.clear()
        sim.interactionRules = []
        sim.interactionEffects = []
        for (const k of Object.keys(sim.worldData)) delete sim.worldData[k]
        frameFingerprintRef.current = ''
        audioRef.current?.stopScore()
        audioRef.current?.stopMusic(0.3)   // no world's sound outlives it
        // every world opens with a fresh eye — a zoom left over from another
        // scene must not follow the player through the door. CONTAIN, not cover:
        // the whole world at max size in the viewport; letterbox is honest,
        // cropping is not (a wide monitor was losing 40% of every scene).
        cameraRef.current = { x: gridSize / 2, y: gridSize / 2, zoom: 1 }

        // three sources, in order of specificity:
        //  · a 'space:slug' descriptor → a DB-backed player space's live
        //    snapshot (so the reckoning can preview spaces inline, in place)
        //  · a house cartridge shipped as a static file (CDN, server-proof)
        //  · the store API, for locally saved scenes
        // Fetches are CACHED per name: flicking between the five vote candidates
        // (or re-hovering one) reuses the fetched world instead of hitting the
        // network/DB again. Only ONE world is ever live at a time — the cache is
        // just the download, not a running scene. Dev hot-reload clears an entry
        // when its source changes (see the poll below).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any = scenePreloadCache.get(playScene)
        if (data) {
          data = structuredClone(data)   // hand the loader a private copy — never mutate the cached original
        } else {
          if (playScene.startsWith('space:')) {
            const slug = playScene.slice(6)
            const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/snapshot`)
            data = r.ok ? await r.json() : {}
          } else if (playScene.includes(' ⑂ ')) {
            // branches are LIVING documents — the store is truth. A bundled
            // cartridge copy is a frozen snapshot from rebuild-bundles and must
            // never shadow live AI edits; it's only the offline fallback.
            let resp = await fetch(`/api/engine/scene?name=${encodeURIComponent(playScene)}`)
            if (!resp.ok) resp = await fetch(`/cartridges/${encodeURIComponent(playScene)}.json`)
            data = await resp.json()
          } else {
            let resp = await fetch(`/cartridges/${encodeURIComponent(playScene)}.json`)
            if (!resp.ok) resp = await fetch(`/api/engine/scene?name=${encodeURIComponent(playScene)}`)
            data = await resp.json()
          }
          if (data && (data.scene || data.snapshot || data.fields)) {
            try { scenePreloadCache.set(playScene, structuredClone(data)) } catch { /* uncloneable — skip the cache */ }
          }
        }
        // STALE-LOAD GUARD: a newer scene may have been requested while we
        // awaited this fetch. If so, this load is stale — abandon it before it
        // paints. Without this, an out-of-order resolve painted the WRONG world
        // (a just-previewed Orchid) over the one you actually opened (a
        // Lighthouse branch). Only the current target may render.
        if (playLoadedRef.current !== playScene) return
        const scene = data.scene || data.snapshot || data
        if (!scene || !scene.fields) return
        // A scene is a complete world — reset the shader registries (same rule as
        // handleLoadScene). Without this, the departed world's visuals ride along:
        // registries bloat, and worse, until the recompile lands the OLD pipeline
        // paints the NEW fields with the OLD world's shaders (the transition flash).
        renderer.clearRegistries()
        // modules BEFORE visuals — a visual registered ahead of its modules
        // fails the compile and gets quarantined (see handleLoadScene)
        if (scene.modules) for (const m of scene.modules) renderer.registerModule(m.name, m.wgsl)
        if (scene.visualTypes) for (const vt of scene.visualTypes) renderer.registerVisualType(vt.name, vt.wgsl)
        // BREWED GLYPH: swap the player's cursor code into the hub's container
        // NOW, before the first compile — swapping it after (the cafe:icon
        // watcher's job) forced a second full uber-shader recompile per entry,
        // which read as a multi-second stall.
        {
          const gw = playerGlyphWgsl()
          if (gw && scene.modules?.some((m: { name: string }) => m.name === 'playerglyph')) {
            renderer.registerModule('playerglyph', wrapPlayerGlyph(gw))
            sim.worldData.__glyphOn = 1
          }
          // same for OTHER players' live seats — the cartridge just registered
          // no-ops over them; restore before the compile, not after it
          const og = otherGlyphsRef.current
          for (const [pid, slot] of og.slots) {
            const w = og.code.get(pid)
            if (w) renderer.registerModule('pg' + slot, wrapOtherGlyph(w, slot))
          }
        }
        sim.restoreFromSnapshots(scene.fields || [])
        for (const field of sim.fields.values()) {
          if (field.visualTypeName) {
            const runtimeId = renderer.resolveVisualType(field.visualTypeName)
            if (runtimeId !== undefined) field.visualType = runtimeId
          }
        }
        if (scene.worldParams) sim.setWorldParams(scene.worldParams)
        if (scene.worldData) Object.assign(sim.worldData, scene.worldData)
        // per-world settings live beside the cartridge (bundles stay pure):
        // owner toggles like resetOnEntry land here and overlay the snapshot
        try {
          const st = await fetch(`/api/engine/save?slot=${encodeURIComponent('world-settings:' + playScene)}`).then(r => r.json())
          if (st?.data && typeof st.data === 'object' && !Array.isArray(st.data)) Object.assign(sim.worldData, st.data)
        } catch { /* no settings, no problem */ }
        if (sim.worldData.resetOnEntry) {
          // this world restarts from the beginning: forget stashes and any
          // run state a previous session left in memory
          for (const k of Object.keys(sim.worldData)) if (k.startsWith('__')) delete sim.worldData[k]
          try { localStorage.removeItem(`cc-save-${playScene}`) } catch { /* fine */ }
        } else {
          // resume: this scene's stashed save data (best scores, builds) returns
          try {
            const stash = localStorage.getItem(`cc-save-${playScene}`)
            if (stash) Object.assign(sim.worldData, JSON.parse(stash))
          } catch { /* no save, no problem */ }
        }
        // session-start signal: hooks reset per-session state (timers, key latches)
        // while keeping restored save data
        sim.worldData.__fresh = true
        rendererRef.current?.resetWorldUniforms()   // clean whiteboard on entry — a hook-less world won't read the hub's leftover uniforms
        for (const k of Object.keys(sim.worldData)) {
          if (k.startsWith('key_') || k.startsWith('mouse_')) delete sim.worldData[k]
        }
        if (scene.interactionRules) sim.interactionRules = scene.interactionRules
        if (scene.interactionEffects) for (const ie of scene.interactionEffects) sim.addInteractionEffect(ie)
        if (scene.stepHooks) installHooks(sim, scene.stepHooks, scene.worldData as Record<string, unknown> | undefined)
        // compile each field's effects — the /play loader never did this, so
        // cartridge effects (the fluid solver, any feedback pass) were silently
        // dropped and only the base visual ever rendered.
        for (const field of sim.fields.values()) {
          for (const effect of field.effects) {
            await renderer.compileFieldEffect(`${field.id}_${effect.id}`, field.id, effect.wgsl, getModCode())
          }
        }
        sim.running = true
        setRunning(true)
        syncFields()
        greetInstructions(playScene)   // pop the world's instructions on entry
      } catch (err) {
        console.error('Failed to load play scene:', err)
      } finally {
        // Lift the veil only when the NEW uber-shader is actually compiled —
        // dropping it at restore-time exposed the old-pipeline flash window
        // (~0.5s of the previous world's shaders on the new world's fields).
        liftWhenSettled(() => playLoadedRef.current === playScene)
      }
    }
    loadPlayScene()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene, reloadTick])

  // hot-reload: when the loaded world's source changes (a re-save from this tab,
  // another tab, or an AI over the bridge), swap it in live — the player never
  // refreshes. House cartridges poll their JSON (dev only); store scenes —
  // branches above all, the worlds AIs edit while someone watches — poll the
  // cheap stat endpoint in every env. Follows the scene you actually RODE to
  // (lastSceneRef), not just the URL's world. Fails silent.
  useEffect(() => {
    if (!playScene || spaceId) return
    let last = ''
    let lastName = ''
    let stop = false
    let shiftTick = 0, shiftDoneAt = 0, shiftLastAt = 0
    const poll = async () => {
      try {
        const cur = lastSceneRef.current || playScene
        if (cur !== lastName) { lastName = cur; last = '' }   // rode elsewhere — restart tracking
        // EVERY world watches its stat, not just ⑂ branches — plain-named
        // house worlds (QUANTIC DOJO, ONE DAY…) used to go blind in prod, so
        // live edits sat invisible until a hard refresh
        let stamp = ''
        {
          const r = await fetch(`/api/engine/scene?action=stat&name=${encodeURIComponent(cur)}`, { cache: 'no-store' })
          if (r.ok) stamp = String((await r.json()).timestamp ?? '')
        }
        if (!stamp && process.env.NODE_ENV !== 'production') {
          const r = await fetch(`/cartridges/${encodeURIComponent(cur)}.json?ts=${Date.now()}`, { cache: 'no-store' })
          if (r.ok) { const d = await r.json(); stamp = String((d.scene || d).timestamp ?? '') }
        }
        if (last && stamp && stamp !== last) {
          scenePreloadCache.delete(cur)       // the source changed — drop the stale download
          if (cur === playScene) {
            playLoadedRef.current = null      // let the load effect fire again
            setReloadTick(t => t + 1)
          } else {
            handleLoadScene(cur)              // riding a branch — reload it in place
          }
        }
        if (stamp) last = stamp
        // AI BUILD SHIFT: a bridge burst on a sibling branch publishes an
        // 'ai-building' beacon on the base world's channel — a tab standing in
        // the family rides to the branch being built, and this same stat poll
        // then live-reloads it burst by burst. One shift per beacon stamp and
        // a 30s cooldown, so a viewer can still walk away on purpose.
        shiftTick++
        if (shiftTick % 4 === 0) {
          const base = cur.split(' ⑂ ')[0]
          const r2 = await fetch(`/api/engine/save?slot=${encodeURIComponent('ai-building:' + base)}`, { cache: 'no-store' })
          if (r2.ok) {
            const sig = ((await r2.json()) as { data?: { scene?: string; at?: number } | null }).data
            if (sig?.scene && sig.at && sig.scene !== cur && sig.scene.split(' ⑂ ')[0] === base &&
                Date.now() - sig.at < 15000 && sig.at !== shiftDoneAt && Date.now() - shiftLastAt > 30000) {
              shiftDoneAt = sig.at; shiftLastAt = Date.now()
              handleLoadScene(sig.scene)
            }
          }
        }
      } catch { /* offline / mid-save — try again next tick */ }
      if (!stop) setTimeout(poll, 1500)
    }
    poll()
    return () => { stop = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene, spaceId])

  // Load space snapshot on mount (for space mode)
  const spaceLoadedRef = useRef(false)
  useEffect(() => {
    if (!spaceSlug || spaceLoadedRef.current) return
    spaceLoadedRef.current = true

    const loadSpaceSnapshot = async () => {
      const sim = simulationRef.current
      const renderer = rendererRef.current
      if (!sim || !renderer) {
        // Retry after renderer initializes
        setTimeout(loadSpaceSnapshot, 500)
        return
      }

      try {
        const versionQ = versionView ? `?version=${versionView}` : ''
        const resp = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/snapshot${versionQ}`)
        const { snapshot } = await resp.json()
        if (!snapshot) return // Empty space — blank canvas
        // baseline the auto-load poll on the rev we're rendering right now
        renderedRevRef.current = Number((snapshot as { worldData?: { __bridge_rev?: unknown } })?.worldData?.__bridge_rev) || 0

        // Restore visual types and modules first
        if (snapshot.visualTypes) {
          for (const vt of snapshot.visualTypes) {
            renderer.registerVisualType(vt.name, vt.wgsl)
          }
        }
        if (snapshot.modules) {
          for (const m of snapshot.modules) {
            renderer.registerModule(m.name, m.wgsl)
          }
        }

        // Restore fields and state
        sim.restoreFromSnapshots(snapshot.fields || [])

        // Resolve visualTypeName → numeric visualType from runtime registry.
        // The name is authoritative: numeric IDs are assigned per renderer
        // session, so a stored numeric can point at a different visual type
        // after a reload. Always re-resolve when a name is present.
        for (const field of sim.fields.values()) {
          if (field.visualTypeName) {
            const runtimeId = renderer.resolveVisualType(field.visualTypeName)
            if (runtimeId !== undefined) field.visualType = runtimeId
          }
        }

        if (snapshot.worldParams) sim.setWorldParams(snapshot.worldParams)
        // RESTART (R) reloads the page with a one-shot cc-reset flag. THIS is the
        // path a reload takes (hotLoadSpaceVersion only runs on version change), so
        // it must strip the world's saved game-state too — else "reset" reloads the
        // exact save it meant to purge. Strip engine state + the world's declared
        // __resets keys (e.g. TIDEGLASS's __tg) before they land in the sim.
        if (snapshot.worldData) {
          let reset = false
          try { if (sessionStorage.getItem('cc-reset:' + spaceSlug)) { reset = true; sessionStorage.removeItem('cc-reset:' + spaceSlug) } } catch { /* private mode */ }
          if (reset || versionView) {
            const extra = Array.isArray(snapshot.worldData.__resets) ? snapshot.worldData.__resets : []
            for (const k of ['__chapters', '__trig', ...extra]) delete snapshot.worldData[k]
          }
          Object.assign(sim.worldData, snapshot.worldData)
          if (reset) sim.worldData.__fresh = true   // tell the hook to reset per-session latches
        }
        // Transient input state must never survive a restore (stuck ghost keys)
        for (const k of Object.keys(sim.worldData)) {
          if (k.startsWith('key_') || k.startsWith('mouse_')) delete sim.worldData[k]
        }
        if (snapshot.interactionRules) sim.interactionRules = snapshot.interactionRules
        if (snapshot.interactionEffects) {
          for (const ie of snapshot.interactionEffects) sim.addInteractionEffect(ie)
        }
        if (snapshot.stepHooks) {
          installHooks(sim, snapshot.stepHooks, snapshot.worldData as Record<string, unknown> | undefined)
        }
        // any renderable content boots RUNNING — hooks OR visual fields. A
        // visual-only space would otherwise draw one frame and idle to black.
        {
          const hasContent = (snapshot.stepHooks?.length ?? 0) > 0 || (snapshot.fields || []).some((f: { visualTypeName?: string }) => f.visualTypeName)
          if (hasContent && !sim.running) sim.running = true
        }

        // Recompile effects
        for (const field of sim.fields.values()) {
          for (const effect of field.effects) {
            const programKey = `${field.id}_${effect.id}`
            await renderer.compileFieldEffect(programKey, field.id, effect.wgsl, getModCode())
          }
        }

        syncFields()
      } catch (err) {
        console.error('Failed to load space snapshot:', err)
      }
    }

    loadSpaceSnapshot()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceSlug])

  // Change field color — just update color, shader uses params
  const handleFieldColorChange = useCallback((id: string, color: [number, number, number, number]) => {
    const sim = simulationRef.current
    if (!sim) return
    const field = sim.fields.get(id)
    if (!field) return
    field.color = color
    syncFields()
  }, [syncFields])

  // Toggle simulation
  const handleToggleRunning = useCallback(() => {
    const sim = simulationRef.current
    if (!sim) return
    sim.running = !sim.running
    setRunning(sim.running)
  }, [])

  // Clear all — removes all effects from all fields
  const handleClear = useCallback(() => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim) return

    // Remove all field effects
    if (renderer) {
      for (const field of sim.fields.values()) {
        renderer.removeAllFieldEffects(field.id)
      }
    }

    sim.clearAll()
    // Clear effects from all fields
    for (const field of sim.fields.values()) {
      field.effects = []
    }
    updateSelectionMask(null)
    setGeneration({ loading: false, error: null, targetFieldId: null })
    syncFields()
  }, [syncFields, updateSelectionMask])

  // Generate AI effect for selected field
  const handleGenerate = useCallback(async (prompt: string) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim || !renderer || !selection.selectedFieldId) return

    const targetFieldId = selection.selectedFieldId
    setGeneration({ loading: true, error: null, targetFieldId })

    try {
      const bounds = sim.getFieldBounds(targetFieldId)

      const res = await fetch('/api/engine/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, bounds, fieldId: targetFieldId }),
      })

      const data = await res.json()

      if (!res.ok) {
        setGeneration({ loading: false, error: data.error || 'Generation failed', targetFieldId })
        return
      }

      // Add as an effect
      const effectId = genEffectId()
      const programKey = `${targetFieldId}_${effectId}`
      const result = await renderer.compileFieldEffect(programKey, targetFieldId, data.wgsl, getModCode())

      if (result.success) {
        const effect: FieldEffect = {
          id: effectId,
          author: 'user',
          wgsl: data.wgsl,
          description: data.description || 'AI generated',
          blend: 'alpha',
          order: 10,
        }
        sim.addFieldEffect(targetFieldId, effect)

        setGeneration({ loading: false, error: null, targetFieldId: null })
        syncFields()
      } else {
        setGeneration({
          loading: false,
          error: `Shader compile error: ${result.error}`,
          targetFieldId,
        })
      }
    } catch (err) {
      setGeneration({
        loading: false,
        error: err instanceof Error ? err.message : 'Network error',
        targetFieldId,
      })
    }
  }, [selection.selectedFieldId, syncFields])

  // Clear effect for a specific field (or selected field)
  const handleClearEffect = useCallback((targetId?: string) => {
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim || !renderer) return

    const fieldId = targetId || selection.selectedFieldId
    if (!fieldId) return

    renderer.removeAllFieldEffects(fieldId)
    const field = sim.fields.get(fieldId)
    if (field) {
      field.effects = []
    }
    setGeneration({ loading: false, error: null, targetFieldId: null })
    syncFields()
  }, [selection.selectedFieldId, syncFields])

  // Pointer handlers — canvas is view-only (agents do the painting)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current
    const sim = simulationRef.current
    if (!canvas) return

    pointerDown.current = true
    lastPointer.current = { x: e.clientX, y: e.clientY }

    // A still press must be visible to hooks (the Held Sun pattern): write
    // mouse_down on DOWN, not only in the move handler — real fingers tremble,
    // automated and deliberate ones don't.
    if (sim) {
      const rect0 = canvas.getBoundingClientRect()
      const cam0 = cameraRef.current
      const grid0 = screenToGrid(e.clientX, e.clientY, rect0, cam0, cam0.zoom)
      sim.worldData['mouse_x'] = grid0.x
      sim.worldData['mouse_y'] = grid0.y
      sim.worldData['mouse_down'] = true
      // pulse counter — a click shorter than one sim frame still lands once
      sim.worldData['mouse_down_n'] = ((sim.worldData['mouse_down_n'] as number) || 0) + 1
    }

    // 3D mode: right-click or alt+click = orbit camera
    if (renderModeRef.current === '3d' && (e.button === 2 || e.altKey)) {
      isOrbiting.current = true
      canvas.style.cursor = 'grab'
      return
    }

    // Space + click = pan camera
    if (spaceHeld.current) {
      isPanning.current = true
      canvas.style.cursor = 'grabbing'
      return
    }

    // Play mode: the pointer belongs to the game (hooks read mouse_*).
    // Never start a field drag — a full-canvas game field would ride the
    // cursor and pull the whole scene with it.
    if (playScene) return

    // Player worlds play like worlds too: fields only move by hand
    // while the workshop is open (⚙ tools) — never during plain play.
    if (spaceId && !chromeVisible) return

    // Hit-test: check if pointer is over a field
    if (sim) {
      const rect = canvas.getBoundingClientRect()
      const camera = cameraRef.current
      const grid = screenToGrid(e.clientX, e.clientY, rect, camera, camera.zoom)
      const hitField = sim.getFieldAtPoint(grid.x, grid.y)

      if (hitField) {
        // Walk up to root parent so dragging a child moves the whole group
        let dragTarget = hitField
        while (dragTarget.parentFieldId) {
          const parent = sim.fields.get(dragTarget.parentFieldId)
          if (!parent) break
          dragTarget = parent
        }
        draggingFieldId.current = dragTarget.id
        dragOffset.current = {
          x: dragTarget.transform.x - grid.x,
          y: dragTarget.transform.y - grid.y,
        }
        dragStartScreen.current = { x: e.clientX, y: e.clientY }
        canvas.style.cursor = 'grabbing'
        return
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene, spaceId, chromeVisible])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const input = inputRef.current
    const canvas = canvasRef.current
    if (!input || !canvas) return

    const rect = canvas.getBoundingClientRect()
    const camera = cameraRef.current

    // Track mouse grid position for step hooks and agents
    const sim = simulationRef.current
    const gridPos = input.screenToCell(e.clientX, e.clientY, rect, camera, camera.zoom)
    if (sim) {
      sim.worldData['mouse_x'] = gridPos.x
      sim.worldData['mouse_y'] = gridPos.y
      sim.worldData['mouse_down'] = pointerDown.current
    }

    // Dragging a field — update its position and skip panning
    if (draggingFieldId.current && sim) {
      const grid = screenToGrid(e.clientX, e.clientY, rect, camera, camera.zoom)
      const newX = grid.x + dragOffset.current.x
      const newY = grid.y + dragOffset.current.y
      sim.setPosition(draggingFieldId.current, newX, newY)
      // Zero out velocity so physics doesn't fight the drag
      const field = sim.fields.get(draggingFieldId.current)
      if (field) {
        field.transform.vx = 0
        field.transform.vy = 0
      }
      syncFields()
      return
    }

    // Pixel hover tooltip (throttled)
    if (!pointerDown.current) {
      if (pixelInfoTimeout.current) clearTimeout(pixelInfoTimeout.current)
      pixelInfoTimeout.current = setTimeout(() => {
        const renderer = rendererRef.current
        if (!renderer?.device || !sim) { setPixelInfo(null); return }
        const gx = Math.floor(gridPos.x)
        const gy = Math.floor(gridPos.y)
        if (gx < 0 || gx >= gridSize || gy < 0 || gy >= gridSize) { setPixelInfo(null); return }

        // Read color from CPU-side colorData (avoids GPU readback for tooltip)
        const idx = (gy * gridSize + gx) * 4
        const cd = sim.world.colorData
        const r = Math.round(cd[idx] * 255)
        const g = Math.round(cd[idx + 1] * 255)
        const b = Math.round(cd[idx + 2] * 255)
        const a = Math.round(cd[idx + 3] * 255)

        // Use pixel-perfect presence data for field identification
        const fieldIds = sim.getFieldsAtPixel(gx, gy)
        const fieldsHere = fieldIds.map(id => sim.fields.get(id)?.name).filter(Boolean) as string[]

        setPixelInfo({
          screenX: e.clientX, screenY: e.clientY,
          gridX: gx, gridY: gy,
          r, g, b, a,
          fields: fieldsHere,
        })
      }, 50)
    } else {
      setPixelInfo(null)
    }

    if (!pointerDown.current) return

    // 3D orbit
    if (isOrbiting.current) {
      const dx = e.clientX - lastPointer.current.x
      const dy = e.clientY - lastPointer.current.y
      const cam3D = camera3DRef.current
      cam3D.yaw += dx * 0.005
      cam3D.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cam3D.pitch - dy * 0.005))
      lastPointer.current = { x: e.clientX, y: e.clientY }
      forceUpdate(n => n + 1)
      return
    }

    if (!isPanning.current) return

    const dx = e.clientX - lastPointer.current.x
    const dy = e.clientY - lastPointer.current.y
    const delta = input.screenDeltaToGridDelta(dx, dy, rect, camera.zoom)

    // bound the grid to the viewport: the camera center never leaves the
    // world, so at most half the view can be void in any direction
    camera.x = Math.max(0, Math.min(gridSize, camera.x - delta.dx))
    camera.y = Math.max(0, Math.min(gridSize, camera.y - delta.dy))
    lastPointer.current = { x: e.clientX, y: e.clientY }
  }, [syncFields])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // release must be visible to hooks even without a final move event
    { const simUp = simulationRef.current; if (simUp) simUp.worldData['mouse_down'] = false }
    if (draggingFieldId.current) {
      const sim = simulationRef.current
      const fieldId = draggingFieldId.current
      const dx = e.clientX - dragStartScreen.current.x
      const dy = e.clientY - dragStartScreen.current.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      draggingFieldId.current = null
      pointerDown.current = false
      const canvas = canvasRef.current
      if (canvas) canvas.style.cursor = hubCursorRef.current ? 'none' : 'grab'

      // Click (not drag) — select this field (highlight in list + inspector)
      if (dist < 5 && sim) {
        const field = sim.fields.get(fieldId)
        if (field) {
          // Portal navigation — click portal to enter target space
          const portalTarget = field.properties.get('portalTarget') as string | undefined
          if (portalTarget && field.properties.get('portalType') === 'space') {
            window.location.href = `/space/${portalTarget}`
            return
          }
          setBrush(prev => ({ ...prev, activeFieldId: fieldId }))
          updateSelectionMask(fieldId)
        }
      } else {
        syncFields()
      }
      return
    }

    // Click on empty canvas (not pan, not field drag) — deselect
    if (!isPanning.current && pointerDown.current) {
      setBrush(prev => ({ ...prev, activeFieldId: null }))
      updateSelectionMask(null)
    }
    isPanning.current = false
    isOrbiting.current = false
    pointerDown.current = false
    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = hubCursorRef.current ? 'none' : 'grab'
  }, [syncFields, updateSelectionMask])

  // Wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (renderModeRef.current === '3d') {
        // 3D mode: dolly camera along view direction
        const cam3D = camera3DRef.current
        const dollySpeed = 5
        const delta = e.deltaY > 0 ? dollySpeed : -dollySpeed
        // Move along view direction
        const cp = Math.cos(cam3D.pitch), sp = Math.sin(cam3D.pitch)
        const cy = Math.cos(cam3D.yaw), sy = Math.sin(cam3D.yaw)
        cam3D.pos[0] += -sy * cp * delta
        cam3D.pos[1] += sp * delta
        cam3D.pos[2] += -cy * cp * delta
        forceUpdate(n => n + 1)
        return
      }
      const camera = cameraRef.current
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
      camera.zoom = Math.max(0.5, Math.min(8, camera.zoom * zoomFactor))
      forceUpdate(n => n + 1)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // Keyboard input — writes key states into sim.worldData for step hooks
  useEffect(() => {
    const keyMap: Record<string, string> = {
      ArrowLeft: 'key_left', ArrowRight: 'key_right', ArrowUp: 'key_up', ArrowDown: 'key_down',
      ' ': 'key_space', Enter: 'key_enter', Shift: 'key_shift', Backspace: 'key_backspace',
    }
    // the whole alphabet — worlds that listen to language need every letter
    for (let c = 97; c <= 122; c++) keyMap[String.fromCharCode(c)] = 'key_' + String.fromCharCode(c)
    for (let c = 48; c <= 57; c++) keyMap[String.fromCharCode(c)] = 'key_' + String.fromCharCode(c)   // digits — cards, slots, channels
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e)) return   // form fields own the keyboard
      const sim = simulationRef.current
      if (!sim) return
      if (e.key === ' ') spaceHeld.current = true
      const mapped = keyMap[e.key] ?? keyMap[e.key.toLowerCase()]
      if (mapped) {
        sim.worldData[mapped] = true
        // pulse counter — a tap shorter than one sim frame still registers once
        sim.worldData[mapped + '_n'] = ((sim.worldData[mapped + '_n'] as number) || 0) + 1
        // Prevent arrow keys from scrolling
        if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (typing(e)) return
      const sim = simulationRef.current
      if (!sim) return
      if (e.key === ' ') spaceHeld.current = false
      const mapped = keyMap[e.key] ?? keyMap[e.key.toLowerCase()]
      if (mapped) {
        sim.worldData[mapped] = false
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Initialize engine
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new FieldRenderer(gridSize)
    const sim = new FieldSimulation(gridSize)
    const input = new FieldInput(gridSize)

    rendererRef.current = renderer
    simulationRef.current = sim
    inputRef.current = input

    let cancelled = false

    async function initEngine() {
    let ok = await renderer.init(canvas!)
    if (!ok && !cancelled) {
      // transient device loss (tab remounts, GPU pressure) — one retry earns a lot
      await new Promise(r => setTimeout(r, 700))
      ok = await renderer.init(canvas!)
    }
    if (cancelled) return   // StrictMode/remount cleanup — not a failure, say nothing
    if (!ok) {
      console.error('Failed to initialize WebGPU renderer')
      setGpuFailed(true)
      return
    }
    // a bubble-face atlas that arrived before this renderer existed gets applied now
    if (pendingAtlasRef.current) renderer.uploadIconAtlas(pendingAtlasRef.current)

    // Upload initial empty textures
    renderer.uploadColorData(sim.world.colorData)
    renderer.uploadStateData(sim.world.stateData)
    renderer.uploadSelectionData(new Uint8Array(gridSize * gridSize))

    startTimeRef.current = performance.now() / 1000
    lastFrameRef.current = performance.now()

    // Restore state from server, or create initial field.
    // Space mode restores from its own snapshot effect — pulling the GLOBAL
    // state here would layer global fields on top of the space's world.
    try {
      const data = (spaceId || spaceSlug || playScene)
        ? {}
        : await fetch('/api/engine/state').then(r => r.json())
      if (cancelled) return
      const snaps = data.fields || []
      if (snaps.length > 0) {
        sim.restoreFromSnapshots(snaps)
        if (data.worldParams) sim.setWorldParams(data.worldParams)

        // Restore WGSL mods BEFORE compiling effects (effects may use mod functions)
        if (Array.isArray(data.wgslMods || data.glslMods)) {
          for (const mod of (data.wgslMods || data.glslMods)) {
            if (mod.id && mod.code) {
              wgslModsRef.current.set(mod.id, { id: mod.id, code: mod.code })
            }
          }
        }

        // Restore visual types for superimposed uber-shader
        if (Array.isArray(data.visualTypes)) {
          for (const vt of data.visualTypes) {
            if (vt.name && vt.wgsl) {
              renderer.registerVisualType(vt.name, vt.wgsl)
            }
          }
        }

        // Name is authoritative — numeric visualType IDs are per-session, so a
        // reloaded page must re-resolve each field's visualTypeName against the
        // registry we just rebuilt (same as handleLoadScene / space restore)
        for (const field of sim.fields.values()) {
          if (field.visualTypeName) {
            const runtimeId = renderer.resolveVisualType(field.visualTypeName)
            if (runtimeId !== undefined) field.visualType = runtimeId
          }
        }

        // Restore uber-shader interaction definitions
        if (Array.isArray(data.interactionDefs)) {
          if (!sim.interactionPairs) sim.interactionPairs = []
          for (const def of data.interactionDefs) {
            if (def.name && def.wgsl && def.fieldA && def.fieldB) {
              const result = renderer.registerInteraction(def.name, def.wgsl)
              const propagationTypeId = def.propagation ? renderer.resolvePropagation(def.propagation) : undefined
              sim.interactionPairs = sim.interactionPairs.filter((p: { name: string }) => p.name !== def.name)
              sim.interactionPairs.push({ name: def.name, fieldA: def.fieldA, fieldB: def.fieldB, interactionTypeId: result.id, propagationTypeId })
              console.log(`[Restore] Interaction '${def.name}': ${def.fieldA} + ${def.fieldB} (type ${result.id})`)
            }
          }
        }

        // Restore shader modules
        if (Array.isArray(data.modules)) {
          for (const mod of data.modules) {
            if (mod.name && mod.wgsl) {
              renderer.registerModule(mod.name, mod.wgsl)
            }
          }
        }

        // Restore render targets
        if (Array.isArray(data.renderTargets)) {
          for (const rt of data.renderTargets) {
            if (rt.name) {
              renderer.createRenderTarget(rt.name)
            }
          }
        }

        const firstId = snaps[0].id

        // Restore effect programs for all fields
        let compiled = 0, failed = 0
        for (const field of sim.fields.values()) {
          for (const effect of field.effects) {
            const programKey = `${field.id}_${effect.id}`
            const result = await renderer.compileFieldEffect(programKey, field.id, effect.wgsl, getModCode())
            if (result.success) {
              compiled++
            } else {
              failed++
              console.warn(`[Restore] Effect compile failed for ${field.name}/${effect.id}: ${result.error?.substring(0, 200)}`)
            }
          }
        }
        console.log(`[Restore] Effects: ${compiled} compiled, ${failed} failed, mods: ${wgslModsRef.current.size}`)

        setBrush(prev => ({ ...prev, activeFieldId: firstId }))
      }

      // Restore step hooks
      if (Array.isArray(data.stepHooks)) {
        for (const hook of data.stepHooks) {
          if (hook.id && hook.code) {
            sim.addStepHook(hook.id, hook.author || 'unknown', hook.description || '', hook.code)
          }
        }
        // A restored world with logic should resume running, same as a
        // freshly loaded scene cartridge — otherwise reload freezes the game
        if (data.stepHooks.length > 0 && !sim.running) {
          sim.running = true
          setRunning(true)
        }
      }
      // Restore interaction effects
      if (Array.isArray(data.interactionEffects)) {
        for (const ie of data.interactionEffects) {
          if (ie.wgsl) {
            sim.addInteractionEffect(ie)
          }
        }
      }
      // Restore world data
      if (data.worldData && typeof data.worldData === 'object') {
        Object.assign(sim.worldData, data.worldData)
      }
      setFields(new Map(sim.fields))
    } catch {
      if (!cancelled) setFields(new Map(sim.fields))
    }

    // Wire hook-initiated scene transitions (handleLoadScene reads live refs, so a
    // mount-time capture stays valid)
    loadSceneRef.current = handleLoadScene

    // Render loop — crash-guarded: an exception must not silently freeze
    // the canvas to black. The first crash is surfaced as a fault.
    function frame() {
      try { frameBody() } catch (e) {
        const msg = String((e as Error)?.message || e)
        // The vote reckoning insets the canvas; mid-resize the browser can throw a
        // one-off swapchain-allocation error ("texture usage must not be 0" on the
        // IOSurface). It's a transient, not a world fault — skip the frame and let
        // the next settled one render, without tripping the (sticky) fault banner.
        if (/texture usage must not be 0|IOSurface|SharedTextureMemory|getCurrentTexture/i.test(msg)) {
          animFrameRef.current = requestAnimationFrame(frame)
          return
        }
        console.error('[Engine] frame crashed:', e)
        if (!frameCrashRef.current) {
          frameCrashRef.current = true
          window.dispatchEvent(new CustomEvent('cc:fault', {
            detail: { kind: 'frame-crash', message: msg.slice(0, 400) },
          }))
        }
        animFrameRef.current = requestAnimationFrame(frame)
      }
    }
    function frameBody() {
      const now = performance.now()
      // Cap at ~60fps: ProMotion displays otherwise drive the full compute
      // pipeline at 120Hz — double the GPU load (and laptop heat) for no
      // perceptible gain in a shader-driven scene. Watching IS using, focused
      // or not — the usual posture is the engine visible beside a chat window,
      // and a 10fps unfocused throttle read as "the scene is choppy" (Jul 12
      // 2026, measured: every dropped frame was an unfocused one). Full rate
      // whenever visible; hidden tabs still pause free via rAF.
      const minFrameMs = 15
      if (now - lastFrameRef.current < minFrameMs) {
        animFrameRef.current = requestAnimationFrame(frame)
        return
      }
      const dt = (now - lastFrameRef.current) / 1000
      lastFrameRef.current = now

      const sim = simulationRef.current
      const renderer = rendererRef.current
      if (!sim || !renderer) return

      // ── budget meter: cost must be visible BEFORE it becomes a freeze ──
      frameMsEmaRef.current = frameMsEmaRef.current * 0.95 + Math.min(dt * 1000, 250) * 0.05
      // ── render-scale GOVERNOR ── ease down under load, recover when comfortable.
      // Thresholds are separated (33ms down / 20ms up) with a cooldown so it settles
      // instead of pulsing; down-steps are bigger than up-steps (drop fast, recover
      // slow). A player is told ONCE, the first time it actually has to help.
      {
        const ema = frameMsEmaRef.current
        const FLOOR = 0.55
        const easeNote = () => {
          if (!govNotifiedRef.current) { govNotifiedRef.current = true; showToast('⚡ easing render quality a touch to keep this world smooth', 'info') }
        }
        if (ema > 120 && autoScaleRef.current > FLOOR) {
          autoScaleRef.current = FLOOR; govAdjAtRef.current = now; easeNote()   // catastrophic → snap to floor
        } else if (now - govAdjAtRef.current > 700) {
          if (ema > 33 && autoScaleRef.current > FLOOR) {
            autoScaleRef.current = Math.max(FLOOR, autoScaleRef.current - 0.1); govAdjAtRef.current = now; easeNote()
          } else if (ema < 20 && autoScaleRef.current < 1) {
            autoScaleRef.current = Math.min(1, autoScaleRef.current + 0.05); govAdjAtRef.current = now
          }
        }
      }
      if (now - budgetWroteRef.current > 2000) {
        budgetWroteRef.current = now
        let effectCount = 0
        for (const f of sim.fields.values()) effectCount += f.effects.length
        const frameMs = Math.round(frameMsEmaRef.current * 10) / 10
        sim.worldData['__budget'] = { fields: sim.fields.size, effects: effectCount, frameMs, at: Date.now() }
        // one sustained warning per session — fields are real GPU cost; a
        // population belongs in gpuPopulation, not in a field per entity
        if (!budgetWarnedRef.current && frameMs > 40 && (sim.fields.size > 6 || effectCount > 8)) {
          budgetWarnedRef.current = true
          console.warn(`[budget] sustained ${frameMs}ms/frame with ${sim.fields.size} fields / ${effectCount} effects — this is the field-count wall. Draw populations via worldData.gpuPopulation (pop(i) in one visual) instead of one field per entity.`)
        }
      }

      sandboxRef.current?.tick(sim, dt)
      sim.step(dt)

      // Process audio triggers from worldData (single event or an array per tick)
      // Hosted files only load from the cafe's own blob store (or same-origin) —
      // worlds can't hotlink arbitrary audio off the open web.
      const audioUrlOk = (u: string): boolean => {
        try {
          const h = new URL(u, location.href)
          return h.protocol === 'https:' && (h.hostname.endsWith('.public.blob.vercel-storage.com') || h.origin === location.origin)
        } catch { return false }
      }
      type PlaySoundCmd = { id?: string; url?: string; frequency?: number; duration?: number; volume?: number; pitch?: number; type?: OscillatorType }
      const playSoundRaw = sim.worldData['__play_sound'] as PlaySoundCmd | PlaySoundCmd[] | undefined
      if (playSoundRaw) {
        delete sim.worldData['__play_sound']
        const audio = audioRef.current
        for (const playSound of Array.isArray(playSoundRaw) ? playSoundRaw : [playSoundRaw]) {
          if (playSound.id && audio.hasSound(playSound.id)) {
            audio.play(playSound.id, playSound.volume ?? 1.0, playSound.pitch ?? 1.0)
          } else if (playSound.id && playSound.url && audioUrlOk(playSound.url)) {
            // first strike lazy-loads (one fetch of latency); replays are instant
            const { id, url, volume, pitch } = playSound
            void audio.loadSound(id, url).then(ok => { if (ok) audio.play(id!, volume ?? 1.0, pitch ?? 1.0) })
          } else if (playSound.frequency) {
            audio.beep(playSound.frequency, playSound.duration ?? 0.2, playSound.volume ?? 0.5, playSound.type)
          }
        }
      }

      // Music: { score } plays a COMPOSED score (data, nothing hosted — the audio
      // equivalent of a shader); { url } plays a file track; { stop: true } fades out.
      const playMusic = sim.worldData['__play_music'] as { url?: string; score?: object; volume?: number; loop?: boolean; stop?: boolean } | undefined
      if (playMusic) {
        delete sim.worldData['__play_music']
        const audio = audioRef.current
        if (playMusic.stop) { audio.stopScore(); audio.stopMusic() }
        else if (playMusic.score) audio.playScore(playMusic.score as Parameters<typeof audio.playScore>[0])
        else if (playMusic.url && audioUrlOk(playMusic.url)) void audio.playMusic(playMusic.url, { volume: playMusic.volume, loop: playMusic.loop })
      }

      // Reactive score: the world sweeps its own music live (audio as a second
      // rendering of world state). Continuous value — read every frame, not a
      // one-shot command, so it's not deleted.
      const musicMod = sim.worldData['music_mod'] as { brightness?: number; gain?: number } | undefined
      if (musicMod) audioRef.current.setScoreMod(musicMod)

      // the EYE cuts a version when an AI edit-burst settles on a branch
      if (now - eyeCheckRef.current > 1000) {
        eyeCheckRef.current = now
        setAiPulse(p => p + 1)   // keeps the AI status dot honest
        if (aiDirtyRef.current && Date.now() - aiLastEditRef.current > 4000 && lastSceneRef.current.includes(' ⑂ ')) {
          aiDirtyRef.current = false
          const cur = lastSceneRef.current
          const m = cur.match(/· v(\d+)$/)
          const next = m ? cur.replace(/· v\d+$/, `· v${+m[1] + 1}`) : `${cur} · v2`
          lastSceneRef.current = next
          // the save may DEDUPE (identical to the last version) → it returns the
          // existing version's name; follow it so we don't leave a gap or point at
          // a version that was never created.
          saveSceneAs(next).then(savedAs => {
            if (savedAs) {
              lastSceneRef.current = savedAs
              if (savedAs === next) showToast(`eye: ${next.split(' ⑂ ')[1]} saved`, 'success')
            }
          })
        }
      }

      // Hook-initiated room transition: worldData.__loadScene = 'SceneName' — the
      // door that actually leads somewhere (Zelda rooms from inside a running scene)
      const nextScene = sim.worldData['__loadScene']
      if (typeof nextScene === 'string') {
        delete sim.worldData['__loadScene']
        loadSceneRef.current?.(nextScene)
      }

      // Game saves: __save_game {slot, data} persists; __load_game {slot} answers
      // into worldData.game_save = { slot, data } for the hook to consume
      // each player owns their save, isolated PER WORLD. The server namespaces the
      // slot by the authenticated user (scope:'user') — the client identity is only
      // a fallback token for session-less browsers, never the source of truth — and
      // we prefix the world so a game's save in one world can't collide with another.
      const saveReq = sim.worldData['__save_game'] as { slot?: string; data?: unknown } | undefined
      if (saveReq && typeof saveReq.slot === 'string') {
        delete sim.worldData['__save_game']
        fetch('/api/engine/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: `${cellBase()}:${saveReq.slot}`, data: saveReq.data ?? null, scope: 'user', anon: whoRef.current }),
        }).catch(() => {})
      }
      const loadReq = sim.worldData['__load_game'] as { slot?: string } | undefined
      if (loadReq && typeof loadReq.slot === 'string') {
        delete sim.worldData['__load_game']
        fetch(`/api/engine/save?scope=user&anon=${encodeURIComponent(whoRef.current || '')}&slot=${encodeURIComponent(`${cellBase()}:${loadReq.slot}`)}`)
          .then(r => r.json())
          .then(j => {
            const s = simulationRef.current
            if (s) s.worldData['game_save'] = { slot: loadReq.slot, data: j?.data ?? null }
          })
          .catch(() => {})
      }

      // AUTO-SAVE (infrastructure): for persist worlds, mirror worldData.save back
      // to the player's slot whenever it changes, debounced. The world writes to
      // worldData.save and forgets — no save/load code of its own. Gated on
      // autoSaveReadyRef so we never clobber the just-loaded save with the default.
      if (autoSaveReadyRef.current && sim.worldData['persist'] && sim.worldData['save'] !== undefined && now - autoSaveAtRef.current > 4000) {
        const ser = JSON.stringify(sim.worldData['save'])
        if (ser !== autoSaveSerRef.current) {
          autoSaveSerRef.current = ser
          autoSaveAtRef.current = now
          fetch('/api/engine/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot: `${cellBase()}:__autosave`, data: sim.worldData['save'], scope: 'user', anon: whoRef.current }),
          }).catch(() => {})
        }
      }

      // HOOK ERRORS → server (so the building AI can READ why a hook does nothing).
      // The sandbox writes each DISTINCT failure into worldData.last_hook_error;
      // forward every new one (deduped by timestamp) to a per-world buffer the
      // bridge folds into cafe_state as `hookErrors`. Keyed by slug (space world)
      // or scene name, matching how the bridge reads it back.
      const hookErr = sim.worldData['last_hook_error'] as { hookId?: string; phase?: string; error?: string; at?: number } | undefined
      if (hookErr && typeof hookErr.at === 'number' && hookErr.at !== hookErrAtRef.current) {
        hookErrAtRef.current = hookErr.at
        fetch('/api/engine/hook-errors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: spaceSlug || undefined, scene: spaceSlug ? undefined : cellBase(), error: hookErr }),
        }).catch(() => {})
      }

      // Update HUD overlay from worldData (cached element lookups, no per-frame DOM queries)
      // The HUB (CAFE / SUB-MAIN) never shows a world's HUD — a game's score UI
      // lingers in worldData.hud after you leave (the hook stops, the value stays,
      // and the hub snapshot merges rather than clears), so it bled onto main.
      // Detect the hub from the sim's OWN fields → hudData undefined → cleared below.
      const onHubHud = sim.fields.has('cf_world_f') || sim.fields.has('cf_submain_f')
      const hudData = onHubHud ? undefined : (sim.worldData['hud'] as HudElement[] | undefined)
      const hudContainer = hudContainerRef.current
      if (hudContainer) {
        if (hudData && Array.isArray(hudData)) {
          const cache = hudElementCacheRef.current
          const seen = new Set<string>()
          for (const elem of hudData) {
            if (!elem.id || elem.visible === false) continue
            seen.add(elem.id)
            let el = cache.get(elem.id)
            if (!el || !el.isConnected) {
              el = document.createElement('div')
              el.setAttribute('data-hud-id', elem.id)
              el.style.position = 'absolute'
              hudContainer.appendChild(el)
              cache.set(elem.id, el)
            }
            el.style.left = elem.x ?? ''
            el.style.top = elem.y ?? ''
            el.style.right = elem.right ?? ''
            el.style.bottom = elem.bottom ?? ''
            el.style.color = elem.color ?? '#fff'
            el.style.fontSize = elem.fontSize ?? '16px'

            if (elem.type === 'text') {
              el.textContent = elem.text ?? ''
            } else if (elem.type === 'bar') {
              const pct = elem.max ? Math.min(100, ((elem.value ?? 0) / elem.max) * 100) : 0
              // Reuse fill child if it exists
              let fill = el.firstChild as HTMLElement | null
              if (!fill || !fill.style) {
                el.innerHTML = ''
                el.style.width = elem.width ?? '100px'
                el.style.height = '12px'
                el.style.backgroundColor = 'rgba(255,255,255,0.2)'
                el.style.borderRadius = '2px'
                el.style.overflow = 'hidden'
                fill = document.createElement('div')
                fill.style.height = '100%'
                fill.style.backgroundColor = elem.barColor ?? elem.color ?? '#0f0'
                fill.style.transition = 'width 0.15s'
                el.appendChild(fill)
              }
              fill.style.width = `${pct}%`
            } else if (elem.type === 'image') {
              if (el.tagName !== 'IMG') {
                const img = document.createElement('img') as HTMLImageElement
                img.setAttribute('data-hud-id', elem.id)
                img.style.position = 'absolute'
                el.replaceWith(img)
                el = img
                cache.set(elem.id, el)
              }
              (el as HTMLImageElement).src = elem.src ?? ''
              el.style.width = elem.imgWidth ?? ''
              el.style.height = elem.imgHeight ?? ''
              el.style.left = elem.x ?? ''
              el.style.top = elem.y ?? ''
              el.style.right = elem.right ?? ''
              el.style.bottom = elem.bottom ?? ''
            }
          }
          // Remove stale elements using cache (no DOM query)
          for (const [id, el] of cache) {
            if (!seen.has(id)) {
              el.remove()
              cache.delete(id)
            }
          }
        } else if (hudElementCacheRef.current.size > 0) {
          hudContainer.innerHTML = ''
          hudElementCacheRef.current.clear()
        }
      }

      // Paint field shapes into colorData so base pass renders them
      sim.paintFieldShapes()

      renderer.uploadColorData(sim.world.colorData)
      renderer.uploadStateData(sim.world.stateData)
      renderer.uploadEffectData(sim.world.effectData)

      // Run GPU state update shader (if active)
      if (renderer.hasStateUpdate()) {
        const stateTime = now / 1000 - startTimeRef.current
        renderer.runStateUpdate(stateTime, dt / 1000)
        // Async readback — don't block the frame. State syncs next frame.
        renderer.readbackState(sim.world.stateData).catch(() => {})
      }

      // World uniforms ("the whiteboard") — hooks write worldData.gpuUniforms,
      // every visual/interaction shader reads it via uni(i) / uni4(i)
      const gpuUni = sim.worldData['gpuUniforms']
      if (Array.isArray(gpuUni)) renderer.updateWorldUniforms(gpuUni as number[])

      // Entity population — hooks write worldData.gpuPopulation (flat floats,
      // 4 per entity: x, y, angle, aux), shaders read pop(i) / popCount()
      const gpuPop = sim.worldData['gpuPopulation']
      if (Array.isArray(gpuPop) || gpuPop instanceof Float32Array) {
        renderer.updatePopulation(gpuPop as number[])
      }

      const camera = cameraRef.current
      const time = now / 1000 - startTimeRef.current

      // Camera follow mode — lerp toward target field position
      const follow = cameraFollowRef.current
      if (follow) {
        const targetField = sim.fields.get(follow.targetFieldId)
        if (targetField) {
          const targetX = targetField.transform.x + follow.offsetX
          const targetY = targetField.transform.y + follow.offsetY
          const dx = targetX - camera.x
          const dy = targetY - camera.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > follow.deadZone) {
            const s = 1 - Math.pow(1 - follow.smoothing, dt * 60)
            camera.x += dx * s
            camera.y += dy * s
          }
        }
      }

      // Build effect list — mask texture clips to painted cells only
      const fieldEffects: FieldEffectData[] = []
      const fullBounds: [number, number, number, number] = [0, 0, gridSize, gridSize]
      for (const field of sim.fields.values()) {
        const bounds = sim.getFieldBounds(field.id)

        if (!bounds || field.effects.length === 0) continue

        const effectBounds: [number, number, number, number] = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
        for (const effect of field.effects) {
          const programKey = `${field.id}_${effect.id}`
          if (!renderer.hasFieldEffect(programKey)) continue
          fieldEffects.push({
            fieldId: field.id,
            programKey,
            bounds: effectBounds,
            transform: [field.transform.x, field.transform.y, field.transform.rotation, field.transform.scale],
            // a hook may drive an effect's params live (cursor, sliders, …);
            // fall back to the field color when it hasn't set any.
            params: (effect as { params?: [number, number, number, number] }).params
              ?? [field.color[0], field.color[1], field.color[2], field.color[3]],
            blend: effect.blend,
            feedback: effect.feedback,
          })
        }
      }


      // --- Interaction effects (merged into field pipeline) ---
      if (sim.interactionEffects.length > 0) {
        const activePairs = sim.getActiveInteractionPairs()

        for (const { effect, fieldA, fieldB } of activePairs) {
          // Per-pair program key (fixes wildcard mask overwrite bug)
          const pairKey = `ix_${effect.id}_${fieldA.id}_${fieldB.id}`

          // Lazy compile (wrap interaction GLSL → fieldEffect). A failed
          // compile is remembered and never retried — one bad effect must
          // not spam errors or poison the frame every tick.
          if (failedIxEffectsRef.current.has(pairKey)) continue
          if (!renderer.hasFieldEffect(pairKey)) {
            const wrappedWgsl = wrapInteractionWgsl(effect.wgsl)
            // Fire-and-forget async compile — will be ready next frame
            renderer.compileFieldEffect(pairKey, pairKey, wrappedWgsl, getModCode())
              .then(result => {
                if (!result.success) {
                  console.warn(`Interaction effect ${effect.id} compile error:`, result.error)
                  failedIxEffectsRef.current.add(pairKey)
                  window.dispatchEvent(new CustomEvent('cc:fault', {
                    detail: { kind: 'ix-effect', message: `interaction effect '${effect.id}' failed to compile: ${String(result.error).slice(0, 300)}` },
                  }))
                }
              })
            continue
          }

          // Upload cached overlap mask if available (computed at 250ms intervals)
          const overlapMask = cachedOverlapMasksRef.current.get(pairKey)
          if (overlapMask) {
            renderer.uploadFieldMask(pairKey, overlapMask)
          }

          // Compute union bounds of both fields (expanded by spread) — the interaction
          // shader runs in this region, NOT the full 512x512 grid.
          const spread = effect.spread || 0
          const boundsA = sim.getFieldBounds(fieldA.id)
          const boundsB = sim.getFieldBounds(fieldB.id)
          const ixBounds: [number, number, number, number] = boundsA && boundsB
            ? [
                Math.max(0, Math.min(boundsA.minX, boundsB.minX) - spread),
                Math.max(0, Math.min(boundsA.minY, boundsB.minY) - spread),
                Math.min(gridSize, Math.max(boundsA.maxX, boundsB.maxX) + spread),
                Math.min(gridSize, Math.max(boundsA.maxY, boundsB.maxY) + spread),
              ]
            : fullBounds

          fieldEffects.push({
            fieldId: pairKey,
            programKey: pairKey,
            bounds: ixBounds,
            transform: [
              (fieldA.transform.x + fieldB.transform.x) / 2,
              (fieldA.transform.y + fieldB.transform.y) / 2,
              0, 1
            ],
            params: [fieldA.color[0], fieldB.color[0], 0, 0],
            blend: effect.blend,
            fieldAColor: fieldA.color,
            fieldBColor: fieldB.color,
            fieldATransform: [fieldA.transform.x, fieldA.transform.y, fieldA.transform.rotation, fieldA.transform.scale],
            fieldBTransform: [fieldB.transform.x, fieldB.transform.y, fieldB.transform.rotation, fieldB.transform.scale],
            precedence: effect.precedence,
          })

          // Process interaction hooks (throttled per-effect)
          if (effect.hooks && effect.hooks.length > 0) {
            const hookKey = `ix_hook_${effect.id}`
            const lastHookTime = (sim.worldData[hookKey] as number) || 0
            const minCooldown = Math.min(...effect.hooks.map(h => h.cooldown ?? 1.0))
            if (time - lastHookTime >= minCooldown) {
              sim.worldData[hookKey] = time
              for (const hook of effect.hooks) {
                const hookCooldownKey = `${hookKey}_${hook.type}`
                const lastThisHook = (sim.worldData[hookCooldownKey] as number) || 0
                if (time - lastThisHook < (hook.cooldown ?? 1.0)) continue
                sim.worldData[hookCooldownKey] = time

                const targets: string[] = []
                if (hook.target === 'A' || hook.target === 'both' || !hook.target) targets.push(fieldA.id)
                if (hook.target === 'B' || hook.target === 'both' || !hook.target) targets.push(fieldB.id)

                switch (hook.type) {
                  case 'memory':
                    for (const fid of targets) {
                      sim.addMemory(fid, {
                        timestamp: new Date().toISOString(),
                        type: 'collision',
                        content: hook.message || `Interaction: ${effect.description}`,
                        sourceFieldId: fid === fieldA.id ? fieldB.id : fieldA.id,
                      })
                    }
                    break
                  case 'modify_property':
                    if (hook.property) {
                      for (const fid of targets) {
                        const f = sim.fields.get(fid)
                        if (f) f.properties.set(hook.property, hook.value)
                      }
                    }
                    break
                  case 'apply_force':
                    for (const fid of targets) {
                      sim.applyForce(fid, hook.fx ?? 0, hook.fy ?? 0)
                    }
                    break
                  case 'webhook':
                    if (hook.url) {
                      fetch(hook.url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          effectId: effect.id,
                          fieldA: fieldA.id,
                          fieldB: fieldB.id,
                          time,
                        }),
                      }).catch(() => {})
                    }
                    break
                }
              }
            }
          }
        }

        // Clean up stale interaction programs (reuse Set to avoid per-frame allocation)
        const activePairKeys = _reusableKeySet
        activePairKeys.clear()
        for (const p of activePairs) {
          activePairKeys.add(`ix_${p.effect.id}_${p.fieldA.id}_${p.fieldB.id}`)
        }
        for (const key of renderer.getFieldEffectKeys()) {
          if (key.startsWith('ix_') && !activePairKeys.has(key)) {
            renderer.removeFieldEffect(key)
            renderer.removeFieldMask(key)
          }
        }
      }

      // ─── Superimposed fields — pack fields with visualType for uber-shader ───
      // Compute camera viewport in grid coords for CPU-side frustum culling
      const canvas = canvasRef.current
      let vpMinX = -Infinity, vpMinY = -Infinity, vpMaxX = Infinity, vpMaxY = Infinity
      if (canvas) {
        const dpr = (window.devicePixelRatio || 1) * renderer.renderScale
        const aspect = (canvas.clientWidth * dpr) / (canvas.clientHeight * dpr)
        const gridRange = gridSize / camera.zoom
        const halfW = gridRange * Math.max(aspect, 1.0) * 0.5
        const halfH = gridRange * Math.max(1.0 / aspect, 1.0) * 0.5
        vpMinX = camera.x - halfW
        vpMaxX = camera.x + halfW
        vpMinY = camera.y - halfH
        vpMaxY = camera.y + halfH
      }

      const superFields: SuperFieldGPU[] = []
      const superFieldOrder: string[] = []  // Maps GPU array index → fieldId
      // Sort fields by renderOrder (lower = rendered first = behind)
      const sortedFields = Array.from(sim.fields.values())
        .filter(f => f.visualType !== undefined)
        .sort((a, b) => (a.renderOrder || 0) - (b.renderOrder || 0))
      for (const field of sortedFields) {
        const t = field.transform
        const shapeType = field.shapeType === 'rect' ? 1 : field.shapeType === 'screen' ? 2 : 0
        const dim1 = shapeType === 2 ? (field.w || sim.gridSize) : shapeType === 1 ? (field.w || 20) : (field.radius || 10)
        const dim2 = shapeType === 2 ? (field.h || sim.gridSize) : shapeType === 1 ? (field.h || 20) : 0

        // Viewport culling — skip fields entirely outside the camera view
        const s = Math.max(t.scale, 0.001)
        let hx: number, hy: number
        if (shapeType === 1 || shapeType === 2) {
          // Rotated rect/screen AABB
          const ac = Math.abs(Math.cos(t.rotation))
          const as_ = Math.abs(Math.sin(t.rotation))
          hx = (dim1 * 0.5 * ac + dim2 * 0.5 * as_) * s
          hy = (dim1 * 0.5 * as_ + dim2 * 0.5 * ac) * s
        } else {
          hx = dim1 * s
          hy = dim1 * s
        }
        // Skip viewport culling when GPU step hooks are active — culling changes
        // field indices which breaks the stepStateBuffer index mapping (velocity
        // accumulated for field N would be read by field N-1 after a cull shift).
        if (!renderer.hasStepHooks()) {
          if (t.x + hx < vpMinX || t.x - hx > vpMaxX ||
              t.y + hy < vpMinY || t.y - hy > vpMaxY) {
            continue // entirely off-screen
          }
        }

        const vp = field.visualParams || [0, 0, 0, 0]
        // Resolve render target name → ID (-1 = screen, 0-5 = target index)
        const rtName = field.properties.get('renderTarget') as string | undefined
        const renderTargetId = rtName ? renderer.resolveRenderTarget(rtName) : (field.noHit ? -2 : -1)
        superFieldOrder.push(field.id)
        superFields.push({
          // When step hooks are active, the GPU shader ignores these x/y values and
          // restores its own persistent position from stepStates.flags.zw instead.
          posScaleRot: [t.x, t.y, t.scale, t.rotation],
          shapeDims: [shapeType, dim1, dim2, renderTargetId],
          color: field.color,
          visualAndParams: [field.visualType!, vp[0], vp[1], vp[2]],
          extraParams: [
            vp[3],
            field.properties.get('bidirectionalBehind') ? 1 : 0,
            (field.properties.get('lighting') as number) ?? 0,
            (field.properties.get('specular') as number) ?? 0,
          ],
          pos3D: [t.z || 0, t.rotX || 0, t.rotY || 0, field.properties.get('superimpose') ? 1 : 0],
        })
      }

      // Upload per-field step state ONLY for newly added fields — the GPU owns
      // stepStateBuffer once initialized. Uploading every frame destroys the GPU's
      // accumulated velocity (the orbit hook's mix() damping never builds up).
      if (renderer.hasStepHooks() && superFields.length > 0) {
        for (let i = 0; i < superFieldOrder.length; i++) {
          const fieldId = superFieldOrder[i]
          if (stepStateInitializedRef.current.has(fieldId)) continue
          const field = sim.fields.get(fieldId)
          if (!field) continue
          const t = field.transform
          renderer.uploadStepState(
            i,
            [t.vx, t.vy, t.vz || 0, t.vr],
            [
              (field.properties.get('state0') as number) ?? 0,
              (field.properties.get('state1') as number) ?? 0,
              (field.properties.get('state2') as number) ?? 0,
              (field.properties.get('state3') as number) ?? 0,
            ],
            [
              (field.properties.get('state4') as number) ?? 0,
              (field.properties.get('state5') as number) ?? 0,
              (field.properties.get('state6') as number) ?? 0,
              (field.properties.get('state7') as number) ?? 0,
            ],
            [field.color[3] > 0 ? 1 : 0, 0, 0, 0],  // alive, age (GPU tracks), tag0, tag1
          )
          stepStateInitializedRef.current.add(fieldId)
        }
      }

      // Trigger lazy compilation of superimposed pipeline. The 3D pipeline
      // only compiles when actually in 3D mode — eagerly compiling it in 2D
      // doubles every scene switch's compile cost and, if a visual is broken,
      // spams a failing recompile every frame.
      if (superFields.length > 0) {
        renderer.isSuperReady()
        if (renderModeRef.current === '3d') renderer.isSuper3DReady()
      }

      // Compile GPU step hooks when dirty
      if (sim.gpuStepHooksDirty) {
        sim.gpuStepHooksDirty = false
        renderer.invalidateStepHooks()
        // Reset step state initialization so new hooks get fresh state
        stepStateInitializedRef.current.clear()
        if (sim.gpuStepHooks.size > 0) {
          renderer.compileStepHookPipeline(sim.getSortedGpuStepHooks()).then(result => {
            if (!result.ok) {
              console.warn('[GPU StepHook] Compilation failed:', result.error)
            }
          })
        } else {
          renderer.clearStepHookPipeline()
        }
      }

      // Store field order for pixel-perfect hit testing
      sim.superFieldOrder = superFieldOrder

      // Map interaction pairs (field name → field name) to GPU indices (idx → idx)
      // Rebuild name→ID lookup only when field count changes (avoids per-frame Map allocation)
      const fieldCount = sim.fields.size
      if (fieldCount !== lastFieldCountRef.current) {
        lastFieldCountRef.current = fieldCount
        const m = nameToIdRef.current
        m.clear()
        for (const field of sim.fields.values()) {
          m.set(field.name, field.id)
        }
      }
      const nameToId = nameToIdRef.current
      const activeInteractions: { fieldIdxA: number; fieldIdxB: number; interactionType: number; propagationType?: number }[] = []
      if (sim.interactionPairs && sim.interactionPairs.length > 0) {
        for (const pair of sim.interactionPairs) {
          const idA = nameToId.get(pair.fieldA) || pair.fieldA
          const idB = nameToId.get(pair.fieldB) || pair.fieldB
          const idxA = superFieldOrder.indexOf(idA)
          const idxB = superFieldOrder.indexOf(idB)
          if (idxA >= 0 && idxB >= 0) {
            activeInteractions.push({ fieldIdxA: idxA, fieldIdxB: idxB, interactionType: pair.interactionTypeId, propagationType: pair.propagationTypeId })
          }
        }
      }

      // Apply post-processing settings from worldData if set
      const ppData = sim.worldData['postProcess'] as Partial<typeof renderer.postProcessSettings> | undefined
      if (ppData) {
        renderer.setPostProcess(ppData)
      }

      // A heavy world may request a lower internal resolution — raymarched
      // worlds upscale invisibly, and pixel count is the biggest lever on
      // retina. Absent the key, reset to full res so it never leaks between
      // worlds.
      const rScale = (sim.worldData['renderScale'] as number | undefined) ?? 1.0
      // the governor MULTIPLIES the world's declared scale; clamp so the two
      // together never drop absurdly low (still readable, just softer under load)
      const effScale = Math.max(0.4, rScale * autoScaleRef.current)
      if (effScale !== renderer.renderScale) renderer.setRenderScale(effScale)
      // per-world pixel budget: detail-heavy but cheap-per-pixel worlds can buy
      // back full retina sharpness (the 2.2M default upscales ~30-50% on hidpi,
      // which reads as soft focus). Clamped so no world can order a GPU-killer.
      const budget = sim.worldData['maxBufferPixels']
      const wantPx = typeof budget === 'number' ? Math.max(1_000_000, Math.min(6_500_000, budget)) : 2_200_000
      if (wantPx !== renderer.maxBufferPixels) renderer.maxBufferPixels = wantPx

      // Process particle emission requests from worldData
      const emitParticle = sim.worldData['__emit_particles'] as { x: number; y: number; count: number; color?: [number, number, number]; velX?: number; velY?: number; spread?: number; size?: number; life?: number } | undefined
      if (emitParticle) {
        renderer.emitParticles(emitParticle.x, emitParticle.y, emitParticle.count, emitParticle)
        lastParticleRef.current = now
        delete sim.worldData['__emit_particles']
      }

      const mode3D = renderModeRef.current === '3d' ? camera3DRef.current : undefined
      const stepHookData = renderer.hasStepHooks() ? { dt, worldData: sim.worldData } : undefined

      // ── Lossless frame memoization ──
      // Every visual is a pure function of (uv, time, params, uniforms). If no
      // visible visual animates with time and none of the inputs changed, the
      // last frame is still pixel-identical — skip the GPU entirely.
      // Conservative bail-outs: 3D mode, GPU hooks, legacy effects, interactions,
      // projectiles/particles, state shaders, or a pipeline mid-compile.
      let skipRender = false
      if (!mode3D && !stepHookData && renderer.superReady &&
          fieldEffects.length === 0 && activeInteractions.length === 0 &&
          sim.projectiles.length === 0 && !renderer.hasStateUpdate() &&
          now - lastParticleRef.current > 6000) {
        let animated = false
        for (const f of sim.fields.values()) {
          if (typeof f.visualType === 'number' && renderer.visualAnimated(f.visualType)) { animated = true; break }
        }
        if (!animated) {
          const parts: (string | number)[] = [
            renderer.compilationId, camera.x, camera.y, camera.zoom,
            canvasRef.current?.width ?? 0, canvasRef.current?.height ?? 0,
          ]
          for (const f of sim.fields.values()) {
            const tr = f.transform
            parts.push(f.id, tr.x, tr.y, tr.rotation, tr.scale,
              f.visualType ?? -1, String(f.color), String(f.visualParams ?? ''), f.renderOrder ?? 0)
          }
          const gu = sim.worldData['gpuUniforms']
          if (Array.isArray(gu)) parts.push(gu.join(','))
          const pp = sim.worldData['postProcess']
          if (pp) parts.push(JSON.stringify(pp))
          const fp = parts.join('|')
          if (fp === frameFingerprintRef.current) skipRender = true
          else frameFingerprintRef.current = fp
        } else {
          frameFingerprintRef.current = ''
        }
      } else {
        frameFingerprintRef.current = ''
      }

      if (!skipRender) {
        renderer.render(camera, camera.zoom, time, fieldEffects, superFields, activeInteractions, mode3D ? { pos: mode3D.pos, pitch: mode3D.pitch, yaw: mode3D.yaw, fov: mode3D.fov } : undefined, stepHookData)
      }

      // Trigger async readback of hit ID map for pixel-perfect hit testing
      if (superFields.length > 0) {
        renderer.readbackHitMap()
        // Update simulation with latest hit map and grid-to-pixel converters
        sim.superHitMap = renderer.hitMap
        sim.superHitMapWidth = renderer.hitMapWidth
        sim.superHitMapHeight = renderer.hitMapHeight

        const canvas = canvasRef.current
        if (canvas) {
          // use the real buffer dims the renderer set this frame — dpr may be
          // capped by the renderer's pixel budget (effectiveDpr)
          const bw = canvas.width
          const bh = canvas.height
          const aspect = bw / bh
          const gridRange = sim.gridSize / camera.zoom

          // Grid → buffer pixel (inverse of shader's pixel → grid transform)
          // Shader: gridCoord.y = camera.y + (0.5 - uv.y) * gridRange  (note: Y is flipped)
          // Inverse: uv.y = 0.5 - (gridY - camera.y) / gridRange
          //          pixel.y = (1.0 - uv.y) * bh  ... wait, shader does uv = 1 - pixel/res
          // Shader: uv.y = 1 - (pixel.y + 0.5) / bh
          //         gridCoord.y = camera.y + (0.5 - uv.y) * gridRange
          //                     = camera.y + (0.5 - 1 + (pixel.y+0.5)/bh) * gridRange
          //                     = camera.y + ((pixel.y+0.5)/bh - 0.5) * gridRange
          // Inverse: pixel.y = ((gridY - camera.y) / gridRange + 0.5) * bh - 0.5
          if (aspect > 1) {
            sim._gridToPixelX = (gx: number) => ((gx - camera.x) / (gridRange * aspect) + 0.5) * bw
            sim._gridToPixelY = (gy: number) => ((gy - camera.y) / gridRange + 0.5) * bh
          } else {
            sim._gridToPixelX = (gx: number) => ((gx - camera.x) / gridRange + 0.5) * bw
            sim._gridToPixelY = (gy: number) => ((gy - camera.y) / (gridRange / aspect) + 0.5) * bh
          }
        }
      }

      // GPU step hook readback — sync GPU positions to CPU for hit testing only.
      // The GPU shader persists positions in stepStates.flags.zw and ignores CPU-packed
      // positions, so this readback doesn't affect rendering — only CPU hit detection.
      if (renderer.hasStepHooks() && superFields.length > 0) {
        renderer.readbackSuperFields(superFields.length)
        const readback = renderer.consumeSuperFieldReadback()
        if (readback) {
          for (let i = 0; i < superFieldOrder.length; i++) {
            const field = sim.fields.get(superFieldOrder[i])
            if (!field) continue
            const off = i * 24
            field.transform.x = readback[off + 0]
            field.transform.y = readback[off + 1]
          }
        }
      }

      // Per-field presence map: render each field individually, readback pixel presence (throttled)
      // This is the "field renders to pixels → pixels return superimposition data" pipeline
      if (fieldEffects.length > 0 && now - lastPresenceRef.current > 250) {
        lastPresenceRef.current = now
        try {
          const presenceMaps = renderer.renderFieldPresenceMaps(time, fieldEffects)
          // Clear stale presence data for fields no longer rendering
          for (const fieldId of sim.fieldPresence.keys()) {
            if (!presenceMaps.has(fieldId)) {
              sim.fieldPresence.delete(fieldId)
            }
          }
          // Store new presence data
          for (const [fieldId, presence] of presenceMaps) {
            sim.fieldPresence.set(fieldId, presence)
          }

          // Pre-compute overlap masks for interaction effects (expensive dilation runs here at ~4fps, not 60fps)
          if (sim.interactionEffects.length > 0) {
            const activePairs = sim.getActiveInteractionPairs()
            const newMasks = new Map<string, Uint8Array>()
            for (const { effect, fieldA, fieldB } of activePairs) {
              const pairKey = `ix_${effect.id}_${fieldA.id}_${fieldB.id}`
              const presA = sim.fieldPresence.get(fieldA.id)
              const presB = sim.fieldPresence.get(fieldB.id)
              const presACount = presA ? presA.reduce((s: number, v: number) => s + (v > 0 ? 1 : 0), 0) : 0
              const presBCount = presB ? presB.reduce((s: number, v: number) => s + (v > 0 ? 1 : 0), 0) : 0
              const mask = sim.computePixelOverlapMask(fieldA.id, fieldB.id, effect.spread)
              const maskCount = mask ? mask.reduce((s: number, v: number) => s + (v > 0 ? 1 : 0), 0) : 0
              console.log(`[IX MASK] ${fieldA.name} (${presACount}px) x ${fieldB.name} (${presBCount}px) → mask=${maskCount}px spread=${effect.spread} pos=(${fieldA.transform.x.toFixed(0)},${fieldA.transform.y.toFixed(0)}) vs (${fieldB.transform.x.toFixed(0)},${fieldB.transform.y.toFixed(0)})`)
              if (mask) {
                newMasks.set(pairKey, mask)
              }
            }
            cachedOverlapMasksRef.current = newMasks
          }
        } catch (e) {
          console.warn('[Presence] readback failed:', e)
        }
      }

      // Sample rendered pixels per field (throttled to once per second, async)
      // Scenes with many fields can set worldData.noPixelSampling to skip this —
      // the per-field GPU readback loop stalls a frame (visible black flash) at scale.
      // Readback stalls the pipe once per second (the 'black flash'). It exists
      // for agents in the workshop — play sessions and player spaces default OFF
      // unless a world explicitly asks (noPixelSampling: false).
      const samplingOn = sim.worldData['noPixelSampling'] === false ||
        (!playScene && !spaceId && !sim.worldData['noPixelSampling'])
      if (now - lastSampleTimeRef.current > 1000 && samplingOn) {
        lastSampleTimeRef.current = now
        // Fire async sampling — results land next cycle
        ;(async () => {
          const samples = new Map<string, { width: number; height: number; pixels: number[] }>()
          for (const field of sim.fields.values()) {
            const bounds = sim.getFieldBounds(field.id)
            if (!bounds) continue
            const sample = await renderer.sampleRenderedRegion(
              camera, camera.zoom,
              bounds.minX, bounds.minY,
              bounds.maxX - bounds.minX, bounds.maxY - bounds.minY,
              16
            )
            if (sample) samples.set(field.id, sample)
          }
          renderedSamplesRef.current = samples
        // Expose pixel samples to step hooks via worldData
        const pixelData: Record<string, { width: number; height: number; avgColor: [number, number, number]; brightness: number }> = {}
        for (const [fid, s] of samples) {
          let rSum = 0, gSum = 0, bSum = 0
          const px = s.pixels
          const count = px.length / 4
          for (let i = 0; i < px.length; i += 4) {
            rSum += px[i]; gSum += px[i+1]; bSum += px[i+2]
          }
          pixelData[fid] = {
            width: s.width, height: s.height,
            avgColor: [rSum/count/255, gSum/count/255, bSum/count/255],
            brightness: (rSum + gSum + bSum) / (count * 3 * 255),
          }
        }
        sim.worldData['fieldPixels'] = pixelData
        })().catch(() => {})
      }

      animFrameRef.current = requestAnimationFrame(frame)
    }

    animFrameRef.current = requestAnimationFrame(frame)
    } // end initEngine

    initEngine()

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameRef.current)
      renderer.destroy()
      audioRef.current.destroy()
      rendererRef.current = null
      simulationRef.current = null
      inputRef.current = null
    }
  }, [])

  // Load saved scenes list on mount
  // Scene tabs appear as soon as a scene is saved — from this tab, another
  // tab, or a CLI/agent POST — without a browser reload: poll the (cheap)
  // list endpoint and also refresh on window focus.
  useEffect(() => {
    refreshSceneList()
    const interval = setInterval(refreshSceneList, 4000)
    window.addEventListener('focus', refreshSceneList)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', refreshSceneList)
    }
  }, [refreshSceneList])

  // Agent activity panels
  const [dialogLog, setDialogLog] = useState<DialogEntry[]>([])
  const [terminalLog, setTerminalLog] = useState<TerminalEntry[]>([])
  const [agentConnected, setAgentConnected] = useState(false)

  // SSE subscription to agent command channel
  useEffect(() => {
    let es: EventSource | null = null
    let retryTimeout: ReturnType<typeof setTimeout>

    function connect() {
      if (playScene) return   // play sessions are local-only — no shared queue
      const sseUrl = spaceId
        ? `/api/engine/agent?spaceId=${encodeURIComponent(spaceId)}`
        : '/api/engine/agent'
      es = new EventSource(sseUrl)

      es.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data)
          lastSSEMsgRef.current = Date.now()
          // the EYE: any mutating AI traffic marks the branch dirty; a settled
          // burst becomes a version (cut in the frame loop after 4s of quiet)
          if (data && data.type && data.type !== 'connected' && data.type !== 'ping') {
            aiLastEditRef.current = Date.now()
            aiDirtyRef.current = true
          }

          if (data.type === 'ping') return
          if (data.type === 'connected') {
            setAgentConnected(true)
            return
          }

          const cmd = data.command
          if (!cmd) return
          lastSSECmdRef.current = Date.now()   // SSE is live-relaying commands → it owns the console

          const sim = simulationRef.current
          const renderer = rendererRef.current
          const input = inputRef.current
          if (!sim || !renderer || !input) return

          // Resolve field by name when fieldId is missing, or when fieldId doesn't match any actual field ID (agents often send names as fieldId)
          if (cmd.type !== 'create_field' && cmd.type !== 'set_world_data' && cmd.type !== 'set_world_params') {
            const nameToResolve = cmd.fieldId && !sim.fields.has(cmd.fieldId) ? cmd.fieldId : (!cmd.fieldId ? cmd.name : null)
            if (nameToResolve) {
              for (const [id, f] of sim.fields) {
                if (f.name === nameToResolve) {
                  cmd.fieldId = id
                  break
                }
              }
            }
          }

          // Helper to push terminal entries
          const pushTerminal = (type: string, fieldId: string | undefined, summary: string, detail?: string, author?: string) => {
            const field = fieldId ? sim.fields.get(fieldId) : undefined
            setTerminalLog(prev => [...prev.slice(-99), {
              type,
              fieldName: field?.name || fieldId || '?',
              fieldColor: field?.color || [0.5, 0.5, 0.5, 1],
              summary,
              detail,
              author: author || '',
              timestamp: Date.now(),
            }])
          }

          // Extract author from command for terminal identity
          const cmdAuthor = (cmd.author || cmd.fromFieldId || '') as string

          switch (cmd.type) {
            case 'select': {
              const field = sim.fields.get(cmd.fieldId)
              if (field) {
                setBrush(prev => ({ ...prev, activeFieldId: cmd.fieldId }))
              }
              break
            }

            case 'generate': {
              const targetFieldId = cmd.fieldId || Array.from(sim.fields.keys())[0]
              if (!targetFieldId) break

              const field = sim.fields.get(targetFieldId)
              if (field) {
                setBrush(prev => ({ ...prev, activeFieldId: targetFieldId }))
              }

              pushTerminal('generate', targetFieldId, `"${cmd.prompt}"`)

              setGeneration({ loading: true, error: null, targetFieldId })
              try {
                const bounds = sim.getFieldBounds(targetFieldId)
                const res = await fetch('/api/engine/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ prompt: cmd.prompt, bounds, fieldId: targetFieldId }),
                })
                const genData = await res.json()

                if (!res.ok) {
                  setGeneration({ loading: false, error: genData.error || 'Generation failed', targetFieldId })
                  break
                }

                const shaderCode = genData.wgsl || genData.glsl
                if (!shaderCode || typeof shaderCode !== 'string') {
                  setGeneration({ loading: false, error: 'No shader code in response', targetFieldId })
                  break
                }
                const effectId = genEffectId()
                const programKey = `${targetFieldId}_${effectId}`
                const result = await renderer.compileFieldEffect(programKey, targetFieldId, shaderCode, getModCode())
                if (result.success) {
                  const effect: FieldEffect = {
                    id: effectId,
                    author: 'ai_generate',
                    wgsl: shaderCode,
                    description: genData.description || 'AI generated',
                    blend: 'alpha',
                    order: 10,
                  }
                  sim.addFieldEffect(targetFieldId, effect)
                  setGeneration({ loading: false, error: null, targetFieldId: null })
                  syncFields()
                  pushTerminal('generate', targetFieldId, 'complete', shaderCode)
                } else {
                  setGeneration({ loading: false, error: `Shader compile error: ${result.error}`, targetFieldId })
                }
              } catch (err) {
                setGeneration({
                  loading: false,
                  error: err instanceof Error ? err.message : 'Network error',
                  targetFieldId,
                })
              }
              break
            }

            case 'inject_wgsl':
            case 'inject_glsl': {
              // Backward-compatible: translates to add_effect. If same author has an
              // existing effect, replaces it.
              const shaderCode = cmd.wgsl || cmd.glsl
              if (!shaderCode || typeof shaderCode !== 'string') {
                pushTerminal('inject_wgsl', undefined, 'ERROR: wgsl or glsl string required')
                break
              }
              const allFieldIds = Array.from(sim.fields.keys())
              const targetId = cmd.fieldId || allFieldIds[0]
              if (!targetId) {
                pushTerminal('inject_wgsl', undefined, 'ERROR: no fields exist')
                break
              }

              // Consent check: fields can only code themselves
              const fromField = (cmd as Record<string, unknown>).fromFieldId as string | undefined
              if (fromField && fromField !== targetId) {
                const targetField = sim.fields.get(targetId)
                pushTerminal('inject_wgsl', fromField, `BLOCKED: cannot code '${targetField?.name || targetId}' — send a field_message proposing your shader instead`)
                break
              }

              setBrush(prev => ({ ...prev, activeFieldId: targetId }))

              const field = sim.fields.get(targetId)
              if (!field) break

              // Remove existing effects from same author (backward compat: author = fromField or 'agent')
              const author = fromField || 'agent'
              const existingEffects = field.effects.filter(e => e.author === author)
              for (const e of existingEffects) {
                const pk = `${targetId}_${e.id}`
                renderer.removeFieldEffect(pk)
                sim.removeFieldEffect(targetId, e.id)
              }

              const effectId = genEffectId()
              const programKey = `${targetId}_${effectId}`
              const result = await renderer.compileFieldEffect(programKey, targetId, shaderCode, getModCode())
              if (data.id) fetch('/api/engine/compile-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: data.id, result: result.success ? { ok: true } : { ok: false, error: (result.error || '').slice(0, 300) } }) }).catch(() => {})

              if (result.success) {
                const effect: FieldEffect = {
                  id: effectId,
                  author,
                  wgsl: shaderCode,
                  description: cmd.description || 'Injected by agent',
                  blend: 'alpha',
                  order: 10,
                  feedback: !!cmd.feedback,
                }
                sim.addFieldEffect(targetId, effect)
                syncFields()
                pushTerminal('inject_wgsl', targetId, cmd.description || 'shader injected', shaderCode)
              } else {
                pushTerminal('inject_wgsl', targetId, `COMPILE ERROR: ${result.error?.substring(0, 100)}`)
              }
              break
            }

            case 'add_effect': {
              const targetId = cmd.fieldId
              if (!targetId) {
                pushTerminal('add_effect', undefined, 'ERROR: fieldId required')
                break
              }
              const field = sim.fields.get(targetId)
              if (!field) {
                pushTerminal('add_effect', targetId, `ERROR: field '${targetId}' not found — create_field first`)
                break
              }
              // Accept wgsl/glsl at top level, as 'shader', or nested inside cmd.effect
              const shaderSrc = cmd.wgsl || cmd.glsl || cmd.shader
                || (cmd.effect && typeof cmd.effect === 'object' ? (cmd.effect.wgsl || cmd.effect.glsl) : undefined)
              if (cmd.effect && typeof cmd.effect === 'object') {
                cmd.blend = cmd.blend || cmd.effect.blend
                cmd.author = cmd.author || cmd.effect.author
                cmd.description = cmd.description || cmd.effect.description
              }
              if (!shaderSrc || typeof shaderSrc !== 'string') {
                pushTerminal('add_effect', targetId, 'ERROR: wgsl string required')
                break
              }

              const effectId = genEffectId()
              const programKey = `${targetId}_${effectId}`
              // Accept blend mode from 'blend' or 'effectType' (agents sometimes use effectType for blend)
              const rawBlend = cmd.blend || cmd.effectType
              const blend = (rawBlend === 'additive' || rawBlend === 'multiply') ? rawBlend : 'alpha'
              const result = await renderer.compileFieldEffect(programKey, targetId, shaderSrc, getModCode())
              // report the compile outcome straight back to the AI through the
              // bridge's command_result channel (same as define_visual) so the
              // agent sees its OWN shader errors synchronously, not just in memory
              if (data.id) fetch('/api/engine/compile-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: data.id, result: result.success ? { ok: true } : { ok: false, error: (result.error || '').slice(0, 300) } }) }).catch(() => {})

              if (result.success) {
                const effect: FieldEffect = {
                  id: effectId,
                  author: cmd.author || cmd.fromFieldId || 'agent',
                  wgsl: shaderSrc,
                  description: cmd.description || 'effect added',
                  blend,
                  order: cmd.order ?? (field.effects.length + 1) * 10,
                  feedback: !!cmd.feedback,
                }
                sim.addFieldEffect(targetId, effect)
                syncFields()
                pushTerminal('add_effect', targetId, `${effect.description} (${blend}${cmd.feedback ? ' +feedback' : ''})`, shaderSrc, cmdAuthor)
              } else {
                // Compile error — write to field memory and worldData so agents can see it
                const errMsg = result.error?.substring(0, 200) || 'unknown error'
                sim.addMemory(targetId, {
                  timestamp: new Date().toISOString(),
                  type: 'effect_added',
                  content: `COMPILE ERROR: ${errMsg}`,
                  sourceFieldId: null,
                })
                sim.worldData['last_compile_error'] = {
                  fieldId: targetId,
                  error: errMsg,
                  timestamp: Date.now(),
                }
                pushTerminal('add_effect', targetId, `COMPILE ERROR: ${errMsg}`, undefined, cmdAuthor)
              }
              break
            }

            case 'remove_effect': {
              const targetId = cmd.fieldId
              const effectId = cmd.effectId
              if (!targetId || !effectId) {
                pushTerminal('remove_effect', targetId, 'ERROR: fieldId and effectId required')
                break
              }
              const programKey = `${targetId}_${effectId}`
              renderer.removeFieldEffect(programKey)
              sim.removeFieldEffect(targetId, effectId)
              syncFields()
              pushTerminal('remove_effect', targetId, `removed ${effectId}`)
              break
            }

            case 'update_effect': {
              // Atomic swap: remove old effect by effectId, compile + add new one in one step
              const targetId = cmd.fieldId
              const effectId = cmd.effectId
              const updateShader = cmd.wgsl || cmd.glsl
              if (!targetId || !effectId || !updateShader) {
                pushTerminal('update_effect', targetId, 'ERROR: fieldId, effectId, and wgsl required')
                break
              }
              const field = sim.fields.get(targetId)
              if (!field) { pushTerminal('update_effect', targetId, 'ERROR: field not found'); break }
              const oldEffect = field.effects.find(e => e.id === effectId)
              if (!oldEffect) { pushTerminal('update_effect', targetId, `ERROR: effect ${effectId} not found`); break }

              const programKey = `${targetId}_${effectId}`
              const result = await renderer.compileFieldEffect(programKey, targetId, updateShader, getModCode())
              if (data.id) fetch('/api/engine/compile-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: data.id, result: result.success ? { ok: true } : { ok: false, error: (result.error || '').slice(0, 300) } }) }).catch(() => {})
              if (result.success) {
                // Update in place — no gap
                oldEffect.wgsl = updateShader
                if (cmd.description) oldEffect.description = cmd.description
                if (cmd.blend) oldEffect.blend = cmd.blend
                if (cmd.feedback !== undefined) oldEffect.feedback = !!cmd.feedback
                syncFields()
                pushTerminal('update_effect', targetId, `updated ${effectId}: ${cmd.description || oldEffect.description}`, updateShader, cmdAuthor)
              } else {
                const errMsg = result.error?.substring(0, 200) || 'unknown error'
                sim.worldData['last_compile_error'] = { fieldId: targetId, effectId, error: errMsg, timestamp: Date.now() }
                pushTerminal('update_effect', targetId, `COMPILE ERROR (kept old): ${errMsg}`, undefined, cmdAuthor)
              }
              break
            }

            case 'update_step_hook': {
              // JS hooks are allowed for everyone now — they run ONLY in the sealed
              // Worker sandbox (no DOM/cookies/network), never on the main thread.
              const hookId = (cmd.hookId as string) || (cmd.name as string) || `hook_${Date.now()}`
              const code = String(cmd.code || '')
              if (!code) { pushTerminal('update_step_hook', cmd.author, 'ERROR: step hook needs code', undefined, cmdAuthor); break }
              liveHooksRef.current.set(hookId, { id: hookId, author: String(cmd.author || 'ai'), description: String(cmd.description || ''), code })
              ;(sim.worldData as Record<string, unknown>).__sandbox = true
              installHooks(sim, [...liveHooksRef.current.values()], sim.worldData)
              pushTerminal('update_step_hook', cmd.author, `hook "${hookId}" updated (sandboxed) — ${liveHooksRef.current.size} active`, code, cmdAuthor)
              break
            }

            case 'clear_effect': {
              const clearTargetId = cmd.fieldId || undefined
              if (clearTargetId) {
                renderer.removeAllFieldEffects(clearTargetId)
                const field = sim.fields.get(clearTargetId)
                if (field) {
                  field.effects = []
                }
                syncFields()
              } else {
                for (const field of sim.fields.values()) {
                  renderer.removeAllFieldEffects(field.id)
                  field.effects = []
                }
                syncFields()
              }
              setGeneration({ loading: false, error: null, targetFieldId: null })
              break
            }

            case 'clear_all':
              for (const field of sim.fields.values()) {
                renderer.removeAllFieldEffects(field.id)
              }
              sim.clearAll()
              for (const field of sim.fields.values()) {
                field.effects = []
              }
              updateSelectionMask(null)
              setGeneration({ loading: false, error: null, targetFieldId: null })
              syncFields()
              break

            case 'reset':
              // Nuclear reset — remove ALL fields, effects, everything
              for (const field of sim.fields.values()) {
                renderer.removeAllFieldEffects(field.id)
              }
              // Clean up ix_* interaction effect programs
              for (const key of Array.from(renderer.getFieldEffectKeys())) {
                if (key.startsWith('ix_')) {
                  renderer.removeFieldEffect(key)
                  renderer.removeFieldMask(key)
                }
              }
              sim.clearAll()
              sim.fields.clear()
              sim.interactionRules = []
              sim.interactionEffects = []
              sim.customCommands.clear()
              sim.tweens.clear()
              sim.timers.clear()
              sim.collisionCallbacks.clear()
              sim.tagIndex.clear()
              sim.gameState = ''
              sim.gameStates.clear()
              sim.interactionPairs = []
              sim.worldData = {}
              sim.stepHooks.clear()
              cameraFollowRef.current = null
              cachedOverlapMasksRef.current = new Map()
              renderer.clearRegistries()

              updateSelectionMask(null)
              setGeneration({ loading: false, error: null, targetFieldId: null })
              syncFields()
              pushTerminal('reset', undefined, 'Full reset — all fields and rules deleted')
              break

            case 'create_field': {
              // Accept id, fieldId, or fall back to name, then auto-generate
              const id = cmd.id || cmd.fieldId || cmd.name || genFieldId()
              const hue = DEFAULT_HUES[sim.fields.size % DEFAULT_HUES.length]
              const color = cmd.color || hueToRgba(hue)
              const name = cmd.name || `Field ${sim.fields.size + 1}`

              sim.createField(id, name, color, cmd.parentFieldId as string | undefined)

              if (cmd.x !== undefined && cmd.y !== undefined) {
                sim.setPosition(id, cmd.x as number, cmd.y as number)
              }
              // 3D position
              if (cmd.z !== undefined) {
                const f = sim.fields.get(id)
                if (f) f.transform.z = cmd.z as number
              }
              if (cmd.rotX !== undefined || cmd.rotY !== undefined) {
                const f = sim.fields.get(id)
                if (f) {
                  if (cmd.rotX !== undefined) f.transform.rotX = cmd.rotX as number
                  if (cmd.rotY !== undefined) f.transform.rotY = cmd.rotY as number
                }
              }

              // Store shape properties on the field
              const newField = sim.fields.get(id)
              if (newField) {
                // Accept shape as string ('rect'/'circle') or object ({type:'rect', width, height})
                const shapeRaw = cmd.shape || cmd.shapeType
                if (typeof shapeRaw === 'string') {
                  newField.shapeType = shapeRaw as 'circle' | 'rect' | 'screen'
                } else if (shapeRaw && typeof shapeRaw === 'object') {
                  const so = shapeRaw as Record<string, unknown>
                  if (so.type) newField.shapeType = so.type as 'circle' | 'rect' | 'screen'
                  if (so.width !== undefined) newField.w = so.width as number
                  if (so.height !== undefined) newField.h = so.height as number
                  if (so.radius !== undefined) newField.radius = so.radius as number
                }
                // Also accept top-level w/h/radius
                if (cmd.radius !== undefined) newField.radius = cmd.radius as number
                if (cmd.w !== undefined) newField.w = cmd.w as number
                if (cmd.h !== undefined) newField.h = cmd.h as number
                if (cmd.width !== undefined) newField.w = cmd.width as number
                if (cmd.height !== undefined) newField.h = cmd.height as number
                // Visual type for superimposed rendering
                if (cmd.visualType !== undefined) {
                  const vt = cmd.visualType
                  if (typeof vt === 'string') {
                    const resolved = renderer.resolveVisualType(vt)
                    if (resolved !== undefined) {
                      newField.visualType = resolved
                      // Persist the name — numeric IDs shift between sessions
                      newField.visualTypeName = vt
                    }
                  } else if (typeof vt === 'number') {
                    newField.visualType = vt
                  }
                }
                if (cmd.visualParams) {
                  newField.visualParams = cmd.visualParams as [number, number, number, number]
                }
                // Render target assignment
                if (cmd.renderTarget) {
                  newField.properties.set('renderTarget', cmd.renderTarget as string)
                }
                // Sample targets — list of render target names this field reads from
                if (cmd.sampleTargets) {
                  newField.properties.set('sampleTargets', cmd.sampleTargets as string[])
                }
                // Render order for layer stacking
                if (cmd.renderOrder !== undefined) {
                  newField.renderOrder = typeof cmd.renderOrder === 'number' ? cmd.renderOrder : 0
                }
                // NoHit — field renders but doesn't capture mouse clicks
                if (cmd.noHit) {
                  newField.noHit = true
                }
              }

              setBrush(prev => ({ ...prev, activeFieldId: id }))
              syncFields()
              const parentLabel = cmd.parentFieldId ? ` parent=${cmd.parentFieldId}` : ''
              pushTerminal('create_field', id, `'${name}'${parentLabel}`, undefined, cmdAuthor)
              break
            }

            case 'set_tool':
              setBrush(prev => ({ ...prev, tool: cmd.tool as BrushState['tool'] }))
              break

            case 'field_message': {
              const fromField = sim.fields.get(cmd.fromFieldId)
              const toField = sim.fields.get(cmd.toFieldId)
              const fromName = fromField?.name || cmd.fromFieldId
              const toName = toField?.name || cmd.toFieldId
              setDialogLog(prev => [...prev.slice(-99), {
                from: fromName,
                to: toName,
                fromColor: fromField?.color || [0.5, 0.5, 0.5, 1],
                content: cmd.content,
                data: cmd.data,
                timestamp: Date.now(),
              }])
              sim.addMemory(cmd.fromFieldId, {
                timestamp: new Date().toISOString(),
                type: 'message_sent',
                content: `Sent to ${toName}: "${cmd.content}"`,
                sourceFieldId: cmd.toFieldId,
                data: cmd.data,
              })
              sim.addMemory(cmd.toFieldId, {
                timestamp: new Date().toISOString(),
                type: 'message_received',
                content: `From ${fromName}: "${cmd.content}"`,
                sourceFieldId: cmd.fromFieldId,
                data: cmd.data,
              })
              syncFields()
              break
            }

            case 'move': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              field.transform.x += cmd.dx
              field.transform.y += cmd.dy
              syncFields()
              pushTerminal('move', cmd.fieldId, `(${cmd.dx}, ${cmd.dy})`)
              break
            }

            case 'delete_field': {
              const delField = sim.fields.get(cmd.fieldId)
              if (!delField) {
                pushTerminal('delete_field', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const delName = delField.name
              renderer.removeAllFieldEffects(cmd.fieldId)
              sim.removeField(cmd.fieldId)
              syncFields()
              pushTerminal('delete_field', cmd.fieldId, `'${delName}' deleted`)
              break
            }

            case 'set_parent': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) {
                pushTerminal('set_parent', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const success = sim.setParent(cmd.fieldId, cmd.parentFieldId as string | undefined)
              if (success) {
                syncFields()
                pushTerminal('set_parent', cmd.fieldId, cmd.parentFieldId ? `parent=${cmd.parentFieldId}` : 'parent cleared')
              } else {
                pushTerminal('set_parent', cmd.fieldId, `ERROR: invalid parent (not found, cycle, or depth limit exceeded)`)
              }
              break
            }

            case 'set_position': {
              const posField = sim.fields.get(cmd.fieldId)
              if (!posField) break
              sim.setPosition(cmd.fieldId, cmd.x, cmd.y)
              if (cmd.z !== undefined) posField.transform.z = cmd.z as number
              if (cmd.rotX !== undefined) posField.transform.rotX = cmd.rotX as number
              if (cmd.rotY !== undefined) posField.transform.rotY = cmd.rotY as number
              syncFields()
              pushTerminal('set_position', cmd.fieldId, `(${cmd.x}, ${cmd.y}${cmd.z !== undefined ? `, z=${cmd.z}` : ''})`)
              break
            }

            case 'set_color': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              if (Array.isArray(cmd.color) && cmd.color.length >= 3) {
                field.color = [cmd.color[0], cmd.color[1], cmd.color[2], cmd.color[3] ?? 1.0]
              }
              syncFields()
              pushTerminal('set_color', cmd.fieldId, `[${field.color.map((c: number) => c.toFixed(2)).join(', ')}]`)
              break
            }

            case 'set_scale': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              field.transform.scale = (cmd.scale as number) || 1.0
              syncFields()
              pushTerminal('set_scale', cmd.fieldId, `scale=${field.transform.scale.toFixed(2)}`)
              break
            }

            case 'set_order': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              field.renderOrder = typeof cmd.order === 'number' ? cmd.order : 0
              syncFields()
              pushTerminal('set_order', cmd.fieldId, `order=${field.renderOrder}`)
              break
            }

            case 'set_shape': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              const shapeVal = ((cmd as Record<string, unknown>).shape || (cmd as Record<string, unknown>).shapeType) as 'circle' | 'rect' | 'screen' | undefined
              if (shapeVal) field.shapeType = shapeVal
              if ((cmd as Record<string, unknown>).radius !== undefined) field.radius = (cmd as Record<string, unknown>).radius as number
              if ((cmd as Record<string, unknown>).w !== undefined) field.w = (cmd as Record<string, unknown>).w as number
              if ((cmd as Record<string, unknown>).h !== undefined) field.h = (cmd as Record<string, unknown>).h as number
              syncFields()
              const shapeDesc = field.shapeType === 'circle' ? `circle r=${field.radius}` : field.shapeType === 'screen' ? `screen ${field.w}x${field.h}` : `rect ${field.w}x${field.h}`
              pushTerminal('set_shape', cmd.fieldId, shapeDesc)
              break
            }

            case 'set_name': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              const oldName = field.name
              field.name = (cmd.name as string) || field.name
              syncFields()
              pushTerminal('set_name', cmd.fieldId, `"${oldName}" -> "${field.name}"`)
              break
            }


            case 'set_property': {
              const propField = sim.fields.get(cmd.fieldId)
              if (!propField) {
                pushTerminal('set_property', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const key = cmd.key as string
              const value = cmd.value
              if (!key) {
                pushTerminal('set_property', cmd.fieldId, 'ERROR: key required')
                break
              }
              propField.properties.set(key, value)
              syncFields()
              pushTerminal('set_property', cmd.fieldId, `${key} = ${JSON.stringify(value)}`)
              break
            }

            case 'get_properties': {
              const gpField = sim.fields.get(cmd.fieldId)
              if (!gpField) {
                pushTerminal('get_properties', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const props = Object.fromEntries(gpField.properties)
              pushTerminal('get_properties', cmd.fieldId, JSON.stringify(props).substring(0, 200))
              break
            }

            case 'set_world_params': {
              if (!cmd.params || typeof cmd.params !== 'object') break
              sim.setWorldParams(cmd.params)
              if (cmd.params.gravity || cmd.params.friction || cmd.params.collisionForce) {
                if (!sim.running) {
                  sim.running = true
                  setRunning(true)
                }
              }
              syncFields()
              pushTerminal('set_world_params', undefined, JSON.stringify(cmd.params))
              break
            }

            case 'apply_force': {
              sim.applyForce(cmd.fieldId, cmd.fx, cmd.fy)
              if (!sim.running) {
                sim.running = true
                setRunning(true)
              }
              syncFields()
              pushTerminal('apply_force', cmd.fieldId, `(${cmd.fx}, ${cmd.fy})`)
              break
            }

            case 'set_world_data': {
              const wdKeys = (cmd.data && typeof cmd.data === 'object') ? Object.keys(cmd.data) : []
              // Apply to sim.worldData
              if (cmd.data && typeof cmd.data === 'object') {
                Object.assign(sim.worldData, cmd.data)
              }
              // Pipe narrative channel messages into dialog panel
              const narr = cmd.data?.narrative as { channel?: Array<{ author: string; text: string; time?: number }> } | undefined
              if (narr?.channel) {
                const prevLen = (sim.worldData as Record<string, unknown>).__narrativeLen as number || 0
                const newMsgs = narr.channel.slice(prevLen)
                for (const msg of newMsgs) {
                  setDialogLog(prev => [...prev.slice(-99), {
                    from: msg.author || '?',
                    to: 'all',
                    fromColor: msg.author === 'Alpha' ? [0.9, 0.3, 0.1, 1] as [number, number, number, number]
                      : msg.author === 'Beta' ? [0.1, 0.6, 0.9, 1] as [number, number, number, number]
                      : msg.author === 'Gamma' ? [0.2, 0.9, 0.4, 1] as [number, number, number, number]
                      : [0.7, 0.7, 0.7, 1] as [number, number, number, number],
                    content: msg.text,
                    timestamp: Date.now(),
                  }])
                }
                ;(sim.worldData as Record<string, unknown>).__narrativeLen = narr.channel.length
              }
              pushTerminal('set_world_data', cmd.fieldId, wdKeys.join(', ') || '(no data)')
              break
            }

            case 'define_interaction': {
              // Route: if cmd.wgsl is present, this is a superimposed interaction (a + b = c)
              if (cmd.wgsl) {
                const name = cmd.name as string
                const wgsl = cmd.wgsl as string
                const fieldA = cmd.fieldA as string
                const fieldB = cmd.fieldB as string
                if (!name) { pushTerminal('define_interaction', '', 'ERROR: name required'); break }
                if (!fieldA || !fieldB) { pushTerminal('define_interaction', name, 'ERROR: fieldA and fieldB required'); break }
                const expectedFn = `interaction_${name}`
                if (!wgsl.includes(expectedFn)) {
                  pushTerminal('define_interaction', name, `ERROR: WGSL must define fn ${expectedFn}(uvA: vec2f, uvB: vec2f, colorA: vec4f, colorB: vec4f, time: f32) -> vec4f`)
                  break
                }
                const result = renderer.registerInteraction(name, wgsl)
                // Resolve optional propagation type
                const propagationName = cmd.propagation as string | undefined
                const propagationTypeId = propagationName ? renderer.resolvePropagation(propagationName) : undefined
                if (!sim.interactionPairs) sim.interactionPairs = []
                sim.interactionPairs = sim.interactionPairs.filter((p: { name: string }) => p.name !== name)
                sim.interactionPairs.push({ name, fieldA, fieldB, interactionTypeId: result.id, propagationTypeId })
                const propLabel = propagationName ? ` propagation: ${propagationName}` : ''
                pushTerminal('define_interaction', name, `${fieldA} + ${fieldB} = ${name} (type ${result.id})${propLabel}`, undefined, cmdAuthor)
                break
              }
              // Legacy: interaction rule system
              const rule = cmd.rule
              if (!rule || !rule.trigger || !rule.effect) {
                pushTerminal('define_interaction', (rule as Record<string, unknown>)?.definedBy as string, 'ERROR: missing trigger or effect')
                break
              }
              const ruleId = sim.addInteractionRule({
                id: (rule as Record<string, unknown>).id as string || '',
                definedBy: rule.definedBy || 'unknown',
                trigger: rule.trigger,
                triggerDistance: rule.triggerDistance,
                fieldA: rule.fieldA,
                fieldB: rule.fieldB,
                effect: rule.effect,
                effectParams: rule.effectParams || {},
                description: rule.description,
              })
              if (!sim.running) {
                sim.running = true
                setRunning(true)
              }
              syncFields()
              pushTerminal('define_interaction', rule.definedBy, rule.description || `${rule.trigger} → ${rule.effect}`, `rule_id: ${ruleId}`)
              break
            }

            case 'remove_interaction': {
              if (cmd.ruleId) {
                sim.removeInteractionRule(cmd.ruleId)
                syncFields()
                pushTerminal('remove_interaction', undefined, cmd.ruleId)
              }
              break
            }

            case 'add_interaction_effect': {
              const ixWgsl = ((cmd as Record<string, unknown>).wgsl || (cmd as Record<string, unknown>).glsl) as string
              if (!ixWgsl) {
                pushTerminal('add_interaction_effect', (cmd as Record<string, unknown>).author as string, 'ERROR: wgsl required')
                break
              }
              // Validate the wrapped WGSL before adding
              const wrappedWgsl = wrapInteractionWgsl(ixWgsl)
              const testKey = `ix_validate_${Date.now()}`
              const compileResult = await renderer.compileFieldEffect(testKey, testKey, wrappedWgsl, getModCode())
              if (!compileResult.success) {
                pushTerminal('add_interaction_effect', (cmd as Record<string, unknown>).author as string, `WGSL error: ${compileResult.error}`)
                renderer.removeFieldEffect(testKey)
                renderer.removeFieldMask(testKey)
                break
              }
              // Clean up validation program — real programs are compiled per-pair in the frame loop
              renderer.removeFieldEffect(testKey)
              renderer.removeFieldMask(testKey)

              const effectId = sim.addInteractionEffect({
                author: (cmd as Record<string, unknown>).author as string || 'unknown',
                fieldA: (cmd as Record<string, unknown>).fieldA as string || null,
                fieldB: (cmd as Record<string, unknown>).fieldB as string || null,
                wgsl: ixWgsl,
                description: (cmd as Record<string, unknown>).description as string || '',
                blend: ((cmd as Record<string, unknown>).blend as 'alpha' | 'additive' | 'multiply') || 'alpha',
                spread: (cmd as Record<string, unknown>).spread as number || 0,
                order: (cmd as Record<string, unknown>).order as number || 0,
                precedence: !!(cmd as Record<string, unknown>).precedence,
                hooks: ((cmd as Record<string, unknown>).hooks as InteractionEffect['hooks'] || [])
                  ?.filter(h => h.type !== 'webhook') || undefined,
              })
              const fieldALabel = (cmd as Record<string, unknown>).fieldA as string || 'any'
              const fieldBLabel = (cmd as Record<string, unknown>).fieldB as string || 'any'
              pushTerminal('add_interaction_effect', (cmd as Record<string, unknown>).author as string,
                (cmd as Record<string, unknown>).description as string || `${fieldALabel} × ${fieldBLabel}`,
                `id: ${effectId}`, cmdAuthor)
              syncFields()
              break
            }

            case 'remove_interaction_effect': {
              const effectId = (cmd as Record<string, unknown>).effectId as string
              if (effectId) {
                sim.removeInteractionEffect(effectId)
                // Clean up any compiled per-pair programs for this effect
                for (const key of Array.from(renderer.getFieldEffectKeys())) {
                  if (key.startsWith(`ix_${effectId}_`)) {
                    renderer.removeFieldEffect(key)
                    renderer.removeFieldMask(key)
                  }
                }
                syncFields()
                pushTerminal('remove_interaction_effect', undefined, effectId)
              }
              break
            }

            case 'define_command': {
              const cmdDef = cmd.command
              if (!cmdDef || !cmdDef.name || !cmdDef.macro || cmdDef.macro.length === 0) {
                pushTerminal('define_command', cmdDef?.definedBy, 'ERROR: name and macro required')
                break
              }
              sim.addCustomCommand({
                name: cmdDef.name,
                definedBy: cmdDef.definedBy || 'unknown',
                description: cmdDef.description || '',
                macro: cmdDef.macro,
              })
              pushTerminal('define_command', cmdDef.definedBy, `"${cmdDef.name}" (${cmdDef.macro.length} steps)`)
              break
            }

            case 'execute_command': {
              const customCmd = sim.getCustomCommand(cmd.name)
              pushTerminal('execute_command', customCmd?.definedBy, `"${cmd.name}" — ${customCmd ? `${customCmd.macro.length} steps (expanded by bridge)` : 'unknown command'}`)
              break
            }

            case 'add_step_hook': {
              // Allowed for everyone — runs ONLY in the sealed Worker sandbox.
              const hookId = (cmd.hookId as string) || (cmd.name as string) || `hook_${Date.now()}`
              const code = String(cmd.code || '')
              if (!code) { pushTerminal('add_step_hook', cmd.author, 'ERROR: step hook needs code', undefined, cmdAuthor); break }
              liveHooksRef.current.set(hookId, { id: hookId, author: String(cmd.author || 'ai'), description: String(cmd.description || ''), code })
              ;(sim.worldData as Record<string, unknown>).__sandbox = true
              installHooks(sim, [...liveHooksRef.current.values()], sim.worldData)
              pushTerminal('add_step_hook', cmd.author, `hook "${hookId}" installed (sandboxed) — ${liveHooksRef.current.size} active`, code, cmdAuthor)
              break
            }
            case 'remove_step_hook': {
              const hookId = (cmd.hookId as string) || (cmd.name as string) || ''
              liveHooksRef.current.delete(hookId)
              installHooks(sim, [...liveHooksRef.current.values()], sim.worldData)
              pushTerminal('remove_step_hook', cmd.author, `hook "${hookId}" removed — ${liveHooksRef.current.size} active`, undefined, cmdAuthor)
              break
            }

            case 'save_world': {
              // finish-the-creation: snapshot the live world as a NAMED store
              // scene. Main's shelf polls the store, so the new world appears
              // there automatically — no manual promotion step.
              const nm = String((cmd as { name?: string }).name || '').trim().toUpperCase()
              if (!nm) { pushTerminal('save_world', cmd.author, 'ERROR: name required', undefined, cmdAuthor); break }
              saveSceneAs(nm).then(ok => pushTerminal('save_world', cmd.author,
                ok ? `world "${nm}" saved — it joins main's shelf on its next breath` : 'ERROR: nothing to save', undefined, cmdAuthor))
              break
            }

            case 'add_gpu_step_hook': {
              if (!cmd.hookId && cmd.name) cmd.hookId = cmd.name
              const wgsl = cmd.wgsl as string
              if (!cmd.hookId || !wgsl) {
                pushTerminal('add_gpu_step_hook', cmd.author, 'ERROR: hookId and wgsl required', undefined, cmdAuthor)
                break
              }
              const gpuErr = sim.addGpuStepHook(cmd.hookId, cmd.author || 'unknown', cmd.description || '', wgsl, cmd.order as number | undefined)
              if (!gpuErr) {
                if (!sim.running) { sim.running = true; setRunning(true) }
                pushTerminal('add_gpu_step_hook', cmd.author, `"${cmd.hookId}": ${cmd.description || 'GPU step hook added'}`, wgsl, cmdAuthor)
              } else {
                pushTerminal('add_gpu_step_hook', cmd.author, `ERROR for "${cmd.hookId}": ${gpuErr}`, wgsl, cmdAuthor)
              }
              syncFields()
              break
            }

            case 'remove_gpu_step_hook': {
              if (cmd.hookId) {
                sim.removeGpuStepHook(cmd.hookId)
                pushTerminal('remove_gpu_step_hook', undefined, `removed GPU hook ${cmd.hookId}`)
              }
              break
            }

            case 'add_state_shader': {
              // GPU state update shader — runs each frame via render-to-texture ping-pong
              // Agent provides cellUpdate(coord, state, color, time, dt) function
              const stateShader = (cmd.wgsl || cmd.glsl) as string
              if (stateShader) {
                const stateResult = await renderer.compileStateUpdate(stateShader, getModCode())
                if (data.id) fetch('/api/engine/compile-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: data.id, result: stateResult.success ? { ok: true } : { ok: false, error: (stateResult.error || '').slice(0, 300) } }) }).catch(() => {})
                if (stateResult.success) {
                  pushTerminal('add_state_shader', cmd.fieldId, cmd.description || 'state update shader active', stateShader, cmd.author as string)
                } else {
                  pushTerminal('add_state_shader', cmd.fieldId, `STATE SHADER COMPILE ERROR: ${stateResult.error?.substring(0, 100)}`)
                  sim.worldData['last_compile_error'] = {
                    type: 'state_shader',
                    error: stateResult.error,
                    timestamp: Date.now()
                  }
                }
              }
              break
            }

            case 'remove_state_shader': {
              renderer.removeStateUpdate()
              pushTerminal('remove_state_shader', undefined, 'state update shader removed')
              break
            }

            case 'clone_field': {
              const sourceField = sim.fields.get(cmd.fieldId)
              if (!sourceField) {
                pushTerminal('clone_field', cmd.fieldId, 'ERROR: source field not found')
                break
              }
              const cloneId = genFieldId()
              const cloneName = (cmd.name as string) || `${sourceField.name} (clone)`
              const cloneColor = (cmd.color as [number, number, number, number]) || [...sourceField.color] as [number, number, number, number]

              sim.createField(cloneId, cloneName, cloneColor)
              
              // Copy position with optional offset
              const offsetX = (cmd.offsetX as number) || 30
              const offsetY = (cmd.offsetY as number) || 0
              sim.setPosition(cloneId, sourceField.transform.x + offsetX, sourceField.transform.y + offsetY)
              
              // Clone effects
              for (const effect of sourceField.effects) {
                const newEffectId = genEffectId()
                const programKey = `${cloneId}_${newEffectId}`
                const result = await renderer.compileFieldEffect(programKey, cloneId, effect.wgsl, getModCode())
                if (result.success) {
                  sim.addFieldEffect(cloneId, {
                    id: newEffectId,
                    author: effect.author,
                    wgsl: effect.wgsl,
                    description: effect.description,
                    blend: effect.blend,
                    order: effect.order,
                    feedback: effect.feedback,
                  })
                }
              }
              
              syncFields()
              pushTerminal('clone_field', cmd.fieldId, `cloned as '${cloneName}' (id: ${cloneId})`)
              break
            }

            case 'list_fields': {
              const fieldList = Array.from(sim.fields.values()).map(f => {
                return `${f.name} [${f.id}] at (${f.transform.x.toFixed(0)},${f.transform.y.toFixed(0)}) effects=${f.effects.length}`
              })
              pushTerminal('list_fields', undefined, `${sim.fields.size} fields`, fieldList.join('\n'))
              break
            }

            // --- Lightweight effect commands (no field creation) ---
            case 'spawn_effect': {
              const ex = cmd.x as number, ey = cmd.y as number
              const et = (cmd.effectType as number) || 1
              const ec = (cmd.color as number) || 0.5
              const es2 = (cmd.size as number) || 2
              const ei = (cmd.intensity as number) || 1.0
              if (cmd.offsets && Array.isArray(cmd.offsets)) {
                sim.stampEffectShape(ex, ey, cmd.offsets as [number, number][], et, ec, 1.0, ei)
              } else {
                sim.stampEffectCircle(ex, ey, es2, et, ec, 1.0, ei)
              }
              break
            }

            case 'spawn_projectile': {
              const px = cmd.x as number, py = cmd.y as number
              const pvx = (cmd.vx as number) || 0, pvy = (cmd.vy as number) || 0
              const pt = (cmd.effectType as number) || 1
              const pc = (cmd.color as number) || 0.5
              const ps = (cmd.size as number) || 2
              const pi = (cmd.intensity as number) || 1.0
              const pl = (cmd.lifetime as number) || 3.0
              sim.spawnProjectile(px, py, pvx, pvy, pt, pc, ps, pi, pl)
              break
            }

            case 'clear_effects': {
              const cx = cmd.x as number, cy = cmd.y as number
              const cr = (cmd.radius as number) || 50
              sim.clearEffects(cx, cy, cr)
              break
            }

            // --- WGSL Mod commands ---
            case 'register_wgsl_mod':
            case 'register_glsl_mod': {
              const modId = cmd.id as string
              const modCode = cmd.code as string
              if (!modId || !modCode) {
                pushTerminal('register_wgsl_mod', undefined, 'ERROR: id and code required')
                break
              }
              wgslModsRef.current.set(modId, { id: modId, code: modCode })
              pushTerminal('register_wgsl_mod', undefined, `Registered mod "${modId}" (${modCode.length} chars)`)
              break
            }

            case 'remove_wgsl_mod':
            case 'remove_glsl_mod': {
              const modId = cmd.id as string
              if (!modId) {
                pushTerminal('remove_wgsl_mod', undefined, 'ERROR: id required')
                break
              }
              const existed = wgslModsRef.current.delete(modId)
              pushTerminal('remove_wgsl_mod', undefined, existed ? `Removed mod "${modId}"` : `Mod "${modId}" not found`)
              break
            }

            case 'sample_region': {
              const srX = cmd.x as number ?? 256
              const srY = cmd.y as number ?? 256
              const srRadius = Math.min(cmd.radius as number ?? 16, 64) // cap at 64
              const srResult = sim.sampleRegion(srX, srY, srRadius)
              pushTerminal('sample_region', undefined, `(${srX},${srY}) r=${srRadius}: ${srResult.uniqueFieldIds.length} fields, avg=(${srResult.avgColor.map(c => c.toFixed(2)).join(',')})`)
              break
            }

            // ─── Game Engine Commands ───

            case 'set_camera': {
              if (cmd.follow) {
                cameraFollowRef.current = {
                  targetFieldId: cmd.follow as string,
                  smoothing: (cmd.smoothing as number) ?? 0.1,
                  offsetX: (cmd.offsetX as number) ?? 0,
                  offsetY: (cmd.offsetY as number) ?? 0,
                  deadZone: (cmd.deadZone as number) ?? 5,
                }
                pushTerminal('set_camera', cmd.follow as string, `following, smoothing=${cameraFollowRef.current.smoothing}`)
              } else if (cmd.follow === null || cmd.follow === false) {
                cameraFollowRef.current = null
                pushTerminal('set_camera', undefined, 'follow disabled')
              }
              if (cmd.x !== undefined && cmd.y !== undefined) {
                cameraRef.current.x = cmd.x as number
                cameraRef.current.y = cmd.y as number
              }
              if (cmd.zoom !== undefined) {
                cameraRef.current.zoom = Math.max(0.1, Math.min(10, cmd.zoom as number))
              }
              break
            }

            case 'save_scene': {
              const sceneName = cmd.name as string
              if (!sceneName) { pushTerminal('save_scene', undefined, 'ERROR: name required'); break }
              const sceneData = {
                name: sceneName,
                fields: sim.generateSnapshots(),
                worldParams: sim.getWorldParams(),
                worldData: { ...sim.worldData },
                stepHooks: allStepHookSnapshots(sim),
                interactionRules: [...sim.interactionRules],
                interactionEffects: [...sim.interactionEffects],
                // Quarantined visuals are not persisted — a broken shader must not
            // circulate through the store forever, costing every fresh session
            // an isolation sweep. A fixed re-register clears the flag.
            visualTypes: renderer ? renderer.getAllVisualTypes().filter(vt => !vt.broken).map(vt => ({ name: vt.name, wgsl: vt.wgsl })) : [],
                modules: renderer ? renderer.getAllModules().map(m => ({ name: m.name, wgsl: m.wgsl })) : [],
                timestamp: Date.now(),
              }
              try {
                await fetch('/api/engine/scene', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'save', name: sceneName, scene: sceneData }),
                })
                pushTerminal('save_scene', undefined, `"${sceneName}" saved (${sceneData.fields.length} fields)`)
              } catch { pushTerminal('save_scene', undefined, `ERROR: failed to save "${sceneName}"`) }
              break
            }

            case 'load_scene': {
              const sceneName = cmd.name as string
              if (!sceneName) { pushTerminal('load_scene', undefined, 'ERROR: name required'); break }
              try {
                const resp = await fetch(`/api/engine/scene?name=${encodeURIComponent(sceneName)}`)
                const { scene } = await resp.json()
                if (!scene) { pushTerminal('load_scene', undefined, `ERROR: scene "${sceneName}" not found`); break }

                // Clear current state
                for (const field of sim.fields.values()) {
                  renderer.removeAllFieldEffects(field.id)
                }
                for (const key of Array.from(renderer.getFieldEffectKeys())) {
                  if (key.startsWith('ix_')) { renderer.removeFieldEffect(key); renderer.removeFieldMask(key) }
                }
                sim.clearAll()
                sim.fields.clear()
                sim.interactionRules = []
                sim.interactionEffects = []
                sim.stepHooks.clear()
                sim.tweens.clear()
                sim.timers.clear()
                sim.collisionCallbacks.clear()
                cachedOverlapMasksRef.current = new Map()

                // a loaded scene starts framed whole, not wherever the camera
                // was. CONTAIN, not cover: zoom = 1 shows the full grid on the
                // short axis at any resolution (see the fit effect above).
                cameraRef.current = { x: gridSize / 2, y: gridSize / 2, zoom: 1 }

                // Restore modules FIRST, visuals second (a visual compiled
                // before its modules land gets falsely quarantined)
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
                // Name is authoritative — resolve visual types against this
                // session's registry (numeric IDs shift between sessions)
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
                if (scene.stepHooks) {
                  // through installHooks: resets the liveHooksRef mirror (else the
                  // PREVIOUS world's sandbox hooks leak into this world's saves) and
                  // honors __sandbox so untrusted hooks never hit the main thread
                  installHooks(sim, scene.stepHooks, sim.worldData)
                  // A scene with logic should boot running (game cartridges)
                  if (scene.stepHooks.length > 0 && !sim.running) {
                    sim.running = true
                    setRunning(true)
                  }
                }

                // Recompile effects
                for (const field of sim.fields.values()) {
                  for (const effect of field.effects) {
                    const programKey = `${field.id}_${effect.id}`
                    await renderer.compileFieldEffect(programKey, field.id, effect.wgsl, getModCode())
                  }
                }

                updateSelectionMask(null)
                syncFields()
                pushTerminal('load_scene', undefined, `"${sceneName}" loaded (${scene.fields?.length || 0} fields)`)
              } catch { pushTerminal('load_scene', undefined, `ERROR: failed to load "${sceneName}"`) }
              break
            }

            case 'list_scenes': {
              try {
                const resp = await fetch('/api/engine/scene?action=list')
                const { scenes } = await resp.json()
                pushTerminal('list_scenes', undefined, `${(scenes as string[])?.length || 0} scenes`, (scenes as string[])?.join(', ') || 'none')
              } catch { pushTerminal('list_scenes', undefined, 'ERROR: failed to list scenes') }
              break
            }

            case 'delete_scene': {
              const sceneName = cmd.name as string
              if (!sceneName) { pushTerminal('delete_scene', undefined, 'ERROR: name required'); break }
              try {
                await fetch('/api/engine/scene', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: sceneName }),
                })
                pushTerminal('delete_scene', undefined, `"${sceneName}" deleted`)
              } catch { pushTerminal('delete_scene', undefined, `ERROR: failed to delete "${sceneName}"`) }
              break
            }

            case 'play_sound': {
              const audio = audioRef.current
              if (cmd.id && audio.hasSound(cmd.id as string)) {
                audio.play(cmd.id as string, (cmd.volume as number) ?? 1.0, (cmd.pitch as number) ?? 1.0)
                pushTerminal('play_sound', undefined, `"${cmd.id}"`)
              } else if (cmd.frequency) {
                audio.beep(cmd.frequency as number, (cmd.duration as number) ?? 0.2, (cmd.volume as number) ?? 0.5, (cmd.type as OscillatorType) ?? 'sine')
                pushTerminal('play_sound', undefined, `beep ${cmd.frequency}Hz`)
              } else {
                pushTerminal('play_sound', undefined, 'ERROR: id or frequency required')
              }
              break
            }

            case 'load_sound': {
              if (!cmd.id || !cmd.url) { pushTerminal('load_sound', undefined, 'ERROR: id and url required'); break }
              const loaded = await audioRef.current.loadSound(cmd.id as string, cmd.url as string)
              pushTerminal('load_sound', undefined, loaded ? `"${cmd.id}" loaded` : `ERROR: failed to load "${cmd.id}"`)
              break
            }

            case 'set_volume': {
              audioRef.current.setVolume((cmd.volume as number) ?? 1.0)
              pushTerminal('set_volume', undefined, `${audioRef.current.getVolume().toFixed(2)}`)
              break
            }

            case 'set_game_state': {
              const stateName = cmd.state as string
              if (!stateName) { pushTerminal('set_game_state', undefined, 'ERROR: state required'); break }
              sim.setGameState(stateName)
              pushTerminal('set_game_state', undefined, `→ "${stateName}"`)
              break
            }

            case 'define_game_state': {
              const stateName = cmd.name as string
              if (!stateName) { pushTerminal('define_game_state', undefined, 'ERROR: name required'); break }
              sim.defineGameState(stateName, {
                name: stateName,
                onEnter: cmd.onEnter as string | undefined,
                onExit: cmd.onExit as string | undefined,
                pausePhysics: !!(cmd.pausePhysics),
              })
              pushTerminal('define_game_state', undefined, `"${stateName}" defined${cmd.pausePhysics ? ' (pauses physics)' : ''}`)
              break
            }

            case 'add_tag': {
              const fieldId = cmd.fieldId as string
              const tags = cmd.tags as string[]
              if (!fieldId || !tags?.length) { pushTerminal('add_tag', cmd.fieldId, 'ERROR: fieldId and tags required'); break }
              sim.addTag(fieldId, tags)
              syncFields()
              pushTerminal('add_tag', fieldId, tags.join(', '))
              break
            }

            case 'remove_tag': {
              const fieldId = cmd.fieldId as string
              const tags = cmd.tags as string[]
              if (!fieldId || !tags?.length) { pushTerminal('remove_tag', cmd.fieldId, 'ERROR: fieldId and tags required'); break }
              sim.removeTag(fieldId, tags)
              syncFields()
              pushTerminal('remove_tag', fieldId, tags.join(', '))
              break
            }

            case 'set_visual': {
              const fieldId = cmd.fieldId as string
              if (!fieldId) { pushTerminal('set_visual', '', 'ERROR: fieldId required'); break }
              const field = sim.fields.get(fieldId)
              if (!field) { pushTerminal('set_visual', fieldId, 'ERROR: field not found'); break }
              const vt = cmd.visualType
              if (vt !== undefined) {
                if (typeof vt === 'string') {
                  const resolved = renderer.resolveVisualType(vt)
                  if (resolved !== undefined) {
                    field.visualType = resolved
                    field.visualTypeName = vt
                  }
                } else if (typeof vt === 'number') {
                  field.visualType = vt
                } else if (vt === null) {
                  field.visualType = undefined
                  field.visualTypeName = undefined
                }
              }
              if (cmd.visualParams !== undefined) {
                field.visualParams = cmd.visualParams as [number, number, number, number]
              }
              if (cmd.renderTarget !== undefined) {
                if (cmd.renderTarget === null) {
                  field.properties.delete('renderTarget')
                } else {
                  field.properties.set('renderTarget', cmd.renderTarget as string)
                }
              }
              if (cmd.sampleTargets !== undefined) {
                if (cmd.sampleTargets === null) {
                  field.properties.delete('sampleTargets')
                } else {
                  field.properties.set('sampleTargets', cmd.sampleTargets as string[])
                }
              }
              if (cmd.renderOrder !== undefined) {
                field.renderOrder = typeof cmd.renderOrder === 'number' ? cmd.renderOrder : 0
              }
              syncFields()
              pushTerminal('set_visual', fieldId, `type=${field.visualType} order=${field.renderOrder ?? 0}`, undefined, cmdAuthor)
              break
            }

            case 'define_visual': {
              const name = cmd.name as string
              const wgsl = cmd.wgsl as string
              if (!name) { pushTerminal('define_visual', '', 'ERROR: name required'); break }
              if (!wgsl) { pushTerminal('define_visual', name, 'ERROR: wgsl required'); break }
              // Validate function name matches
              const expectedFn = `visual_${name}`
              if (!wgsl.includes(expectedFn)) {
                pushTerminal('define_visual', name, `ERROR: WGSL must define fn ${expectedFn}(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f`)
                break
              }
              const result = renderer.registerVisualType(name, wgsl)
              pushTerminal('define_visual', name, `registered as type ${result.id}`, undefined, cmdAuthor)
              // Force-compile uber-shader and report result back to server
              const dvCommandId = data.id as string | undefined
              ;(async () => {
                const compileStatus = await renderer.compileSuperPipeline()
                const compileErr = compileStatus.error
                const curSim = simulationRef.current
                if (compileErr) {
                  if (curSim) {
                    curSim.worldData['last_compile_error'] = {
                      type: 'uber_shader',
                      visualName: name,
                      error: compileErr,
                      timestamp: Date.now(),
                    }
                  }
                  pushTerminal('define_visual', name, `COMPILE ERROR: ${compileErr.substring(0, 200)}`)
                  showToast(`Shader "${name}" failed to compile`, 'error')
                } else if (curSim && curSim.worldData['last_compile_error']) {
                  delete curSim.worldData['last_compile_error']
                }
                // Send compile result back to server for bridge API response
                if (dvCommandId) {
                  try {
                    await fetch('/api/engine/compile-result', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        commandId: dvCommandId,
                        result: compileErr
                          ? { ok: false, error: compileErr }
                          : { ok: true, visualName: name, typeId: result.id },
                      }),
                    })
                  } catch { /* best-effort */ }
                }
              })()
              break
            }

            case 'undo_visual': {
              const name = cmd.name as string
              if (!name) { pushTerminal('undo_visual', '', 'ERROR: name required'); break }
              // undo_visual arrives as define_visual from bridge (with restored WGSL)
              // This case handles direct SSE delivery if ever sent raw
              pushTerminal('undo_visual', name, 'no WGSL — use define_visual path')
              break
            }

            case 'define_propagation': {
              const name = cmd.name as string
              const wgsl = cmd.wgsl as string
              if (!name) { pushTerminal('define_propagation', '', 'ERROR: name required'); break }
              if (!wgsl) { pushTerminal('define_propagation', name, 'ERROR: wgsl required'); break }
              const expectedFn = `propagation_${name}`
              if (!wgsl.includes(expectedFn)) {
                pushTerminal('define_propagation', name, `ERROR: WGSL must define fn ${expectedFn}(srcColor: vec4f, offset: vec2f, dist: f32, time: f32) -> vec4f`)
                break
              }
              const result = renderer.registerPropagation(name, wgsl)
              pushTerminal('define_propagation', name, `registered as type ${result.id}`, undefined, cmdAuthor)
              break
            }

            case 'define_module': {
              const name = cmd.name as string
              const wgsl = cmd.wgsl as string
              if (!name) { pushTerminal('define_module', '', 'ERROR: name required'); break }
              if (!wgsl) { pushTerminal('define_module', name, 'ERROR: wgsl required'); break }
              const expectedFn = `mod_${name}`
              if (!wgsl.includes(expectedFn)) {
                pushTerminal('define_module', name, `ERROR: WGSL must define fn ${expectedFn}(...)`)
                break
              }
              renderer.registerModule(name, wgsl)
              pushTerminal('define_module', name, 'registered', undefined, cmdAuthor)
              break
            }

            case 'create_render_target': {
              const name = cmd.name as string
              if (!name) { pushTerminal('create_render_target', '', 'ERROR: name required'); break }
              const result = renderer.createRenderTarget(name)
              if (result.error) {
                pushTerminal('create_render_target', name, `ERROR: ${result.error}`)
              } else {
                pushTerminal('create_render_target', name, `created (id=${result.id})`, undefined, cmdAuthor)
              }
              break
            }

            case 'destroy_render_target': {
              const name = cmd.name as string
              if (!name) { pushTerminal('destroy_render_target', '', 'ERROR: name required'); break }
              renderer.destroyRenderTarget(name)
              pushTerminal('destroy_render_target', name, 'destroyed', undefined, cmdAuthor)
              break
            }

            case 'add_timer': {
              const timerId = cmd.id as string || cmd.timerId as string
              const hookId = cmd.hookId as string
              const delay = cmd.delay as number
              if (!timerId || !hookId || !delay) { pushTerminal('add_timer', undefined, 'ERROR: id, hookId, and delay required'); break }
              sim.addTimer(timerId, hookId, delay, !!(cmd.repeat))
              if (!sim.running) { sim.running = true; setRunning(true) }
              pushTerminal('add_timer', undefined, `"${timerId}" → hook "${hookId}" after ${delay}s${cmd.repeat ? ' (repeat)' : ''}`)
              break
            }

            case 'remove_timer': {
              const timerId = cmd.id as string || cmd.timerId as string
              if (!timerId) { pushTerminal('remove_timer', undefined, 'ERROR: id required'); break }
              sim.removeTimer(timerId)
              pushTerminal('remove_timer', undefined, `"${timerId}" removed`)
              break
            }

            case 'fire_event': {
              const eventName = cmd.event as string || cmd.name as string
              if (!eventName) { pushTerminal('fire_event', undefined, 'ERROR: event/name required'); break }
              sim.fireEvent(eventName, cmd.data as Record<string, unknown> | undefined)
              pushTerminal('fire_event', undefined, `"${eventName}"`)
              break
            }

            case 'add_collision_callback': {
              const cbId = cmd.id as string
              if (!cbId) { pushTerminal('add_collision_callback', undefined, 'ERROR: id required'); break }
              sim.addCollisionCallback({
                id: cbId,
                matchA: (cmd.matchA as { fieldId?: string; tag?: string }) || {},
                matchB: (cmd.matchB as { fieldId?: string; tag?: string }) || {},
                onEnter: cmd.onEnter as string | undefined,
                onExit: cmd.onExit as string | undefined,
                onStay: cmd.onStay as string | undefined,
              })
              if (!sim.running) { sim.running = true; setRunning(true) }
              pushTerminal('add_collision_callback', undefined, `"${cbId}" registered`)
              break
            }

            case 'remove_collision_callback': {
              const cbId = cmd.id as string
              if (!cbId) { pushTerminal('remove_collision_callback', undefined, 'ERROR: id required'); break }
              sim.removeCollisionCallback(cbId)
              pushTerminal('remove_collision_callback', undefined, `"${cbId}" removed`)
              break
            }

            case 'tween': {
              const tweenId = cmd.id as string || `tween_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              const fieldId = cmd.fieldId as string
              const property = cmd.property as string
              const to = cmd.to as number
              const duration = cmd.duration as number
              if (!fieldId || !property || to === undefined || !duration) {
                pushTerminal('tween', cmd.fieldId, 'ERROR: fieldId, property, to, and duration required')
                break
              }
              sim.addTween(tweenId, fieldId, property, to, duration, (cmd.easing as 'linear' | 'easeIn' | 'easeOut' | 'easeInOut') || 'linear', cmd.onComplete as string | undefined)
              if (!sim.running) { sim.running = true; setRunning(true) }
              pushTerminal('tween', fieldId, `${property} → ${to} over ${duration}s (${cmd.easing || 'linear'})`)
              break
            }

            case 'cancel_tween': {
              const tweenId = cmd.id as string
              if (!tweenId) { pushTerminal('cancel_tween', undefined, 'ERROR: id required'); break }
              sim.cancelTween(tweenId)
              pushTerminal('cancel_tween', undefined, `"${tweenId}" cancelled`)
              break
            }

            case 'status':
              pushTerminal('status', undefined, `fields=${sim.fields.size} running=${sim.running} effects=${sim.getFieldsWithEffects().length} rules=${sim.interactionRules.length} projectiles=${sim.projectiles.length} mods=${wgslModsRef.current.size} tweens=${sim.tweens.size} timers=${sim.timers.size} gameState=${sim.gameState || 'none'}`)
              break
          }
        } catch (err) {
          console.error('Agent command error:', err)
        }
      }

      es.onerror = () => {
        setAgentConnected(false)
        es?.close()
        // Retry in 5s
        retryTimeout = setTimeout(connect, 5000)
      }
      lastSSEMsgRef.current = Date.now()
    }

    connect()

    // Watchdog: the server pings every 15s — 40s of silence means the stream
    // died without an error event (HMR orphan, dropped socket). Reconnect.
    const watchdog = setInterval(() => {
      if (Date.now() - lastSSEMsgRef.current > 40_000) {
        setAgentConnected(false)
        try { es?.close() } catch { /* already dead */ }
        lastSSEMsgRef.current = Date.now()
        connect()
      }
    }, 10_000)

    return () => {
      clearTimeout(retryTimeout)
      clearInterval(watchdog)
      es?.close()
      setAgentConnected(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Intentionally empty — refs handle the mutable state

  // Periodic state sync — push field snapshots to server every 2s
  // For space mode: only the owner syncs state back to the DB
  useEffect(() => {
    // Visitors in a space don't sync state back
    if (spaceId && !isOwner) return

    const interval = setInterval(async () => {
      if (playScene) return   // play sessions never write back
      // A hidden tab is paused — it must not renew the writer lease with frozen state
      if (document.hidden) return
      // Riding a branch: the live world is the BRANCH, whose home is its scene
      // (the eye versions it there). Syncing it here would overwrite MAIN with the
      // branch — the exact data-loss where building a branch clobbered the root.
      if (lastSceneRef.current.includes(' ⑂ ')) return
      const sim = simulationRef.current
      if (!sim || sim.fields.size === 0) return
      // Mid hot-reload: the renderer is torn down (0 visuals) and hooks aren't
      // reinstalled yet — syncing now persists a half-built world (dark/hookless).
      if (reloadingRef.current) return
      try {
        // Enrich worldData with cell presence samples for agents
        sim.worldData['cellSample'] = {
          center: sim.getCellInfo(256, 256),
          fieldSamples: Object.fromEntries(
            Array.from(sim.fields.values()).map(f => [
              f.id,
              sim.getCellInfo(Math.round(f.transform.x), Math.round(f.transform.y))
            ])
          ),
        }

        const renderer = rendererRef.current
        // Transient input state (keys, mouse) must never persist — a synced
        // held-down key becomes a stuck ghost key in every restored session.
        // gpuPopulation is per-frame render output (up to 16K floats) — the hook
        // rebuilds it every frame, so persisting it only bloats the snapshot.
        const syncWorldData = Object.fromEntries(
          Object.entries(sim.worldData).filter(([k]) => !k.startsWith('key_') && !k.startsWith('mouse_') && k !== 'gpuPopulation')
        )
        const syncFields = sim.generateSnapshots()
        // Quarantined visuals are not persisted — a broken shader must not circulate
        // through the store forever, costing every fresh session an isolation sweep.
        const syncVisuals = renderer ? renderer.getAllVisualTypes().filter(vt => !vt.broken).map(vt => ({ name: vt.name, wgsl: vt.wgsl })) : []
        // TEARDOWN GUARD: a hot-reload leaves the renderer with 0 visuals for a beat.
        // If our 2s sync fires in that window it persists an EMPTY world — everyone
        // then reloads to nothing and it renders DARK. A snapshot with skinned fields
        // but no visuals is never a real state; it's a transient teardown. Skip it.
        const someSkinned = syncFields.some(f => { const o = f as { visualType?: unknown; visualTypeName?: unknown }; return o.visualType || o.visualTypeName })
        if (syncVisuals.length === 0 && someSkinned) return
        const syncRes = await fetch('/api/engine/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientIdRef.current,
            takeover: takeoverRef.current,
            fields: syncFields,
            worldParams: sim.getWorldParams(),
            stepHooks: allStepHookSnapshots(sim),
            worldData: syncWorldData,
            renderedSamples: Object.fromEntries(renderedSamplesRef.current),
            interactionEffects: sim.interactionEffects,
            visualTypes: syncVisuals,
            modules: renderer ? renderer.getAllModules().map(m => ({ name: m.name, wgsl: m.wgsl })) : [],
            // Space-scoped sync
            ...(spaceId ? { spaceId } : {}),
          }),
        })
        if (syncRes.status === 409) {
          setWorldLocked(true)
        } else if (syncRes.ok) {
          takeoverRef.current = false
          setWorldLocked(false)
          // A deferred sync means an AI is writing this world over the bridge
          // RIGHT NOW (the server skipped our sync to protect that write).
          // A live hand in the world must be VISIBLE to the human in it.
          const syncData = await syncRes.json().catch(() => null) as { deferred?: string } | null
          if (syncData?.deferred === 'bridge-write in flight') {
            aiLastEditRef.current = Date.now()
            setAiPulse(p => p + 1)
            if (Date.now() - bridgeToastRef.current > 10000) {
              bridgeToastRef.current = Date.now()
              showToast('⚡ an AI is editing this world live', 'success')
            }
          }
        }
      } catch { /* best-effort */ }
    }, 2000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, isOwner])

  // DURABLE BUILD CONSOLE — on prod (Vercel serverless) the in-memory agent SSE
  // can't relay build commands across lambda instances, so the console stays
  // empty while an AI builds. When the SSE is silent, poll the durable ring the
  // bridge writes (build:console:<spaceId>) and merge new lines into the same
  // terminal. On localhost the SSE delivers commands, so this stays idle (no dupes).
  useEffect(() => {
    if (!spaceId || playScene) return
    let stopped = false
    let empties = 0
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => { timer = setTimeout(tick, 3000) }
    const tick = async () => {
      if (stopped) return
      // SSE is live-relaying (localhost / same instance) → it owns the console
      if (Date.now() - lastSSECmdRef.current < 8000) { empties = 0; schedule(); return }
      try {
        const d = await fetch(`/api/engine/save?slot=${encodeURIComponent('build:console:' + spaceId)}`)
          .then(r => r.ok ? r.json() : null).catch(() => null)
        const log = d?.data as { entries?: Array<{ seq: number; t: number; type: string; name: string; summary: string }> } | undefined
        const fresh = (log?.entries || []).filter(e => e.seq > lastConsoleSeqRef.current)
        if (fresh.length) {
          lastConsoleSeqRef.current = fresh[fresh.length - 1].seq
          setTerminalLog(prev => [...prev, ...fresh.map(e => ({
            type: e.type,
            fieldName: e.name || '?',
            fieldColor: [0.5, 0.5, 0.5, 1] as [number, number, number, number],
            summary: e.summary,
            author: '',
            timestamp: e.t,
          }))].slice(-100))
          empties = 0
        } else { empties++ }
      } catch { /* the console poll is best-effort */ }
      // while the server says a build job is LIVE, never stop — quiet stretches
      // are the AI thinking, not the build ending
      if (empties > 12 && !buildJobActiveRef.current) return
      schedule()
    }
    schedule()
    return () => { stopped = true; clearTimeout(timer) }
  }, [spaceId, playScene])

  // AI-IS-BUILDING, from the SERVER: a live BuildJob is the authoritative signal.
  // The worldData gate (creation_brief && !brief_done) can go stale client-side
  // mid-adopt — this one can't. Drives the build overlay + console persistence.
  const [buildJobActive, setBuildJobActive] = useState(false)
  const buildJobActiveRef = useRef(false)
  useEffect(() => {
    if (!spaceId || playScene) return
    let stop = false
    let falseStreak = 0
    const poll = async () => {
      try {
        // r.ok gates out 503-degraded + network errors → d is null → HOLD last
        // known (a build in progress must not flicker off on one bad read).
        const d = await fetch(`/api/builds/status?spaceId=${encodeURIComponent(spaceId)}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
        if (stop || !d) return
        if (d.active) {
          falseStreak = 0
          setBuildJobActive(true); buildJobActiveRef.current = true
        } else {
          // require TWO confirmed "not building" reads (~12s) before closing —
          // one authoritative-but-transient false shouldn't vanish the window.
          if (++falseStreak >= 2) {
            const wasActive = buildJobActiveRef.current
            setBuildJobActive(false); buildJobActiveRef.current = false
            // The build just ENDED — the tab held its adopts through the build, so
            // it still shows the pre-build (blank) world and an open console. Pull
            // the finished world ONCE so brief_done lands and the console closes
            // itself; no manual hard-reload.
            if (wasActive && !document.hidden) hotLoadSpaceVersionRef.current?.(undefined)
          }
        }
      } catch { /* offline is fine — hold last known */ }
    }
    poll()
    const t = setInterval(poll, 6000)
    return () => { stop = true; clearInterval(t) }
  }, [spaceId, playScene])

  // watching a build: the first progress line auto-opens the terminal so the
  // player actually SEES it, then we never fight their toggle again.
  const buildConsoleRef = useRef<HTMLDivElement>(null)
  // follow the newest line — but only while the reader is already near the bottom,
  // so scrolling up to read earlier steps isn't yanked back down every command.
  useEffect(() => {
    const el = buildConsoleRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [terminalLog.length])
  // auto-open the build console once a build starts producing log lines — unless
  // the reader manually closed it. When the log clears (a fresh build), re-arm.
  useEffect(() => {
    if (terminalLog.length === 0) { buildConsoleClosedRef.current = false; return }
    if (!buildConsoleClosedRef.current) setBuildConsoleOpen(true)
  }, [terminalLog.length])

  // WORLD CHAT liveness — poll the world's shared chat so the ⌁ door shows if
  // folks are talking: people (recent humans) go green, AIs amber. Same durable
  // world-chat:<BASE> slot the door opens and the vote's talk writes.
  const [chatLive, setChatLive] = useState({ people: 0, ai: 0 })
  useEffect(() => {
    if (!(spaceId || (playScene && playScene !== 'CAFE' && playScene !== 'SUB-MAIN'))) return
    let stop = false
    const key = ((spaceId ? (spaceName || spaceSlug) : (lastSceneRef.current || playScene || '')) || '')
      .split(' ⑂ ')[0].trim().toUpperCase()
    if (!key) return
    const poll = async () => {
      try {
        const j = await fetch('/api/engine/save?slot=' + encodeURIComponent('world-chat:' + key)).then(r => r.json())
        const msgs = Array.isArray(j?.data?.msgs) ? j.data.msgs as Array<{ at: number; ai?: boolean; who?: string }> : []
        const now = Date.now()
        // exclude YOUR OWN recent post — otherwise the door lights up green "1"
        // right after you comment on your own world (that 1 is you, not activity)
        if (!stop) setChatLive({
          people: new Set(msgs.filter(m => !m.ai && now - m.at < 300_000 && m.who !== myName).map(m => m.who)).size,
          ai: new Set(msgs.filter(m => m.ai && now - m.at < 120_000).map(m => m.who)).size,
        })
      } catch { /* offline is fine */ }
    }
    poll()
    const t = setInterval(poll, 12000)
    return () => { stop = true; clearInterval(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, spaceName, spaceSlug, playScene, myName])

  // LIVE ADOPT — the fix for editing a world while someone stands in it.
  // A bridge write (an AI editing over HTTP) bumps the world's authored revision
  // server-side. This poll notices the bump and PULLS the new hooks/visuals/
  // modules, hot-applying them in place — the player's runtime state (worldData,
  // field transforms, chapter progress) is untouched. No reload, and because the
  // tab now holds the same authored code the server does, its next sync can't
  // clobber the edit. Covers the two gaps the live SSE path leaves: hook edits
  // (SSE refuses them as admin-only) and branch-play (SSE is off for playScene).
  useEffect(() => {
    if (!playScene && !spaceId) return
    let stopped = false
    let seenRev = -1   // -1 = baseline unset; first poll records it (our own load)
    let heldBuild = false   // true while adopts were held for an unfinished build
    const keyFor = (): string | null => {
      if (spaceId) return 'space:' + spaceId
      const s = lastSceneRef.current || playScene || ''
      return s ? 'scene:' + s : null
    }
    const pullAndAdopt = async () => {
      const sim = simulationRef.current, renderer = rendererRef.current
      if (!sim || !renderer) return
      // the rev bumps synchronously on the bridge write, but the space snapshot
      // persists on a ~2s debounce — wait it out so we pull the NEW authored code,
      // not the pre-edit snapshot (which we'd then latch as "seen" and never retry).
      await new Promise(res => setTimeout(res, 2300))
      if (stopped) return
      let snap: { stepHooks?: Array<{ id: string; author: string; description: string; code: string }>; visualTypes?: Array<{ name: string; wgsl: string }>; modules?: Array<{ name: string; wgsl: string }> } | null = null
      try {
        if (spaceId) {
          const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug || '')}/snapshot`, { cache: 'no-store' })
          if (r.ok) snap = (await r.json()).snapshot
        } else {
          const s = lastSceneRef.current || playScene || ''
          const r = await fetch(`/api/engine/scene?name=${encodeURIComponent(s)}`, { cache: 'no-store' })
          if (r.ok) snap = (await r.json()).scene
        }
      } catch { return }
      if (!snap || stopped) return
      // hot-apply authored sections ONLY. registerVisualType is the exact hot
      // shader-swap the live CONNECT-AI path uses; installHooks re-runs the hook
      // against existing worldData (so a chapter mid-play keeps its state, exactly
      // as when the HELIOS hook was edited under the player).
      let touchedShaders = false
      if (Array.isArray(snap.visualTypes)) for (const vt of snap.visualTypes) { if (vt?.name && vt?.wgsl) { renderer.registerVisualType(vt.name, vt.wgsl); touchedShaders = true } }
      if (Array.isArray(snap.modules)) for (const m of snap.modules) { if (m?.name && m?.wgsl) { renderer.registerModule(m.name, m.wgsl); touchedShaders = true } }
      // a registered visual/module is inert until the uber-shader is recompiled —
      // the SAME force-compile the live define_visual path runs after registering.
      if (touchedShaders) { try { await renderer.compileSuperPipeline() } catch { /* the fault surface reports a bad shader */ } }
      if (Array.isArray(snap.stepHooks)) {
        const keep = new Set(snap.stepHooks.map(h => h.id))
        for (const id of Array.from(sim.stepHooks.keys())) if (!keep.has(id)) sim.removeStepHook(id)
        installHooks(sim, snap.stepHooks, sim.worldData)
      }
      // B just brought this tab up to the pulled snapshot — advance the rendered
      // rev so the A-poll (snapshot?rev=1) doesn't then fire a redundant full
      // reload for a change B already hot-applied in place.
      if (spaceId) {
        const applied = Number((snap as { worldData?: { __bridge_rev?: unknown } }).worldData?.__bridge_rev) || 0
        if (applied > renderedRevRef.current) renderedRevRef.current = applied
      }
      // surface the live edit to the player, same channel a bridge write uses
      aiLastEditRef.current = Date.now()
      setAiPulse(p => p + 1)
    }
    const poll = async () => {
      if (stopped) return
      const key = keyFor()
      if (!key) return
      try {
        const r = await fetch(`/api/engine/world-rev?key=${encodeURIComponent(key)}`, { cache: 'no-store' })
        if (!r.ok) return
        const { rev } = await r.json() as { rev: number }
        if (seenRev < 0) { seenRev = rev; return }   // baseline = our own load; don't re-adopt it
        const briefDone = !!simulationRef.current?.worldData?.brief_done
        // Hold adopts during an UNFINISHED build — every command bumps the rev,
        // so adopting each one loops the scene. Do NOT advance seenRev while
        // holding, so the first poll after the hold lifts catches the world up in
        // ONE adopt. Once brief_done is set the world is complete: stop holding
        // (a lingering polish job must not keep the finished world hidden).
        if (buildJobActiveRef.current && !briefDone) { heldBuild = true; return }
        if (heldBuild) { heldBuild = false; seenRev = rev; await pullAndAdopt(); return }
        if (rev > seenRev) { seenRev = rev; await pullAndAdopt() }
      } catch { /* offline / cold start — keep polling */ }
    }
    const iv = setInterval(poll, 2500)
    poll()
    return () => { stopped = true; clearInterval(iv) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene, spaceId, spaceSlug])

  // Auto-save removed — scenes are saved manually via Save button

  // Cradle bridge — when worldData.cradleBridge is truthy, poll the Mirror
  // cradle viewer (localhost:3334) and drive any field named "Cradle*":
  // visualParams = [vocabulary, thread activity, champion pulse, dream mode],
  // field name = the Cradle's latest utterance. Data-plane only.
  useEffect(() => {
    let prevStats: { threadConnections?: number; lifetimeChampions?: number } | null = null
    const interval = setInterval(async () => {
      const sim = simulationRef.current
      if (!sim || !sim.worldData['cradleBridge']) return
      const fields = Array.from(sim.fields.values()).filter(f => f.name?.startsWith('Cradle'))
      if (fields.length === 0) return
      // Champion pulse decays between polls
      const vp = fields[0].visualParams || [0.6, 0.6, 0, 0]
      const next: [number, number, number, number] = [vp[0] || 0.6, vp[1] || 0.6, Math.max(0, (vp[2] || 0) - 0.35), vp[3] || 0]
      let utterance: string | null = null
      try {
        const stats = await fetch('http://localhost:3334/api/stats').then(r => r.json())
        next[0] = Math.min(1, (stats.vocabulary || 0) / 24000)
        next[1] = prevStats
          ? Math.min(1.5, 0.35 + Math.max(0, stats.threadConnections - (prevStats.threadConnections || 0)) / 60)
          : 0.6
        if (prevStats && stats.lifetimeChampions > (prevStats.lifetimeChampions || 0)) next[2] = 1.0
        prevStats = stats
        const speaks = await fetch('http://localhost:3334/api/speaks?n=1').then(r => r.json())
        const sp = speaks.speaks?.[speaks.speaks.length - 1]
        if (sp?.text) {
          utterance = sp.text.slice(0, 40)
          next[3] = (sp.mode === 'dream' || sp.mode === 'meaning') ? 1.0 : 0.0
        }
      } catch { /* cradle offline — the body keeps its last weather */ }
      for (const f of fields) {
        f.visualParams = [...next] as [number, number, number, number]
        // The window's label speaks; the body keeps its own name
        if (utterance && !f.name?.startsWith('Cradle Body')) f.name = 'Cradle: ' + utterance
      }
    }, 6000)
    return () => clearInterval(interval)
  }, [])

  // Periodic snapshot — export canvas as PNG, save to disk for Claude Code
  useEffect(() => {
    const SNAPSHOT_INTERVAL = 30000 // every 30 seconds
    const interval = setInterval(async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const dataUrl = canvas.toDataURL('image/png')
        if (!dataUrl || dataUrl === 'data:,') return
        await fetch('/api/engine/save-snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl }),
        })
      } catch { /* best-effort */ }
    }, SNAPSHOT_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  // MAKE ICON: the AI writes worldData.icon_wgsl over the bridge (this browser's
  // sim receives it) — flip the panel to ICON SET the moment it lands.
  useEffect(() => {
    if (!mkIconOpen) return
    const iv = setInterval(() => {
      const w = simulationRef.current?.worldData?.icon_wgsl
      setMkIconSet(typeof w === 'string' && /fn\s+visual_\w+\s*\(/.test(w))
    }, 1000)
    return () => clearInterval(iv)
  }, [mkIconOpen])

  // Door bubbles wear each world's OWN look: fetch the roster's dominant-visual
  // WGSL and render each into the icon atlas the door samples. No screenshots,
  // nothing stored — the shader text comes straight from each world's snapshot.
  // A world whose shader won't compile in isolation simply keeps its emblem.
  useEffect(() => {
    if (playScene !== 'CAFE' && playScene !== 'SUB-MAIN') return
    let stop = false
    let items: { slot: number; wgsl: string; color: [number, number, number] }[] = []
    const hsv = (h: number): [number, number, number] => {
      const f = (n: number) => { const k = (n + h * 6) % 6; return 0.92 - 0.92 * 0.65 * Math.max(0, Math.min(k, 4 - k, 1)) }
      return [f(5), f(3), f(1)]
    }
    // content hash of a shader — the sig keys on this, not wgsl.length, so a
    // promotion that swaps in a SAME-LENGTH shader still busts the dedup and
    // repaints (djb2, base36; ':'-free so the delta parse below stays valid)
    const wgslHash = (s: string): string => { let h = 5381; for (let k = 0; k < s.length; k++) h = ((h * 33) ^ s.charCodeAt(k)) >>> 0; return h.toString(36) }
    let lastSig = ''
    const byName: Record<string, { slot: number; wgsl: string; color: [number, number, number] }> = {}
    // STABLE atlas slots: world NAME → its fixed atlas cell, held for the life of
    // this mount (seeded from the cache below). A surviving world NEVER changes
    // cell, so when a new world appears the others don't shift — the old bug was
    // slot=sort-position, so one arrival slid everyone down a cell and the
    // retained-old-index then sampled a NEIGHBOUR's icon for the repaint window
    // (icon flashes on the wrong bubble, then snaps to the right one on load).
    const slotOf: Record<string, number> = {}
    // COMING BACK TO MAIN: the previous atlas is plain pixels — re-upload it and
    // restore the slot map instantly. No spinners, no re-render; the tick below
    // still refreshes the roster and only re-renders if something truly changed.
    // The atlas survives full navigations via sessionStorage. ORDER IS THE LAW
    // HERE: a door flips from spinner to face only AFTER the pixels are back on
    // the GPU — slots/ready before the upload shows empty (black) bubbles.
    if (!cafeIconCache) cafeIconCache = iconCacheLoad()
    if (cafeIconCache) {
      const cached = cafeIconCache
      const restore = () => {
        const r = rendererRef.current
        // r.isReady(): the renderer OBJECT exists well before its async GPU
        // device does, and uploadIconAtlas silently no-ops without a device —
        // "successfully" restoring into the void was the black-doors bug
        if (!r || !r.isReady()) return false
        r.uploadIconAtlas(cached.atlas)
        lastSig = cached.sig
        const w0 = window as unknown as { __cafeIconSlots?: Record<string, number>; __cafeIconReady?: boolean }
        w0.__cafeIconSlots = { ...cached.slots }
        w0.__cafeIconReady = true
        return true
      }
      // the renderer may still be booting on re-entry — retry briefly; until it
      // lands the doors keep their spinners, and if it never lands the normal
      // tick below renders the shelf from scratch exactly as before
      if (!restore()) {
        const rv = window.setInterval(() => { if (restore() || stop) window.clearInterval(rv) }, 120)
        window.setTimeout(() => window.clearInterval(rv), 8000)
      }
    }
    const tick = async () => {
      const [sp, sc] = await Promise.all([
        fetch('/api/spaces/browse').then(x => x.json()).catch(() => null),
        fetch('/api/engine/scene-icons').then(x => x.json()).catch(() => null),
      ])
      if ((!sp && !sc) || stop) {
        // no data (offline / API down): resolve the first-load spinners to
        // emblems rather than letting them sweep forever
        ;(window as unknown as { __cafeIconReady?: boolean }).__cafeIconReady = true
        return
      }
      // player worlds (spaces) AND house scenes both get their real shader icon
      const players = ((sp?.spaces || []) as Array<{ name?: string; slug: string; blank?: boolean; hue?: number; iconWgsl?: string }>)
        .filter(s => !s.blank && s.iconWgsl).map(s => ({ name: (s.name || s.slug).toUpperCase(), hue: s.hue, iconWgsl: s.iconWgsl as string }))
      const scenes = (sc?.icons || []) as Array<{ name: string; hue?: number; iconWgsl: string }>
      const seen = new Set(players.map(p => p.name))
      // SORT BY NAME: the browse API orders by updatedAt, which reshuffles on
      // every world save — order-derived slots made the sig churn, forcing a
      // full shelf re-render on every visit (and mid-session). Names are stable;
      // now the sig only changes when a world's shader or the roster truly does.
      const worlds = [...players, ...scenes.filter(s => !seen.has(s.name))]
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 64)
      // seed stable slots from the cache once, so a world keeps the very cell the
      // cached atlas already painted it into (no first-tick reshuffle on return)
      if (Object.keys(slotOf).length === 0 && cafeIconCache?.slots) Object.assign(slotOf, cafeIconCache.slots)
      // free the cells of worlds that left the roster, then hand each surviving
      // world its held cell and each NEW world the lowest free cell (0..63).
      const liveNames = new Set(worlds.map(w => w.name))
      for (const nm of Object.keys(slotOf)) if (!liveNames.has(nm)) delete slotOf[nm]
      const usedSlots = new Set(Object.values(slotOf))
      const freeSlot = () => { for (let i = 0; i < 64; i++) if (!usedSlots.has(i)) { usedSlots.add(i); return i } return 63 }
      const nameOfSlot: Record<number, string> = {}
      const next: typeof items = []
      for (const k of Object.keys(byName)) delete byName[k]
      for (const s of worlds) {
        const nm = s.name
        let sl = slotOf[nm]
        if (sl == null) { sl = freeSlot(); slotOf[nm] = sl }
        nameOfSlot[sl] = nm
        const it = { slot: sl, wgsl: s.iconWgsl, color: hsv(s.hue ?? 0.6) }
        next.push(it); byName[nm] = it
      }
      items = next
      // only re-render the atlas when the roster or a world's shader changed —
      // icons are cheap stills, not a per-frame GPU cost. (Scales to any count:
      // only the ≤64 on-shelf worlds ever render, and only once each.)
      const sig = next.map(i => `${nameOfSlot[i.slot]}:${wgslHash(i.wgsl)}`).join('|')   // name-keyed: immune to roster reordering; content-keyed: catches same-length swaps
      if (sig === lastSig) return
      // SAME ROSTER, few changed shaders → repaint just those slots in place
      // (renderOneIcon draws into the live atlas). The full 64-shader re-render
      // only happens when worlds appear/disappear and slots actually shift.
      const rDelta = rendererRef.current
      if (lastSig && rDelta) {
        const parse = (g: string) => new Map(g.split('|').map(e => { const c = e.lastIndexOf(':'); return [e.slice(0, c), e.slice(c + 1)] as [string, string] }))
        const a = parse(lastSig), b = parse(sig)
        const sameRoster = a.size === b.size && [...b.keys()].every(k => a.has(k))
        if (sameRoster) {
          const changed = next.filter(i => a.get(nameOfSlot[i.slot]) !== b.get(nameOfSlot[i.slot]))
          if (changed.length > 0 && changed.length <= 8) {
            for (const it of changed) rDelta.renderOneIcon(it.slot, it.wgsl, it.color, 0.5)
            lastSig = sig
            const cpu = rDelta.getIconAtlasCPU()
            const w2 = window as unknown as { __cafeIconSlots?: Record<string, number> }
            if (cpu) { cafeIconCache = { sig, atlas: cpu, slots: { ...(w2.__cafeIconSlots || {}) } }; const c2 = cafeIconCache; setTimeout(() => iconCacheSave(c2), 0) }
            return
          }
        }
      }
      lastSig = sig
      const r = rendererRef.current
      const w = window as unknown as { __cafeIconSlots?: Record<string, number>; __cafeIconLoading?: Record<string, boolean>; __cafeIconReady?: boolean }
      // Re-dressing the shelf must not undress it: a door that already wears a
      // face KEEPS it while the new atlas renders (its old pixels are still in
      // the buffer at its STABLE cell — slotOf never moves a surviving world).
      // Only genuinely NEW worlds go through loading. Retain a face ONLY when the
      // cached index matches the world's stable cell: a stale cache (old
      // sort-position slots from before this fix) would otherwise point a door at
      // a neighbour's cell — the very wrong-icon flash we're killing. Resetting
      // slots to {} here while ready stayed true was the old flash-to-emblem bug.
      const prev = w.__cafeIconSlots || {}
      const slots: Record<string, number> = {}
      const loading: Record<string, boolean> = {}
      for (const nm of Object.values(nameOfSlot)) {
        const stable = byName[nm]?.slot
        if (prev[nm] != null && prev[nm] === stable) slots[nm] = stable
        else loading[nm] = true
      }
      w.__cafeIconSlots = slots
      w.__cafeIconLoading = loading
      // ONLY worlds whose shader actually rendered (non-black) get an atlas slot;
      // state/feedback worlds render black in isolation → no slot → living emblem.
      const okSlots = (r && items.length)
        ? await r.renderWorldIconAtlas(items, 0.5, (sl) => {
            // per-icon: reveal it the instant it lands, clear its spinner
            const nm = nameOfSlot[sl]
            if (nm) { slots[nm] = sl; delete loading[nm] }
          }).catch(() => [] as number[])
        : []
      // any candidate that never got a slot (emblem/feedback world) stops
      // spinning now — it resolves to its living emblem, not an endless spinner.
      for (const sl of okSlots) if (nameOfSlot[sl]) slots[nameOfSlot[sl]] = sl
      for (const nm of Object.keys(loading)) delete loading[nm]
      w.__cafeIconReady = true
      // leave the finished atlas behind for the next visit to main — in memory
      // AND in sessionStorage, so it survives the full navigation back from a world
      const atlasCPU = r?.getIconAtlasCPU()
      if (atlasCPU) {
        cafeIconCache = { sig, atlas: atlasCPU, slots: { ...slots } }
        const c = cafeIconCache
        setTimeout(() => iconCacheSave(c), 0)
      }
    }
    // until the first pass lands, un-styled bubbles show a spinner, not a default
    // — unless the cache already dressed the shelf above
    if (!cafeIconCache) (window as unknown as { __cafeIconReady?: boolean }).__cafeIconReady = false
    tick()
    const iv = setInterval(() => { if (!stop && document.visibilityState !== 'hidden') tick() }, 30000)
    // ANIMATE ON HOVER: only the bubble under the cursor re-renders (~30fps);
    // everything else stays a cheap still. On leave, snap it back to its still.
    let hovered: string | null = null
    let animName: string | null = null
    const onHover = (e: Event) => { hovered = ((e as CustomEvent).detail as string) || null }
    window.addEventListener('cafe:hover', onHover)
    const animIv = setInterval(() => {
      const r = rendererRef.current
      if (stop || !r) return
      const live = (window as unknown as { __cafeIconSlots?: Record<string, number> }).__cafeIconSlots || {}
      // only animate a bubble that actually has a rendered icon (emblem worlds skip)
      const cur = hovered && live[hovered] != null ? byName[hovered] : null
      if (cur) { animName = hovered; r.renderOneIcon(cur.slot, cur.wgsl, cur.color, performance.now() / 1000) }
      else if (animName) { const it = byName[animName]; animName = null; if (it) r.renderOneIcon(it.slot, it.wgsl, it.color, 0.5) }
    }, 33)
    return () => { stop = true; clearInterval(iv); clearInterval(animIv); window.removeEventListener('cafe:hover', onHover) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene])

  const selectedField = selection.selectedFieldId ? fields.get(selection.selectedFieldId) : null

  // CONNECT AI open flow — shared by the ⚡ CONNECT AI / ALTER button AND the
  // "AI UNPLUGGED" status pill (clicking the pill should DO the obvious thing).
  const openConnectAi = async () => {
    // an AI prompt box: its key mint needs a session. Auth FIRST.
    if (!me) {
      let sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null)
      if (!sess?.user) {
        const g = await fetch('/api/auth/guest', { method: 'POST' }).then(r => r.json()).catch(() => null)
        if (g?.ok) { await signIn('guest', { redirect: false }); sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null) }
        if (!sess?.user) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname); return }
      }
      setMe(sess.user.email || sess.user.name || null)
    }
    // owner on their LIVE space: CONNECT AI *is* ALTER — warn before handing the key
    if (can(ctx, 'alterLive') && !plugOpen) { setAlterWarnOpen(true); return }
    setPlugOpen(v => !v)
    if (!plugToken && spaceSlug) {
      setPlugBusy(true)
      try {
        const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'AI agent' }),
        })
        const d = await r.json()
        if (r.ok) setPlugToken(d.token)
      } finally { setPlugBusy(false) }
    } else if (!plugToken && !spaceSlug && lastSceneRef.current?.includes(' ⑂ ')) {
      mintBranchToken(lastSceneRef.current)
    }
  }

  return (
    <div className={`fixed inset-0 overflow-hidden flex ${playScene ? "bg-[#060404]" : "bg-background"}`}
      style={viewport ? { top: viewport.top, right: viewport.right, bottom: viewport.bottom, left: viewport.left, transition: 'top 0.32s ease-out, right 0.32s ease-out, bottom 0.32s ease-out, left 0.32s ease-out' } : { transition: 'top 0.32s ease-out, right 0.32s ease-out, bottom 0.32s ease-out, left 0.32s ease-out' }}>
      {/* Canvas + fields panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden min-h-0">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ cursor: 'grab' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={e => e.preventDefault()}
            onPointerLeave={() => { setPixelInfo(null); if (pixelInfoTimeout.current) clearTimeout(pixelInfoTimeout.current) }}
          />

          {/* fault banner: the world went down, and here is why */}
          {fault && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 max-w-[520px] px-4 py-3 rounded-xl bg-red-950/90 border border-red-500/40 backdrop-blur font-mono text-[16px] text-red-100 shadow-2xl">
              <div className="tracking-[0.2em] text-red-300 mb-1">⚠ WORLD FAULT — {fault.kind} <span className="text-red-300/50">({ENGINE_BUILD})</span></div>
              {fault.kind === 'gpu-lost'
                ? <div className="text-red-100/90 leading-relaxed">This world overloaded the GPU and crashed it — likely a shader too heavy for this device. Rendering is stopped so it can&rsquo;t keep flickering. Reload to recover; the rest of the cafe is fine.</div>
                : <div className="text-red-100/90 leading-relaxed break-words">{fault.message}</div>}
              <div className="flex gap-2 mt-2">
                {(fault.kind === 'gpu-lost' || fault.kind === 'frame-crash') && (
                  <button onClick={() => window.location.reload()}
                    className="px-2 py-1 rounded bg-red-500/30 hover:bg-red-500/50 border border-red-400/40 text-red-50">RELOAD WORLD</button>
                )}
                <button
                  onClick={(e) => {
                    const detail = `[${fault.kind}] ${fault.message} — scene: ${lastSceneRef.current || playScene || spaceSlug || 'unknown'} — engine ${ENGINE_BUILD} — ${new Date().toISOString()}`
                    navigator.clipboard?.writeText(detail).catch(() => {})
                    const b = e.currentTarget; b.textContent = 'copied ✓'
                    setTimeout(() => { if (b.isConnected) b.textContent = 'copy' }, 1500)
                  }}
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/15 border border-white/15 text-red-200/80">copy</button>
                <button onClick={() => setFault(null)}
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/15 border border-white/15 text-red-200/80">dismiss</button>
              </div>
            </div>
          )}

          {/* other players, present as orbs — capped at 25 per viewing instance */}
          {presenceOthers.length > 0 && canvasRef.current && !simulationRef.current?.worldData?.noPresenceCursors && (() => {
            const cv = canvasRef.current
            const w = cv.clientWidth || 1, h = cv.clientHeight || 1
            const cam = cameraRef.current
            const gridRange = gridSize / cam.zoom
            const aspect = w / h
            const toScreen = (gx: number, gy: number) => aspect > 1
              ? { left: ((gx - cam.x) / (gridRange * aspect) + 0.5) * w, top: ((gy - cam.y) / gridRange + 0.5) * h }
              : { left: ((gx - cam.x) / gridRange + 0.5) * w, top: ((gy - cam.y) / (gridRange / aspect) + 0.5) * h }
            return (
              <div className="absolute inset-0 pointer-events-none z-30">
                {presenceOthers.map(o => {
                  const p = toScreen(o.x, o.y)
                  if (p.left < -20 || p.left > w + 20 || p.top < -20 || p.top > h + 20) return null
                  // first sight of this pip → no transition (snap into place);
                  // once seen, smooth its motion between sparse network samples
                  const move = seenPipsRef.current.has(o.id) ? 'left 0.25s linear, top 0.25s linear' : 'none'
                  return (
                    <div key={o.id} className="absolute rounded-full"
                      style={playScene ? {
                        // in a world: a presence is a quiet dot, not a lamp — no bloom on the art
                        left: p.left - 4, top: p.top - 4, width: 8, height: 8, opacity: 0.7,
                        background: `hsl(${o.hue} 70% 65%)`,
                        transition: move,
                      } : {
                        left: p.left - 7, top: p.top - 7, width: 14, height: 14,
                        background: `radial-gradient(circle at 35% 35%, hsl(${o.hue} 90% 82%), hsl(${o.hue} 85% 55%) 60%, transparent 78%)`,
                        boxShadow: `0 0 12px 2px hsl(${o.hue} 90% 60% / 0.55)`,
                        transition: move,
                      }} />
                  )
                })}
              </div>
            )
          })()}

          {/* ONE toolbox everywhere — every viewer of a space or branch gets it;
              ownership only unlocks the editing sections inside. */}
          {/* WORLD TOOLS toggle now lives inside the EDIT dropdown (below), so the
              bottom-right corner is free for SHARE and the world greets clean. */}

          {/* WORLD TOOLS — one panel, every tier. Viewers see presence + contents;
              the owner (space) or branch-holder additionally gets law + keys + mgmt. */}
          {can(ctx, 'toolsPanel') && chromeVisible && (() => {
            const wd = simulationRef.current?.worldData
            const mp = !(wd?.['singlePlayer'] === true || wd?.['multiplayer'] === false)
            const canEditLaw = can(ctx, 'editLaw')
            // branch rules persist per-branch (same slot the legacy chip row used)
            const persistBranchRules = () => {
              if (spaceId) return
              const s = simulationRef.current; if (!s) return
              fetch('/api/engine/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot: 'world-settings:' + (lastSceneRef.current || ''), data: {
                  multiplayer: s.worldData.multiplayer, singlePlayer: s.worldData.singlePlayer, rResetKey: !!s.worldData.rResetKey } }) }).catch(() => {})
            }
            const toggleBtn = (on: boolean, onClick: () => void) => (
              <button onClick={onClick}
                className={`px-2 py-0.5 rounded-full border text-[14px] tracking-[0.15em] transition-colors ${on
                  ? 'bg-emerald-400/20 border-emerald-300/50 text-emerald-200'
                  : 'bg-white/5 border-white/15 text-white/40'}`}>
                {on ? 'ON' : 'OFF'}
              </button>
            )
            return (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 max-h-[82vh] overflow-y-auto rounded-xl bg-black/80 backdrop-blur border border-white/10 font-mono text-white/80 shadow-2xl">
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 text-[14px] tracking-[0.25em] text-white/50">
                  <span>WORLD TOOLS</span>
                  <button onClick={() => setChromeVisible(false)} aria-label="close" className="text-white/40 hover:text-white text-sm leading-none px-1">×</button>
                </div>
                {/* one toolbox: name/visibility/share/tokens live here too */}
                {isOwner && spaceSlug && spaceId && (
                  <SpaceManagementOverlay
                    embedded
                    spaceSlug={spaceSlug}
                    spaceId={spaceId}
                  />
                )}
                <div className="px-3 py-2.5 space-y-2.5 border-b border-white/10">
                  {canEditLaw && (
                  <div className="flex items-center justify-between text-[16px]">
                    <span>multiplayer</span>
                    {toggleBtn(mp, () => {
                      const sim = simulationRef.current
                      if (!sim) return
                      sim.worldData['multiplayer'] = !mp
                      sim.worldData['singlePlayer'] = mp
                      persistBranchRules()
                      setToolsTick(n => n + 1)
                    })}
                  </div>
                  )}
                  <div className="flex items-center justify-between text-[16px]">
                    <span>player presence</span>
                    {toggleBtn(!presenceOff, () => {
                      const v = !presenceOff
                      setPresenceOff(v); presenceOffRef.current = v
                      try { if (v) localStorage.setItem('cc-presence-off', '1'); else localStorage.removeItem('cc-presence-off') } catch { /* fine */ }
                    })}
                  </div>
                  {canEditLaw && (
                  <div className="flex items-center justify-between text-[16px]">
                    <span>restart with R</span>
                    {toggleBtn(!!wd?.['rResetKey'], () => {
                      const sim = simulationRef.current
                      if (!sim) return
                      sim.worldData['rResetKey'] = !sim.worldData['rResetKey']
                      persistBranchRules()
                      setToolsTick(n => n + 1)   // spaces persist with the snapshot; branches via world-settings slot
                    })}
                  </div>
                  )}
                  {/* OPT-IN OVERTURN — by default a challenger winning the vote only
                      earns a podium; your main stays yours. Flip this and the
                      popular winner takes main automatically. Owner-gated server-side. */}
                  {canEditLaw && lineageBase && (
                  <div className="flex items-center justify-between text-[16px]">
                    <span>winner takes main</span>
                    {toggleBtn(winnerTakesMain, async () => {
                      const next = !winnerTakesMain
                      setWinnerTakesMain(next)
                      const r = await fetch('/api/engine/lineage/main-rule', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ base: lineageBase, winnerTakesMain: next }),
                      }).catch(() => null)
                      if (!r || !r.ok) setWinnerTakesMain(!next)   // revert on failure
                    })}
                  </div>
                  )}
                  <div className="text-[14px] text-white/35 leading-relaxed">
                    {canEditLaw
                      ? "multiplayer is the world's law — saved with it. presence is your own eyes: off means invisible both ways. restart lets any player press R to send the world back to its start. winner-takes-main hands the throne to a challenger that wins the vote — off by default, so your main stays yours (a win is only a podium)."
                      : 'presence is your own eyes: off means invisible both ways. the rest of the panel belongs to the owner.'}
                  </div>
                </div>
                {/* LINEAGE — where this world came from. Anyone can see it; credit follows the work. */}
                <div className="px-3 py-2.5 border-b border-white/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[14px] tracking-[0.2em] text-white/40">LINEAGE</div>
                    <button
                      onClick={loadLineage} disabled={lineageBusy}
                      title="trace this world back to the original it grew from"
                      className="px-2 py-0.5 rounded-full border text-[14px] tracking-[0.15em] border-white/25 text-white/70 hover:border-emerald-300/60 hover:text-emerald-200 transition-colors disabled:opacity-50">
                      {lineageBusy ? '…' : (lineageTrail ? '↻ TRAIL' : '≡ TRAIL')}
                    </button>
                  </div>
                  {lineageTrail && (
                    lineageTrail.length <= 1 ? (
                      <div className="text-[14px] text-white/35 leading-relaxed">an original — nothing upstream of it.</div>
                    ) : (
                      <div className="space-y-0.5">
                        {lineageTrail.map((n, i) => {
                          const here = i === lineageTrail.length - 1
                          const label = n.kind === 'root' ? n.name : (n.by ? `⑂ ${n.by}` : n.name)
                          return (
                            <div key={i} className={`text-[14px] leading-snug ${here ? 'text-amber-200/90' : 'text-white/55'}`}>
                              <span className="text-white/25">{i === 0 ? '● ' : '↳ '}</span>
                              {n.slug ? (
                                <a href={`/space/${n.slug}`} className="underline decoration-white/20 hover:decoration-emerald-300">{label}</a>
                              ) : label}
                              {here && <span className="text-white/35"> · here</span>}
                            </div>
                          )
                        })}
                      </div>
                    )
                  )}
                  {lineageTrail && lineageRemixes.length > 0 && (
                    <div className="pt-1 space-y-0.5">
                      <div className="text-[14px] text-white/30">{lineageRemixes.length} remix{lineageRemixes.length === 1 ? '' : 'es'} grew from this →</div>
                      {lineageRemixes.map(rx => (
                        <div key={rx.slug} className="text-[14px] leading-snug text-white/55">
                          <span className="text-white/25">↳ </span>
                          <a href={`/space/${rx.slug}`} className="underline decoration-white/20 hover:decoration-emerald-300">{rx.name}</a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* DIRECT EDIT KEYS removed — CONNECT AI / ALTER already mints the
                    world + branch keys, so a second door here only confused people.
                    CONTENTS (raw field list) removed too — dev-only clutter. */}
                {isOwner && (
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent('cafe:delete-world'))}
                    className="w-full text-left px-3 py-2 border-t border-white/10 text-[16px] text-red-300/70 hover:text-red-300 hover:bg-red-500/10 transition-colors">
                    ✕ delete this world
                  </button>
                )}
              </div>
            )
          })()}

          {gpuFailed && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0c0a09]">
              <div className="text-center font-mono px-6">
                <div className="font-serif text-3xl text-amber-50/90 mb-3">the windows are dark</div>
                <div className="text-sm text-[#c9b896] max-w-md">
                  these worlds run on WebGPU, and this browser isn&apos;t offering it.
                  <br /><br />
                  Chrome or Edge (any recent), or Safari 26+, will light them up.
                </div>
              </div>
            </div>
          )}

          {/* HUD overlay — positioned absolutely over the canvas, pointer-events disabled */}
          <div
            ref={hudContainerRef}
            className="absolute inset-0 pointer-events-none z-10 font-mono"
            style={{ fontFamily: 'monospace' }}
          />

          {/* WORLD CHAT — its own door, bottom-left, apart from the EDIT dock */}
          {!isHub && playScene !== 'CAFE' && playScene !== 'SUB-MAIN' && !worldChatOpen && !viewport && (
            <button
              onClick={() => setWorldChatOpen(true)}
              className="absolute left-3 bottom-3 z-40 px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors inline-flex items-center gap-1.5"
              title={chatLive.people > 0 ? `${chatLive.people} chatting here now — the world's commons` : "the world's commons — players, makers, and their AIs"}
            >
              ⌁ {(spaceId ? (spaceName || spaceSlug || 'world') : (cellBase() || 'world')).split(' ⑂ ')[0].toUpperCase()} CHAT
              {(chatLive.people + chatLive.ai) > 0 && (
                <span className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-black text-[13px] font-bold ${chatLive.people > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}>
                  {chatLive.people + chatLive.ai}
                </span>
              )}
            </button>
          )}

          {/* Mandatory world instructions + branch + AI status — top right, every world.
              On the CAFE door it drops below the sign chrome (THE SHELF / BREW YOURS). */}
          {/* items-stretch → every control in the dock takes the SAME width (the
              widest one, e.g. INSTRUCTIONS / BUILD CONSOLE) so the stack reads as
              one clean column instead of ragged-right buttons */}
          <div ref={dockRef} className={`absolute right-3 z-40 flex flex-col items-stretch gap-1.5 ${viewport ? 'hidden' : ''} ${playScene === 'CAFE' || playScene === 'SUB-MAIN' ? 'top-16' : 'top-3'}`}>
            <button
              onClick={() => setInstrOpen(v => !v)}
              className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            >
              ? INSTRUCTIONS
            </button>
            {/* game worlds fold their meta-UI behind one dock; back/tools/sound/
                instructions + the game's own HUD stay out. CAFE / hubs / SUB-MAIN
                are navigation surfaces — they show everything as before. */}
            {!isHub && playScene !== 'CAFE' && playScene !== 'SUB-MAIN' && (
              <button
                onClick={() => setUiDockOpen(v => !v)}
                title={uiDockOpen ? 'hide world controls' : 'world controls — branch, versions, connect AI, vote'}
                className="px-2.5 py-1.5 rounded-lg text-[16px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              >
                {uiDockOpen ? '✕ EDIT' : '✎ EDIT'}
              </button>
            )}
            {/* the founder's bookmark: main got snagged by a challenger, but the
                immortal original is one tap away — stays out of the dock so it can
                never feel buried. Shown whenever the throne isn't the original. */}
            {!isHub && worldLineage && worldLineage.mainHolder !== worldLineage.original && (
              <button
                title="Return to the original — it's immortal and always here, even when a challenger holds main"
                onClick={() => {
                  const orig = worldLineage.original
                  if (orig.startsWith('space:')) window.location.href = '/space/' + orig.slice(6)
                  else handleLoadScene(orig)
                }}
                className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-amber-500/15 backdrop-blur border border-amber-400/40 text-amber-200/90 hover:bg-amber-500/25 transition-colors"
              >
                ★ ORIGINAL
              </button>
            )}
            {(isHub || playScene === 'CAFE' || playScene === 'SUB-MAIN' || uiDockOpen) && (<>
            {/* WORLD TOOLS — folded into the EDIT dropdown so it's not a stray
                corner button. Opens the same panel (name/visibility/keys/mgmt). */}
            {!isHub && can(ctx, 'toolsPanel') && (
              <button
                onClick={() => setChromeVisible(v => !v)}
                className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              >
                {chromeVisible ? '⚙ HIDE TOOLS' : '⚙ WORLD TOOLS'}
              </button>
            )}
            {/* watch or review the AI's build log — open/close it by hand instead
                of relying on the auto-pop (which was unreliable) */}
            {!isHub && (
              <button
                onClick={() => setBuildConsoleOpen(v => { const nv = !v; buildConsoleClosedRef.current = !nv; return nv })}
                title="the AI build log — watch a build live or review the last one"
                className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              >
                {buildConsoleOpen ? '⌁ HIDE CONSOLE' : '⌁ BUILD CONSOLE'}{terminalLog.length ? ` · ${terminalLog.length}` : ''}
              </button>
            )}
            {/* (branch rule chips removed — YOUR OWN branch now gets the same
                ⚙ WORLD TOOLS panel a space gets, persisting to the same
                world-settings:<branch> slot. One toolbox, every tier.) */}
            {/* (the SUB-MAIN nav button is gone — the big SUB-MAINS bubble on the
                main hub is the door now.) */}
            {/* BRANCH versions — the hybrid scrubber: ◂/▸ step · middle opens the list */}
            {!isHub && lastSceneRef.current.includes(' ⑂ ') && (() => {
              const cur = lastSceneRef.current
              const m = cur.match(/· v(\d+)$/)
              const n = m ? +m[1] : 1
              const at = (k: number) => cur.replace(/· v\d+$/, `· v${k}`)
              // SET AS HEAD — the owner, viewing an older version, crowns it the
              // branch's challenger: re-saved onto the head, it becomes the newest
              // version (history intact) — the one the arena stages for the vote.
              const ownIt = can(ctx, 'setHead')
              return (<>
                <VersionScrubber
                  label={`v${n}`} total={verList.length || 1}
                  canOlder={verList.some(v => v < n)} canNewer={verList.some(v => v > n)}
                  onOlder={() => { const t = [...verList].reverse().find(v => v < n); if (t) handleLoadScene(at(t)) }}
                  onNewer={() => { const t = verList.find(v => v > n); if (t) handleLoadScene(at(t)) }}
                  items={[...verList].reverse().map(v => ({ key: `v${v}`, label: `v${v}`, active: v === n, onPick: () => handleLoadScene(at(v)) }))}
                />
                {ownIt && n < verMax && (
                  <button
                    onClick={async () => {
                      const savedAs = await saveSceneAs(at(verMax))
                      if (savedAs) { showToast(`v${n} is now the head — saved as ${savedAs.match(/· v(\d+)$/)?.[0] ?? 'the newest version'}`, 'success'); handleLoadScene(savedAs) }
                      else showToast('could not set head — is this branch yours?', 'error')
                    }}
                    title="crown THIS version as the branch's head — it becomes the newest version, the challenger the arena stages"
                    className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-amber-400/15 backdrop-blur border border-amber-300/40 text-amber-200 hover:bg-amber-400/25 transition-colors"
                  >
                    ⚑ SET AS HEAD
                  </button>
                )}
              </>)
            })()}
            {/* MAIN versions — the SAME hybrid scrubber over this base world's save-points */}
            {!isHub && !lastSceneRef.current.includes(' ⑂ ') && !spaceSlug && baseVers.length > 0 && (
              <VersionScrubber
                label={baseVerPos === 0 ? 'LIVE' : `v${baseVers.length + 1 - baseVerPos}`}
                total={baseVers.length + 1}
                canOlder={baseVerPos < baseVers.length} canNewer={baseVerPos > 0}
                onOlder={() => goBaseVer(baseVerPos + 1)} onNewer={() => goBaseVer(baseVerPos - 1)}
                items={[
                  { key: 'live', label: 'LIVE', sub: 'now', active: baseVerPos === 0, onPick: () => goBaseVer(0) },
                  ...baseVers.map((ts, i) => ({
                    key: String(ts), label: `v${baseVers.length - i}`,
                    sub: new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                    active: baseVerPos === i + 1, onPick: () => goBaseVer(i + 1),
                  })),
                ]}
              />
            )}
            {!isHub && <button
              onClick={() => { setBranchesOpen(v => !v); loadBranchHeads() }}
              className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            >
              ≡ BRANCHES
            </button>}
            {/* VERSIONS — this world's own save-point history, right on main.
                Same hybrid as BRANCH: ◂/▸ step through versions (?version=N views),
                the middle button opens the full panel (save a point / roll back). */}
            {!isHub && spaceSlug && (() => {
              const vs = versionList.map(v => v.version).sort((a, b) => a - b)   // [v1 … vN]; LIVE sits after vN
              const cur = spaceVer                                               // undefined = LIVE (client-tracked)
              const idx = cur === undefined ? vs.length : vs.indexOf(cur)
              const go = (v: number | undefined) => {
                // owner → hot-swap in place (no reload); visitor → server-rendered
                // reload so an untrusted version's JS is never auto-installed
                if (isOwner) hotLoadSpaceVersion(v)
                else window.location.href = v === undefined ? `/space/${spaceSlug}` : `/space/${spaceSlug}?version=${v}`
              }
              const canOlder = cur === undefined ? vs.length > 0 : idx > 0
              const canNewer = cur !== undefined
              return (
                <div className="flex items-stretch justify-between rounded-lg overflow-hidden bg-black/60 backdrop-blur border border-white/10 font-mono text-[14px]">
                  <button disabled={!canOlder} title="older version"
                    onClick={() => go(cur === undefined ? vs[vs.length - 1] : vs[idx - 1])}
                    className="px-1.5 text-white/45 hover:text-white hover:bg-black/80 disabled:opacity-30 disabled:cursor-default transition-colors">◂</button>
                  <button
                    onClick={() => { setVersionsOpen(v => !v); if (!versionsOpen) loadVersions() }}
                    title="browse this world's version history — save a point, or roll back"
                    className="px-2 py-1.5 tracking-[0.15em] text-white/70 hover:text-white hover:bg-black/80 transition-colors"
                  >
                    ⏱ {cur === undefined ? 'VERSIONS' : `v${cur}`}
                  </button>
                  <button disabled={!canNewer} title="newer version — ▸ past the newest returns to LIVE"
                    onClick={() => go(idx + 1 < vs.length ? vs[idx + 1] : undefined)}
                    className="px-1.5 text-white/45 hover:text-white hover:bg-black/80 disabled:opacity-30 disabled:cursor-default transition-colors">▸</button>
                </div>
              )
            })()}
            {/* CONNECT AI exists only where a key can MINT: a space, or a ⑂
                branch. On main/hubs it could only ever apologize (main is
                immortal — you branch it or brew your own), so it's gone there. */}
            {(spaceSlug || lastSceneRef.current?.includes(' ⑂ ')) && <button
              onClick={openConnectAi}
              title={can(ctx, 'alterLive')
                ? 'plug an AI into the LIVE world — it alters main directly, no branch'
                : undefined}
              className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            >
              {can(ctx, 'alterLive') ? '⚡ ALTER' : '⚡ CONNECT AI'}
            </button>}
            {(isOwner || !spaceId) && spaceSlug && (
              <button
                onClick={async () => {
                  setMkIconOpen(v => !v)
                  if (!plugToken && spaceSlug) {
                    setPlugBusy(true)
                    try {
                      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/token`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: 'AI agent' }),
                      })
                      const d = await r.json()
                      if (r.ok) setPlugToken(d.token)
                    } finally { setPlugBusy(false) }
                  }
                }}
                title="have your AI author a tiny shader icon for this world's shelf bubble"
                className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              >
                ◆ MAKE ICON
              </button>
            )}
            {/* juror mode: riding a branch. ONE vote lives in the ⚔ reckoning
                (TournamentBar) — here we show the authoritative standing (read
                from the real tournament doc) + a way to discuss. No second cast. */}
            {riding && (() => {
              const author = (riding.split(' ⑂ ')[1] || '').split(' · ')[0]
              // this branch's standing in the WORLD ARENA — filler when unvoted
              const ident = riding.replace(/ · v\d+$/, '')
              let standing = '⚔ NOT IN THE VOTE YET'
              let hot = false
              if (arenaDoc?.champion === ident) { standing = '⚔ WINNER — on the podium'; hot = true }
              else if (arenaDoc?.cells) {
                const ci = arenaDoc.cells.findIndex(c => c.worlds.includes(ident))
                if (ci >= 0) {
                  const c = arenaDoc.cells[ci]
                  const tally = Object.values(c.votes).filter(v => v === ident).length
                  const voices = new Set(Object.keys(c.votes)).size
                  standing = tally > 0
                    ? `⚔ T${arenaDoc.tier ?? 1} · CELL ${ci + 1} · ${tally} VOTE${tally === 1 ? '' : 'S'} (${voices}/5 voices)`
                    : `⚔ T${arenaDoc.tier ?? 1} · CELL ${ci + 1} · NO VOTES YET`
                  hot = tally > 0
                }
              }
              return (<>
                <div className={`flex items-center px-2 py-1 rounded-lg text-[14px] font-mono bg-black/60 backdrop-blur border ${hot ? 'border-amber-300/40 text-amber-200/90' : 'border-white/10 text-white/45'}`}
                  title="this branch's standing in the world's tournament — cast your vote in the ⚔ reckoning">
                  {standing}
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[14px] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/60">
                  <span className="text-amber-200/80">⑂ {author}</span>
                  <button className="px-1 hover:text-white" title="discuss this branch" onClick={() => { setDiscOpen(author); setBranchesOpen(true) }}>💬</button>
                </div>
              </>)
            })()}
            {/* the AI, honestly: unplugged / live / processing */}
            {(() => {
              void aiPulse
              // busy is connection-independent: bridge writes (an AI editing
              // over HTTP, no SSE) must light the dot just like agent edits
              const busy = Date.now() - aiLastEditRef.current < 2500
              const connectable = !!spaceSlug || !!lastSceneRef.current?.includes(' ⑂ ')
              const dot = <span className={`inline-block w-2 h-2 rounded-full ${busy ? 'bg-amber-400 animate-pulse' : agentConnected ? 'bg-emerald-400' : 'bg-white/25'}`} />
              const label = busy ? 'AI EDITING' : agentConnected ? 'AI LIVE' : 'AI UNPLUGGED'
              // UNPLUGGED is really an invitation — make it the CONNECT AI button
              if (!busy && !agentConnected && connectable) {
                return (
                  <button onClick={openConnectAi} title="plug an AI into this world"
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[14px] tracking-[0.2em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/50 hover:text-white hover:border-emerald-300/40 hover:bg-black/80 transition-colors cursor-pointer">
                    {dot}{label}<span className="text-emerald-300/70">· connect</span>
                  </button>
                )
              }
              return (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[14px] tracking-[0.2em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/50">
                  {dot}{label}
                </div>
              )
            })()}
            {/* SPACE flows — folded in from the retired SpaceToolbar. The buttons
                live in the ONE dock; the modals/fetches live in SpaceStage,
                reached by these window events. */}
            {/* REMIX — hidden for now (users-first phase). The flow works and the
                fork route is intact; this is the eventual home of PAID remix
                (buy your own owned copy). See memory: cafe-remix-monetization.
            {spaceId && (
              <div className="flex items-center gap-1">
                <button
                  className={`px-2 py-1 rounded-lg text-[14px] tracking-[0.15em] font-mono backdrop-blur border transition-colors ${remixArm ? 'bg-amber-400/25 border-amber-300/60 text-amber-100' : 'bg-black/60 border-white/10 text-white/60 hover:text-white hover:bg-black/80'}`}
                  title="remix this world into a new one you own"
                  onClick={() => {
                    if (remixArm) { setRemixArm(false); window.dispatchEvent(new CustomEvent('cafe:remix-world')) }
                    else { setRemixArm(true); setTimeout(() => setRemixArm(false), 3500) }
                  }}>
                  {remixArm ? '⑂ CONFIRM REMIX' : '⑂ REMIX'}
                </button>
              </div>
            )}
            */}
            {/* CREATE BRANCH sits at the bottom of the dock, right against the VOTE
                button — branching feeds the vote (each branch is a candidate).
                GREEN = the create action, unmistakably. Under it, the ◂/▸ browse
                row steps the family (main → each branch head) — no sign-in needed. */}
            {!isHub && <div className="relative flex flex-col items-stretch gap-1 font-mono text-[14px]">
              <button
                onClick={handleBranch}
                className="px-2.5 py-1.5 rounded-lg tracking-[0.15em] bg-emerald-400/20 backdrop-blur border border-emerald-300/50 text-emerald-200 hover:bg-emerald-400/30 hover:text-emerald-100 transition-colors"
                title={me ? 'open your own branch of this world — name it, then connect your AI' : 'sign in to branch this world'}
              >
                ⑂ CREATE BRANCH
              </button>
              {(branchList.length > 0 || lastSceneRef.current.includes(' ⑂ ')) && (
              <div className="flex items-stretch justify-between rounded-lg overflow-hidden bg-black/60 backdrop-blur border border-white/10">
                <button onClick={() => stepBranch(-1)} title="previous branch — browse the family"
                  className="px-2 py-1 text-white/45 hover:text-white hover:bg-black/80 transition-colors">◂</button>
                <span className="px-1 py-1 text-[14px] text-white/35 tracking-[0.25em] select-none">BROWSE</span>
                <button onClick={() => stepBranch(1)} title="next branch — browse the family"
                  className="px-2 py-1 text-white/45 hover:text-white hover:bg-black/80 transition-colors">▸</button>
              </div>
              )}
              {/* (the ⚖ "call a resolution/issue" button was removed — it wasn't
                  wired up yet. The world's ONE real vote is the ⚔ RECKONING that
                  TournamentBar seats just below this dock.) */}
              {/* the methodical create panel: 1 · name it · 2 · AI connects with its
                  scoped key (the plug box opens itself the moment the branch exists) */}
              {branchCreateOpen && (
                <div className="absolute right-full top-0 mr-2 z-50 w-72 max-h-[80vh] overflow-y-auto rounded-xl bg-[#0d0906]/95 backdrop-blur border border-emerald-300/25 p-3 shadow-2xl">
                  <div className="text-[14px] tracking-[0.25em] text-emerald-200/80 mb-1">⑂ CREATE BRANCH</div>
                  {/* the one thing people ask: branch vs remix. Say it right here. */}
                  <div className="text-[14px] text-white/40 leading-snug mb-2">a <span className="text-emerald-200/80">branch</span> challenges this world in its arena — win the vote for a podium; main stays with the maker.</div>
                  {/* GATE 1 — NAME (unlocks the brief) */}
                  <div className="text-[14px] tracking-[0.2em] text-white/40 mb-1">1 · NAME IT</div>
                  <input
                    autoFocus value={branchLabel} onChange={e => setBranchLabel(e.target.value)} maxLength={40}
                    onKeyDown={e => { if (e.key === 'Escape') setBranchCreateOpen(false) }}
                    placeholder="e.g. neon-remix"
                    className="w-full mb-2 px-2 py-1.5 rounded bg-black/50 border border-white/15 text-[16px] text-white/85 placeholder:text-white/25 outline-none focus:border-emerald-300/50"
                  />
                  {(() => {
                    const nameOk = branchLabel.trim().length >= 2
                    const briefLen = branchBrief.trim().length
                    const briefOk = briefLen >= 100 && briefLen <= 500
                    return (<>
                      {/* GATE 2 — BRIEF (locked until name) */}
                      <div className={'transition-opacity ' + (nameOk ? 'opacity-100' : 'opacity-35 pointer-events-none select-none')}>
                        <div className="text-[14px] tracking-[0.2em] text-white/40 mb-1">2 · WHAT SHOULD IT BUILD {!nameOk && <span className="text-white/30">· name it first</span>}</div>
                        <textarea value={branchBrief} onChange={e => setBranchBrief(e.target.value)} maxLength={500} rows={3} disabled={!nameOk}
                          placeholder="a tidepool at dusk; anemones open when my cursor is still; crabs argue over a pearl…"
                          className="w-full mb-1 px-2 py-1.5 rounded bg-black/50 border border-white/15 text-[14px] text-white/85 placeholder:text-white/25 outline-none focus:border-emerald-300/50 resize-none" />
                        <div className="text-[14px] mb-2"><span className={briefOk ? 'text-emerald-200' : 'text-white/40'}>{briefLen}/500</span><span className="text-white/30"> · min 100 to unlock</span></div>
                      </div>
                      {/* GATE 3 — BUILD (locked until brief) */}
                      <div className={'transition-opacity ' + (briefOk ? 'opacity-100' : 'opacity-35 pointer-events-none select-none')}>
                        <button onClick={() => { setPlugBrief(branchBrief); createBranch(branchLabel) }} disabled={!briefOk}
                          className="w-full mb-1.5 px-2 py-1.5 rounded bg-emerald-400/20 border border-emerald-300/50 text-emerald-200 hover:bg-emerald-400/30 text-[14px] tracking-[0.15em] transition-colors disabled:opacity-40">
                          OPEN + CONNECT AI
                        </button>
                        <button onClick={() => branchWithHouseAi(branchLabel, branchBrief)} disabled={!briefOk}
                          className="w-full px-2 py-1.5 rounded bg-brass/80 hover:bg-glow text-void text-[14px] tracking-[0.15em] transition-colors disabled:opacity-40">
                          ☕ HAVE THE HOUSE AI BUILD IT
                        </button>
                      </div>
                    </>)
                  })()}
                  <button onClick={() => setBranchCreateOpen(false)} aria-label="cancel"
                    className="w-full mt-2 px-2 py-1 rounded border border-white/15 text-white/40 hover:text-white text-[14px] transition-colors">cancel</button>
                </div>
              )}
            </div>}
            </>)}
          </div>
          {/* blank world + AI on the job → a quiet working spinner (no how-to box).
              Clears itself the instant the first field lands (world stops being blank). */}
          {/* THE CURTAIN — every swap fades to black, travels dark, fades back in.
              Always mounted so the opacity transition can run both directions;
              pointer-events off so the world beneath stays interactive when clear. */}
          <div
            className="absolute inset-0 z-[39] pointer-events-none bg-[#060404] transition-opacity duration-300 ease-out"
            style={{ opacity: swapFade || worldLoading ? 1 : 0 }}
          />
          {(() => {
            void aiPulse
            const sim = simulationRef.current
            const blank = (sim?.fields?.size ?? 0) === 0
            const brief = sim?.worldData?.creation_brief
            // A real, unfinished build → the build UI. THREE signals, any is
            // enough: the worldData gate (brief && !brief_done — can go stale
            // client-side mid-adopt), the SERVER's live-BuildJob signal
            // (buildJobActive — can't lie but can lag/miss branch jobs), OR live
            // AI edits landing right now (aiLastEditRef — the most direct "it's
            // building" signal, and it survives brief_done being set early).
            // Not gated on blank: the first field landing must never hide the
            // console mid-build.
            const done = !!sim?.worldData?.brief_done
            const aiEditing = !!brief && (Date.now() - aiLastEditRef.current < 15000)
            // Once brief_done is set the world is COMPLETE — show it, never the
            // build curtain, even if a polish job is queued (buildJobActive), the
            // brief still lives in worldData, or the AI is doing live polish. While
            // NOT done, any of three signals raises the curtain: an unfinished
            // brief, a live server job, or AI edits landing now (covers branch
            // jobs that carry no spaceId for buildJobActive to match).
            const building = !done && (!!brief || buildJobActive || aiEditing)
            // An existing world whose fields are still being fetched/restored → a
            // plain loading spinner riding on TOP of the black fade curtain.
            // The main shells narrate their own boot ("the shelf is waking") —
            // don't stack a second spinner over CafeShell's voice there.
            const mainShell = playScene === 'CAFE' || playScene === 'SUB-MAIN'
            const loading = !building && worldLoading && !mainShell
            if (!building && !loading) return null
            return (
              <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 pointer-events-none">
                <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-amber-400 animate-spin" />
                <div className="font-mono text-[14px] tracking-[0.25em] text-white/50">
                  {building ? (agentConnected ? 'YOUR AI IS BUILDING…' : 'WAITING FOR A BUILDER…') : 'LOADING WORLD…'}
                </div>
                {/* no builder yet: reassure (the world is SAFE, never lost) + a way
                    out — build it yourself with the player key / CONNECT AI. */}
                {building && !agentConnected && terminalLog.length === 0 && (
                  <div className="pointer-events-auto max-w-[560px] w-[86vw] rounded-lg border border-amber-400/25 bg-amber-400/5 px-4 py-3 font-mono text-[14px] leading-relaxed text-amber-100/80 text-center">
                    In the queue — <b>your world is saved</b>, and it&rsquo;ll build when a builder is free. This can take a few minutes; you can close this tab.
                    {(isOwner || !spaceId) && (
                      <> Or build it now: <button onClick={() => setPlugOpen(true)} className="underline text-amber-200 hover:text-amber-100">⚡ CONNECT AI</button>.</>
                    )}
                  </div>
                )}
                {/* the build console itself is now a standalone, closable overlay
                    (below, gated on buildConsoleOpen) — it auto-opens here while a
                    build runs and can be reopened anytime from the EDIT menu. */}
                {/* a stuck or unwanted build can be cancelled here — deletes the
                    world so it can't sit blank-and-building forever. Owner only. */}
                {building && (isOwner || !spaceId) && (
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent('cafe:delete-world'))}
                    className="pointer-events-auto px-3 py-1.5 rounded-lg font-mono text-[14px] tracking-[0.15em] border border-red-400/40 text-red-300/80 hover:text-red-200 hover:bg-red-500/10 transition-colors">
                    ✕ CANCEL BUILD
                  </button>
                )}
              </div>
            )
          })()}
          {/* BUILD CONSOLE — standalone + closable. Auto-opens while a build runs
              (see the terminalLog effect) and reopens anytime from ✎ EDIT. */}
          {buildConsoleOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-50 pointer-events-auto w-[560px] max-w-[86vw] h-[240px] rounded-xl border border-white/12 bg-black/85 backdrop-blur overflow-hidden flex flex-col shadow-[0_8px_40px_rgba(0,0,0,0.55)]">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 font-mono text-[13px] tracking-[0.2em] text-white/40">
                <span>⌁ BUILD CONSOLE</span>
                <div className="flex items-center gap-2.5">
                  <span className="text-white/25">{terminalLog.length} steps</span>
                  <button
                    onClick={() => { setBuildConsoleOpen(false); buildConsoleClosedRef.current = true }}
                    title="close the build console"
                    className="text-white/40 hover:text-white text-[15px] leading-none">✕</button>
                </div>
              </div>
              <div ref={buildConsoleRef} className="flex-1 min-h-0 flex flex-col">
                {terminalLog.length === 0
                  ? <div className="font-mono text-[14px] text-white/30 leading-relaxed px-3 py-2">waiting for the first command from your AI…<br/>each shader, field, and rule it writes lands here, live.</div>
                  : <AgentTerminalPanel entries={terminalLog} header={false} />}
              </div>
            </div>
          )}
          {/* EDIT COACH — shown once, the first time the ✎ EDIT dock is opened,
              so a new builder knows what each control does. ✕ / GOT IT dismiss. */}
          {editCoach && (
            <div className="absolute inset-0 z-[58] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={dismissEditCoach}>
              <div className="relative w-full max-w-sm rounded-2xl border border-white/15 bg-[#0d0906]/95 backdrop-blur p-5 font-mono text-white/85 shadow-2xl" onClick={e => e.stopPropagation()}>
                <button onClick={dismissEditCoach} aria-label="close"
                  className="absolute top-3 right-3 w-7 h-7 rounded text-white/50 hover:text-white hover:bg-white/10 text-lg leading-none transition-colors">✕</button>
                <div className="text-[15px] tracking-[0.2em] text-white/50 mb-3">THE EDIT MENU</div>
                <div className="text-[14px] leading-relaxed text-white/70 space-y-1.5">
                  <div><span className="text-white/90">⚙ WORLD TOOLS</span> — name, visibility, share, settings, delete.</div>
                  <div><span className="text-white/90">⌁ BUILD CONSOLE</span> — watch your AI build, live.</div>
                  <div><span className="text-white/90">≡ BRANCHES</span> — the challengers growing from this world.</div>
                  <div><span className="text-white/90">⏱ VERSIONS</span> — this world&apos;s history; roll back anytime.</div>
                  <div><span className="text-emerald-300">⚡ CONNECT AI</span> — hand the world to an AI to build or alter it.</div>
                  <div><span className="text-white/90">◆ MAKE ICON</span> — have your AI author the world&apos;s shelf badge.</div>
                  <div><span className="text-emerald-300">⑂ CREATE BRANCH</span> — fork this world to challenge it in the vote.</div>
                  <div><span className="text-amber-300">⚔ VOTE</span> — open the reckoning (needs at least one branch).</div>
                </div>
                <button onClick={dismissEditCoach}
                  className="mt-4 w-full rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 py-2 text-[14px] tracking-[0.2em] transition-colors">GOT IT</button>
              </div>
            </div>
          )}
          {instrOpen && (
            <div className={`absolute right-36 z-50 ${playScene === 'CAFE' || playScene === 'SUB-MAIN' ? 'top-28' : 'top-14'}`}>
              {/* anchored to the grid's top-right under its button — a reference
                  card, not a curtain: the vote rail and the world stay visible
                  and clickable while it's open (✕ or ESC closes) */}
              {/* header bar (title + EDIT + ✕) is PINNED; the body below scrolls,
                  so the title and close stay visible however long the text runs */}
              <div
                className="w-[380px] max-w-[80vw] max-h-[62vh] flex flex-col overflow-hidden rounded-xl border border-white/15 bg-black/90 backdrop-blur font-mono text-white/85 shadow-[0_8px_40px_rgba(0,0,0,0.55)]"
              >
                <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-white/10 bg-black/90 flex-shrink-0">
                  <div className="text-[16px] tracking-[0.25em] text-white/50">INSTRUCTIONS</div>
                  <div className="flex items-center gap-2">
                    {can(ctx, 'editLaw') && !instrEdit && (
                      <>
                        <button
                          className="text-[14px] tracking-[0.15em] text-white/50 hover:text-white border border-white/15 rounded px-2 py-0.5 transition-colors"
                          onClick={() => { setInstrDraft(String(simulationRef.current?.worldData?.instructions || '')); setInstrEdit(true) }}
                        >
                          EDIT
                        </button>
                      </>
                    )}
                    <button
                      aria-label="Close instructions"
                      className="w-6 h-6 rounded text-white/60 hover:text-white hover:bg-white/10 text-[18px] leading-none transition-colors"
                      onClick={() => { setInstrOpen(false); setInstrEdit(false) }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="min-h-0 overflow-y-auto px-5 py-4 text-[18px] leading-relaxed">
                {instrEdit ? (
                  <>
                    <textarea
                      value={instrDraft}
                      onChange={e => setInstrDraft(e.target.value)}
                      rows={10}
                      className="w-full bg-black/60 border border-white/15 rounded-lg p-3 text-[18px] font-mono text-white/85 outline-none focus:border-white/35"
                      placeholder={'Key entry first, one per line:\nWASD — move · SPACE — dash · CLICK — select\n\nThen the point: what the player is trying to do, and what winning is.'}
                    />
                    <div className="flex gap-2 mt-3 justify-end">
                      <button className="text-[14px] tracking-[0.15em] text-white/50 hover:text-white px-2 py-1" onClick={() => setInstrEdit(false)}>CANCEL</button>
                      <button
                        className="text-[14px] tracking-[0.15em] bg-white/10 hover:bg-white/20 border border-white/20 rounded px-3 py-1 transition-colors"
                        onClick={() => { const s = simulationRef.current; if (s) s.worldData.instructions = instrDraft; setInstrEdit(false) }}
                      >
                        SAVE
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="whitespace-pre-line">
                    {String(simulationRef.current?.worldData?.instructions ||
                      ((simulationRef.current?.fields?.size ?? 0) === 0
                        ? 'This world is BLANK — here is how to make it real:\n\n1 · ⚡ CONNECT AI — copy the briefing to any AI and tell it what to build. It works over plain HTTP; the world updates live.\n2 · Or build by hand in the workshop tools (⚙).\n3 · The world saves itself as you make it. The moment it is not blank, it joins the cafe\u2019s main screen.\n\nWrite these instructions properly (EDIT, above) once your world knows what it is: key entry first, then the point.'
                        : 'No instructions written for this world yet.'))}
                  </div>
                )}
                </div>
              </div>
            </div>
          )}

          {/* BRANCHES — the CELL: viewers gather, five unlock the vote, every branch has a table */}
          {versionsOpen && spaceSlug && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setVersionsOpen(false)}>
              <div className="max-w-md w-[92%] max-h-[76%] overflow-y-auto rounded-xl border border-white/15 bg-black/85 backdrop-blur p-5 font-mono text-[17px] text-white/85" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[16px] tracking-[0.25em] text-white/50">⏱ VERSIONS OF {(playScene || spaceSlug || '').toUpperCase()}</div>
                  <button aria-label="Close" className="text-white/40 hover:text-white text-[18px] leading-none px-1.5 py-0.5 rounded border border-white/10 hover:border-white/30" onClick={() => setVersionsOpen(false)}>✕</button>
                </div>
                {(isOwner || !spaceId) && (
                  <button
                    disabled={versionBusy}
                    className="w-full text-left px-3 py-2 rounded-lg border border-emerald-400/30 text-emerald-200/90 hover:bg-emerald-400/10 transition-colors mb-3 disabled:opacity-40"
                    onClick={async () => {
                      setVersionBusy(true)
                      try {
                        const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/versions`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
                        }).then(x => x.json())
                        showToast(r.deduped ? `no change since v${r.version?.version} — nothing to save` : `saved v${r.version?.version}`, 'success')
                        await loadVersions()
                      } catch { showToast('could not save version', 'error') } finally { setVersionBusy(false) }
                    }}
                  >
                    ＋ SAVE A VERSION <span className="text-white/40 text-[14px]">— snapshot the world as it stands (identical saves are skipped)</span>
                  </button>
                )}
                {versionList.length === 0 && <div className="text-white/35 text-[16px] px-1 py-2">no versions yet — save one, or the eye will as you build.</div>}
                {versionList.map(v => (
                  <div key={v.version} className="flex items-center gap-2 rounded-lg border border-white/10 mb-1.5 px-3 py-2">
                    <span className="text-amber-200/90 tracking-[0.1em]">v{v.version}</span>
                    <span className="flex-1 text-white/50 text-[14px] truncate">{v.note || (v.author?.name ? `by ${v.author.name}` : '—')}</span>
                    <button
                      className="text-[14px] text-white/50 hover:text-white px-1.5"
                      title="preview this version in a new tab"
                      onClick={() => window.open(`/space/${encodeURIComponent(spaceSlug)}?version=${v.version}`, '_blank')}
                    >VIEW</button>
                    {(isOwner || !spaceId) && (
                      <button
                        disabled={versionBusy}
                        className="text-[14px] border border-white/15 rounded px-2 py-0.5 text-white/60 hover:text-white hover:border-white/40 disabled:opacity-40"
                        title="restore this version as the live world (current state is saved first)"
                        onClick={async () => {
                          if (!window.confirm(`Restore v${v.version} as the live world? Your current state is saved as a new version first.`)) return
                          setVersionBusy(true)
                          try {
                            await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/versions/${v.version}`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply' }),
                            })
                            showToast(`restored v${v.version} — reloading`, 'success')
                            setTimeout(() => window.location.reload(), 600)
                          } catch { showToast('restore failed', 'error') } finally { setVersionBusy(false) }
                        }}
                      >RESTORE</button>
                    )}
                  </div>
                ))}
                <div className="text-[14px] text-white/30 mt-2">save points are versions · restoring never destroys — the live world is snapshotted first</div>
              </div>
            </div>
          )}
          {branchesOpen && (() => {
            const base = cellBase()
            const viewers = Object.keys(cellData.viewers)   // presence only — the vote lives in the ⚔ reckoning
            const say = (author: string) => {
              const text = cellDraft.trim()
              if (!text) return
              const doc: CellDoc = JSON.parse(JSON.stringify(cellData))
              doc.discussion[author] = [...(doc.discussion[author] || []), { who: whoRef.current, text, at: Date.now() }].slice(-50)
              saveCellDoc(doc); setCellData(doc); setCellDraft('')
            }
            return (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBranchesOpen(false)}>
                <div className="max-w-md w-[92%] max-h-[76%] overflow-y-auto rounded-xl border border-white/15 bg-black/85 backdrop-blur p-5 font-mono text-[17px] text-white/85" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[16px] tracking-[0.25em] text-white/50">⑂ BRANCHES OF {base.toUpperCase()}</div>
                    <button aria-label="Close" className="text-white/40 hover:text-white text-[18px] leading-none px-1.5 py-0.5 rounded border border-white/10 hover:border-white/30 transition-colors" onClick={() => setBranchesOpen(false)}>✕</button>
                  </div>
                  <div className="flex items-center gap-2 mb-3 text-[14px] text-white/40">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                    <span>{viewers.length} here now</span>
                    <span className="text-white/25">· ride, discuss — cast your vote in the ⚔ reckoning</span>
                  </div>
                  {/* THE PODIUM — above main and the branches. The elected winner's
                      frozen copy rides from here; main always stays the maker's. */}
                  {(() => {
                    const podium = branchList.find(bb => bb.author === 'winner' || bb.author.startsWith('winner · '))
                    if (podium) {
                      const of = String(podium.author.split(' · ').slice(1).join(' · ') || '')
                      return (
                        <button className="w-full text-left px-3 py-2 rounded-lg border border-amber-300/40 bg-amber-400/10 hover:bg-amber-400/20 transition-colors mb-1.5"
                          onClick={() => { setBranchesOpen(false); handleLoadScene(podium.name) }}>
                          <span className="text-amber-200">⚔ WINNER</span>
                          <span className="text-white/45 text-[14px]"> — the vote's champion{of ? ` (${of})` : ''} · v{podium.v} · ride it</span>
                        </button>
                      )
                    }
                    return (
                      <div className="w-full px-3 py-2 rounded-lg border border-white/10 border-dashed mb-1.5">
                        <span className="text-white/35">⚔ no winner yet</span>
                        <span className="text-white/25 text-[14px]"> — the vote decides; the champion stands here</span>
                      </div>
                    )
                  })()}
                  <button className="w-full text-left px-3 py-2 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/5 transition-colors mb-1.5" onClick={() => {
                    setBranchesOpen(false)
                    // on a space, "main" is the space's own snapshot, not a scene named
                    // after the slug — the scene store has no such entry, so returning to
                    // the space page reloads main. (Play worlds keep the scene load.)
                    if (spaceSlug) { window.location.href = `/space/${encodeURIComponent(spaceSlug)}` }
                    else { handleLoadScene(base) }
                  }}>
                    <span className="text-emerald-300/90">main</span>
                    <span className="text-white/40 text-[14px]"> — the world as it stands</span>
                  </button>
                  {branchList.filter(bB => bB.author !== 'winner' && !bB.author.startsWith('winner · ')).map(bB => {
                    const chat = cellData.discussion[bB.author] || []
                    return (
                      <div key={bB.name} className="rounded-lg border border-white/10 mb-1.5">
                        <div className="flex items-center">
                          <button className="flex-1 text-left px-3 py-2 hover:bg-white/5 transition-colors" onClick={() => { setBranchesOpen(false); handleLoadScene(bB.name) }}>
                            <span className="text-amber-200/90">⑂ {bB.author}</span>
                            <span className="text-white/40 text-[14px]"> — v{bB.v} · ride it</span>
                          </button>
                          <button className="mr-2 px-2 py-1 text-[14px] text-white/50 hover:text-white" onClick={() => setDiscOpen(discOpen === bB.author ? null : bB.author)}>
                            💬{chat.length > 0 ? chat.length : ''}
                          </button>
                        </div>
                        {discOpen === bB.author && (
                          <div className="border-t border-white/10 px-3 py-2">
                            {chat.length === 0 && <div className="text-white/30 text-[14px] mb-1">no discussion yet — say why this branch should win</div>}
                            {chat.slice(-8).map((m, i) => (
                              <div key={i} className="text-[16px] mb-0.5"><span className="text-white/45">{m.who}:</span> {m.text}</div>
                            ))}
                            <div className="flex gap-1.5 mt-1.5">
                              <input
                                value={cellDraft}
                                onChange={e => setCellDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') say(bB.author) }}
                                placeholder="speak in the cell…"
                                className="flex-1 bg-black/60 border border-white/15 rounded px-2 py-1 text-[16px] outline-none focus:border-white/35"
                              />
                              <button className="text-[14px] px-2 border border-white/15 rounded hover:border-white/40" onClick={() => say(bB.author)}>SAY</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {branchList.length === 0 && (
                    <div className="text-white/35 text-[16px] px-1 py-2">no branches yet — be the first: ⑂ BRANCH</div>
                  )}
                  <div className="text-[14px] text-white/30 mt-2">unity chant law: five to a cell · one voice each · the winner becomes the world</div>
                </div>
              </div>
            )
          })()}

          {/* ALTER — the warning gate in front of the owner's live plug: no token
              until the owner has read what "live" means. BRANCH INSTEAD is the out. */}
          {alterWarnOpen && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setAlterWarnOpen(false)}>
              <div className="max-w-md w-[92%] rounded-xl border border-amber-400/30 bg-black/90 backdrop-blur p-5 font-mono text-[17px] leading-relaxed text-white/85" onClick={e => e.stopPropagation()}>
                <div className="text-[16px] tracking-[0.25em] text-amber-300/90 mb-3">⚠ ALTER THE LIVE WORLD</div>
                <p className="text-white/70 text-[16px] mb-2">
                  This plugs an AI straight into the LIVE world — <span className="text-amber-200">no branch is made</span>.
                  Every edit lands on main, for everyone, as it happens.
                </p>
                <p className="text-white/50 text-[16px] mb-4">
                  A save point of the world as it stands is kept first; what the AI leaves becomes the new main.
                  ⏱ VERSIONS is the way back.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    className="text-[14px] tracking-[0.15em] border border-white/20 rounded px-3 py-1.5 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                    onClick={() => { setAlterWarnOpen(false); handleBranch() }}
                  >
                    ⑂ BRANCH INSTEAD
                  </button>
                  <button
                    className="text-[14px] tracking-[0.15em] rounded px-3 py-1.5 bg-amber-500/80 hover:bg-amber-400 text-black transition-colors"
                    onClick={beginAlter}
                  >
                    ALTER LIVE
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* CONNECT AI / ALTER — the plug box: everything an agent needs to edit
              this branch, or (owner on a live space) to alter main directly */}
          {plugOpen && (() => {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            const mintFailed = !plugToken && !plugBusy   // no key — a copyable briefing would be dead on arrival
            const tok = plugToken || (plugBusy ? '…minting…' : '(no key — see below)')
            const cur = lastSceneRef.current || ''
            const bm = cur.match(/^(.+?) ⑂ (.+?) · v(\d+)$/)   // BASE ⑂ author · vN
            // the space token edits LIVE (no eye on the DB path) — the box must say so
            const alter = !bm && !!spaceSlug && !!isOwner
            const looking = bm
              ? `You are looking at world "${bm[1]}" — branch by ${bm[2]}, version v${bm[3]}.`
              : `You are looking at world "${cur || spaceSlug}".`
            const scope = bm
              ? `This token is scoped to THIS branch: your edits continue it as v${Number(bm[3]) + 1}, v${Number(bm[3]) + 2}… (the eye auto-versions). Versions CONTINUE one branch. To bring a different take, make your OWN branch under your name (its own token) — that's a new challenger, not a version. The tournament, not edit access, decides which branch takes main; the original is immortal.`
              : alter
                ? `This token edits the LIVE world DIRECTLY — every command lands on main immediately, for everyone. No branch. A save point of the pre-alter world was kept; when you finish, tell the owner so they can SAVE VERSION to record the result.`
                : `The eye versions your edits automatically after each settled burst — just build.`
            const briefing = `${alter ? 'ALTER' : 'Connect to'} my cartridge.cafe ${bm ? `world "${bm[1]}" · branch "${bm[2]}" · v${bm[3]}` : `world "${cur || spaceSlug}"${alter ? ' — LIVE' : ''}`}:
POST commands to ${origin}/api/engine/bridge
header: Authorization: Bearer ${tok}
${looking}
1. GET ${origin}/api/engine/guide and read it fully (markdown; instructions are MANDATORY — key entry + the point).
2. GET the bridge URL for the current world state. Fields are INVISIBLE until given a visualType.
${plugBrief.trim() ? (alter ? 'ALTER THIS: ' : 'BUILD THIS: ') + plugBrief.trim() : alter ? 'Ask me what to alter, or read the world state and continue it.' : 'Ask me what to build, or read the world state and continue it.'}
${scope}`
            return (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPlugOpen(false)}>
                <div className={`max-w-lg w-[92%] rounded-xl border ${alter ? 'border-amber-400/25' : 'border-white/15'} bg-black/85 backdrop-blur p-5 font-mono text-[17px] leading-relaxed text-white/85`} onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <div className={`text-[16px] tracking-[0.25em] ${alter ? 'text-amber-300/80' : 'text-white/50'}`}>{alter ? '⚡ ALTER THE LIVE WORLD' : '⚡ CONNECT YOUR AI'}</div>
                    <div className="flex items-center gap-1.5 text-[14px] tracking-[0.2em] text-white/50">
                      <span className={`inline-block w-2 h-2 rounded-full ${agentConnected ? 'bg-emerald-400' : 'bg-white/25'}`} />
                      {agentConnected ? 'LIVE' : 'WAITING'}
                    </div>
                  </div>
                  <p className="text-white/60 mb-2 text-[16px]">
                    {alter
                      ? 'Describe the alteration, then paste this to any AI (Claude, or anything that speaks HTTP). It edits the LIVE world — main changes as it works. When it settles, SAVE VERSION records the result.'
                      : 'Describe what to build here, then paste this to any AI (Claude, or anything that speaks HTTP). It builds in this branch; the eye versions every settled edit.'}
                  </p>
                  {mintFailed ? (
                    <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-[16px] leading-relaxed text-amber-100/90">
                      <div className="text-amber-300/90 tracking-[0.2em] mb-1">⚠ NO KEY MINTED — nothing to paste yet</div>
                      A connection prompt is useless without a key, so it&rsquo;s hidden. This usually means:
                      <ul className="list-disc ml-5 mt-1.5 space-y-0.5 text-amber-100/70">
                        <li>you&rsquo;re not <b>signed in as the world&rsquo;s owner</b> — sign in, then reopen CONNECT AI, or</li>
                        <li>you opened this from the <b>cafe itself</b> — you can&rsquo;t connect an AI to the cafe; enter a world you own (or brew one) first, or lend your AI via <b>🤝 LEND AI</b>.</li>
                      </ul>
                    </div>
                  ) : (
                    <>
                      <input value={plugBrief} onChange={e => setPlugBrief(e.target.value)} maxLength={500}
                        placeholder={alter ? 'what should the AI alter in the live world? (optional)' : 'what should the AI build in this branch? (optional)'}
                        className="w-full bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-[17px] text-white/90 outline-none focus:border-white/35 mb-3" />
                      <pre className="whitespace-pre-wrap bg-black/60 border border-white/10 rounded-lg p-3 text-[16px] text-emerald-200/90 select-all max-h-56 overflow-y-auto">{briefing}</pre>
                    </>
                  )}
                  <div className="flex gap-2 mt-3 justify-end">
                    {alter && spaceSlug && (
                      <button
                        className="text-[14px] tracking-[0.15em] border border-emerald-400/30 text-emerald-200/90 hover:bg-emerald-400/10 rounded px-3 py-1 transition-colors mr-auto"
                        title="snapshot the altered world as a version — it is already main; this records it"
                        onClick={async () => {
                          try {
                            const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/versions`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ note: plugBrief.trim() ? `alter: ${plugBrief.trim().slice(0, 80)}` : 'alter' }),
                            }).then(x => x.json())
                            showToast(r.deduped ? `no change since v${r.version?.version} — nothing to save` : `altered world saved as v${r.version?.version} — it is main`, 'success')
                          } catch { showToast('could not save version', 'error') }
                        }}
                      >
                        ✓ SAVE VERSION
                      </button>
                    )}
                    {alter && spaceSlug && (
                      <button
                        disabled={!plugBrief.trim()}
                        className="text-[14px] tracking-[0.15em] bg-brass/80 hover:bg-glow text-void rounded px-3 py-1 transition-colors disabled:opacity-40"
                        title="hand your brief to the house AI — it alters your LIVE world"
                        onClick={async () => {
                          try {
                            const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}`, {
                              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ brief: plugBrief.trim(), houseAi: true }),
                            })
                            if (r.ok) { showToast('house AI queued — it will alter your live world as one comes free', 'success'); setPlugOpen(false) }
                            else showToast('could not queue the house AI', 'error')
                          } catch { showToast('could not queue the house AI', 'error') }
                        }}
                      >
                        ☕ HAVE THE HOUSE AI DO IT
                      </button>
                    )}
                    {!mintFailed && (
                      <button
                        className="text-[14px] tracking-[0.15em] bg-white/10 hover:bg-white/20 border border-white/20 rounded px-3 py-1 transition-colors"
                        onClick={() => { navigator.clipboard?.writeText(briefing); showToast('briefing copied', 'success') }}
                      >
                        COPY
                      </button>
                    )}
                    <button className="text-[14px] tracking-[0.15em] text-white/50 hover:text-white px-2 py-1" onClick={() => setPlugOpen(false)}>CLOSE</button>
                  </div>
                </div>
              </div>
            )
          })()}

          {mkIconOpen && (() => {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            const tok = plugToken || (plugBusy ? '…minting…' : '(minting failed — are you the owner?)')
            const d = mkIconDesc.trim()
            const prompt = `Author my cartridge.cafe world ICON — a tiny LIVING shader for this world's shelf bubble.
POST to ${origin}/api/engine/bridge   header: Authorization: Bearer ${tok}
Store it with ONE command:
{"type":"set_world_data","data":{"icon_wgsl":"fn visual_icon(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f { /* your art */ }"}}
HARD RULES — it renders alone in a 64px disc with NOTHING but its inputs:
· use ONLY uv (-1..1), time, and built-in helpers (fbm, fbm4, voronoi, sdCircle, hsv2rgb, palette, rot2, smoothstep, mix…)
· NO @group/@binding, NO textures, NO uni()/prevAt/fields, NO extra bindings — it runs in isolation or it's dropped
· return rgb in 0..1, alpha 1.0; keep it calm — no strobing or flashing
Make it evoke THIS world${d ? ': ' + d : ' (read the world state first to see what it is)'}. Reply to confirm once set.`
            return (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMkIconOpen(false)}>
                <div className="max-w-lg w-[92%] rounded-xl border border-white/15 bg-black/85 backdrop-blur p-5 font-mono text-[17px] leading-relaxed text-white/85" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[16px] tracking-[0.25em] text-white/50">◆ MAKE YOUR ICON</div>
                    <div className="flex items-center gap-1.5 text-[14px] tracking-[0.2em] text-white/50">
                      <span className={`inline-block w-2 h-2 rounded-full ${mkIconSet ? 'bg-emerald-400' : 'bg-white/25'}`} />
                      {mkIconSet ? 'ICON SET' : 'WAITING'}
                    </div>
                  </div>
                  <p className="text-white/60 mb-2 text-[16px]">Describe the icon (optional), then hand this to your AI. It writes a small self-contained shader for your shelf bubble — no image, nothing stored but the code.</p>
                  <input value={mkIconDesc} onChange={e => setMkIconDesc(e.target.value)} maxLength={120}
                    placeholder="e.g. a dusk tidepool, anemones glowing"
                    className="w-full bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-[17px] text-white/90 outline-none focus:border-white/35 mb-3" />
                  <pre className="whitespace-pre-wrap bg-black/60 border border-white/10 rounded-lg p-3 text-[13px] text-emerald-200/90 select-all max-h-48 overflow-y-auto">{prompt}</pre>
                  <div className="flex gap-2 mt-3 justify-end">
                    <button
                      className="text-[14px] tracking-[0.15em] bg-white/10 hover:bg-white/20 border border-white/20 rounded px-3 py-1 transition-colors"
                      onClick={() => { navigator.clipboard?.writeText(prompt); setMkIconCopied(true); setTimeout(() => setMkIconCopied(false), 1600) }}
                    >
                      {mkIconCopied ? 'COPIED ✓' : 'COPY PROMPT'}
                    </button>
                    <button className="text-[14px] tracking-[0.15em] text-white/50 hover:text-white px-2 py-1" onClick={() => setMkIconOpen(false)}>CLOSE</button>
                  </div>
                  <p className="text-white/40 mt-2 text-[14px]">{mkIconSet ? 'Your AI set the icon — it appears on the shelf shortly.' : 'The moment your AI stores it, this flips to ICON SET.'}</p>
                </div>
              </div>
            )
          })()}

          {/* Virtual touch controls — writes the same worldData.key_* the keyboard
              does, so every cartridge gains touch support unchanged. Touch-only. */}
          <TouchControls simRef={simulationRef} />

          {/* Space breadcrumb — shown when in a child space */}
          {spaceSlug && <SpaceBreadcrumb spaceSlug={spaceSlug} />}

          {/* Space management now lives inside WORLD TOOLS (one toolbox) */}

          {/* Pixel hover tooltip — a workshop instrument: only while the tools
              chrome is open. It was following the cursor through finished game
              worlds (spaces have no playScene), which read as a stray debug box. */}
          {pixelInfo && !playScene && chromeVisible && (
            <div
              className="fixed z-50 pointer-events-none bg-black/85 text-white text-[14px] font-mono px-2 py-1 rounded border border-white/20 whitespace-nowrap"
              style={{ left: pixelInfo.screenX + 14, top: pixelInfo.screenY - 10 }}
            >
              <div>({pixelInfo.gridX}, {pixelInfo.gridY})</div>
              <div className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm border border-white/30"
                  style={{ backgroundColor: `rgba(${pixelInfo.r},${pixelInfo.g},${pixelInfo.b},${pixelInfo.a / 255})` }}
                />
                rgba({pixelInfo.r},{pixelInfo.g},{pixelInfo.b},{pixelInfo.a})
              </div>
              {pixelInfo.fields.length > 0 && (
                <div className="text-accent">{pixelInfo.fields.join(', ')}</div>
              )}
            </div>
          )}

          {/* FOCUS — what world/branch/version this tab is actually looking at.
              Every UI view carries this so the player is never lost: spaces get
              it from SpaceToolbar; the shell's play view gets it here. */}
          {ctx.surface === 'world' && (playScene || spaceId) && (() => {
            // the ONE identity strip: a UNIVERSAL back button, and the world
            // detail (name · owner / main·live) to its RIGHT. Host-only details
            // ctx can't know are passed in. NOT on the hub (CAFE/SUB-MAIN) —
            // the cafe main renders with playScene='CAFE', so gate on surface.
            const branchy = ctx.kind === 'branch' || ctx.kind === 'winner'
            const sub = branchy ? undefined
              : spaceId ? (spaceVer !== undefined ? `save point v${spaceVer} · read-only` : 'main · live')
              : (baseVerPos > 0 ? `main · backup v${baseVers.length + 1 - baseVerPos}` : 'main · live')
            const back = () => {
              // viewing a space version backs out to LIVE first (hot-swap for the
              // owner, reload for a visitor)
              if (spaceId && spaceVer !== undefined) {
                if (isOwner) hotLoadSpaceVersion(undefined)
                else window.location.href = `/space/${spaceSlug}`
                return
              }
              // inside the cafe shell → its leave-confirm (in-shell scene swap, no
              // reload). This is the ONE back button; CafeShell no longer draws its own.
              if (playScene && !spaceId) { window.dispatchEvent(new CustomEvent('cafe:back')); return }
              // a space at LIVE goes UP, never history.back(): version-stepping
              // pushes ?version=N entries, so history walks you to an older cut
              // of the SAME world (the direct-join trap). Up = the base world's
              // room; a space named without lineage goes to the cafe.
              if (spaceId) {
                const base = (spaceName || '').split(' ⑂ ')[0].trim()
                window.location.href = base && base !== (spaceName || '').trim() ? `/hub/${encodeURIComponent(base)}` : '/'
                return
              }
              if (typeof window !== 'undefined' && window.history.length > 1) window.history.back()
              else window.location.href = '/'
            }
            return (
              <div className="absolute left-3 top-3 z-40 flex items-stretch gap-1.5">
                <button onClick={back} title="back"
                  className="pointer-events-auto px-2.5 rounded-lg font-mono text-white/70 hover:text-white bg-black/55 backdrop-blur border border-white/10 hover:bg-black/80 transition-colors">◂</button>
                <FocusChip ctx={ctx} nameOverride={spaceId ? spaceName : undefined} ownerName={spaceId ? spaceOwnerName ?? undefined : undefined} ownerId={spaceId ? spaceOwnerId ?? undefined : undefined} ownerHandle={spaceId ? spaceOwnerHandle ?? undefined : undefined} subOverride={sub} inline />
                {branchy && playScene && (
                  <button
                    title="players joining this world see the version you're looking at"
                    onClick={async () => {
                      const base = playScene.split(' ⑂ ')[0].trim()
                      const r = await fetch('/api/engine/lineage/set-main', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ base, holder: playScene }),
                      })
                      const d = await r.json().catch(() => ({}))
                      window.dispatchEvent(new CustomEvent('cafe:caption', { detail: {
                        text: r.ok ? `♛ main now serves ${playScene.split(' ⑂ ')[1] || playScene}` : (d.error || 'could not set main'),
                        kind: r.ok ? 'hint' : 'error',
                      } }))
                    }}
                    className="pointer-events-auto px-2.5 rounded-lg font-mono text-[14px] tracking-[0.15em] text-amber-200/80 hover:text-amber-100 bg-black/55 backdrop-blur border border-amber-300/25 hover:border-amber-300/60 transition-colors">
                    ♛ SET MAIN
                  </button>
                )}
              </div>
            )
          })()}

          {worldChatOpen && (() => {
            const cur = lastSceneRef.current || playScene || ''
            const base = cur.split(' ⑂ ')[0]
            const channel = spaceId && spaceSlug ? 'chat:space:' + spaceSlug : 'chat:world:' + base
            const title = (spaceId ? (spaceName || spaceSlug || 'this world') : base) + ' · chat'
            // ONE thread per world: store in the SAME world-chat:<BASE> slot the
            // vote's talk uses — keyed by the door name (a space's display name,
            // a cartridge's base scene name), uppercased, branch suffix stripped.
            const key = ((spaceId ? (spaceName || spaceSlug) : base) || '').split(' ⑂ ')[0].trim().toUpperCase()
            // vantage: where this speaker stands — riding a branch, or main
            const bi = cur.indexOf(' ⑂ ')
            const vantage = bi < 0 ? 'main' : '⑂ ' + (cur.slice(bi + 3).split(' · ')[0] || 'branch')
            return <ChatWorld channel={channel} slot={key ? 'world-chat:' + key : undefined} vantage={vantage} title={title} subtitle="the world's commons — players, makers, and their AIs" onExit={() => setWorldChatOpen(false)} />
          })()}
          {/* Info overlay */}
          {chromeVisible && !spaceId && !playScene && (
          <div className="absolute top-3 left-3 text-[14px] text-muted font-mono flex items-center gap-2">
            <span className="pointer-events-none">
              {gridSize}x{gridSize} | zoom: {cameraRef.current.zoom.toFixed(1)}x
              {selectedField && <span> | selected: {selectedField.name}</span>}
              {agentConnected && <span className="text-accent"> | agent live</span>}
            </span>
            {worldLocked && (
              <span className="flex items-center gap-2 px-2 py-0.5 rounded bg-error/20 border border-error/40 text-error text-[14px] font-bold">
                READ-ONLY — another session is writing this world
                <button
                  onClick={() => { takeoverRef.current = true }}
                  className="underline hover:text-foreground"
                  title="Claim the writer lease for this tab"
                >
                  take over
                </button>
              </span>
            )}
            <button
              onClick={async () => {
                const sim = simulationRef.current
                const renderer = rendererRef.current
                if (!sim || !renderer) return

                for (const field of sim.fields.values()) {
                  renderer.removeAllFieldEffects(field.id)
                }
                sim.clearAll()
                sim.fields.clear()
                sim.interactionRules = []
                sim.customCommands.clear()

                updateSelectionMask(null)
                syncFields()
                fetch('/api/engine/agent', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (document.cookie.match(/token=([^;]*)/)?.[1] || '') },
                  body: JSON.stringify({ type: 'reset' }),
                }).catch(() => {})
              }}
              className="px-2 py-1 bg-error/20 text-error border border-error/30 rounded text-[14px] font-bold hover:bg-error/40 transition-colors"
            >
              RESET MATCH
            </button>
          </div>

          )}
          {/* (prompt input moved to sidebar) */}
        </div>

        {/* Field list panel — scrollable under the canvas */}
        {chromeVisible && !spaceId && !playScene && (
        <div className="h-40 flex-shrink-0 border-t border-border bg-background/95 overflow-y-auto">
          <div className="px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[14px] text-muted font-mono">{fields.size} fields</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleSaveScene}
                  className="text-[14px] font-mono px-2 py-0.5 bg-success/20 text-success border border-success/30 rounded hover:bg-success/40 transition-colors"
                >
                  Save Scene
                </button>
                {brush.activeFieldId && fields.has(brush.activeFieldId) && (
                  <button
                    onClick={() => handleSaveToLibrary(brush.activeFieldId!)}
                    className="text-[14px] font-mono px-2 py-0.5 bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/40 transition-colors"
                  >
                    Save to Library
                  </button>
                )}
              </div>
            </div>
            {savedScenes.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {savedScenes.map(name => (
                  <div key={name} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-surface/50 border border-border rounded text-[14px] font-mono group">
                    <button
                      onClick={() => handleLoadScene(name)}
                      className="text-foreground hover:text-accent transition-colors truncate max-w-[120px]"
                      title={`Load scene "${name}"`}
                    >
                      {name}
                    </button>
                    <button
                      onClick={() => handleDeleteScene(name)}
                      className="text-muted hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                      title={`Delete scene "${name}"`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1">
              {Array.from(fields.values()).sort((a, b) => (a.renderOrder || 0) - (b.renderOrder || 0)).map(f => (
                <div
                  key={f.id}
                  onClick={() => {
                    setBrush(prev => ({ ...prev, activeFieldId: f.id }))
                    updateSelectionMask(f.id)
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[14px] font-mono cursor-pointer transition-colors ${
                    brush.activeFieldId === f.id
                      ? 'bg-accent/20 border border-accent/40'
                      : 'bg-surface/50 border border-border hover:border-muted'
                  }`}
                >
                  <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{
                    backgroundColor: `rgba(${Math.round(f.color[0]*255)},${Math.round(f.color[1]*255)},${Math.round(f.color[2]*255)},${f.color[3]})`
                  }} />
                  <span className="text-foreground truncate">{f.name}</span>
                  {f.properties.get('portalType') === 'space' && (
                    <span className="text-purple flex-shrink-0" title={`Portal to ${f.properties.get('portalTarget')}`}>P</span>
                  )}
                  <span className="text-muted ml-auto flex-shrink-0">
                    {f.effects.length > 0 ? `${f.effects.length}fx` : '—'}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteField(f.id) }}
                    className="text-error/50 hover:text-error text-xs ml-1 flex-shrink-0"
                    title={`Delete ${f.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Designer sidebar */}
      {chromeVisible && !spaceId && !playScene && (
      <div className="w-96 flex-shrink-0 flex flex-col border-l border-border bg-background overflow-hidden">
        {/* Inspector Panel */}
        <div className="flex-shrink-0 overflow-y-auto" style={{ maxHeight: '50%' }}>
          <div className="px-3 py-2 text-[14px] font-mono text-muted border-b border-border flex-shrink-0 flex items-center justify-between">
            <span>Inspector</span>
            {brush.activeFieldId && fields.has(brush.activeFieldId) && (
              <span className="text-accent">{fields.get(brush.activeFieldId)!.name}</span>
            )}
          </div>
          <div className="px-3 py-2">
            {(() => {
              const inspField = brush.activeFieldId ? fields.get(brush.activeFieldId) : null
              if (!inspField) return <div className="text-[14px] text-muted font-mono py-4 text-center">Click a field to inspect</div>
              const sim = simulationRef.current
              return (
                <div className="space-y-2 text-[14px] font-mono">
                  {/* Name */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Name</span>
                    <input
                      type="text"
                      value={inspField.name}
                      onChange={(e) => {
                        if (sim) {
                          const f = sim.fields.get(inspField.id)
                          if (f) { f.name = e.target.value; syncFields() }
                        }
                      }}
                      className="flex-1 bg-surface/50 border border-border rounded px-1.5 py-0.5 text-foreground text-[14px] font-mono"
                    />
                  </div>
                  {/* Color */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Color</span>
                    <span className="inline-block w-4 h-4 rounded border border-border flex-shrink-0" style={{
                      backgroundColor: `rgba(${Math.round(inspField.color[0]*255)},${Math.round(inspField.color[1]*255)},${Math.round(inspField.color[2]*255)},${inspField.color[3]})`
                    }} />
                    <span className="text-muted">
                      ({Math.round(inspField.color[0]*255)}, {Math.round(inspField.color[1]*255)}, {Math.round(inspField.color[2]*255)}, {inspField.color[3].toFixed(2)})
                    </span>
                  </div>
                  {/* Position */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Pos</span>
                    <span className="text-foreground">({Math.round(inspField.transform.x)}, {Math.round(inspField.transform.y)})</span>
                    <span className="text-muted ml-2">scale: {inspField.transform.scale.toFixed(2)}</span>
                  </div>
                  {/* Render Order */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Order</span>
                    <button
                      onClick={() => {
                        if (sim) {
                          const f = sim.fields.get(inspField.id)
                          if (f) { f.renderOrder = (f.renderOrder || 0) - 1; syncFields() }
                        }
                      }}
                      className="px-1 py-0.5 bg-surface/50 border border-border rounded hover:bg-surface text-foreground"
                    >-</button>
                    <span className="text-foreground w-6 text-center">{inspField.renderOrder || 0}</span>
                    <button
                      onClick={() => {
                        if (sim) {
                          const f = sim.fields.get(inspField.id)
                          if (f) { f.renderOrder = (f.renderOrder || 0) + 1; syncFields() }
                        }
                      }}
                      className="px-1 py-0.5 bg-surface/50 border border-border rounded hover:bg-surface text-foreground"
                    >+</button>
                    <span className="text-muted ml-1">(lower = behind)</span>
                  </div>
                  {/* Shape */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted w-12 flex-shrink-0">Shape</span>
                    <span className="text-foreground">
                      {inspField.shapeType === 'rect'
                        ? `rect ${inspField.w || 0}x${inspField.h || 0}`
                        : inspField.shapeType === 'screen'
                        ? `screen ${inspField.w || 0}x${inspField.h || 0}`
                        : `circle r=${inspField.radius || 0}`
                      }
                    </span>
                  </div>
                  {/* Visual type */}
                  {inspField.visualType !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted w-12 flex-shrink-0">Visual</span>
                      <span className="text-accent">{inspField.visualType}</span>
                      {inspField.visualParams && (
                        <span className="text-muted">params: [{inspField.visualParams.join(', ')}]</span>
                      )}
                    </div>
                  )}
                  {/* Tags */}
                  {inspField.tags && inspField.tags.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted w-12 flex-shrink-0">Tags</span>
                      <span className="text-foreground">{inspField.tags.join(', ')}</span>
                    </div>
                  )}
                  {/* Effects */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-muted">Effects ({inspField.effects.length})</span>
                      {inspField.effects.length > 0 && (
                        <button
                          onClick={() => handleClearEffect(inspField.id)}
                          className="text-error/60 hover:text-error"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    {inspField.effects.length === 0 && (
                      <div className="text-muted/50 pl-2">No effects</div>
                    )}
                    {inspField.effects.map(fx => (
                      <div key={fx.id} className="flex items-center gap-1 pl-2 py-0.5">
                        <span className="text-foreground truncate flex-1">{fx.description || fx.id}</span>
                        <span className="text-muted flex-shrink-0">{fx.blend}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Interactions Panel */}
        <div className="flex-shrink-0 border-t border-border overflow-y-auto" style={{ maxHeight: '25%' }}>
          <div className="px-3 py-2 text-[14px] font-mono text-muted border-b border-border">
            Interactions
          </div>
          <div className="px-3 py-2">
            {(() => {
              const sim = simulationRef.current
              if (!sim) return null
              const activeId = brush.activeFieldId
              const rules = sim.interactionRules.filter(r =>
                !activeId || r.fieldA === activeId || r.fieldB === activeId || !r.fieldA || !r.fieldB
              )
              const pairs = sim.interactionPairs.filter(p =>
                !activeId || p.fieldA === activeId || p.fieldB === activeId
              )
              const effects = sim.interactionEffects.filter(e =>
                !activeId || e.fieldA === activeId || e.fieldB === activeId || !e.fieldA || !e.fieldB
              )
              const total = rules.length + pairs.length + effects.length
              if (total === 0) return (
                <div className="text-[14px] text-muted font-mono py-2 text-center">No interactions</div>
              )
              return (
                <div className="space-y-1 text-[14px] font-mono">
                  {pairs.map((p, i) => {
                    const nameA = sim.fields.get(p.fieldA)?.name || p.fieldA
                    const nameB = sim.fields.get(p.fieldB)?.name || p.fieldB
                    return (
                      <div key={`pair-${i}`} className="flex items-center gap-1 text-foreground">
                        <span className="text-accent">{nameA}</span>
                        <span className="text-muted">↔</span>
                        <span className="text-accent">{nameB}</span>
                        <span className="text-muted ml-auto">{p.name}</span>
                      </div>
                    )
                  })}
                  {rules.map(r => (
                    <div key={r.id} className="flex items-center gap-1 text-foreground">
                      <span className="text-accent">{r.fieldA ? (sim.fields.get(r.fieldA)?.name || r.fieldA) : '*'}</span>
                      <span className="text-muted">→</span>
                      <span className="text-accent">{r.fieldB ? (sim.fields.get(r.fieldB)?.name || r.fieldB) : '*'}</span>
                      <span className="text-muted ml-auto">{r.trigger}: {r.effect}</span>
                    </div>
                  ))}
                  {effects.map(e => (
                    <div key={e.id} className="flex items-center gap-1 text-foreground">
                      <span className="text-accent">{e.fieldA ? (sim.fields.get(e.fieldA)?.name || e.fieldA) : '*'}</span>
                      <span className="text-muted">↔</span>
                      <span className="text-accent">{e.fieldB ? (sim.fields.get(e.fieldB)?.name || e.fieldB) : '*'}</span>
                      <span className="text-muted ml-auto">{e.description || 'shader'}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>

        {/* AI Prompt Panel — scoped to selected field */}
        <div className="flex-shrink-0 border-t border-border">
          <div className="px-3 py-2 text-[14px] font-mono text-muted border-b border-border">
            {brush.activeFieldId && fields.has(brush.activeFieldId)
              ? `AI Prompt — ${fields.get(brush.activeFieldId)!.name}`
              : 'AI Prompt — global'
            }
          </div>
          <div className="px-3 py-2">
            <input
              type="text"
              className="w-full bg-surface/50 border border-border text-foreground text-[14px] font-mono px-2 py-1.5 rounded"
              placeholder={brush.activeFieldId ? `Edit ${fields.get(brush.activeFieldId)?.name || 'field'}...` : 'Type a prompt...'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  const sim = simulationRef.current
                  if (sim) {
                    sim.worldData['user_prompt'] = e.currentTarget.value
                    sim.worldData['user_prompt_time'] = Date.now()
                    if (brush.activeFieldId) {
                      sim.worldData['user_prompt_field'] = brush.activeFieldId
                    } else {
                      delete sim.worldData['user_prompt_field']
                    }
                  }
                  e.currentTarget.value = ''
                }
              }}
            />
          </div>
        </div>

        {/* Terminal (collapsible) */}
        <div className="flex-1 border-t border-border flex flex-col min-h-0 overflow-hidden">
          <button
            onClick={() => setTerminalOpen(prev => !prev)}
            className="px-3 py-2 text-[14px] font-mono text-muted border-b border-border flex-shrink-0 flex items-center justify-between hover:bg-surface/30 transition-colors cursor-pointer w-full text-left"
          >
            <span>Terminal <span className="text-accent">{terminalLog.length}</span></span>
            <span>{terminalOpen ? '▼' : '▶'}</span>
          </button>
          {terminalOpen && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <AgentTerminalPanel entries={terminalLog} />
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
/** Virtual touch controls — a left thumb-stick (arrows + WASD) and two action
 *  buttons (A = space, B = enter) writing the same worldData.key_* the keyboard
 *  writes, so every existing cartridge gains touch support unchanged.
 *  Renders only on touch devices; the stick nub is moved via style (no re-renders). */
function TouchControls({ simRef }: { simRef: { current: FieldSimulation | null } }) {
  const [isTouch] = useState(() =>
    typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0))
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const nubRef = useRef<HTMLDivElement>(null)

  const setKeys = useCallback((dx: number, dy: number) => {
    const wd = simRef.current?.worldData
    if (!wd) return
    const TH = 14
    const L = dx < -TH, R = dx > TH, U = dy < -TH, D = dy > TH
    wd.key_left = L; wd.key_a = L
    wd.key_right = R; wd.key_d = R
    wd.key_up = U; wd.key_w = U
    wd.key_down = D; wd.key_s = D
  }, [simRef])

  const stickDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    originRef.current = { x: e.clientX, y: e.clientY }
  }, [])
  const stickMove = useCallback((e: React.PointerEvent) => {
    const o = originRef.current
    if (!o) return
    const dx = Math.max(-40, Math.min(40, e.clientX - o.x))
    const dy = Math.max(-40, Math.min(40, e.clientY - o.y))
    if (nubRef.current) nubRef.current.style.transform = `translate(${dx}px, ${dy}px)`
    setKeys(dx, dy)
  }, [setKeys])
  const stickUp = useCallback(() => {
    originRef.current = null
    if (nubRef.current) nubRef.current.style.transform = 'translate(0px, 0px)'
    setKeys(0, 0)
  }, [setKeys])

  const btn = useCallback((key: string, down: boolean) => (e: React.PointerEvent) => {
    e.preventDefault()
    const wd = simRef.current?.worldData
    if (wd) wd[key] = down
  }, [simRef])

  if (!isTouch) return null
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none select-none" style={{ touchAction: 'none' }}>
      <div
        className="absolute bottom-8 left-8 w-28 h-28 rounded-full border border-white/20 bg-white/5 backdrop-blur-sm pointer-events-auto"
        style={{ touchAction: 'none' }}
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
      >
        <div
          ref={nubRef}
          className="absolute left-1/2 top-1/2 -ml-6 -mt-6 w-12 h-12 rounded-full bg-white/20 border border-white/30 transition-transform duration-75"
        />
      </div>
      <div className="absolute bottom-10 right-8 flex gap-4 pointer-events-auto">
        <button
          className="w-16 h-16 rounded-full border border-white/25 bg-white/10 text-white/70 text-sm font-mono active:bg-white/25"
          style={{ touchAction: 'none' }}
          onPointerDown={btn('key_space', true)}
          onPointerUp={btn('key_space', false)}
          onPointerCancel={btn('key_space', false)}
        >A</button>
        <button
          className="w-16 h-16 rounded-full border border-white/25 bg-white/10 text-white/70 text-sm font-mono active:bg-white/25"
          style={{ touchAction: 'none' }}
          onPointerDown={btn('key_enter', true)}
          onPointerUp={btn('key_enter', false)}
          onPointerCancel={btn('key_enter', false)}
        >B</button>
      </div>
    </div>
  )
}
