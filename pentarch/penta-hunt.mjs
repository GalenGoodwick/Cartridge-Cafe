// penta-hunt — SEARCH pentagon-space for the minimal formation enclosing each
// negative-space shape. DFS over chain designs (relative edges 1..4, mirror-
// deduped), early overlap pruning; when a chain re-touches, extract + classify
// holes. Records the FIRST (fewest-tile) specimen of each shape.
import { attachPose, overlaps, contacts } from './penta-core.mjs'
import { holes } from './penta-holes.mjs'

const MAX_TILES = Number(Deno.args[0] || 12)
const TIME_MS = Number(Deno.args[1] || 120000)
const t0 = Date.now()
const found = {}          // shape -> { design, tiles, holes }
let visited = 0, prunedOverlap = 0, timedOut = false

function dfs(tiles, seq) {
  if (Date.now() - t0 > TIME_MS) { timedOut = true; return }
  if (tiles.length >= MAX_TILES) return
  for (let rel = 1; rel <= 4; rel++) {
    if (seq.length === 0 && rel !== 2) continue                    // first attach: symmetric — fix
    // mirror dedup: skip sequences lexicographically above their mirror (1↔4, 2↔3)
    const mirrored = [...seq, rel].map(r => 5 - r).join('')
    if ([...seq, rel].join('') > mirrored) continue
    const parent = tiles[tiles.length - 1]
    const pose = attachPose(parent, rel)
    let bad = false
    for (const t of tiles) { if (overlaps(pose, t)) { bad = true; break } }
    if (bad) { prunedOverlap++; continue }
    const next = [...tiles, { ...pose, parent: tiles.length - 1, edge: rel }]
    visited++
    // a re-touch may have sealed a region — look for holes
    const cs = contacts(next)
    if (cs.some(c => c.retouch)) {
      for (const h of holes(next)) {
        if (!found[h.shape] || next.length < found[h.shape].tiles.length) {
          found[h.shape] = { seq: [...seq, rel].join(''), tiles: next.map(t => ({ cx: t.cx, cy: t.cy, th: t.th })), holes: holes(next) }
          console.log(`  ${h.shape.toUpperCase()} @ ${next.length} tiles  seq=2,${[...seq, rel].join(',')}  area=${h.area} spikes=${h.spikes} reflex=${h.reflex} verts=${h.verts}`)
        }
      }
    }
    dfs(next, [...seq, rel])
    if (timedOut) return
  }
}

const base = { cx: 0, cy: 0, th: 0, parent: -1, edge: -1 }
const first = { ...attachPose(base, 2), parent: 0, edge: 2 }
console.log(`hunting to ${MAX_TILES} tiles (budget ${TIME_MS / 1000}s)…`)
dfs([base, first], [])
console.log(`\nvisited ${visited} layouts, overlap-pruned ${prunedOverlap}${timedOut ? ' — TIMED OUT (partial)' : ' — exhaustive'}`)
console.log('minimal specimens:', Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.tiles.length + ' tiles (seq 2,' + v.seq.split('').join(',') + ')'])))
Deno.writeTextFileSync('/tmp/penta-hunt.json', JSON.stringify(found))
