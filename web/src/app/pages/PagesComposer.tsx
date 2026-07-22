'use client'

import { useEffect, useRef, useState } from 'react'
import ShaderFrame from './ShaderFrame'
import { SEED_HERO, SEED_EMBER, SEED_AURORA } from './frame-shader'

type Aspect = 'tall' | 'square' | 'wide'

type Frame = {
  id: string
  wgsl: string
  prompt: string
  span: 1 | 2
  aspect: Aspect
  desc: string
  busy?: boolean
  error?: string | null
}

const STORAGE_KEY = 'cc_pages_v1'
const ASPECTS: Aspect[] = ['tall', 'square', 'wide']
const ASPECT_CLASS: Record<Aspect, string> = {
  tall: 'aspect-[3/4]',
  square: 'aspect-square',
  wide: 'aspect-[16/10]',
}

let counter = 0
const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`

function defaultFrames(): Frame[] {
  return [
    { id: newId(), wgsl: SEED_HERO, prompt: '', span: 2, aspect: 'wide', desc: 'the wordmark, lit' },
    { id: newId(), wgsl: SEED_EMBER, prompt: '', span: 1, aspect: 'tall', desc: 'carried fire' },
    { id: newId(), wgsl: SEED_AURORA, prompt: '', span: 1, aspect: 'tall', desc: 'cold aurora' },
  ]
}

export default function PagesComposer() {
  const [frames, setFrames] = useState<Frame[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // load once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Frame[]
        if (Array.isArray(parsed) && parsed.length) {
          setFrames(parsed.map((f) => ({ ...f, busy: false, error: null })))
          setLoaded(true)
          return
        }
      }
    } catch { /* fall through to defaults */ }
    setFrames(defaultFrames())
    setLoaded(true)
  }, [])

  // autosave (debounced)
  useEffect(() => {
    if (!loaded) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const slim = frames.map(({ id, wgsl, prompt, span, aspect, desc }) => ({ id, wgsl, prompt, span, aspect, desc }))
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(slim)) } catch { /* quota */ }
    }, 500)
  }, [frames, loaded])

  const update = (id: string, patch: Partial<Frame>) =>
    setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const addFrame = () =>
    setFrames((fs) => [...fs, { id: newId(), wgsl: SEED_AURORA, prompt: '', span: 1, aspect: 'tall', desc: 'new frame' }])

  const removeFrame = (id: string) => setFrames((fs) => fs.filter((f) => f.id !== id))

  const cycleAspect = (id: string) =>
    setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, aspect: ASPECTS[(ASPECTS.indexOf(f.aspect) + 1) % 3] } : f)))

  const toggleSpan = (id: string) =>
    setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, span: f.span === 1 ? 2 : 1 } : f)))

  async function imagine(id: string, prompt: string) {
    if (!prompt.trim() || prompt.trim().length < 3) return
    update(id, { busy: true, error: null })
    try {
      const res = await fetch('/api/pages/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (!res.ok) {
        update(id, { busy: false, error: data?.error || `Error ${res.status}` })
        return
      }
      update(id, { wgsl: data.wgsl, desc: data.description || prompt, busy: false, error: null })
    } catch (e) {
      update(id, { busy: false, error: e instanceof Error ? e.message : 'Request failed' })
    }
  }

  if (!loaded) return null

  return (
    <div className="min-h-dvh bg-[#0A0D13] text-[#E9EFF7]">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-[#1c2941] bg-[#0A0D13]/90 backdrop-blur px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[#FFB25A]">✦</span>
          <div className="min-w-0">
            <div className="font-semibold tracking-tight truncate">Shader Pages</div>
            <div className="text-[11px] font-mono text-[#55677E] truncate">every frame is a window your AI imagines</div>
          </div>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          className="shrink-0 rounded-md border border-[#26364e] px-3 py-1.5 text-xs font-mono text-[#7E93AC] hover:text-[#E9EFF7] hover:border-[#3a5075] transition-colors"
        >
          {editing ? 'preview' : 'edit'}
        </button>
      </header>

      {/* the page = a mobile-first grid of shader frames */}
      <main className="mx-auto w-full max-w-3xl px-3 py-4">
        <div className="grid grid-cols-2 gap-3">
          {frames.map((f) => (
            <FrameCard
              key={f.id}
              frame={f}
              editing={editing}
              onPrompt={(p) => update(f.id, { prompt: p })}
              onImagine={() => imagine(f.id, f.prompt)}
              onRemove={() => removeFrame(f.id)}
              onCycleAspect={() => cycleAspect(f.id)}
              onToggleSpan={() => toggleSpan(f.id)}
              onCompile={(err) => update(f.id, { error: err })}
            />
          ))}
        </div>

        {editing && (
          <button
            onClick={addFrame}
            className="mt-3 w-full rounded-lg border border-dashed border-[#2a3a54] py-6 text-sm font-mono text-[#7E93AC] hover:text-[#FFB25A] hover:border-[#FF6A2B]/50 transition-colors"
          >
            ＋ imagine a new frame
          </button>
        )}

        <p className="mt-6 text-center text-[11px] font-mono text-[#3f4f63]">
          frames render on your GPU · saved to this browser · nothing published
        </p>
      </main>
    </div>
  )
}

function FrameCard({
  frame, editing, onPrompt, onImagine, onRemove, onCycleAspect, onToggleSpan, onCompile,
}: {
  frame: Frame
  editing: boolean
  onPrompt: (p: string) => void
  onImagine: () => void
  onRemove: () => void
  onCycleAspect: () => void
  onToggleSpan: () => void
  onCompile: (err: string | null) => void
}) {
  return (
    <div className={`relative overflow-hidden rounded-lg border border-[#1c2941] bg-black ${frame.span === 2 ? 'col-span-2' : 'col-span-1'} ${ASPECT_CLASS[frame.aspect]}`}>
      <ShaderFrame wgsl={frame.wgsl} className="absolute inset-0" onCompile={onCompile} />

      {/* compile error, if any */}
      {frame.error && (
        <div className="absolute inset-x-0 top-0 z-10 bg-[#2a0f0f]/90 px-2 py-1 text-[10px] font-mono text-[#ff9b7a] line-clamp-2">
          {frame.error}
        </div>
      )}

      {editing && (
        <>
          {/* top-right controls */}
          <div className="absolute right-2 top-2 z-10 flex gap-1">
            <IconBtn label={frame.span === 2 ? 'span 2' : 'span 1'} onClick={onToggleSpan} />
            <IconBtn label={frame.aspect} onClick={onCycleAspect} />
            <IconBtn label="✕" onClick={onRemove} danger />
          </div>

          {/* bottom prompt bar */}
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent p-2">
            <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/50 backdrop-blur px-2 py-1.5">
              <span className="font-mono text-[11px] text-[#FF6A2B] shrink-0">imagine›</span>
              <input
                value={frame.prompt}
                onChange={(e) => onPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onImagine() }}
                placeholder="a cold field at dusk…"
                className="min-w-0 flex-1 bg-transparent text-xs text-[#E9EFF7] placeholder:text-[#55677E] outline-none"
              />
              <button
                onClick={onImagine}
                disabled={frame.busy}
                className="shrink-0 rounded bg-[#FF6A2B] px-2 py-1 text-[11px] font-semibold text-[#140a04] disabled:opacity-50"
              >
                {frame.busy ? '…' : '→'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function IconBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded border px-1.5 py-0.5 text-[10px] font-mono backdrop-blur transition-colors ${
        danger
          ? 'border-[#5a2020] bg-black/40 text-[#ff9b7a] hover:bg-[#3a1010]'
          : 'border-white/10 bg-black/40 text-[#c7d3e0] hover:bg-black/70'
      }`}
    >
      {label}
    </button>
  )
}
