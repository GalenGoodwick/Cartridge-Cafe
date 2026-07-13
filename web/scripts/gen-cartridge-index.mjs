// Build-time manifest of house cartridges: the shelf the cafe can always see,
// even where the engine store has no disk (serverless production).
import { readdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '../public/cartridges')
const names = readdirSync(dir)
  .filter(f => f.endsWith('.json') && f !== 'index.json')
  .map(f => f.slice(0, -5))
  .sort()
writeFileSync(join(dir, 'index.json'), JSON.stringify({ names }, null, 1))
console.log('cartridge index:', names.length, 'worlds')
