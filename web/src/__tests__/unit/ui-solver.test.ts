/**
 * THE UI SOLVER — golden-layout contracts.
 *
 * The whole point of the solver is BY-CONSTRUCTION alignment: one rect table
 * every consumer (glass pass, glyph pass, hit-testing, edit mode, AI) reads.
 * These tests pin the layout math exactly — monospace metrics make every
 * position arithmetic, so we assert real numbers, not "roughly".
 */
import { describe, it, expect } from 'vitest'
import {
  solveUi, wrapText, textW, hitUi, unitToUv,
  ADV, LINE, GRID, type UiTree,
} from '../../app/engine/ui-solver'

const solve = (ui: UiTree, extra: Partial<Parameters<typeof solveUi>[0]> = {}) =>
  solveUi({ ui, ...extra })

describe('text metrics — the monospace contract (must match the glyph pass)', () => {
  it('width is exactly len × ADV × fs', () => {
    expect(textW('HELLO', 10)).toBeCloseTo(5 * ADV * 10, 10)
  })
  it('wrap breaks greedily on spaces at the exact budget', () => {
    // budget 10 chars: fs=10 → perLine = floor(62/6.2) = 10
    const lines = wrapText('one two three four', 10, 10 * ADV * 10)
    expect(lines).toEqual(['one two', 'three four'])
  })
  it('a word longer than the budget hard-breaks, never overflows', () => {
    const lines = wrapText('ABCDEFGHIJKL', 10, 4 * ADV * 10)
    expect(lines).toEqual(['ABCD', 'EFGH', 'IJKL'])
    for (const ln of lines) expect(textW(ln, 10)).toBeLessThanOrEqual(4 * ADV * 10 + 1e-9)
  })
  it('explicit newlines are honored', () => {
    expect(wrapText('a\nb', 10, 500)).toEqual(['a', 'b'])
  })
})

describe('column flow — stacking, gap, pad, auto-height', () => {
  const ui: UiTree = {
    rev: 1,
    root: [{
      id: 'vitals', kind: 'panel', anchor: { x: -0.8, y: 0 }, align: 'cl', w: 100, gap: 4, pad: 6,
      children: [
        { id: 'h', kind: 'text', text: 'POWER', fontSize: 10 },
        { id: 'm1', kind: 'meter', value: 0.5, w: 80, h: 8 },
        { id: 'd', kind: 'text', text: 'a description that wraps into lines', fontSize: 8, wrap: true },
      ],
    }],
  }
  const s = solve(ui)
  it('children stack at exact y offsets (pad + heights + gaps)', () => {
    const px = s.rects['vitals'].x, py = s.rects['vitals'].y
    expect(s.rects['h']).toMatchObject({ x: px + 6, y: py + 6 })
    // header h = LINE×10 = 11.5 → meter at pad + 11.5 + gap
    expect(s.rects['m1'].y).toBeCloseTo(py + 6 + LINE * 10 + 4, 6)
    expect(s.rects['d'].y).toBeCloseTo(py + 6 + LINE * 10 + 4 + 8 + 4, 6)
  })
  it('panel auto-height = content + pad, and the wrap linecount is exact', () => {
    // inner width 88 → perLine = floor(88/(0.62·8)) = 17 chars
    const lines = wrapText('a description that wraps into lines', 8, 88)
    expect(lines.length).toBe(3)
    const wantH = 6 + LINE * 10 + 4 + 8 + 4 + lines.length * LINE * 8 + 6
    expect(s.rects['vitals'].h).toBeCloseTo(wantH, 6)
  })
  it('wrapped text emits one run per line, left-aligned inside the panel', () => {
    const runs = s.runs.filter((r) => r.id.startsWith('d'))
    expect(runs.length).toBe(3)
    expect(runs[0].x).toBeCloseTo(s.rects['vitals'].x + 6, 6)
    expect(runs[1].y).toBeCloseTo(runs[0].y + LINE * 8, 6)
  })
})

