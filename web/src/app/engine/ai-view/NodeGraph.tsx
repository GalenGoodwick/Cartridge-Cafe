// engine/ai-view/NodeGraph.tsx — P2 seam: the ◈ AI VIEW node-architecture graph,
// extracted from FieldEngine. The world IS a node graph — modules (WGSL libs)
// compose into visuals (shaders) that paint fields (shapes), while step-hooks drive
// the worldData uniforms visuals sample. Read-only in Tier-1; the node model is
// built to become draggable/wireable next. Pure types/helpers + presentational
// components — no engine state, no network.
import { useState } from 'react'
import type { FieldSimulation } from '../simulation'
import type { FieldRenderer } from '../renderer'

export type ANodeModule = { kind: 'module'; id: string; title: string; wgslLen: number }
export type ANodeVisual = { kind: 'visual'; id: string; title: string; wgslLen: number }
export type ANodeField = { kind: 'field'; id: string; title: string; shape?: string; visual?: string; pixelCollide?: boolean }
export type ANodeHook = { kind: 'hook'; id: string; title: string; desc?: string; author?: string; codeLen: number }
export type ANode = ANodeModule | ANodeVisual | ANodeField | ANodeHook
export interface AiNodeGraph {
  modules: ANodeModule[]
  visuals: ANodeVisual[]
  fields: ANodeField[]
  hooks: ANodeHook[]
  edges: { from: string; to: string; kind: 'paints' | 'composes' | 'drives' }[]
}

export const NODE_KIND_STYLE: Record<ANode['kind'], { dot: string; ring: string; text: string; label: string }> = {
  module: { dot: '#34d399', ring: 'rgba(52,211,153,0.45)', text: '#a7f3d0', label: 'MODULES' },
  visual: { dot: '#fbbf24', ring: 'rgba(251,191,36,0.5)', text: '#fde68a', label: 'VISUALS' },
  field: { dot: '#38bdf8', ring: 'rgba(56,189,248,0.45)', text: '#bae6fd', label: 'FIELDS' },
  hook: { dot: '#a78bfa', ring: 'rgba(167,139,250,0.45)', text: '#ddd6fe', label: 'HOOKS' },
}
export const EDGE_STYLE: Record<string, string> = { paints: 'rgba(56,189,248,0.5)', composes: 'rgba(52,211,153,0.28)', drives: 'rgba(167,139,250,0.3)' }

/** Snapshot the live world into a node graph — read straight from the renderer +
 *  simulation the client already holds (no network). Edges are the real data-flow:
 *  visual→field is SPECIFIC (field.visualTypeName); module→visual and hook→visual are
 *  the composition/uniform relationships (every module is in a visual's scope, every
 *  hook writes the worldData a visual samples). */
export function buildNodeGraph(sim: FieldSimulation | null, renderer: FieldRenderer | null): AiNodeGraph {
  const r = renderer as unknown as { getAllModules?: () => { name: string; wgsl: string }[]; getAllVisualTypes?: () => { id: number; name: string; wgsl: string }[] } | null
  const mods = (r?.getAllModules?.() ?? [])
  const vis = (r?.getAllVisualTypes?.() ?? [])
  const flds = sim ? Array.from(sim.fields.values()) : []
  const hks = sim ? Array.from(sim.stepHooks.entries()) : []
  const modules = mods.map(m => ({ kind: 'module' as const, id: 'm:' + m.name, title: m.name, wgslLen: (m.wgsl || '').length }))
  const visuals = vis.map(v => ({ kind: 'visual' as const, id: 'v:' + v.name, title: v.name, wgslLen: (v.wgsl || '').length }))
  const fields = flds.map((f) => ({ kind: 'field' as const, id: 'f:' + f.id, title: f.name || f.id, shape: f.shapeType, visual: f.visualTypeName, pixelCollide: f.pixelCollide }))
  const hooks = hks.map(([id, h]) => ({ kind: 'hook' as const, id: 'h:' + id, title: id, desc: h.description, author: h.author, codeLen: (h.code || '').length }))
  const edges: AiNodeGraph['edges'] = []
  for (const f of flds) if (f.visualTypeName && visuals.some(v => v.id === 'v:' + f.visualTypeName)) edges.push({ from: 'v:' + f.visualTypeName, to: 'f:' + f.id, kind: 'paints' })
  for (const m of modules) for (const v of visuals) edges.push({ from: m.id, to: v.id, kind: 'composes' })
  for (const h of hooks) for (const v of visuals) edges.push({ from: h.id, to: v.id, kind: 'drives' })
  return { modules, visuals, fields, hooks, edges }
}

