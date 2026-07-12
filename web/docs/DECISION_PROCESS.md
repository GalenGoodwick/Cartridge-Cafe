# How Unity Chant Reaches a Priority

A complete technical explanation of how ideas submitted by participants are channeled through tiered voting cells to produce a single winning Priority.

---

## Overview

Unity Chant uses a **tiered elimination tournament** where ideas compete in small groups called **cells**. Each tier reduces the number of ideas by roughly 5:1. Winners advance to the next tier, losers are eliminated, and the process repeats until one idea remains. That idea becomes the **Priority** — the group's consensus answer.

```
Tier 1:  40 ideas across 8 cells  →  8 winners advance
Tier 2:  8 ideas across 2 cells   →  2 winners advance
Tier 3:  2 ideas (backfilled to 5) →  Final Showdown  →  1 Priority
```

At scale, 1,000,000 participants producing 1,000,000 ideas would require approximately 9 tiers to reach consensus.

---

## Phase 1: Submission

A facilitator creates a **Talk** — a question or prompt for the group to answer. Participants join the Talk and submit ideas (one idea per person per phase).

**How submission ends:**
- **Timer mode**: The facilitator sets a deadline. When time runs out, voting begins automatically (requires at least 2 ideas).
- **Ideas goal**: Voting starts automatically when N ideas have been submitted.
- **Participants goal**: Voting starts automatically when N participants have joined.
- **Manual**: The facilitator starts voting manually.

**Edge cases:**
- **0 ideas submitted**: Voting does not start. The Talk remains in submission phase.
- **1 idea submitted**: That idea wins by default — no voting needed.

---

## Phase 2: Cell Formation (Tier 1)

When voting begins, the system creates **cells** — small groups of participants who will evaluate a subset of ideas.

### Cell Sizing

Cells target **5 participants** but flex between **3 and 7** to avoid tiny groups:

| Participants | Cell Structure |
|---|---|
| 3 | One cell of 3 |
| 4 | One cell of 4 |
| 5 | One cell of 5 |
| 10 | Two cells of 5 |
| 11 | One cell of 5, one cell of 6 |
| 12 | One cell of 5, one cell of 7 |
| 13 | Two cells of 5, one cell of 3 |

The algorithm never creates cells of 1 or 2 — remainders are absorbed into larger cells (up to 7).

### Idea Distribution

Ideas are distributed **uniquely** across cells — each idea appears in exactly one cell at Tier 1. Ideas are spread as evenly as possible across the number of cells. If there are more ideas than the ideal 5 per cell, some cells get 6-7 ideas.

### Participant Assignment

Participants are assigned to cells with one key rule: **avoid placing a participant in a cell that contains their own idea**, when possible. This prevents authors from voting for their own submission.

The algorithm prioritizes:
1. Get every cell to at least 3 members (minimum for meaningful deliberation)
2. Fill remaining slots in the least-full cells
3. If conflict avoidance is impossible (small groups), accept it as a fallback

### Late Joiners

People who join after voting starts are added to the **smallest active cell** in the current tier, distributed across batches to keep them balanced. Cells are **hard-capped at 7 participants**. If all cells are at capacity, the latecomer sees a "Round Full" message and will participate in the next tier.

---

## Phase 2b: Discussion (Optional)

If the facilitator enabled a discussion period, cells enter a **DELIBERATING** phase before voting opens. During this time, participants can read all ideas in their cell and comment on them. This phase has its own timer — when it expires, voting opens automatically.

If no discussion period is set, cells go directly to voting.

---

## Phase 3: Voting (XP Allocation)

Each participant in a cell receives **10 XP points** to distribute across the ideas in their cell. They must allocate all 10 points — no more, no less. Each idea they vote for must receive at least 1 point.

**Example with 5 ideas:**

| Idea | Points Given |
|---|---|
| Idea A | 5 |
| Idea B | 3 |
| Idea C | 2 |
| Idea D | 0 |
| Idea E | 0 |
| **Total** | **10** |

