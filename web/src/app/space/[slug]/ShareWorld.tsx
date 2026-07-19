'use client'

import { useState } from 'react'

// A light share affordance every viewer sees on a world — copy link + one-click
// post to X / Facebook / Bluesky, plus the OS share sheet where available. The
// shared URL is the /space/<slug> page, which carries the world's OG card.
export default function ShareWorld({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://cartridge.cafe'
  const url = `${origin}/space/${slug}`
  const text = `Come play "${name}" — a little world on cartridge.cafe (open on a desktop)`

  const pop = (href: string) => window.open(href, '_blank', 'noopener,noreferrer,width=640,height=640')
  const copy = () => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) })

  const native = async () => {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> }
    if (nav.share) { try { await nav.share({ title: name, text, url }); return } catch { /* cancelled */ } }
    setOpen(o => !o)
  }

  const item = 'w-full text-left px-3 py-2 rounded-lg font-mono text-[12px] tracking-[0.1em] text-steamer/85 hover:text-glow hover:bg-white/5 transition-colors'

  return (
    <div className="fixed top-4 right-4 z-[60] font-mono select-none">
      <button onClick={native}
        className="rounded-lg border border-brass/40 hover:border-flame/60 bg-void/70 backdrop-blur px-3 py-1.5 text-[12px] tracking-[0.15em] text-steamer/80 hover:text-glow transition-colors">
        ↗ SHARE
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-52 rounded-xl border border-brass/40 bg-void/95 backdrop-blur p-1.5 shadow-2xl">
          <button className={item} onClick={() => { copy() }}>{copied ? 'copied ✓' : '⧉ copy link'}</button>
          <button className={item} onClick={() => pop(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`)}>𝕏 · post to X</button>
          <button className={item} onClick={() => pop(`https://bsky.app/intent/compose?text=${encodeURIComponent(text + ' ' + url)}`)}>◇ · Bluesky</button>
          <button className={item} onClick={() => pop(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`)}>f · Facebook</button>
          <button className={item} onClick={() => pop(`https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(name + ' — a little world on cartridge.cafe')}`)}>▲ · Reddit</button>
        </div>
      )}
    </div>
  )
}
