'use client'

// The owner's admin bar on their live page — the page IS the workspace now,
// so editing and claiming are reachable from where the page actually lives.
export default function AdminBar({ pageId, claimed }: { pageId: string; claimed: boolean }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#26364e] bg-[#0d1219]/95 backdrop-blur px-4 py-2.5">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
        <span className="font-mono text-[12px] text-[#55677E]">your page{claimed ? ' · claimed ✓' : ' · unclaimed'}</span>
        <div className="flex items-center gap-2">
          <a href={`/pages?page=${pageId}`}
            className="rounded-md border border-[#26364e] px-3 py-1.5 text-xs font-mono text-[#7E93AC] hover:text-[#E9EFF7] hover:border-[#3a5075] transition-colors">
            ✎ edit
          </a>
          <a href={`/pages?page=${pageId}#claim`}
            className={claimed
              ? 'rounded-md border border-[#26364e] px-3 py-1.5 text-xs font-mono text-[#7E93AC] hover:text-[#E9EFF7] hover:border-[#3a5075] transition-colors'
              : 'rounded-md bg-[#FF6A2B] px-3 py-1.5 text-xs font-semibold text-[#140a04] hover:bg-[#ff7d44] transition-colors'}>
            {claimed ? '↻ rename' : '⚓ claim this address — $10'}
          </a>
        </div>
      </div>
    </div>
  )
}
