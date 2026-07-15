# THE VOTE — design plan

**cartridge.cafe · the Unity Chant tournament as a serious mechanic**

Status: spec locked · unbuilt · Owner: Galen · Consequence: irreversible

Not a like button. The Vote is the platform's judge of what's worth playing — the
Unity Chant tournament run for real. It measures genuine attention, sorts the
world, and it can cost a player their account.

---

## 00 · The gate

Shown before a player may enter the Vote for the first time — accept-to-continue.
It is the spec made visible: nobody is enforced against a rule they weren't first
shown.

> **DO NOT ENTER BEFORE READING.**
> This is not a like button. It is a serious dynamic, and it can cost you your account.
>
> **A cell is 60 minutes.** It holds several worlds. The moment you play *any* of
> them, the cell is *yours* — you must give real time to *all* of them. Skip games
> and your score is wrecked.
>
> **Two scores.** *XP* — up to 60, one point per minute actually played. *Vote* —
> up to 100, your interest. Play buys standing; the vote sorts what everyone sees first.
>
> **Your freedom.** Never touch a world and you leave freely for a new cell. Lock in
> a vote anytime to move on. Review as many cells as you like, loop on yourself.
> Abandon without voting and your play time still counts.
>
> **The violation.** Leaving a cell you have *played* without giving time to each
> game. First offense: a warning strike. Second live strike: **your account is deleted.**
>
> **The work survives you.** Any world that won — or that even one person enjoyed —
> stays, even if its maker is banned. A ban ends a person, never their world.
>
> **Enter only if you accept this.**

---

## 01 · The prime cell (the Unity Chant engine)

Every cell is a copy of one thing. Unity Chant is not a voting app — it is a
**cognitive architecture**, and the cell is its atom.

A cell gathers participants — each entering through their own *eye*, one seat each —
around a set of contenders. They do not poll; they **deliberate under elimination**.
Contenders compete, losers are forgotten, and a **champion** surfaces by *adversarial
consensus* — the survivor of pressure, not the average of opinion. Champions climb
*tiers*; forced rotation keeps the champion from calcifying, so identity is always
becoming, never fixed. The constraint — that things must die for one to live — is the
creative force, not the bug.

It is the same algorithm whether the participants are people judging worlds or
identity-fragments judging what a mind *is*. The prime cell is where that loop runs
cleanest — the reference deliberation the whole tournament inherits from.
**One cell per person. Champion wins. Forgetting is built in.**

---

## 02 · Metrics

Two axes. **XP** is legitimacy — earned by genuine play, it drives throughput and is
what a violation destroys. **Vote** is interest — the judge that sorts the entry window.

| Metric | Value | What it measures & where it acts |
|---|---|---|
| **XP** | 0 – 60 | One point per minute *actually played*. The effort axis. Drives **factory order** — the most genuine play time fills cells and tiers fastest — and it's what a violation wrecks. |
| **VOTE** | 0 – 100 | A player's interest signal. The judge that **sorts the initial content window** — which worlds surface first for everyone. |
| **CELL** | 60 min | A session's commitment. Holds several worlds; play one and you owe time to *every* world in it. |
| **STRIKE** | 1 / 30 days | A live violation, counting down in real time. A second *concurrent* strike is the deletion trigger — decayed strikes reset you clean. |

---

## 03 · The cell, moment to moment

- **Enter** — you're placed in a cell of several worlds.
- **Browse free** — touch nothing and you may leave for a fresh cell, no cost.
- **Commit** — play any world and the cell is *yours*; now you owe time to all of them.
- **Lock a vote** — cast anytime to release yourself to a new cell.
- **Round-robin** — review as many cells as you like, loop back on yourself.
- **Abandon** — leave without voting and your accumulated play time still counts.

---

## 04 · Violation & the strike

The violation is precise: **leaving a cell you have played without giving time to each
of its worlds.** Strikes are forgivable by design — the system corrects behavior before
it ends anyone.

1. **Violation → red flash.** The moment it's detected, a red flash confirms it — the
   player sees, immediately, that something crossed a line.
2. **Strike posted · 30-day countdown.** A strike lands in the top-right of their page
   with a one-month, real-time timer. It rides with them everywhere.
3. **Learn → strike decays.** Play honestly through the month and the strike clears. A
   big blue notice greets them — at the timer's end, or their next sign-in: *you learned.*
4. **Second live strike → GAME OVER.** A second strike while one is still active is the
   only path to deletion. Two *concurrent* — never two in a lifetime.

- **On violation:** red flash + a top-right strike with a live 30-day countdown, logged
  with the exact rule broken.
- **On redemption:** big blue "you learned" notice at expiry or next sign-in; strike
  removed, slate clean.

---

## 05 · GAME OVER — the deletion

Fires *only* on a confirmed second live strike, with the broken rule on record. No
silent, unexplained deletions — ever. Big red **GAME OVER** flash, then:

- **Preserve first** — winning & enjoyed worlds reassigned to a live keeper *before* the
  delete, so nothing they made can cascade away.
- **Delete the account** server-side — rows removed, session token invalidated. The
  account no longer exists.
- **Wipe our stuff on their device** — cookies, localStorage, sessionStorage, IndexedDB,
  Cache Storage. All cleared.
- **Route out** — a jail page, or straight to google.com.
- **Return as a stranger** — only via a new account + branch.

### Can we really take our stuff back? Yes — ours.

- ✓ **Our cookies** — server expires them, client clears them. Login dies instantly.
- ✓ **All our client storage** — localStorage, sessionStorage, IndexedDB, Cache Storage.
  Every byte we wrote, gone.
- ✓ **Server session + account** — the real teeth; even a stray cache scrap is orphaned
  once the session is dead.
- ✗ **The browser's global disk cache** — no JS can purge it. Only assets, no auth, and
  it busts on the next version. Harmless.
- ✗ **Anything on other domains** — forbidden by the browser, and it was never ours.

---

## 06 · The work survives the maker

**Preservation rule.** A world that **won** — by play time or by vote — or that **even one
person enjoyed**, stays on the platform, live, even after its maker is deleted. Ownership
passes to a keeper; the world does not die. A ban ends a person; it never orphans
something someone loved.

---

## 07 · Build order

Deliberately sequenced. The safe, reversible parts first; the irreversible one last, only
once everything under it is proven.

1. **The gate screen** — the rules text above, shown first-time / before entry,
   accept-to-continue. Commits nobody to enforcement. *(safe — no consequences yet)*
2. **Play-time tracking & scoring** — XP from real minutes, the Vote (100), and the
   factory-order queue that moves genuine players first.
3. **Strike system** — red flash on violation, the top-right strike + 30-day real-time
   countdown, the blue "you learned" on decay or sign-in.
4. **World preservation** — winning / enjoyed worlds survive a maker's deletion.
   *Proven before step 5 can exist.*
5. **The account deletion** — GAME OVER, server delete, client wipe, redirect. Built
   last, behind airtight detection and a logged, exact record of the rule broken.
   *(irreversible · gated on 1–4)*

---

## 08 · Decided & open

**Locked:** 60-min cells · XP 60 / Vote 100 · factory order by play time · second *live*
strike deletes · 30-day strike decay · GAME OVER + wipe + redirect · preservation of
winning/enjoyed worlds · auto-delete is in the rules.

**Still to pin:**
- **Cell shape** — how many worlds per 60-min cell (sets the per-world time floor a
  violation checks against).
- **Detection** — the exact "gave time to each world" threshold.
- **Keeper identity** — who owns preserved worlds after a ban.
