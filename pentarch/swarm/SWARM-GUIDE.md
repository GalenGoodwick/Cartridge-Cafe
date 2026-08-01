# SWARM GUIDE — the law a docked AI follows

You are one agent in a swarm working a shared **MAP** (`swarm/MAP.json`). No boss
dispatches you. You coordinate through the map and the commons-bus. These are the
rules. The Guide (this file) is what you read after you dock.

## 1. Dock before you build
Run `node swarm/dock.mjs <nodeId>`. It gives you your **situation**: the files you
own, your contract (exports), your dependencies and whether they are green, who
depends on you, and which sibling nodes are open to jump to. Do not touch code
until you have your situation.

## 1b. Ideate before you jump
Before committing to an open node, pause and decide: does a **new node need to
exist first**? A missing seam, a finer sub-node, a contract that should split.
The map is a tree — you may nest a node into children (a parent shader into its
sub-shaders) to reach a workable grain. If a new node is needed, add it and
re-run the loop; only jump once the target is actually the right next thing.

## 2. Edit only your node's files
Your worktree isolates you, but the trunk is shared. Edit only the `files` listed
for your node. Never edit another node's files and copy over — that reverts their
work (the clobber law). If you need a change in a neighbor's file, that is a
**heal**, not an edit (rule 6).

## 3. Green is the only "done" — and it is derived, never declared
A node is finished only when `node swarm/status.mjs` marks it **green** from its
own tests passing. You may not hand-set a node to green. Build only on
dependencies that are already green; a red or open dependency blocks you — take a
different node or heal the dependency first.

## 4. Claim before you edit, release when green or idle
Set `claim: { by, at }` on your node before editing; clear it when the node goes
green or when you step away. A node with someone else's live claim is theirs —
leave it and coordinate on the bus.

## 5. Build one side, then the other if it is still open
A contract has two sides — the node that **exports** an interface and the node
that **consumes** it. You may build your side. If the complementary node is still
**open** (unclaimed), you may claim it and build its side too, then heal both
together — that is often the cleanest way to land a contract. If it is **claimed**,
do not touch it; build your side to the contract and let the bus carry the seam.

## 6. Change your exports → raise a heal-wave
If you change what your node exports, every node in your `dependents` may no longer
compose. Mark each dependent **needs-heal** (its status returns to red until it
re-verifies against your new contract) and announce it on the bus. Healing is a
first-class move: reconcile a dependent to a changed contract, then re-run status.

## 7. Find a gap → grow the tree
If you reference an area that has no node — a missing module, an unowned seam —
**add a node** to the MAP (status `unknown`, no claim) and announce it. The map is
living; discovering and recording a missing node is real work, and it means the
next agent finds it instead of rediscovering it.

## 8. Verify by driving the thing, not by asserting it
Tests are the referee the whole swarm trusts. A node's tests must exercise its
real behavior (the mechanic actually flipping, the hook actually running), not
just typecheck. If a node has runtime surface and no test drives it, that is a gap
(rule 7).

---
*Infra states and checks; it never prescribes how you build. The map tells you
where you are and what is true — the craft inside a node is yours.*
