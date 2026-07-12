# Up-Pollination Architecture: Recursive Democratic Discussion

## Core Principle

Just as ideas up-pollinate through tiered voting, **comments up-pollinate through the same democratic structure**. The best thinking rises alongside the best ideas.

---

## 1. Comment Structure

```
Comment {
  id
  text
  authorId

  // Linked to specific idea (even in stream view)
  ideaId

  // Where this comment lives in the hierarchy
  cellId?          // Cell-level comment
  batchId?         // Up-pollinated to batch
  tierId?          // Up-pollinated to tier

  // Up-pollination tracking
  upPollinatedFrom: Comment[]   // Child comments that fed into this
  upPollinatedTo?: Comment      // Parent comment this became part of

  // Voting
  votes: number

  // Revision potential
  isRevisionCandidate: boolean  // Author marked as potential idea improvement
  adoptedAsRevision: boolean    // Idea author accepted as revision
}
```

---

## 2. The Up-Pollination Flow

### Level 1: Cell Discussion (5 people)
```
┌─────────────────────────────────────────────────────┐
│ CELL #47 - Voting on 5 ideas                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Idea A: "Universal basic income"                    │
│    "What about inflation?" (3 votes)                │
│    "Could fund via carbon tax" (4 votes)            │
│    "Already tested in Finland" (1 vote)             │
│                                                     │
│ Idea B: "Job guarantee program"                     │
│    "More dignified than UBI" (2 votes)              │
│    "Implementation costs?" (3 votes)                │
│                                                     │
│ [When cell completes]                               │
│ → Winning idea advances                             │
│ → Top 1-2 comments per idea UP-POLLINATE to batch   │
└─────────────────────────────────────────────────────┘
```

### Level 2: Batch Discussion (5 cells = 25 people's best comments)
```
┌─────────────────────────────────────────────────────┐
│ BATCH - Tier 1, Ideas A,B,C,D,E                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Idea A: "Universal basic income"                    │
│                                                     │
│ UP-POLLINATED COMMENTS (from 5 cells):              │
│    "Could fund via carbon tax" (Cell 47) - 12 votes │
│    "Automation makes this inevitable" (Cell 12)     │
│    "Alaska model proves it works" (Cell 89)         │
│    "Inflation concerns overblown per studies"       │
│    "Combine with job training programs"             │
│                                                     │
│ [Batch participants vote on comments too]           │
│ → Top comments UP-POLLINATE to tier level           │
└─────────────────────────────────────────────────────┘
```

### Level 3: Tier Discussion (all batches)
```
┌─────────────────────────────────────────────────────┐
│ TIER 1 SYNTHESIS - 1000 participants distilled      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Idea A: "Universal basic income"                    │
│                                                     │
│ TIER-LEVEL INSIGHTS (best of 200 cells):            │
│    "Fund via carbon tax + automation levy" (89 v)   │
│    "Pilot data from 12 countries supports" (67 v)   │
│    "Combine with skill training for best results"   │
│                                                     │
│ These comments represent the DISTILLED WISDOM       │
│ of 1000 people's discussion                         │
└─────────────────────────────────────────────────────┘
```

---

## 3. Sub-Batching for Scale (Tier 9 Problem)

At tier 9 with 1M+ participants:
- ~200,000 cells worth of comments
- Need hierarchical sub-batching

```
Tier 9 Comment Structure:

Comments from 200,000 cells
         ↓
    Sub-batch Level 1: Groups of 5 cells → 40,000 comment batches
         ↓
    Sub-batch Level 2: Groups of 5 batches → 8,000 super-batches
         ↓
    Sub-batch Level 3: Groups of 5 → 1,600 mega-batches
         ↓
    Sub-batch Level 4: Groups of 5 → 320 ultra-batches
         ↓
    Sub-batch Level 5: Groups of 5 → 64 final batches
         ↓
    Tier-level synthesis: ~64 best comments per idea

Each level: top 2 comments up-pollinate
Result: The very best insights from 200,000 cells surface
```

---

## 4. Comments as Revisions

