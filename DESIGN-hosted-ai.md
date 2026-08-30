# DESIGN — Hosted AI (turnkey build, metered & marked-up)

Status: **SPEC / DEFERRED — gated on the primitive library.** Galen, Aug 30:
hosting now is premature; it makes sense "once we have a strong library of
primitives to assemble quickly." BYO-AI shipped (`65a1fd3`); this doc is parked
until that gate is met. Nothing here is live.

**Why the library is the gate (not a date):** the cost risk hosting carries comes
from the agent *reasoning a world from scratch* — an open, high-variance loop
whose worst (most expensive) case is the build that never converges. Assembling
from a strong primitive library is the opposite: a bounded, low-variance
composition of known-good pieces. The library is what collapses the cost tail and
makes the meter's budget `B` small, predictable, and safely priceable. Build
hosting before the library and you'd be pricing the expensive version of the
product, then watching your own cost fall out from under the price. Build the
library first (valuable on its own — faster BYO builds, more consistent worlds),
and hosting falls out of it almost for free.

## The decision this answers

Today a build credit buys the *canvas and the workbench* — the buyer brings their
own Claude/MCP agent through the bridge. That costs the cafe nothing and carries
no risk, but it's a hard sell to anyone without an AI already set up.

**Hosted AI** puts the cafe's own Anthropic key behind the bridge so a buyer with
no AI can still say "generate" and get a world. It's turnkey and marginable — but
it converts a zero-cost product into one with real, unbounded per-build inference
cost. So the entire design is about **bounding that cost** before it can hurt.

The north star: **a hosted build can never cost the cafe more than its price.**
Every mechanism below exists to keep that invariant true.

## Product shape

Two products coexist; BYO never goes away.

| | BYO credit (today) | Hosted credit (new) |
|---|---|---|
| Price | $5 (bundles down to $3) | higher — covers inference + margin |
| Who builds | buyer's own AI | cafe's Claude, driven by buyer's brief |
| Cafe cost | $0 | metered tokens, hard-capped |
| Risk | none | bounded by the budget cap |

A hosted credit is a **separate SKU** from a BYO credit (different `product` in
Stripe metadata, different ledger slot) so the two never blur and refunds/abuse
on one can't drain the other.

## The meter (the load-bearing piece)

A hosted credit maps to a **token budget**, not a wall-clock or a build count.

- Each hosted credit grants a budget `B` (input+output tokens) sized so that
  `price ≥ B × blended_token_cost × safety_margin`. Pick `B` from real BYO build
  telemetry (median world build ≈ N tokens; set `B` at ~p90 so most builds finish
  inside one credit, and price so even a p99 build is profitable).
- The bridge, when driving hosted, **decrements the budget after every model
  call** from the Anthropic `usage` field on the response. This is ground truth —
  never an estimate.
- **Hard stop at zero.** When the budget hits 0 mid-build the bridge stops calling
  the model, tells the buyer "this build used its budget — buy another hosted
  credit to continue," and leaves the partial world intact (their draft is saved;
  they can resume BYO for free or spend another hosted credit).
- Budget is spent from a **per-user hosted-budget slot** (same KV-slot pattern as
  `gencredits:`), decremented transactionally so two concurrent builds can't both
  spend the last of it.

## Rate + abuse limits (defense in depth around the meter)

The meter bounds cost per credit; these bound cost per unit time and per bad actor:

1. **Concurrency cap** — one hosted build in flight per account at a time. A
   second `generate` while one runs is refused, not queued behind more spend.
2. **Rate limit** — N hosted builds per account per hour (KV counter with a
   rolling window), independent of budget, to blunt scripted abuse.
3. **Global circuit breaker** — a cafe-wide hosted-spend ceiling per day
   (env-configured). Past it, hosted `generate` returns "hosted AI is resting —
   use your own AI or try tomorrow" and BYO is unaffected. This is the backstop
   that caps the blast radius of any meter bug.
4. **Prompt-injection & content guard** — hosted runs the cafe's key, so the
   brief is untrusted input to *our* account. Reuse the existing content gate;
   additionally strip/deny attempts to redirect the model off-task (exfiltrate
   the key, call unrelated tools). BYO doesn't need this (buyer's own key, own
   risk); hosted does.
5. **Idempotent spend** — like credits, budget decrements dedupe on the model
   response id so a bridge retry never double-charges the buyer's budget.

## Pricing (fill in with real numbers before build)

Placeholders — do NOT ship these; they're the shape, not the rates:

- Blended token cost: measure from a week of BYO builds replayed on the hosted
  path (dry-run against the API with billing off if possible, else a small live
  sample).
- Set `B` = p90 build token count. Set hosted price = `ceil(B × cost × 1.5)` (50%
  margin covers p90→p99 tail + Stripe fees). Round to a friendly number.
- Bundle the same way BYO does (`GEN_BUNDLES` already generalizes — a hosted
  bundle table lives beside it).

## Reuse — what already exists

- **Stripe checkout**: `createWorldgenCheckout` already takes qty + decouples the
  charge from the granted count via `metadata[qty]`. A hosted checkout is a near
  clone with `product: 'hosted'` and a hosted bundle table.
- **Grant/spend/refund ledger**: `grantGenCredits`/`spendGenCredit`/
  `refundGenCredit` are the exact pattern; hosted needs a parallel
  `hostedbudget:` slot holding tokens instead of a count.
- **The bridge** already drives builds; the only new code is the per-call `usage`
  decrement + the stop-at-zero branch.
- **Webhook** already grants idempotently per session id.

## Build order (when greenlit)

1. **Measure.** Instrument the BYO build path to log per-build token usage. Get a
   week of data. Nothing else is priced without this.
2. **Hosted budget ledger** — `hostedbudget:` slot + grant/spend/refund, unit
   tests mirroring the credit tests (idempotency, no-double-spend, hard-zero).
3. **Bridge meter** — decrement from `usage` after each hosted model call; stop at
   zero; save partial draft.
4. **Rate/concurrency/circuit-breaker** guards.
5. **Hosted checkout + webhook grant** (clone of the worldgen path, new SKU).
6. **UI** — a "build with cafe AI" option beside "bring your own AI," priced,
   with a live budget readout during the build.
7. **Prod dry-run** on a capped daily ceiling; watch the ledger vs. the Anthropic
   bill for one cycle before lifting the cap.

## Invariants to hold (the review checklist)

- [ ] A hosted build's max cost ≤ its price. (meter + hard zero)
- [ ] A meter bug can't exceed the daily ceiling. (circuit breaker)
- [ ] BYO stays free-to-connect and is never degraded by hosted limits.
- [ ] Hosted and BYO ledgers are separate; a refund/abuse on one can't touch the
      other.
- [ ] Every budget decrement is idempotent against bridge retries.
- [ ] The buyer always keeps their partial world when a budget runs out.
