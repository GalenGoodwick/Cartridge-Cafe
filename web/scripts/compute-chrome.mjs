// Computes worldChromeUi() JSON for desktop and phone instances by bundling
// the real ui-blocks.ts (+ ui-grid.ts, ui-solver.ts) with esbuild and calling it.
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = '/Users/galengoodwick/Documents/GitHub/cafe-swapmain-wt/web'
const tmp = mkdtempSync(join(tmpdir(), 'chrome-'))
const out = join(tmp, 'ui-blocks.mjs')

execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
  'src/app/engine/ui-blocks.ts',
  '--bundle',
  '--format=esm',
  `--outfile=${out}`,
  '--platform=node',
  `--alias:@=${join(ROOT, 'src')}`,
], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })

const mod = await import(pathToFileURL(out).href)

const desktop = mod.worldChromeUi({
  title: 'CINDERFELL', sub: 'MAIN - LIVE', instance: 'desktop', isOwner: false,
  window: { w: 1344, h: 800 },
})
const phone = mod.worldChromeUi({
  title: 'CINDERFELL', sub: 'MAIN - LIVE', instance: 'phone', isOwner: false,
  window: { w: 412, h: 900 },
})

console.log('DESKTOP_NODES:')
console.log(JSON.stringify(desktop))
console.log('PHONE_NODES:')
console.log(JSON.stringify(phone))
