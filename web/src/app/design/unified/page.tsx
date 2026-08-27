'use client'

// THE UNIFIED WORLD — the executor proof (rung 3). ONE WorldDoc (the composite
// from the design: raymarch stage + chrome bands + a desktop-only rail) is
// solved by worldSolve at the REAL viewport and executed as ONE WebGL2 pass —
// every rect the shader paints IS the plan's rect. Resize the window:
//   · wide  → stage inset left of the rail (desktop instance)
//   · narrow→ rail CULLED from the plan (fit.when), bands span (phone instance)
//   · the ring in the stage stays ROUND at every split (isotropic fit facet)
// No DOM UI in the frame — chrome text is engine glyph pixels. The only DOM is
// the canvas element itself.
import { useEffect, useState } from 'react'
import { worldSolve, type WorldPlan } from '@/app/engine/world-solve'
import type { WorldDoc } from '@/app/engine/world-config'
import { PlanCanvas } from './PlanCanvas'

const DOC: WorldDoc = {
  id: 'unified-proof', name: 'Unified Proof',
  render: { kind: 'raymarch3d' },
  layout: {
    regions: [
      // desktop: stage inset left of the rail; phone: stage spans (its own when)
      { id: 'game.stage', layer: 'game', anchor: { vx: [0.01, 0.85], vy: [0.09, 0.91] }, z: 0, when: { viewport: { minW: 700 } } },
      { id: 'game.stage.narrow', layer: 'game', anchor: { vx: [0.02, 0.98], vy: [0.09, 0.90] }, z: 0, when: { viewport: { maxW: 699 } } },
      { id: 'chrome.topbar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.08] }, z: 60 },
      { id: 'chrome.rail', layer: 'cafe', anchor: { vx: [0.86, 1], vy: [0.09, 0.91] }, z: 41 },
      { id: 'chrome.bottombar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.92, 1] }, z: 50 },
    ],
  },
  ui: {
    'chrome.topbar': { as: 'blocks', blocks: [] },
    'chrome.bottombar': { as: 'blocks', blocks: [] },
  },
  fit: {
    'game.stage': { aspect: 'isotropic' },
    'game.stage.narrow': { aspect: 'isotropic' },
    'chrome.rail': { aspect: 'contain', when: { minW: 700 } },   // desktop-only — CULLED on phones
  },
}

// engine-glyph labels (A-Z subset — the proof font)
const LABELS: Record<string, string> = {
  'game.stage': 'UNIFIED · RAYMARCH STAGE',
  'game.stage.narrow': 'UNIFIED · PHONE STAGE',
  'chrome.topbar': 'CINDERFELL · GALEN',
  'chrome.rail': 'PLAY',
  'chrome.bottombar': 'BUILDERBOX · SHARE',
}

export default function UnifiedProof() {
  const [plan, setPlan] = useState<WorldPlan | null>(null)
  useEffect(() => {
    const solve = () => setPlan(worldSolve(DOC, { w: window.innerWidth, h: window.innerHeight }))
    solve(); window.addEventListener('resize', solve)
    return () => window.removeEventListener('resize', solve)
  }, [])
  if (!plan) return null
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#04040a' }}>
      <PlanCanvas plan={plan} labels={LABELS} />
    </div>
  )
}
