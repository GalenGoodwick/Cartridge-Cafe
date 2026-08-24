'use client'

import { worldBriefingPrompt, iconAuthorPrompt } from '@/lib/connectPrompt'
import { copyText } from '@/lib/copyText'
import { useRef, useEffect, useCallback, useState } from 'react'
import ChatWorld from '../ChatWorld'
import { io, type Socket } from 'socket.io-client'
import { FieldRenderer } from './renderer'
import { deriveContext, can, type WorldContext } from '@/lib/worldContext'
import { resetPatch, initHolderPatch } from '@/lib/gameStateKeys'
import { FocusChip } from './WorldChrome'
import type { FieldEffectData } from './renderer'
import { FieldSimulation } from './simulation'
import { orderHooks } from './node-order'   // node-runtime rung 1: run hooks in declared __nodes order
import { serializeWorld, isTeardownSnapshot, snapshotBytes, diffShaders, shaderHashes, captureSaveState, saveStateBaseline, sharedKeys, stripSaveState } from './persistence/serialize'
import { NodeGraphOverlay, buildNodeGraph, type AiNodeGraph } from './ai-view/NodeGraph'
import { AiViewPanel, type SwarmNodeView } from './ai-view/AiViewPanel'
import { BuilderBoxPanel } from './builderbox/BuilderBoxPanel'
import { WorldSandbox } from './world-sandbox'
import { solveUi, hitUi, type UiTree, type SolvedUi, type UiOverride } from './ui-solver'
import { ArenaClient, fetchArenaRooms } from './arena-client'
import { FieldInput } from './input'
import Toolbar from './Toolbar'
import VersionScrubber from './VersionScrubber'
import PromptPanel from './PromptPanel'
import type { DialogEntry } from './AgentDialogPanel'
import AgentTerminalPanel from './AgentTerminalPanel'
import type { TerminalEntry } from './AgentTerminalPanel'
import type { BrushState, Camera, Field, FieldEffect, SelectionState, GenerationState, CameraFollow, HudElement, SuperFieldGPU } from './types'
import { DEFAULT_GRID_SIZE } from './types'
import { GameAudio } from './audio'
import { worldBus, recordTap, setWorldVoice, type WorldTone } from './cafe-audio'
import { WorldToolsPanel } from './WorldToolsPanel'
import { NodeDockPanel } from './NodeDockPanel'
import { InstructionsPanel } from './InstructionsPanel'
import { VersionsPanel } from './VersionsPanel'
import { BranchesPanel } from './BranchesPanel'
import SpaceBreadcrumb from './SpaceBreadcrumb'
import { useToast } from '@/components/Toast'
import { genFieldId, genEffectId, _reusableKeySet, screenToGrid, DEFAULT_HUES, hueToRgba, wrapInteractionWgsl, ENGINE_BUILD, scenePreloadCache, playerGlyphWgsl, wrapPlayerGlyph, wrapOtherGlyph } from './engine-utils'
import { applyBridgeCommand } from './bridge-commands'
import * as sceneIO from './scene-io'
import { TouchControls } from './TouchControls'
// DEFAULT_FIELD_EFFECT_GLSL removed — fields are invisible until agents give them a shader

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
    localStorage.setItem('cc:cafeIconAtlas:v7', JSON.stringify({ sig: c.sig, slots: c.slots, b64: btoa(bin) }))
  } catch { /* quota or private mode — cache stays page-local */ }
}
function iconCacheLoad(): typeof cafeIconCache {
  try {
    const raw = localStorage.getItem('cc:cafeIconAtlas:v7')
    if (!raw) return null
    const { sig, slots, b64 } = JSON.parse(raw) as { sig: string; slots: Record<string, number>; b64: string }
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { sig, slots, atlas: new Uint32Array(bytes.buffer) }
  } catch { return null }
}

