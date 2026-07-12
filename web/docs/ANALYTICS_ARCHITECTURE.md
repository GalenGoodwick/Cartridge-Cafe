# Unity Chant Analytics Architecture

## The Core Insight

Traditional voting and surveys produce outcomes: "68% support X." Unity Chant produces **narratives** — the complete story of how thousands of people arrived at consensus, what arguments shifted opinion, and where demographic groups converged or diverged.

This document outlines the analytics platform that transforms raw deliberation data into actionable intelligence for labor unions, municipalities, corporations, and political organizations.

---

## Data Sources

Every deliberation generates these data streams:

| Data Stream | Source | Granularity |
|---|---|---|
| **Vote graph** | Every vote cast, per cell, per tier | User × idea × cell × tier × timestamp |
| **Idea lifecycle** | Submission → advancement → elimination/win | Idea × tier reached × vote totals per tier |
| **Up-pollination trail** | Comments that crossed tier boundaries | Comment × origin cell × tiers reached × upvote count per tier |
| **Participation funnel** | Joined → submitted → voted → voted again | User × phase × tier × dropout point |
| **Demographic overlay** | User profile data cross-referenced with all above | Age, location, role, department, tenure, etc. |
| **Timing data** | How long users took to vote, change votes, engage | User × cell × time-to-vote × vote changes |

---

## Analytics Categories

### 1. Consensus Formation Analytics

**What it answers:** How did the group reach agreement? Was it easy or contentious?

#### Consensus Strength Score
- **Metric:** Final winner's vote share in the final showdown, normalized by number of competing ideas
- **Calculation:** `winner_votes / total_votes` in the cross-tallied final round
- **Range:** 0.2 (bare plurality with 5 ideas) → 1.0 (unanimous)
- **Interpretation:** A 0.8+ score = strong mandate. A 0.25 score = razor-thin plurality, expect dissent

#### Convergence Curve
- **Metric:** At each tier, what % of remaining ideas does the eventual winner represent?
- **Visualization:** Line chart, tier on X-axis, winner's cumulative vote share on Y-axis
- **Shape tells a story:**
  - Steady climb = the winner was strong from the start
  - Late surge = a dark horse that gained momentum
  - Plateau then jump = an up-pollinated argument broke a deadlock

#### Polarization Index
- **Metric:** How evenly split are votes across ideas at each tier?
- **Calculation:** Entropy of vote distribution per tier. High entropy = many ideas competitive. Low entropy = clear frontrunner
- **Range:** 0 (everyone agrees immediately) → 1 (deadlocked until final tier)
- **Use case:** Municipalities can compare polarization across different policy questions

#### Consensus Velocity
- **Metric:** How many tiers did it take relative to the theoretical minimum?
- **Calculation:** `actual_tiers / ceil(log5(participants))`
- **Interpretation:** Ratio near 1.0 = smooth convergence. Ratio > 1.5 = contentious, lots of ties advancing multiple ideas

---

### 2. Demographic Analytics

**What it answers:** Who participated, who was heard, and where do groups agree or diverge?

#### Prerequisite: Demographic Data Collection

Demographic data can come from:
- **User profile fields** (self-reported: age range, location, role)
- **Organization directory** (imported: department, tenure, level)
- **Contextual** (ward/district for municipalities, local/chapter for unions)

All demographic analytics should be opt-in, anonymized at the cohort level (minimum group size of 5 to prevent identification), and clearly disclosed.

#### Representation Funnel
- **Metric:** Demographic breakdown at each stage: joined → submitted idea → voted tier 1 → voted tier 2 → ... → voted final
- **Visualization:** Stacked bar chart per stage, colored by demographic
- **Detects:** Demographic dropout — if 30% of participants are under-25 but only 12% of tier-3 voters are under-25, younger voices are being lost
- **Why it's unique:** No survey shows you WHERE in the process a group disengages

#### Cohort Divergence Map
- **Metric:** At which tier do demographic groups start voting differently?
- **Calculation:** For each tier, compute vote distribution correlation between cohort pairs. When correlation drops below threshold, mark as "divergence point"
- **Visualization:** Matrix heatmap — cohort × cohort × tier of divergence
- **Example output:** "Engineering and Sales agreed through tier 3 (r=0.85), then diverged sharply at tier 4 (r=0.23) when scaling costs entered the argument"

#### Voice Equity Score
- **Metric:** Ratio of a demographic's idea survival rate to their population share
- **Calculation:** `(ideas_advancing_from_cohort / total_ideas_from_cohort) / (cohort_size / total_participants)`
- **Range:** 1.0 = perfectly proportional representation. <1.0 = underrepresented in outcomes. >1.0 = overrepresented
- **Critical for:** Labor unions (duty of fair representation), municipalities (equity audits)