describe('row flow — natural widths + flex distribution', () => {
  const ui: UiTree = {
    rev: 1,
    root: [{
      id: 'p', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 200, pad: 0,
      children: [{
        id: 'r', kind: 'row', gap: 10,
        children: [
          { id: 'a', kind: 'text', text: 'AB', fontSize: 10 }, // w = 2·6.2 = 12.4
          { id: 'sp', kind: 'spacer', flex: 1 },
          { id: 'b', kind: 'text', text: 'CD', fontSize: 10 },
        ],
      }],
    }],
  }
  const s = solve(ui)
  it('fixed children keep natural width; flex absorbs the leftover', () => {
    expect(s.rects['a'].w).toBeCloseTo(2 * ADV * 10, 6)
    // row inner 200: leftover = 200 − 12.4 − 12.4 − 2 gaps(20) = 155.2 → spacer
    expect(s.rects['b'].x).toBeCloseTo(s.rects['a'].x + 12.4 + 10 + 155.2 + 10, 4)
  })
  it('right edge of the last child meets the row edge (the alignment law)', () => {
    expect(s.rects['b'].x + s.rects['b'].w).toBeCloseTo(200, 4)
  })
})

describe('anchors — uv seats, grid points, entities, alignment', () => {
  it('uv seat (−1..+1, y down) resolves to grid units, center-pinned', () => {
    const s = solve({ rev: 1, root: [{ id: 'p', kind: 'panel', anchor: { x: 0, y: 0 }, w: 100, h: 50, children: [] }] })
    expect(s.rects['p']).toMatchObject({ x: GRID / 2 - 50, y: GRID / 2 - 25, w: 100, h: 50 })
  })
  it('align tl pins the top-left corner to the anchor', () => {
    const s = solve({ rev: 1, root: [{ id: 'p', kind: 'panel', anchor: { gx: 10, gy: 20 }, align: 'tl', w: 100, h: 50, children: [] }] })
    expect(s.rects['p']).toMatchObject({ x: 10, y: 20 })
  })
  it('entity anchor reads the __entities projection (sx,sy in 0..512)', () => {
    const s = solve(
      { rev: 1, root: [{ id: 'tip', kind: 'panel', anchor: { entity: 'helm', dy: -30 }, align: 'bc', w: 60, h: 20, children: [] }] },
      { entities: [{ id: 7, label: 'helm', sx: 256, sy: 300 }] },
    )
    // bottom-center pinned 30 units above the entity
    expect(s.rects['tip']).toMatchObject({ x: 256 - 30, y: 300 - 30 - 20 })
  })
  it('percent width resolves against the square', () => {
    const s = solve({ rev: 1, root: [{ id: 'p', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: '25%', h: 10, children: [] }] })
    expect(s.rects['p'].w).toBeCloseTo(GRID / 4, 6)
  })
})

describe('buttons — one declaration = glyphs + hit rect + action', () => {
  const ui: UiTree = {
    rev: 1,
    root: [{
      id: 'nav', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 120, pad: 0,
      children: [{ id: 'exit', kind: 'button', text: 'EXIT', fontSize: 10, click: 'bt-exit' }],
    }],
  }
  const s = solve(ui)
  it('hit rect wraps the label with padding and carries the action', () => {
    const h = s.hits.find((h) => h.id === 'exit')!
    expect(h.action).toBe('bt-exit')
    expect(h.w).toBeCloseTo(4 * ADV * 10 + 2 * 6, 6) // label + 0.6em pads
  })
  it('hitUi resolves a point inside to the action, outside to null', () => {
    const h = s.hits[0]
    expect(hitUi(s, h.x + 1, h.y + 1)).toBe('bt-exit')
    expect(hitUi(s, h.x + h.w + 5, h.y)).toBeNull()
  })
  it('overlap: the LAST painted panel wins the click', () => {
    const s2 = solve({
      rev: 1,
      root: [
        { id: 'p1', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 100, pad: 0, children: [{ id: 'b1', kind: 'button', text: 'AA', click: 'under' }] },
        { id: 'p2', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 100, pad: 0, children: [{ id: 'b2', kind: 'button', text: 'AA', click: 'over' }] },
      ],
    })
    expect(hitUi(s2, s2.hits[0].x + 1, s2.hits[0].y + 1)).toBe('over')
  })
})

