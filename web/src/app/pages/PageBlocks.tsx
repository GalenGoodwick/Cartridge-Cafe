'use client'

// Read-only renderer for a page's blocks. Shared by the composer's PREVIEW mode
// and the public /p/<slug> route so "what you see is what ships" is literal.
import ShaderFrame from './ShaderFrame'
import { screenWgslHazard, type Block, type Aspect } from '@/lib/page-types'

export const ASPECT_CLASS: Record<Aspect, string> = {
  tall: 'aspect-[3/4]',
  square: 'aspect-square',
  wide: 'aspect-[16/10]',
}

export default function PageBlocks({ blocks, title }: { blocks: Block[]; title?: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-3 py-6">
      {title && <h1 className="sr-only">{title}</h1>}
      <div className="grid grid-cols-2 gap-3">
        {blocks.map((b) => (
          <BlockView key={b.id} block={b} />
        ))}
      </div>
    </main>
  )
}

function BlockView({ block: b }: { block: Block }) {
  switch (b.kind) {
    case 'shader': {
      // Defense in depth: a hazardous shader never reaches a visitor's GPU.
      const hazard = screenWgslHazard(b.wgsl)
      return (
        <div className={`relative overflow-hidden rounded-lg border border-[#1c2941] bg-black ${b.span === 2 ? 'col-span-2' : 'col-span-1'} ${ASPECT_CLASS[b.aspect]}`}>
          {hazard ? (
            <div className="absolute inset-0 grid place-items-center p-3 text-center text-[12px] font-mono text-[#55677E]">
              frame withheld (unsafe shader)
            </div>
          ) : (
            <ShaderFrame wgsl={b.wgsl} className="absolute inset-0" />
          )}
        </div>
      )
    }
    case 'heading': {
      const cls =
        b.level === 1 ? 'text-3xl sm:text-4xl font-semibold tracking-tight'
        : b.level === 2 ? 'text-2xl font-semibold tracking-tight'
        : 'text-lg font-semibold tracking-tight text-[#c7d3e0]'
      const Tag = (b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3'
      return <Tag className={`col-span-2 mt-2 ${cls}`}>{b.text}</Tag>
    }
    case 'text':
      return <p className="col-span-2 whitespace-pre-wrap leading-relaxed text-[#c7d3e0]">{b.text}</p>
    case 'link':
      return (
        <a href={b.href} target="_blank" rel="noopener noreferrer nofollow"
          className="col-span-2 text-[#FFB25A] underline underline-offset-2 hover:text-[#FF8A3B]">
          {b.text}
        </a>
      )
    case 'button':
      return (
        <div className="col-span-2">
          <a href={b.href} target="_blank" rel="noopener noreferrer nofollow"
            className="inline-block rounded-md bg-[#FF6A2B] px-4 py-2 text-sm font-semibold text-[#140a04] hover:bg-[#ff7d44]">
            {b.text}
          </a>
        </div>
      )
    default:
      return null
  }
}
