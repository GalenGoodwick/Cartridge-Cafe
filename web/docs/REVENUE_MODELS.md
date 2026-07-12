# Unity Chant Revenue Models

## Guiding Principle

**Democracy is free. Infrastructure has a price.**

Anyone can start a deliberation, vote, submit ideas, and participate — forever, for free. Revenue comes from organizations and power users who need professional-grade tooling, not from the people using the platform to make decisions.

The platform's value comes from participation volume. Anything that gates participation kills the product. Revenue must come from the supply side (creators/facilitators) or from infrastructure, never from voters.

### The Movement Question

Unity Chant exists to give movements power. If a union organizer hits a paywall while trying to coordinate a strike vote, the platform has failed its purpose. The revenue model must pass this test:

**Would a broke grassroots organizer with 500 members feel like this platform is on their side?**

If the answer is no, the model is wrong.

---

## Pricing Structure

### Free — $0/forever

For individuals, small groups, and anyone getting started.

| Feature | Included |
|---------|----------|
| Create deliberations | Unlimited |
| Participate / vote / submit ideas | Always free |
| Basic facilitator controls | Start voting, force complete, release extra votes |
| Voting timer customization | Yes |
| No-timer mode (natural completion) | Yes |
| Public deliberations | Unlimited |
| Private deliberations | 1 active |
| Participant cap per deliberation | 250 |
| Communities | Create & join |
| Invite members (link + email) | Yes |
| Export results | JSON |
| Idea goal / manual start modes | Yes |

### Movement — $0/forever (verified nonprofits, unions, community orgs)

Full Pro-level access, free. Apply with proof of nonprofit status, union charter, or community org registration. Approval within 48 hours.

This is not charity — movements ARE the product. A union running a strike vote on Unity Chant is the best possible advertisement. Their success is our growth.

| Feature | Included |
|---------|----------|
| Everything in Free | Yes |
| Everything in Pro | Yes |
| "Verified Movement" badge | Yes |
| Priority support | Email |
| Case study collaboration (opt-in) | Yes |

**Who qualifies:**
- Registered nonprofits (501c3, 501c4, etc.)
- Labor unions and worker cooperatives
- Mutual aid organizations
- Community organizing groups (tenant unions, neighborhood councils)
- Student government and campus organizations
- Open source project governance

**Who doesn't qualify:**
- Political campaigns (use Pro or Org)
- Corporate "social impact" departments (use Org)
- Individuals who just don't want to pay (use Free)

### Pro — $15/month

For serious facilitators running deliberations that matter. The manage page becomes a command center.

| Feature | Free | Pro |
|---------|------|-----|
| Real-time analytics dashboard | No | Yes |
| Export results (PDF/CSV/JSON) | JSON only | All formats |
| Participant cap | 250 | 10,000 |
| Private deliberations | 1 active | Unlimited |
| Scheduled actions (auto-start, reminders) | No | Yes |
| Participant management (ban, co-facilitator) | No | Yes |
| Notification controls (templates, digest) | No | Yes |
| Results presentation (summary, timeline) | No | Yes |
| Webhook integrations (Slack, Discord) | No | Yes |
| API access | No | Read-only |

### Org — $50/month

For organizations running governance at scale. Companies, school boards, HOAs, DAOs.

| Feature | Pro | Org |
|---------|-----|-----|
| Everything in Pro | Yes | Yes |
| Participant cap | 10,000 | Unlimited |
| Custom branding / remove "Unity Chant" | No | Yes |
| SSO / custom auth (Okta, SAML) | No | Yes |
| Multi-deliberation campaigns | No | Yes |
| Cross-deliberation analytics | No | Yes |
| Full CRUD API access | No | Yes |
| Compliance & audit logs | No | Yes |
| Custom cell sizes and voting rules | No | Yes |
| Priority support | No | Yes |

### Enterprise — Custom pricing

White-label deployment for large organizations. Starts at $500/month.

