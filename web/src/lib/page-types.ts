// CAFE PAGES — pure model: types, caps, and DB-free helpers. Safe to import from
// client components AND from the server library (`@/lib/pages`, which adds the
// slot-store CRUD on top). Nothing here touches fs/prisma/crypto-node.

// ─── Types ───────────────────────────────────────────────────────────────────

export type Aspect = 'tall' | 'square' | 'wide'

export type ShaderBlock = {
  id: string
  kind: 'shader'
  wgsl: string
  aspect: Aspect
  span: 1 | 2
  desc: string
  prompt: string
  /** true while an "imagine" invitation is out and no AI has answered yet */
  awaiting?: boolean
}
export type HeadingBlock = { id: string; kind: 'heading'; text: string; level: 1 | 2 | 3 }
export type TextBlock = { id: string; kind: 'text'; text: string }
export type LinkBlock = { id: string; kind: 'link'; text: string; href: string }
export type ButtonBlock = { id: string; kind: 'button'; text: string; href: string }

export type Block = ShaderBlock | HeadingBlock | TextBlock | LinkBlock | ButtonBlock
export type BlockKind = Block['kind']

export type PageDoc = {
  id: string
  ownerId: string
  title: string
  slug: string | null
  blocks: Block[]
  published: boolean
  publishedAt?: number
  createdAt: number
  updatedAt: number
}

/** The public shape served at /p/<slug> — no owner/internal fields. */
export type PublicPage = { title: string; blocks: Block[]; publishedAt: number; slug: string }

// ─── Caps ────────────────────────────────────────────────────────────────────

export const MAX_BLOCKS = 40
export const MAX_WGSL_BYTES = 40_000
export const MAX_TITLE = 120
export const MAX_HEADING = 200
export const MAX_TEXT = 5_000
export const MAX_LINK_TEXT = 120
export const MAX_HREF = 500

export const ASPECTS: Aspect[] = ['tall', 'square', 'wide']

// Slugs that would collide with a real route, plus a few we want to keep free.
const RESERVED_SLUGS = new Set([
  'p', 'api', 'u', 'space', 'maker', 'hub', 'admin', 'auth', 'commons', 'feed',
  'mine', 'engine', 'pages', 'new', 'draft', 'preview', 'terms', 'privacy',
])

// ─── Pure helpers (unit-tested) ──────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/

/** Is `slug` a syntactically valid, non-reserved public slug? */
export function validateSlug(slug: string): { ok: true } | { ok: false; error: string } {
  if (typeof slug !== 'string') return { ok: false, error: 'slug required' }
  const s = slug.trim().toLowerCase()
  if (!SLUG_RE.test(s)) {
    return { ok: false, error: 'slug must be 2–49 chars: lowercase letters, numbers, hyphens; no leading hyphen' }
  }
  if (s.endsWith('-')) return { ok: false, error: 'slug may not end with a hyphen' }
  if (s.includes('--')) return { ok: false, error: 'slug may not contain a double hyphen' }
  if (RESERVED_SLUGS.has(s)) return { ok: false, error: `"${s}" is reserved` }
  return { ok: true }
}

/** Normalize any string into a candidate slug (best-effort; still validate after). */
export function slugify(raw: string): string {
  return String(raw || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 49)
}

