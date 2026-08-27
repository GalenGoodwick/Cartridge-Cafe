// THE ONE ENGINE rung 1 — block → ui-node compiler, proven against the REAL
// solver (not a mock): exact monospace arithmetic, pill disjointness, action
// namespacing, and the phone/desktop instance cull.
import { describe, it, expect } from 'vitest'
import { solveUi, ADV, type SolveInput } from '@/app/engine/ui-solver'
import { blocksToUi, pageToUi, shellTopbarUi, shellAction, SHELL_NS } from '@/app/engine/ui-blocks'
import type { Block } from '@/lib/page-types'

// design-unit viewport for a CSS canvas of w×h px (side = min, GRID = 512)
const vp = (w: number, h: number) => {
  const side = Math.min(w, h)
  return { w: w / (side / 512), h: h / (side / 512) }
}
const solve = (root: ReturnType<typeof shellTopbarUi>, viewport: SolveInput['viewport']) =>
  solveUi({ ui: { root }, viewport })

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5

describe('shellTopbarUi — the app bar as engine UI', () => {
  it('phone instance: back + title + MENU, no DOCK (docking leads to editing)', () => {
    const ids = shellTopbarUi({ title: 'CINDERFELL', instance: 'phone', dockable: true, menu: true }).map(n => n.id)
    expect(ids).toEqual(['shell.back', 'shell.title', 'shell.menu'])
  })

  it('MENU only exists once the host handles it (no dead chrome)', () => {
    const ids = shellTopbarUi({ title: 'X', instance: 'phone' }).map(n => n.id)
    expect(ids).toEqual(['shell.back', 'shell.title'])
  })

  it('desktop instance: DOCK when dockable, neither otherwise', () => {
    expect(shellTopbarUi({ title: 'X', instance: 'desktop', dockable: true }).map(n => n.id)).toContain('shell.dock')
    const bare = shellTopbarUi({ title: 'X', instance: 'desktop' }).map(n => n.id)
    expect(bare).not.toContain('shell.dock')
    expect(bare).not.toContain('shell.menu')
  })

  it('solves on a phone viewport: pills pin to the true top corners, disjoint', () => {
    const viewport = vp(390, 844)                     // design units: 512 × ~1108
    const s = solve(shellTopbarUi({ title: 'PLATFORMER 2D BASE', instance: 'phone', menu: true }), viewport)
    const back = s.rects['shell.back'], title = s.rects['shell.title'], menu = s.rects['shell.menu']
    expect(back).toBeDefined(); expect(title).toBeDefined(); expect(menu).toBeDefined()
    // left pill: exactly EDGE from the viewport's left/top edge
    expect(back.x).toBeCloseTo(8, 3)
    expect(back.y).toBeCloseTo(256 - viewport.h / 2 + 8, 3)
    // title sits exactly 6 units right of the back pill (compiler arithmetic == solver arithmetic)
    expect(title.x).toBeCloseTo(back.x + back.w + 6, 3)
    // right pill: exactly EDGE from the viewport's right edge
    expect(menu.x + menu.w).toBeCloseTo(256 + viewport.w / 2 - 8, 3)
    // the band has one owner: no pill touches another
    expect(overlaps(back, title)).toBe(false)
    expect(overlaps(title, menu)).toBe(false)
    expect(overlaps(back, menu)).toBe(false)
  })

  it('solves on a wide desktop: long titles clip inside the 190-unit chip', () => {
    const s = solve(shellTopbarUi({ title: 'A VERY VERY LONG WORLD NAME INDEED TRULY', instance: 'desktop', dockable: true }), vp(1440, 900))
    expect(s.rects['shell.title'].w).toBeLessThanOrEqual(190)
    // clipped text still renders (a run exists for the name line, ending '..')
    const name = s.runs.find(r => r.id === 'shell.title.name')
    expect(name).toBeDefined()
    expect(name!.text.endsWith('..')).toBe(true)
    expect(overlaps(s.rects['shell.title'], s.rects['shell.dock'])).toBe(false)
  })

  it('clicks are namespaced shell: and carried as solver hits', () => {
    const s = solve(shellTopbarUi({ title: 'X', instance: 'phone', menu: true }), vp(390, 844))
    const actions = s.hits.map(h => h.action)
    expect(actions).toContain(shellAction('back'))
    expect(actions).toContain(shellAction('menu'))
    for (const a of [shellAction('back'), shellAction('menu')]) expect(a.startsWith(SHELL_NS)).toBe(true)
  })

  it('shell pills refuse UI-EDIT drag/collapse (chrome is not furniture)', () => {
    const s = solve(shellTopbarUi({ title: 'X', instance: 'phone', menu: true }), vp(390, 844))
    for (const p of s.panels) { expect(p.draggable).toBe(false); expect(p.collapsible).toBe(false) }
  })

  it('labels are ASCII 32..90 only (the glyph atlas cannot draw beyond it)', () => {
    const s = solve(shellTopbarUi({ title: 'Cinderfell', instance: 'phone', menu: true }), vp(390, 844))
    for (const r of s.runs) for (const ch of r.text) {
      const c = ch.toUpperCase().charCodeAt(0)
      expect(c >= 32 && c <= 90, `glyph '${ch}' in "${r.text}" outside atlas`).toBe(true)
    }
  })
})

describe('blocksToUi — the /pages organization through the engine', () => {
  const blocks: Block[] = [
    { id: 'h', kind: 'heading', text: 'THE SHELF', level: 1 },
    { id: 't', kind: 'text', text: 'every world is a cartridge', },
    { id: 'b', kind: 'button', text: 'play', href: '/space/tideglass' },
    { id: 'l', kind: 'link', text: 'ABOUT', href: '/story' },
    { id: 's', kind: 'shader', wgsl: 'fn x(){}', aspect: 'wide', span: 1, desc: '', prompt: '' },
  ]

  it('maps every block kind to its engine node', () => {
    const nodes = blocksToUi(blocks)
    expect(nodes.map(n => n.kind)).toEqual(['text', 'text', 'row', 'text', 'slot'])
    expect(nodes.map(n => n.id)).toEqual(['blk.h', 'blk.t', 'blk.b', 'blk.l', 'blk.s'])
  })

  it('buttons/links carry their href as a shell action', () => {
    const nodes = blocksToUi(blocks)
    expect(nodes[2].click).toBe(shellAction('href:/space/tideglass'))
    expect(nodes[3].click).toBe(shellAction('href:/story'))
  })

  it('a page solves: glass panel, glyph runs, click hits, and the shader slot punches its hole', () => {
    const s = solveUi({ ui: { root: pageToUi(blocks) }, viewport: { w: 512, h: 512 } })
    expect(s.boxes.length).toBe(1)                     // ONE glass panel — the page
    expect(s.runs.some(r => r.text.includes('THE SHELF'))).toBe(true)
    expect(s.hits.map(h => h.action)).toContain(shellAction('href:/space/tideglass'))
    expect(s.boxes[0].hole).toBeDefined()              // the shader slot shows through
    // heading width arithmetic is the solver's own: chars × ADV × 26
    const head = s.runs.find(r => r.text === 'THE SHELF')!
    expect('THE SHELF'.length * ADV * 26).toBeCloseTo(9 * ADV * 26, 6)
    expect(head.fs).toBe(26)
  })
})
