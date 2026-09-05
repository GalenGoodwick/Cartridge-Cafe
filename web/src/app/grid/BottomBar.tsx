'use client'

// THE BOTTOM BAR — rebuilt from scratch (Galen, Sep 5: "log all pathways and
// all icons... wipe the bottom bar... do it from scratch"). The registry below
// IS the pathway log (see DESIGN-bottom-bar.md — keep them together).
//
// One flex row: [ LEFT flex-1 | NAV cup | RIGHT flex-1 row-reversed ].
// Equal flex-basis centers the cup mathematically. Tiers drop WHOLE buttons.
// Edge pins (back / connect) sit outermost in flex order and cannot clip.

export type BarCtx = {
  set: string                 // 'main' | 'games' | 'engine' | ...
  playing: boolean            // games set, play phase
  narrow: boolean
  tier: 0 | 1 | 2
  signedOut: boolean          // tri-state resolved: true ONLY when known signed out
  premium: boolean
  rReset: boolean
  aiLive: boolean
  recOn: boolean
  recSecs: number
  copied: boolean
  navOpen: boolean
  commonsOpen: boolean
  instructionsOpen: boolean
  brewIconOpen: boolean
  title: string
}

export type BarActions = {
  back: () => void
  edit: () => void
  title: () => void
  share: () => void
  commons: () => void
  rec: () => void
  reset: () => void
  signIn: () => void
  nav: () => void
  connect: () => void
  instructions: () => void
  contact: () => void
  brewIcon: () => void
}

type Btn = {
  id: keyof BarActions
  show: (c: BarCtx) => boolean
  tier: 0 | 1 | 2
  tone: 'gold' | 'green' | 'chip' | 'rec'
  label: (c: BarCtx) => string           // wide label
  glyph: (c: BarCtx) => string           // narrow glyph
  active?: (c: BarCtx) => boolean
  testId: string
}

// ── THE REGISTRY — outer→inner per side; this table IS the design log ────────
const LEFT: Btn[] = [
  { id: 'back', tier: 0, tone: 'chip', show: () => true, label: () => '◂', glyph: () => '◂', testId: 'back' },
  { id: 'edit', tier: 0, tone: 'gold', show: c => !c.premium, label: () => '⚡ EDIT', glyph: () => '⚡', testId: 'edit' },
  { id: 'title', tier: 1, tone: 'chip', show: c => c.set !== 'engine', label: c => c.title, glyph: c => c.title, testId: 'title' },
  { id: 'share', tier: 0, tone: 'chip', show: () => true, label: c => c.copied ? '✓ COPIED' : '↗ SHARE', glyph: c => c.copied ? '✓' : '↗', testId: 'share' },
]
const LEFT_INNER: Btn[] = [
  { id: 'commons', tier: 1, tone: 'green', show: c => c.set === 'main', active: c => c.commonsOpen, label: () => '◉ COMMONS', glyph: () => '◉', testId: 'commons' },
  { id: 'rec', tier: 2, tone: 'rec', show: c => c.playing, label: c => c.recOn ? `● ${Math.floor(c.recSecs / 60)}:${String(c.recSecs % 60).padStart(2, '0')}` : '● REC', glyph: c => '●', testId: 'rec' },
  { id: 'reset', tier: 1, tone: 'chip', show: c => c.playing && c.rReset, label: () => '⟲ RESET', glyph: () => '⟲', testId: 'reset' },
]
const RIGHT: Btn[] = [   // rendered row-reversed: index 0 pins the RIGHT edge
  { id: 'connect', tier: 0, tone: 'green', show: c => c.set !== 'engine', active: c => c.aiLive,
    label: c => c.aiLive ? '⚡ AI LIVE' : '⚿ CONNECT AI', glyph: c => c.aiLive ? '⚡' : '⚿', testId: 'connect' },
  { id: 'instructions', tier: 0, tone: 'chip', show: c => c.set === 'games', active: c => c.instructionsOpen, label: () => '? INSTRUCTIONS', glyph: () => '?', testId: 'instructions' },
  { id: 'contact', tier: 2, tone: 'chip', show: c => c.set === 'games', label: () => '✉ CONTACT', glyph: () => '✉', testId: 'contact' },
]
const RIGHT_INNER: Btn[] = [
  { id: 'brewIcon', tier: 1, tone: 'chip', show: c => c.set === 'main', active: c => c.brewIconOpen, label: () => '◆ BREW ICON', glyph: () => '◆', testId: 'brewicon' },
]

