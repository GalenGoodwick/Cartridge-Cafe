import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir, stat } from 'fs/promises'
import { join, normalize, relative, sep } from 'path'
import { logVisit } from '@/lib/visits'

export const dynamic = 'force-dynamic'

/** GET /api/engine/source — read-only engine source for a build agent.
 *
 *  A locked-down build agent has NO filesystem access (no Read/Grep/Glob), so it
 *  can't learn the real command surface except by probing. This serves the engine
 *  source READ-ONLY over the bridge instead: the authoritative bridge route (every
 *  command + param it accepts), the client engine, and the shader library (the real
 *  WGSL interface). The agent can read it; it can never edit it.
 *
 *  SECURITY: path-jailed to two subtrees — src/app/engine and src/app/api/engine.
 *  Neither holds secrets (they reference process.env.* by name, never literal keys;
 *  real secrets live in web/.env*, outside these trees). The jail rejects any path
 *  that escapes the roots, so .env / tokens / other app code are unreachable.
 *
 *  Usage:
 *    GET /api/engine/source                      → list every readable file (+ line count)
 *    GET /api/engine/source?path=api/engine/bridge/route.ts        → whole file (capped)
 *    GET /api/engine/source?path=…&from=200&to=400                 → a line window
 */

const APP = join(process.cwd(), 'src', 'app')
const ROOTS = ['engine', 'api/engine'] // relative to src/app
const OK_EXT = /\.(ts|tsx|mjs|js|md|wgsl|json)$/
const MAX_CHARS = 45_000 // headless tool-result token ceiling ≈ this many chars

/** Resolve a requested rel path and confirm it stays inside an allowed root. */
function jail(rel: string): string | null {
  const clean = normalize(rel).replace(/^([.][.](\/|\\|$))+/, '') // strip leading ../
  const abs = normalize(join(APP, clean))
  const relToApp = relative(APP, abs)
  if (relToApp.startsWith('..') || relToApp.includes(`..${sep}`)) return null
  const inRoot = ROOTS.some(r => relToApp === r || relToApp.startsWith(r + sep) || relToApp.startsWith(r + '/'))
  if (!inRoot) return null
  if (!OK_EXT.test(abs)) return null
  return abs
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: import('fs').Dirent[]
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      await walk(full, out)
    } else if (OK_EXT.test(e.name)) {
      out.push(full)
    }
  }
}

export async function GET(req: NextRequest) {
  logVisit({ kind: 'agent', path: '/api/engine/source', ref: req.headers.get('referer'), ua: req.headers.get('user-agent'), ip: req.headers.get('x-forwarded-for')?.split(',')[0] })
  const path = req.nextUrl.searchParams.get('path')?.trim()
  const search = req.nextUrl.searchParams.get('search')?.trim()

  // ── SEARCH ─────────────────────────────────────────────────────────────
  // grep the whole engine source for a term and return matching lines with a
  // little context — so an agent finds the one function/param it needs in ONE
  // call instead of paginating whole files. Case-insensitive substring.
  if (search) {
    const needle = search.toLowerCase()
    const files: string[] = []
    for (const r of ROOTS) await walk(join(APP, r), files)
    const hits: { file: string; line: number; text: string }[] = []
    for (const f of files.sort()) {
      let src: string
      try { src = await readFile(f, 'utf-8') } catch { continue }
      const rel = relative(APP, f)
      const ls = src.split('\n')
      for (let i = 0; i < ls.length; i++) {
        if (ls[i].toLowerCase().includes(needle)) {
          hits.push({ file: rel, line: i + 1, text: ls[i].trim().slice(0, 200) })
          if (hits.length >= 120) break
        }
      }
      if (hits.length >= 120) break
    }
    const body = hits.map(h => `${h.file}:${h.line}\t${h.text}`).join('\n')
    return new NextResponse(
      `// search "${search}" — ${hits.length} match(es)${hits.length >= 120 ? ' (capped; narrow the term)' : ''}\n` +
      `// each is file:line — read around one with ?path=<file>&from=<line-8>&to=<line+8>\n${body}\n`,
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }

  // ── LIST ────────────────────────────────────────────────────────────────
  if (!path) {
    const files: string[] = []
    for (const r of ROOTS) await walk(join(APP, r), files)
    const listing = await Promise.all(files.sort().map(async f => {
      const rel = relative(APP, f)
      try {
        const src = await readFile(f, 'utf-8')
        return { path: rel, lines: src.split('\n').length, bytes: src.length }
      } catch { return { path: rel, lines: 0, bytes: 0 } }
    }))
    return NextResponse.json({
      note: 'Read-only engine source. Fetch one with ?path=<path>. Big files: page with &from=<line>&to=<line>. START with api/engine/bridge/route.ts — it is the authoritative list of every command + param the bridge accepts.',
      roots: ROOTS,
      files: listing,
    })
  }

  // ── READ ────────────────────────────────────────────────────────────────
  const abs = jail(path)
  if (!abs) return NextResponse.json({ error: `path not allowed: ${path}. Only src/app/engine and src/app/api/engine are readable.` }, { status: 403 })
  let src: string
  try {
    const st = await stat(abs)
    if (!st.isFile()) throw new Error('not a file')
    src = await readFile(abs, 'utf-8')
  } catch {
    return NextResponse.json({ error: `not found: ${path}` }, { status: 404 })
  }

  const allLines = src.split('\n')
  const total = allLines.length
  const from = Math.max(1, parseInt(req.nextUrl.searchParams.get('from') || '1', 10) || 1)
  const toParam = parseInt(req.nextUrl.searchParams.get('to') || '', 10)
  let to = Number.isFinite(toParam) && toParam > 0 ? toParam : total

  // number the lines so the agent can request the next window precisely
  let body = ''
  let last = from
  for (let i = from; i <= Math.min(to, total); i++) {
    const line = `${i}\t${allLines[i - 1]}\n`
    if (body.length + line.length > MAX_CHARS) break
    body += line
    last = i
  }
  to = last
  const truncated = to < total
  const header = `// ${path}  (lines ${from}-${to} of ${total})` +
    (truncated ? `\n// TRUNCATED — continue with ?path=${path}&from=${to + 1}` : '') + '\n'
  return new NextResponse(header + body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
