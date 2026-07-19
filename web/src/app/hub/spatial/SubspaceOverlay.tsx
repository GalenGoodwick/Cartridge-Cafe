'use client'

interface SubspaceOverlayProps {
  hostName: string
  hostColor: string
  visitorCount: number
  onExit: () => void
  spaceSlug?: string | null
}

export default function SubspaceOverlay({ hostName, hostColor, visitorCount, onExit, spaceSlug }: SubspaceOverlayProps) {
  return (
    <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-3 py-1.5 bg-surface/90 backdrop-blur-sm border-b border-border">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
          style={{ backgroundColor: hostColor }}
        />
        <span className="text-xs font-mono text-foreground truncate">
          Following <span className="font-semibold" style={{ color: hostColor }}>{hostName}</span>
        </span>
        {visitorCount > 0 && (
          <span className="text-[12px] font-mono text-muted-light/60">
            +{visitorCount}
          </span>
        )}
      </div>
      {spaceSlug && (
        <a
          href={`/space/${spaceSlug}`}
          className="text-[12px] font-mono px-2 py-0.5 rounded border border-border transition-colors mr-1.5"
          style={{ color: hostColor, borderColor: hostColor + '55' }}
        >
          Visit world →
        </a>
      )}
      <button
        onClick={onExit}
        className="text-[12px] font-mono text-muted-light/60 hover:text-foreground px-2 py-0.5 rounded border border-border hover:border-foreground/30 transition-colors"
      >
        Exit
      </button>
    </div>
  )
}