// Inner-field HTML/CSS UI protocol: sanitize a hook-supplied HTML string before it
// becomes innerHTML. Strips executable/embed elements + event-handler attributes +
// javascript: URLs. Inline styles and data-ui-click hooks are preserved.
function sanitizeHudHtml(html: string): string {
  const tmpl = document.createElement('template')
  tmpl.innerHTML = html
  const frag = tmpl.content
  frag.querySelectorAll('script, iframe, object, embed, link, meta, base, style').forEach((n) => n.remove())
  frag.querySelectorAll('*').forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) node.removeAttribute(attr.name)
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name)
    }
  })
  return tmpl.innerHTML
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
  // VOTE MODE never auto-greets. A version-preview (versionView set — the space
  // page's vote arena hot-swapping candidates) is for judging a world, not
  // entering it; popping the instructions modal there fired cafe:modal and
  // ducked the regular chrome (sidebar/footer) — the "wrong window" bug. Kept in
  // a ref so a stale closure in the async load path still reads the live value.
  const voteModeRef = useRef(false)
  // BOTH vote doors: versionView = a space page's vote-preview; viewport = the
  // hub's vote arena embedding this engine as a candidate stage. In either,
  // instructions NEVER auto-greet — not even a first-time viewer (Galen: the
  // open box hid the vote UI until manually closed).
  voteModeRef.current = versionView != null || viewport != null
  const greetInstructions = (worldId: string) => {
    if (!worldId || worldId === 'CAFE' || worldId === 'SUB-MAIN') return
    if (voteModeRef.current) return
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
  const [nodesOpen, setNodesOpen] = useState(false)   // ⬢ NODES — the dock panel (co-build rung 4)
  const [plugToken, setPlugToken] = useState<string | null>(null)
  const [plugBusy, setPlugBusy] = useState(false)
  const [plugBrief, setPlugBrief] = useState('')   // "what should the AI build here?" — embedded in the connect prompt
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
  // owner's shelf switch: current visibility + the confirm popup (Galen: one
  // click to publish/private, confirm either way, ABOVE the edit button)
  const [spacePublic, setSpacePublic] = useState<boolean | null>(null)
  const [pubConfirm, setPubConfirm] = useState(false)
  const [pubBusy, setPubBusy] = useState(false)
  useEffect(() => {
    if (!spaceId || !spaceSlug || !isOwner) { setSpacePublic(null); return }
    let gone = false
    fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}`)
      .then(r => r.json())
      .then(d => { if (!gone && typeof d?.space?.isPublic === 'boolean') setSpacePublic(d.space.isPublic) })
      .catch(() => {})
    return () => { gone = true }
  }, [spaceId, spaceSlug, isOwner])
  // ── INSPECT MODE (universal — Galen Jul 30): a toggle in the EDIT dropdown.
  //    While on: blue overlay + grid, clicks are DOCUMENTED (never gameplay),
  //    each entry = coords · field · visual · color, mirrored to wd.__clicks so
  //    any connected AI reads them over the bridge. Prototyped in tideglass. ──
  const [inspectOn, setInspectOn] = useState(false)
  // ── UI EDIT MODE (Galen: "manually edit UI elements — click drag, expand/
  // collapse box"). Drags/resizes/collapses write worldData.__uiOverrides —
  // the ui-solver applies them live, they persist with the world's data, and
  // any connected AI can READ them and bake the human's adjustments back into
  // the source tree. The overlay swallows canvas input while on.
  const [uiEditOn, setUiEditOn] = useState(false)
  const uiEditOnRef = useRef(false)
  const [uiEditPanels, setUiEditPanels] = useState<import('./ui-solver').SolvedUi['panels']>([])
  const [uiEditSquare, setUiEditSquare] = useState<{ left: number; top: number; side: number } | null>(null)
  const uiEditDragRef = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; start: { dx: number; dy: number; w: number; h: number } } | null>(null)
  const inspectOnRef = useRef(false)
  // ── DESIGN MODE (SAVE STATES, Galen Aug 7): owner-only. Rom worlds capture every
  //    worldData divergence as the PLAYER's save state — but an owner tuning the
  //    world live IS authoring the ROM, not playing. While design mode is on, per-
  //    player capture pauses and the owner's 2s sync writes FULL worldData to the
  //    shared snapshot (no strip) so tuning knobs land in the cartridge. Turning it
  //    OFF re-baselines: the just-authored state becomes the new ROM, so nothing
  //    tuned is later mistaken for the owner's personal save. Default OFF. ──
  const designModeRef = useRef(false)
  const [designMode, setDesignMode] = useState(false)
  // HOVER PIXEL COLOR (Galen): while inspect is on, snapshot the canvas ~4×/s
  // (createImageBitmap works on a WebGPU canvas) into a 2D buffer and sample
  // the TRUE painted pixel under the cursor live — shown in the console header.
  const [inspectHover, setInspectHover] = useState<{ hex: string; x: number; y: number } | null>(null)
  const inspectPixRef = useRef<{ data: ImageData; w: number; h: number } | null>(null)
  const [inspectLog, setInspectLog] = useState<{ at: number; x: number; y: number; field: string | null; visual: string | null; color: string | null; entity?: { id: number; kind?: number; label?: string } | null; node?: { hook: string; idx: number; kind: number; d: number }[] | null; hud?: { id: string; text: string } | null; ui?: { id: string; text: string; panel: string | null; hook: string | null } | null; source?: string | null }[]>([])
  const [editCoach, setEditCoach] = useState(false)     // one-time coach naming each EDIT-dock control
  // GAMEPLAY MODE (Galen): total-UI-close — strip ALL chrome so the world plays
  // full-screen, uncovered. Only a back arrow + a reopen button remain.
  const [playMode, setPlayMode] = useState(false)
  const enterPlayMode = () => {
    setUiDockOpen(false); setChromeVisible(false); setWorldChatOpen(false)
    setInstrOpen(false); setBuildConsoleOpen(false)
    setPlayMode(true)
    window.dispatchEvent(new CustomEvent('cafe:playmode', { detail: true }))
  }
  const exitPlayMode = () => {
    setPlayMode(false)
    window.dispatchEvent(new CustomEvent('cafe:playmode', { detail: false }))
  }

  // ── RECORD (client-side, never touches the server): captureStream() taps the
  //    live WebGPU canvas → MediaRecorder → a Blob the browser downloads. Native
  //    MP4/H.264 where supported (email-ready), WebM fallback. Captures the CANVAS
  //    only — DOM chrome (this button, slider labels) is never in the file. ──
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const recChunks = useRef<Blob[]>([])
  const recTimer = useRef<number | null>(null)
  const recAudioTap = useRef<{ stream: MediaStream; stop: () => void } | null>(null)
  const recSupported = () => {
    if (typeof MediaRecorder === 'undefined') return ''
    // prefer codecs that carry BOTH video + audio (avc1+mp4a / vp9+opus)
    const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    return c.find(m => { try { return MediaRecorder.isTypeSupported(m) } catch { return false } }) || ''
  }
  const startRecording = () => {
    const cv = canvasRef.current
    if (!cv || recording) return
    const mime = recSupported(); if (!mime) { alert('This browser can’t record video. Try Chrome or Safari.'); return }
    let stream: MediaStream
    try { stream = (cv as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(60) } catch { alert('Could not capture this canvas.'); return }
    // mux the world's audio (music + sfx) into the recording, best-effort
    try {
      const tap = recordTap()
      if (tap) { recAudioTap.current = tap; tap.stream.getAudioTracks().forEach(t => stream.addTrack(t)) }
    } catch { /* record video-only if audio can't be tapped */ }
    let rec: MediaRecorder
    try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 }) } catch { return }
    recChunks.current = []
    rec.ondataavailable = e => { if (e.data && e.data.size) recChunks.current.push(e.data) }
    rec.onstop = () => {
      const type = mime.split(';')[0]
      const ext = type === 'video/mp4' ? 'mp4' : 'webm'
      const blob = new Blob(recChunks.current, { type })
      const url = URL.createObjectURL(blob)
      const base = (spaceId ? (spaceSlug || spaceName || 'world') : (cellBase() || 'world')).split(' ⑂ ')[0].replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'cartridge'
      const d = new Date(); const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const a = document.createElement('a'); a.href = url; a.download = `${base}-${stamp}.${ext}`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      try { recAudioTap.current?.stop() } catch { /* noop */ } recAudioTap.current = null
      if (recTimer.current) { clearInterval(recTimer.current); recTimer.current = null }
    }
    // Flush a chunk every second. WITHOUT a timeslice, ondataavailable fires only
    // once at stop() and Chrome must hold the ENTIRE encoded stream in one internal
    // buffer — long recordings overflow it and the file is silently truncated
    // ("only worked for half the video"). Periodic flushing keeps memory flat.
    rec.start(1000)
    recRef.current = rec
    setRecording(true); setRecSecs(0)
    const t0 = Date.now()
    recTimer.current = window.setInterval(() => setRecSecs(Math.floor((Date.now() - t0) / 1000)), 250)
  }
  const stopRecording = () => {
    const rec = recRef.current
    try { if (rec && rec.state !== 'inactive') rec.stop() } catch { /* already stopped */ }
    recRef.current = null
    setRecording(false)
  }
  // stop cleanly if the component unmounts mid-record
  useEffect(() => () => { try { recRef.current?.stop() } catch { /* noop */ } try { recAudioTap.current?.stop() } catch { /* noop */ } if (recTimer.current) clearInterval(recTimer.current) }, [])
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
      if (plugOpen) setPlugOpen(false)
      else if (instrOpen) { setInstrOpen(false); setInstrEdit(false) }
      else if (branchesOpen) setBranchesOpen(false)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onEsc, { capture: true })
    return () => window.removeEventListener('keydown', onEsc, { capture: true })
  }, [plugOpen, instrOpen, branchesOpen])

  // tell the shell when a panel is up so its overlays (count pills, hover
  // cards) duck out from under the modal
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('cafe:modal', { detail: plugOpen || instrOpen || branchesOpen }))
  }, [plugOpen, instrOpen, branchesOpen])
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
  type CellDoc = { viewers: Record<string, number>; discussion: Record<string, Array<{ who: string; text: string; at: number }>> }
  const [cellData, setCellData] = useState<CellDoc>({ viewers: {}, discussion: {} })
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
  // winnerTakesMain RETIRED with the podium (branch→fork transition): world
  // votes no longer exist, so nothing can take main.
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
  // 'save' is PER-PLAYER (engine persist) — it must NEVER ride a shared snapshot
  // in either direction. One player's save syncing world-global was the Jul 30 leak.
  const stripSave = (wd: Record<string, unknown> | undefined | null): Record<string, unknown> => {
    const out = { ...(wd || {}) } as Record<string, unknown>
    delete out['save']
    return out
  }
  const autoSaveSerRef = useRef('')
  const autoSaveAtRef = useRef(0)
  const autoSaveReadyRef = useRef(false)   // gate: don't persist until the load resolves (else the default overwrites the real save)
  // SAVE STATES (DESIGN-save-states.md): ROM worlds (`worldData.__saveArch='rom'`).
  // Baseline = the authored cartridge's worldData, pre-stringified; null = not a rom
  // world, all save-state code inert. Shared = the world's declared class-2 keys.
  const romBaselineRef = useRef<Record<string, string> | null>(null)
  const romSharedRef = useRef<Set<string>>(new Set())
  const stateSaveSerRef = useRef('')
  const stateSaveAtRef = useRef(0)
  // SAVE STATES: design mode flips → keep the ref in step, and on turning it OFF
  // re-baseline so the just-authored worldData becomes the new ROM (nothing the
  // owner tuned is later captured as their personal save).
  useEffect(() => {
    const wasOn = designModeRef.current
    designModeRef.current = designMode
    if (wasOn && !designMode) {
      const sim = simulationRef.current
      if (sim && romBaselineRef.current) {
        romBaselineRef.current = saveStateBaseline(sim.worldData, romSharedRef.current)
        stateSaveSerRef.current = ''   // next capture diffs against the fresh ROM
      }
    }
  }, [designMode])
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
      // SAVE STATES: DEFAULT-ON for spaces — rom is live once the snapshot applied
      // and set a baseline (legacy worlds never set one). Waiting on the baseline
      // (not the flag) also guarantees the restore can never race the snapshot.
      const rom = !!spaceSlug && romBaselineRef.current !== null
      if (!sim.worldData?.['persist'] && !rom) {
        // the snapshot (which carries persist:true) may not have applied yet —
        // keep checking; give up only after ~8s (then it's a real arcade world)
        if (attempt < 40) setTimeout(() => tryLoad(attempt + 1), 200)
        return
      }
      // no-store is LOAD-BEARING: without it a NORMAL reload serves the browser-
      // cached (stale) save while only a HARD reload bypasses cache — the player
      // sees their progress "revert" on reload (Galen, Jul 31). The save changes
      // every few seconds; it must never be read from cache.
      const loads: Promise<unknown>[] = []
      if (sim.worldData?.['persist']) loads.push(
        fetch(`/api/engine/save?scope=user&anon=${encodeURIComponent(whoRef.current || '')}&slot=${encodeURIComponent(slotOf())}`, { cache: 'no-store' })
          .then(r => r.json())
          .then(j => {
            const s = simulationRef.current
            if (!stopped && s && j?.data != null) {
              s.worldData['save'] = j.data
              sandboxRef.current?.injectSave(j.data)   // outrank the in-flight worker reply (pre-load fresh-init would clobber)
              autoSaveSerRef.current = JSON.stringify(j.data)
            }
          })
          .catch(() => {}))
      // SAVE STATES: restore the player's worldData overlay (slot <world>:__state).
      if (rom) loads.push(
        fetch(`/api/engine/save?scope=user&anon=${encodeURIComponent(whoRef.current || '')}&slot=${encodeURIComponent(slotOf().replace(/:__autosave$/, ':__state'))}`, { cache: 'no-store' })
          .then(r => r.json())
          .then(j => {
            const s = simulationRef.current
            const data = j?.data as Record<string, unknown> | null
            if (!stopped && s && data && typeof data === 'object') {
              for (const [k, v] of Object.entries(data)) s.worldData[k] = v
              sandboxRef.current?.injectState(data)   // outrank in-flight replies (same race as 'save')
              stateSaveSerRef.current = JSON.stringify(captureSaveState(s.worldData, romBaselineRef.current || {}, romSharedRef.current))
            }
          })
          .catch(() => {}))
      Promise.allSettled(loads).then(() => { if (!stopped) autoSaveReadyRef.current = true })   // now the frame loop may persist changes
    }
    tryLoad()
    // 2) FLUSH on leave — a final save so nothing since the last debounce is lost.
    // NOT a reset: it persists the current state. Only for persist worlds.
    const flush = () => {
      // never flush before the load completed (an early close would persist a
      // half-booted state over the real save) — and NEVER during an R reset:
      // the reset nulls the player rows, then reloads; this pagehide flush was
      // re-writing the pre-reset state right after the purge (the second half
      // of "reset doesn't stick").
      if (!autoSaveReadyRef.current) return
      const wd = simulationRef.current?.worldData
      // SAVE STATES: final capture on leave so nothing since the last debounce is lost
      if (wd && romBaselineRef.current && autoSaveReadyRef.current) {
        try {
          const state = captureSaveState(wd, romBaselineRef.current, romSharedRef.current)
          fetch('/api/engine/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
            body: JSON.stringify({ slot: slotOf().replace(/:__autosave$/, ':__state'), data: state, scope: 'user', anon: whoRef.current }) }).catch(() => {})
        } catch { /* leaving anyway */ }
      }
      if (!persistOn()) return
      const sv = wd?.['save']
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
      return { viewers: d.viewers || {}, discussion: d.discussion || {} }
    } catch { return { viewers: {}, discussion: {} } }
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
  // ARENA (multiplayer): when a world declares worldData.mpManifest, the tab
  // becomes a window onto an authoritative room — hooks run server-side, we
  // ship afferents up and adopt the broadcast worldData (see arena-client.ts)
  const arenaRef = useRef<ArenaClient | null>(null)
  const lobbyFetchRef = useRef(0)
  // mirror of the world's JS hooks so a LIVE add/remove/update during a build
  // (owner watching over SSE) can re-install the sandbox from the full set.
  const liveHooksRef = useRef<Map<string, { id: string; author: string; description: string; code: string }>>(new Map())
  const installHooks = useCallback((sim: FieldSimulation, stepHooks: { id: string; author: string; description: string; code: string }[] | undefined, worldData: Record<string, unknown> | undefined) => {
    sandboxRef.current?.dispose()
    sandboxRef.current = null
    liveHooksRef.current = new Map((stepHooks || []).map(h => [h.id, h]))
    // Trust is decided by ORIGIN, not by a flag the author controls. Any world
    // that carries a spaceId is player/AI ground — its JS runs ONLY in the
    // sealed Worker (no DOM, cookies, or network), never new Function on the
    // main thread. Trusting worldData.__sandbox alone was escapable: an author
    // could add a hook (which set the flag) then set_world_data {__sandbox:null}
    // to clear it, and the un-flagged hook would then run on every visitor's
    // main thread. spaceId can't be cleared by a hook, so it's the real signal.
    // worldData.__sandbox still forces the box for any non-space untrusted path;
    // canonical CAFE/house scenes (no spaceId, no flag) keep the main thread.
    const untrusted = !!spaceId || !!worldData?.__sandbox
    if (untrusted && stepHooks && stepHooks.length > 0) {
      const box = new WorldSandbox()
      box.load(orderHooks(stepHooks, worldData).map(h => ({ id: h.id, code: h.code, author: (h as { author?: string }).author })))   // all hooks, isolated, in DECLARED __nodes order (legacy-neutral: no __nodes ⇒ array order); author carried for source-doc
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
    for (const h of orderHooks(stepHooks || [], worldData)) sim.addStepHook(h.id, h.author, h.description, h.code)
  }, [spaceId])
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
  // ARENA FEED — sandboxed hooks have no network (world-sandbox seals fetch by
  // design: that's the exfiltration wall, and it stays). Worlds that want the
  // REAL tournament (THE CHAIR's chant-truth) read `wd.arena` instead: the host
  // mirrors the public tournament:main doc into worldData here, the sandbox
  // already forwards all of worldData each tick, and the result merge only
  // writes back render keys + __state — so hooks can read it but never clobber
  // it. Same seam as wd.players. 20s cadence: the arena moves in minutes.
  useEffect(() => {
    let dead = false
    const pull = async () => {
      const sim = simulationRef.current
      if (!sim || !sandboxRef.current) return   // only sealed-hook worlds need the feed
      try {
        const r = await fetch('/api/engine/save?slot=tournament%3Amain', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json().catch(() => null)
        const d = j && (j as { data?: unknown }).data
        if (!dead && d && typeof d === 'object') (sim.worldData as Record<string, unknown>)['arena'] = d
      } catch { /* offline — hooks keep the last arena they saw */ }
    }
    pull()
    const iv = setInterval(pull, 20_000)
    return () => { dead = true; clearInterval(iv) }
  }, [])
  const inputRef = useRef<FieldInput | null>(null)
  const animFrameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  const lastFrameRef = useRef<number>(0)
  // GPU/frame budget meter — EMA of frame ms, published to worldData.__budget
  // every 2s so builders (human or AI, via the bridge) SEE cost before it hangs
  const frameMsEmaRef = useRef<number>(16)
  const syncBytesRef = useRef<number>(0)   // P0: last owner-sync wire size (bytes)
  // P1: name→hash of shaders the SERVER currently holds (per this session). Lets the
  // 2s sync send hash-only {name,hash} for unchanged visuals/modules. Self-heals — a
  // miss triggers a server `resync` and we resend full next tick.
  const syncedHashesRef = useRef<{ vis: Map<string, string>; mod: Map<string, string> }>({ vis: new Map(), mod: new Map() })
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
  // WorldAudio Phase A (DESIGN-world-audio.md): manifest bookkeeping + warn-once
  const lastSoundsDeclRef = useRef<unknown>(null)          // wd.sounds object identity — rescan on change
  const soundsLoadedRef = useRef<Map<string, string>>(new Map())  // id -> url actually loaded
  const warnedSoundsRef = useRef<Set<string>>(new Set())   // {name}-only misses already shouted
  // audio dies with its world: Web Audio sources keep playing after React
  // unmounts, so leaving the page must close the context explicitly
  useEffect(() => {
    const audio = audioRef.current
    return () => { audio.destroy(); sandboxRef.current?.dispose(); arenaRef.current?.close(); arenaRef.current = null }
  }, [])
  // no world's looping music/score outlives its scene. The full loadScene teardown
  // stops audio, but the VOTE RECKONING flicks between cached previews on a fast
  // path that bypasses it — so closing the reckoning (playScene: preview → hub)
  // left the previewed world's loop playing. Stop on EVERY playScene change; the
  // incoming scene re-triggers its own music, and stopMusic/stopScore are idempotent.
  useEffect(() => {
    const audio = audioRef.current
    return () => { audio.stopScore(); audio.stopMusic(0.25) }
  }, [playScene])
  // ── fault surface: when the world goes down, SAY WHY on screen ──
  const [fault, setFault] = useState<{ kind: string; message: string } | null>(null)
  const frameCrashRef = useRef(false)
  const faultReportedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const onFault = (e: Event) => {
      const det = (e as CustomEvent).detail as { kind: string; message: string
        loc?: { hookId: string; line: number; col: number }; snippet?: string; author?: string; gpuModel?: string; stack?: string }
      // FIRST fault wins the banner — later faults are usually echoes of it
      setFault(prev => prev ?? det)
      const sceneName = lastSceneRef.current || playScene || spaceSlug || 'unknown'
      try {
        const log = JSON.parse(localStorage.getItem('cc-fault-log') || '[]')
        log.unshift({ ...det, scene: sceneName, at: new Date().toISOString() })
        localStorage.setItem('cc-fault-log', JSON.stringify(log.slice(0, 8)))
        localStorage.setItem('cc-last-fault', JSON.stringify(log[0]))
      } catch { /* fine */ }
      // Bridge feedback: a GPU/uber-shader fault only the player's console can
      // see is invisible to the AI that built the world (a broken module took
      // VEILFIRE fully dark with zero telemetry, Jul 23). Land every distinct
      // fault in worldData (bridge GET) + the quarantine log (durable).
      const key = det.kind + '|' + det.message.slice(0, 120)
      if (faultReportedRef.current.has(key)) return
      faultReportedRef.current.add(key)
      const sim = simulationRef.current
      if (sim) {
        sim.worldData['last_compile_error'] = {
          type: 'gpu-fault', kind: det.kind, error: det.message.slice(0, 800),
          scene: sceneName, engine: ENGINE_BUILD, timestamp: Date.now(),
        }
      }
      void fetch('/api/engine/quarantine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: typeof location !== 'undefined' ? location.href : '',
          phase: 'cc-fault:' + det.kind,
          scene: sceneName,
          // one funnel — enriched at source where the engine holds it: the hook's
          // author + line + a marked snippet (hook faults), the GPU model (gpu loss),
          // or the raw stack when the line format isn't parsed yet (WebKit).
          hazards: [{
            name: det.loc?.hookId || det.kind,
            reason: (det.message + ' · ' + ENGINE_BUILD + ' · ' + (typeof navigator !== 'undefined' ? navigator.userAgent : '')).slice(0, 800),
            author: det.author,
            line: det.loc?.line,
            col: det.loc?.col,
            snippet: det.snippet,
            gpuModel: det.gpuModel,
            stack: det.stack,
          }],
        }),
      }).catch(() => { /* telemetry must never break the world */ })
    }
    window.addEventListener('cc:fault', onFault)
    return () => window.removeEventListener('cc:fault', onFault)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the cafe mute switch rules world audio too — one button, all sound
  useEffect(() => {
    const audio = audioRef.current
    // ONE audio system: adopt the cafe's shared AudioContext so world music and
    // shell sfx live on a single context with a single mute + resume lifecycle.
    try { const bus = worldBus(); if (bus) audio.attach(bus.ctx, bus.dest) } catch { /* no audio device */ }
    // read-only stats for headless smokes (DESIGN-world-audio.md §6)
    ;(window as unknown as { __cafeAudio?: unknown }).__cafeAudio = () => audio.stats()
    // mute is now governed by the shared worldGain; this stays as belt-and-
    // suspenders for any world created before the shared bus existed.
    try { if (localStorage.getItem('cc-mute')) audio.setVolume(0) } catch { /* fine */ }
    const onMute = (e: Event) => audio.setVolume((e as CustomEvent).detail ? 0 : 1)
    // world sounds fire from the frame loop, where browsers refuse to birth an
    // AudioContext — the player's first real gesture unlocks it here instead
    const onGesture = () => audio.unlock()
    window.addEventListener('pointerdown', onGesture, { capture: true })
    window.addEventListener('keydown', onGesture, { capture: true })
    // Returning to a backgrounded tab leaves the AudioContext SUSPENDED — the
    // looping score falls silent and, until now, only a fresh click revived it.
    // Resume the instant the tab is visible/focused again so music never stays
    // dead after an alt-tab. (unlock() = ensureContext(), which resumes.)
    const onVisible = () => { if (!document.hidden) audio.unlock() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
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
    // BFCACHE IS A LIE for this engine: browser-back restores the page's frozen
    // heap instead of loading it, and the plumbing wakes up half-dead — the
    // pagehide handler already disconnected the presence socket (a manual
    // socket.io disconnect never auto-reconnects), hook/worker clocks are stale,
    // and the GPU device may be lost — while the rAF loop resumes and paints
    // shader-time animation over frozen uniforms. The visible symptom: the hub
    // glyph pinned over the door you left through, forever ("cursor location
    // freeze" on browser-back, Aug 10). One honest reload turns browser-back
    // into the same clean load the ◂ button does. persisted=true is strictly
    // a bfcache restore, so this never fires on a normal load (no loop).
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) window.location.reload() }
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('cafe:muted', onMute)
      window.removeEventListener('pointerdown', onGesture, { capture: true })
      window.removeEventListener('keydown', onGesture, { capture: true })
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
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
  // THE UI SYSTEM — this frame's solved layout (rects/boxes/runs/hits from
  // worldData.ui via the ui-solver) + a geometry fingerprint so __uiRects only
  // republishes on real change
  const uiSolvedRef = useRef<SolvedUi | null>(null)
  const uiRectsFpRef = useRef(-1)
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
  // the floating BUILDERBOX (né build console) — surfaced on every world, auto-
  // opens during a live build, closed with its ✕. buildConsoleClosedRef remembers
  // a manual close so the auto-open doesn't fight it. The box merges the AI build
  // log with the world's chat: ANY entry posted here also lands on the network
  // (commons ping + builderbox:queue) as an INVITATION — watching AIs choose.
  const [buildConsoleOpen, setBuildConsoleOpen] = useState(false)
  // ◈ AI VIEW dismiss (Galen: "ai view is stuck open"): a parked swarm map keeps
  // (buildConsoleOpen || !!swarm) true forever, so the panel had no OFF. The ✕
  // dismisses it for the session; opening the BuilderBox brings it back.
  const [aiViewDismissed, setAiViewDismissed] = useState(false)
  useEffect(() => { if (buildConsoleOpen) setAiViewDismissed(false) }, [buildConsoleOpen])
  const buildConsoleClosedRef = useRef(false)
  // BuilderBox "AI focus" — worldData.ai_focus is auto-set on every AI world-edit
  // ({action, fieldName, at}); poll it so the human can see what the AI is doing.
  const [aiFocus, setAiFocus] = useState<{ action?: string; fieldName?: string; at?: number; error?: { name: string; type: string; error: string } | null } | null>(null)
  // the AI's eye — the latest render_probe PNG the bridge stashed to slot ai_eye:<scope>
  const [aiEye, setAiEye] = useState<{ png?: string; at?: number; name?: string; stats?: { meanLum?: number; maxLum?: number; coveragePct?: number; visible?: boolean; motion?: number; visual?: string; errors?: number; hookErrors?: number; dominantColors?: number[][] } } | null>(null)
  // ◈ AI VIEW tabs — EYE (focus + render) and NODES (the world's architecture graph).
  // The whole world IS a node graph: modules → visuals → fields, with hooks driving the
  // uniforms the visuals read. Tier-1 is read-only + inspector; the same nodes are built
  // to become draggable/wireable in Tier-2 (structural nodes are human-editable).
  const [aiViewTab, setAiViewTab] = useState<'eye' | 'nodes' | 'swarm'>('eye')
  const [nodeGraph, setNodeGraph] = useState<AiNodeGraph | null>(null)
  const [nodesExpanded, setNodesExpanded] = useState(false)
  // The SWARM work-graph for this world — the game-element tree (elements, subnodes,
  // status, who's docked, connections). Null on worlds with no swarm graph.
  // ── POLL DISCIPLINE (the Jul 31 spike): the first version of this polled every
  //    4s on EVERY space tab, panel or not, hidden or not — the same ungated-poll
  //    bug class the perf poll below already documents. One forgotten tab was
  //    ~21,600 function requests a night. Now: ONE discovery fetch per world, then
  //    a poll that (a) skips hidden tabs entirely, (b) runs 8s only while the
  //    swarm is ACTIVE (an agent docked somewhere), (c) idles at 60s otherwise.
  const [swarm, setSwarm] = useState<{ project: string; done: number; total: number; nodes: SwarmNodeView[] } | null>(null)
  const swarmActiveRef = useRef(false)
  useEffect(() => {
    if (!spaceSlug) { setSwarm(null); return }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const anyClaim = (ns: SwarmNodeView[]): boolean => ns.some(n => !!(n as { claim?: unknown }).claim || anyClaim((n as { children?: SwarmNodeView[] }).children || []))
    const pull = async () => {
      try {
        const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/swarm`)
        if (r.ok && alive) { const d = await r.json(); setSwarm(d.map || null); swarmActiveRef.current = !!d.map && anyClaim(d.map.nodes || []) }
      } catch { /* offline is fine */ }
    }
    const loop = async () => {
      if (!alive) return
      if (!document.hidden) await pull()
      if (!alive) return
      timer = setTimeout(loop, swarmActiveRef.current ? 8000 : 60000)
    }
    pull().then(() => { if (alive) timer = setTimeout(loop, swarmActiveRef.current ? 8000 : 60000) })
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [spaceSlug])
  // A world with a swarm graph shows the AI-VIEW panel even with the build console
  // closed — the architecture is worth seeing on its own (one AI or ten). When it
  // opens that way, default to the SWARM tab (once; the user can switch freely after).
  const swarmAutoRef = useRef(false)
  useEffect(() => {
    if (swarm && !swarmAutoRef.current && !buildConsoleOpen) { swarmAutoRef.current = true; setAiViewTab('swarm') }
  }, [swarm, buildConsoleOpen])
  // P0 telemetry readout — frame/hook/compile budgets sampled from the live engine.
  const [perf, setPerf] = useState<{ frameMs: number; hookMs: number; topHook: [string, number] | null; compileMs: number; compileAgeS: number; fields: number; syncKB: number } | null>(null)
  useEffect(() => {
    // ONLY poll while the AI VIEW panel is actually open. This was ungated and ran
    // on EVERY visitor tab forever — two /api/engine/save function hits every 1.8s
    // per tab — which spiked prod Function Invocations ~16×. The data is only shown
    // inside the BuilderBox, so there's no reason to fetch it when it's closed.
    if (!buildConsoleOpen) return
    const iv = setInterval(async () => {
      // scope key mirrors the bridge (route.ts `aiScope`): spaces key by spaceId,
      // house/scene worlds by 'scene:<base-slug>' so the panel works on house content.
      const base = (lastSceneRef.current || playScene || spaceSlug || '').split(' ⑂ ')[0]
      const scope = spaceId
        ? spaceId
        : (base ? 'scene:' + base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) : null)
      // FOCUS — spaces get it live in worldData; house worlds read the durable slot.
      const wdFocus = simulationRef.current?.worldData?.['ai_focus'] as { action?: string; fieldName?: string; at?: number; error?: { name: string; type: string; error: string } | null } | undefined
      if (wdFocus && typeof wdFocus === 'object') setAiFocus(wdFocus)
      else if (scope) {
        try {
          const r = await fetch('/api/engine/save?slot=' + encodeURIComponent('ai_focus:' + scope))
          if (r.ok) { const d = await r.json(); setAiFocus(d && d.data && typeof d.data === 'object' ? d.data : null) }
        } catch { /* focus is a courtesy */ }
      } else setAiFocus(null)
      // EYE — show the NEWER of the AI's render_probe (ai_eye) and the human's own
      // snapshot (human_shot), both under this scope. Fetching ai_eye alone clobbered
      // a just-captured human view ~1.8s later (and never redisplayed it on reload).
      if (scope) {
        try {
          const [ra, rh] = await Promise.all([
            fetch('/api/engine/save?slot=' + encodeURIComponent('ai_eye:' + scope)).then(x => x.ok ? x.json() : null).catch(() => null),
            fetch('/api/engine/save?slot=' + encodeURIComponent('human_shot:' + scope)).then(x => x.ok ? x.json() : null).catch(() => null),
          ])
          const pick = (d: { data?: { png?: string }; png?: string } | null, name: string) => {
            const e = (d && d.data && d.data.png ? d.data : (d && d.png ? d : null)) as { png?: string; at?: number; name?: string } | null
            return e && e.png ? { ...e, name: e.name || name } : null
          }
          const best = [pick(ra, 'AI probe'), pick(rh, 'your view')].filter(Boolean).sort((a, b) => (b!.at || 0) - (a!.at || 0))[0]
          if (best) setAiEye(best)
        } catch { /* the eye is a courtesy */ }
      }
    }, 1800)
    return () => clearInterval(iv)
  }, [buildConsoleOpen, spaceId, spaceSlug, playScene])
  // ── HUMAN SNAPSHOT → the AI's eye. A builder watching a world an AI is editing
  //    can hand the AI THEIR live frame: capture the canvas and POST it to slot
  //    human_shot:<scope> (same scope key + storage the AI's own eye uses). A
  //    docked AI — even a headless one over the bridge — reads it via
  //    GET /api/engine/save?slot=human_shot:<scope>. Universal infra: any world. ──
  const [humanShot, setHumanShot] = useState<'idle' | 'sending' | 'sent' | 'err'>('idle')
  const sendHumanShot = useCallback(async () => {
    const base = (lastSceneRef.current || playScene || spaceSlug || '').split(' ⑂ ')[0]
    const scope = spaceId
      ? spaceId
      : (base ? 'scene:' + base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) : null)
    if (!scope) { showToast('no world scope for the snapshot', 'error'); return }
    setHumanShot('sending')
    try {
      // Capture the EXACT on-screen frame: requestFrameCapture queues it so render()
      // hands back the real presented texture next frame (a bare capture on this click
      // grabs a blank/next frame). Race a timeout so a paused world can't hang the button.
      const rr = rendererRef.current as unknown as { requestFrameCapture?: (m?: number, q?: number) => Promise<string | null>; captureCanvasJpeg?: (m?: number, q?: number) => Promise<string | null> }
      const png = await Promise.race([
        rr?.requestFrameCapture?.(512, 0.82) ?? rr?.captureCanvasJpeg?.(512, 0.82) ?? Promise.resolve(null),
        new Promise<null>((res) => setTimeout(() => res(null), 1500)),
      ])
      if (!png) throw new Error('no-frame')
      // Show what was captured right in the eye, so it's visibly the real frame.
      setAiEye({ png, at: Date.now(), name: 'your view' })
      // also snapshot the VIEW DATA (camera + player pose) so a headless AI knows
      // WHERE this frame was shot from, not just the pixels.
      const wd = (simulationRef.current?.worldData || {}) as Record<string, unknown>
      const gu = Array.isArray(wd.gpuUniforms) ? (wd.gpuUniforms as number[]) : []
      const vf = (wd.__vf || {}) as Record<string, number>
      const view = { camera: gu.slice(240, 248), player: { px: vf.px, py: vf.py, pz: vf.pz, yaw: vf.yaw, pitch: vf.pitch }, scene: base }
      const r = await fetch('/api/engine/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: 'human_shot:' + scope, data: { png, view, at: Date.now(), by: 'human' } }),
      })
      if (!r.ok) throw new Error(String(r.status))
      setHumanShot('sent'); showToast('📸 your view was sent to the AI', 'success')
      setTimeout(() => setHumanShot('idle'), 2500)
    } catch { setHumanShot('err'); showToast('snapshot failed — try again', 'error'); setTimeout(() => setHumanShot('idle'), 2500) }
  }, [spaceId, playScene, spaceSlug])
  // Snapshot the live world into a node graph (engine/ai-view/NodeGraph).
  const snapshotNodeGraph = useCallback((): AiNodeGraph => buildNodeGraph(simulationRef.current, rendererRef.current, simulationRef.current ? allStepHookSnapshots(simulationRef.current) : undefined), [allStepHookSnapshots])
  // Keep the graph fresh while the BuilderBox is open (cheap ref reads).
  useEffect(() => {
    if (!buildConsoleOpen) return
    const tick = () => {
      setNodeGraph(snapshotNodeGraph())
      // P0 perf sample: frame ms (existing EMA) + hook ms (sim) + compile (renderer)
      const sim = simulationRef.current
      const r = rendererRef.current as unknown as { compilePerf?: { lastMs: number; at: number } } | null
      const hp = sim?.hookPerf
      let topHook: [string, number] | null = null
      if (hp) for (const [id, ms] of hp.perHook) if (!topHook || ms > topHook[1]) topHook = [id, ms]
      const cp = r?.compilePerf
      setPerf({
        frameMs: frameMsEmaRef.current || 0,
        // sandbox (/space) worlds run hooks in the Worker → sim.hookPerf is empty;
        // take the Worker-reported cost so the HUD isn't stuck at 0.0ms for them.
        hookMs: Math.max(hp?.totalMs || 0, sandboxRef.current?.lastHookMs || 0),
        topHook,
        compileMs: cp?.lastMs || 0,
        compileAgeS: cp?.at ? (Date.now() - cp.at) / 1000 : Infinity,
        fields: sim?.fields.size || 0,
        syncKB: syncBytesRef.current / 1024,
      })
    }
    tick()
    const iv = setInterval(tick, 1500)
    return () => clearInterval(iv)
  }, [buildConsoleOpen, snapshotNodeGraph])
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
  // true while the click that ENGAGED pointer-lock is still held — swallow it for
  // gameplay so click-to-lock (or re-lock after Esc) doesn't also fire (misfire fix)
  const lockSwallow = useRef(false)
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
  // PHASE-0 instrumentation: publish WHO I currently see (ids) for the harness/overlay
  useEffect(() => {
    try {
      const w = window as unknown as { __ccPresenceDbg?: Record<string, unknown> }
      w.__ccPresenceDbg = { ...(w.__ccPresenceDbg || {}), others: presenceOthers.map(o => o.id), n: presenceOthers.length }
    } catch { /* no window */ }
  }, [presenceOthers])
  const presenceIdRef = useRef<string>('')
  // persistent socket + its current room — so a ROOM change (presenceKey) switches
  // rooms on the LIVE socket via join-instance instead of tearing the whole
  // presence effect down (that reconnect re-registered glyph modules → shader
  // recompile → cursor blink; the churn that "broke" cursors on hub navigation).
  const socketRef = useRef<Socket | null>(null)
  const roomRef = useRef<string>('')
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
    // PHASE-0 instrumentation (web/docs/presence-nesting-spec.md): expose the live
    // room + who I currently see, for the two-client Playwright harness and the
    // ⌥⇧P overlay. Read-only — nothing in the app consumes it.
    try {
      const w = window as unknown as { __ccPresenceDbg?: Record<string, unknown> }
      w.__ccPresenceDbg = { ...(w.__ccPresenceDbg || {}), room: 'cursors:' + world, scene: playScene || spaceSlug || '', me: presenceIdRef.current }
    } catch { /* no window */ }
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
    socketRef.current = socket
    roomRef.current = world   // the room-switch effect keeps this current on presenceKey changes
    const announce = () => {
      socket.emit('auth', { userId: id, name: id, color: `hsl(${hueOf(id)},70%,60%)`, spaceSlug: roomRef.current, glyph: playerGlyphWgsl() })
    }
    socket.on('connect', () => {
      console.log('[cursors] connected', socket.id)
      announce()
      socket.emit('join-instance', { instance: 'cursors:' + roomRef.current })
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
      clearInterval(idleSweep); window.removeEventListener('pagehide', onPageHide); socketRef.current = null; socket.disconnect() }
  // presenceKey is NOT a dep — a room change switches on the live socket below,
  // never a teardown. spaceId/playScene DO reconnect (a genuinely different world).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, playScene])

  // ROOM SWITCH without churn: when only presenceKey changes (hub view → view),
  // move the live socket to the new room via join-instance (the server leaves the
  // old room, server.js:137) — no disconnect, no glyph re-register, no recompile.
  useEffect(() => {
    const s = socketRef.current
    if (!s) return
    const world = spaceId || presenceKey || playScene || 'global'
    if (roomRef.current === world) return
    roomRef.current = world
    // drop the just-left room's pips so none linger from the old view; the new
    // room's instance-state prunes the buffers to its own members on arrival
    setPresenceOthers(prev => (prev.length ? [] : prev))
    seenPipsRef.current = new Set()
    try { const w = window as unknown as { __ccPresenceDbg?: Record<string, unknown> }; w.__ccPresenceDbg = { ...(w.__ccPresenceDbg || {}), room: 'cursors:' + world } } catch { /* no window */ }
    // the server keeps our identity/glyph across the move, so join-instance alone
    // switches rooms — no re-auth needed
    if (s.connected) s.emit('join-instance', { instance: 'cursors:' + world })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceKey])
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
  // scene list / save / load / branch / version IO lives in scene-io.ts (carve
  // Phase 3). Wrappers keep the ORIGINAL dep arrays — memoization + the stale-
  // closure semantics are unchanged; deps bags are built at call time.
  const refreshSceneList = useCallback(async () => sceneIO.refreshSceneList({ setSavedScenes }), [])

  /** Snapshot the live world under a given name — scene-io.saveSceneAs (returns
   *  the name ACTUALLY saved under; the store forks on overwrite) */
  const saveSceneAs = useCallback((sceneName: string, extraWorldData?: Record<string, unknown>): Promise<string | null> =>
    sceneIO.saveSceneAs({ simulationRef, rendererRef, allStepHookSnapshots }, sceneName, extraWorldData), [])

  /** Mint a BRANCH-scoped token for a scene branch — scene-io.mintBranchToken */
  const mintBranchToken = useCallback((sceneName: string) => sceneIO.mintBranchToken({ setPlugBusy, setPlugToken }, sceneName), [])

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
  const loadLineage = useCallback(() => sceneIO.loadLineage({ lastSceneRef, playScene, spaceSlug, setLineageBusy, setLineageTrail, setLineageRemixes }), [playScene, spaceSlug])
  /** UNIFIED prompt-open — the CONNECT-AI window MUST be seen by every user, so
   *  opening it dismisses whatever could cover or compete with it. Root cause of
   *  "the user didn't see the prompt": the edit coach sits at z-[58], ABOVE the
   *  old z-50 prompt, and other z-50 chrome (build console, branches, versions)
   *  shares its layer. This closes those AND the box itself now rides a dedicated
   *  top-most layer (z-[70]). One path in, always visible. */
  const openPlug = useCallback(() => {
    setEditCoach(false)
    setBuildConsoleOpen(false)
    setBranchesOpen(false)
    setVersionsOpen(false)
    setPlugOpen(true)
  }, [])
  const createBranch = useCallback((labelRaw: string) => sceneIO.createBranch({
    me, playScene, spaceSlug, lastSceneRef, saveSceneAs, mintBranchToken, setPlugToken, setBranchCreateOpen, showToast, openPlug,
  }, labelRaw),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [me, playScene, spaceSlug, saveSceneAs, mintBranchToken, openPlug])
  // ?room=<name> — a SHAREABLE room link: /space/<slug>?room=crew1 drops you
  // into that authoritative arena room (lobby worlds stay local without it).
  // "sharing a link is sharing a room" — the play-together twin of invites.
  const roomFromUrlRef = useRef<string | null>(null)
  useEffect(() => {
    try { roomFromUrlRef.current = new URL(window.location.href).searchParams.get('room') } catch { /* ssr */ }
  }, [])

  // a fresh fork arrives with the AI TERMINAL already opening (?connect=1) —
  // the prompt line, not a form, is where creation happens (Galen's ruling)
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.get('connect') === '1') {
        url.searchParams.delete('connect')
        window.history.replaceState(null, '', url.toString())
        setTimeout(() => { openConnectAi() }, 1400)   // let the world settle first
      }
    } catch { /* ssr */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ⚭ INVITE — one-time join link, minted and copied in one tap (moved out
  // of WORLD TOOLS to the edit dock per Galen). First to open it joins the crew.
  const inviteBusyRef = useRef(false)
  const mintInviteLink = useCallback(async () => {
    if (inviteBusyRef.current || !spaceSlug) return
    inviteBusyRef.current = true
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/invite`, { method: 'POST' })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.joinUrl) {
        const ok = await copyText(d.joinUrl)
        showToast(ok ? 'one-time invite link copied' : d.joinUrl, ok ? 'success' : 'info',
          'first to open it joins your crew — the link dies on use; mint one per person')
      } else showToast(d?.error || 'invite mint failed', 'error')
    } catch { showToast('invite mint failed — are you offline?', 'error') }
    finally { inviteBusyRef.current = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceSlug])

  const instantForkSpace = useCallback(async () => {
    if (!me) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname) ; return }
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug || '')}/fork`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.space?.slug) window.location.href = `/space/${d.space.slug}?connect=1`
      else showToast(d?.error || 'fork failed', 'error')
    } catch { showToast('fork failed — are you offline?', 'error') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, spaceSlug])

  const handleBranch = useCallback(() => {
    if (!me) { window.location.href = '/auth/signin'; return }
    setBranchLabel(''); setBranchBrief('')
    setBranchCreateOpen(v => !v)
  }, [me])

  // OPEN GROUND notice (Galen): entering a house world quietly says editing is
  // allowed — once per world per session. A save FORKS it into a world the
  // saver owns (fork paradigm); the original stays immortal.
  const openGroundToldRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const cur = playScene || ''
    if (!cur || spaceId || cur.includes(' ⑂ ') || cur === 'CAFE' || cur === 'SUB-MAIN') return
    if (openGroundToldRef.current.has(cur)) return
    openGroundToldRef.current.add(cur)
    showToast('☕ open ground — this house world is everyone’s to edit', 'info',
      'Edit freely; saving forks it into your own world. The original is immortal.')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene, spaceId])

  const handleSaveScene = useCallback(() => sceneIO.saveScenePrompted({ simulationRef, rendererRef, allStepHookSnapshots, showToast, refreshSceneList }), [showToast, refreshSceneList])

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
      // A heavy raymarched uber-shader can compile well past a few seconds. The
      // compile is ASYNC (createComputePipelineAsync) so the page stays live and
      // the spinner animates — keep the curtain up until the pipeline is ACTUALLY
      // ready instead of yanking it at 4s (which left a black screen mid-compile,
      // the "veilfire loads dark" bug). Long safety cap so a broken world still
      // resolves; past a beat, say COMPILING so a slow load never reads as frozen.
      if (!ready && Date.now() - t0 > 2500) setLoadHeavy(true)
      if (ready || Date.now() - t0 > 25000) {
        setLoadHeavy(false)
        setTimeout(() => { setWorldLoading(false); setSwapFade(false) }, 260)   // settle beat
        return
      }
      setTimeout(tick, 60)
    }
    tick()
  }, [])

  // Compile every field's effects IN PARALLEL. The old pattern — a serial
  // `await compileFieldEffect` per effect — paid the SUM of every WGSL compile on
  // a cold load; a world with N effect shaders stalled N compiles deep behind the
  // curtain. Identical shaders share one hash-keyed, refcounted GPU pipeline, and
  // compiling duplicates concurrently would race that refcount — so compile each
  // UNIQUE shader once in parallel, then register the duplicates (pure cache hits)
  // after, keeping the refcount exact. One truth for all three load paths.
  const compileEffectsParallel = useCallback(async (sim: FieldSimulation, renderer: FieldRenderer) => {
    const mod = getModCode()
    const pairs: { key: string; fieldId: string; wgsl: string }[] = []
    for (const field of sim.fields.values())
      for (const effect of field.effects)
        pairs.push({ key: `${field.id}_${effect.id}`, fieldId: field.id, wgsl: effect.wgsl })
    if (pairs.length === 0) return
    const seen = new Set<string>()
    const unique: typeof pairs = [], dups: typeof pairs = []
    for (const p of pairs) { if (seen.has(p.wgsl)) dups.push(p); else { seen.add(p.wgsl); unique.push(p) } }
    await Promise.all(unique.map(p => renderer.compileFieldEffect(p.key, p.fieldId, p.wgsl, mod)))
    for (const p of dups) await renderer.compileFieldEffect(p.key, p.fieldId, p.wgsl, mod)
  }, [getModCode])

  // Load a saved scene (replaces current state)
  // WORLD-SWAP HYGIENE — scene-io.resetWorldIdentity (carve Phase 3): a swap
  // SWITCHES OUT the whole node. Call BEFORE applying any incoming snapshot at
  // every swap site; NOT for live same-world updates.
  const resetWorldIdentity = useCallback(() => sceneIO.resetWorldIdentity({
    simulationRef, rendererRef, swapAtRef, audioRef, lastSoundsDeclRef, soundsLoadedRef, warnedSoundsRef, arenaRef, sandboxRef,
  }), [])

  // Load a saved scene (replaces current state) — scene-io.loadScene
  const handleLoadScene = useCallback(async (sceneName: string, preScene?: unknown) => sceneIO.loadScene({
    resetWorldIdentity, simulationRef, rendererRef, lastSceneRef, setPlugToken, setRiding, setWorldLoading,
    fadeToBlack, liftWhenSettled, audioRef, cachedOverlapMasksRef, installHooks, setRunning,
    getModCode, updateSelectionMask, syncFields, showToast,
  }, sceneName, preScene), [showToast, getModCode, syncFields, updateSelectionMask, fadeToBlack, liftWhenSettled])
  const handleLoadSceneRef = useRef(handleLoadScene)
  handleLoadSceneRef.current = handleLoadScene

  /** MAIN version scroller step — scene-io.goBaseVer */
  const goBaseVer = useCallback((pos: number) => sceneIO.goBaseVer({ playScene, baseVers, handleLoadScene, setBaseVerPos }, pos), [playScene, baseVers, handleLoadScene])

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
  // JSON of the fields in the snapshot this tab last RENDERED (full load OR hot-swap).
  // hotSwapLive diffs the incoming snapshot's fields against this: identical ⇒ a pure
  // shader/hook edit (safe to swap in place); ANY difference ⇒ a field edit the owner
  // tab's 2s sync (fields+worldData+hooks, ~line 1604) could clobber — take the reload.
  const lastFieldsRef = useRef<string>('')

  /** hot-swap a SPACE version in place — scene-io.hotLoadSpaceVersion. lastFieldsRef
   *  is threaded through so the reload path re-baselines the hot-swap field-diff guard. */
  const hotLoadSpaceVersion = useCallback((v: number | undefined) => sceneIO.hotLoadSpaceVersion({
    resetWorldIdentity, spaceSlug, reloadingRef, pendingReloadRef, renderedRevRef, lastFieldsRef, hotLoadSpaceVersionRef,
    handleLoadScene, greetInstructions, setSpaceVer,
  }, v), [spaceSlug, handleLoadScene])
  hotLoadSpaceVersionRef.current = hotLoadSpaceVersion

  // LIVE HOT-SWAP (live-hotswap experiment) — when an external edit bumps the rev
  // but only the SHADERS / HOOKS / config-worldData changed (not the field
  // structure), swap them in place: registerVisualType/registerModule rebuild
  // ONLY the GPU pipeline, sandbox.load re-installs the hooks — with the sim STILL
  // TICKING. No resetWorldIdentity, no field teardown, so the player's
  // camera/position/pointer-lock/audio are untouched. Returns false if the change
  // is structural (a field add/remove/rebind), in which case the caller takes the
  // safe full reload. This is "edit the live state directly", per Galen.
  const hotSwapLive = useCallback(async (rev: number): Promise<boolean> => {
    const sim = simulationRef.current, renderer = rendererRef.current
    if (!sim || !renderer || !spaceSlug) return false
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/snapshot`, { cache: 'no-store' })
      if (!r.ok) return false
      const { snapshot } = await r.json()
      if (!snapshot) return false
      // SAFETY GUARD — hot-swap ONLY a pure shader/hook edit. Diff the incoming
      // snapshot's fields against the ones this tab last RENDERED: identical ⇒ the
      // edit touched only visuals/modules/stepHooks (safe to swap in place). ANY
      // field difference — add/remove/rebind OR a property (move/color/shape) — means
      // the owner tab's 2s sync could push stale fields back OVER this edit, so bail
      // to the full reload. No baseline yet ⇒ bail too (never guess).
      const nextFields = JSON.stringify((snapshot.fields ?? []) as unknown)
      if (!lastFieldsRef.current || nextFields !== lastFieldsRef.current) return false
      // 1) SHADERS — re-register in place; the renderer swaps the pipeline object.
      if (snapshot.modules) for (const m of snapshot.modules) renderer.registerModule(m.name, m.wgsl)
      if (snapshot.visualTypes) for (const vt of snapshot.visualTypes) renderer.registerVisualType(vt.name, vt.wgsl)
      for (const f of sim.fields.values()) {
        if (f.visualTypeName) { const id = renderer.resolveVisualType(f.visualTypeName); if (id !== undefined) f.visualType = id }
      }
      // 2) HOOKS — re-install in the EXISTING sandbox (run-state lives in worldData,
      //    kept below). KNOWN GAP (documented in the bridge, space-store
      //    add_step_hook): if this world loaded HOOK-LESS, sandboxRef.current is
      //    null (the sandbox is only created on load when stepHooks.length>0), so a
      //    hot-ADDED first hook can't be installed here and won't run until a
      //    reload. TODO: instantiate the sandbox in place when snapshot.stepHooks
      //    appear and sandboxRef.current is null.
      if (Array.isArray(snapshot.stepHooks) && sandboxRef.current) {
        liveHooksRef.current = new Map((snapshot.stepHooks as { id: string; author: string; description: string; code: string }[]).map(h => [h.id, h]))
        sandboxRef.current.load((snapshot.stepHooks as { id: string; code: string }[]).map(h => ({ id: h.id, code: h.code })))
      }
      // 3) worldData — merge the server's CONFIG/shape keys; NEVER the live run-state
      //    (save/presence/input/gpu*) or transient engine keys (__*, except the rev).
      const KEEP_LOCAL = new Set(['save', 'presence', 'input', 'players', 'gpuUniforms', 'gpuPopulation', 'cellSample', 'fieldPixels'])
      const wd = (snapshot as { worldData?: Record<string, unknown> }).worldData || {}
      for (const [k, v] of Object.entries(wd)) {
        if (KEEP_LOCAL.has(k)) continue
        if (k.startsWith('__') && k !== '__bridge_rev') continue
        ;(sim.worldData as Record<string, unknown>)[k] = v
      }
      lastFieldsRef.current = nextFields   // this tab now reflects the swapped snapshot
      renderedRevRef.current = rev
      return true
    } catch { return false }
  }, [spaceSlug])
  const hotSwapLiveRef = useRef<((rev: number) => Promise<boolean>) | null>(null)
  hotSwapLiveRef.current = hotSwapLive

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
      if (visitingRef.current) return              // visiting a hubworld member — hold home's adopts
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
          // Try the in-place hot-swap first — shaders/hooks/config change with the
          // sim still ticking, no reload. Fall back to the full reload only when
          // the field STRUCTURE changed (a real scene swap).
          const swapped = await hotSwapLiveRef.current?.(rev)
          if (!swapped) {
            showToast('⚡ this world was just updated — reloading', 'success')
            hotLoadSpaceVersion(undefined)
          }
        }
      } catch { /* next heartbeat */ }
    }, 10000)
    return () => clearInterval(iv)
  }, [spaceSlug, spaceVer, hotLoadSpaceVersion, showToast])

  const handleDeleteScene = useCallback((sceneName: string) => sceneIO.deleteScene({ showToast, refreshSceneList }, sceneName), [showToast, refreshSceneList])

  /** branch heads of the current base world — scene-io.loadBranchHeads */
  const loadBranchHeads = useCallback(() => sceneIO.loadBranchHeads({ lastSceneRef, playScene, spaceSlug, setBranchList }), [playScene, spaceSlug])

  /** ◂/▸ on the BRANCH button: step the ring [main, branch, branch, …] — quick
   *  browsing for everyone, owner or visitor. Looking is free. */
  // know the family on arrival — the BROWSE arrows only render when there is
  // actually somewhere to browse to
  useEffect(() => {
    if (!playScene && !spaceSlug) return
    loadBranchHeads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene, spaceSlug, riding])

  const stepBranch = useCallback((dir: 1 | -1) => sceneIO.stepBranch({ loadBranchHeads, lastSceneRef, spaceSlug, playScene, handleLoadScene, showToast }, dir), [loadBranchHeads, spaceSlug, playScene, handleLoadScene, showToast])

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
  // BuilderBox is a per-world surface — going back to main/a hub must CLOSE it
  // (it was staying open on the cafe, hanging over the bubbles). Reset on the
  // scene change, not just hide via the render gate, so its state is clean.
  useEffect(() => {
    if (playScene === 'CAFE' || playScene === 'SUB-MAIN') {
      setBuildConsoleOpen(false)
      buildConsoleClosedRef.current = false
    }
  }, [playScene])
  useEffect(() => {
    // the main door is ALWAYS a hub — no branch or version chrome there,
    // only the sub-main space link. Other worlds declare hubness via portals.
    setIsHub(playScene === 'CAFE')
    // grace: the departing hub's hook can dispatch a frame or two past the
    // scene change — a stale portals event must not brand the NEW world a hub.
    // And hub-ness DECAYS (Galen: "no EDIT in alembic/house worlds"): entering
    // a world FROM the cafe could catch one stray re-announce past the grace
    // and hide the whole edit surface forever. Real hubs re-announce every 2s
    // on a timer — so if no portals arrive for 6s, this world is not a hub.
    const bornAt = Date.now()
    let lastPortals = 0
    const onPortals = () => { if (Date.now() - bornAt > 600) { lastPortals = Date.now(); setIsHub(true) } }
    window.addEventListener('cafe:portals', onPortals)
    const decay = setInterval(() => {
      if (playScene !== 'CAFE' && lastPortals && Date.now() - lastPortals > 6000) { lastPortals = 0; setIsHub(false) }
    }, 2000)
    return () => { window.removeEventListener('cafe:portals', onPortals); clearInterval(decay) }
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
        // SERVER HALF (Galen, Aug 9 — veilfire-3d): the owner tab's 2s sync had
        // persisted the live run state into the space snapshot, so a client-only
        // reset was undone seconds after the reload when the rev-watcher merged
        // the un-reset server copy back in ("reset properly, then put me back
        // where I was"). Reset the STORED snapshot too; its __bridge_rev bump
        // also makes any other stale tab reload instead of syncing old state
        // back. Guests 404 harmlessly (their state never syncs).
        //
        // AWAIT the reset before reloading (Galen, Aug 9). The old 1.5s race
        // reloaded when EITHER the reset OR the timer won — but resetWorld does
        // several DB round-trips and for an owner with real state can exceed
        // 1.5s, so the reload beat the reset and the fresh page fetched the
        // STILL-un-reset snapshot: "R reloads in the exact same space." Now the
        // fetch resolving means the server has written the reset, so the reload's
        // snapshot fetch is guaranteed clean. The 6s cap is a dead-network
        // backstop ONLY — a normal reset finishes well under a second.
        const srvReset: Promise<unknown> = spaceSlug
          ? fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/reset`, { method: 'POST', credentials: 'same-origin' }).catch(() => null)
          : Promise.resolve(null)
        // PLAYER HALF (Galen, Aug 10 — "tideglass and veilfire keep reloading
        // the game state as it is"): the world reset alone is NOT a fresh game,
        // because boot's tryLoad pours the player's own :__autosave/:__state
        // rows right back in. R must reset THIS PLAYER too: null both rows
        // (the loaders skip null data) in the same await barrier. And silence
        // every save writer FIRST — the frame-loop autosave and the pagehide
        // flush all gate on autoSaveReadyRef, and either one firing after the
        // purge would write the pre-reset state straight back (the flush fires
        // ON the reload we're about to trigger).
        autoSaveReadyRef.current = false
        const baseR = (lastSceneRef.current || playScene || spaceSlug || '').split(' ⑂ ')[0]
        const nullSlot = (slot: string) => fetch('/api/engine/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot, data: null, scope: 'user', anon: whoRef.current }),
        }).catch(() => null)
        const playerReset = Promise.allSettled([nullSlot(`${baseR}:__autosave`), nullSlot(`${baseR}:__state`)])
        void Promise.race([Promise.all([srvReset, playerReset]), new Promise(r => setTimeout(r, 6000))])
          .then(() => window.location.reload())
      } else {
        // reset: forget this session's run state + saved stash, then reload fresh
        for (const k of Object.keys(sim.worldData)) if (k.startsWith('__')) delete sim.worldData[k]
        // PLAYER HALF (same law as spaces): a scene's per-player rows would
        // reload the purged state right back — null them and the local copy.
        delete sim.worldData['save']
        autoSaveSerRef.current = ''; stateSaveSerRef.current = ''
        const baseS = (playScene || '').split(' ⑂ ')[0]
        if (baseS) for (const suf of [':__autosave', ':__state']) {
          void fetch('/api/engine/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot: baseS + suf, data: null, scope: 'user', anon: whoRef.current }) }).catch(() => null)
        }
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
  // FIT_ZOOM backs the view out a touch from exact-contain so the chrome
  // (top bars, tool rail, VOTE, instructions) breathes AROUND the grid
  // instead of overflowing onto in-world content at the edges.
  const FIT_ZOOM = 0.93
  useEffect(() => {
    if (!playScene && !spaceId) return
    const fit = () => {
      cameraRef.current.x = gridSize / 2
      cameraRef.current.y = gridSize / 2
      cameraRef.current.zoom = FIT_ZOOM
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
  const [loadHeavy, setLoadHeavy] = useState(false)   // a heavy uber-shader is still COMPILING past the first beat — keep the spinner + say so
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
      resetWorldIdentity()
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
      // #4 PROGRESSIVE RESOLUTION: seed the render governor LOW so the FIRST frames
      // after the shader compiles paint cheap+fast (a heavy raymarcher's per-pixel
      // cost is its first-paint tax) — then the governor eases resolution back UP
      // on its own once frames are comfortable. First-paint sooner, sharpens in.
      autoScaleRef.current = 0.5
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

        // H3 FIX (Aug 2026): teardown moved BELOW the fetch + validity guards.
        // The old order destroyed the live world (fields/hooks/worldData) and THEN
        // fetched — so a slow or empty snapshot fetch left the guard bailing onto a
        // BLANK world. Now we fetch first; a bad/stale fetch returns while the old
        // world is still intact (faded black), so the veil lifts back onto the world
        // you were on instead of nothing. Teardown runs only once a valid scene is in hand.
        // every world opens with a fresh eye — a zoom left over from another
        // scene must not follow the player through the door. CONTAIN, not cover:
        // the whole world at max size in the viewport; letterbox is honest,
        // cropping is not (a wide monitor was losing 40% of every scene).
        // (Backed out a touch — FIT_ZOOM — so the chrome doesn't overflow the grid.)
        cameraRef.current = { x: gridSize / 2, y: gridSize / 2, zoom: FIT_ZOOM }

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
        // TEARDOWN — only now that a valid replacement scene is in hand (H3 fix).
        // restoreFromSnapshots only ADDS, so every old field must be removed by hand;
        // the old world's music must not follow the player through the door.
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
        // #2 WARM THE UBER-SHADER: kick off the (async) megashader compile NOW —
        // modules + visuals are all registered at this point (so no mod_w3_ray
        // race), and starting it here lets it compile CONCURRENTLY with the
        // field-effect compiles below + the first hook frames, instead of only
        // when liftWhenSettled first polls it. Free parallelism; shaves the wait.
        renderer.isSuperReady()
        // compile each field's effects — the /play loader never did this, so
        // cartridge effects (the fluid solver, any feedback pass) were silently
        // dropped and only the base visual ever rendered. In parallel now.
        await compileEffectsParallel(sim, renderer)
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
        // a reckoning owns the stage — hold every forced re-seed until it
        // closes (leave `last` untouched so the change re-fires on the first
        // poll AFTER the vote; nothing is lost, only deferred).
        const voting = (window as unknown as { __ccReckoning?: boolean }).__ccReckoning === true
        if (last && stamp && stamp !== last && !voting) {
          scenePreloadCache.delete(cur)       // the source changed — drop the stale download
          if (cur === playScene) {
            playLoadedRef.current = null      // let the load effect fire again
            setReloadTick(t => t + 1)
          } else {
            handleLoadScene(cur)              // riding a branch — reload it in place
          }
        }
        if (stamp && !voting) last = stamp
        // AI BUILD SHIFT: a bridge burst on a sibling branch publishes an
        // 'ai-building' beacon on the base world's channel — a tab standing in
        // the family rides to the branch being built, and this same stat poll
        // then live-reloads it burst by burst. One shift per beacon stamp and
        // a 30s cooldown, so a viewer can still walk away on purpose.
        shiftTick++
        if (shiftTick % 4 === 0 && !((window as unknown as { __ccReckoning?: boolean }).__ccReckoning === true)) {
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

  // ── HUBWORLD (Galen, Jul 22): a hub's portals form a WORLD GRAPH; travel
  // inside it is IN-PLACE — like chapters, but across worlds. portalType:'swap'
  // swaps the running engine's CONTENT to the target world's snapshot while the
  // page, URL identity and presence stay on the hub ("not front facing").
  // visitingRef holds the member slug while away from home; every owner-write
  // loop (state sync, rev poll) is gated on it so a visit can NEVER write
  // member content over the hub's snapshot (the one catastrophic failure mode).
  const visitingRef = useRef<string | null>(null)
  const hotSwapSpace = useCallback(async (targetSlug: string) => {
    resetWorldIdentity()
    // SAVE STATES: a portal visit swaps in FOREIGN worldData — the home baseline no
    // longer describes it. Null it so capture pauses (never diff world A against
    // world B's ROM and save the garbage into A's slot). Re-set on real entry.
    romBaselineRef.current = null
    const sim = simulationRef.current
    const renderer = rendererRef.current
    if (!sim || !renderer || !targetSlug) return
    try {
      const resp = await fetch(`/api/spaces/${encodeURIComponent(targetSlug)}/snapshot`, { cache: 'no-store' })
      if (!resp.ok) return
      const { snapshot } = await resp.json()
      if (!snapshot) return
      // a member world boots CLEAN — chapter semantics, no hub-state bleed.
      // restoreFromSnapshots MERGES (it never clears), so the previous world's
      // fields must be removed first or both worlds render stacked ("dunesea
      // overwrite onto hub" — Galen's first hubworld click).
      for (const id of Array.from(sim.fields.keys())) sim.removeField(id)
      sim.interactionRules = []
      for (const k of Object.keys(sim.worldData)) delete sim.worldData[k]
      if (snapshot.visualTypes) for (const vt of snapshot.visualTypes) renderer.registerVisualType(vt.name, vt.wgsl)
      if (snapshot.modules) for (const m of snapshot.modules) renderer.registerModule(m.name, m.wgsl)
      sim.restoreFromSnapshots(snapshot.fields || [])
      for (const field of sim.fields.values()) {
        if (field.visualTypeName) {
          const runtimeId = renderer.resolveVisualType(field.visualTypeName)
          if (runtimeId !== undefined) field.visualType = runtimeId
        }
      }
      if (snapshot.worldParams) sim.setWorldParams(snapshot.worldParams)
      if (snapshot.worldData) Object.assign(sim.worldData, stripSave(snapshot.worldData))
      for (const k of Object.keys(sim.worldData)) {
        if (k.startsWith('key_') || k.startsWith('mouse_')) delete sim.worldData[k]
      }
      if (snapshot.interactionRules) sim.interactionRules = snapshot.interactionRules
      if (snapshot.interactionEffects) for (const ie of snapshot.interactionEffects) sim.addInteractionEffect(ie)
      installHooks(sim, snapshot.stepHooks, snapshot.worldData as Record<string, unknown> | undefined)
      {
        const hasContent = (snapshot.stepHooks?.length ?? 0) > 0 || (snapshot.fields || []).some((f: { visualTypeName?: string }) => f.visualTypeName)
        if (hasContent && !sim.running) sim.running = true
      }
      // warm the target's uber-shader early, then compile its effects in parallel —
      // an in-place portal swap should reach first-paint as fast as a direct load.
      renderer.isSuperReady()
      await compileEffectsParallel(sim, renderer)
      visitingRef.current = targetSlug === spaceSlug ? null : targetSlug
      // deep-linkable but never a page nav: ?at=<member> rides the hub URL
      try {
        const u = new URL(window.location.href)
        if (visitingRef.current) u.searchParams.set('at', targetSlug); else u.searchParams.delete('at')
        history.replaceState(null, '', u.toString())
      } catch { /* URL cosmetics only */ }
    } catch { /* offline / missing member — stay where we are */ }
  }, [spaceSlug, installHooks, compileEffectsParallel])
  const hotSwapSpaceRef = useRef(hotSwapSpace)
  hotSwapSpaceRef.current = hotSwapSpace

  // ⚙ MANAGE (Galen: "worlds don't load from sidebar"): a world is a SPACE, not a
  // hub scene, so go(name) can't reach it — load its snapshot IN PLACE via the
  // same HUBWORLD swap the portals use, so clicking a world row opens it in the
  // engine you're already looking at instead of a page nav. cafe:closespace
  // returns to the shelf by reloading the CAFE hub (the swap removed the hub's
  // own fields, and its leave-dialog only arms in-game, so WITHOUT this the back
  // button would be dead — a stranded world. The shell shows a ◂ while open).
  useEffect(() => {
    const onOpenSpace = (e: Event) => {
      const slug = (e as CustomEvent).detail
      if (typeof slug === 'string' && slug) void hotSwapSpaceRef.current?.(slug)
    }
    const onCloseSpace = () => {
      visitingRef.current = null
      try { const u = new URL(window.location.href); u.searchParams.delete('at'); history.replaceState(null, '', u.toString()) } catch { /* cosmetic */ }
      void handleLoadSceneRef.current?.('CAFE')   // rebuild the hub shelf in place
    }
    window.addEventListener('cafe:openspace', onOpenSpace)
    window.addEventListener('cafe:closespace', onCloseSpace)
    return () => { window.removeEventListener('cafe:openspace', onOpenSpace); window.removeEventListener('cafe:closespace', onCloseSpace) }
  }, [])

  // Load space snapshot on mount (for space mode)
  const spaceLoadedRef = useRef(false)
  useEffect(() => {
    if (!spaceSlug || spaceLoadedRef.current) return
    spaceLoadedRef.current = true
    // A direct /space/<slug> visit is a cold boot: raise the curtain + spinner NOW
    // so a heavy world (veilfire's uber-shader compiles for seconds) reads as
    // LOADING, not a frozen black canvas. This path never set worldLoading — the
    // spinner only ever showed on in-shell swaps (loadPlayScene). liftWhenSettled
    // below lowers it the instant the pipeline is genuinely compiled.
    setWorldLoading(true)

    const loadSpaceSnapshot = async () => {
      resetWorldIdentity()
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
        if (!snapshot) { setWorldLoading(false); return } // Empty space — blank canvas, no curtain
        // baseline the auto-load poll on the rev we're rendering right now
        renderedRevRef.current = Number((snapshot as { worldData?: { __bridge_rev?: unknown } })?.worldData?.__bridge_rev) || 0
        lastFieldsRef.current = JSON.stringify((snapshot as { fields?: unknown })?.fields ?? [])

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
        // Restore render targets BEFORE fields resolve their renderTarget
        // property — a cold load without this leaves resolveRenderTarget()
        // at -1: writer fields draw to screen, sampleTarget() reads black.
        if (Array.isArray(snapshot.renderTargets)) {
          for (const rt of snapshot.renderTargets) {
            if (rt.name) renderer.createRenderTarget(rt.name, rt.persist)
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
        // WARM THE UBER-SHADER NOW — modules + visuals + the fields' visualTypes are
        // all registered, so kick the (async) megashader compile here so it runs
        // CONCURRENTLY with the worldData/hook-install work below + the effect
        // compiles, instead of only when the first frame or liftWhenSettled polls it.
        // For a one-uber-shader world like veilfire this IS the load — starting it
        // early is the parallelism that shaves the wait. Mirrors loadPlayScene.
        renderer.isSuperReady()

        if (snapshot.worldParams) sim.setWorldParams(snapshot.worldParams)
        // RESTART (R) reloads the page with a one-shot cc-reset flag. THIS is the
        // path a reload takes (hotLoadSpaceVersion only runs on version change), so
        // it must strip the world's saved game-state too — else "reset" reloads the
        // exact save it meant to purge. Strip engine state + the world's declared
        // __resets keys (e.g. TIDEGLASS's __tg) before they land in the sim.
        if (snapshot.worldData) {
          let reset = false
          try { if (sessionStorage.getItem('cc-reset:' + spaceSlug)) { reset = true; sessionStorage.removeItem('cc-reset:' + spaceSlug) } } catch { /* private mode */ }
          if (reset) {
            // R = return to ORIGINAL (restore from __original, else clear) — shared resetPatch
            const patch = resetPatch(snapshot.worldData as Record<string, unknown>)
            for (const [k, val] of Object.entries(patch)) { if (val === null) delete snapshot.worldData[k]; else (snapshot.worldData as Record<string, unknown>)[k] = val }
          } else if (versionView) {
            const extra = Array.isArray(snapshot.worldData.__resets) ? snapshot.worldData.__resets : []
            for (const k of ['__chapters', '__trig', ...extra]) delete snapshot.worldData[k]
          }
          Object.assign(sim.worldData, stripSave(snapshot.worldData))
          // GAME-STATE INIT (DESIGN-game-state.md v1): seed the declared holder from
          // the manifest `base` when absent, so hooks can trust it exists (no more
          // per-hook `if(!wd.__vf)wd.__vf={}`). No-op without a manifest; never
          // overwrites a present holder (a loaded save / restored original wins).
          {
            const initPatch = initHolderPatch(sim.worldData as Record<string, unknown>)
            for (const [k, v] of Object.entries(initPatch)) (sim.worldData as Record<string, unknown>)[k] = v
          }
          if (reset) sim.worldData.__fresh = true   // tell the hook to reset per-session latches
          // SAVE STATES: this snapshot IS the ROM — capture the boot baseline (from the
          // SNAPSHOT, never the live sim, so player state can't bake into the baseline).
          // DEFAULT-ON: every space is a rom world unless it declares __saveArch:'legacy'.
          if ((snapshot.worldData as Record<string, unknown>)['__saveArch'] !== 'legacy') {
            romSharedRef.current = sharedKeys(snapshot.worldData as Record<string, unknown>)
            romBaselineRef.current = saveStateBaseline(snapshot.worldData as Record<string, unknown>, romSharedRef.current)
          } else { romBaselineRef.current = null; romSharedRef.current = new Set() }
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

        // Recompile effects — IN PARALLEL (was one serial await per effect, so a
        // multi-effect world paid the sum of every compile). compileEffectsParallel
        // dedupes identical shaders first so the shared-pipeline refcount stays exact.
        await compileEffectsParallel(sim, renderer)

        syncFields()
      } catch (err) {
        console.error('Failed to load space snapshot:', err)
        setWorldLoading(false)   // failed load must not strand the curtain up
        return
      }
      // Lower the curtain only when the NEW pipeline is genuinely compiled (a
      // heavy uber-shader keeps compiling after restore) — the same settle gate
      // the in-shell swap uses, so a direct visit no longer flashes black mid-compile.
      liftWhenSettled()
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
  // a portal press caught in PLAY mode (chrome closed) — resolved on pointer-up
  const pendingPortalRef = useRef<{ fieldId: string; x: number; y: number } | null>(null)

  // THE RELEASE IS UNMISSABLE — a pointer-up that lands on an overlay above
  // the canvas (THE ORPHANAGE, any panel) never reaches the canvas handler,
  // so wd.mouse_down stayed true and the hub hook believed the button was
  // held forever: backing out of the orphanage into PLAYER WORLDS froze the
  // shelf in a phantom drag (Galen, live). A window-level release clears the
  // latch no matter where the up lands; blur covers alt-tab mid-press. It
  // runs AFTER the canvas's own React pointer-up (window is past the root),
  // so normal clicks are untouched — this only heals the missed ones.
  useEffect(() => {
    const release = () => {
      pointerDown.current = false
      isPanning.current = false
      isOrbiting.current = false
      draggingFieldId.current = null
      pendingPortalRef.current = null
      const sim = simulationRef.current
      if (sim) { sim.worldData['mouse_down'] = false; sim.worldData['mouse_down_right'] = false }
      const canvas = canvasRef.current
      if (canvas) canvas.style.cursor = hubCursorRef.current ? 'none' : 'grab'
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
    }
  }, [])

  // MOUSE-LOOK (worldData.__mouseLook): mousemove deltas → worldData.mouse_dx/dy
  // (world-sandbox exposes them as input.lookX/lookY) while the pointer is locked;
  // the cursor hides on lock. Dead simple — click requests the lock (below), Esc
  // releases it natively. No effect on non-mouse-look worlds.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      const sim = simulationRef.current
      if (!sim) return
      sim.worldData['mouse_dx'] = ((sim.worldData['mouse_dx'] as number) || 0) + e.movementX
      sim.worldData['mouse_dy'] = ((sim.worldData['mouse_dy'] as number) || 0) + e.movementY
    }
    const onLock = () => { canvas.style.cursor = document.pointerLockElement === canvas ? 'none' : '' }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('pointerlockchange', onLock)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('pointerlockchange', onLock)
    }
  }, [])

  // pointer-lock entry gate (Galen): the click that ENTERS a world (staging a
  //  vote candidate, opening a scene) must never lock the cursor — but the next
  //  deliberate click inside the world must. Time-gate on the last swap.
  const swapAtRef = useRef(0)

  // inspect frame-snapshot loop: cheap (4Hz, only while inspect is on)
  useEffect(() => {
    if (!inspectOn) { inspectPixRef.current = null; return }
    let live = true
    const grab = async () => {
      try {
        const cv = canvasRef.current
        if (!cv || !live) return
        // DOWNSCALED snapshot (Galen: "laggy on design screen" with inspect
        // on) — the full-canvas retina readback (createImageBitmap + whole
        // getImageData, 4×/s) stalls the GPU pipeline on big displays. A
        // 384-wide resize is ~1% of the pixels and the hover swatch can't
        // tell the difference.
        const wS = 384, hS = Math.max(1, Math.round(cv.height / Math.max(1, cv.width) * 384))
        const bmp = await createImageBitmap(cv, { resizeWidth: wS, resizeHeight: hS, resizeQuality: 'low' })
        const oc = document.createElement('canvas')
        oc.width = bmp.width; oc.height = bmp.height
        const cx = oc.getContext('2d')
        if (cx) {
          cx.drawImage(bmp, 0, 0)
          // COMPOSITE THE HUD (Galen: "press b does not hover as red even
          // though I can see it") — HUD text is an HTML layer, not shader
          // pixels; re-render it into the snapshot at its % positions so the
          // hover eye samples the SCREEN the player sees, not just the canvas.
          try {
            const hudU = simulationRef.current?.worldData?.['hud']
            const rct = cv.getBoundingClientRect()
            const scl = bmp.width / Math.max(1, rct.width)
            if (Array.isArray(hudU)) for (const hEl of hudU as Array<Record<string, unknown>>) {
              if (hEl?.['type'] !== 'text' || !hEl['text']) continue
              const fs = (parseFloat(String(hEl['fontSize'] || '12')) || 12) * scl
              cx.font = `${fs}px monospace`
              cx.fillStyle = String(hEl['color'] || '#ffffff')
              cx.textBaseline = 'top'
              cx.fillText(String(hEl['text']), bmp.width * (parseFloat(String(hEl['x'])) / 100), bmp.height * (parseFloat(String(hEl['y'])) / 100))
            }
          } catch { /* hud compositing is a bonus */ }
          inspectPixRef.current = { data: cx.getImageData(0, 0, bmp.width, bmp.height), w: bmp.width, h: bmp.height }
        }
        bmp.close()
      } catch { /* snapshot is a bonus */ }
    }
    grab()
    const iv = setInterval(grab, 250)
    return () => { live = false; clearInterval(iv) }
  }, [inspectOn])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current
    const sim = simulationRef.current
    if (!canvas) return

    // INSPECT MODE eats every click: document it (grid coords + field + visual +
    // base color), ring it into wd.__clicks for the AIs, and never let it reach
    // gameplay, dragging, or the hooks' mouse_down.
    if (inspectOnRef.current) {
      const rectI = canvas.getBoundingClientRect()
      const camI = cameraRef.current
      const gI = screenToGrid(e.clientX, e.clientY, rectI, camI, camI.zoom)
      let hfI: ReturnType<NonNullable<typeof sim>['getFieldAtPoint']> | null = null
      try { hfI = sim ? sim.getFieldAtPoint(gI.x, gI.y) : null } catch { /* never break input */ }
      let colI: string | null = null
      try {
        const cArr = hfI ? Array.from(hfI.color as ArrayLike<number>).slice(0, 3) : null
        if (cArr && cArr.length === 3) colI = '#' + cArr.map(v => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255).toString(16).padStart(2, '0')).join('')
      } catch { /* color is a bonus, not a dependency */ }
      // SUB-ENTITY resolution — a field may hold many objects the engine can't
      // see (a raymarch scene, a population buffer). If the world publishes a
      // worldData.__entities list (each {id, kind?, label?, sx, sy, r} in screen
      // grid space — the WORLD does the projection, so inspect stays camera-
      // agnostic), name the nearest one at the click. Purely additive: no list =
      // exactly the old field-only behavior.
      let entI: { id: number; kind?: number; label?: string } | null = null
      try {
        const ents = sim?.worldData?.['__entities']
        if (Array.isArray(ents)) {
          let bd = Infinity
          for (const en of ents as Array<Record<string, number>>) {
            const sx = Number(en.sx), sy = Number(en.sy), rr = Number(en.r) || 24
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue
            const d = Math.hypot(sx - gI.x, sy - gI.y)
            if (d <= rr && d < bd) { bd = d; entI = { id: Number(en.id), kind: en.kind != null ? Number(en.kind) : undefined, label: (en as Record<string, unknown>).label as string | undefined } }
          }
        }
      } catch { /* entities are a bonus, never break inspect */ }
      // PIXEL-EXACT entity — if the world's shader markPop()'d its parts, the GPU
      // owner buffer resolves the EXACT part under the click (packed into the hit
      // map), more precise than __entities' world-published positions. Prefer it
      // when present; __entities stays the fallback for worlds that don't markPop.
      try {
        const gpuEnt = sim ? sim.getEntityAtPoint(gI.x, gI.y) : -1
        if (gpuEnt >= 0) entI = { id: gpuEnt, kind: entI?.kind, label: entI?.label }
      } catch { /* getEntityAtPoint is a bonus, never break inspect */ }
      // PIXEL → SOURCE: the owner buffer gave us the field; its visual is the
      // exact shader that drew this pixel. Resolve the visual NAME + its WGSL so a
      // click backtracks a pixel to the code that produced it (node-superposition
      // provenance). visualTypeName is the human name; the number is the packed id.
      const vName = (hfI as { visualTypeName?: string } | null)?.visualTypeName ?? null
      let source: string | null = null
      try { if (vName) source = rendererRef.current?.getVisualWgsl(vName) ?? null } catch { /* never break inspect */ }
      // UNIVERSAL PIXEL→NODE (Galen): the engine tracked which hook wrote every
      // gpuPopulation entry this tick (__popProv, built in the hook loop).
      // Project the entries (uv quads → grid = (v+1)·256) and name the nearest
      // one + its authoring hook — works for ANY world, no cooperation needed.
      // No cutoff, and a STACK not a single answer (Galen: "containers of
      // smaller things" — a big panel's CENTER is far from most of its own
      // pixels, so nearest-center missed it). Every painted pixel now names
      // the nearest few entries with distances: the small thing under the
      // cursor AND its enclosing containers both appear.
      let nodeI: { hook: string; idx: number; kind: number; d: number }[] | null = null
      try {
        const popU = sim?.worldData?.['gpuPopulation']
        const provU = sim?.worldData?.['__popProv']
        if (Array.isArray(popU) && Array.isArray(provU) && provU.length) {
          const cands: { idx: number; d: number; kind: number }[] = []
          for (let k = 0; k + 3 < popU.length; k += 4) {
            const sxU = (Number(popU[k]) + 1) * 256, syU = (Number(popU[k + 1]) + 1) * 256
            cands.push({ idx: k / 4, d: Math.hypot(sxU - gI.x, syU - gI.y), kind: Math.trunc(Number(popU[k + 3])) })
          }
          cands.sort((a, b) => a.d - b.d)
          nodeI = cands.slice(0, 3).map(c => {
            const segU = (provU as { hook: string; from: number; to: number }[]).find(sg => c.idx >= sg.from && c.idx < sg.to)
            return { hook: segU ? segU.hook : 'unattributed', idx: c.idx, kind: c.kind, d: Math.round(c.d) }
          })
          if (!nodeI.length) nodeI = null
        }
      } catch { /* provenance is a bonus, never break inspect */ }
      // THE UI SYSTEM — clicked UI resolves from the SOLVED rect table (the
      // same geometry the pixels came from): smallest containing node wins,
      // its panel + authoring hook (wd.__uiProv) are named, and the node's
      // DECLARATION (the UiNode subtree from wd.ui) ships as source — a
      // clicked label backtracks to the exact tree node that produced it.
      let uiI: { id: string; text: string; panel: string | null; hook: string | null } | null = null
      try {
        const solvedI = uiSolvedRef.current
        const cvRU = canvas.getBoundingClientRect()
        if (solvedI) {
          const sideI = Math.min(cvRU.width, cvRU.height)
          const gxI = (e.clientX - cvRU.left - (cvRU.width - sideI) / 2) * (512 / sideI)
          const gyI = (e.clientY - cvRU.top - (cvRU.height - sideI) / 2) * (512 / sideI)
          let best: { id: string; area: number } | null = null
          for (const idU in solvedI.rects) {
            const r = solvedI.rects[idU]
            if (gxI >= r.x && gxI <= r.x + r.w && gyI >= r.y && gyI <= r.y + r.h) {
              const area = r.w * r.h
              if (!best || area < best.area) best = { id: idU, area }
            }
          }
          if (best) {
            const bid = best.id.replace(/:(\d+|t|l)$/, '')
            const panelI = solvedI.panels.find(p => gxI >= p.x && gxI <= p.x + p.w && gyI >= p.y && gyI <= p.y + p.h)
            const runTxt = solvedI.runs.filter(rn => rn.id === best!.id || rn.id.replace(/:(\d+|t|l)$/, '') === bid).map(rn => rn.text).join(' ')
            uiI = { id: bid, text: runTxt.slice(0, 60), panel: panelI ? panelI.id : null, hook: (sim?.worldData?.['__uiProv'] as string | undefined) ?? null }
            // source = the node's own declaration from the world's ui tree
            const uiTreeI = sim?.worldData?.['ui'] as { root?: unknown[] } | undefined
            const findNode = (nodes: unknown[]): unknown => {
              for (const nd of nodes || []) {
                const n = nd as { id?: string; children?: unknown[] }
                if (n?.id === bid) return n
                const hit = n?.children ? findNode(n.children) : null
                if (hit) return hit
              }
              return null
            }
            const nodeI2 = uiTreeI?.root ? findNode(uiTreeI.root) : null
            if (nodeI2) source = JSON.stringify(nodeI2, null, 1)
          }
        }
      } catch { /* ui naming is a bonus, never break inspect */ }
      // HUD TEXT is DOM overlay, invisible to every canvas resolver (Galen:
      // "press b to start text") — hit-test worldData.hud entries by their %
      // positions and approximate text box, name the containing/nearest one.
      let hudI: { id: string; text: string } | null = null
      try {
        const hudU = sim?.worldData?.['hud']
        const cvR = canvas.getBoundingClientRect()
        if (Array.isArray(hudU)) {
          let bdH = 40
          for (const hEl of hudU as Array<Record<string, unknown>>) {
            if (hEl?.['type'] !== 'text' || !hEl['text']) continue
            const hx = cvR.left + cvR.width * (parseFloat(String(hEl['x'])) / 100)
            const hy = cvR.top + cvR.height * (parseFloat(String(hEl['y'])) / 100)
            const fs = parseFloat(String(hEl['fontSize'] || '12')) || 12
            const tw = String(hEl['text']).length * fs * 0.62
            const inX = e.clientX >= hx - 8 && e.clientX <= hx + tw + 8
            const dY = Math.abs(e.clientY - (hy + fs * 0.6))
            if (inX && dY < Math.max(fs, 14) && dY < bdH) { bdH = dY; hudI = { id: String(hEl['id']), text: String(hEl['text']).slice(0, 48) } }
          }
        }
      } catch { /* hud naming is a bonus */ }
      const entry = { at: Date.now(), x: Math.round(gI.x), y: Math.round(gI.y), field: hfI?.name ?? null, visual: vName ?? ((hfI?.visualType as string | undefined) ?? null), color: colI, entity: entI, node: nodeI, hud: hudI, ui: uiI, source }
      setInspectLog(l => [...l.slice(-7), entry])
      if (sim) {
        const ring = Array.isArray(sim.worldData['__clicks']) ? (sim.worldData['__clicks'] as unknown[]) : []
        sim.worldData['__clicks'] = [...ring.slice(-7), entry]
      }
      e.preventDefault(); e.stopPropagation()
      return
    }

    // THE UI SYSTEM's click routing — solved button rects are the ONE hit
    // truth (the same rects the glass/glyph passes drew). Convert the click to
    // design units on the resting letterboxed square (UI never follows the
    // camera), hit-test, and deliver via the existing __uiClick channel; a UI
    // hit is swallowed so it never doubles as a game/world click.
    if (uiSolvedRef.current && sim) {
      const rectU = canvas.getBoundingClientRect()
      const sideU = Math.min(rectU.width, rectU.height)
      if (sideU > 0) {
        const gx = (e.clientX - rectU.left - (rectU.width - sideU) / 2) * (512 / sideU)
        const gy = (e.clientY - rectU.top - (rectU.height - sideU) / 2) * (512 / sideU)
        const action = hitUi(uiSolvedRef.current, gx, gy)
        if (action) {
          const wd = sim.worldData as Record<string, unknown>
          wd['__uiClick'] = action
          wd['__uiClickT'] = performance.now()
          e.preventDefault(); e.stopPropagation()
          return
        }
      }
    }

    // MOUSE-LOOK worlds opt in via worldData.__mouseLook → click locks the pointer
    // (cursor hides, unbounded relative deltas for turning). Esc releases natively.
    // the ENTRY click can't lock (it just swapped the world in); a deliberate
    // click ≥600ms after the swap does — click-to-lock, never lock-on-entry
    // The click that ENGAGES cursor lock must lock WITHOUT firing — otherwise
    // click-to-play (and every re-lock after Esc) also lands as a game press, so a
    // mouse-look world fires a shot the instant you re-capture the cursor (the
    // misfire). Detect the engaging click, request the lock, and swallow THIS press
    // for hooks; every later click while already locked fires normally.
    const engagingLock = !!(sim && sim.worldData['__mouseLook'] && (performance.now() - swapAtRef.current) > 600 && document.pointerLockElement !== canvas)
    if (engagingLock) {
      try { canvas.requestPointerLock() } catch { /* not supported */ }
      lockSwallow.current = true
    }

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
      // the engaging-lock click is swallowed so it locks without firing; every
      // later click (while already locked) records the press and fires normally.
      if (!engagingLock) {
        sim.worldData['mouse_down'] = true
        // pulse counter — a click shorter than one sim frame still lands once
        sim.worldData['mouse_down_n'] = ((sim.worldData['mouse_down_n'] as number) || 0) + 1
      }
      // RIGHT-CLICK, exposed to hooks — purely additive (mouse_down above is
      // UNCHANGED, still fires for any button, so no existing world's behavior
      // shifts). The context menu is already suppressed on this canvas
      // (onContextMenu preventDefault below), so right-click was previously
      // inert for gameplay; this gives it a second, distinct button a hook can
      // read (e.g. a strafe-modifier command) without touching the primary one.
      if (e.button === 2) {
        sim.worldData['mouse_down_right'] = true
        sim.worldData['mouse_down_right_n'] = ((sim.worldData['mouse_down_right_n'] as number) || 0) + 1
      }
    }

    // MOUSE-LOOK worlds: a click is FIRE here, not the lock trigger (Galen's
    // call). The pointer lock is toggled by the L KEY instead — see the keydown
    // handler in the pointer-lock lifecycle effect. So pointerdown does NOTHING
    // lock-related; it only records the press above so hooks see the fire.

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
    // EXCEPT doors: a field that declares portalTarget is a PORTAL and must
    // work for every visitor — clicks used to die at this gate ("Portal
    // Failure", the first BuilderBox task). Only portal fields catch the
    // pointer here; everything else still belongs to the game's hooks.
    if (spaceId && !chromeVisible) {
      const simP = simulationRef.current
      const canvasP = canvasRef.current
      if (simP && canvasP) {
        const rectP = canvasP.getBoundingClientRect()
        const camP = cameraRef.current
        const gridP = screenToGrid(e.clientX, e.clientY, rectP, camP, camP.zoom)
        const hf = simP.getFieldAtPoint(gridP.x, gridP.y)
        if (hf && hf.properties.get('portalTarget')) {
          pendingPortalRef.current = { fieldId: hf.id, x: e.clientX, y: e.clientY }
        }
      }
      return
    }

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

  // KEEP THE GLYPH LIVE OVER OVERLAY CHROME. In the hub the OS cursor is hidden
  // and the glyph is drawn AT the pointer, but its position (mouse_x/mouse_y)
  // only updates from the canvas' onPointerMove — so the instant the pointer
  // moved onto a fixed overlay (the ⌕ search bar, its dropdown, any chrome
  // above the canvas) the handler stopped firing and the glyph FROZE mid-screen
  // until you moved back onto the canvas. A window-level listener tracks the
  // pointer across the whole viewport while the hub glyph is active, so reaching
  // for the search bar no longer strands your cursor. Cheap (one screenToCell);
  // no-ops outside the hub.
  useEffect(() => {
    const onWinMove = (e: PointerEvent) => {
      if (!hubCursorRef.current) return
      const sim = simulationRef.current
      const canvas = canvasRef.current
      const input = inputRef.current
      if (!sim || !canvas || !input) return
      const rect = canvas.getBoundingClientRect()
      const camera = cameraRef.current
      const g = input.screenToCell(e.clientX, e.clientY, rect, camera, camera.zoom)
      sim.worldData['mouse_x'] = g.x
      sim.worldData['mouse_y'] = g.y
    }
    window.addEventListener('pointermove', onWinMove)
    return () => window.removeEventListener('pointermove', onWinMove)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (inspectOnRef.current) {
      try {
        const cv = canvasRef.current, pix = inspectPixRef.current
        if (cv && pix) {
          const r = cv.getBoundingClientRect()
          const px = Math.max(0, Math.min(pix.w - 1, Math.round((e.clientX - r.left) / r.width * pix.w)))
          const py = Math.max(0, Math.min(pix.h - 1, Math.round((e.clientY - r.top) / r.height * pix.h)))
          const o = (py * pix.w + px) * 4, d = pix.data.data
          const hex = '#' + [d[o], d[o + 1], d[o + 2]].map(v => v.toString(16).padStart(2, '0')).join('')
          setInspectHover({ hex, x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) })
        }
      } catch { /* hover color is a bonus */ }
      return
    }
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
      sim.worldData['mouse_down'] = pointerDown.current && !lockSwallow.current
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
    lockSwallow.current = false   // the engaging-lock press ended — later clicks fire
    { const simUp = simulationRef.current; if (simUp) simUp.worldData['mouse_down'] = false }
    if (e.button === 2) { const simUpR = simulationRef.current; if (simUpR) simUpR.worldData['mouse_down_right'] = false }
    // PLAY-mode portal: pressed on a door with the chrome closed — travel on a
    // clean click (not a drag). Both types page-nav for now; 'swap' becomes the
    // in-place hubworld travel when that lands.
    {
      const pp = pendingPortalRef.current
      if (pp) {
        pendingPortalRef.current = null
        const dxP = e.clientX - pp.x, dyP = e.clientY - pp.y
        if (dxP * dxP + dyP * dyP < 25) {
          const simPP = simulationRef.current
          const fPP = simPP?.fields.get(pp.fieldId)
          const targetPP = fPP?.properties.get('portalTarget') as string | undefined
          const typePP = fPP?.properties.get('portalType') as string | undefined
          if (targetPP && typePP === 'swap') {
            void hotSwapSpaceRef.current?.(targetPP)   // HUBWORLD: in-place travel
            return
          }
          if (targetPP && typePP === 'space') {
            window.location.href = `/space/${targetPP}`
            return
          }
        }
      }
    }
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
      // World-owned wheel (opt-in): a world that sets worldData.wheel_opt gets
      // the wheel/pinch stream as a monotonic accumulator (worldData.wheel_y)
      // for its OWN zoom/scroll, and the grid camera stays put — pinch should
      // zoom the game, not the render grid. Hooks consume it split_n-style
      // (keep last-seen, act on the delta); it is not in the worker→main sync
      // whitelist, so a hook can never clobber the count.
      {
        const wsim = simulationRef.current
        const wwd = wsim ? (wsim.worldData as Record<string, unknown>) : null
        if (wwd && wwd['wheel_opt'] === true) {
          wwd['wheel_y'] = ((wwd['wheel_y'] as number) || 0) + e.deltaY
          return
        }
      }
      // SWAP GATE: a trackpad's inertia tail rides through the door — the camera
      // reset runs early in the load, so a late coasting wheel event re-zoomed
      // the fresh camera and STUCK ("main is randomly zoomed in" after backing
      // out of a world). Swallow camera moves for a beat after any swap.
      if (performance.now() - swapAtRef.current < 1500) return
      // THE HUB NEVER WHEEL-ZOOMS THE GRID: the hub scene paints the full
      // viewport (its constellation zoom is Z/X → the hook's own cam), so a grid
      // zoom only crops the painting into the void. Worlds keep wheel zoom.
      if (hubCursorRef.current) return
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
    // init() can REJECT if a teardown (StrictMode remount / navigation) nulls the
    // device mid-init — treat a throw exactly like a failed init, never let it
    // escape as an unhandled rejection. The cancelled-guard below then handles the
    // unmount silently; a genuine transient earns the one retry.
    let ok = false
    try { ok = await renderer.init(canvas!) } catch { ok = false }
    if (!ok && !cancelled) {
      // transient device loss (tab remounts, GPU pressure) — one retry earns a lot
      await new Promise(r => setTimeout(r, 700))
      try { ok = await renderer.init(canvas!) } catch { ok = false }
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
              renderer.createRenderTarget(rt.name, rt.persist)
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
        Object.assign(sim.worldData, stripSave(data.worldData as Record<string, unknown>))
        // SAVE STATES: this is the PERSONAL-EDITOR restore (spaces fetch {} above and
        // load via loadSpaceSnapshot, which owns the ROM baseline) — the editor is a
        // design surface and must NEVER set a baseline or start capturing.
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
      // Zombie-loop guard: once this effect run has been torn down (cleanup set
      // `cancelled`), a frame already in flight must NOT reschedule itself, or it
      // survives cancellation and keeps driving the (re-created) renderer, stacking a
      // second live loop on every re-init and degrading performance over a session.
      if (cancelled) return
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
      // Frame budget by attention state:
      //  · FOCUSED, visible → ~60fps (cap ProMotion's 120Hz — double GPU load
      //    and laptop heat for no perceptible gain in a shader scene).
      //  · UNFOCUSED but visible (engine beside a chat/terminal window) → ~30fps.
      //    A prior 10fps unfocused throttle read as "choppy" (Jul 12 2026), so
      //    that was reverted to full rate — but full rate pins ~20% CPU + the GPU
      //    the whole time another app is on top. 30fps is the middle: it roughly
      //    halves the render+sim cost of the beside-a-window posture and still
      //    reads smooth (30 ≠ the old 10). Tune UNFOCUSED_MS to taste.
      //  · HIDDEN tab → rAF pauses for free (browser), so this never runs.
      const UNFOCUSED_MS = 33
      const minFrameMs = windowFocusedRef.current ? 15 : UNFOCUSED_MS
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

      // ── NETWORKED MODE: mpManifest worlds run their hooks in the arena room,
      //    not here. Send this player's afferents; adopt the authoritative state.
      const mpManifest = sim.worldData['mpManifest'] as { lobby?: boolean } | undefined
      const wantRoom = sim.worldData['__joinRoom'] ?? roomFromUrlRef.current ?? undefined
      if (mpManifest && spaceSlug && (!mpManifest.lobby || wantRoom)) {
        // JOINED (or lobby-less world): the room is the authority
        const wantUrl = typeof sim.worldData['arenaUrl'] === 'string' ? sim.worldData['arenaUrl'] as string : undefined
        // LOAD-ORDER RACE (base-platformer, Aug 23): mpManifest can appear a
        // frame before arenaUrl during world load — the first dial then goes to
        // the house arena. If the world's own arena shows up before a seat has
        // landed, hang up and redial the RIGHT room.
        if (arenaRef.current && wantUrl && arenaRef.current.urlOverride !== wantUrl && arenaRef.current.seat < 0) {
          arenaRef.current.close()
          arenaRef.current = null
        }
        if (!arenaRef.current) { const a = new ArenaClient(); arenaRef.current = a; a.connect(spaceSlug, typeof wantRoom === 'string' && wantRoom ? wantRoom : 'main', undefined, wantUrl) }
        const a = arenaRef.current
        const wd = sim.worldData as Record<string, unknown>
        // discrete actions are LATCHED into counters so a tap survives lag —
        // "latest input wins" would silently drop it (fairness, not just feel)
        const spaceNow = !!wd['key_space']
        if (spaceNow && !a.prevSpace) a.splitN++
        a.prevSpace = spaceNow
        a.sendInput({
          // the designed hull rides along until the room has seen it (small JSON)
          design: (typeof wd['__sendDesign'] === 'string' ? wd['__sendDesign'] : undefined),
          mouse_x: wd['mouse_x'], mouse_y: wd['mouse_y'], mouse_down: wd['mouse_down'],
          key_space: wd['key_space'], split_n: a.splitN,
          key_w: wd['key_w'], key_a: wd['key_a'], key_s: wd['key_s'], key_d: wd['key_d'],
          key_arrowup: wd['key_arrowup'], key_arrowdown: wd['key_arrowdown'], key_arrowleft: wd['key_arrowleft'], key_arrowright: wd['key_arrowright'],
        })
        const st = a.latest
        if (st) {
          a.latest = null
          const incoming = st.worldData || {}
          for (const k of Object.keys(incoming)) {
            // local afferents stay local — the server echoes every seat's inputs
            // via wd.players; my raw mouse/keys must not be clobbered mid-frame.
            // gpuPopulation/gpuUniforms are handled by the interpolator below.
            if (k === 'mouse_x' || k === 'mouse_y' || k === 'mouse_down' || k.startsWith('key_')) continue
            if (k === 'gpuPopulation' || k === 'gpuUniforms') continue
            wd[k] = incoming[k]
          }
          wd['__mySeat'] = a.seat   // so a shader/HUD can highlight "you" (client-local)
        }
        // EVERY render frame: adopt the interpolated view (~80ms behind, lerped
        // between the last two authoritative states) — motion stays continuous
        // no matter the server tick rate
        const view = a.frame(performance.now())
        if (view) {
          if (view.pop) wd['gpuPopulation'] = view.pop
          if (view.uni) { const u = view.uni.slice(); u[15] = a.seat; wd['gpuUniforms'] = u }
        }
      } else if (mpManifest && mpManifest.lobby && spaceSlug) {
        // LOBBY MODE: the world runs LOCALLY (its hook renders the server
        // finder from wd.__lobby and sets wd.__joinRoom on click); we feed it
        // the live room list every ~3s
        const nowMs = Date.now()
        if (nowMs - lobbyFetchRef.current > 3000) {
          lobbyFetchRef.current = nowMs
          fetchArenaRooms(spaceSlug).then(rooms => {
            const s2 = simulationRef.current
            if (s2) s2.worldData['__lobby'] = { rooms, at: Date.now() }
          }).catch(() => {})
        }
        sandboxRef.current?.tick(sim, dt)
      } else {
        sandboxRef.current?.tick(sim, dt)
      }
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
      // DECLARATIVE SOUND MANIFEST (DESIGN-world-audio.md §2): wd.sounds =
      // { name: url } — preloaded here so {name:'x'} one-shots just work.
      // Re-scanned only when the object identity changes; per-id url map makes
      // a world redeclaring a name with a NEW url reload it.
      const soundsDecl = sim.worldData['sounds'] as Record<string, string> | undefined
      if (soundsDecl && soundsDecl !== lastSoundsDeclRef.current) {
        lastSoundsDeclRef.current = soundsDecl
        const audio = audioRef.current
        for (const [sid, surl] of Object.entries(soundsDecl)) {
          if (typeof surl !== 'string' || !audioUrlOk(surl) || soundsLoadedRef.current.get(sid) === surl) continue
          soundsLoadedRef.current.set(sid, surl)
          const wgen = audio.worldGen
          void audio.loadSound(sid, surl).then(ok => { if (!ok && audio.worldGen === wgen) soundsLoadedRef.current.delete(sid) })
        }
      }
      type PlaySoundCmd = { id?: string; name?: string; url?: string; frequency?: number; duration?: number; volume?: number; pitch?: number; type?: OscillatorType }
      const playSoundRaw = sim.worldData['__play_sound'] as PlaySoundCmd | PlaySoundCmd[] | undefined
      if (playSoundRaw) {
        delete sim.worldData['__play_sound']
        const audio = audioRef.current
        for (const playSound of Array.isArray(playSoundRaw) ? playSoundRaw : [playSoundRaw]) {
          if (playSound.name && !playSound.id) playSound.id = playSound.name   // VEILFIRE-era hooks say {name:} — alias of id
          if (playSound.id && audio.hasSound(playSound.id)) {
            audio.play(playSound.id, playSound.volume ?? 1.0, playSound.pitch ?? 1.0)
          } else if (playSound.id && playSound.url && audioUrlOk(playSound.url)) {
            // first strike lazy-loads (one fetch of latency); replays are instant
            const { id, url, volume, pitch } = playSound
            const wgen = audio.worldGen
            void audio.loadSound(id, url).then(ok => { if (ok && audio.worldGen === wgen) audio.play(id!, volume ?? 1.0, pitch ?? 1.0) })   // a load that outlived its world stays silent
          } else if (playSound.frequency) {
            audio.beep(playSound.frequency, playSound.duration ?? 0.2, playSound.volume ?? 0.5, playSound.type)
          } else if (playSound.id) {
            // {name}-only with nothing loaded used to VANISH silently (shooter3's
            // silent gunfire). Say it loudly, once per name per world.
            if (!warnedSoundsRef.current.has(playSound.id)) {
              warnedSoundsRef.current.add(playSound.id)
              console.warn(`[audio] sound "${playSound.id}" not loaded — declare wd.sounds = { "${playSound.id}": "<blob-store url>" } (or include frequency/url in __play_sound)`)
            }
          }
        }
      }

      // Music: { score } plays a COMPOSED score (data, nothing hosted — the audio
      // equivalent of a shader); { url } plays a file track; { stop: true } fades out.
      // DECLARED STATE, not an event (DESIGN-world-audio.md §2): the key persists
      // in worldData (and so in saved scenes/snapshots), assertMusic's compare-by-
      // value gate plays only on change — and loading a world REPLAYS its music.
      const playMusic = sim.worldData['__play_music'] as { url?: string; score?: object; volume?: number; loop?: boolean; stop?: boolean } | undefined
      if (playMusic) audioRef.current.assertMusic(playMusic, audioUrlOk)

      // Reactive score: the world sweeps its own music live (audio as a second
      // rendering of world state). Continuous value — read every frame, not a
      // one-shot command, so it's not deleted.
      const musicMod = sim.worldData['music_mod'] as { brightness?: number; gain?: number } | undefined
      if (musicMod) audioRef.current.setScoreMod(musicMod)

      // World voice — a world sonifies its own state through the organic water
      // voice (wd.tone). Read every frame; null when unset fades it out.
      const tone = sim.worldData['tone'] as WorldTone | undefined
      setWorldVoice(tone ?? null)

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
        fetch(`/api/engine/save?scope=user&anon=${encodeURIComponent(whoRef.current || '')}&slot=${encodeURIComponent(`${cellBase()}:${loadReq.slot}`)}`, { cache: 'no-store' })
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
      // SAVE STATES: capture the worldData↔ROM divergence per-player, debounced.
      // Design mode pauses capture — the owner is authoring the ROM, not playing.
      if (autoSaveReadyRef.current && romBaselineRef.current && !visitingRef.current && !designModeRef.current && now - stateSaveAtRef.current > 4000) {
        const state = captureSaveState(sim.worldData, romBaselineRef.current, romSharedRef.current)
        const ser = JSON.stringify(state)
        if (ser !== stateSaveSerRef.current) {
          stateSaveSerRef.current = ser
          stateSaveAtRef.current = now
          fetch('/api/engine/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot: `${cellBase()}:__state`, data: state, scope: 'user', anon: whoRef.current }),
          }).catch(() => {})
        }
      }

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
        }).then(r => r.json()).then((d: { reverted?: number }) => {
          // the heal spoke — tell the BUILDER, not just the AI (rung 2)
          if (d?.reverted !== undefined) showToast(
            `node "${hookErr.hookId}" auto-healed — its fresh push kept erroring, so it reverted to its last good version (rev ${d.reverted})`,
            'info', 'the bad version is marked in its history; reload to run the healed code')
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
          // CLIP THE HUD TO THE WORLD SQUARE (Galen: "text from a world escaping
          // the grid"). On a wide viewport the 512 grid renders as a CENTERED
          // square (renderer letterboxes — see computeFieldViewport), but this
          // container is the full canvas, so edge-anchored HUD (x:'16px',
          // right:'12px') landed out in the margin BESIDE the world. Project the
          // grid box [0,512] to screen px with the renderer's OWN camera math and
          // size the container to it, overflow hidden — HUD coords become
          // relative to the world, and nothing can spill past its edge.
          const canvasEl = canvasRef.current
          let hudSide = 512
          if (canvasEl) {
            // CAMERA-INDEPENDENT RESTING SQUARE (the law, Aug 6): HUD is
            // chrome — it never follows the grid camera. side = min(w,h),
            // centered; matches the GPU text box and the shader chrome.
            const cw = canvasEl.clientWidth, ch = canvasEl.clientHeight
            hudSide = Math.min(cw, ch)
            hudContainer.style.left = `${(cw - hudSide) / 2}px`
            hudContainer.style.top = `${(ch - hudSide) / 2}px`
            hudContainer.style.width = `${hudSide}px`
            hudContainer.style.height = `${hudSide}px`
            hudContainer.style.right = 'auto'
            hudContainer.style.bottom = 'auto'
            hudContainer.style.overflow = 'hidden'
          }
          const cache = hudElementCacheRef.current
          const seen = new Set<string>()
          for (const elem of hudData) {
            if (!elem.id || elem.visible === false) continue
            // THE BOUNDARY, found by experiment (Galen, Aug 6): screen-space
            // UI is DOM (the browser's home turf — layout, crisp fonts,
            // wrapping); WORLD-space text is the GPU glyph pass (damage
            // numbers, in-world labels — gated on worldData.__gpuText).
            // The eye stays whole via the hud-composite snapshot paths.
            seen.add(elem.id)
            let el = cache.get(elem.id)
            if (!el || !el.isConnected) {
              el = document.createElement('div')
              el.setAttribute('data-hud-id', elem.id)
              el.style.position = 'absolute'
              hudContainer.appendChild(el)
              cache.set(elem.id, el)
            }
            // FRAME PARENTING (React-style locating, now in its native medium):
            // frame:[cx,cy,w,h] (uv) → % rect inside the square; the element's
            // %-coords resolve inside it, overflow clipped by CSS.
            const frameF = (elem as unknown as { frame?: number[] }).frame
            if (Array.isArray(frameF) && frameF.length === 4) {
              const [fcx, fcy, fwq, fhq] = frameF.map(Number)
              const fL = (fcx - fwq / 2 + 1) / 2 * 100, fT = (fcy - fhq / 2 + 1) / 2 * 100
              const fW = fwq / 2 * 100, fH = fhq / 2 * 100
              const px9 = parseFloat(String(elem.x ?? '0')) / 100, py9 = parseFloat(String(elem.y ?? '0')) / 100
              el.style.left = `${(fL + fW * px9).toFixed(2)}%`
              el.style.top = `${(fT + fH * py9).toFixed(2)}%`
              el.style.maxWidth = `${(fL + fW - (fL + fW * px9)).toFixed(2)}%`
              el.style.overflow = 'hidden'
              el.style.whiteSpace = 'nowrap'
              el.style.textOverflow = 'ellipsis'
            } else {
              el.style.left = elem.x ?? ''
              el.style.top = elem.y ?? ''
            }
            el.style.right = elem.right ?? ''
            el.style.bottom = elem.bottom ?? ''
            el.style.color = elem.color ?? '#fff'
            // PROPORTIONAL TEXT: fontSize is design-px against the 512 grid,
            // scaled by the square so text grows WITH its panels.
            el.style.fontSize = `${((parseFloat(String(elem.fontSize ?? '16')) || 16) * (hudSide / 512)).toFixed(2)}px`
            // inner-field HTML/CSS protocol: apply an arbitrary style object
            if (elem.css) { for (const k in elem.css) { try { (el.style as unknown as Record<string, string>)[k] = elem.css[k] } catch { /* skip bad css prop */ } } }
            // clickable → feed the click back to the hook via worldData.__uiClick
            if (elem.clickable) {
              el.style.pointerEvents = 'auto'
              if (!el.style.cursor) el.style.cursor = 'pointer'
              const boundEl = el
              const anyEl = boundEl as unknown as { __uiClickBound?: boolean }
              if (!anyEl.__uiClickBound) {
                anyEl.__uiClickBound = true
                boundEl.addEventListener('pointerdown', (ev) => {
                  ev.stopPropagation()
                  let node = ev.target as HTMLElement | null, action = ''
                  while (node && node !== boundEl) { if (node.dataset && node.dataset.uiClick) { action = node.dataset.uiClick; break } node = node.parentElement }
                  if (!action) action = boundEl.getAttribute('data-hud-id') ?? ''
                  const wd = sim.worldData as Record<string, unknown>
                  wd['__uiClick'] = action; wd['__uiClickT'] = performance.now()
                })
              }
            } else {
              el.style.pointerEvents = 'none'
            }

            if (elem.type === 'text') {
              el.textContent = elem.text ?? ''
            } else if (elem.type === 'html') {
              const anyEl = el as unknown as { __uiHtml?: string }
              const next = elem.html ?? ''
              if (anyEl.__uiHtml !== next) { anyEl.__uiHtml = next; el.innerHTML = sanitizeHudHtml(next) }
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
      renderer.setWorldData(sim.worldData as Record<string, unknown>)   // sandboxed worlds: hooks run in the worker, but render layers (GPU text) still need hud
      // DEV-ONLY escape hatch: local harnesses (headless pixel proofs, UI
      // tuning) can reach the live sim. Stripped from prod builds by Next's
      // NODE_ENV inlining.
      if (process.env.NODE_ENV === 'development') { (window as unknown as { __ccDevSim?: unknown }).__ccDevSim = sim }

      // ── THE UI SYSTEM (one layout authority) ──
      // worldData.ui (declarative tree) → ui-solver → ONE rect table that the
      // glass/glyph passes, click routing, hooks, and the AI all read. The
      // solve is pure arithmetic (µs); overrides come from UI EDIT / the world;
      // entity anchors ride worldData.__entities (the world's own projection).
      try {
        // the HUB never shows a world's UI (same law as hud: the tree lingers
        // in worldData after you leave — don't let it bleed onto the cafe)
        const onHubUi = sim.fields.has('cf_world_f') || sim.fields.has('cf_submain_f')
        const uiT = onHubUi ? undefined : sim.worldData['ui'] as UiTree | undefined
        if (uiT && Array.isArray(uiT.root) && uiT.root.length) {
          const solved = solveUi({
            ui: uiT,
            entities: sim.worldData['__entities'] as Parameters<typeof solveUi>[0]['entities'],
            overrides: sim.worldData['__uiOverrides'] as Record<string, UiOverride> | undefined,
          })
          uiSolvedRef.current = solved
          renderer.setUiSolved(solved)
          // publish the rect table for hooks + AI — the layout is READABLE data.
          // Republish only when the geometry actually changed (cheap fingerprint)
          // so the worker tick payload doesn't carry a fresh clone every frame.
          let fp = solved.rev * 31 + solved.hits.length
          for (const id in solved.rects) { const r = solved.rects[id]; fp = (fp * 31 + id.length + r.x * 7 + r.y * 13 + r.w * 3 + r.h) % 1e9 }
          if (fp !== uiRectsFpRef.current) {
            uiRectsFpRef.current = fp
            sim.worldData['__uiRects'] = { rev: solved.rev, rects: solved.rects, hits: solved.hits.map(h => ({ id: h.id, action: h.action, x: h.x, y: h.y, w: h.w, h: h.h })) }
            if (uiEditOnRef.current) setUiEditPanels(solved.panels)
          }
          // UI EDIT overlay geometry: track the resting square so panel
          // outlines sit exactly on the rendered pixels (cheap compare)
          if (uiEditOnRef.current) {
            const cnv = canvasRef.current
            if (cnv) {
              const cw = cnv.clientWidth, chh = cnv.clientHeight
              const sideE = Math.min(cw, chh)
              setUiEditSquare(prev => (prev && prev.side === sideE && prev.left === (cw - sideE) / 2 && prev.top === (chh - sideE) / 2) ? prev : { left: (cw - sideE) / 2, top: (chh - sideE) / 2, side: sideE })
            }
          }
        } else if (uiSolvedRef.current) {
          uiSolvedRef.current = null
          renderer.setUiSolved(null)
          uiRectsFpRef.current = -1
          delete sim.worldData['__uiRects']
        }
      } catch { /* the UI layer must never take down the frame */ }

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

      // Trigger async readback of hit ID map for pixel-perfect hit testing —
      // only when a field is actually hittable (skipped for noHit worlds like the
      // raymarched 3D scenes, whose hit map is always empty).
      if (superFields.length > 0 && renderer.hitReadbackNeeded) {
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

          // SEMANTIC CHANNELS: derive per-field channel readings from the fresh
          // presence maps and hand them to the world (wd.__channels[id] = {heat: 0.4}).
          // The engine STATES the intersection; the world's hook decides what it means.
          // Runs at the presence throttle (~4Hz), so it's cheap. Absent when no field
          // publishes a 'ch:*' tag.
          const channels = sim.allChannelReadings()
          if (Object.keys(channels).length) sim.worldData['__channels'] = channels
          else if (sim.worldData['__channels']) delete sim.worldData['__channels']

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

  // Cafe-wide AI presence: is ANY connected AI live on the commons right now?
  // The agentConnected flag above is per-tab, per-world (this browser's SSE to
  // the agent channel). The connect-prompt plugs an AI into the COMMONS, not
  // into this tab's stream — so the pill also consults commons presence, and a
  // freshly plugged-in agent lights the indicator everywhere. Poll is cheap and
  // read-only; the endpoint filters out engine/system bus noise.
  const [aiOnCommons, setAiOnCommons] = useState(false)
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const r = await fetch('/api/engine/presence', { cache: 'no-store' })
        if (!r.ok) return
        const d = await r.json()
        if (alive) setAiOnCommons(!!d?.ai)
      } catch { /* a dropped poll never changes the indicator */ }
    }
    poll()
    const iv = setInterval(poll, 20_000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  // SSE subscription to agent command channel
  useEffect(() => {
    let es: EventSource | null = null
    let retryTimeout: ReturnType<typeof setTimeout>
    // Command context for applyBridgeCommand — built ONCE at mount, inside this
    // effect's (intentionally empty-dep) closure, so every member keeps exactly
    // the identity the inline switch captured before the carve (spec §1c: the
    // stale-closure semantics are load-bearing; do not "fix" by rebuilding).
    const cmdCtx = {
      setGeneration, setRunning, setBrush, setDialogLog, setTerminalLog,
      liveHooksRef, cameraRef, cameraFollowRef, audioRef, wgslModsRef,
      cachedOverlapMasksRef, simulationRef,
      getModCode, saveSceneAs, syncFields, showToast,
      installHooks, allStepHookSnapshots, updateSelectionMask, gridSize, FIT_ZOOM,
    }

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

          await applyBridgeCommand(cmd, { ...cmdCtx, sim, renderer, input, data })
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
        // HUBWORLD visit: NEVER sync member content over the hub's snapshot
        if (visitingRef.current) return
        // Canonical serialization (P2 persistence module). excludeBroken: quarantined
        // visuals must not circulate through the store forever, costing every fresh
        // session an isolation sweep.
        const snap = serializeWorld(sim, renderer, { stepHooks: allStepHookSnapshots(sim), excludeBroken: true })
        // SAVE STATES · ROM PROTECTION: the shared snapshot carries only ROM + declared-
        // shared keys — player state never circulates between tabs again (the Aug 7 leak).
        // Design mode skips the strip: the owner's live worldData IS the new ROM.
        if (romBaselineRef.current && !designModeRef.current) snap.worldData = stripSaveState(snap.worldData, romBaselineRef.current, romSharedRef.current)
        // TEARDOWN GUARD: a hot-reload leaves the renderer with 0 visuals for a beat.
        // Skinned fields but no visuals is a transient, not a real state — persisting it
        // renders everyone DARK. Skip it.
        if (isTeardownSnapshot(snap.fields, snap.visualTypes.length)) return
        // P1: for a space sync, send hash-only for shaders the server already holds
        // (content-addressed). Global (non-space) sync keeps sending full.
        const known = syncedHashesRef.current
        const wireShaders = spaceId
          ? { visualTypes: diffShaders(snap.visualTypes, known.vis), modules: diffShaders(snap.modules, known.mod) }
          : { visualTypes: snap.visualTypes, modules: snap.modules }
        const syncBody = {
          clientId: clientIdRef.current,
          takeover: takeoverRef.current,
          ...snap,
          ...wireShaders,
          renderedSamples: Object.fromEntries(renderedSamplesRef.current),
          // Space-scoped sync
          ...(spaceId ? { spaceId } : {}),
        }
        syncBytesRef.current = snapshotBytes(syncBody)   // P0: the ACTUAL (diffed) wire size
        const syncRes = await fetch('/api/engine/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncBody),
        })
        const syncData = await syncRes.json().catch(() => null) as { deferred?: string; resync?: { visualTypes?: string[]; modules?: string[] } } | null
        if (syncRes.status === 409) {
          setWorldLocked(true)
        } else if (syncData?.resync) {
          // server lacks some shader content we sent hash-only — forget those so the
          // next tick resends them in full (nothing was persisted this tick).
          for (const n of syncData.resync.visualTypes || []) known.vis.delete(n)
          for (const n of syncData.resync.modules || []) known.mod.delete(n)
        } else if (syncRes.ok) {
          takeoverRef.current = false
          setWorldLocked(false)
          // stored successfully → the server now holds exactly these shader hashes,
          // so the next tick may send them hash-only. (Skip on deferred: server unchanged.)
          if (spaceId && !syncData?.deferred) {
            syncedHashesRef.current = { vis: shaderHashes(snap.visualTypes), mod: shaderHashes(snap.modules) }
          }
          // A deferred sync means an AI is writing this world over the bridge
          // RIGHT NOW (the server skipped our sync to protect that write).
          // A live hand in the world must be VISIBLE to the human in it.
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
  // LATCH: once a world has been observed brief_done, it is COMPLETE — a later
  // transient flicker of brief_done (during a chapter transition / mid-adopt
  // reload) must NOT re-raise the build curtain. Reset only when the world
  // actually changes. (The bug: entering a new TIDEGLASS chapter flashed the
  // 'AI is building' window because brief_done briefly read false.)
  const everDoneRef = useRef(false)
  useEffect(() => { everDoneRef.current = false }, [spaceSlug, playScene])
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
        // Show the build window only when an AI is ACTUALLY on it — `live` (a
        // heartbeat in the last 2 min) — or a job is genuinely QUEUED (`pending`,
        // a builder will pick it up). A `leased`/`building`/`needs_review` job with
        // NO recent heartbeat is an ORPHAN (the builder died / the job is parked)
        // — `active` was true for it, so the window popped up with no AI building.
        const reallyBuilding = d.live === true || d.status === 'pending'
        if (reallyBuilding) {
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
  // NO auto-snap (Galen): the panel's own ▼ CURRENT button is the one way down.
  // Galen: an AI edit must NOT hijack whoever is watching. The BuilderBox is
  // HUMAN-CHOICE ONLY — the build log still flows into it, but it only opens on a
  // deliberate click of the ⌁ BUILDERBOX button, never an auto-pop on a build.
  useEffect(() => {
    if (terminalLog.length === 0) { buildConsoleClosedRef.current = false; return }
    // no auto-open — a build (esp. an AI edit via the bridge) must not steal the view
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
    let lastSig = ''          // the SHADER signature (drives the delta-repaint parse)
    let lastBakedSig = ''     // the BAKED-photo set signature (name=hash per world)
    let lastCombined = ''     // shader+baked together — the true "nothing changed" gate
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
      // claim the cached sig SYNCHRONOUSLY — restore() below only lands once the
      // GPU device is ready, and the first tick can beat it. With lastSig still
      // '' that tick read the unchanged roster as all-new and took the 64-shader
      // heavy path on every return to main — the cursor-freeze (and the stale
      // shader icon flashing over a world's baked photo) the LIGHT PATH below
      // exists to prevent.
      lastSig = cached.sig
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
    // decode a baked-photo PNG (base64) straight into one 64² atlas cell, packed
    // 0xAABBGGRR to match the shader-rendered cells (renderOneIcon uses the same).
    const decodeCell = async (pngB64: string): Promise<Uint32Array | null> => {
      try {
        const bin = atob(pngB64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { resizeWidth: 64, resizeHeight: 64, resizeQuality: 'high' })
        const cv = new OffscreenCanvas(64, 64)
        const ctx = cv.getContext('2d')
        if (!ctx) { bmp.close?.(); return null }
        ctx.drawImage(bmp, 0, 0, 64, 64)
        bmp.close?.()
        const data = ctx.getImageData(0, 0, 64, 64).data
        const cell = new Uint32Array(64 * 64)
        // FLIP Y: the PNG is top-row-first, but the door samples atlas cells
        // bottom-row-first (matching the GPU-rendered shader cells), so an
        // unflipped photo shows upside down. Write each source row to 63-y.
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const s = (y * 64 + x) * 4; cell[(63 - y) * 64 + x] = data[s] | (data[s + 1] << 8) | (data[s + 2] << 16) | 0xff000000 }
        return cell
      } catch { return null }
    }
    const tick = async () => {
      const [sp, sc, bk] = await Promise.all([
        fetch('/api/spaces/browse').then(x => x.json()).catch(() => null),
        fetch('/api/engine/scene-icons').then(x => x.json()).catch(() => null),
        fetch('/api/spaces/icons').then(x => x.json()).catch(() => null),
      ])
      // BAKED PHOTOS: the eye's photograph of each world (NAME -> {png,hash}). This
      // is the CANONICAL icon — it works for worlds whose look lives in running
      // state (feedback / multi-node / step-hook games) that can't compose a
      // standalone shader. Overlaid onto the atlas below, over the shader placeholder.
      const bakedMap = new Map<string, { png: string; hash: string }>()
      for (const b of ((bk?.icons || []) as Array<{ name?: string; png?: string; hash?: string }>)) {
        if (b?.name && typeof b.png === 'string') bakedMap.set(b.name.toUpperCase(), { png: b.png, hash: String(b.hash ?? '') })
      }
      // house SCENES bake through the same pipeline; their photos ride in on the
      // scene-icons feed (png field). Merge them so scene bubbles wear real frames.
      for (const b of ((sc?.icons || []) as Array<{ name?: string; png?: string; hash?: string }>)) {
        if (b?.name && typeof b.png === 'string') bakedMap.set(b.name.toUpperCase(), { png: b.png, hash: String(b.hash ?? '') })
      }
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
      // worlds with NO composable shader (browse returned no iconWgsl) but a baked
      // photo still deserve a cell — add them so they get a slot for the overlay.
      // These are exactly the games the old shader path could never icon.
      const sceneNames = new Set(scenes.map(s => s.name))
      const bakedOnly = [...bakedMap.keys()]
        .filter(nm => !seen.has(nm) && !sceneNames.has(nm))
        .map(nm => ({ name: nm, hue: 0.6, iconWgsl: '' }))
      const worlds = [...players, ...scenes.filter(s => !seen.has(s.name)), ...bakedOnly]
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
      // fold the baked-photo set into the change gate so a freshly-baked icon
      // re-triggers a render+overlay even when the shader parts didn't move.
      const bakedSig = [...bakedMap.entries()].map(([n, b]) => `${n}=${b.hash}`).sort().join('|')
      const combined = sig + '#' + bakedSig
      if (combined === lastCombined) return
      const bakedChanged = bakedSig !== lastBakedSig
      const rDelta = rendererRef.current
      const shaderChanged = sig !== lastSig
      const w = window as unknown as { __cafeIconSlots?: Record<string, number>; __cafeIconLoading?: Record<string, boolean>; __cafeIconReady?: boolean; __cafeBaked?: Set<string> }
      // tell the hover animator which worlds wear a baked PHOTO, so it never
      // shader-repaints over them ("hovering changes the icon").
      w.__cafeBaked = new Set(bakedMap.keys())
      // reusable: patch every baked photo into its atlas cell. Grows the atlas to
      // cover all slots; returns the patched copy (or the base if nothing patched).
      const overlayBaked = async (base: Uint32Array | null, slotsOut: Record<string, number>, loadingOut: Record<string, boolean>): Promise<Uint32Array | null> => {
        if (!bakedMap.size) return base
        const CELL = 64 * 64
        const maxSlot = Math.max(-1, ...Object.values(slotOf))
        const need = (maxSlot + 1) * CELL
        const atlas = new Uint32Array(need)
        if (base) atlas.set(base.subarray(0, Math.min(base.length, need)))
        let patched = false
        for (const [nm, b] of bakedMap) {
          const sl = slotOf[nm]
          if (sl == null || (sl + 1) * CELL > need) continue
          const cell = await decodeCell(b.png)
          if (!cell) continue
          atlas.set(cell, sl * CELL)
          slotsOut[nm] = sl; delete loadingOut[nm]   // a photographed world always has its cell
          patched = true
        }
        return patched ? atlas : base
      }

      // ── LIGHT PATH — the shader roster is UNCHANGED (backing out to the hub:
      // the cache already holds every shader cell). Do NOT re-render 64 shaders
      // (64 blocking GPU readbacks starve the render loop and FREEZE the cursor);
      // just re-apply the baked photos onto the cached atlas and upload. ──
      if (!shaderChanged && rDelta) {
        const slots = { ...(w.__cafeIconSlots || {}) }
        const loading = { ...(w.__cafeIconLoading || {}) }
        // the cached shelf is already up — never spinner on the way back to the hub
        w.__cafeIconReady = true
        const base = cafeIconCache?.atlas || rDelta.getIconAtlasCPU() || null
        const atlas = await overlayBaked(base, slots, loading)
        if (atlas) rDelta.uploadIconAtlas(atlas)
        w.__cafeIconSlots = slots; w.__cafeIconLoading = loading
        lastSig = sig; lastBakedSig = bakedSig; lastCombined = combined
        if (atlas) { cafeIconCache = { sig, atlas, slots: { ...slots } }; const c0 = cafeIconCache; setTimeout(() => iconCacheSave(c0), 0) }
        return
      }

      // SAME ROSTER, few changed shaders → repaint just those slots in place.
      // Only when NO baked photos exist (the delta caches getIconAtlasCPU, which
      // lacks the GPU-only overlays); with baked photos a shader change takes the
      // full path below so the overlay is re-applied.
      if (lastSig && rDelta && !bakedChanged && bakedMap.size === 0) {
        const parse = (g: string) => new Map(g.split('|').map(e => { const c = e.lastIndexOf(':'); return [e.slice(0, c), e.slice(c + 1)] as [string, string] }))
        const a = parse(lastSig), b = parse(sig)
        const sameRoster = a.size === b.size && [...b.keys()].every(k => a.has(k))
        if (sameRoster) {
          // never shader-repaint a world that wears a baked photo — its cell is a
          // real frame, not a shader; a delta repaint would paint over it.
          const changed = next.filter(i => !bakedMap.has(nameOfSlot[i.slot]) && a.get(nameOfSlot[i.slot]) !== b.get(nameOfSlot[i.slot]))
          if (changed.length > 0 && changed.length <= 8) {
            for (const it of changed) rDelta.renderOneIcon(it.slot, it.wgsl, it.color, 0.5)
            lastSig = sig; lastBakedSig = bakedSig; lastCombined = combined
            const cpu = rDelta.getIconAtlasCPU()
            const w2 = window as unknown as { __cafeIconSlots?: Record<string, number> }
            if (cpu) { cafeIconCache = { sig, atlas: cpu, slots: { ...(w2.__cafeIconSlots || {}) } }; const c2 = cafeIconCache; setTimeout(() => iconCacheSave(c2), 0) }
            return
          }
        }
      }
      lastSig = sig; lastBakedSig = bakedSig; lastCombined = combined
      const r = rendererRef.current
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
      // A world with a baked PHOTO is excluded from the shader pass entirely: its
      // cell is a real frame — the progressive shader render was painting the
      // composed (old-champion) icon over it for a beat before the overlay put
      // the photo back. Photos land via overlayBaked below; skipping them here
      // also shrinks the heavy pass as photo coverage grows.
      const shaderItems = items.filter(i => !bakedMap.has(nameOfSlot[i.slot]))
      const okSlots = (r && shaderItems.length)
        ? await r.renderWorldIconAtlas(shaderItems, 0.5, (sl) => {
            // per-icon: reveal it the instant it lands, clear its spinner
            const nm = nameOfSlot[sl]
            if (nm) { slots[nm] = sl; delete loading[nm] }
          }).catch(() => [] as number[])
        : []
      // any candidate that never got a slot (emblem/feedback world) stops
      // spinning now — it resolves to its living emblem, not an endless spinner.
      for (const sl of okSlots) if (nameOfSlot[sl]) slots[nameOfSlot[sl]] = sl
      // PLACEHOLDER IS READY: the shader/emblem shelf is up now. Clear the spinner
      // HERE — do NOT make it wait on the baked-photo decodes below. The photos are
      // the canonical icon but they swap in progressively; a joiner must never stare
      // at a spinner while the eye's frames stream in (or while a cold shelf bakes).
      for (const nm of Object.keys(loading)) delete loading[nm]
      w.__cafeIconReady = true
      // OVERLAY the baked photos — the canonical icon, over the shader placeholder,
      // so any world the eye has photographed shows its REAL running look. We patch
      // a CPU copy and re-upload so the cache (and next visit) keeps the real faces.
      let finalAtlas = r?.getIconAtlasCPU() || null
      if (r) {
        const patched = await overlayBaked(finalAtlas, slots, loading)
        if (patched && patched !== finalAtlas) { r.uploadIconAtlas(patched); finalAtlas = patched }
      }
      w.__cafeIconSlots = { ...slots }   // publish the baked slots (photos swapped in)
      // leave the finished atlas behind for the next visit to main — in memory
      // AND in sessionStorage, so it survives the full navigation back from a world
      const atlasCPU = finalAtlas
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
      const wl = window as unknown as { __cafeIconSlots?: Record<string, number>; __cafeBaked?: Set<string> }
      const live = wl.__cafeIconSlots || {}
      const baked = wl.__cafeBaked || new Set<string>()
      // animate a bubble ONLY if it wears a rendered SHADER icon — never a baked
      // PHOTO (re-rendering its shader on hover would paint over the photograph),
      // and never an emblem world (no slot).
      const cur = hovered && live[hovered] != null && !baked.has(hovered) ? byName[hovered] : null
      if (cur) { animName = hovered; r.renderOneIcon(cur.slot, cur.wgsl, cur.color, performance.now() / 1000) }
      else if (animName) { const it = byName[animName]; const nm = animName; animName = null; if (it && !baked.has(nm)) r.renderOneIcon(it.slot, it.wgsl, it.color, 0.5) }
    }, 33)
    return () => { stop = true; clearInterval(iv); clearInterval(animIv); window.removeEventListener('cafe:hover', onHover) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playScene])

  const selectedField = selection.selectedFieldId ? fields.get(selection.selectedFieldId) : null

  // CONNECT AI open flow — shared by the ⚡ CONNECT AI button AND the
  // "AI UNPLUGGED" status pill (clicking the pill should DO the obvious thing).
  const openConnectAi = async () => {
    // an AI prompt box: its key mint needs a session. Auth FIRST.
    if (!me) {
      const sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null)
      if (!sess?.user) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname); return }
      setMe(sess.user.email || sess.user.name || null)
    }
    // owner on their own LIVE space: the AI edits the world DIRECTLY — the
    // established version system (save points / SET MAIN) is the history and
    // safety net, not a branch detour. (branch→fork transition: branch-to-edit
    // retired with branch voting; a fork is simply a new world.)
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
          {/* In fullscreen (L in a mouse-look world) the engine's sizing parent
              fills the viewport; keep the canvas stretched to it so the world
              CSS-fills the screen. Always mounted — fullscreen happens while the
              chip (and its own <style>) is hidden. Backing buffer follows
              clientWidth/clientHeight in renderer.ts, so this drives it. */}
          <style>{`:fullscreen>canvas{width:100%!important;height:100%!important}`}</style>
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
                ? <div className="text-red-100/90 leading-relaxed">The GPU dropped out — this can be a heavy world, or a driver reset / GPU switch on your machine. Rendering is stopped so it can&rsquo;t keep flickering. Reload usually recovers; the rest of the cafe is fine.</div>
                : <div className="text-red-100/90 leading-relaxed break-words">{fault.message}</div>}
              <div className="flex gap-2 mt-2">
                {(fault.kind === 'gpu-lost' || fault.kind === 'frame-crash') && (
                  <button onClick={() => window.location.reload()}
                    className="px-2 py-1 rounded bg-red-500/30 hover:bg-red-500/50 border border-red-400/40 text-red-50">RELOAD WORLD</button>
                )}
                <button
                  onClick={async (e) => {
                    const detail = `[${fault.kind}] ${fault.message} — scene: ${lastSceneRef.current || playScene || spaceSlug || 'unknown'} — engine ${ENGINE_BUILD} — ${new Date().toISOString()}`
                    const b = e.currentTarget
                    const ok = await copyText(detail)
                    b.textContent = ok ? 'copied ✓' : 'copy blocked'
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
          {can(ctx, 'toolsPanel') && chromeVisible && (
            <WorldToolsPanel simulationRef={simulationRef} spaceId={spaceId} spaceSlug={spaceSlug} isOwner={isOwner} lastSceneRef={lastSceneRef} setChromeVisible={setChromeVisible} ctx={ctx} presenceOff={presenceOff} setPresenceOff={setPresenceOff} presenceOffRef={presenceOffRef} setToolsTick={setToolsTick} lineageBase={lineageBase} loadLineage={loadLineage} lineageBusy={lineageBusy} lineageTrail={lineageTrail} lineageRemixes={lineageRemixes} />
          )}

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

          {/* INSPECT overlay: blue cast + 64-unit grid + click console. The tint is
              pointer-events-none; the console panel is interactive (click = copy). */}
          {inspectOn && (
            <div className="fixed inset-0 z-[80] pointer-events-none"
              style={{ background: 'rgba(56,110,190,0.10)', boxShadow: 'inset 0 0 0 3px rgba(90,160,255,0.55)',
                backgroundImage: 'repeating-linear-gradient(0deg, rgba(120,170,255,0.10) 0 1px, transparent 1px 12.5%), repeating-linear-gradient(90deg, rgba(120,170,255,0.10) 0 1px, transparent 1px 12.5%)' }} />
          )}
          {inspectOn && (
            <div className="fixed top-14 left-3 z-[999] pointer-events-auto font-mono text-[12px] bg-black/75 backdrop-blur rounded-lg border border-sky-400/40 p-2.5 max-w-[380px]">
              <div className="text-sky-200 tracking-[0.15em] mb-1.5">◉ INSPECT — clicks are documented for the AI (game paused)
                {inspectHover ? <span className="ml-2 text-white/80"><span style={{ display: 'inline-block', width: 10, height: 10, background: inspectHover.hex, border: '1px solid rgba(255,255,255,0.4)', marginRight: 4 }} />{inspectHover.hex} ({inspectHover.x},{inspectHover.y})</span> : null}</div>
              {inspectLog.length === 0 && <div className="text-white/40">click anything…</div>}
              {[...inspectLog].reverse().map((en, i) => (
                <div key={en.at + '-' + i}>
                  <button
                    onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(en)) } catch { /* fine */ } }}
                    title="click to copy (incl. the source WGSL)"
                    className="block w-full text-left text-white/75 hover:text-sky-200 truncate">
                    ({en.x},{en.y}) {en.field ?? 'no field'} · {en.visual ?? '—'} {en.color ? <span style={{ color: en.color }}>■ {en.color}</span> : null}
                    {en.entity ? <span className="text-amber-300"> › entity #{en.entity.id}{en.entity.label ? ' (' + en.entity.label + ')' : ''}</span> : null}
                    {en.ui ? <span className="text-amber-300"> › UI "{en.ui.text}" ({en.ui.id}{en.ui.panel && en.ui.panel !== en.ui.id ? ' ∈ ' + en.ui.panel : ''}) · {en.ui.hook ?? 'ui'}</span> : null}
                    {en.hud ? <span className="text-cyan-300"> › HUD "{en.hud.text}" ({en.hud.id})</span> : null}
                    {en.node ? <span className="text-fuchsia-300"> › {en.node.map(n => `${n.hook} #${n.idx}·k${n.kind}@${n.d}px`).join(' · ')}</span> : null}
                    {en.source ? <span className="text-emerald-300"> · src ✓</span> : null}
                  </button>
                  {/* PIXEL → SOURCE: the newest click shows the exact visual that
                      drew it — backtrack a pixel to the code that produced it. */}
                  {i === 0 && en.source && (
                    <pre className="mt-1 mb-1 max-h-40 overflow-auto rounded bg-black/50 border border-emerald-400/20 px-2 py-1 text-[11px] leading-snug text-emerald-100/80 whitespace-pre-wrap">{en.source.trim()}</pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* UI EDIT overlay — Galen's manual layout mode. Panel outlines ride
              the SOLVED rects (the same table the pixels came from, so the
              handles sit exactly on the glass). Drag = move, right/bottom
              edge = resize, ▾ chip = collapse. Every gesture writes
              worldData.__uiOverrides — live for the solver, readable by the
              AI, persisted with the world's data. The overlay swallows all
              canvas input while on (game paused, like INSPECT). */}
          {uiEditOn && uiEditSquare && (
            <div className="absolute inset-0 z-[70]" style={{ pointerEvents: 'auto', cursor: uiEditDragRef.current ? 'grabbing' : 'default' }}
              onPointerDown={(e) => {
                const sq = uiEditSquare
                const ux = (e.clientX - (e.currentTarget.getBoundingClientRect().left + sq.left)) * (512 / sq.side)
                const uy = (e.clientY - (e.currentTarget.getBoundingClientRect().top + sq.top)) * (512 / sq.side)
                // topmost panel wins (painted last)
                for (let i = uiEditPanels.length - 1; i >= 0; i--) {
                  const p = uiEditPanels[i]
                  if (ux < p.x - 4 || ux > p.x + p.w + 4 || uy < p.y - 4 || uy > p.y + p.h + 4) continue
                  const sim = simulationRef.current
                  if (!sim) return
                  const wd = sim.worldData as Record<string, unknown>
                  const ovAll = { ...((wd['__uiOverrides'] as Record<string, Record<string, unknown>>) ?? {}) }
                  const ov = { ...(ovAll[p.id] ?? {}) }
                  // collapse chip: top-right corner zone
                  if (p.collapsible && ux > p.x + p.w - 16 && uy < p.y + 13) {
                    ov.collapsed = !p.collapsed
                    ovAll[p.id] = ov; wd['__uiOverrides'] = ovAll
                    console.log('[ui-edit]', p.id, ov.collapsed ? 'collapsed' : 'expanded')
                    e.preventDefault(); e.stopPropagation(); return
                  }
                  if (!p.draggable) return
                  const nearR = Math.abs(ux - (p.x + p.w)) < 7, nearB = Math.abs(uy - (p.y + p.h)) < 7
                  uiEditDragRef.current = {
                    id: p.id, mode: (nearR || nearB) ? 'resize' : 'move', sx: ux, sy: uy,
                    start: { dx: Number(ov.dx ?? 0), dy: Number(ov.dy ?? 0), w: Number(ov.w ?? p.w), h: Number(ov.h ?? p.h) },
                  }
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                  e.preventDefault(); e.stopPropagation(); return
                }
              }}
              onPointerMove={(e) => {
                const d = uiEditDragRef.current
                const sq = uiEditSquare
                if (!d) return
                const sim = simulationRef.current
                if (!sim) return
                const r = e.currentTarget.getBoundingClientRect()
                const ux = (e.clientX - (r.left + sq.left)) * (512 / sq.side)
                const uy = (e.clientY - (r.top + sq.top)) * (512 / sq.side)
                const wd = sim.worldData as Record<string, unknown>
                const ovAll = { ...((wd['__uiOverrides'] as Record<string, Record<string, unknown>>) ?? {}) }
                const ov = { ...(ovAll[d.id] ?? {}) }
                if (d.mode === 'move') {
                  ov.dx = Math.round(d.start.dx + (ux - d.sx))
                  ov.dy = Math.round(d.start.dy + (uy - d.sy))
                } else {
                  ov.w = Math.max(24, Math.round(d.start.w + (ux - d.sx)))
                  ov.h = Math.max(14, Math.round(d.start.h + (uy - d.sy)))
                }
                ovAll[d.id] = ov; wd['__uiOverrides'] = ovAll
              }}
              onPointerUp={(e) => {
                const d = uiEditDragRef.current
                if (d) {
                  uiEditDragRef.current = null
                  const sim = simulationRef.current
                  const ov = (sim?.worldData as Record<string, unknown> | undefined)?.['__uiOverrides']
                  console.log('[ui-edit] overrides now', JSON.stringify(ov))
                  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* fine */ }
                }
              }}
            >
              {/* the square frame + per-panel handles */}
              <div className="absolute" style={{ left: uiEditSquare.left, top: uiEditSquare.top, width: uiEditSquare.side, height: uiEditSquare.side, boxShadow: 'inset 0 0 0 2px rgba(255,190,80,0.35)', pointerEvents: 'none' }}>
                {uiEditPanels.map((p) => {
                  const k = uiEditSquare.side / 512
                  return (
                    <div key={p.id} className="absolute" style={{ left: p.x * k, top: p.y * k, width: p.w * k, height: p.h * k, outline: '1.5px dashed rgba(255,190,80,0.8)', background: 'rgba(255,190,80,0.06)' }}>
                      <div className="absolute -top-[15px] left-0 px-1 font-mono text-[10px] leading-[14px] text-amber-200 bg-black/70 rounded-t" style={{ letterSpacing: '0.1em' }}>{p.id}</div>
                      {p.collapsible && (
                        <div className="absolute top-0 right-0 w-[16px] h-[13px] text-center font-mono text-[9px] leading-[13px] text-amber-100 bg-amber-500/40" title={p.collapsed ? 'expand' : 'collapse'}>{p.collapsed ? '▸' : '▾'}</div>
                      )}
                      {p.draggable && !p.collapsed && (
                        <div className="absolute -bottom-[1px] -right-[1px] w-[9px] h-[9px] bg-amber-400/80" title="drag to resize" />
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="fixed top-14 left-3 z-[999] font-mono text-[12px] bg-black/75 backdrop-blur rounded-lg border border-amber-400/40 p-2.5 max-w-[380px] pointer-events-none">
                <div className="text-amber-200 tracking-[0.15em]">⧉ UI EDIT — drag to move · edge to resize · ▾ to collapse</div>
                <div className="text-white/50 mt-1">changes land in worldData.__uiOverrides (the AI reads them)</div>
              </div>
            </div>
          )}

          {/* GAMEPLAY MODE overlay — total-UI-close. The engine's OWN back button
              (top-left, below) stays; here we add only the ▣ reopen so play is
              clean with exactly one way out + one way back to the UI. */}
          {playMode && (
            <div className="absolute right-3 top-3 z-[60] flex items-center gap-2">
              {/* RECORD → downloads a video of this world to your computer (canvas only,
                  no UI in the frame). Native MP4 where the browser supports it. */}
              <button onClick={recording ? stopRecording : startRecording}
                title={recording ? 'stop & download the recording' : 'record this world to a video file (saves to your computer — nothing is uploaded)'}
                className={`h-9 px-3 rounded-lg font-mono text-[14px] backdrop-blur border transition-colors inline-flex items-center gap-2 ${recording ? 'bg-red-500/30 border-red-400/60 text-red-50 hover:bg-red-500/40' : 'bg-black/50 border-white/10 text-white/70 hover:text-white hover:bg-black/70'}`}>
                <span className={`inline-block w-2.5 h-2.5 rounded-full bg-red-500 ${recording ? 'animate-pulse' : ''}`} />
                {recording ? `${Math.floor(recSecs / 60)}:${String(recSecs % 60).padStart(2, '0')}` : 'REC'}
              </button>
              <button onClick={exitPlayMode} title="show the UI again"
                className="w-9 h-9 rounded-lg font-mono text-[16px] bg-black/50 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/70 transition-colors">▣</button>
            </div>
          )}

          {/* WORLD CHAT — its own door, bottom-left, apart from the EDIT dock */}
          {!isHub && playScene !== 'CAFE' && playScene !== 'SUB-MAIN' && !worldChatOpen && !viewport && !playMode && (
            <button
              onClick={() => setBuildConsoleOpen(v => { const nv = !v; buildConsoleClosedRef.current = !nv; return nv })}
              className="absolute left-3 bottom-3 z-40 px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors inline-flex items-center gap-1.5"
              title={chatLive.people > 0 ? `${chatLive.people} in the BuilderBox now — chat + build console; entries can summon AI builders` : 'BuilderBox — the world\'s chat + build console'}
            >
              ⌁ {(spaceId ? (spaceName || spaceSlug || 'world') : (cellBase() || 'world')).split(' ⑂ ')[0].toUpperCase()} BUILDERBOX
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
          <div ref={dockRef} className={`absolute right-3 z-40 flex flex-col items-stretch gap-1.5 ${viewport || playMode ? 'hidden' : ''} ${playScene === 'CAFE' || playScene === 'SUB-MAIN' ? 'top-16' : 'top-3'}`}>
            {/* GAMEPLAY MODE — one tap strips ALL chrome so the world plays clean.
                Game worlds only; hubs are navigation surfaces. */}
            {!isHub && playScene !== 'CAFE' && playScene !== 'SUB-MAIN' && (
              <button
                onClick={enterPlayMode}
                title="gameplay mode — hide all UI and just play"
                className="px-2.5 py-1.5 rounded-lg text-[16px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              >
                ⛶ PLAY
              </button>
            )}
            <button
              onClick={() => setInstrOpen(v => !v)}
              className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            >
              ? INSTRUCTIONS
            </button>
            {/* FORK stands ABOVE the EDIT fold (Galen: out of the dropdown) —
                forking is the front-door act, not a buried control. GREEN = the
                create action. Under it, the ◂/▸ browse row steps the family
                (main → each legacy branch head) — no sign-in needed. */}
            {!isHub && <div className="relative flex flex-col items-stretch gap-1 font-mono text-[14px]">
              {/* FORKABILITY IS OPT-IN (Galen): a player's world shows NO fork
                  button unless its maker enabled forking in WORLD TOOLS — and
                  NEVER to its own owner (it's already yours). House scenes
                  (open ground) remain forkable by nature. */}
              {(spaceId ? (!isOwner && simulationRef.current?.worldData?.['forkable'] === true) : true) && <button
                onClick={() => { if (spaceSlug) instantForkSpace(); else handleBranch() }}
                className="px-2.5 py-1.5 rounded-lg tracking-[0.15em] bg-emerald-400/20 backdrop-blur border border-emerald-300/50 text-emerald-200 hover:bg-emerald-400/30 hover:text-emerald-100 transition-colors"
                title={me ? 'fork this world — instantly yours; your AI does the rest' : 'sign in to fork this world'}
              >
                ⑄ FORK THIS WORLD
              </button>}
              {(branchList.length > 0 || lastSceneRef.current.includes(' ⑂ ')) && (
              <div className="flex items-stretch justify-between rounded-lg overflow-hidden bg-black/60 backdrop-blur border border-white/10">
                <button onClick={() => stepBranch(-1)} title="previous in the family"
                  className="px-2 py-1 text-white/45 hover:text-white hover:bg-black/80 transition-colors">◂</button>
                <span className="px-1 py-1 text-[14px] text-white/35 tracking-[0.25em] select-none">BROWSE</span>
                <button onClick={() => stepBranch(1)} title="next in the family"
                  className="px-2 py-1 text-white/45 hover:text-white hover:bg-black/80 transition-colors">▸</button>
              </div>
              )}
              {/* (the ⚖ "call a resolution/issue" button was removed — it wasn't
                  wired up yet. The world's ONE real vote is the ⚔ RECKONING that
                  TournamentBar seats just below this dock.) */}
              {/* the methodical fork panel: 1 · name it · 2 · say what it should
                  become — the fork opens as YOUR world at /space/<slug> */}
              {branchCreateOpen && (
                <div className="absolute right-full top-0 mr-2 z-50 w-72 max-h-[80vh] overflow-y-auto rounded-xl bg-[#0d0906]/95 backdrop-blur border border-emerald-300/25 p-3 shadow-2xl">
                  <div className="text-[14px] tracking-[0.25em] text-emerald-200/80 mb-1">⑄ FORK THIS WORLD</div>
                  <div className="text-[14px] text-white/40 leading-snug mb-2">a <span className="text-emerald-200/80">fork</span> is your own copy — a new world you own, with lineage back to this one. The original stays the maker&apos;s.</div>
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
                          className="w-full px-2 py-1.5 rounded bg-emerald-400/20 border border-emerald-300/50 text-emerald-200 hover:bg-emerald-400/30 text-[14px] tracking-[0.15em] transition-colors disabled:opacity-40">
                          FORK IT — IT BECOMES YOURS
                        </button>
                      </div>
                    </>)
                  })()}
                  <button onClick={() => setBranchCreateOpen(false)} aria-label="cancel"
                    className="w-full mt-2 px-2 py-1 rounded border border-white/15 text-white/40 hover:text-white text-[14px] transition-colors">cancel</button>
                </div>
              )}
            </div>}
            {/* THE SHELF SWITCH — owner-only, ABOVE the edit fold (Galen: out of
                world tools, one click to publish/private, confirm either way).
                Shows the world's CURRENT visibility; the popup names the act. */}
            {!isHub && spaceId && isOwner && !versionView && spacePublic !== null && (
              <div className="relative">
                <button
                  onClick={() => setPubConfirm(v => !v)}
                  title={spacePublic ? 'this world is PLAYABLE — click to take it off the shelf' : 'this world is UNPLAYABLE — click to put it on the shelf'}
                  className={'w-full px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono backdrop-blur border transition-colors ' +
                    (spacePublic
                      ? 'bg-amber-400/15 border-amber-300/40 text-amber-200 hover:bg-amber-400/25'
                      : 'bg-black/60 border-white/15 text-white/60 hover:text-white hover:bg-black/80')}
                >
                  {spacePublic ? '● PLAYABLE' : '○ UNPLAYABLE'}
                </button>
                {pubConfirm && (
                  <div className="absolute right-full top-0 mr-2 z-50 w-64 rounded-xl bg-[#0d0906]/95 backdrop-blur border border-amber-300/25 p-3 shadow-2xl font-mono">
                    <div className="text-[14px] text-white/80 leading-snug mb-2">
                      {spacePublic
                        ? 'make this world UNPLAYABLE? it comes off the shelf — it stays yours to edit, and its code stays readable in the library.'
                        : 'make this world PLAYABLE? it goes on the shelf and anyone can play it.'}
                    </div>
                    <button disabled={pubBusy}
                      onClick={async () => {
                        setPubBusy(true)
                        try {
                          const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug!)}`, {
                            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isPublic: !spacePublic }),
                          })
                          const d = await r.json().catch(() => null)
                          if (r.ok) setSpacePublic(typeof d?.space?.isPublic === 'boolean' ? d.space.isPublic : !spacePublic)
                        } finally { setPubBusy(false); setPubConfirm(false) }
                      }}
                      className={'w-full px-2 py-1.5 rounded text-[14px] tracking-[0.15em] transition-colors disabled:opacity-40 ' +
                        (spacePublic
                          ? 'bg-black/50 border border-white/20 text-white/80 hover:text-white'
                          : 'bg-amber-400/20 border border-amber-300/50 text-amber-200 hover:bg-amber-400/30')}
                    >
                      {pubBusy ? '…' : spacePublic ? 'MAKE UNPLAYABLE' : 'MAKE PLAYABLE'}
                    </button>
                    <button onClick={() => setPubConfirm(false)}
                      className="w-full mt-1.5 px-2 py-1 rounded border border-white/15 text-white/40 hover:text-white text-[14px] transition-colors">
                      cancel
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* game worlds fold their meta-UI behind one dock; back/tools/sound/
                instructions + the game's own HUD stay out. CAFE / hubs / SUB-MAIN
                are navigation surfaces — they show everything as before. */}
            {!isHub && playScene !== 'CAFE' && playScene !== 'SUB-MAIN' && (
              <button
                onClick={() => setUiDockOpen(v => !v)}
                title={uiDockOpen ? 'hide world controls' : 'world controls — fork, versions, connect AI'}
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
            {/* (duplicate rail button removed — door-Opus's bottom-left ⌁ pill
                is the ONE BuilderBox surface, per the negotiated split) */}
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
            {/* ⚭ INVITE — the crew door, one tap: mints a ONE-TIME join link
                and copies it. Owner-only; lives in the dock, not buried in
                WORLD TOOLS (Galen). Kick = revoke their member key in tools. */}
            {!isHub && isOwner && spaceSlug && (
              <button
                onClick={() => void mintInviteLink()}
                title="mint a one-time invite link — the first signed-in person to open it joins your crew as a builder"
                className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              >
                ⚭ INVITE
              </button>
            )}
            {/* ⬢ NODES — the co-build dock panel: who builds what. Node roster
                with hold states, per-node history timelines (owner revert),
                and each node's internals feed. Spaces only — nodes are the
                unit of collaborative building. */}
            {!isHub && spaceSlug && (
              <button
                onClick={() => setNodesOpen(v => !v)}
                title="the world's nodes — holds, history, feeds; the co-build roster"
                className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              >
                ⬢ NODES
              </button>
            )}
            {/* INSPECT — AI click telling: clicks become documentation (never gameplay);
                entries land in wd.__clicks for any connected AI to decode. */}
            {!isHub && (
              <button
                onClick={() => { setInspectOn(v => { inspectOnRef.current = !v; return !v }); setInspectLog([]); setEditCoach(false) /* the first-open coach eats canvas clicks; the dock itself stays open (Galen) */ }}
                title="Inspect mode — click anything to document it for the AI (game input is paused)"
                className={inspectOn
                  ? 'px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-sky-500/25 backdrop-blur border border-sky-400/60 text-sky-100 transition-colors'
                  : 'px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors'}
              >
                {inspectOn ? '◉ INSPECT ON' : '◎ INSPECT'}
              </button>
            )}
            {/* UI EDIT — manual layout mode for worlds on the UI SYSTEM
                (worldData.ui): drag/resize/collapse panels; gestures write
                __uiOverrides for the solver AND the AI. Only offered when the
                world actually publishes a ui tree. */}
            {!isHub && uiSolvedRef.current && (
              <button
                onClick={() => { setUiEditOn(v => { uiEditOnRef.current = !v; if (!v) { uiRectsFpRef.current = -1 } else { uiEditDragRef.current = null } return !v }); setEditCoach(false) }}
                title="UI edit mode — drag panels to move, edges to resize, ▾ to collapse. Changes persist in worldData.__uiOverrides."
                className={uiEditOn
                  ? 'px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-amber-500/25 backdrop-blur border border-amber-400/60 text-amber-100 transition-colors'
                  : 'px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors'}
              >
                {uiEditOn ? '⧉ UI EDIT ON' : '⧉ UI EDIT'}
              </button>
            )}
            {/* DESIGN MODE (SAVE STATES) — owner only. OFF (default): the owner gets
                their own per-player save like everyone else. ON: live edits author
                the CARTRIDGE (tuning knobs → shared ROM, not the owner's save). */}
            {isOwner && !isHub && (
              <button
                onClick={() => setDesignMode(v => !v)}
                title="Design mode — your live edits save to the CARTRIDGE for everyone, instead of your personal save. Turn off to play with your own save."
                className={designMode
                  ? 'px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-amber-500/25 backdrop-blur border border-amber-400/60 text-amber-100 transition-colors'
                  : 'px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors'}
              >
                {designMode ? '✎ DESIGN ON' : '✎ DESIGN'}
              </button>
            )}
            {/* build-console link removed from EDIT — the BuilderBox door
                (bottom-left ⌁ pill) is the one surface (chat + console merged) */}
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
            {/* BRANCHES retired on spaces (branch→fork transition): a player
                world's challengers are FORKS with lineage, not branch cells.
                Legacy scenes keep the viewer for their surviving ⑂ heads. */}
            {!isHub && !spaceSlug && <button
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
              title={ctx.role === 'ownerSpace' && ctx.view === 'live'
                ? 'your AI edits this world live — versions keep every save point'
                : undefined}
              className="px-2.5 py-1.5 rounded-lg text-[14px] tracking-[0.15em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            >
              ⚡ CONNECT AI
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
              // connected = this tab's agent SSE OR any AI live on the commons
              // (the connect-prompt plugs into the commons, not this tab) — so
              // the indicator confirms the plug-in prompt worked, cafe-wide.
              const connected = agentConnected || aiOnCommons
              const dot = <span className={`inline-block w-2 h-2 rounded-full ${busy ? 'bg-amber-400 animate-pulse' : connected ? 'bg-emerald-400' : 'bg-white/25'}`} />
              const label = busy ? 'AI EDITING' : connected ? 'AI LIVE' : 'AI UNPLUGGED'
              // AI EDITING is a transient status flash, not an invitation — leave it
              // as a plain indicator so it doesn't beg to be clicked mid-edit.
              if (busy) {
                return (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[14px] tracking-[0.2em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/50">
                    {dot}{label}
                  </div>
                )
              }
              // The pill is ALWAYS clickable and always opens the ONE connect door:
              // the account-level CONNECT AI dialog (copy your reusable player key),
              // the SAME dialog as the account dropdown — no matter where you click.
              // It used to fork by context (in a space it minted a NEW uc_st_ each
              // click, on the hub it copied your existing key), which is why "connect
              // AI" surfaced two different dialogs. The deliberate world-key mint still
              // lives on the explicit ⚡ CONNECT AI button, in-world where it belongs.
              const onPill = () => window.dispatchEvent(new CustomEvent('cafe:open-connect'))
              return (
                <button onClick={onPill} title={connected ? 'manage the AI connection' : 'connect an AI'}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[14px] tracking-[0.2em] font-mono bg-black/60 backdrop-blur border border-white/10 text-white/50 hover:text-white hover:border-emerald-300/40 hover:bg-black/80 transition-colors cursor-pointer">
                  {dot}{label}<span className="text-emerald-300/70">{connected ? '· manage' : '· connect'}</span>
                </button>
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
            if (done) everDoneRef.current = true   // latch: a completed world stays completed
            const aiEditing = !!brief && (Date.now() - aiLastEditRef.current < 15000)
            // Once brief_done is set the world is COMPLETE — show it, never the
            // build curtain, even if a polish job is queued (buildJobActive), the
            // brief still lives in worldData, or the AI is doing live polish. While
            // NOT done, any of three signals raises the curtain: an unfinished
            // brief, a live server job, or AI edits landing now (covers branch
            // jobs that carry no spaceId for buildJobActive to match).
            // A bare brief only means "building" while the world is still BLANK
            // (nothing built yet → genuinely queued). Once fields exist, a stale
            // creation_brief with no brief_done (e.g. the render check refused it,
            // or the house builder never completed) must NOT trap a playable world
            // behind the curtain — require a LIVE signal (server job or AI edits
            // landing now) to keep it up. Mirrors the blank-gated check at ~1989.
            const building = !done && !everDoneRef.current && ((blank && !!brief) || buildJobActive || aiEditing)
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
                  {building ? (agentConnected ? 'YOUR AI IS BUILDING…' : 'WAITING FOR A BUILDER…') : (loadHeavy ? 'COMPILING THIS WORLD…' : 'LOADING WORLD…')}
                </div>
                {loading && loadHeavy && (
                  <div className="font-mono text-[12px] tracking-[0.15em] text-white/30">heavy shaders — a few seconds</div>
                )}
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
          {/* ◈ AI VIEW — a STANDALONE companion panel docked to the LEFT of the
              BuilderBox (Galen: "an independent ai view/focus panel … to the left
              of the builderbox"). Shows what the connected AI is doing (ai_focus,
              auto-set on every AI world-edit) and what it SEES (the latest
              render_probe PNG the bridge stashed to slot ai_eye:<spaceId>). Renders
              under the SAME open condition as the BuilderBox so they travel together;
              always shows its chrome + graceful empty states so it's never invisible. */}
          {/* opens ONLY from human input — the BuilderBox (Galen: the swarm/AI
              view must never auto-open just because a swarm map exists). The
              swarm tab still surfaces INSIDE it once opened. */}
          {buildConsoleOpen && !aiViewDismissed && !isHub && playScene !== 'CAFE' && playScene !== 'SUB-MAIN' && (
            <AiViewPanel aiFocus={aiFocus} aiEye={aiEye} aiViewTab={aiViewTab} setAiViewTab={setAiViewTab} nodeGraph={nodeGraph} setNodesExpanded={setNodesExpanded} perf={perf} swarm={swarm} sendHumanShot={sendHumanShot} humanShot={humanShot} onClose={() => setAiViewDismissed(true)} />
          )}
          {/* the full architecture graph (opened from the NODES tab's ⤢ EXPAND) */}
          {nodesExpanded && nodeGraph && <NodeGraphOverlay graph={nodeGraph} onClose={() => setNodesExpanded(false)} onVisit={(hookId) => {
            // ⤷ VISIT (Galen): click a node → travel to where it renders. Resolve the
            // hook's live entities via __popProv, centroid their world positions, and
            // issue worldData.__goto — the world's movement node consumes it (falls
            // back silently on worlds without a consumer).
            const sim = simulationRef.current
            const wd = sim?.worldData as Record<string, unknown> | undefined
            const prov = wd?.['__popProv'] as { hook: string; from: number; to: number }[] | undefined
            const pop = wd?.['gpuPopulation'] as number[] | undefined
            if (!sim || !wd || !Array.isArray(prov) || !Array.isArray(pop)) return false
            let sx = 0, sy = 0, sz = 0, n = 0
            for (const sg of prov) {
              if (sg.hook !== hookId) continue
              for (let q = sg.from; q < sg.to && q * 4 + 3 < pop.length; q++) {
                const b = q * 4
                const x = Number(pop[b]), y = Number(pop[b + 1]), z = Number(pop[b + 2]), w = Number(pop[b + 3])
                if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(w) < 0.4) continue   // skip aux quads
                sx += x; sy += y; sz += z; n++
              }
            }
            if (!n) return false
            wd['__goto'] = { x: sx / n, y: sy / n, z: sz / n, hook: hookId, at: Date.now() }
            setNodesExpanded(false)
            return true
          }} />}
          {/* ⌁ BUILDERBOX — the merged panel: AI build log + this world's chat.
              Auto-opens while a build runs (see the terminalLog effect). ANY chat
              entry here also pings the network (commons + builderbox:queue) as an
              invitation — watching AIs choose whether to come. */}
          {buildConsoleOpen && !isHub && playScene !== 'CAFE' && playScene !== 'SUB-MAIN' && (
            <BuilderBoxPanel terminalLog={terminalLog} setBuildConsoleOpen={setBuildConsoleOpen} buildConsoleClosedRef={buildConsoleClosedRef} buildConsoleRef={buildConsoleRef} lastSceneRef={lastSceneRef} playScene={playScene} spaceId={spaceId} spaceName={spaceName} spaceSlug={spaceSlug} spaceOwnerName={spaceOwnerName} isOwner={isOwner} isHub={isHub} riding={riding} me={me} handleBranch={handleBranch} onFork={instantForkSpace} forkable={simulationRef.current?.worldData?.['forkable'] === true} setWorldChatOpen={setWorldChatOpen} sendHumanShot={sendHumanShot} humanShot={humanShot} />
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
                  <div><span className="text-white/90">⌁ BUILDERBOX</span> — the build log + world chat; speak and the AI network hears.</div>
                  {spaceSlug && <div><span className="text-white/90">⚭ INVITE</span> — mint a one-time link; the first to open it joins your crew.</div>}
                  {spaceSlug && <div><span className="text-white/90">⬢ NODES</span> — who builds what: holds, history, and revert per node.</div>}
                  {!spaceSlug && <div><span className="text-white/90">≡ BRANCHES</span> — the challengers growing from this world.</div>}
                  <div><span className="text-white/90">⏱ VERSIONS</span> — this world&apos;s history; roll back anytime.</div>
                  <div><span className="text-emerald-300">⚡ CONNECT AI</span> — hand the world to your AI; it edits live, and versions keep every save point.</div>
                  <div><span className="text-white/90">◆ MAKE ICON</span> — have your AI author the world&apos;s shelf badge.</div>
                  <div><span className="text-emerald-300">⑄ FORK THIS WORLD</span> — take your own copy; it becomes a new world you own, with lineage back here.</div>
                </div>
                <button onClick={dismissEditCoach}
                  className="mt-4 w-full rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 py-2 text-[14px] tracking-[0.2em] transition-colors">GOT IT</button>
              </div>
            </div>
          )}
          {instrOpen && (
            <InstructionsPanel playScene={playScene} ctx={ctx} instrEdit={instrEdit} setInstrEdit={setInstrEdit} instrDraft={instrDraft} setInstrDraft={setInstrDraft} setInstrOpen={setInstrOpen} simulationRef={simulationRef} />
          )}

          {/* BRANCHES — the CELL: viewers gather, five unlock the vote, every branch has a table */}
          {versionsOpen && spaceSlug && (
            <VersionsPanel spaceSlug={spaceSlug} playScene={playScene} spaceId={spaceId} isOwner={isOwner} versionBusy={versionBusy} setVersionBusy={setVersionBusy} versionList={versionList} loadVersions={loadVersions} showToast={showToast} setVersionsOpen={setVersionsOpen} />
          )}
          {nodesOpen && spaceSlug && (
            <NodeDockPanel spaceSlug={spaceSlug} isOwner={!!isOwner} onClose={() => setNodesOpen(false)}
              showToast={(m, t, sub) => showToast(m, (t as 'info' | 'success' | 'error') ?? 'info', sub)} />
          )}
          {branchesOpen && (
            <BranchesPanel cellBase={cellBase} cellData={cellData} setCellData={setCellData} cellDraft={cellDraft} setCellDraft={setCellDraft} saveCellDoc={saveCellDoc} whoRef={whoRef} setBranchesOpen={setBranchesOpen} branchList={branchList} handleLoadScene={handleLoadScene} spaceSlug={spaceSlug} discOpen={discOpen} setDiscOpen={setDiscOpen} />
          )}

          {/* CONNECT AI — the plug box: everything an agent needs to edit this
              branch (or build a queued draft directly). Editing an established
              live world no longer happens here — that routes through a branch. */}
          {plugOpen && (() => {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            const mintFailed = !plugToken && !plugBusy   // no key — a copyable briefing would be dead on arrival
            const tok = plugToken || (plugBusy ? '…minting…' : '(no key — see below)')
            const cur = lastSceneRef.current || ''
            const bm = cur.match(/^(.+?) ⑂ (.+?) · v(\d+)$/)   // BASE ⑂ author · vN
            const briefing = worldBriefingPrompt({
              token: tok, worldName: cur || spaceSlug || '',
              branch: bm ? { base: bm[1], by: bm[2], version: bm[3] } : null,
              brief: plugBrief, origin,
            })
            return (
              <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/50" onClick={() => setPlugOpen(false)}>
                <div className="max-w-lg w-[92%] rounded-xl border border-white/15 bg-black/85 backdrop-blur p-5 font-mono text-[17px] leading-relaxed text-white/85" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[16px] tracking-[0.25em] text-white/50">⚡ CONNECT YOUR AI</div>
                    <div className="flex items-center gap-1.5 text-[14px] tracking-[0.2em] text-white/50">
                      <span className={`inline-block w-2 h-2 rounded-full ${agentConnected ? 'bg-emerald-400' : 'bg-white/25'}`} />
                      {agentConnected ? 'LIVE' : 'WAITING'}
                    </div>
                  </div>
                  <p className="text-white/60 mb-2 text-[16px]">
                    Describe what to build here, then paste this to any AI (Claude, or anything that speaks HTTP). The eye versions every settled edit.
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
                        placeholder="what should the AI build here? (optional)"
                        className="w-full bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-[17px] text-white/90 outline-none focus:border-white/35 mb-3" />
                      <pre className="whitespace-pre-wrap bg-black/60 border border-white/10 rounded-lg p-3 text-[16px] text-emerald-200/90 select-all max-h-56 overflow-y-auto">{briefing}</pre>
                    </>
                  )}
                  <div className="flex gap-2 mt-3 justify-end">
                    {!mintFailed && (
                      <button
                        className="text-[14px] tracking-[0.15em] bg-white/10 hover:bg-white/20 border border-white/20 rounded px-3 py-1 transition-colors"
                        onClick={async () => { const ok = await copyText(briefing); showToast(ok ? 'briefing copied' : 'copy blocked — select the text above and copy by hand', ok ? 'success' : 'error') }}
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
            const tok = plugToken || (plugBusy ? '…minting…' : '(minting failed — this world\u2019s contract doesn\u2019t include you)')
            const d = mkIconDesc.trim()
            const prompt = iconAuthorPrompt(tok, d, origin)
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
                      onClick={async () => { if (await copyText(prompt)) { setMkIconCopied(true); setTimeout(() => setMkIconCopied(false), 1600) } else showToast('copy blocked — the prompt text is select-all, copy it by hand', 'error') }}
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
                {/* the title (world name) hides in gameplay mode — the back arrow stays,
                    and FocusChip still renders a compact "developer live" pulse in play
                    mode (playMode prop) so the maker-at-work signal survives gameplay */}
                <FocusChip ctx={ctx} nameOverride={spaceId ? spaceName : undefined} ownerName={spaceId ? spaceOwnerName ?? undefined : undefined} ownerId={spaceId ? spaceOwnerId ?? undefined : undefined} ownerHandle={spaceId ? spaceOwnerHandle ?? undefined : undefined} subOverride={sub} liveSlug={spaceId ? spaceSlug : undefined} viewerIsOwner={isOwner} playMode={playMode} inline />
                {branchy && playScene && !playMode && (
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
            return <ChatWorld channel={channel} slot={key ? 'world-chat:' + key : undefined} vantage={vantage} title={title} subtitle="the world's commons — players, makers, and their AIs" onExit={() => setWorldChatOpen(false)} onBuilderBox={() => { setWorldChatOpen(false); setBuildConsoleOpen(true); buildConsoleClosedRef.current = false }} />
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