This weighted voting system lets participants express **strength of preference**, not just binary support.

### How a Cell Resolves

When all participants in a cell have voted (or the timer expires), the cell completes:

1. **Sum XP per idea** across all voters in the cell
2. **The idea with the most total XP wins** and advances to the next tier
3. **All other ideas are eliminated** (single elimination)

**Tie handling:** If multiple ideas tie for the highest XP total, all tied ideas advance.

**Minimum threshold:** With only 1 voter, ideas need at least 4 XP to advance. This prevents a single person from advancing a throwaway pick with 1 point.

**Zero votes:** If no one votes at all (even after a timeout extension), all ideas advance. The system never eliminates ideas without any human input.

### Grace Period

When the last voter in a cell submits their vote, a **10-second grace period** starts. During this window, participants can change their vote. After 10 seconds, the cell finalizes automatically. This prevents strategic last-second voting while still allowing corrections.

### Timeout Handling

**Timed mode**: The facilitator sets a voting duration per tier. When time runs out, all incomplete cells are force-completed with whatever votes have been cast.

**No-timer mode**: Cells complete naturally as all participants vote. Two safeguards prevent stalling:

1. **Zero-vote extension**: If a cell has zero votes when the timeout fires, it gets **one extension** (another full timeout period). If it still has zero votes after the extension, it force-completes with all ideas advancing.

2. **Supermajority auto-advance** (enabled by default, no-timer mode only): When 80% or more of cells in a tier have completed, a **10-minute grace period** starts. After 10 minutes, all remaining straggler cells are force-completed. This prevents a few inactive participants from blocking the entire group.

---

## Phase 4: Tier Advancement

After all cells in a tier complete, the system collects advancing ideas and builds the next tier.

### Normal Tier (6+ advancing ideas)

Ideas are grouped into **batches** of ~5, and new cells are created for each batch. All participants are redistributed across the new cells (everyone participates in every tier, not just winners from their previous cell).

**Batch sizing:** The system uses `round(ideas / 5)` to determine the number of batches, then distributes ideas and members evenly. Remainders go to earlier batches. Each batch may have multiple cells if there are enough participants.

```
Tier 1:  40 ideas → 8 cells of 5 ideas each → 8 winners
Tier 2:  8 ideas  → 2 batches of 4 ideas → 2 cells → 2 winners
Tier 3:  2 ideas (backfilled to 5) → Final Showdown
```

### Final Showdown (2-5 advancing ideas)

When 5 or fewer ideas remain, the system enters the **Final Showdown**:

- **ALL participants** vote on **ALL remaining ideas** (not just a subset)
- Participants are split into multiple cells of 5, but every cell votes on the **same set of ideas**
- Votes are tallied **across all cells** (cross-cell tallying), not per-cell
- The idea with the highest total XP across all cells wins

This ensures the final decision reflects the will of the entire group, not just a small cell.

### Backfill Rule

If only 2, 3, or 4 ideas advance to the next tier, the system **backfills to 5** by reviving the best-performing eliminated ideas from the previous tier:

1. Pull eliminated ideas from the just-completed tier, ordered by total XP (highest first)
2. Revive enough to reach 5 total ideas
3. **Tie handling at the cutoff**: If the last included idea ties in XP with excluded ones, include all tied ideas (allowing 6-7 in the final showdown). If too many ties to include, randomly select from the tied group.

This prevents a situation where 2 ideas face off with no alternatives, and gives strong runners-up a second chance.

### Champion Entry (Challenge Rounds Only)

During a challenge round (see Rolling Mode below), the defending champion enters the tournament at a **higher tier**, skipping Tier 1. This gives the incumbent an advantage — challengers must prove themselves through early tiers before facing the champion.

The entry tier is based on where the champion originally won (minimum Tier 2). When the tier matching `championEnteredTier` is reached, the defending champion joins the pool of advancing ideas.

---

## Phase 5: Priority Declared