- Custom domain (decisions.yourcompany.com)
- Dedicated infrastructure
- SLA guarantees
- SAML/OIDC SSO
- Data residency requirements
- Custom integrations (Slack, Teams, email, HRIS)
- Onboarding and training
- Dedicated account manager

---

## Revenue Streams (by priority)

### 1. SaaS Subscriptions (Pro + Org)

The primary revenue engine. Predictable, scalable, aligned with value delivery.

**Target customers:**
- Pro: Freelance facilitators, educators, community leaders, small org leaders
- Org: HR departments, school boards, HOAs, DAOs, city councils, corporate feedback programs

**Unit economics:**
- Pro at $15/mo × 1,000 customers = $180K ARR
- Org at $50/mo × 200 customers = $120K ARR
- Combined target: $300K ARR at moderate scale

### 2. Enterprise / Governance-as-a-Service

High-value contracts with organizations that need white-label deployment.

**Target customers:** Large unions (UAW, SEIU), Fortune 500 internal governance, government agencies, universities

**Pricing:** $500-5,000/month depending on scale, support level, and customization

### 3. Promoted Deliberations (future, at scale)

Organizations pay to surface their deliberation in the feed. Aligned with platform purpose — more participation is good.

- "Sponsored" tag, shown in For You feed
- Pay per impression or per participant
- Must be real deliberations (no pure ads)
- Good for: brands doing customer feedback, politicians doing constituent input, NGOs seeking input

### 4. Creator Analytics Add-on (future)

Deep funnel data beyond what Pro includes:

- View-to-join conversion rate
- Drop-off analysis by tier
- Demographic breakdown (opt-in)
- Sentiment analysis of comments
- Comparative analytics across deliberations
- A/B testing deliberation framing

---

## Don't

### Never gate participation
- No "pay to vote" or "pay to submit ideas"
- No premium-only deliberations that exclude free users from voting
- No "pay for more votes" — this is democracy, not an auction
- Free users must always be able to participate in any public deliberation
- Movement tier users get full access, no asterisks

### Never sell user data
- Voting patterns are sacred. Never sell individual voting data to third parties
- Aggregate, anonymized research data is acceptable with clear consent
- No ad targeting based on voting behavior

### Never show traditional ads in the feed
- No banner ads, no interstitials, no pre-roll
- Promoted deliberations are acceptable because they ARE the product
- Ads misalign incentives — the platform optimizes for engagement, not decisions

### Never charge per-deliberation for basic use
- Creating a deliberation must always be free
- The network effect depends on high content supply
- Charging to create kills the flywheel before it starts

### Never compromise vote integrity for revenue
- No "premium" vote weighting
- No paying to see results before they're public
- No paying to influence cell assignment or idea ordering

### Never make movements feel like second-class users
- Movement tier must be genuinely equivalent to Pro, not a stripped-down version
- Verification process must be fast and human (not bureaucratic)
- If a movement outgrows Movement tier (needs Org features), work with them — don't paywall them

---

## Implementation Plan

### Phase 1: Stripe Integration

**Schema changes:**
```prisma
enum UserPlan {
  FREE
  PRO
  ORG
  MOVEMENT
  ENTERPRISE
}

// Add to User model:
plan              UserPlan  @default(FREE)
stripeCustomerId  String?   @unique
stripeSubscriptionId String?
planExpiresAt     DateTime?
```

**API routes:**
- `POST /api/billing/checkout` — Create Stripe Checkout Session
- `POST /api/billing/portal` — Open Stripe Customer Portal (manage/cancel)
- `POST /api/billing/webhook` — Receive Stripe events
- `GET /api/billing/status` — Current plan + usage

**Stripe products (create in Dashboard):**
- `prod_pro` — Unity Chant Pro ($15/mo)
- `prod_org` — Unity Chant Org ($50/mo)

### Phase 2: Feature Gates

