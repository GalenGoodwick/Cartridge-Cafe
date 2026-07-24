// keys.mjs — NODE KEYS. A node isn't done when its tests pass; it is done when
// every KEY it must fulfil is fulfilled. Keys are AUTO-ADDED by node kind, so a
// gameplay node automatically owes a `playthrough-confirmed` and a render node
// owes a `visual-reference` — the exact checks whose absence let VIGIL read
// "green" while clipping through walls and never flipping a pane in play.
//
// Fulfilment:
//   unit-tested        — auto-derived: the node's vitest run passes
//   render-verified    — auto-derived: a GPU probe rendered it clean
//   visual-reference   — EVIDENCE required: a reference target + a frame matching it
//   playthrough-confirmed — EVIDENCE required: driven end-to-end in play, observed working
//   self-hosted        — EVIDENCE required: the tool runs on its own map
//
// Evidence keys can't be faked by a script — an AI or human records them in the
// node's `evidence:{key:...}`. Until then the key is PENDING and the node is not done.

export const KEY_BY_KIND = {
  lib:        ['unit-tested'],
  hook:       ['unit-tested'],
  mechanic:   ['unit-tested', 'playthrough-confirmed'],
  puzzle:     ['unit-tested', 'playthrough-confirmed'],
  collision:  ['unit-tested', 'playthrough-confirmed'],
  character:  ['unit-tested', 'playthrough-confirmed', 'visual-reference'],
  game:       ['playthrough-confirmed'],
  shader:     ['render-verified', 'visual-reference'],
  render:     ['render-verified', 'visual-reference'],
  audio:      ['playthrough-confirmed'],
  deploy:     ['playthrough-confirmed'],
  tooling:    ['self-hosted'],
}

export const AUTO_DERIVED = new Set(['unit-tested', 'render-verified'])

/** The keys a node owes, from its kind (falling back to unit-tested if it has tests). */
export function autoKeys(node) {
  if (node.keys) return node.keys                              // explicit override
  return KEY_BY_KIND[node.kind] || (node.tests && node.tests.length ? ['unit-tested'] : [])
}

/** Fulfilment of one key: 'pass' | 'fail' | 'pending'.
 *  derived args carry the auto-derivable facts; evidence carries recorded ones. */
export function keyState(key, node, { testPass, renderVerified }) {
  const ev = (node.evidence || {})[key]
  if (ev === true || ev === 'pass') return 'pass'
  if (ev === false || ev === 'fail') return 'fail'
  if (key === 'unit-tested') return testPass == null ? 'pending' : (testPass ? 'pass' : 'fail')
  if (key === 'render-verified') return renderVerified ? 'pass' : 'pending'
  if (typeof ev === 'string') return 'pass'                    // any recorded note counts as evidence
  return 'pending'
}