/** The expanded architecture graph + inspector. A layered left→right DAG:
 *  modules & hooks (inputs) → visuals → fields, drawn in SVG with a click-to-inspect
 *  side panel. */
export function NodeGraphOverlay({ graph, onClose }: { graph: AiNodeGraph; onClose: () => void }) {
  const [sel, setSel] = useState<string | null>(null)
  const NODE_W = 168, NODE_H = 30, VGAP = 12, TOP = 44
  const COLX: Record<string, number> = { module: 24, hook: 236, visual: 448, field: 672 }
  // lay each kind out as a vertical stack in its column
  const place = (nodes: ANode[], x: number) => nodes.map((n, i) => ({ node: n, x, y: TOP + i * (NODE_H + VGAP) }))
  const laid = [
    ...place(graph.modules, COLX.module),
    ...place(graph.hooks, COLX.hook),
    ...place(graph.visuals, COLX.visual),
    ...place(graph.fields, COLX.field),
  ]
  const pos = new Map(laid.map(l => [l.node.id, l]))
  const rows = Math.max(graph.modules.length, graph.hooks.length, graph.visuals.length, graph.fields.length, 1)
  const H = TOP + rows * (NODE_H + VGAP) + 24
  const W = COLX.field + NODE_W + 24
  const selNode = laid.find(l => l.node.id === sel)?.node || null
  const edgeTouchesSel = (e: { from: string; to: string }) => sel && (e.from === sel || e.to === sel)
  const total = graph.modules.length + graph.visuals.length + graph.fields.length + graph.hooks.length
  return (
    <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-full max-w-[1100px] h-[80vh] rounded-xl border border-white/15 bg-[#0a0b10] overflow-hidden flex flex-col shadow-[0_10px_60px_rgba(0,0,0,0.6)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 font-mono text-[13px] tracking-[0.2em] text-white/45">
          <span>◇ WORLD ARCHITECTURE · {total} nodes</span>
          <div className="flex items-center gap-3 text-[12px]">
            {(['module', 'visual', 'field', 'hook'] as const).map(k => (
              <span key={k} className="inline-flex items-center gap-1" style={{ color: NODE_KIND_STYLE[k].text }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: NODE_KIND_STYLE[k].dot }} />{NODE_KIND_STYLE[k].label}
              </span>
            ))}
            <button onClick={onClose} className="text-white/40 hover:text-white text-[15px] leading-none ml-1">✕</button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex">
          {/* graph */}
          <div className="flex-1 min-h-0 overflow-auto p-2">
            <svg width={W} height={H} className="min-w-full">
              {graph.edges.map((e, i) => {
                const a = pos.get(e.from), b = pos.get(e.to)
                if (!a || !b) return null
                const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2
                const mx = (x1 + x2) / 2
                const on = edgeTouchesSel(e)
                return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={on ? '#ffffff' : EDGE_STYLE[e.kind]} strokeWidth={on ? 1.6 : 1} opacity={sel && !on ? 0.15 : 1} />
              })}
              {laid.map(({ node, x, y }) => {
                const st = NODE_KIND_STYLE[node.kind]
                const isSel = node.id === sel
                return (
                  <g key={node.id} transform={`translate(${x},${y})`} className="cursor-pointer" onClick={() => setSel(isSel ? null : node.id)}>
                    <rect width={NODE_W} height={NODE_H} rx={7} fill={isSel ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.035)'} stroke={isSel ? '#fff' : st.ring} strokeWidth={isSel ? 1.5 : 1} />
                    <circle cx={13} cy={NODE_H / 2} r={4} fill={st.dot} />
                    <text x={24} y={NODE_H / 2 + 4} fontFamily="ui-monospace, monospace" fontSize={12} fill={st.text}>{node.title.length > 19 ? node.title.slice(0, 18) + '…' : node.title}</text>
                  </g>
                )
              })}
            </svg>
          </div>
          {/* inspector */}
          <div className="w-[300px] border-l border-white/10 p-3 overflow-auto font-mono text-[12px]">
            {selNode ? <NodeInspector node={selNode} graph={graph} /> : (
              <div className="text-white/30 leading-relaxed">click a node to inspect it.<br/><br/>modules compose into visuals, visuals paint fields, hooks drive the uniforms visuals read.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function NodeInspector({ node, graph }: { node: ANode; graph: AiNodeGraph }) {
  const st = NODE_KIND_STYLE[node.kind]
  const ins = graph.edges.filter(e => e.to === node.id)
  const outs = graph.edges.filter(e => e.from === node.id)
  const idTitle = (id: string) => id.replace(/^[mvfh]:/, '')
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: st.dot }} />
        <span className="tracking-[0.15em]" style={{ color: st.text }}>{st.label.slice(0, -1)}</span>
      </div>
      <div className="text-white/90 text-[14px] break-words mb-2">{node.title}</div>
      <div className="space-y-1 text-white/55">
        {node.kind === 'module' && <div>WGSL source · <span className="text-white/80">{(node.wgslLen / 1024).toFixed(1)} KB</span></div>}
        {node.kind === 'visual' && <div>shader source · <span className="text-white/80">{(node.wgslLen / 1024).toFixed(1)} KB</span></div>}
        {node.kind === 'field' && <><div>shape · <span className="text-white/80">{node.shape || '—'}</span></div><div>painted by · <span className="text-white/80">{node.visual || '(none)'}</span></div><div>body · <span className={node.pixelCollide ? 'text-emerald-300/90' : 'text-white/80'}>{node.pixelCollide ? 'rendered pixels ◉' : 'bounding rect'}</span></div></>}
        {node.kind === 'hook' && <><div>author · <span className="text-white/80">{node.author || '—'}</span></div><div>JS · <span className="text-white/80">{(node.codeLen / 1024).toFixed(1)} KB</span></div>{node.desc && <div className="text-white/45 mt-1 leading-relaxed">{node.desc}</div>}</>}
      </div>
      {(ins.length > 0 || outs.length > 0) && (
        <div className="mt-3 pt-2 border-t border-white/10 space-y-1.5">
          {ins.length > 0 && <div><div className="text-white/35 text-[11px] mb-0.5">← fed by ({ins.length})</div>{ins.slice(0, 8).map((e, i) => <div key={i} className="text-white/65 truncate">{idTitle(e.from)}</div>)}{ins.length > 8 && <div className="text-white/30">+{ins.length - 8} more</div>}</div>}
          {outs.length > 0 && <div><div className="text-white/35 text-[11px] mb-0.5">→ feeds ({outs.length})</div>{outs.slice(0, 8).map((e, i) => <div key={i} className="text-white/65 truncate">{idTitle(e.to)}</div>)}{outs.length > 8 && <div className="text-white/30">+{outs.length - 8} more</div>}</div>}
        </div>
      )}
      <div className="mt-3 pt-2 border-t border-white/10 text-white/25 text-[11px] leading-relaxed">
        {(node.kind === 'module' || node.kind === 'visual' || node.kind === 'hook')
          ? 'code node — AI-authored, human-openable. (edit wiring in Tier-2)'
          : 'structural node — becomes draggable/wireable in Tier-2.'}
      </div>
    </div>
  )
}
