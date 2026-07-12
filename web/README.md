# Unity Chant

Collective decision-making for the modern age. Small group deliberation at any scale.

## Overview

Unity Chant is a consensus at scale platform that enables large groups to deliberate meaningfully through small group discussions. Instead of simple voting, participants engage in structured conversations where ideas compete through multiple rounds of evaluation.

### How It Works

1. **Submit Ideas** - All participants can propose solutions, not just react to preset options
2. **Small Groups Deliberate** - Participants are divided into cells of 5, each evaluating 5 ideas
3. **Best Ideas Advance** - Ideas that earn support move to the next tier
4. **Champion Emerges** - Through multiple rounds, the strongest idea wins

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL (Supabase)
- **ORM**: Prisma 7 with `@prisma/adapter-pg`
- **Authentication**: NextAuth.js with Google OAuth
- **Styling**: Tailwind CSS

## Prerequisites

- Node.js 18+
- npm or yarn
- PostgreSQL database (Supabase recommended)
- Google Cloud Console project for OAuth

## Environment Variables

Create a `.env` file in the `/web` directory:

```env
# Database - Use Supabase connection pooler with Session mode (port 5432)
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

# NextAuth
NEXTAUTH_URL="http://localhost:3004"
NEXTAUTH_SECRET="your-secret-key-change-in-production"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Web Push (VAPID keys) - Generate with: npx web-push generate-vapid-keys
VAPID_SUBJECT="mailto:hello@unitychant.com"
VAPID_PUBLIC_KEY="your-vapid-public-key"
VAPID_PRIVATE_KEY="your-vapid-private-key"
```

### Supabase Connection Notes

- Use the **Connection Pooler** URL, not the direct connection
- Use **Session mode** (port 5432), not Transaction mode (port 6543)
- Prisma migrations require Session mode
- URL encode special characters in the password (e.g., `!` becomes `%21`)

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable the Google+ API
4. Go to Credentials > Create Credentials > OAuth Client ID
5. Application type: Web application
6. Add authorized redirect URI: `http://localhost:3004/api/auth/callback/google`
7. Copy Client ID and Client Secret to `.env`

## Installation

```bash
cd web
npm install
```

## Database Setup

```bash
# Push schema to database
npx prisma db push

# Generate Prisma client
npx prisma generate
```

## Running Locally

```bash
npm run dev
```

The app runs on `http://localhost:3004` (configured in package.json)

## Project Structure

```
web/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts    # NextAuth API
│   │   │   ├── deliberations/
│   │   │   │   ├── route.ts                   # List/create deliberations
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts               # Get single deliberation
│   │   │   │       ├── join/route.ts          # Join deliberation
│   │   │   │       ├── ideas/route.ts         # Submit ideas
│   │   │   │       ├── start-voting/route.ts  # Start voting phase
│   │   │   │       └── cells/route.ts         # Get user's cells
│   │   │   └── cells/[cellId]/
│   │   │       ├── vote/route.ts              # Cast vote
│   │   │       └── comments/route.ts          # Cell discussion
│   │   ├── auth/signin/page.tsx               # Sign-in page
│   │   ├── deliberations/
│   │   │   ├── page.tsx                       # Browse deliberations
│   │   │   ├── new/page.tsx                   # Create deliberation
│   │   │   └── [id]/page.tsx                  # Deliberation detail + voting
│   │   ├── demo/page.tsx                      # Automated demo
│   │   ├── whitepaper/page.tsx                # Whitepaper
│   │   └── page.tsx                           # Homepage
│   └── lib/
│       ├── auth.ts                            # NextAuth configuration
│       └── prisma.ts                          # Prisma client with adapter
└── .env                                       # Environment variables
```

## Database Schema

### Core Models

- **User** - Authenticated users
- **Deliberation** - A decision-making session with question and phases
- **DeliberationMember** - User participation in deliberations
- **Idea** - Proposed solutions submitted by participants
- **Cell** - Small groups of 5 participants evaluating 5 ideas
- **CellIdea** - Ideas assigned to a cell
- **CellParticipation** - Users assigned to a cell
- **Vote** - Individual votes within cells
- **Comment** - Discussion messages within cells