/** Only http(s)/mailto links survive; anything else (javascript:, data:, …) → '#'. */
export function hrefOk(href: string): string {
  const h = String(href || '').trim().slice(0, MAX_HREF)
  if (/^https?:\/\//i.test(h)) return h
  if (/^mailto:[^\s@]+@[^\s@]+/i.test(h)) return h
  return '#'
}

const clamp = (s: unknown, n: number) => String(s ?? '').slice(0, n)

/** PRE-FLIGHT WGSL hazard screen — ported from FieldRenderer.screenVisualHazard.
 *  Rejects WGSL that would hang the GPU compiler (a baked-image const array,
 *  oversized source, or a huge per-pixel loop) and freeze the visitor's machine
 *  BEFORE it reaches createShaderModule. Returns a reason, or null if safe. */
const HAZARD_MAX_WGSL_BYTES = 60_000
const HAZARD_MAX_ARRAY_ELEMENTS = 2047
const HAZARD_MAX_BAKED_ELEMENTS = 8192
const HAZARD_MAX_LOOP_BOUND = 8192

function measureBakedArrays(w: string): { arrays: number; maxArray: number; totalElements: number } {
  let arrays = 0, maxArray = 0, totalElements = 0
  const re = /\barray\b\s*(?:<[^>]*>)?\s*\(/g
  while (re.exec(w) !== null) {
    let depth = 1, commas = 0, i = re.lastIndex
    for (; i < w.length && depth > 0; i++) {
      const ch = w[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 1) commas++
    }
    const els = commas + 1
    if (els > 1) { arrays++; totalElements += els; if (els > maxArray) maxArray = els }
    re.lastIndex = i
  }
  return { arrays, maxArray, totalElements }
}

export function screenWgslHazard(wgsl: string): string | null {
  const w = wgsl || ''
  const { arrays, maxArray, totalElements } = measureBakedArrays(w)
  if (maxArray > HAZARD_MAX_ARRAY_ELEMENTS) {
    return `array literal of ${maxArray} elements exceeds the WGSL ${HAZARD_MAX_ARRAY_ELEMENTS} const-array cap`
  }
  if (totalElements > HAZARD_MAX_BAKED_ELEMENTS) {
    return `baked data: ${arrays} array literals / ${totalElements} elements — would hang the GPU compiler (use a texture, not a baked image)`
  }
  if (w.length > HAZARD_MAX_WGSL_BYTES) {
    return `oversized WGSL (${(w.length / 1024).toFixed(0)}KB > ${(HAZARD_MAX_WGSL_BYTES / 1024).toFixed(0)}KB) — would hang the GPU compiler`
  }
  const loopRe = /for\s*\(\s*var\s+\w+[^;{]*;\s*\w+\s*<=?\s*(\d+)/g
  let lm: RegExpExecArray | null
  while ((lm = loopRe.exec(w)) !== null) {
    if (parseInt(lm[1], 10) > HAZARD_MAX_LOOP_BOUND) {
      return `loop bound of ${lm[1]} exceeds the ${HAZARD_MAX_LOOP_BOUND} cap — a per-pixel loop this long stalls the GPU for seconds per frame`
    }
  }
  return null
}

/** Deterministic block id (the server mints crypto ids; this is the client/local
 *  fallback). `seed` should be unique-ish per call site to avoid collisions. */
export function localBlockId(seed = ''): string {
  return `b_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}${seed}`
}

/** Coerce arbitrary (owner- or AI-supplied) input into a safe Block, or null if
 *  it is unusable (unknown kind, empty, or a WGSL freeze-hazard). */
export function sanitizeBlock(input: unknown): Block | null {
  if (!input || typeof input !== 'object') return null
  const b = input as Record<string, unknown>
  const id = typeof b.id === 'string' && b.id ? b.id.slice(0, 40) : localBlockId()
  switch (b.kind) {
    case 'shader': {
      const wgsl = clamp(b.wgsl, MAX_WGSL_BYTES)
      if (!wgsl.trim()) return null
      if (screenWgslHazard(wgsl)) return null
      return {
        id, kind: 'shader', wgsl,
        aspect: ASPECTS.includes(b.aspect as Aspect) ? (b.aspect as Aspect) : 'tall',
        span: b.span === 2 ? 2 : 1,
        desc: clamp(b.desc, 200),
        prompt: clamp(b.prompt, 500),
        ...(b.awaiting ? { awaiting: true } : {}),
      }
    }
    case 'heading': {
      const text = clamp(b.text, MAX_HEADING)
      if (!text.trim()) return null
      const lvl = b.level === 2 ? 2 : b.level === 3 ? 3 : 1
      return { id, kind: 'heading', text, level: lvl as 1 | 2 | 3 }
    }
    case 'text': {
      const text = clamp(b.text, MAX_TEXT)
      if (!text.trim()) return null
      return { id, kind: 'text', text }
    }
    case 'link':
    case 'button': {
      const text = clamp(b.text, MAX_LINK_TEXT)
      if (!text.trim()) return null
      return { id, kind: b.kind, text, href: hrefOk(String(b.href ?? '')) }
    }
    default:
      return null
  }
}

/** Sanitize a whole block list: drop unusable blocks, cap the count. */
export function sanitizeBlocks(input: unknown): Block[] {
  const arr = Array.isArray(input) ? input : []
  const out: Block[] = []
  for (const raw of arr) {
    const b = sanitizeBlock(raw)
    if (b) out.push(b)
    if (out.length >= MAX_BLOCKS) break
  }
  return out
}