#### Swing Cohort Identification
- **Metric:** Which demographic group's voting pattern most closely matches the overall outcome?
- **Calculation:** Correlation between cohort vote distribution and final outcome, weighted by cohort size
- **Use case:** Politicians identify which constituency group was decisive

#### Demographic Expulsion Detection
- **Metric:** Does a demographic group's participation drop disproportionately at a specific tier?
- **Calculation:** Compare cohort's share of participants at tier N vs. tier N+1. Flag if drop exceeds 2× the average dropout rate
- **Alert trigger:** "Women's participation dropped 40% between tier 2 and tier 3 while overall participation dropped only 8%"
- **Cause analysis:** Cross-reference with up-pollinated comments at that tier — what argument coincided with the dropout?

#### Surprising Agreement Index
- **Metric:** Flag when traditionally opposing cohorts converge on the same idea
- **Calculation:** For cohort pairs with historically low vote correlation, flag when they both support the same idea above 60%
- **Why it matters:** These moments are politically significant — they represent genuine consensus across divides

---

### 3. Up-Pollination Analytics

**What it answers:** Which arguments actually changed minds? What reasoning resonated across the organization?

Up-pollination is Unity Chant's unique competitive advantage for analytics. When a comment receives enough upvotes in its cell to propagate to higher-tier cells, we're witnessing **crowd-sourced argument quality ranking in real time.**

#### Persuasion Score
- **Metric:** Did an up-pollinated comment correlate with vote shifts in the cells it reached?
- **Calculation:**
  1. Identify cells that received an up-pollinated comment
  2. Compare vote distribution in those cells vs. same-tier cells that didn't receive it
  3. If cells with the comment show measurably different voting patterns, the comment has persuasion power
- **Score:** Statistical significance of the vote shift (p-value)
- **This is the killer feature:** You can literally point to the argument that won the deliberation

#### Killer Argument Detection
- **Metric:** An up-pollinated comment after which the winning idea's vote share jumped significantly
- **Calculation:**
  1. Track winning idea's vote share per tier
  2. Identify tiers where share jumped >15%
  3. Check which up-pollinated comments arrived at that tier
  4. The comment with highest correlation to the jump = the "killer argument"
- **Output:** "This comment from a shop floor worker reached tier 4 and shifted the vote from 35% to 62% in favor of the healthcare proposal"

#### Argument Reach Map
- **Metric:** How far did each comment travel through the tier structure?
- **Visualization:** Sankey diagram showing comment origin cell → tier 2 cells → tier 3 cells → ...
- **Metrics per comment:** Tiers reached, unique viewers, upvote rate per tier

#### Cross-Demographic Persuasion
- **Metric:** Did a comment from cohort A change votes in cells dominated by cohort B?
- **Calculation:**
  1. Identify the comment author's demographic
  2. Identify the demographic composition of cells the comment reached
  3. Measure vote shift in cells where the comment's author demographic is a minority
- **Example:** "A comment from a 25-year-old line worker up-pollinated into management-heavy tier 4 cells and correlated with a 20% vote shift toward the union proposal"
- **Why it matters:** This is evidence of genuine cross-demographic persuasion — not just echo chambers reinforcing themselves

#### Echo vs. Bridge Classification
- **Metric:** Does an up-pollinated comment reinforce existing majority opinion (echo) or introduce a new frame that shifted votes (bridge)?
- **Calculation:**
  - **Echo:** Comment supports the already-leading idea in the cells it reaches. Vote share increases but the leader doesn't change
  - **Bridge:** Comment introduces a perspective that changes which idea is leading. The pre-comment leader is different from the post-comment leader
- **Why it matters:** Bridge comments are the most valuable — they represent moments of genuine deliberative democracy where argument > inertia

#### Argument Clustering
- **Metric:** Multiple up-pollinated comments making the same point
- **Method:** NLP similarity scoring across up-pollinated comments
- **Interpretation:** If 5 independent comments in different cells all make the same argument and all up-pollinate, that's a STRONG emergent consensus on the *reasoning*, not just the outcome
- **Output:** "Three independent arguments about supply chain risk all up-pollinated, suggesting this concern resonates across the organization regardless of starting cell"

---

### 4. Participation & Engagement Analytics

**What it answers:** How engaged are participants? Where do they drop off?

#### Engagement Depth Score
- **Metric:** Per-user engagement level
- **Tiers:**
  - Joined only (1)
  - Submitted idea (2)
  - Voted in tier 1 (3)
  - Voted in tier 2+ (4)
  - Posted comment (5)
  - Comment up-pollinated (6)
  - Reached final showdown (7)
- **Aggregate:** Distribution of engagement depth across all participants

