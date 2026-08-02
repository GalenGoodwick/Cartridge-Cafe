// engine/ai-view/AiViewPanel.tsx — the ◈ AI VIEW companion panel, carved out of
// FieldEngine.tsx (DESIGN-fieldengine-carve.md, Phase 4). Pure move, byte-identical
// body. Shows what the connected AI is doing (ai_focus) and SEES (render_probe),
// the compact NODES architecture tab, the live ⛓ SWARM work-graph, and the P0
// perf footer. Swarm data is polled by FieldEngine and passed in.
'use client'

/* eslint-disable @next/next/no-img-element */
import type { Dispatch, SetStateAction } from 'react'
import { NODE_KIND_STYLE, type AiNodeGraph } from './NodeGraph'

// A node in the SWARM work-graph (mirrors swarm-store mapSummary → NodeView).
export type SwarmNodeView = {
  id: string; element: string; kind: string; status: string; claim: string | null; note?: string
  pseudocode?: string; connects?: { to: string; via: string }[]; children?: SwarmNodeView[]
}
const SWARM_STATUS_COLOR: Record<string, string> = {
  green: '#6ee7b7', claimed: '#7dd3fc', partial: '#fcd34d', red: '#fca5a5', gated: '#fde68a', open: 'rgba(255,255,255,0.32)', unknown: 'rgba(255,255,255,0.25)',
}
// The swarm tree, rendered recursively — an element, its status dot, who's docked
// (◈), its connections (→ target), and its subnodes nested beneath.
function SwarmRows({ nodes, depth = 0 }: { nodes: SwarmNodeView[]; depth?: number }) {
  return <>{nodes.map(n => (
    <div key={n.id} style={{ paddingLeft: depth * 10 }} className="py-0.5">
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: SWARM_STATUS_COLOR[n.status] || SWARM_STATUS_COLOR.unknown }} title={n.status} />
        <span className="text-white/80 truncate" title={n.pseudocode || n.element}>{n.element}</span>
        {n.claim && <span className="text-sky-300/80 shrink-0" title={'docked: ' + n.claim}>◈{n.claim.length > 8 ? n.claim.slice(0, 7) + '…' : n.claim}</span>}
        <span className="text-white/20 shrink-0 ml-auto">{n.kind}</span>
      </div>
      {n.connects && n.connects.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5" style={{ paddingLeft: 14 }}>
          {n.connects.map((c, i) => <span key={i} className="px-1 rounded border border-white/10 text-white/35 text-[10px]" title={c.via}>→ {c.to}</span>)}
        </div>
      )}
      {n.children && n.children.length > 0 && <SwarmRows nodes={n.children} depth={depth + 1} />}
    </div>
  ))}</>
}

