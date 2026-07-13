'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Error:', error)
  }, [error])

  return (
    <div className="cafe-room text-steamer flex items-center justify-center">
      <div className="relative z-10 text-center px-6">
        <h1 className="cafe-sign text-5xl mb-3">the projector jammed</h1>
        <p className="font-mono text-[10px] tracking-[0.35em] text-grounds uppercase mb-8">
          this cartridge glitched mid-frame — blow on it and try again
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="brass-tab px-3 py-1.5 text-[10px]">↻ TRY AGAIN</button>
          <a href="/" className="brass-tab px-3 py-1.5 text-[10px]">← BACK TO THE ROOM</a>
        </div>
        {error.digest && (
          <p className="font-mono text-[9px] tracking-[0.25em] text-grounds/60 mt-8">
            reel {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
