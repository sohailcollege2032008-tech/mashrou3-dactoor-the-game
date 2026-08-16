# QA Guide — Realtime & Multi-Account Systems

General playbook for testing realtime, multi-user features (tournaments, live
rooms, duels, leaderboards). Used for every feature that has two or more users
acting on shared state at the same time.

## Principles

1. **Test with real concurrent accounts** — a single logged-in session cannot
   reproduce races, double-clicks, or state desync. Minimum 2 accounts; 3–4 for
   tournaments (to exercise matchups, byes and elimination).
2. **Two browsers / profiles** are the baseline (one window per account, side by
   side). Use incognito profiles so cookies/sessions don't bleed.
3. **Repeat the flow at least 3×** — flaky behaviors (RTDB writes, phase
   transitions) only show on repetition.
4. **Verify against the DB, not just the UI** — after each step, confirm the
   underlying document/RTDB state matches what the screen claims. Screens can
   lie; the DB is the source of truth.
5. **Never trust the first pass.** A flow that "just worked" once proves
   nothing. Break it on purpose (refresh mid-phase, tab away, kill the tab).

## Accounts & authentication

- Test accounts are created via the auth **admin** flows (custom token /
  OAuth test accounts — never sign up through the UI for QA; it skews metrics).
- One account = one browser profile. Logging two accounts into the same profile
  is a source of "phantom" bugs.
- Watch the session boundary: refresh with the tab idle 10+ min → the token
  refresh should bring the user back to the same screen state.

## Test accounts & tools

| Tool | Purpose |
|------|---------|
| Playwright script (`scratch/tests/*.mjs`) | Scripted multi-account flows — create tournament, join with N accounts, answer questions, assert end state. Idempotent setup/teardown. |
| DevTools Network tab | Confirm RTDB/Firestore writes, latency, and 4xx/5xx errors per account. |
| DevTools Application → IndexedDB/LocalStorage | Verify per-account session keys, active-tournament cache, sound settings. |
| The owner pages (`/host`, `/sound-test`) | Host view of the same tournament the players see — the host screen is an independent observer of shared state. |

## What to check in every realtime flow

### Concurrency & races
- Two players clicking the same button (join, answer, start) at the same moment
  → exactly one write wins; nobody double-charged / double-registered.
- Host starts a phase while a player is mid-action → player lands in a sane
  state (wait screen), not a crash.
- A player refreshes mid-duel → re-joins the same duel with scores intact.

### State machine
- Every phase transition is one-directional and idempotent: FFA → bracket →
  duels → finished. Re-visiting a phase (refresh, back button) must NOT replay
  it.
- No stuck intermediate states: if the app says "waiting for X", X eventually
  arrives (timers, not only events).

### Network & load
- Slow network (DevTools throttling) — writes must still land; UI shows pending
  state, not infinite spinners.
- Offline blip mid-phase → reconnect restores state; no partial writes that
  leave the room unwinnable.
- 3+ concurrent players answering simultaneously → scores computed correctly
  for all.

### Failure modes (test deliberately)
| Scenario | Expected |
|----------|----------|
| Tab killed mid-FFA | Room finishes anyway; remaining players get results |
| Host closes the tournament page mid-phase | Phases still advance (server-driven timers) |
| Player joins after registration closes | Clean rejection message, no half-state |
| Duplicate join (double-click) | Only one registration row |
| Wrong/missing answer | Scored 0, not crash; rank still computed |
| Winner determined while a client writes its own result | Server result wins (race fixed — see `CHANGE_AUDIT.md`) |

## Checklist template (fill per feature)

```
Feature: ____        Date: ____        Tester: ____
Accounts used: A (browser X)  B (browser Y)  C (browser Z)
Passes: 1 ☐  2 ☐  3 ☐

[ ] Setup clean (no leftover data from previous run)
[ ] Join flow — all accounts join, order recorded
[ ] Phase 1 (FFA) — all answer; scores match DB after reveal
[ ] Transition — all players arrive at wait screen; countdown ticks
[ ] Phase 2 (brackets) — matchups correct; byes handled
[ ] Duels — both players in same duel; result consistent for both
[ ] Final — champion matches DB; eliminated players see eliminated
[ ] Refresh mid-phase → sane state
[ ] Duplicate/wrong input handled
[ ] Backend state matches UI at end (dump DB, compare)
Result: PASS / FAIL (describe failures + repro steps)
```

## Escalation path

UI bug → DB mismatch → concurrency suspect:

1. Reproduce 3× with the same steps; write the repro into the report.
2. Dump the DB state at the failure moment (RTDB path + Firestore doc).
3. Check serverless function logs for the phase transition in question.
4. File the report in `CHANGE_AUDIT.md` with the reproduction script reference.
