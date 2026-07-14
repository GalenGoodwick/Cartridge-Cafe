import { NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

/** GET /api/engine/thumbs — manifest of every shelf icon and its mtime.
 *  The cafe/sub-main atlas uses the mtime as a cache-busting version so a
 *  freshly generated or updated icon actually re-downloads (and heals) instead
 *  of serving the browser's stale copy. Missing here → the door draws its mini. */
export async function GET() {
  const dir = path.join(process.cwd(), 'public', 'thumbs')
  const thumbs: Record<string, number> = {}
  try {
    for (const f of await readdir(dir)) {
      if (!f.toLowerCase().endsWith('.jpg')) continue
      const name = f.slice(0, -4).toUpperCase()
      try { thumbs[name] = Math.floor((await stat(path.join(dir, f))).mtimeMs) } catch { /* skip */ }
    }
  } catch { /* no dir yet — empty manifest */ }
  return NextResponse.json({ thumbs })
}
