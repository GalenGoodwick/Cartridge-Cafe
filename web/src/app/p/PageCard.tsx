'use client'

// A shelf card for one published page: its hero shader runs LIVE (the shelf
// itself moves — every card is a real GPU window, not a thumbnail).
import ShaderFrame from '../pages/ShaderFrame'

export default function PageCard({ slug, title, desc, views, heroWgsl }: {
  slug: string
  title: string
  desc?: string
  views?: number
  heroWgsl?: string | null
}) {
  return (
    <a
      href={`/p/${slug}`}
      className="group block overflow-hidden rounded-lg border border-[#1c2941] bg-[#0d1219] transition-colors hover:border-[#3a5075]"
    >
      <div className="relative aspect-[16/9] bg-black">
        {heroWgsl ? (
          <ShaderFrame wgsl={heroWgsl} className="absolute inset-0" />
        ) : (
          <div className="absolute inset-0 grid place-items-center font-mono text-2xl text-[#26364e]">✦</div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-semibold tracking-tight group-hover:text-[#FFB25A]">{title}</h3>
          {typeof views === 'number' && views > 0 && (
            <span className="shrink-0 font-mono text-[11px] text-[#55677E]">{views.toLocaleString()} views</span>
          )}
        </div>
        {desc && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#7E93AC]">{desc}</p>}
        <p className="mt-1.5 font-mono text-[11px] text-[#3f4f63]">/p/{slug}</p>
      </div>
    </a>
  )
}
