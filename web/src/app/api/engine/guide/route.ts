import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { logVisit } from '@/lib/visits'

export const dynamic = 'force-dynamic'

/** Progressive disclosure for the 88KB guide. The full text stopped fitting
 *  through one AI tool call, which made every capability past the fold
 *  invisible. Now:
 *    GET /api/engine/guide            → CORE contracts + a capability INDEX
 *    GET /api/engine/guide?section=X  → one section, full depth (## or ###)
 *    GET /api/engine/guide?full=1     → the whole file (back-compat)
 *  CORE membership lives in the guide itself: `<!-- core -->` on a ## heading.
 */

interface Section {
  title: string
  level: number      // 2 = ##, 3 = ###, 4 = ####
  core: boolean
  start: number      // line index of the heading
  end: number        // exclusive
  parent?: string    // ## title for a ### section
}

function parseSections(lines: string[]): Section[] {
  const sections: Section[] = []
  let currentH2: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const m = /^(##|###|####) (.+)$/.exec(l)
    if (!m) continue
    const level = m[1].length
    const core = /<!-- core -->/.test(m[2])
    const title = m[2].replace(/<!-- core -->/, '').trim()
    if (level === 2) currentH2 = title
    sections.push({ title, level, core, start: i, end: lines.length, parent: level >= 3 ? currentH2 : undefined })
  }
  // close each section at the next heading of the same-or-higher level
  for (let s = 0; s < sections.length; s++) {
    for (let t = s + 1; t < sections.length; t++) {
      if (sections[t].level <= sections[s].level) { sections[s].end = sections[t].start; break }
    }
  }
  return sections
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export async function GET(req: NextRequest) {
  logVisit({ kind: 'agent', path: '/api/engine/guide', ref: req.headers.get('referer'), ua: req.headers.get('user-agent'), ip: req.headers.get('x-forwarded-for')?.split(',')[0] })
  try {
    const path = join(process.cwd(), 'src/app/engine/AI_ENGINE_GUIDE.md')
    const md = await readFile(path, 'utf-8')
    const url = new URL(req.url)
    const wantFull = url.searchParams.get('full')
    const wantSection = url.searchParams.get('section')

    if (wantFull) {
      return new NextResponse(md, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
    }

    const lines = md.split('\n')
    const sections = parseSections(lines)

    if (wantSection) {
      const q = norm(wantSection)
      // exact-ish first, then substring, both ways
      const hit =
        sections.find(s => norm(s.title) === q) ||
        sections.find(s => norm(s.title).startsWith(q)) ||
        sections.find(s => norm(s.title).includes(q) || q.includes(norm(s.title)))
      if (hit) {
        const body = lines.slice(hit.start, hit.end).join('\n').replace(/<!-- core -->/g, '').trimEnd()
        return new NextResponse(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
      }
      const idx = sections.map(s => (s.level === 3 ? '  - ' : '- ') + s.title).join('\n')
      return new NextResponse(
        `No section matched "${wantSection}". Available sections:\n\n${idx}\n\nFetch one with ?section=<name> (fuzzy match).`,
        { status: 404, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
    }

    // ---- default: CORE + capability index ----
    const preambleEnd = sections.length ? sections[0].start : lines.length
    const parts: string[] = [lines.slice(0, preambleEnd).join('\n')]
    for (const s of sections) {
      if (s.level === 2 && s.core) {
        parts.push(lines.slice(s.start, s.end).join('\n'))
      }
    }
    const indexLines: string[] = []
    for (const s of sections) {
      if (s.level === 2 && s.core) continue
      if (s.level >= 3) {
        const parentCore = sections.find(p => p.level === 2 && p.title === s.parent)?.core
        if (parentCore) continue                    // already fully in core
        indexLines.push(`${'  '.repeat(s.level - 2)}- ${s.title}`)
      } else {
        indexLines.push(`- **${s.title}**`)
      }
    }
    const index = [
      '',
      '---',
      '',
      '## EVERYTHING ELSE THIS ENGINE CAN DO — the capability index',
      '',
      'The sections below exist in full. Fetch any of them the moment a task touches one —',
      'do NOT guess at their contracts:',
      '',
      '`GET /api/engine/guide?section=<name>` (fuzzy match; sub-sections fetchable by name too)',
      'or the MCP tool: `read_guide {"section": "<name>"}` · whole guide: `?full=1`',
      '',
      ...indexLines,
      '',
      'Films/cutscenes, GPU solvers, multiplayer, audio, persistence, determinism,',
      'components, swarm coordination — if it is named above, the engine does it',
      'and the section has the working recipe with live example worlds.',
    ].join('\n')
    const body = parts.join('\n\n').replace(/<!-- core -->/g, '').trimEnd() + '\n' + index
    return new NextResponse(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
  } catch {
    return NextResponse.json({ error: 'Guide not found' }, { status: 404 })
  }
}
