'use client'

import { useState, useCallback } from 'react'

interface PromptPanelProps {
  fieldName: string
  hasActiveEffect: boolean
  effectDescription: string | null
  loading: boolean
  error: string | null
  onGenerate: (prompt: string) => void
  onClearEffect: () => void
}

export default function PromptPanel({
  fieldName,
  hasActiveEffect,
  effectDescription,
  loading,
  error,
  onGenerate,
  onClearEffect,
}: PromptPanelProps) {
  const [prompt, setPrompt] = useState('')

  const handleSubmit = useCallback(() => {
    const text = prompt.trim()
    if (!text || loading) return
    onGenerate(text)
  }, [prompt, loading, onGenerate])

  return (
    <div className="pointer-events-auto mb-2 bg-surface/95 backdrop-blur border border-accent/30 rounded-lg p-3 w-80">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-accent font-medium">Effect for {fieldName}</span>
        {hasActiveEffect && (
          <button
            onClick={onClearEffect}
            className="text-[10px] text-error/70 hover:text-error"
          >
            Clear Effect
          </button>
        )}
      </div>

      {effectDescription && (
        <p className="text-[11px] text-muted mb-2 italic">{effectDescription}</p>
      )}

      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Describe a visual effect..."
          className="flex-1 bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-muted/50"
          disabled={loading}
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !prompt.trim()}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            loading
              ? 'bg-accent/10 text-accent/50 cursor-wait'
              : 'bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-30'
          }`}
        >
          {loading ? '...' : 'Generate'}
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-error mt-1.5">{error}</p>
      )}
    </div>
  )
}
