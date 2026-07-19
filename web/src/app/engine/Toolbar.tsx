'use client'

import { useCallback } from 'react'
import type { BrushState, Field } from './types'

interface ToolbarProps {
  brush: BrushState
  onBrushChange: (brush: BrushState) => void
  fields: Map<string, Field>
  onCreateField: () => void
  onDeleteField: (id: string) => void
  onSelectField: (id: string) => void
  onFieldColorChange: (id: string, color: [number, number, number, number]) => void
  selectedFieldId?: string | null
  running: boolean
  onToggleRunning: () => void
  onClear: () => void
}

const TOOLS: { key: BrushState['tool']; label: string; icon: string }[] = [
  { key: 'select', label: 'Select', icon: '⬚' },
  { key: 'brush', label: 'Brush', icon: '●' },
  { key: 'line', label: 'Line', icon: '╱' },
  { key: 'circle', label: 'Circle', icon: '○' },
  { key: 'rect', label: 'Rect', icon: '□' },
  { key: 'freeform', label: 'Free', icon: '~' },
]

function hslToRgba(h: number, s: number, l: number): [number, number, number, number] {
  const hNorm = h / 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hNorm * 6) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (hNorm < 1/6) { r = c; g = x; b = 0 }
  else if (hNorm < 2/6) { r = x; g = c; b = 0 }
  else if (hNorm < 3/6) { r = 0; g = c; b = x }
  else if (hNorm < 4/6) { r = 0; g = x; b = c }
  else if (hNorm < 5/6) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }
  return [r + m, g + m, b + m, 1.0]
}

function rgbaToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s, l }
}

export default function Toolbar({
  brush,
  onBrushChange,
  fields,
  onCreateField,
  onDeleteField,
  onSelectField,
  onFieldColorChange,
  running,
  selectedFieldId,
  onToggleRunning,
  onClear,
}: ToolbarProps) {
  const activeField = brush.activeFieldId ? fields.get(brush.activeFieldId) : null

  const handleColorChange = useCallback((fieldId: string, h: number, s: number, l: number) => {
    onFieldColorChange(fieldId, hslToRgba(h, s, l))
  }, [onFieldColorChange])

  return (
    <div className="flex flex-col items-center pointer-events-none">
      {/* Field properties panel — shows when a field is selected */}
      {activeField && (
        <div className="pointer-events-auto mb-2 bg-surface/95 backdrop-blur border border-border rounded-lg p-3 w-72 max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">{activeField.name}</span>
            <span className="text-xs text-muted">{activeField.effects.length > 0 ? `${activeField.effects.length} effects` : 'no effects'}</span>
          </div>

          {/* Color controls */}
          {(() => {
            const hsl = rgbaToHsl(activeField.color[0], activeField.color[1], activeField.color[2])
            return (
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="range"
                  min="0" max="360" step="1"
                  value={Math.round(hsl.h)}
                  onChange={e => handleColorChange(activeField.id, Number(e.target.value), hsl.s, hsl.l)}
                  className="flex-1 h-1 accent-accent"
                  style={{ background: `linear-gradient(to right, hsl(0,80%,60%), hsl(60,80%,60%), hsl(120,80%,60%), hsl(180,80%,60%), hsl(240,80%,60%), hsl(300,80%,60%), hsl(360,80%,60%))` }}
                />
                <div
                  className="w-6 h-6 rounded border border-border"
                  style={{ backgroundColor: `rgb(${activeField.color[0]*255},${activeField.color[1]*255},${activeField.color[2]*255})` }}
                />
              </div>
            )
          })()}

        </div>
      )}

      {/* Main toolbar */}
      <div className="pointer-events-auto mb-4 flex items-center gap-1 bg-surface/95 backdrop-blur border border-border rounded-lg p-1.5 shadow-lg">
        {/* Tool selector */}
        {TOOLS.map(t => (
          <button
            key={t.key}
            onClick={() => onBrushChange({ ...brush, tool: t.key })}
            className={`w-8 h-8 flex items-center justify-center rounded text-sm transition-colors ${
              brush.tool === t.key
                ? 'bg-accent/20 text-accent'
                : 'text-muted hover:text-foreground hover:bg-surface-hover'
            }`}
            title={t.label}
          >
            {t.icon}
          </button>
        ))}

        <div className="w-px h-6 bg-border mx-1" />

        {/* Brush size */}
        <div className="flex items-center gap-1 px-1">
          <span className="text-[12px] text-muted">Size</span>
          <input
            type="range"
            min="1" max="32" step="1"
            value={brush.size}
            onChange={e => onBrushChange({ ...brush, size: Number(e.target.value) })}
            className="w-16 h-1 accent-accent"
          />
          <span className="text-[12px] text-muted font-mono w-4">{brush.size}</span>
        </div>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Field list */}
        <div className="flex items-center gap-1">
          {Array.from(fields.values()).map(field => (
            <button
              key={field.id}
              onClick={() => onSelectField(field.id)}
              className={`group relative w-7 h-7 rounded border transition-colors ${
                brush.activeFieldId === field.id
                  ? 'border-accent ring-1 ring-accent/40'
                  : selectedFieldId === field.id
                    ? 'border-accent/60 ring-1 ring-accent/20'
                    : 'border-border hover:border-muted'
              }`}
              style={{ backgroundColor: `rgb(${field.color[0]*255},${field.color[1]*255},${field.color[2]*255})` }}
              title={field.name}
            >
              {brush.activeFieldId === field.id && fields.size > 1 && (
                <span
                  onClick={e => { e.stopPropagation(); onDeleteField(field.id) }}
                  className="absolute -top-1 -right-1 w-3 h-3 bg-error text-white text-[11px] rounded-full items-center justify-center hidden group-hover:flex leading-none"
                >
                  x
                </span>
              )}
            </button>
          ))}
          <button
            onClick={onCreateField}
            className="w-7 h-7 rounded border border-dashed border-border text-muted hover:text-accent hover:border-accent text-sm flex items-center justify-center"
            title="New Field"
          >
            +
          </button>
        </div>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Play/Pause */}
        <button
          onClick={onToggleRunning}
          className={`w-8 h-8 flex items-center justify-center rounded text-sm transition-colors ${
            running
              ? 'bg-success/20 text-success'
              : 'text-muted hover:text-foreground hover:bg-surface-hover'
          }`}
          title={running ? 'Pause' : 'Play'}
        >
          {running ? '⏸' : '▶'}
        </button>

        {/* Clear */}
        <button
          onClick={onClear}
          className="w-8 h-8 flex items-center justify-center rounded text-sm text-muted hover:text-error hover:bg-surface-hover transition-colors"
          title="Clear All"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
