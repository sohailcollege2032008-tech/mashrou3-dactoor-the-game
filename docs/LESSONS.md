# LESSONS — Why the tournament broke, and the discipline that prevents it

> Written 2026-08-14, the day a real tournament was at risk because the bracket
> phase depended on the host's open browser tab. This file exists so every
> future agent (human or AI) working on this repo — or any repo — reads the
> failure modes BEFORE changing code.

---

## The incident (facts)

- Tournament A (5 players) and tournament B (2 players) were live at the same time.
- The host's tab was on B. Everything that advanced the bracket phase
  (generation, match launch, duel start, result writing, round advance) ran only
  inside ONE open browser tab. A's bracket was never generated; B's only duel
  stayed `waiting` forever because a tournament duel only starts when a player
  opens it.
- The result: 4 qualified players sat in the waiting room with a spinning
  bracket tree, and the host saw a "final" that was actually tournament B —
  a correct 2-player bracket, misread as a bug.

## Root causes (the real ones)

1. **Tests verified the happy path, not the failure modes.**
   The E2E suite always kept the host tab open, so the host-tab dependency was
   structurally invisible to it. A suite that cannot fail is not a test — it is
   a demo.
2. **A known, deadline-breaking risk was documented instead of fixed.**
   The host-tab dependency was identified, written down as a "known limitation",
   and deferred. With a launch the next day, that was a wrong priority call.
3. **Scenario coverage mirrored assumptions, not usage.**
   One tournament, one host, one tab. Never tested: two concurrent tournaments,
   host tab closed, host on a different tournament, players-only runs.
4. **Code was read to confirm flow, not to break invariants.**
   The tiebreaker hashing bug (questions hashed at index 0..2, appended at
   index 5..7 → every tiebreaker scored zero) survived a full read-through
   because the reviewer asked "does the flow exist?" instead of
   "is every index/state/abort consistent at every edge?"
5. **Green results were trusted as proof.**
   Passing suites felt like correctness. Nobody asked whether the suite could
   even detect the real failure.

---

## The rules (mandatory from now on — any project, any agent)

### R1 — Every suite needs a negative scenario
Before calling a feature done, add at least ONE test that exercises a failure
mode of the same feature: tab closed, second concurrent session, missing
opponent, crash mid-phase, wrong phase state. If the feature has no plausible
failure mode, say so explicitly — don't silently test only the happy path.

### R2 — Known risk + next-milestone impact = must-fix or loud escalation
A "documented limitation" is only acceptable when it cannot break a user's
flow in the current milestone. If it can, it is fixed before done — or the
owner is told loudly, in the chat, not in a doc. Documentation is not a
substitute for fixing; it is a substitute for forgetting.

### R3 — Read code adversarially before claiming done
One pass of the changed code looking specifically for:
- index mismatches (hash/append/slice/rank positions)
- state machines missing a transition (waiting→playing→revealing→finished)
- abort/rollback semantics of the SDK/DB in use (e.g., firebase-admin Python:
  abort a transaction by RAISING, never by returning None)
- read-then-write races without a transaction
- listeners gated on values that may never arrive

### R4 — Prove the test can fail
For the most important suite of a milestone, mutate the code (or the data) to
break the feature, confirm the suite fails, then revert. A suite that cannot
fail is worthless. (Tournament suites: run once with the host tab closed.)

### R5 — Prioritize by risk to the next real event, not by what's visible
Polish, docs and nice-to-haves come after anything that can break the next
real user moment. When a milestone has a date, re-check the risk list against
that date, not against the backlog.

---

## Applied to this repo (how to keep it honest)

- `scratch/tests/suite-tournament.mjs` — keep the "no-host-interaction" probe
  and ADD a "host tab closed entirely" variant.
- Any new tournament CF/client change must re-run:
  `suite-bracket-orchestration.mjs` (26 tests), `suite-reconciler.mjs` (5),
  `suite-tournament.mjs` (full E2E), unit tests.
- The reconciler CF is the last line of defence: a tournament stuck for
  >60s with a healthy reconciler is a bug in the reconciler.
- Never let a "known limitation" sit in `CHANGE_AUDIT.md` §7 while the feature
  it risks is due to ship. Move it to §2 (fixed) or escalate.

---

## TL;DR

The tournament broke because the system was a house of cards and the tests
were designed not to notice. The fix is not one more test — it is a discipline:
**test the failure, fix the known risk, read adversarially, prove the test can
fail, and let the deadline set the priority.**
