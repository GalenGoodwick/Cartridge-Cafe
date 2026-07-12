# Unity Chant - Backlog

Captured from session Jan 29, 2026.

---

## Completed

- **Atomic guard on startChallengeRound** - Prevents concurrent duplicate cell creation during challenge transitions.
- **Fix infinite accumulation extension loop** - Capped at 3 extensions when zero challengers appear.
- **Wrap prediction resolution in transactions** - `resolveCellPredictions` and `resolveChampionPredictions` now use `$transaction`.
- **Replace setTimeout grace period** - Removed unreliable `setTimeout` from vote route (doesn't fire on Vercel serverless). Timer processor handles finalization via `finalizesAt` DB field.
- **Secure unauthenticated endpoints** - Added `CRON_SECRET` auth to `/api/cron/tick`, production guard on `/api/test/up-pollination`.
- **Add missing database indexes** - Added indexes on `Deliberation(submissionEndsAt)`, `Deliberation(currentTierStartedAt)`, `Deliberation(phase, createdAt)`, `CellParticipation(userId, status)`.
- **Fix broken dashboard manage link** - Changed from `/dashboard/${d.id}` (404) to `/deliberations/${d.id}`.
- **Replace alert() calls with toast notifications** - Replaced 18 `alert()` calls across 5 components with toast system.
- **Add FollowButton to user profile page** - Created `FollowButton.tsx` with optimistic updates.
- **Add admin user management UI** - Admin users tab with search, status filter, ban/unban/delete actions.

---

## Pending

### Feed Performance
- **Prepopulate feed with cached entries for instant load** - Pre-cache top 10-20 feed items so the feed renders instantly instead of showing a loading spinner. Consider Next.js server components, SWR prefetching, or a global in-memory cache warmed on app start. Target sub-100ms feed rendering.

### Content & Moderation
- **Add content reporting system** - Report button on ideas/comments, API route to store reports, admin view to review flagged content. Needs a `Report` model in schema.

### Deliberation Page
- **Add participant list to deliberation page** - Show who joined a deliberation with avatars/names. Data already available via the members relation.
- **Simplify deliberation page, move extras to separate details page** - The deliberation detail page is too busy. Keep essential UI (voting cells, champion, ideas) on main view. Move predictions, full history, comments panel, tier funnel, and stats to `/deliberations/[id]/details` to save bandwidth.

### Creator Tools
- **Add results export for creators** - "Download Results" button on completed deliberations. Export as CSV with ideas, votes per tier, winner, participant count.

### UX Overhaul (from Jan 29 assessment)
- **Build a landing page** - Currently `/` redirects to `/feed`. New visitors have no context. Need a landing page explaining what Unity Chant is, how it works (3 steps), social proof, and clear CTA.
- **Rename user-facing terminology** - "Cell", "Tier", and idea statuses like "BENCHED"/"RETIRED" are internal jargon. Replace with engaging, state-reflective language. Keep terms like "deliberation" but add friendlier alternatives in casual contexts.
- **Add tooltips for idea status badges** - BENCHED, RETIRED, DEFENDING statuses have no inline explanation. Add help icons or tooltips.
- **Improve retention loop** - Communities exist but aren't woven into the core experience. Feed needs better content for logged-out users. Notification reliability needs work.
