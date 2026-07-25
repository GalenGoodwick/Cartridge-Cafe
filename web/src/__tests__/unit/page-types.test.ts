import { describe, it, expect } from 'vitest'
import {
  validateSlug, slugify, hrefOk, screenWgslHazard, sanitizeBlock, sanitizeBlocks,
  MAX_BLOCKS, type Block,
} from '@/lib/page-types'

describe('validateSlug', () => {
  it('accepts a normal slug', () => {
    expect(validateSlug('my-cool-page').ok).toBe(true)
  })
  it('rejects too-short, leading hyphen, spaces, bad chars', () => {
    expect(validateSlug('a').ok).toBe(false)
    expect(validateSlug('-lead').ok).toBe(false)
    expect(validateSlug('has space').ok).toBe(false)
    expect(validateSlug('bad/slash').ok).toBe(false)
  })
  it('normalizes case (uppercase is accepted, stored lowercase downstream)', () => {
    // The whole pipeline lowercases before storing, so a mixed-case input is
    // forgiving rather than an error.
    expect(validateSlug('MyPage').ok).toBe(true)
  })
  it('rejects trailing and double hyphens', () => {
    expect(validateSlug('trail-').ok).toBe(false)
    expect(validateSlug('a--b').ok).toBe(false)
  })
  it('rejects reserved words (route collisions)', () => {
    for (const r of ['p', 'api', 'admin', 'pages']) expect(validateSlug(r).ok).toBe(false)
  })
})

describe('slugify', () => {
  it('normalizes arbitrary text', () => {
    expect(slugify('My Cool Page!!')).toBe('my-cool-page')
    expect(slugify('  --Hello__World--  ')).toBe('hello-world')
  })
  it('produces a validatable slug for reasonable input', () => {
    expect(validateSlug(slugify('Galen’s Landing Page')).ok).toBe(true)
  })
})

describe('hrefOk', () => {
  it('passes http/https/mailto through', () => {
    expect(hrefOk('https://x.com')).toBe('https://x.com')
    expect(hrefOk('http://x.com')).toBe('http://x.com')
    expect(hrefOk('mailto:a@b.com')).toBe('mailto:a@b.com')
  })
  it('neutralizes dangerous schemes', () => {
    expect(hrefOk('javascript:alert(1)')).toBe('#')
    expect(hrefOk('data:text/html,<script>')).toBe('#')
    expect(hrefOk('/relative')).toBe('#')
    expect(hrefOk('')).toBe('#')
  })
})

describe('screenWgslHazard', () => {
  it('passes normal shader source', () => {
    expect(screenWgslHazard('fn fieldEffect() -> vec4f { return vec4f(0.0); }')).toBeNull()
  })
  it('flags a huge baked array literal', () => {
    const big = 'let x = array(' + Array(3000).fill('1').join(',') + ');'
    expect(screenWgslHazard(big)).toBeTruthy()
  })
  it('flags an enormous per-pixel loop bound', () => {
    expect(screenWgslHazard('for (var i = 0; i < 999999; i = i + 1) {}')).toBeTruthy()
  })
})

describe('sanitizeBlock', () => {
  it('accepts a valid shader block and clears nothing safe', () => {
    const b = sanitizeBlock({ kind: 'shader', wgsl: 'fn fieldEffect()->vec4f{return vec4f(0.0);}', aspect: 'wide', span: 2, desc: 'd', prompt: 'p' })
    expect(b?.kind).toBe('shader')
    expect((b as Extract<Block, { kind: 'shader' }>).span).toBe(2)
  })
  it('rejects a hazardous shader block', () => {
    const big = 'let x = array(' + Array(3000).fill('1').join(',') + ');'
    expect(sanitizeBlock({ kind: 'shader', wgsl: big })).toBeNull()
  })
  it('coerces bad shader fields to safe defaults', () => {
    const b = sanitizeBlock({ kind: 'shader', wgsl: 'ok', aspect: 'nonsense', span: 9 }) as Extract<Block, { kind: 'shader' }>
    expect(b.aspect).toBe('tall')
    expect(b.span).toBe(1)
  })
  it('sanitizes link href', () => {
    const b = sanitizeBlock({ kind: 'link', text: 'x', href: 'javascript:1' }) as Extract<Block, { kind: 'link' }>
    expect(b.href).toBe('#')
  })
  it('rejects empty content and unknown kinds', () => {
    expect(sanitizeBlock({ kind: 'text', text: '   ' })).toBeNull()
    expect(sanitizeBlock({ kind: 'bogus', text: 'x' })).toBeNull()
    expect(sanitizeBlock(null)).toBeNull()
  })
  it('clamps heading level to 1..3', () => {
    const b = sanitizeBlock({ kind: 'heading', text: 'H', level: 7 }) as Extract<Block, { kind: 'heading' }>
    expect(b.level).toBe(1)
  })
})

describe('sanitizeBlocks', () => {
  it('drops bad blocks and caps the count', () => {
    const many = Array(MAX_BLOCKS + 10).fill(0).map(() => ({ kind: 'text', text: 'hi' }))
    const out = sanitizeBlocks([...many, { kind: 'bogus' }])
    expect(out.length).toBe(MAX_BLOCKS)
    expect(out.every((b) => b.kind === 'text')).toBe(true)
  })
  it('tolerates non-array input', () => {
    expect(sanitizeBlocks('nope')).toEqual([])
  })
})