export function AiViewPanel({ aiFocus, aiEye, aiViewTab, setAiViewTab, nodeGraph, setNodesExpanded, perf, swarm, sendHumanShot, humanShot, onClose }: {
  aiFocus: { action?: string; fieldName?: string; at?: number; error?: { name: string; type: string; error: string } | null } | null
  aiEye: { png?: string; at?: number; name?: string; stats?: { meanLum?: number; maxLum?: number; coveragePct?: number; visible?: boolean; motion?: number; visual?: string; errors?: number; hookErrors?: number; dominantColors?: number[][] } } | null
  aiViewTab: 'eye' | 'nodes' | 'swarm'
  setAiViewTab: Dispatch<SetStateAction<'eye' | 'nodes' | 'swarm'>>
  nodeGraph: AiNodeGraph | null
  setNodesExpanded: Dispatch<SetStateAction<boolean>>
  perf: { frameMs: number; hookMs: number; topHook: [string, number] | null; compileMs: number; compileAgeS: number; fields: number; syncKB: number } | null
  swarm: { project: string; done: number; total: number; nodes: SwarmNodeView[] } | null
  sendHumanShot?: () => void
  humanShot?: 'idle' | 'sending' | 'sent' | 'err'
  onClose?: () => void
}) {
            const focusFresh = !!(aiFocus && aiFocus.at && (Date.now() - aiFocus.at < 120000))
            const eyeFresh = !!(aiEye?.png && aiEye.at && (Date.now() - aiEye.at < 300000))
            return (
              <div
                className="absolute bottom-6 z-50 pointer-events-auto w-[272px] max-w-[40vw] h-[560px] max-h-[82vh] rounded-xl border border-amber-300/20 bg-black/85 backdrop-blur overflow-hidden flex flex-col shadow-[0_8px_40px_rgba(0,0,0,0.55)]"
                style={{ right: 'calc(50% + 147px)' }}>
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-amber-300/15 font-mono text-[13px] tracking-[0.2em] text-amber-300/50">
                  <span>◈ AI VIEW</span>
                  <span className="flex items-center gap-2">
                    <span className={focusFresh ? 'text-amber-300/80 animate-pulse' : 'text-white/20'}>{focusFresh ? '● live' : '○ idle'}</span>
                    {onClose && <button onClick={onClose} aria-label="close ai view"
                      className="text-white/35 hover:text-white text-[14px] leading-none px-0.5">✕</button>}
                  </span>
                </div>
                {/* TABS — EYE (focus + render) | NODES (architecture graph) */}
                <div className="flex border-b border-white/10 font-mono text-[12px]">
                  {(['eye', 'nodes', 'swarm'] as const).filter(t => t !== 'swarm' || !!swarm).map(t => (
                    <button key={t} onClick={() => setAiViewTab(t)}
                      className={`flex-1 px-3 py-1.5 tracking-[0.15em] transition-colors ${aiViewTab === t ? 'text-amber-200 bg-white/5 border-b-2 border-amber-300/60' : 'text-white/35 hover:text-white/60 border-b-2 border-transparent'}`}>
                      {t === 'eye' ? '◉ EYE' : t === 'nodes' ? '◇ NODES' : '⛓ SWARM'}
                    </button>
                  ))}
                </div>
                {aiViewTab === 'eye' ? (
                  <>
                    {/* FOCUS — what the AI is working on right now */}
                    <div className="px-3 py-2 border-b border-white/10 font-mono text-[12px]">
                      {focusFresh ? (
                        <div className="flex items-start gap-2 text-amber-300/85">
                          <span className="animate-pulse leading-5">◈</span>
                          <span className="flex-1">
                            {aiFocus!.action || '…'}{aiFocus!.fieldName ? ' · ' + aiFocus!.fieldName : ''}
                            <span className="block text-white/30 text-[11px] mt-0.5">{Math.max(0, Math.round((Date.now() - aiFocus!.at!) / 1000))}s ago</span>
                          </span>
                        </div>
                      ) : (
                        <div className="text-white/30 leading-relaxed">no AI editing this world right now.<br/>when one does, its focus lands here live.</div>
                      )}
                      {/* HUMAN SNAPSHOT — hand your live view to the AI (universal infra):
                          captures the canvas → slot human_shot:<scope> the AI reads. */}
                      {sendHumanShot && (
                        <button onClick={sendHumanShot} disabled={humanShot === 'sending'}
                          title="Capture your current view and send it to the AI editing this world"
                          className="mt-2 w-full px-2 py-1.5 rounded border border-amber-300/25 bg-amber-300/[0.06] hover:bg-amber-300/[0.12] text-amber-200/80 font-mono text-[11px] tracking-[0.1em] transition-colors disabled:opacity-50">
                          {humanShot === 'sending' ? '◈ sending…' : humanShot === 'sent' ? '✓ sent to the AI' : humanShot === 'err' ? '⚠ failed — retry' : '📸 send my view to the AI'}
                        </button>
                      )}
                    </div>
                    {/* SHADER REJECT — the silent-black-screen trap, made loud */}
                    {focusFresh && aiFocus!.error && (
                      <div className="px-3 py-2 border-b border-red-500/20 bg-red-500/[0.07] font-mono text-[11px]">
                        <div className="text-red-300/90 tracking-[0.1em] mb-1">⚠ SHADER REJECTED · {aiFocus!.error.name}</div>
                        <div className="text-red-200/70 leading-relaxed break-words max-h-24 overflow-auto">{aiFocus!.error.error}</div>
                      </div>
                    )}
                    {/* EYE — the AI's render_probe snapshot */}
                    <div className="px-3 pt-2 pb-2.5 flex-1 min-h-0 overflow-auto">
                      <div className="font-mono text-[11px] text-amber-300/45 mb-1.5">◉ what the AI sees{eyeFresh && aiEye!.name ? ' · ' + aiEye!.name : ''}</div>
                      {eyeFresh ? (
                        <>
                          <img src={aiEye!.png!.startsWith('data:') ? aiEye!.png! : 'data:image/png;base64,' + aiEye!.png!} alt="the AI's eye" className="w-full rounded border border-white/10 object-contain bg-black" />
                          {/* the renderer's SELF-REPORT (#7) — what the probe measured, not
                              just what it drew. Red flags surface first. */}
                          {aiEye!.stats && (
                            <div className="mt-1.5 font-mono text-[10.5px] leading-relaxed">
                              {(aiEye!.stats.errors || 0) > 0 && <div className="text-red-300/90">⚠ {aiEye!.stats.errors} shader error{aiEye!.stats.errors === 1 ? '' : 's'} in probe</div>}
                              {(aiEye!.stats.hookErrors || 0) > 0 && <div className="text-amber-300/90">⚠ {aiEye!.stats.hookErrors} hook error{aiEye!.stats.hookErrors === 1 ? '' : 's'} (budget/throw) during probe</div>}
                              {aiEye!.stats.visible === false && <div className="text-red-300/90">⚠ probe target not visible</div>}
                              <div className="text-white/35 flex flex-wrap gap-x-2.5">
                                {typeof aiEye!.stats.coveragePct === 'number' && <span title="pixels the visual covered">cover {Math.round(aiEye!.stats.coveragePct)}%</span>}
                                {typeof aiEye!.stats.meanLum === 'number' && <span className={aiEye!.stats.meanLum < 8 ? 'text-amber-300/80' : ''} title="mean luminance — very low = near-black">lum {Math.round(aiEye!.stats.meanLum)}</span>}
                                {typeof aiEye!.stats.motion === 'number' && <span title="frame-to-frame change">motion {Math.round(aiEye!.stats.motion)}</span>}
                                {aiEye!.stats.visual && <span title="visual sampled">· {aiEye!.stats.visual}</span>}
                              </div>
                              {Array.isArray(aiEye!.stats.dominantColors) && aiEye!.stats.dominantColors.length > 0 && (
                                <div className="flex items-center gap-1 mt-1" title="dominant colors">
                                  {aiEye!.stats.dominantColors.map((c, i) => Array.isArray(c) && c.length >= 3 ? (
                                    <span key={i} className="inline-block w-3.5 h-3.5 rounded-sm border border-white/15" style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />
                                  ) : null)}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="w-full aspect-square rounded border border-dashed border-white/12 bg-black/50 flex items-center justify-center text-center px-3">
                          <span className="font-mono text-[11px] text-white/25 leading-relaxed">no eye yet.<br/>appears when the AI takes a render_probe snapshot of the scene.</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : aiViewTab === 'swarm' ? (
                  /* SWARM — the game-element work-graph: elements, subnodes, who's docked, progress, connections */
                  <div className="flex-1 min-h-0 flex flex-col">
                    {swarm ? (
                      <>
                        <div className="px-3 py-2 border-b border-white/10 font-mono text-[11px]">
                          <div className="flex items-center justify-between">
                            <span className="text-amber-300/60 tracking-[0.15em] truncate" title={swarm.project}>⛓ {swarm.project}</span>
                            <span className="text-white/40 shrink-0 ml-2">{swarm.done}/{swarm.total} green</span>
                          </div>
                          <div className="mt-1.5 h-1.5 rounded bg-white/10 overflow-hidden">
                            <div className="h-full bg-emerald-400/70 transition-all" style={{ width: `${swarm.total ? Math.round((swarm.done / swarm.total) * 100) : 0}%` }} />
                          </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-auto px-2.5 py-2 font-mono text-[11px]">
                          <SwarmRows nodes={swarm.nodes} />
                        </div>
                        <div className="px-3 py-1.5 border-t border-white/10 font-mono text-[10px] text-white/25 flex flex-wrap gap-x-2 gap-y-0.5">
                          {(['green', 'claimed', 'partial', 'open', 'red'] as const).map(s => (
                            <span key={s}><span style={{ color: SWARM_STATUS_COLOR[s] }}>●</span> {s === 'claimed' ? 'docked' : s}</span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="p-3 text-white/30 font-mono text-[11px] leading-relaxed">no swarm graph yet — predesign one over the bridge with <span className="text-amber-300/50">swarm_map {'{nodes:[…]}'}</span>.</div>
                    )}
                  </div>
                ) : (
                  /* NODES — the world's architecture, compact; ⤢ opens the full graph */
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="px-3 py-2 border-b border-white/10 grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                      {(['module', 'visual', 'field', 'hook'] as const).map(k => {
                        const n = nodeGraph ? (k === 'module' ? nodeGraph.modules.length : k === 'visual' ? nodeGraph.visuals.length : k === 'field' ? nodeGraph.fields.length : nodeGraph.hooks.length) : 0
                        return (
                          <div key={k} className="flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ background: NODE_KIND_STYLE[k].dot }} />
                            <span style={{ color: NODE_KIND_STYLE[k].text }}>{n}</span>
                            <span className="text-white/30">{NODE_KIND_STYLE[k].label.toLowerCase()}</span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto px-2.5 py-2 space-y-2.5 font-mono text-[11px]">
                      {nodeGraph && (nodeGraph.modules.length + nodeGraph.visuals.length + nodeGraph.fields.length + nodeGraph.hooks.length) > 0 ? (
                        ([['visual', nodeGraph.visuals], ['field', nodeGraph.fields], ['module', nodeGraph.modules], ['hook', nodeGraph.hooks]] as const).map(([k, list]) => list.length === 0 ? null : (
                          <div key={k}>
                            <div className="text-white/30 tracking-[0.15em] mb-1">{NODE_KIND_STYLE[k].label}</div>
                            <div className="flex flex-wrap gap-1">
                              {list.map(nd => (
                                <span key={nd.id} className="px-1.5 py-0.5 rounded border truncate max-w-full" style={{ borderColor: NODE_KIND_STYLE[k].ring, color: NODE_KIND_STYLE[k].text }} title={nd.title}>{nd.title.length > 22 ? nd.title.slice(0, 21) + '…' : nd.title}</span>
                              ))}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-white/30 leading-relaxed">no nodes yet — this world has no modules, visuals, fields, or hooks loaded.</div>
                      )}
                    </div>
                    <button onClick={() => setNodesExpanded(true)}
                      className="m-2 px-3 py-1.5 rounded border border-amber-300/30 text-amber-200/80 hover:bg-amber-300/10 font-mono text-[12px] tracking-[0.15em] transition-colors">
                      ⤢ EXPAND GRAPH
                    </button>
                  </div>
                )}
                {/* P0 PERF footer — live engine budgets, always visible. Green/amber/red
                    on frame time = the 30/50/60fps cliffs the review said were invisible. */}
                {perf && (
                  <div className="px-3 py-1.5 border-t border-white/10 font-mono text-[10.5px] flex items-center gap-2.5 flex-wrap">
                    <span className={perf.frameMs > 33 ? 'text-red-300' : perf.frameMs > 20 ? 'text-amber-300' : 'text-emerald-300/80'} title="frame time (EMA)">
                      ⧗ {perf.frameMs.toFixed(1)}ms{perf.frameMs > 0 ? ' · ' + Math.round(1000 / perf.frameMs) + 'fps' : ''}
                    </span>
                    <span className={perf.hookMs > 8 ? 'text-amber-300' : 'text-white/40'} title="total step-hook CPU per frame">hooks {perf.hookMs.toFixed(1)}ms</span>
                    {perf.topHook && perf.topHook[1] > 1 && <span className="text-white/30" title="slowest hook by id">↳ {perf.topHook[0].length > 10 ? perf.topHook[0].slice(0, 9) + '…' : perf.topHook[0]} {perf.topHook[1].toFixed(1)}</span>}
                    {perf.compileAgeS < 8 && <span className="text-sky-300/70" title="last WGSL compile latency">⚙ {perf.compileMs.toFixed(0)}ms</span>}
                    {perf.syncKB > 0 && <span className={perf.syncKB > 512 ? 'text-amber-300' : 'text-white/40'} title="last owner-sync snapshot size (posted every 2s)">⇅ {perf.syncKB < 1024 ? perf.syncKB.toFixed(0) + 'KB' : (perf.syncKB / 1024).toFixed(1) + 'MB'}</span>}
                    <span className="text-white/25 ml-auto" title="field count">{perf.fields}f</span>
                  </div>
                )}
              </div>
            )
}