### Deliberation Phases

1. `submission` - Participants submit ideas
2. `voting` - Small group deliberation and voting
3. `complete` - Champion determined

## Voting Algorithm

1. **Cell Formation**: When voting starts, participants are divided into cells of 5
2. **Idea Assignment**: Each cell receives 5 ideas to evaluate
3. **Voting**: Each participant votes for their preferred idea
4. **Cell Completion**: When all 5 members vote, results are tallied
5. **Tier Advancement**: Winners advance to next tier, losers are eliminated
6. **Champion**: Process repeats until one idea remains

### Tier System

- **Tier 0**: Initial round with all ideas
- **Tier 1+**: Winners from previous tier compete
- Each tier reduces ideas by ~80% (1 winner per 5 ideas)

## What's Built

- [x] Google OAuth authentication
- [x] Create and browse deliberations
- [x] Join deliberations
- [x] Submit ideas during submission phase
- [x] Cell-based voting engine
- [x] Multi-tier tournament advancement
- [x] Champion determination
- [x] In-cell discussion/chat
- [x] Automated demo page (125 participants simulation)
- [x] Whitepaper page
- [x] Homepage with call-to-action
- [x] PWA support (installable, offline-capable)
- [x] Push notifications when voting starts
- [x] Invite links for sharing deliberations
- [x] Settings page (profile, notification toggle)
- [x] Tags/categories for deliberations with filtering
- [x] Idea accumulation during voting (submit for next round)
- [x] Donate page (placeholder)

## What's Left to Build

### High Priority
- [ ] Email notifications (fallback for users without push)
- [ ] Mobile responsive design improvements
- [ ] Voting timeouts/deadlines with spot reservation
- [ ] Real-time updates (WebSocket or polling)
- [ ] PWA icons (replace placeholders with proper 192x192 and 512x512 PNGs)

### Medium Priority
- [ ] Private deliberations (invite-only)
- [ ] Admin dashboard
- [ ] Idea editing/deletion
- [ ] User profiles
- [ ] Deliberation search and filters
- [ ] Limit ideas per user (1 idea per person, configurable)

### Monetization
- [ ] Stripe integration for payments
- [ ] Subscription management
- [ ] Usage tracking
- [ ] Feature gating by tier

### Advanced Features
- [ ] Rolling/challenge mode (ongoing deliberations) - see design notes below
- [ ] Export results
- [ ] Analytics dashboard
- [ ] API for integrations
- [ ] Multi-language support

---

## Rolling/Challenge Mode (Design Notes)

**Overview:** Allows deliberations to run continuously. After a champion is declared, new ideas accumulate and periodically challenge the champion.

**Flow:**
```
Submission Phase (configurable, e.g. 24hrs)
       ↓ [automatic]
Voting Tiers (configurable per-cell timeout, e.g. 1hr)
       ↓ [automatic]
Champion Declared
       ↓ [automatic]
Accumulation Phase (configurable, e.g. 7 days)
  - New ideas submitted during this time
  - Champion holds position
       ↓ [automatic when enough ideas OR time elapsed]
Challenge Round
  - New ideas compete against champion
  - Champion enters at higher tier (advantage)
       ↓ [repeat]
```

**User-configurable settings:**
- `submissionDurationMs` - How long to collect initial ideas
- `votingTimeoutMs` - How long each cell has to vote
- `accumulationTimeoutMs` - How long between challenge rounds
- `accumulationEnabled` - Toggle rolling mode on/off

**Core files:**
- `prisma/schema.prisma` - Deliberation model already has timer fields (`submissionDurationMs`, `votingTimeoutMs`, `accumulationTimeoutMs`, `submissionEndsAt`)
- `src/app/api/deliberations/[id]/start-voting/route.ts` - Current voting logic to extend