const TONES: Record<Btn['tone'], (active: boolean) => string> = {
  gold: () => 'font-bold bg-amber-400 border-2 border-amber-200/80 text-black hover:bg-amber-300 shadow-[0_0_16px_rgba(245,176,76,0.5)]',
  green: (a) => a
    ? 'font-bold bg-emerald-400 border-2 border-emerald-200 text-black shadow-[0_0_26px_rgba(16,185,129,0.9)]'
    : 'font-bold bg-emerald-500 border-2 border-emerald-300/80 text-black hover:bg-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.5)]',
  rec: (a) => a ? 'bg-red-500/25 border border-red-400/60 text-red-100' : 'bg-black/70 border border-white/25 text-white/85 hover:text-white',
  chip: (a) => a ? 'bg-white/20 border border-white/40 text-white' : 'bg-black/70 border border-white/25 text-white/85 hover:text-white',
}

export default function BottomBar({ ctx, act, barH }: { ctx: BarCtx; act: BarActions; barH: number }) {
  const size = ctx.narrow
    ? 'h-11 min-w-[44px] px-3 text-[16px] tracking-normal'
    : 'px-3.5 py-2 text-[12px] tracking-[0.16em]'
  const render = (b: Btn) => {
    if (!b.show(ctx) || b.tier > ctx.tier) return null
    const active = b.active?.(ctx) ?? (b.id === 'rec' ? ctx.recOn : false)
    const text = ctx.narrow ? b.glyph(ctx) : b.label(ctx)
    return (
      <button key={b.id} data-bar={b.testId} onClick={act[b.id]}
        className={`font-mono rounded-xl transition-all shrink-0 grid place-items-center ${size} ${TONES[b.tone](active)} ${b.id === 'title' ? 'max-w-[34%] truncate' : ''}`}>
        {text}
      </button>
    )
  }
  return (
    <div className="fixed bottom-0 inset-x-0 z-[135]" style={{ height: `calc(${barH}px + env(safe-area-inset-bottom, 0px))` }}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md border-t border-white/10" />
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3" style={{ bottom: 'max(env(safe-area-inset-bottom), 6px)' }}>
        <div className="flex-1 basis-0 min-w-0 flex items-center gap-2 overflow-hidden">
          {LEFT.map(render)}
          <span className="flex-1" />
          {LEFT_INNER.map(render)}
        </div>
        {/* CENTER — identity-aware (Galen, Sep 5): a stranger's one move is
            SIGN IN; a member's is NAV. One slot, the same registry system. */}
        {ctx.signedOut ? (
          <button onClick={act.signIn} data-bar="signin" aria-label="sign in"
            className={`shrink-0 font-mono grid place-items-center rounded-2xl transition-all z-10 ${ctx.narrow ? 'h-12 px-4 text-[14px]' : 'h-12 px-5 text-[13px] tracking-[0.16em]'} ${TONES.gold(false)}`}>
            ⚿ SIGN IN
          </button>
        ) : (
          <button onClick={act.nav} aria-label="ui selector" data-bar="nav"
            title="the dockstar — choose your UI"
            className={`shrink-0 w-12 h-12 grid place-items-center rounded-2xl border transition-all z-10 ${
              ctx.navOpen ? 'bg-amber-400/25 border-amber-300/70 scale-105' : 'bg-black/60 border-white/20 hover:border-amber-300/50 hover:bg-black/80'}`}
            style={{ boxShadow: ctx.navOpen ? '0 0 18px rgba(245,176,76,0.35)' : '0 2px 8px rgba(0,0,0,0.5)' }}>
            <span className="flex flex-col items-center leading-none">
              <img src="/cartridge-cup.svg" alt="" className="w-6 h-6" />
              <span className="font-mono text-[8px] tracking-[0.24em] text-white/80 mt-0.5">NAV</span>
            </span>
          </button>
        )}
        <div className="flex-1 basis-0 min-w-0 flex flex-row-reverse items-center gap-2 overflow-hidden">
          {RIGHT.map(render)}
          <span className="flex-1" />
          {RIGHT_INNER.map(render)}
        </div>
      </div>
    </div>
  )
}