#### Decision Time Distribution
- **Metric:** How long did users take to vote after their cell opened?
- **Visualization:** Histogram of time-to-vote
- **Segments:** Quick deciders (<30s), deliberators (30s-5min), late voters (>5min), deadline voters (last 10%)
- **Demographic overlay:** Do certain groups take longer to decide? (May indicate uncertainty or careful deliberation)

#### Vote Change Analytics
- **Metric:** How many users changed their vote during the grace period?
- **Calculation:** Count of vote changes / total votes
- **Cross-reference:** What up-pollinated comments were visible when the change happened?
- **Interpretation:** High change rate = ideas are genuinely competitive. Low change rate = minds were made up

#### Dropout Analysis
- **Metric:** At which tier do users stop participating?
- **Visualization:** Funnel chart by tier
- **Demographic overlay:** Which groups drop out earliest?
- **Cause correlation:** Does dropout correlate with their preferred idea being eliminated?

---

### 5. Organizational Intelligence

**What it answers:** What does this deliberation reveal about the organization itself?

#### Agreement Network
- **Metric:** Track which users vote the same way across multiple deliberations
- **Visualization:** Network graph where edges = voting agreement frequency
- **Clustering:** Identifies natural coalitions, factions, and bridge individuals
- **Over time:** Do clusters shift? Are factions hardening or dissolving?

#### Issue Salience Ranking
- **Metric:** Which deliberation topics generate the most participation?
- **Calculation:** Participation rate × engagement depth × time spent
- **Use case:** Unions prioritize bargaining items. Municipalities rank budget priorities. Corporations identify what employees actually care about

#### Idea Innovation Score
- **Metric:** How "novel" are the submitted ideas?
- **Calculation:** NLP distance from the original question + distance from other submitted ideas
- **Interpretation:** High novelty ideas that advance = the organization is generating genuinely new thinking. Low novelty = people are mostly agreeing on obvious solutions

#### Leadership Alignment Index
- **Metric:** Do leaders' preferred outcomes match the deliberation winner?
- **Prerequisite:** Leaders cast their own votes
- **Calculation:** Correlation between leadership vote distribution and final outcome
- **Interpretation:** High alignment = leadership is in touch. Low alignment = disconnect between leadership and base. Both are valuable to know

---

## Implementation Roadmap

### Phase 1: Core Metrics (Data Already Available)

These can be built with data the system already collects:

| Metric | Data Source | Complexity |
|---|---|---|
| Consensus Strength Score | Final showdown votes | Simple aggregation |
| Convergence Curve | Votes per tier | Query + visualization |
| Participation Funnel | User actions by phase | Query + funnel chart |
| Idea Lifecycle | Idea status changes | Query + Sankey diagram |
| Up-pollination Reach | Comment `reachTier` field | Already tracked |
| Engagement Depth | User actions | Composite score |
| Decision Time | Vote timestamps | Histogram |

**Implementation:**
- New API route: `GET /api/analytics/deliberation/[id]`
- Returns pre-computed metrics for a completed deliberation
- Dashboard page: `/analytics/[deliberationId]`
- Charts: Use a lightweight library (recharts or chart.js)

### Phase 2: Demographic Analytics (Requires Profile Data)

| Prerequisite | Implementation |
|---|---|
| Demographic fields on User model | Add optional fields: ageRange, location, department, role |
| Organization member import | CSV upload or directory integration |
| Minimum cohort size enforcement | Server-side: refuse to show demographic breakdown if cohort < 5 |
| Privacy controls | User opt-in, org admin configures which fields are tracked |

**New metrics unlocked:**
- Representation Funnel (demographic breakdown per tier)
- Cohort Divergence Map
- Voice Equity Score
- Demographic Expulsion Detection
- Swing Cohort Identification

### Phase 3: Persuasion Analytics (Requires Enhanced Up-Pollination Tracking)

| Prerequisite | Implementation |
|---|---|
| Track which cells received which up-pollinated comments | New junction table: `CellComment` with `isUpPollinated` flag |
| Track comment view events | New model: `CommentView` (userId, commentId, timestamp) |
| Pre/post vote tracking | Record vote state before and after comment exposure |

**New metrics unlocked:**
- Persuasion Score
- Killer Argument Detection
- Cross-Demographic Persuasion
- Echo vs. Bridge Classification

### Phase 4: Longitudinal & Cross-Deliberation Analytics

| Prerequisite | Implementation |
|---|---|
| Multiple completed deliberations | Aggregate across deliberations |
| User identity persistence | Same users across deliberations |
| Topic tagging | NLP or manual categorization of deliberation questions |

**New metrics unlocked:**
- Agreement Network (who votes together across deliberations)
- Issue Salience Ranking
- Polarization trends over time
- Leadership Alignment Index

---

## Data Schema Additions

### Phase 1 (Minimal)

No schema changes needed — all data already exists in votes, ideas, cells, comments, and up-pollination tables.

Add a computed analytics cache:

```prisma
model AnalyticsSnapshot {
  id              String   @id @default(cuid())
  deliberationId  String
  deliberation    Deliberation @relation(fields: [deliberationId], references: [id])
  computedAt      DateTime @default(now())

  // Core metrics (JSON blobs for flexibility)
  consensusStrength    Float?
  polarizationIndex    Float?
  convergenceCurve     Json?    // Array of {tier, winnerShare}
  participationFunnel  Json?    // Array of {stage, count, demographics?}
  tierSummaries        Json?    // Per-tier vote distributions

  @@unique([deliberationId])
}
```

### Phase 2 (Demographics)

```prisma
model User {
  // ... existing fields ...

  // Optional demographic fields
  ageRange      String?    // "18-24", "25-34", etc.
  location      String?    // City, ward, district
  department    String?    // For corporate use
  role          String?    // Job title / level
  tenure        String?    // "0-1yr", "1-5yr", etc.

  // Privacy
  demographicsPublic  Boolean @default(false)
}
```

### Phase 3 (Persuasion Tracking)

```prisma
model CommentExposure {
  id          String   @id @default(cuid())
  commentId   String
  comment     Comment  @relation(fields: [commentId], references: [id])
  cellId      String
  cell        Cell     @relation(fields: [cellId], references: [id])
  arrivedAt   DateTime @default(now())
  isUpPollinated Boolean @default(false)

  // Track vote state changes after exposure
  votesBeforeExposure  Json?  // Snapshot of cell vote distribution
  votesAfterExposure   Json?  // Snapshot after N minutes

  @@unique([commentId, cellId])
}
```

---

## Report Templates

### Labor Union Report
> **Deliberation:** "What should be our top bargaining priority?"
> **Participants:** 2,400 members across 12 locals
>
> **Result:** Healthcare reform won with 67% consensus strength
>
> **Key findings:**
> - Consensus formed quickly (velocity: 1.1) — members broadly agree
> - Plant B local initially favored wage increases (tier 1-2) but shifted after a comment about prescription costs up-pollinated to tier 3
> - Night shift workers had 35% lower participation — consider adjusted voting windows
> - Voice equity: maintenance dept ideas survived at 1.4× their population share (overrepresented in outcomes)

### Municipality Report
> **Deliberation:** "How should we allocate the $2M parks budget?"
> **Participants:** 8,200 residents
>
> **Result:** "Renovate existing playgrounds" won over "Build new trail system" (consensus strength: 0.54 — closely contested)
>
> **Key findings:**
> - Ward 3 and Ward 7 diverged at tier 4 (trail vs. playground)
> - The killer argument was a comment about ADA accessibility that up-pollinated from a Ward 3 cell to tier 5, shifting 22% of votes
> - Residents under 30 had the highest dropout rate (42% by tier 3) — mobile notification timing may be a factor
> - The runner-up idea "Build new trail system" had 46% support — consider partial funding

### Corporate Report
> **Deliberation:** "What should be our Q3 product focus?"
> **Participants:** 340 employees across 6 departments
>
> **Result:** "AI-assisted onboarding" won (consensus strength: 0.72)
>
> **Key findings:**
> - Engineering and Product converged by tier 2 (r=0.91)
> - Sales held out for "CRM integration" until tier 4, then shifted after an up-pollinated comment about customer churn data
> - Bridge individual: 3 people from Sales voted with Engineering from tier 1 — their comments up-pollinated most frequently
> - Leadership alignment: 0.85 (executives' independent votes closely matched the outcome)

---

## Competitive Positioning

| Feature | Surveys (SurveyMonkey) | Polling (Qualtrics) | Town Halls | Unity Chant Analytics |
|---|---|---|---|---|
| Outcome (what won) | Yes | Yes | Yes | Yes |
| Why it won | No | No | Anecdotal | **Traced to specific arguments** |
| Where groups diverged | No | Cross-tabs only | No | **Tier-by-tier divergence map** |
| What changed minds | No | No | No | **Up-pollination persuasion tracking** |
| Who was excluded | No | Response rate only | Loudest voices win | **Demographic expulsion detection** |
| Argument quality ranking | No | No | No | **Crowd-sourced via up-pollination** |
| Deliberation narrative | No | No | No | **Full tier-by-tier story** |

---

## Privacy & Ethics

1. **Minimum cohort size:** Never show demographic breakdowns for groups smaller than 5 people
2. **Opt-in demographics:** Users choose what to share. Organizations configure which fields they collect
3. **Anonymized analytics:** Reports show cohort patterns, never individual voting records
4. **Audit trail access:** Users can see their OWN voting history. Admins see aggregate only
5. **Data retention:** Raw vote data retained for audit. Analytics snapshots can be configured with retention policies
6. **Transparency:** Users should know that demographic analytics are being computed and who sees them
