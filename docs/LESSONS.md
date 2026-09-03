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

## Addendum 2026-09-02 — rules redeploy recheck (suite-tournament-w6)

- After tightening `firestore.rules` + `database.rules.json` (self-crown removal,
  host-settle RTDB writes, self-only registrations), ran a full live E2E on
  production with the NEW rules: `node scratch/tests/suite-tournament-w6.mjs`.
  Result: **37 pass / 0 fail** — host assignment panel, FFA, host force-finish,
  live bracket duels, final + champion all green under the deployed rules.
- **Verify the deploy is real, not assumed.** Live Firestore rules were fetched
  via `getSecurityRules().getFirestoreRuleset()` (`scratch/tests/tmp-w6-live-rules.cjs`)
  and diffed byte-identical against repo `firestore.rules`. The `getFirestoreRuleset()`
  source is a protobuf object — read `source[0].content`, not `source.length`.
- **Client-side advancement is denied by design** (`Could not advance winner
  client-side`). A player may finalize their own match but cannot write the next
  match's slot. The CF seeds it in a SEPARATE invocation (its own fast-warm
  trigger) — so between "match finished" and "next-match seeded" expect a CF
  cold-start gap of ~15–40s on production. E2E waits must budget for it.
- **`Failed to write game notifications` is EXPECTED, not a regression** (seen
  since `c4b82b6`): the host's own notification writes (any-auth write allowed),
  but per-player notifications are deduped with a `getDoc` that is owner-only
  (`read: uid == userId`), so those throw and skip silently.
- WaitUtilities: `waitFor` returns the predicate's value — when asserting fields,
  return the DOC (`? doc : null`), never a bare boolean, or the check sees a stale `true`.

---

## Addendum 2026-09-02 (later) — taking writes away from the client

Four rounds of moving authority server-side (answer key, match result, scheduled
start, duel score). What is worth keeping from the process:

- **RTDB child rules grant; they never revoke.** `.write` is additive from the
  root, so a rule on `players/$uid/score` cannot take back a grant made at the
  duel node — the `.validate` capping a write at `+2` was guarding a door that
  had no lock. The fix is always to narrow the *ancestor* and re-grant the
  specific children. And a `.validate: "false"` on a child is the way to say
  "server only": admin writes bypass validate entirely.
- **A multi-path `update()` is evaluated per child path.** That is what makes the
  narrow shape usable: `{status, reveal_started_at}` and `{status, forfeit_by}`
  still go through as single atomic writes with no grant at the node. A
  `runTransaction` on the node does NOT — it is a whole-node `set`, so anything
  that used one had to move to a transaction on the specific child.
- **The deployed RTDB rules CAN be read back.** An earlier addendum concluded
  there was no getter for them (`getSecurityRules()` only covers Firestore and
  Storage). There is one, over REST:
  `GET {databaseURL}/.settings/rules.json?access_token=…` with a token minted
  from the service account (`app.options.credential.getAccessToken()`). Parsed
  and compared against `database.rules.json` it proved the deploy landed exactly
  — the same check that was already being done for Firestore. Strip `//` comments
  before parsing; the console adds them.
- **Deploy order flips for a restriction.** A new path needs its rule deployed
  *before* the code that uses it. A restriction is the opposite: push the client
  first, let it roll out, then deploy the rules — otherwise the still-cached old
  client is the one that gets denied. Check `dist/assets` hashes against the
  production `index.html` to know the rollout actually landed.
- **When a test can no longer cheat, that is the result.** The `w6` suite failed
  the first run after the answer key moved, because the harness was brute-forcing
  a hash that no longer existed. Needing admin credentials to know the correct
  answer is the proof a browser cannot. Same shape for the score lock: the probe
  asserts fifteen refusals *and* that every legitimate client write still works —
  a rules change that only proves the first half is how you ship a frozen game.
- **Measure the latency you are introducing, do not estimate it.** Moving the
  match result server-side puts a wait on the players' screens, so the probe
  reports it: 506 ms (the trigger is warm — it fires on every question). The
  scheduled start lands 1.18s after its second; a walkover seats its winner in
  1.3s instead of up to 60. None of those were guesses, and one of them (the
  walkover) was a bug found *by* measuring.
- **A probe that hand-writes state a Cloud Function also writes is racing it.**
  The visual scene for the pre-match story writes two finished round-1 matches,
  then the tournament doc as `bracket` — which wakes the bracket generator, whose
  batch overwrote one of them. The screenshot came back with seed 1's story
  showing the qualifier fallback instead of "فاز على … 6–2", and the first
  instinct was to look for a client bug. There was none: the data at read time
  really did lack a winner. Scaffolding that collides with a trigger has to
  settle — write it, then poll it back and rewrite until it reads the way the
  scene needs — or the probe is testing the function's version of the world.
- **Look at the screenshot, do not just count the assertions.** The same run
  reported `path lines: 1` where the previous one said 2, and that single number
  was the only thing that caught it. A visual pass whose output is only PASS/FAIL
  lines would have shipped a story panel with half its story missing.

---

## Addendum 2026-09-03 — three ways a green suite lies