describe('overrides — the UI EDIT channel', () => {
  const ui: UiTree = {
    rev: 3,
    root: [{
      id: 'p', kind: 'panel', anchor: { gx: 100, gy: 100 }, align: 'tl', w: 100, gap: 2, pad: 4,
      children: [
        { id: 'hd', kind: 'text', text: 'HEADER', fontSize: 10 },
        { id: 'body', kind: 'text', text: 'body content', fontSize: 8 },
      ],
    }],
  }
  it('dx/dy moves the panel and everything inside rides along', () => {
    const a = solve(ui)
    const b = solve(ui, { overrides: { p: { dx: 15, dy: -10 } } })
    expect(b.rects['p'].x).toBeCloseTo(a.rects['p'].x + 15, 6)
    expect(b.rects['hd'].x).toBeCloseTo(a.rects['hd'].x + 15, 6)
    expect(b.rects['hd'].y).toBeCloseTo(a.rects['hd'].y - 10, 6)
  })
  it('collapsed keeps only the header; the body vanishes from every table', () => {
    const s = solve(ui, { overrides: { p: { collapsed: true } } })
    expect(s.rects['hd']).toBeDefined()
    expect(s.rects['body']).toBeUndefined()
    expect(s.runs.some((r) => r.text === 'body content')).toBe(false)
    expect(s.rects['p'].h).toBeCloseTo(4 + LINE * 10 + 4, 6)
    expect(s.boxes[0].collapsed).toBe(true)
  })
  it('w override re-solves the layout at the new width', () => {
    const s = solve(ui, { overrides: { p: { w: 60 } } })
    expect(s.rects['p'].w).toBe(60)
    expect(s.boxes[0].w).toBe(60)
  })
})

describe('determinism + conversions', () => {
  const ui: UiTree = {
    rev: 9,
    root: [{
      id: 'p', kind: 'panel', anchor: { x: 0.5, y: -0.5 }, w: 140, gap: 3, pad: 5,
      children: [
        { id: 't', kind: 'text', text: 'STATUS ONLINE', fontSize: 9, textAlign: 'center' },
        { id: 'm', kind: 'meter', value: 0.75, w: 120 },
        { id: 'b', kind: 'button', text: 'GO', click: 'go' },
      ],
    }],
  }
  it('same input → byte-identical output (the replay law)', () => {
    expect(JSON.stringify(solve(ui))).toBe(JSON.stringify(solve(ui)))
  })
  it('meters land in the meter table with clamped fill', () => {
    const s = solve({ rev: 1, root: [{ id: 'p', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 100, pad: 0, children: [{ id: 'm', kind: 'meter', value: 1.7 }] }] })
    expect(s.meters[0].fill).toBe(1)
  })
  it('unitToUv round-trips the uv convention (y down)', () => {
    expect(unitToUv(0, 0)).toEqual([-1, -1])
    expect(unitToUv(256, 256)).toEqual([0, 0])
    expect(unitToUv(512, 512)).toEqual([1, 1])
  })
  it('center textAlign centers the run inside the panel inner width', () => {
    const s = solve(ui)
    const run = s.runs.find((r) => r.text === 'STATUS ONLINE')!
    const p = s.rects['p']
    const lw = textW('STATUS ONLINE', 9)
    expect(run.x).toBeCloseTo(p.x + 5 + (130 - lw) / 2, 6)
  })
  it('glass box exactly frames the panel rect (box+text can never drift)', () => {
    const s = solve(ui)
    expect(s.boxes[0]).toMatchObject(s.rects['p'])
  })
})