```
┌─────────────────────────────────────────────────────┐
│ Idea: "Universal basic income"                      │
│    by @economist_jane                               │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Comment: "What if we fund it via carbon tax?"       │
│    by @climate_guy                                  │
│    [OFFER AS REVISION]                              │
│                                                     │
│         ↓ (if idea author accepts)                  │
│                                                     │
│ Idea v2: "Universal basic income funded by          │
│           carbon tax"                               │
│    by @economist_jane + @climate_guy                │
│                                                     │
│ Revision history preserved                          │
│ Both authors credited                               │
│ Original continues competing OR replaced            │
└─────────────────────────────────────────────────────┘
```

### Revision Rules:
- Comment author can mark as "revision candidate"
- Idea author can "adopt" the revision
- Creates new version, credits both
- Community can vote on which version advances

---

## 5. Stream View with Idea Linking

```
┌─────────────────────────────────────────────────────┐
│ CELL #47 DISCUSSION STREAM                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ @alex: This is interesting but expensive            │
│        Linked to: "Universal basic income"          │
│        [+2] [Reply] [Offer as Revision]             │
│                                                     │
│ @sam: I like the job guarantee better               │
│       Linked to: "Job guarantee program"            │
│       [+1] [Reply]                                  │
│                                                     │
│ @alex: @sam but automation will eliminate jobs      │
│        Linked to: "Universal basic income"          │
│        [+3] [Reply]                                 │
│                                                     │
│ @jordan: Why not combine both approaches?           │
│          Linked to: Both ideas (comparison)         │
│          [+4] [Reply] [Offer as Revision]           │
│                                                     │
│ ────────────────────────────────────────────        │
│ [Add comment...] [Select idea to link]              │
└─────────────────────────────────────────────────────┘
```

---

## 6. Data Model

```prisma
model Comment {
  id        String   @id @default(cuid())
  text      String
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
  createdAt DateTime @default(now())

  // Idea linkage (required - every comment links to an idea)
  idea      Idea     @relation(fields: [ideaId], references: [id])
  ideaId    String

  // Hierarchy position
  cell      Cell?    @relation(fields: [cellId], references: [id])
  cellId    String?
  batch     Batch?   @relation(fields: [batchId], references: [id])
  batchId   String?
  tier      Int?
  subBatchLevel Int? // For deep hierarchy at scale

  // Up-pollination
  upPollinatedFromId String?
  upPollinatedFrom   Comment?  @relation("UpPollination", fields: [upPollinatedFromId], references: [id])
  upPollinatedTo     Comment[] @relation("UpPollination")

  // Voting
  votes     CommentVote[]
  voteCount Int      @default(0)

  // Revision system
  isRevisionCandidate Boolean @default(false)
  adoptedAsRevision   Boolean @default(false)
  resultingRevision   IdeaRevision?

  // Threading
  parentId  String?
  parent    Comment?  @relation("Replies", fields: [parentId], references: [id])
  replies   Comment[] @relation("Replies")
}

model CommentVote {
  id        String   @id @default(cuid())
  comment   Comment  @relation(fields: [commentId], references: [id])
  commentId String
  user      User     @relation(fields: [userId], references: [id])
  userId    String

  @@unique([commentId, userId])
}

model IdeaRevision {
  id              String   @id @default(cuid())
  idea            Idea     @relation(fields: [ideaId], references: [id])
  ideaId          String
  originalText    String
  revisedText     String
  sourceComment   Comment  @relation(fields: [sourceCommentId], references: [id])
  sourceCommentId String   @unique
  version         Int

  // Credit
  originalAuthor  User     @relation("OriginalAuthor", fields: [originalAuthorId], references: [id])
  originalAuthorId String
  revisionAuthor  User     @relation("RevisionAuthor", fields: [revisionAuthorId], references: [id])
  revisionAuthorId String
}

model Batch {
  id            String    @id @default(cuid())
  deliberation  Deliberation @relation(fields: [deliberationId], references: [id])
  deliberationId String
  tier          Int
  cells         Cell[]
  comments      Comment[] // Up-pollinated comments

  // Sub-batching for scale
  parentBatchId String?
  parentBatch   Batch?    @relation("SubBatch", fields: [parentBatchId], references: [id])
  subBatches    Batch[]   @relation("SubBatch")
  subBatchLevel Int       @default(0)
}
```

---

## 7. Up-Pollination Algorithm