**Technical approach:**
1. Store deadlines as timestamps in database (already have fields)
2. Check deadlines on every API request ("lazy evaluation")
3. Optional: Vercel Cron or external cron hits `/api/cron/process-timers` every minute as backup
4. Process any expired phases automatically

**Implementation steps:**
1. Create `/api/cron/process-timers` endpoint
2. Add deadline checking to deliberation API calls
3. Implement `processExpiredSubmission()` - auto-start voting
4. Implement `processExpiredCells()` - auto-complete cells, advance tiers
5. Implement `processExpiredAccumulation()` - start challenge round
6. Update deliberation creation UI with timer settings
7. Add visual countdown timers to UI

**Accumulation rules:**
- "Submit for Next Round" only appears for users NOT participating in the current voting session
- Users who ARE in the current session can submit new ideas during the regular accumulation window after a champion is declared
- Stalled voting: Need a timer that allows second/additional votes when cell voting progress stalls (e.g., waiting too long for remaining voters)

**Stalled voting timer:**
- If a cell has partial votes and remaining voters haven't acted within timeout
- Options: (a) auto-advance with current votes, (b) allow voted members to vote again, (c) replace inactive voters
- Needs further design discussion

**Active user tracking:**
- Track number of active users in a deliberation
- Track push notification status (counting down until someone responds to vote)
- Use this data to decide:
  - Backfill with new joiner if a slot opens (voter inactive/unresponsive)
  - Tell new joiners "no slots available" if all participants are active
- Could use: last activity timestamp, notification sent timestamp, notification acknowledged flag

**Stalled deliberation handling:**
- Auto-inactivate deliberations if participation stalls so badly it can't reach a champion (or new champion in rolling mode)
- Criteria: No votes cast within X days, insufficient active users to form cells
- Mark as `STALLED` or `INACTIVE` status (distinct from `COMPLETED`)
- Potential monetization: Sell "boosts" to keep stalled deliberations active or revive them

**Idea elimination tracking:**
- Track how many times an idea loses in Tier 1
- After 2 losses at Tier 1, idea is permanently eliminated (`status: 'RETIRED'`)
- Prevents weak ideas from cycling forever
- Need `tier1Losses` counter on Idea model

**Insufficient challengers problem:**
- Solution: Only retire as many ideas as the system can afford
- Calculate minimum ideas needed to reach champion's tier (e.g., Tier 2 needs 5+ ideas)
- After Tier 1 voting, sort losers by `tier1Losses` count
- Retire only those with 2+ losses AND only if it won't drop below minimum threshold
- Ideas with 2 losses but "protected" by threshold stay in pool with `status: 'BENCHED'`
- This ensures there are always enough challengers to reach the champion
- Natural pressure: as new ideas accumulate, benched ideas with 2 losses get retired first

---

## Monetization (Planned)

**Model:** Public good with optional paid privacy

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0 | Public deliberations (visible to all, anyone can join) |
| **Pro** | TBD/mo | Private deliberations (invite-link only, for institutions/corps) |

**Donations:** Separate page for supporters who believe in the mission (not tied to features)

**Philosophy:** Collective decision-making should be free and accessible. Privacy is the premium feature for organizations.

## Key Technical Decisions

### Prisma 7 Adapter Pattern

Prisma 7 removed the `datasources` property. The client must be initialized with an adapter:

```typescript
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
export const prisma = new PrismaClient({ adapter })
```

### Next.js 15 Route Params

Route params are now async and must be awaited:

```typescript
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // ...
}
```

## Troubleshooting

### Database Connection Failed (P1001)
- Verify DATABASE_URL uses the connection pooler, not direct connection
- Ensure you're using port 5432 (Session mode)
- Check that the password is URL-encoded

### Prisma Client Error
- Run `npx prisma generate` after schema changes
- Ensure `@prisma/adapter-pg` and `pg` are installed

### OAuth Redirect Error
- Verify redirect URI in Google Cloud Console matches exactly
- Include the full path: `http://localhost:3004/api/auth/callback/google`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT
