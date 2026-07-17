'use client'
// WorldChrome — DRAFT — the ONE chrome that wraps every world, on every page.
// Replaces both SpaceToolbar (/space/*) and FieldEngine's inline dock (cafe
// shell). It renders nothing of its own logic: it reads a WorldContext and asks
// `can(ctx, cap)` what to show, and calls back into the host (the page that owns
// the engine) for every action. That host — FieldEngine today, a thin wrapper
// tomorrow — supplies the state + handlers via WorldChromeHost.
//
// The point of the draft: see that the space-vs-branch fork is GONE. There is
// one render tree; the differences are `can()` rows, not separate components.
//
// See DESIGN-unified-chrome.md and lib/worldContext.ts.

import { useMemo } from 'react'
import TournamentBar from '@/app/TournamentBar'
import { WorldContext, can, tokenKind, rosterFor } from '@/lib/worldContext'

/** everything WorldChrome needs from whatever owns the engine. The host wires
 *  these to FieldEngine's existing refs/callbacks — no new behavior, just one
 *  address for each action instead of two implementations. */
export interface WorldChromeHost {
  // identity of the running engine, for TournamentBar preview reflow
  agent: { connected: boolean; busy: boolean; name?: string }

  // version/history (unified: one surface, backing store chosen by ctx.kind)
  versions: { label: string; n: number; total: number }   // scrubber state
  onStepVersion: (n: number) => void
  onSetHead: () => void                 // = "make this live" / restore / crown head
  onOpenHistory: () => void

  // AI connect (unified: mints the right token type by ctx)
  onConnectAI: () => void               // opens the plug box (or alter-gate for live space)
  onMakeIcon: () => void

  // branch family
  branchHeads: { name: string; author: string; v: number }[]
  onCreateBranch: () => void
  onBrowseBranch: (dir: 1 | -1) => void
  onOpenBranches: () => void            // the ≡ BRANCHES / podium panel

  // world tools + law
  law: { multiplayer: boolean; restartR: boolean }
  onToggleLaw: (key: 'multiplayer' | 'restartR') => void
  onOpenTools: () => void
  onDelete: () => void

  onOpenInstructions: () => void
  onBack: () => void

  // vote roster inputs (only used on hub surfaces; a world self-fetches)
  vote?: {
    hubMode?: 'main' | 'mine' | 'submain'
    subSlug?: string
    mineWho?: string
    worlds?: string[]
    railTop?: number
    onReckoning?: (open: boolean) => void
    onPreview?: (world: string | null) => void
    onStageRect?: (r: { top: number; right: number; bottom: number; left: number } | null) => void
  }
}

const chip =
  'px-2.5 py-1.5 rounded-lg text-[10px] tracking-[0.15em] font-mono bg-black/60 ' +
  'backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-black/80 transition-colors'
const chipHot =
  'px-2.5 py-1.5 rounded-lg text-[10px] tracking-[0.15em] font-mono bg-amber-400/15 ' +
  'backdrop-blur border border-amber-300/40 text-amber-200 hover:bg-amber-400/25 transition-colors'

/** the FOCUS chip — the single "what am I looking at" element (was built twice:
 *  FieldEngine's chip + SpaceToolbar's badge). */
function FocusChip({ ctx }: { ctx: WorldContext }) {
  const { kind, identity: id, view } = ctx
  const sub =
    kind === 'branch' ? `⑂ ${id.author}${id.version ? ` · v${id.version}` : ''}`
    : kind === 'winner' ? '⚔ winner · on the podium'
    : kind === 'space' ? (view === 'readonlySave' ? 'save point · read-only' : 'your world')
    : (view === 'version' ? 'main · a backup' : 'main · live')
  const branchy = kind === 'branch' || kind === 'winner'
  return (
    <div className="absolute left-3 top-16 z-40 pointer-events-none font-mono rounded-lg bg-black/55 backdrop-blur px-2.5 py-1.5 border border-white/10">
      <div className="text-[11px] tracking-[0.2em] text-white/85">{id.base.toUpperCase()}</div>
      <div className={`text-[9px] tracking-[0.15em] mt-0.5 ${branchy ? 'text-emerald-300/80' : 'text-white/45'}`}>{sub}</div>
    </div>
  )
}

/** the ONE vote surface for this context. main/sub/mine → worlds; a world → its
 *  branches; a space → its save-points. There is no second casting path. */