```typescript
async function upPollinateComments(cellId: string) {
  // Get top N comments from completed cell
  const topComments = await prisma.comment.findMany({
    where: { cellId },
    orderBy: { voteCount: 'desc' },
    take: 2, // Top 2 comments per idea up-pollinate
  })

  // Get the batch this cell belongs to
  const cell = await prisma.cell.findUnique({
    where: { id: cellId },
    include: { batch: true }
  })

  // Create up-pollinated copies at batch level
  for (const comment of topComments) {
    await prisma.comment.create({
      data: {
        text: comment.text,
        authorId: comment.authorId,
        ideaId: comment.ideaId,
        batchId: cell.batch.id,
        upPollinatedFromId: comment.id,
        tier: cell.tier,
      }
    })
  }
}

async function upPollinateBatchComments(batchId: string, targetTier: number) {
  // Similar logic for batch → tier up-pollination
  // At scale, creates sub-batch hierarchy
}
```

---

## 8. Deep Deliberation UI (Not Feed)

```
┌─────────────────────────────────────────────────────────────────┐
│ DELIBERATION ROOM: "How should we address climate change?"      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ [Your Cell: #47]  [Batch View]  [Tier Synthesis]  [Full History]│
│                                                                 │
├────────────────────────┬────────────────────────────────────────┤
│                        │                                        │
│  IDEAS IN YOUR CELL    │  DISCUSSION STREAM                     │
│  ───────────────────   │  ──────────────────                    │
│                        │                                        │
│  ○ Universal basic     │  @alex: The carbon tax idea is...      │
│    income         [3]  │  Linked: Universal basic income        │
│                        │  [+2] [Reply] [Revision?]              │
│  ● Job guarantee  [2]  │                                        │
│    ← Your vote         │  @sam: But what about rural areas?     │
│                        │  Linked: Job guarantee                 │
│  ○ Carbon dividend [0] │  [+1] [Reply]                          │
│                        │                                        │
│  ○ Green new deal [0]  │  @you: Could combine both approaches   │
│                        │  Linked: Comparing all                 │
│  ○ Do nothing     [0]  │  [+4] TOP COMMENT                      │
│                        │                                        │
│                        │  ─────────────────────────────────     │
│  [Change Vote]         │  [Type...] [Link to: idea]             │
│                        │                                        │
├────────────────────────┴────────────────────────────────────────┤
│                                                                 │
│  UP-POLLINATED INSIGHTS (from your batch - 25 people)           │
│  ───────────────────────────────────────────────────────        │
│                                                                 │
│  "Universal basic income"                                       │
│     "Fund via carbon tax" (Cell 12) - 18 votes                  │
│     "Alaska model works" (Cell 89) - 12 votes                   │
│                                                                 │
│  "Job guarantee"                                                │
│     "More dignified than handouts" (Cell 23) - 15 votes         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Implementation Phases

| Phase | Scope | Description |
|-------|-------|-------------|
| **Phase 1** | Fix existing comments | Basic display, posting works |
| **Phase 2** | Comment voting within cells | Upvote/downvote comments |
| **Phase 3** | Up-pollination to batch level | Top comments advance |
| **Phase 4** | Deep Deliberation Room UI | Dedicated discussion interface |
| **Phase 5** | Revision/adoption system | Comments become idea improvements |
| **Phase 6** | Sub-batching for scale | Handle tier 9 comment volume |
| **Phase 7** | Tier-level synthesis | Full up-pollination chain |

---

## 10. The Vision

```
1,000,000 participants
    ↓
200,000 cell discussions (5 people each having real conversations)
    ↓
40,000 batch syntheses (best comments up-pollinated)
    ↓
8,000 super-batch syntheses
    ↓
~9 tiers of refinement
    ↓
FINAL OUTPUT:
- 1 winning idea (democratically selected)
- ~50 key insights (up-pollinated from 1M voices)
- Full revision history (how the idea evolved)
- Credited contributors at every level

Not just a vote. A genuine collective intelligence.
```

---

## Summary

The up-pollination architecture extends Unity Chant's democratic principle to discussion itself. Just as the best ideas rise through collective judgment, the best insights, criticisms, and improvements also rise. Comments can evolve into revisions, and the final output isn't just a winning idea—it's a winning idea refined by the collective wisdom of all participants, with full attribution and history preserved.
