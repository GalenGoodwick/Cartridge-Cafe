'use client'

// ◲ SPRITES — upload · view · RIP · animate (Galen, Aug 26 post-Fortis:
// "ui for sprite viewing/upload to rip … animated sprite sheet uploads").
// The owner's face of the ONE sprite pipeline (lib/sprite-store): drop a png,
// see it, slice it cols×rows with a live grid overlay, set fps to make the
// strip a clip, and watch the animation play before shipping it. Slots are
// named `sheet.N` — any visual samples them with sprite(i, uv)/spriteAnim.

import { useCallback, useEffect, useRef, useState } from 'react'

interface Sheet { name: string; png_b64: string; cols: number; rows: number; fps?: number | null }
interface Meta { slots: Array<{ name: string; i: number }>; clips: Array<{ name: string; first: number; n: number; fps: number }> }

export default function SpritesPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // the upload-in-progress (pre-rip staging)
  const [stage, setStage] = useState<{ png: string; w: number; h: number; name: string; cols: number; rows: number; fps: number } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(() => {
    fetch(`/api/spaces/${encodeURIComponent(slug)}/sprites`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.sheets) setSheets(d.sheets) })
      .catch(() => {})
  }, [slug])
  useEffect(() => { refresh() }, [refresh])

  const pick = useCallback(async (f: File | null) => {
    if (!f) return
    setErr(null)
    const b64 = await new Promise<string>((res, rej) => {
      const rd = new FileReader()
      rd.onload = () => res(String(rd.result).replace(/^data:image\/\w+;base64,/, ''))
      rd.onerror = rej
      rd.readAsDataURL(f)
    })
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode().catch(() => {})
    setStage({
      png: b64, w: img.naturalWidth || 0, h: img.naturalHeight || 0,
      name: f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'sheet',
      cols: 1, rows: 1, fps: 0,
    })
  }, [])

  const ship = useCallback(async () => {
    if (!stage || busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/sprites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: stage.name, png: stage.png, cols: stage.cols, rows: stage.rows, ...(stage.fps > 0 ? { fps: stage.fps } : {}) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.error || 'upload failed'); return }
      setMeta(d.meta ?? null)
      setStage(null)
      refresh()
    } finally { setBusy(false) }
  }, [slug, stage, busy, refresh])

  const remove = useCallback(async (name: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fetch(`/api/spaces/${encodeURIComponent(slug)}/sprites?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
      refresh()
    } finally { setBusy(false) }
  }, [slug, busy, refresh])

  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[86vh] overflow-y-auto rounded-xl border border-white/15 bg-black/90 p-5 font-mono text-white/85"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[15px] tracking-[0.25em] text-white/70">◲ SPRITES</span>
          <button onClick={onClose} className="text-white/50 hover:text-white text-[16px]">✕</button>
        </div>

        {/* ── upload / staging ── */}
        {!stage ? (
          <button onClick={() => fileRef.current?.click()}
            className="w-full mb-4 px-4 py-6 rounded-lg border-2 border-dashed border-white/20 text-white/60 hover:text-amber-200 hover:border-amber-300/40 text-[14px] tracking-[0.15em] transition-colors">
            ⬆ DROP A PNG — a single sprite or a whole sheet to rip
          </button>
        ) : (
          <div className="mb-4 rounded-lg border border-amber-300/30 bg-amber-400/5 p-3">
            <div className="flex gap-3 flex-wrap items-start">
              {/* the sheet, with the live RIP grid over it */}
              <div className="relative shrink-0 max-w-[280px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/png;base64,${stage.png}`} alt="" className="max-w-full border border-white/15 rounded [image-rendering:pixelated]" />
                <div className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage: `repeating-linear-gradient(to right, rgba(255,200,80,0.55) 0 1px, transparent 1px calc(100% / ${stage.cols})), repeating-linear-gradient(to bottom, rgba(255,200,80,0.55) 0 1px, transparent 1px calc(100% / ${stage.rows}))`,
                  }} />
              </div>
              <div className="flex-1 min-w-[200px] text-[13.5px] space-y-2">
                <div className="text-white/50">{stage.w}×{stage.h}px → {stage.cols}×{stage.rows} = <span className="text-amber-200">{stage.cols * stage.rows} slot{stage.cols * stage.rows > 1 ? 's' : ''}</span>
                  {stage.cols * stage.rows > 1 && <> · {Math.floor(stage.w / stage.cols)}×{Math.floor(stage.h / stage.rows)}px each</>}</div>
                <label className="block">name
                  <input value={stage.name} onChange={e => setStage(s => s && ({ ...s, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                    className="w-full mt-0.5 bg-black/50 border border-white/15 rounded px-2 py-1 text-white/90 outline-none focus:border-amber-300/50" />
                </label>
                <div className="flex gap-2">
                  <label className="flex-1">cols
                    <input type="number" min={1} max={64} value={stage.cols}
                      onChange={e => setStage(s => s && ({ ...s, cols: Math.max(1, Math.min(64, Number(e.target.value) || 1)) }))}
                      className="w-full mt-0.5 bg-black/50 border border-white/15 rounded px-2 py-1 text-white/90 outline-none" />
                  </label>
                  <label className="flex-1">rows
                    <input type="number" min={1} max={64} value={stage.rows}
                      onChange={e => setStage(s => s && ({ ...s, rows: Math.max(1, Math.min(64, Number(e.target.value) || 1)) }))}
                      className="w-full mt-0.5 bg-black/50 border border-white/15 rounded px-2 py-1 text-white/90 outline-none" />
                  </label>
                  <label className="flex-1" title="frames per second — 0 = not animated">fps
                    <input type="number" min={0} max={60} value={stage.fps}
                      onChange={e => setStage(s => s && ({ ...s, fps: Math.max(0, Math.min(60, Number(e.target.value) || 0)) }))}
                      className="w-full mt-0.5 bg-black/50 border border-white/15 rounded px-2 py-1 text-white/90 outline-none" />
                  </label>
                </div>
                {/* animated preview once it's a strip with fps */}
                {stage.fps > 0 && stage.cols * stage.rows > 1 && (
                  <AnimPreview png={stage.png} cols={stage.cols} rows={stage.rows} fps={stage.fps} />
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={ship} disabled={busy || !stage.name}
                    className="flex-1 px-3 py-1.5 rounded border border-amber-300/50 text-amber-100 hover:bg-amber-400/15 tracking-[0.12em] disabled:opacity-40">
                    {busy ? '…' : stage.cols * stage.rows > 1 ? `⚡ RIP INTO ${stage.cols * stage.rows} SLOTS` : '⚡ UPLOAD SPRITE'}
                  </button>
                  <button onClick={() => setStage(null)} className="px-3 py-1.5 text-white/50 hover:text-white/70">cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/webp,image/gif" className="hidden"
          onChange={e => pick(e.target.files?.[0] ?? null)} />
        {err && <div className="mb-3 text-[13px] text-red-300/90">{err}</div>}

        {/* ── the world's sheets ── */}
        {sheets.length === 0 && !stage && (
          <div className="text-[13.5px] text-white/45 leading-relaxed">
            no sprites yet — upload a png above. Your AI can also do it over the bridge
            (<span className="text-white/65">define_sheet</span>), and any visual samples slots with
            <span className="text-emerald-200/80"> sprite(i, uv)</span> / <span className="text-emerald-200/80">spriteAnim(first, n, fps, uv, time)</span>.
          </div>
        )}
        {sheets.map(sh => (
          <div key={sh.name} className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 flex gap-3 items-start flex-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/png;base64,${sh.png_b64}`} alt="" className="max-w-[160px] max-h-[120px] border border-white/10 rounded [image-rendering:pixelated]" />
            <div className="flex-1 min-w-[180px] text-[13.5px]">
              <div className="text-amber-200/90 tracking-[0.1em]">{sh.name}</div>
              <div className="text-white/50 mt-0.5">
                {sh.cols}×{sh.rows}{sh.cols * sh.rows > 1 ? ` · slots ${sh.name}.0–${sh.name}.${sh.cols * sh.rows - 1}` : ''}
                {sh.fps ? <span className="text-emerald-200/80"> · clip @{sh.fps}fps</span> : ''}
              </div>
              {sh.fps && sh.cols * sh.rows > 1 ? <AnimPreview png={sh.png_b64} cols={sh.cols} rows={sh.rows} fps={sh.fps} /> : null}
              <div className="mt-1.5 text-[12px] text-white/40">
                sample: <span className="text-emerald-200/70">sprite({meta?.slots.find(s => s.name === sh.name || s.name === sh.name + '.0')?.i ?? '…'}, uv)</span>
              </div>
            </div>
            <button onClick={() => remove(sh.name)} disabled={busy}
              className="shrink-0 text-[12px] text-red-300/60 hover:text-red-200 tracking-[0.1em]">DELETE</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The animation, actually playing — a canvas stepping the strip at its fps. */
function AnimPreview({ png, cols, rows, fps }: { png: string; cols: number; rows: number; fps: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let stop = false
    let raf = 0
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    img.decode().then(() => {
      if (stop) return
      const cw = Math.floor(img.naturalWidth / cols), ch = Math.floor(img.naturalHeight / rows)
      const scale = Math.min(96 / cw, 96 / ch, 4)
      cv.width = Math.max(1, Math.round(cw * scale)); cv.height = Math.max(1, Math.round(ch * scale))
      const cx = cv.getContext('2d')
      if (!cx) return
      cx.imageSmoothingEnabled = false
      const n = cols * rows
      const t0 = performance.now()
      const draw = () => {
        if (stop) return
        const f = Math.floor((performance.now() - t0) / 1000 * fps) % n
        cx.clearRect(0, 0, cv.width, cv.height)
        cx.drawImage(img, (f % cols) * cw, Math.floor(f / cols) * ch, cw, ch, 0, 0, cv.width, cv.height)
        raf = requestAnimationFrame(draw)
      }
      draw()
    }).catch(() => {})
    return () => { stop = true; cancelAnimationFrame(raf) }
  }, [png, cols, rows, fps])
  return <canvas ref={ref} className="mt-1.5 border border-white/10 rounded bg-black/40" />
}
