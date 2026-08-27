'use client'

// THE UNIFIED WORLD — the executor proof (rung 3, operable). ONE WorldDoc
// solved at the REAL viewport, drawn as one pass, and now DRIVEN through it:
//  · ⛶ PLAY is a REAL MODE CHANGE — the chrome declares when.mode:['view'], so
//    entering play RE-SOLVES the plan and the chrome culls ITSELF; a small
//    engine-drawn EXIT region exists only in play mode. No special-cased
//    hide/show — the solver is the only authority.
//  · ↗ SHARE actually copies the link (label flashes LINK COPIED — a labels
//    change, same pipeline).
//  · Text is ripped from the page's real font (RIP-for-type); buttons hit-test
//    against the plan's own rects.
// Resize narrow = the phone instance (rail culled by fit.when), same doc.
import { useEffect, useState } from 'react'
import { worldSolve, type WorldPlan } from '@/app/engine/world-solve'
import type { WorldDoc } from '@/app/engine/world-config'
import { PlanCanvas } from './PlanCanvas'

const DOC: WorldDoc = {
  id: 'unified-proof', name: 'Unified Proof',
  render: { kind: 'raymarch3d' },
  layout: {
    regions: [
      // VIEW mode: contained stage + chrome around it
      { id: 'game.stage', layer: 'game', anchor: { vx: [0.01, 0.85], vy: [0.09, 0.91] }, z: 0, when: { mode: ['view'], viewport: { minW: 700 } } },
      { id: 'game.stage.narrow', layer: 'game', anchor: { vx: [0.02, 0.98], vy: [0.09, 0.90] }, z: 0, when: { mode: ['view'], viewport: { maxW: 699 } } },
      { id: 'chrome.topbar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.08] }, z: 60, when: { mode: ['view'] } },
      { id: 'chrome.rail', layer: 'cafe', anchor: { vx: [0.86, 1], vy: [0.09, 0.91] }, z: 41, when: { mode: ['view'], viewport: { minW: 700 } } },
      { id: 'chrome.bottombar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.92, 1] }, z: 50, when: { mode: ['view'] } },
      // PLAY mode: the stage is FULL-BLEED and the only chrome is a tiny EXIT
      { id: 'game.stage.full', layer: 'game', anchor: { vx: [0, 1], vy: [0, 1] }, z: 0, when: { mode: ['play'] } },
      { id: 'chrome.exit', layer: 'cafe', anchor: { vx: [0.92, 0.995], vy: [0.01, 0.055] }, z: 70, when: { mode: ['play'] } },
    ],
  },
  ui: {
    'chrome.topbar': { as: 'blocks', blocks: [] },
    'chrome.bottombar': { as: 'blocks', blocks: [] },
    'chrome.exit': { as: 'blocks', blocks: [] },
  },
  fit: {
    'game.stage': { aspect: 'isotropic' },
    'game.stage.narrow': { aspect: 'isotropic' },
    'game.stage.full': { aspect: 'isotropic' },
    'chrome.rail': { aspect: 'contain', when: { minW: 700 } },
  },
}

export default function UnifiedProof() {
  const [plan, setPlan] = useState<WorldPlan | null>(null)
  const [mode, setMode] = useState<'view' | 'play'>('view')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const solve = () => setPlan(worldSolve(DOC, { w: window.innerWidth, h: window.innerHeight }, { mode }))
    solve(); window.addEventListener('resize', solve)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMode('view') }
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('resize', solve); window.removeEventListener('keydown', esc) }
  }, [mode])

  if (!plan) return null

  const labels: Record<string, string> = {
    'game.stage': 'UNIFIED · RAYMARCH STAGE',
    'game.stage.narrow': 'UNIFIED · PHONE STAGE',
    'chrome.topbar': 'CINDERFELL · Galen',
    'chrome.rail': '⛶ PLAY',
    'chrome.bottombar': copied ? '✓ LINK COPIED' : '⌁ BUILDERBOX · ↗ SHARE',
    'chrome.exit': '✕ EXIT',
  }
  const actions: Record<string, string> = mode === 'view'
    ? { 'chrome.rail': 'play', 'chrome.topbar': 'play', 'chrome.bottombar': 'share' }
    : { 'chrome.exit': 'view' }

  const onAction = (action: string) => {
    if (action === 'play') setMode('play')
    else if (action === 'view') setMode('view')
    else if (action === 'share') {
      try { void navigator.clipboard?.writeText(window.location.href) } catch { /* headless */ }
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#04040a' }}>
      <PlanCanvas plan={plan} labels={labels} actions={actions} onAction={onAction} />
    </div>
  )
}