describe('clipping + meter labels', () => {
  it('non-wrap text truncates with ".." instead of overflowing (ASCII atlas)', () => {
    const s = solve({ rev: 1, root: [{ id: 'p', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 10 * ADV * 10, pad: 0, children: [{ id: 't', kind: 'text', text: 'ABCDEFGHIJKLMNOP', fontSize: 10 }] }] })
    const run = s.runs.find((r) => r.id === 't')!
    expect(run.text).toBe('ABCDEFGH..')
    expect(textW(run.text, 10)).toBeLessThanOrEqual(10 * ADV * 10 + 1e-9)
  })
  it('a meter label rides inside the bar, vertically centered', () => {
    const s = solve({ rev: 1, root: [{ id: 'p', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 120, pad: 0, children: [{ id: 'm', kind: 'meter', value: 0.5, w: 100, h: 12, label: 'THRUST', fontSize: 8 }] }] })
    const run = s.runs.find((r) => r.id === 'm:l')!
    expect(run.text).toBe('THRUST')
    const m = s.rects['m']
    expect(run.y).toBeGreaterThanOrEqual(m.y)
    expect(run.y + LINE * run.fs).toBeLessThanOrEqual(m.y + m.h + 1e-9)
  })
})

describe('panels table — UI EDIT’s hit list', () => {
  it('top-level panels expose rect + affordances; children do not appear', () => {
    const s = solve({ rev: 1, root: [
      { id: 'a', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 100, pad: 0, children: [{ id: 'inner', kind: 'text', text: 'X' }] },
      { id: 'b', kind: 'panel', anchor: { gx: 200, gy: 0 }, align: 'tl', w: 80, h: 40, draggable: false, collapsible: false, children: [] },
    ] })
    expect(s.panels.map((p) => p.id)).toEqual(['a', 'b'])
    expect(s.panels[0]).toMatchObject({ draggable: true, collapsible: true, collapsed: false, ...s.rects['a'] })
    expect(s.panels[1]).toMatchObject({ draggable: false, collapsible: false })
  })
  it('collapsed state from overrides is reflected in the panels table', () => {
    const s = solve(
      { rev: 1, root: [{ id: 'p', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 100, pad: 2, children: [{ id: 'h', kind: 'text', text: 'HDR', fontSize: 10 }, { id: 'b', kind: 'text', text: 'BODY', fontSize: 10 }] }] },
      { overrides: { p: { collapsed: true } } },
    )
    expect(s.panels[0].collapsed).toBe(true)
    expect(s.panels[0].h).toBeCloseTo(2 + LINE * 10 + 2, 6)
  })
})

describe('the anti-drift law itself', () => {
  it('every run, meter, and hit lies INSIDE its panel box', () => {
    const ui: UiTree = {
      rev: 1,
      root: [{
        id: 'p', kind: 'panel', anchor: { x: -0.6, y: 0.2 }, w: 110, gap: 2, pad: 6,
        children: [
          { kind: 'text', text: 'ALPHA', fontSize: 10 },
          { kind: 'row', gap: 4, children: [{ kind: 'text', text: 'L', fontSize: 8 }, { kind: 'spacer', flex: 1 }, { kind: 'text', text: 'R', fontSize: 8 }] },
          { kind: 'meter', value: 0.4, w: 90 },
          { kind: 'button', text: 'OK', click: 'ok' },
          { kind: 'text', text: 'a long wrapping description of the selected part and its stats', fontSize: 7, wrap: true },
        ],
      }],
    }
    const s = solve(ui)
    const p = s.rects['p']
    const inside = (x: number, y: number, w: number, h: number) =>
      x >= p.x - 1e-6 && y >= p.y - 1e-6 && x + w <= p.x + p.w + 1e-6 && y + h <= p.y + p.h + 1e-6
    for (const r of s.runs) expect(inside(r.x, r.y, textW(r.text, r.fs), LINE * r.fs), `run ${r.id}`).toBe(true)
    for (const m of s.meters) expect(inside(m.x, m.y, m.w, m.h), `meter ${m.id}`).toBe(true)
    for (const h of s.hits) expect(inside(h.x, h.y, h.w, h.h), `hit ${h.id}`).toBe(true)
  })
})
