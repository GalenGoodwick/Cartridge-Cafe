# Meta-Deliberation System

## Concept

One central, recurring deliberation: **"What should we decide next?"**

When a champion is crowned, it automatically spawns as a real deliberation with built-in participants.

---

## Flow

```
┌─────────────────────────────────────────────────────────┐
│  META-DELIBERATION: "What should we decide next?"       │
│                                                         │
│  Ideas submitted:                                       │
│  - "Should we have a 4-day work week?"                 │
│  - "How do we reduce housing costs?"                   │
│  - "What's the best way to organize a union?"          │
│                                                         │
│  Voting happens through tiers...                        │
│                                                         │
│  CHAMPION: "Should we have a 4-day work week?"         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  AUTO-SPAWNED DELIBERATION                              │
│                                                         │
│  Question: "Should we have a 4-day work week?"         │
│                                                         │
│  Auto-joined: Everyone who voted for this idea         │
│  Phase: SUBMISSION (accepting ideas/arguments)         │
│                                                         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  NEW META-DELIBERATION STARTS                           │
│                                                         │
│  "What should we decide next?"                         │
│  (Cycle repeats daily/weekly)                          │
└─────────────────────────────────────────────────────────┘
```

---

## Schema Changes

```prisma
model Deliberation {
  // ... existing fields ...

  // Meta-deliberation fields
  type              DeliberationType @default(STANDARD)
  spawnedFromId     String?          // Parent meta-deliberation
  spawnedFrom       Deliberation?    @relation("SpawnedFrom", fields: [spawnedFromId], references: [id])
  spawnedChildren   Deliberation[]   @relation("SpawnedFrom")
  autoJoinVoters    Boolean          @default(false)  // Join voters for winning idea

  // For recurring meta-deliberations
  isRecurring       Boolean          @default(false)
  recurringSchedule String?          // e.g., "daily", "weekly"
  nextOccurrence    DateTime?
}

enum DeliberationType {
  STANDARD      // Normal deliberation
  META          // "What should we decide next?"
  SPAWNED       // Auto-created from meta winner
}
```

---

## Auto-Spawn Logic

When a META deliberation completes:

```typescript
async function handleMetaChampion(deliberationId: string, championIdea: Idea) {
  // 1. Create new deliberation from champion
  const newDeliberation = await prisma.deliberation.create({
    data: {
      question: championIdea.text,
      description: `This topic was chosen by the community in the daily deliberation.`,
      type: 'SPAWNED',
      spawnedFromId: deliberationId,
      autoJoinVoters: true,
      isPublic: true,
      creatorId: championIdea.authorId,  // Original proposer becomes creator
    },
  })

  // 2. Auto-join everyone who voted for this idea
  const voters = await prisma.vote.findMany({
    where: { ideaId: championIdea.id },
    select: { userId: true },
  })

  await prisma.deliberationMember.createMany({
    data: voters.map(v => ({
      deliberationId: newDeliberation.id,
      userId: v.userId,
      role: 'PARTICIPANT',
    })),
    skipDuplicates: true,
  })

  // 3. Start new meta-deliberation for next cycle
  if (isRecurring) {
    await createNextMetaDeliberation()
  }

  // 4. Notify participants
  await notifyParticipants(newDeliberation.id,
    `The community chose: "${championIdea.text}" - Join the deliberation!`
  )
}
```

---

## The Daily Cycle

```
Day 1, 00:00  →  Meta-deliberation starts: "What should we decide next?"
Day 1, 00:00-20:00  →  Submission phase (20 hours)
Day 1, 20:00-24:00  →  Voting phase (4 hours)
Day 2, 00:00  →  Champion crowned, new deliberation spawns
Day 2, 00:00  →  New meta-deliberation starts
```

---

## UI Changes

### Homepage
```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  🔥 TODAY'S QUESTION                                   │
│  "What should we decide next?"                         │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 127 ideas submitted  •  2,341 participants      │   │
│  │ Voting ends in 3h 24m                           │   │
│  │                                                 │   │
│  │ [Join the Discussion]                           │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  ACTIVE DELIBERATIONS                                   │
│  (spawned from previous winners)                        │
│                                                         │
│  • "Should we have a 4-day work week?" - 892 members   │
│  • "How do we make housing affordable?" - 654 members  │
│  • "Best tactics for union organizing?" - 423 members  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Monetization Integration

### Free Users
- Participate in daily meta-deliberation
- Join spawned deliberations
- Submit ideas, vote, discuss

### Creator Tier ($5/mo)
- Create your own deliberations (bypass the queue)
- Your deliberations appear in "Community Created" section
- Priority support

### Enterprise ($2,000-5,000)
- Private instance
- Custom branding
- User management / SSO
- Geographic or org-based access control
- Analytics dashboard
- Dedicated support

---

## Implementation Steps

1. **Schema**: Add `type`, `spawnedFromId`, `isRecurring` fields
2. **Spawn logic**: Create `handleMetaChampion()` function
3. **Cron job**: Daily job to start new meta-deliberation
4. **Homepage**: Featured "Today's Question" section
5. **Notifications**: Alert voters when their topic wins
6. **Creator tier**: Paywall for direct deliberation creation
7. **FREE TIER PERMISSIONS**: Set up permissions for free users (see TODO below)

---

## TODO: Free Tier Permissions

**IMPORTANT:** Must define and implement permissions for free users before launch.

### Free Tier Should Allow:
- [x] Participate in daily meta-deliberation
- [x] Join spawned deliberations
- [x] Submit ideas to deliberations
- [x] Vote in cells
- [x] Comment on ideas
- [ ] **Rate limit:** Max ideas per deliberation (e.g., 3?)
- [ ] **Rate limit:** Max deliberations joined (unlimited?)
- [ ] **Auth required:** Must be logged in to participate

### Free Tier Should NOT Allow:
- [ ] Create standalone deliberations (Creator tier: $5/mo)
- [ ] Private deliberations (Creator/Enterprise tier)
- [ ] Custom timer settings (Creator tier)
- [ ] Analytics access (Enterprise tier)

### Implementation Tasks:
- [ ] Add `canCreateDeliberation` permission check
- [ ] Add middleware to block `/deliberations/new` for free users
- [ ] Show upgrade prompt when free users try to create
- [ ] Track subscription status in User model

---

## Open Questions

- How long should each phase of the meta-deliberation be?
- Should there be multiple meta-deliberations for different categories?
- What happens to deliberations that complete? Archive? Delete after X days?
- Should the meta-deliberation have accumulation mode (rolling challenges)?