**1. A FATAL that is not a bug.** `suite-tournament-w6` died on
`waiting for getByRole('button', {name: /Start Game/})` seconds after a push.
The room was in `lobby` with 4 players and the button renders unconditionally
in that state — so the cause was the deploy itself: the tab loaded the old
`index.html`, then an SPA navigation asked for a lazy chunk whose hash no
longer existed. **Never run the E2E suite against production while a deploy of
that commit is in flight**, and when a suite fails on a control that should
exist, open the page in that exact state before touching product code. Two
minutes of probing beat an afternoon of chasing a phantom regression.

**2. A suite that aborts leaves a live tournament behind.** `main().catch()`
only logged. The TEST_ tournament stayed in `ffa` with a room in `lobby`, which
also violates "one live tournament at a time" for anything that runs next.
Cleanup belongs in a `finally`, not at the end of the happy path.

**3. The real find came from the console, not the assertions.** 36 checks
passed; the failure was a player tab logging PERMISSION_DENIED for
`host_rooms/{host}/active`. That is the shape to watch for: **a rule only the
host can satisfy, inside code a player is supposed to run.** The write sat at
the end of `performNextQuestion`, so in unattended mode the room flipped to
`finished`, the denial rejected the call, the runner released its lock and
logged an error for a game that was over, and the host came back to a dashboard
pointing at a dead room. Whoever cannot be denied should own the write — here
the Cloud Function. Capture console output in every suite and fail on
unexpected denials; without that line this would have shipped invisibly.

**4. Seed before you flip.** A probe wrote `status: 'bracket'` and *then* the
qualifier docs; `_ensure_bracket` woke on the flip, found no qualifiers and
built nothing. It passed the first run purely because a cold start was slower
than the writes. Scaffolding must follow the same order as the real path
(results → flip), or the race decides whether the test is true.

---

## Addendum 2026-09-03 (later) — two probe traps and a real bug they found

**A spy that changes the page under test is not a spy.** To prove a sound
fires, the probe replaced `window.Audio` with a recording wrapper. The live
page then rendered nothing at all — `soundManager` probes codec support through
that constructor at import time — and the failure looked exactly like a broken
feature for two runs. Spy on the narrowest thing that answers the question:
`HTMLMediaElement.prototype.play`, which records what the app *tried* to play
and leaves construction alone.

**Assert on the view that shows the thing.** The narrow bracket shows one round
and follows the live one, so once the Cloud Function advanced to the final, the
round-1 marks under test were simply not on screen — correct behaviour, useless
for asserting. The probe now asserts on the wide tree (all rounds) and *then*
proves the phone by picking round 1 from the rail.

**The bug both traps were hiding.** A dedupe set seeded on first render is
seeded from `matches: []`, because the subscription has not answered yet — so
the first real snapshot arrives as news and the page gasped its way through the
entire history of the tournament for anyone opening it late. Seed from the
first payload that actually arrived (`if (!data) return`). Any "have I already
reacted to this?" set built in a component has this shape.

---

## Addendum 2026-09-03 (evening) — the deploy is part of the live event

The phantom regression at the top of today's addendum had a second lesson in
it. The suite failed because a route chunk 404'd mid-deploy: the tab was
holding the previous build's manifest and asked for a hash that no longer
existed. That is not a test artifact — it is what happens to **every open tab**
when a deploy lands, including the host's control panel in the middle of a
round.

`lazyRoute` in `src/App.jsx` now wraps every route import: on a failed import
it reloads once (which fetches the new manifest), marks that it did so in
`sessionStorage`, and clears the mark as soon as any chunk loads normally — so
a chunk that is genuinely gone falls through to the error boundary instead of
looping, and a later deploy still gets its own retry.

Two rules that follow:
- **Never deploy while an event is live** if it can wait. Self-healing costs
  the user a reload; it does not make a mid-round deploy safe.
- **A reliability fix needs a test that can fail.** `tmp-w32-chunk-heal`
  intercepts the chunk and 404s the *first* request only — which is what a
  deploy actually looks like. 404ing every request instead proved the opposite
  branch (permanently missing → no loop), which is worth asserting too, but is
  not the healing path.

---

## Addendum 2026-09-03 (last) — an assertion that was a coin flip

The final regression run came back 38/39 on `final result recorded (p1 wins)`:

```js
check(fm.r2m1?.winner_uid === P(1).uid && fm.r2m1?.player_a_score > fm.r2m1?.player_b_score, ...)
```

Nothing had regressed. The suite brute-forces the players' answers, so a level
final is an ordinary outcome, and the server settles it by speed and then
qualifier rank — p1 was seed 1, so p1 was crowned correctly with no score
margin. The assertion demanded the margin, so it had been **passing by luck**;
it happened to draw a decisive final on the two earlier runs the same day.

Which half failed was deducible without re-running: the tournament's
`winner_uid` is derived by the Cloud Function from the final match, and
`champion = p1` passed — so `r2m1.winner_uid` was p1, leaving only the score
comparison. Worth doing that reasoning before touching anything.

Two rules:
- **Assert the rule, not one of its outcomes.** "p1 wins, by a margin or by a
  recorded tiebreak" is the rule. "p1 wins by a margin" is one path through it.
- **Every check passes a detail string.** This one passed none, so a real
  failure printed no numbers and looked like a regression. `check(cond, label,
  detail)` — the detail is what turns a red line into a diagnosis.

---

## TL;DR

The tournament broke because the system was a house of cards and the tests
were designed not to notice. The fix is not one more test — it is a discipline:
**test the failure, fix the known risk, read adversarially, prove the test can
fail, and let the deadline set the priority.**
