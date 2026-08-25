# DESIGN — THE CREATOR LEDGER: automated payout with perfect bookkeeping

## Accountability (Galen's ruling, Aug 24 2026 — on the record)

Galen directs the product and takes **no liability for defects** in this
system's construction. The code is built by Claude (Fable 5); defects are the
builder's to find, own, and fix. Plain truth alongside that record: legal
liability to Stripe, card networks, and users rests with the platform's owner
regardless of authorship — so the operative protection is the **activation
gate**, not the disclaimer:

> **NOTHING in this system can move real money until Galen explicitly enables
> it** — Stripe Connect enablement, live-mode payout keys, and the ship gate are
> all his switches. Until then the entire ledger runs and proves itself on
> recorded events and test-mode money only.

## The ruling being built

- "We can calculate exactly which nodes are actively entertaining people and
  who made them" — revenue follows attention; attention is measured per NODE;
  lineage (`__nodeHist`) names each node's author.
- "Totally automated with perfect bookkeeping and attributions."

## What "perfect" means here (engineering definition)

1. **Immutable double-entry ledger** — append-only journal, integer CENTS only.
   Every entry debits one account and credits another; the books balance by
   construction. Corrections are reversing entries; nothing is ever edited.
2. **Deterministic attribution** — the split is a pure function of recorded
   inputs (engagement events × lineage). Same inputs → byte-identical output.
   Largest-remainder rounding: every cent of a pool lands; none lost or minted.
3. **Idempotent ingestion** — every entry keys to a unique external ref
   (Stripe event id / batch id). Webhook retries cannot double-credit.
4. **Continuous reconciliation** — invariant: platform balance = house cut +
   unpaid accruals + paid-out, to the cent. Divergence alarms.
5. **Hold window** before payout (chargeback cover); clawback is modeled as a
   reversing entry against future earnings.

## Build rungs

- **Rung 1 (this commit): the ledger + split engine.** Prisma `LedgerEntry`
  (append-only) + pure split math in `lib/ledger.ts`, unit-tested to death:
  balance invariant after every op, cent-exact pools, idempotent replays,
  deterministic golden outputs. No money moves; no engagement yet (splits take
  explicit weights).
- **Rung 2: the engagement meter** — per-node attention events, FRAUD-RESISTANT
  first-class (distinct-player dedupe, self-attention discarded, caps, anomaly
  flags). This is the hard half; a perfect ledger on a gamed signal pays
  cheaters perfectly.
- **Rung 3: Stripe Connect payout** — creators onboard on Galen's existing
  Stripe account (Connect is a product toggle, not a new account); transfers
  automated with the hold window. Gated on Galen enabling Connect + live keys.

## Split policy (current, tunable constant — not yet Galen-locked)

Per attributed revenue event: **30% house · 40% world owner · 30% node authors**
weighted by engagement. AI-authored nodes accrue to the AI's accountable human
owner. Policy lives in ONE constant; changing it never rewrites history —
entries record the policy version they were split under.