function Vote({ ctx, host }: { ctx: WorldContext; host: WorldChromeHost }) {
  const roster = useMemo(
    () => rosterFor(ctx, {
      hubMode: host.vote?.hubMode, subSlug: host.vote?.subSlug,
      mineWho: host.vote?.mineWho, worlds: host.vote?.worlds,
    }),
    [ctx, host.vote?.hubMode, host.vote?.subSlug, host.vote?.mineWho, host.vote?.worlds],
  )
  return (
    <TournamentBar
      slot={roster.slot}
      worlds={roster.worlds ?? undefined}
      branchesOf={roster.branchesOf ?? undefined}
      visible
      rail={ctx.surface === 'world'}
      railTop={host.vote?.railTop}
      onReckoning={host.vote?.onReckoning}
      onPreview={host.vote?.onPreview}
      onStageRect={host.vote?.onStageRect}
    />
  )
}

export default function WorldChrome({ ctx, host }: { ctx: WorldContext; host: WorldChromeHost }) {
  const inWorld = ctx.surface === 'world'
  return (
    <>
      {inWorld && <FocusChip ctx={ctx} />}

      {/* the dock — one stack, gated by capability, not by shell */}
      {inWorld && (
        <div className="absolute right-3 top-3 z-40 flex flex-col items-end gap-1.5">
          <button className={chip} onClick={host.onOpenInstructions}>? INSTRUCTIONS</button>

          {/* version scrubber — universal; SET AS HEAD folds in "make live"/restore */}
          {can(ctx, 'versions') && (
            <div className="flex items-center gap-1">
              <button className={chip} onClick={() => host.onStepVersion(host.versions.n - 1)}>◂</button>
              <button className={chip} onClick={host.onOpenHistory}>{host.versions.label}</button>
              <button className={chip} onClick={() => host.onStepVersion(host.versions.n + 1)}>▸</button>
              {can(ctx, 'setHead') && host.versions.n < host.versions.total && (
                <button className={chipHot} onClick={host.onSetHead}>⚑ SET AS HEAD</button>
              )}
            </div>
          )}

          <button className={chip} onClick={host.onOpenBranches}>≡ BRANCHES</button>

          {/* connect: one action, mints the right token kind (or opens alter-gate) */}
          <button className={chip} onClick={host.onConnectAI}>
            {can(ctx, 'alterLive') ? '⚡ ALTER' : '⚡ CONNECT AI'}
            {tokenKind(ctx) && <span className="text-white/30"> · {tokenKind(ctx)}</span>}
          </button>

          {can(ctx, 'makeIcon') && <button className={chip} onClick={host.onMakeIcon}>◆ MAKE ICON</button>}

          {/* the branch-standing chip (read-only mirror of the real TDoc) lives
              here for a ridden challenger; casting happens only in <Vote/> */}

          <div className={chip}>
            {host.agent.busy ? 'AI PROCESSING' : host.agent.connected ? 'AI LIVE' : 'AI UNPLUGGED'}
          </div>

          {can(ctx, 'createBranch') && (
            <div className="flex flex-col items-stretch gap-1">
              <button className="px-2.5 py-1.5 rounded-lg text-[10px] tracking-[0.15em] font-mono bg-emerald-400/20 border border-emerald-300/50 text-emerald-200 hover:bg-emerald-400/30" onClick={host.onCreateBranch}>⑂ CREATE BRANCH</button>
              <div className="flex justify-between rounded-lg bg-black/60 border border-white/10">
                <button className="px-2 py-1 text-white/45 hover:text-white" onClick={() => host.onBrowseBranch(-1)}>◂</button>
                <span className="px-1 py-1 text-[9px] text-white/35 tracking-[0.25em]">BROWSE</span>
                <button className="px-2 py-1 text-white/45 hover:text-white" onClick={() => host.onBrowseBranch(1)}>▸</button>
              </div>
            </div>
          )}

          {can(ctx, 'worldTools') && <button className={chip} onClick={host.onOpenTools}>⚙ tools</button>}
          {can(ctx, 'deleteWorld') && <button className={chip} onClick={host.onDelete}>✕ delete</button>}
        </div>
      )}

      {/* the one vote module, every context */}
      <Vote ctx={ctx} host={host} />
    </>
  )
}