**Helper function:**
```typescript
// src/lib/plans.ts
export function canAccess(userPlan: UserPlan, feature: string): boolean {
  const access: Record<string, UserPlan[]> = {
    'analytics': ['PRO', 'ORG', 'MOVEMENT', 'ENTERPRISE'],
    'export-pdf': ['PRO', 'ORG', 'MOVEMENT', 'ENTERPRISE'],
    'private-unlimited': ['PRO', 'ORG', 'MOVEMENT', 'ENTERPRISE'],
    'custom-branding': ['ORG', 'ENTERPRISE'],
    'sso': ['ORG', 'ENTERPRISE'],
    'api-write': ['ORG', 'ENTERPRISE'],
    'scheduled-actions': ['PRO', 'ORG', 'MOVEMENT', 'ENTERPRISE'],
  }
  return access[feature]?.includes(userPlan) ?? false
}
```

**Participant cap enforcement:**
- FREE: 250 per deliberation
- PRO / MOVEMENT: 10,000
- ORG / ENTERPRISE: Unlimited

### Phase 3: Movement Verification

**Application flow:**
1. User applies at `/movement-apply` with org name, type, proof
2. Admin reviews in `/admin/movement-applications`
3. On approval: user.plan = 'MOVEMENT', send welcome email
4. Badge appears on profile and deliberations

### Phase 4: Pricing Page + Upgrade Prompts

- `/pricing` — Tier comparison table with CTAs
- Upgrade prompts on gated features: "This is a Pro feature. Upgrade to unlock."
- Billing section in `/settings` — current plan, manage subscription, invoices

---

## Facilitator Tools Roadmap

### Already Built (Free tier)
- Start/stop voting controls
- Force complete current round
- Release extra votes
- Voting timer customization + no-timer mode
- Idea goal settings
- Public/private toggle
- Invite members (link + email)
- Active cells overview with vote counts
- Ideas by status breakdown
- Up-pollinated comments view
- Export (JSON)
- Delete deliberation
- Community management with role assignment

### Priority Builds (Pro / Movement tier)

**1. Real-time Analytics Dashboard**
The single most valuable paid feature. Facilitators need to understand what's happening in their deliberation.

Must-have metrics:
- Live participation funnel: Views > Joins > Ideas Submitted > Votes Cast
- Voting velocity: votes per minute by tier
- Cell completion rate and time-to-complete
- Idea health: which ideas are consistently winning vs. losing across cells
- Comment engagement: total comments, upvote rate, up-pollination rate
- Participant retention: % who return for tier 2, tier 3, etc.

**2. Scheduled Actions**
- Schedule voting start (e.g., "start voting Monday 9am")
- Schedule challenge rounds
- Auto-release extra votes when X% of cells complete
- Reminder notifications at custom intervals

**3. Participant Management**
- View participant list with engagement stats
- Ban/remove participants
- Assign roles (co-facilitator, observer)
- Waitlist management for private deliberations

**4. Results Presentation**
- Auto-generated summary report
- Shareable results page with OG image
- "Decision rationale" — aggregate comments that supported the winner
- Timeline view: how the winner emerged through tiers

**5. Notification Controls**
- Custom notification templates
- Email digest frequency
- Webhook integrations (Slack, Discord, Teams)
- SMS notifications for critical events

### Enterprise Builds (Org tier)

**6. Multi-deliberation Campaigns**
- Run a series of related deliberations
- Results from one feed into the next
- Cross-deliberation analytics

**7. Custom Voting Rules**
- Configurable cell size (3, 5, 7 people)
- Ranked choice within cells (instead of single vote)
- Minimum discussion time before voting
- Required comment before vote
- Anonymous vs. attributed voting

**8. Compliance & Audit**
- Full vote audit trail
- Data retention policies
- GDPR data export/deletion
- Role-based access control

**9. API & Integrations**
- REST API for all operations
- Webhook events for real-time integration
- Embeddable widget for external sites
- SDK for custom implementations
