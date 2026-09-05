'use client'

// THE BOTTOM BAR — rebuilt from scratch (Galen, Sep 5: "log all pathways and
// all icons... wipe the bottom bar... do it from scratch"). The registry below
// IS the pathway log (see DESIGN-bottom-bar.md — keep them together).
//
// ONE flex row, ONE div: [ …spacer… FLOW …spacer… TOGGLES at the right edge ]
// — matched spacers grow equally, so the flow FLOWS FROM CENTER, condensing
// symmetrically. Flow order (Galen, Sep 5): back share [SIGN IN⇄NAV] edit
// create connect (+ title on main, instructions in-game). Everything shares a single flex
// context so it condenses together. The IDENTITY SLOT is SIGN IN when signed
// out and TURNS INTO the NAV cup when signed in. Tiers drop WHOLE buttons.

export type BarCtx = {
  set: string                 // 'main' | 'games' | 'engine' | ...
  playing: boolean            // games set, play phase
  narrow: boolean
  glyphs: boolean             // window shrunk — every button condenses to its icon
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
  create: () => void
  title: () => void
  share: () => void
  commons: () => void
  rec: () => void
  reset: () => void
  signIn: () => void
  nav: () => void
  connect: () => void
  instructions: () => void
  brewIcon: () => void
}

type Tone = 'gold' | 'blue' | 'green' | 'chip' | 'rec'
type Btn = {
  id: keyof BarActions
  show: (c: BarCtx) => boolean
  tier: 0 | 1 | 2
  tone: Tone | ((c: BarCtx) => Tone)
  label: (c: BarCtx) => string           // wide label
  glyph: (c: BarCtx) => string           // narrow glyph
  active?: (c: BarCtx) => boolean
  testId: string
}

// ── THE REGISTRY — FLOW is the main run in exact visual order (Galen, Sep 5:
// 'order is back button, share, nav, edit, create, connect ai'); TOGGLES ride
// the right screen edge. This table IS the design log. ─────────────────────────
const FLOW: Btn[] = [
  { id: 'back', tier: 0, tone: 'chip', show: () => true, label: () => '◂', glyph: () => '◂', testId: 'back' },
  // title only on MAIN — in games/engine the world is already selected (Galen)
  { id: 'title', tier: 1, tone: 'chip', show: c => c.set === 'main', label: c => c.title, glyph: c => c.title, testId: 'title' },
  { id: 'share', tier: 0, tone: 'chip', show: () => true, label: c => c.copied ? '✓ COPIED' : '↗ SHARE', glyph: c => c.copied ? '✓' : '↗', testId: 'share' },
  // THE IDENTITY SLOT: one position, two faces — a stranger sees gold SIGN IN;
  // signing in TURNS IT INTO the NAV cup. Never disappears.
  { id: 'signIn', tier: 0, tone: 'gold', show: c => c.signedOut, label: () => '⚿ SIGN IN', glyph: () => '⚿', testId: 'signin' },
  { id: 'nav', tier: 0, tone: 'chip', show: c => !c.signedOut, active: c => c.navOpen, label: () => 'NAV', glyph: () => 'NAV', testId: 'nav' },
  // EDIT: BLUE on the main grid (the general edit door), GOLD in-world (edits
  // THIS world); premium worlds hide it in-game
  { id: 'edit', tier: 0, tone: c => c.playing ? 'gold' : 'blue', show: c => c.playing ? !c.premium : c.set === 'games', label: () => '⚡ EDIT', glyph: () => '⚡', testId: 'edit' },
  // ✚ CREATE — the product's core promise, one tap from anywhere; never IN-game
  { id: 'create', tier: 0, tone: 'gold', show: c => c.set !== 'create' && !c.playing, label: () => '✚ CREATE', glyph: () => '✚', testId: 'create' },
  { id: 'instructions', tier: 0, tone: 'chip', show: c => c.playing, active: c => c.instructionsOpen, label: () => '? INSTRUCTIONS', glyph: () => '?', testId: 'instructions' },   // in-game only
  { id: 'connect', tier: 0, tone: 'green', show: c => c.set !== 'engine', active: c => c.aiLive,
    label: c => c.aiLive ? '⚡ AI LIVE' : '⚿ CONNECT AI', glyph: c => c.aiLive ? '⚡' : '⚿', testId: 'connect' },
]
const TOGGLES: Btn[] = [
  { id: 'commons', tier: 1, tone: 'green', show: c => c.set === 'main', active: c => c.commonsOpen, label: () => '◉ COMMONS', glyph: () => '◉', testId: 'commons' },
  { id: 'rec', tier: 2, tone: 'rec', show: c => c.playing, label: c => c.recOn ? `● ${Math.floor(c.recSecs / 60)}:${String(c.recSecs % 60).padStart(2, '0')}` : '● REC', glyph: c => '●', testId: 'rec' },
  { id: 'reset', tier: 1, tone: 'chip', show: c => c.playing && c.rReset, label: () => '⟲ RESET', glyph: () => '⟲', testId: 'reset' },
  { id: 'brewIcon', tier: 1, tone: 'chip', show: c => c.set === 'main', active: c => c.brewIconOpen, label: () => '◆ BREW ICON', glyph: () => '◆', testId: 'brewicon' },
]

const TONES: Record<Tone, (active: boolean) => string> = {
  gold: () => 'font-bold bg-amber-400 border-2 border-amber-200/80 text-black hover:bg-amber-300 shadow-[0_0_16px_rgba(245,176,76,0.5)]',
  blue: () => 'font-bold bg-sky-400 border-2 border-sky-200/80 text-black hover:bg-sky-300 shadow-[0_0_16px_rgba(56,189,248,0.5)]',
  green: (a) => a
    ? 'font-bold bg-emerald-400 border-2 border-emerald-200 text-black shadow-[0_0_26px_rgba(16,185,129,0.9)]'
    : 'font-bold bg-emerald-500 border-2 border-emerald-300/80 text-black hover:bg-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.5)]',
  rec: (a) => a ? 'bg-red-500/25 border border-red-400/60 text-red-100' : 'bg-black/70 border border-white/25 text-white/85 hover:text-white',
  chip: (a) => a ? 'bg-white/20 border border-white/40 text-white' : 'bg-black/70 border border-white/25 text-white/85 hover:text-white',
}

export default function BottomBar({ ctx, act, barH }: { ctx: BarCtx; act: BarActions; barH: number }) {
  const size = ctx.narrow
    ? 'h-11 min-w-[44px] px-3 text-[16px] tracking-normal'
    : ctx.glyphs
      ? 'h-9 min-w-[40px] px-2.5 text-[14px] tracking-normal'
      : 'px-3.5 py-2 text-[12px] tracking-[0.16em]'
  const render = (b: Btn) => {
    if (!b.show(ctx) || b.tier > ctx.tier) return null
    const active = b.active?.(ctx) ?? (b.id === 'rec' ? ctx.recOn : false)
    const text = (ctx.narrow || ctx.glyphs) ? b.glyph(ctx) : b.label(ctx)
    // back's arrow reads tiny at chip font size — render it bigger, same box
    if (b.id === 'back') return (
      <button key={b.id} data-bar={b.testId} onClick={act[b.id]}
        className={`font-mono rounded-xl transition-all shrink-0 grid place-items-center leading-none ${size} ${ctx.narrow ? 'text-[24px]' : 'text-[20px]'} ${TONES[typeof b.tone === 'function' ? b.tone(ctx) : b.tone](active)}`}>
        ◂
      </button>
    )
    const body = b.id === 'nav'
      ? (<span className="inline-flex items-center gap-1.5"><img src="/cartridge-cup.svg" alt="" className={(ctx.narrow || ctx.glyphs) ? 'w-6 h-6' : 'w-5 h-5'} />{!(ctx.narrow || ctx.glyphs) && <span>NAV</span>}</span>)
      : text
    return (
      <button key={b.id} data-bar={b.testId} onClick={act[b.id]}
        className={`font-mono rounded-xl transition-all shrink-0 grid place-items-center ${size} ${TONES[typeof b.tone === 'function' ? b.tone(ctx) : b.tone](active)} ${b.id === 'title' ? 'max-w-[22%] truncate' : ''}`}>
        {body}
      </button>
    )
  }
  return (
    <div className="fixed bottom-0 inset-x-0 z-[135]" style={{ height: `calc(${barH}px + env(safe-area-inset-bottom, 0px))` }}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md border-t border-white/10" />
      {/* ONE div, ONE flex context. FLOW renders in exact visual order; the
          toggles cluster rides the right edge. Contact lives on the NAV page. */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 overflow-hidden" style={{ bottom: 'max(env(safe-area-inset-bottom), 6px)' }}>
        <span className="flex-1" />
        {FLOW.map(render)}
        <span className="flex-1" />
        {TOGGLES.map(render)}
      </div>
    </div>
  )
}