When a single idea remains (either by being the last one standing or by winning the Final Showdown), it becomes the **Priority** — the group's consensus answer.

At this point, the Talk either:
- **Completes** (one-time mode): The Priority is final. The Talk is done.
- **Enters Accumulation** (rolling mode): The Priority stands, but can be challenged by new ideas.

---

## Rolling Mode (Accumulation + Challenge Rounds)

If the facilitator enabled **rolling mode** (accumulation), the Talk continues after a Priority is declared.

### Accumulation Phase

During accumulation:
- The current Priority is displayed
- New participants can join and submit **challenger ideas**
- Previously eliminated ideas can be **benched** (held for future rounds)
- A countdown timer runs (set by the facilitator)

When the accumulation timer expires, a **Challenge Round** begins.

### Challenge Round

A challenge round is a fresh voting tournament for challenger ideas:

1. **Retirement**: Ideas with 2+ losses across rounds are **retired** (permanently removed), as long as enough challengers remain to form a tournament. The minimum pool size scales with the champion's tier.
2. **Benching**: Ideas with 2+ losses that can't be retired (not enough challengers) are **benched** for a future round.
3. **Tier 1 cells**: Remaining challengers enter Tier 1 cells and vote normally.
4. **Champion defense**: The current Priority enters at a higher tier (skips early rounds).
5. **Resolution**: If a challenger beats the champion, it becomes the new Priority. If the champion wins, it retains its position.

If no challengers have been submitted after 3 consecutive accumulation periods, the Priority is declared final and the Talk completes.

### Rolling Mode Cycle

```
Priority Declared
       ↓
Accumulation (accept new ideas)
       ↓
Challenge Round (challengers vote through tiers)
       ↓
Champion enters at higher tier
       ↓
Final Showdown (champion vs best challenger)
       ↓
New Priority (or champion retains)
       ↓
Back to Accumulation...
```

---

## Continuous Flow Mode

An alternative to the standard batch model. In continuous flow:

- **Tier 1 cells form as ideas arrive** — every 5 ideas triggers a new cell
- Voting starts immediately in each cell while new ideas are still being submitted
- Winners advance to Tier 2 as cells complete
- The facilitator must **manually close submissions** to stop new Tier 1 cells from forming
- After submissions close, the system waits for all Tier 1 cells to complete before advancing

This mode is designed for large-scale, time-sensitive deliberations where waiting for all submissions before starting would be impractical.

---

## Comment Up-Pollination

Comments attached to ideas can **spread virally** across cells and **promote to higher tiers**:

1. A comment starts in its origin cell with `spreadCount = 0`
2. When it reaches **3 upvotes**, it spreads to ~3 nearby cells in the same tier (`spreadCount = 1`)
3. Each additional **2 upvotes** spreads it further (~9 cells at `spreadCount = 2`, all cells at `spreadCount = 3+`)
4. When a tier completes and an idea advances, the **top comment** (by upvote count) for that idea is **promoted to the next tier** with a fresh `spreadCount = 0`

Only comments attached to a specific idea can spread. Unlinked comments stay in their origin cell.

---

## Summary of Key Numbers

| Parameter | Value |
|---|---|
| Target cell size | 5 participants |
| Cell size range | 3-7 participants |
| Hard cap per cell | 7 participants |
| Ideas per cell (Tier 1) | ~5, distributed evenly |
| XP per voter | 10 points |
| Minimum XP to advance (1 voter) | 4 points |
| Final Showdown threshold | 5 or fewer ideas |
| Backfill target | 5 ideas |
| Grace period after last vote | 10 seconds |
| Supermajority threshold | 80% of cells complete |
| Supermajority grace period | 10 minutes |
| Zero-vote extensions | 1 (then force-complete) |
| Retirement threshold | 2+ losses |
| Max no-challenger rounds | 3 (then Talk completes) |
| Continuous flow cell trigger | Every 5 ideas |
| Scale: 1M participants | ~9 tiers |
