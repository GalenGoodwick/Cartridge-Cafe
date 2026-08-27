'use client'

// THE SHELL HOST — the ONE listener every page that mounts engine chrome uses
// (universal-pipelines law: SpaceStage and the conversion proof must run the
// SAME handlers, never copies). The engine dispatches shell:* actions on
// 'cafe:shell-ui' (the chair's seam, provenance-checked); this hook routes
// them: 'back' navigates, engine-internal commands go BACK to the engine BY
// NAME over 'cafe:shell-cmd' (play/instructions/edit/fork/builderbox — the
// engine executes its own internals; they are never exposed). Returns the last
// action seen (for eye markers / debugging).
import { useEffect, useState } from 'react'

const ENGINE_CMDS = new Set(['play', 'instructions', 'edit', 'fork', 'builderbox'])

export function useShellHost(opts?: { onBack?: () => void }) {
  const [lastAction, setLastAction] = useState('')
  useEffect(() => {
    const on = (e: Event) => {
      const action = String((e as CustomEvent).detail || '')
      if (!action.startsWith('shell:')) return
      setLastAction(action)
      const a = action.slice(6)
      if (a === 'back') {
        if (opts?.onBack) opts.onBack()
        else window.location.href = '/'
      } else if (ENGINE_CMDS.has(a)) {
        window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: a }))
      }
      // href:* / share / follow / menu: page-specific — hosts add their own
      // listener alongside this hook for those.
    }
    window.addEventListener('cafe:shell-ui', on)
    return () => window.removeEventListener('cafe:shell-ui', on)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return lastAction
}
