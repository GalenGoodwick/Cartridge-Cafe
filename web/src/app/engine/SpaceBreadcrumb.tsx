'use client'

import { useState, useEffect } from 'react'

interface SpaceBreadcrumbProps {
  spaceSlug: string
}

interface Ancestor {
  slug: string
  name: string
}

export default function SpaceBreadcrumb({ spaceSlug }: SpaceBreadcrumbProps) {
  const [ancestors, setAncestors] = useState<Ancestor[]>([])
  const [current, setCurrent] = useState<{ slug: string; name: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/ancestry`)
      .then(r => r.json())
      .then(data => {
        setAncestors(data.ancestors || [])
        setCurrent(data.current || null)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [spaceSlug])

  // Don't render anything until loaded, and only if there are ancestors
  if (!loaded || ancestors.length === 0) return null

  const parent = ancestors[ancestors.length - 1]

  return (
    <div className="absolute top-0 left-0 right-96 z-30 bg-surface/90 backdrop-blur-sm border-b border-border px-3 py-1.5 text-[14px] font-mono flex items-center gap-1.5 overflow-hidden">
      <a
        href={`/space/${parent.slug}`}
        className="text-accent hover:text-accent-hover transition-colors flex-shrink-0"
        title={`Back to ${parent.name}`}
      >
        &lt;- back
      </a>
      <span className="text-border flex-shrink-0">|</span>
      {ancestors.map((a, i) => (
        <span key={a.slug} className="flex items-center gap-1.5 flex-shrink-0">
          <a
            href={`/space/${a.slug}`}
            className="text-muted hover:text-accent transition-colors truncate max-w-32"
          >
            {a.name}
          </a>
          {(i < ancestors.length - 1 || current) && (
            <span className="text-border">/</span>
          )}
        </span>
      ))}
      {current && (
        <span className="text-foreground truncate">{current.name}</span>
      )}
    </div>
  )
}
