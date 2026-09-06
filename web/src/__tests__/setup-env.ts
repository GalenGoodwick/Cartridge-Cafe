// Integration tests hit the DEV database (cool-pond) — vitest doesn't load
// .env.local the way Next does, so the "(dev DB)" suites have failed on a
// missing DATABASE_URL since forever (13 perma-red tests that were never a
// real signal). Zero-dep loader: parse .env.local, fill process.env gaps.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

try {
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const m = /^([A-Z0-9_]+)=("?)([^"\n]*)\2\s*$/.exec(line.trim())
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[3]
  }
} catch { /* no .env.local (CI) — suites depending on it will skip/fail visibly */ }
