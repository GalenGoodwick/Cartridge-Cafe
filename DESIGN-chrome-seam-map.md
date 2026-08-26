# THE CHROME SEAM MAP — rung 2 forensics (for the mobile/redesign track)

From Opus, Aug 26 night — I spent today inside FieldEngine's chrome (curtain,
plug, dock pills, PLAYABLE, SPRITES) while you fought the seam. This is the
inventory that makes rung 2 a WHOLESALE kill instead of 83 one-by-one edits.

## The core untangling insight
Every scattered gate mixes THREE INDEPENDENT AXES in one boolean expression:

1. **MODE** — view | play | design (your rung-1 cell — the only axis rung 2 moves)
2. **ROLE** — owner | member | visitor | anon (isOwner, me, can(ctx,…))
3. **WORLD-STATE** — building | done | published | versionView-pinned (brief_done,
   buildJobActive, spacePublic, versionView)

The flags feel unkillable because each read encodes a different MIX. Don't
untangle reads — RE-DERIVE each chrome element from the three axes and delete
its old gate unread. `<WorldChrome mode role worldState/>` receives exactly
those three values and NOTHING else; if an element seems to need a fourth
input, it's game UI, not chrome (Galen's law: it goes in world pixels).

## The chrome inventory (all of it — 18 surfaces)
| element | today's gate (approx) | axis truth: show when |
|---|---|---|
| ◂ back | always | always |
| title pill / FocusChip | always (compacts in play) | always · compact in play |
| ⛶ PLAY | !hub && !CAFE/SUB-MAIN | mode=view |
| ? INSTRUCTIONS | same stack | mode=view∨play |
| ● PLAYABLE/UNPUBLISHED | owner && !versionView && spacePublic≠null | mode=view · role=owner |
| ✎ EDIT (→ your ONE EDIT) | !hub && !CAFE/SUB-MAIN | mode=view · role=owner∨member |
| ◆ MAKE ICON | (owner ∥ !spaceId) && slug | mode=design |
| ◲ SPRITES (mine, new) | spaceId && owner && !riding | mode=design |
| ⚙ WORLD TOOLS | can(ctx,'toolsPanel') | mode=design |
| ⌁ BUILDERBOX pill | bottom-left, ~always | mode=view∨design |
| REC | chrome corner | mode=view∨play |
| DOCK IN / FLOW IN | dockable && !owner | mode=view · role=member/visitor |
| + FOLLOW / SHARE | right rail | mode=view |
| build curtain + ⚡CONNECT | building && (owner ∥ !spaceId) | worldState=building · role=owner (ANY mode) |
| CONNECT-AI plug overlay | plugOpen | design (or curtain shortcut) |
| NodeDockPanel | nodesOpen | mode=design |
| BranchesPanel | branchesOpen | mode=design |
| version ▸ scroller | riding/verMax | mode=design · worldState=pinned |

Everything in the design rows moves INTO your rung-3 rail; the view/play rows
are the whole surviving chrome. Note how few rows read more than mode+role —
the 83 reads collapse to ~6 derivations.

## The three traps I hit today in this exact file (avoid re-hitting)
1. **`viewport` is two meanings** — vote-arena chrome-hiding AND your phone
   frame inset. The dock at ~L6349 hides on `viewport||playMode` — that's the
   bug that ate PLAY. Rung 2 must name them apart: `mode==='design'` insets;
   NOTHING else hides chrome off `viewport`.
2. **Signals aren't state** — the curtain's buttons were gated on
   `agentConnected` (flaky SSE) and vanished for a paying customer. Gate
   chrome ONLY off the three axes; live signals (aiEditing, heartbeat) may
   change TEXT, never presence of controls.
3. **`isOwner` arrives as a prop but reads mix it with `!spaceId`** (house
   worlds) — fold that into ROLE once: `role = spaceId ? (isOwner?'owner':…)
   : 'owner'` and stop re-deriving per element.

## Suggested kill order (each its own commit)
1. Introduce `role` + `worldState` cells beside your mode cell (pure derivation,
   nothing reads them yet — zero risk).
2. Build `<WorldChrome mode role worldState/>` containing ONLY the view/play
   rows above; mount it; delete those elements' old inline blocks in the same
   commit (never both alive).
3. Move the design rows into the rail as-is (they can keep their panels'
   internal state; only their TRIGGERS move).
4. Then `viewport` means ONLY "canvas inset rect" — the phone frame lands clean.

— the file's a hostile 7000 lines; if you want a second pair of hands on any
node above, claim it on the commons and I'll take the other half.
