# Security Audit — Tournament Duel System

**Date:** 2026-04-19  
**Status:** Hardened

---

## Confirmed Exploits (pre-fix) via `exploit_test.py`

All 4 exploits were confirmed using the Admin SDK simulation:

| # | Exploit | Pre-fix | Post-fix (client SDK) |
|---|---------|---------|----------------------|
| 1 | Score injection (`score = 9999`) | VULN | BLOCKED |
| 2 | Victim score overwrite (`score = -999`) | VULN | BLOCKED |
| 3 | Answer overwrite (submit wrong → overwrite correct) | VULN | BLOCKED |
| 4 | Force finish (`status=finished, forfeit_by=victim`) | VULN | BLOCKED |

> **Note:** `exploit_test.py` uses the Firebase **Admin SDK** which permanently bypasses all
> security rules (including `.validate`). This is expected — the same privilege used by Cloud
> Functions. The rules protect against **client SDK** attacks (browser DevTools / Network tab).

---

## Rules Implemented

### RTDB `database.rules.json`

#### Answer write-lock (`duels` + `tournament_duels`)
```json
"selected_choice": {
  ".validate": "!data.exists() ? (newData.isNumber() && auth.uid == $userId) : newData.val() == data.val()"
},
"reaction_time_ms": {
  ".validate": "!data.exists() ? (newData.isNumber() && newData.val() >= 50 && newData.val() <= 65000 && auth.uid == $userId) : newData.val() == data.val()"
}
```
- First write: must be the owner (`auth.uid == $userId`), must be a valid number in range
- Subsequent writes: field is **immutable** — `newData.val() == data.val()` enforces this
- **Blocks:** answer overwrite exploit, reaction_time forgery

#### Score cap (`duels` + `tournament_duels`)
```json
"score": {
  ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= (data.exists() ? data.val() + 2 : 2)"
}
```
- Score can only increase by at most **+2 per write** (max points per question)
- **Blocks:** direct `set(9999)`, `set(-999)`, arbitrary score injection

#### Forfeit/Surrender ownership (`tournament_duels` only)
```json
"forfeit_by":   { ".validate": "newData.isString() && newData.val() == auth.uid" },
"surrender_by": { ".validate": "newData.isString() && newData.val() == auth.uid" }
```
- `.validate` runs on ALL nodes affected by a write, **including parent updates**
- `update(duelRef, {forfeit_by: 'victim_uid'})` fails because `'victim_uid' != auth.uid`
- **Blocks:** forced forfeit / match result forgery

### Firestore `firestore.rules`

| Collection | Was | Now |
|---|---|---|
| `question_sets` | any auth can write | only creator (`host_id`) or owner can update/delete |
| `tournaments` (parent) | any auth can write | any auth can create; only host or owner can update/delete |
| `ffa_results` | any auth can write | only tournament host or owner can write |
| `bracket_matches` | any auth can write | create/delete = host/owner; update = host/owner **or match participants** |

### Cloud Function `functions/main.py`

`reaction_time_ms` is now clamped server-side before ranking:
```python
def _safe_reaction(ans: dict) -> int:
    ms = ans.get("reaction_time_ms")
    if not isinstance(ms, (int, float)) or ms < MIN_REACTION_MS:
        return MAX_REACTION_MS    # invalid → push to the back of the ranking
    return min(int(ms), MAX_REACTION_MS)
```
- A forged `reaction_time_ms: 1` is clamped to `65000` ms → **never wins first-correct**
- Applies to the server-authoritative ranking (CF is the primary scorer for tournament duels)

---

## Remaining Known Limitation

**Correct answer index is plaintext in RTDB** (`questions[i].correct = 2`).  
A player watching the Network tab can see the correct answer before choosing.

**Fix (deferred):** Replace `correct: N` with `correct_hash: sha256(N + secret)` in RTDB.
Store the real index only in Firestore (server-side). CF reveals the index after the reveal
phase and writes `reveal_index` to the duel node. Requires a significant refactor of
`DuelLobby.jsx`, `DuelGame.jsx`, and the CF scoring logic.

---
---

# Round 2 — Tournament hardening (2026-09-02)

**Implemented and gate-verified. NOT deployed** — rules and functions still have to be
pushed for any of this to take effect in production.

## What is closed

| # | Hole | Fix | Location |
|---|---|---|---|
| 1 | **Self-crowning host.** `allow update, delete` on a tournament accepted any write whose *result* had `winner_uid == auth.uid`. `request.resource.data` is post-write state and there was no `affectedKeys()` guard, so one write of `{winner_uid: self, host_id: self}` made the caller the host — then FFA results, bracket matches and deletion all followed. Confirmed exploitable (HTTP 200) against production. | Clause removed. The champion is written server-side in `_progress_round`; the client write was already wrapped in `try/catch`. | `firestore.rules:55-64` (`tournaments/{tournamentId}`) |
| 2 | **`tournament_duels` open to every account.** `.write: auth != null` with no participant check. A stranger could pump an opponent's score in a loop, fabricate an answer under a player's uid, flip the match to `finished`, rewrite `questions`, or delete the node. | Write now requires: node does not exist yet (host/CF launch), or the writer is in `players`, or the writer is `host_uid`. Answer writes additionally require `auth.uid == $userId` **and** that the writer is a player of that duel. | `database.rules.json:83-118` |
| 3 | **Surrender flipped the result.** `surrender_by` appeared nowhere in `functions/main.py`; a 0–0 surrender fell through to "better FFA rank wins", so the player who quit could advance and eliminate their opponent. | `_resolve_winner` resolves `surrender_by`/`forfeit_by` first, before any score or FFA-rank comparison, and ignores (with an error log) a uid that is not one of the two players. | `functions/main.py:_resolve_winner` |
| 4 | **Two permanent freezes.** (a) A duel force-started with nobody watching stayed `playing` forever — `reveal_started_at` is only ever written by a player's tab. (b) A tournament whose host tab died between `batch.commit()` of `ffa_results` and the `updateDoc({status})` sat in `ffa` forever: the CF returned early when results existed and the reconciler only queried `status == 'bracket'`. | `_advance_reveal` extracted and shared by the reveal trigger and the reconciler (same transaction, so no double advance). Reconciler now recovers `playing` and `revealing` duels past their deadline, and sweeps `ffa` tournaments that already have results. `on_ffa_room_finished` flips the phase without re-running the tie-break shuffle. | `functions/main.py` — `_advance_reveal`, `tournament_reconciler`, `on_ffa_room_finished` |
| 5 | **Host locked out of the forfeit paths** (found in review, pre-existing). `.validate` on `forfeit_by` required `newData.val() == auth.uid`, so the host's force-finish and the disconnect-forfeit written by the surviving player both failed with a silent `PERMISSION_DENIED`. Force-finish was worse than a no-op: the Firestore batch commits first, so the bracket advanced while the two players kept playing a decided match. | `forfeit_by` accepts: self, a player of the same duel naming the other player, or `host_uid` naming either player. `surrender_by` stays self-only — surrendering is a personal act. | `database.rules.json:111-113` |
| 6 | **FFA results counted twice.** The FFA room runs with `auto_mode` **and** `unattended_mode`; the host tab revealed without taking `reveal_locks/{qi}` while a player's tab took it, so `performReveal` ran twice per question. Measured in room `56HH5D`: `correct_count` 5 → **10**, `total_reaction_ms` 4519 → **9038**, `score` 15 → **24** (a different number every run, because `score` was read-then-written). This decided **who entered the bracket**. | Host takes the same `reveal_locks`/`next_locks` transaction as `useUnattendedGameRunner`; `score` moved to `increment()`; `performReveal` returns early when `revealed_answers/{qi}` already exists. Both lock holders release the lock if the run throws, so a dead tab no longer freezes the question. | `src/pages/host/HostGameRoom.jsx`, `src/utils/gameRunner.js`, `src/hooks/useUnattendedGameRunner.js` |
| 7 | **A corrupt deck entry shifted every later question.** `_strip_correct` skipped non-dict entries, shortening the list while indices kept counting — answer hashes are bound to the final index, so every question after the gap became unscoreable, silently. | Length is preserved with an RTDB-safe placeholder (a `null` would be dropped and collapse the array into a sparse object, breaking `questions.length` on the client). Out-of-range round assignments and questions missing `correct` now log an error. | `functions/main.py:_strip_correct`, `_questions_for_round` |

## Round 3 (2026-09-02, same day) — the question leak

Closed once the live-bracket mirror removed the last legitimate reason for an
outsider to read a duel node:

| Hole | Fix |
|---|---|
| **Any signed-in account could read any duel node** (`.read: auth != null`) — the node carries the full question text of a match in progress, and every match in a round plays the same questions in the same order. | Read now requires being one of the two players or the host. A not-yet-launched duel still reads as `null` (the host bracket subscribes to it before launch and `launchMatch` `get()`s it — denying that would have frozen every launch). Non-participants watch `bracket_live` instead. |
| **The answer hash was crackable in four tries.** The salt is `duel:{duelId}:{qi}:{index}` and a tournament duel's id is the match id (`r1m1`), so it was not a secret at all. | Same read restriction: an outsider can no longer fetch `correct_hash`, so there is nothing to brute-force. **A participant can still crack their own current question** — see below. |
| **Every deck was readable by every signed-in player**, plain `correct` included, so a player could read the deck a tournament round was about to use. | `question_sets` read now requires the deck to be `is_global`, or the reader to be its host or the owner. 19 of 25 decks moved from readable to closed. `PlayerGameView` no longer reads the deck at all — its history entry now takes the title and question count off the room, which is where they already were. |
| A host picking a **published** deck for a competitive tournament. | `TournamentCreate` marks global decks in the picker and shows a red warning under it explaining that every player can read those answers. |

Verified: `scratch/tests/tmp-e-rules-probe.cjs` — `E-read-foreign-duel` 200 → 401 and
`E2-crack-correct-hash` recovered-index → `null`. `scratch/tests/tmp-w8-duel-read.cjs`
(5/5) is the regression guard for the read rule: participant reads, host reads,
outsider denied, outsider denied on a child path, unlaunched duel reads null.

## Round 4 (2026-09-02) — the answer left the browser

The participant-side leak, which Round 3 could only document.

**Was:** the duel node carried `correct_hash = sha256("duel:{duelId}:{qi}:{i}")`.
Both players may read their own duel node, and a tournament duel id IS the match
id (`r1m1`), so four SHA-256 calls gave a participant the answer before they
picked one. The salt was never secret; it only looked like one.

**Now:** the plain key lives at `duel_keys/{tid}/{duelId}` — `.read` is `false`
for every client, `.write` is the tournament host only (so the host tab can
still launch a match), and the Admin SDK reads it when scoring. The duel node
carries no answer field at all.

**What that forced, and why it is the right shape:** the server is the only
thing that can decide whether an answer is right, so scoring moved there.
`_score_question` has three callers — the answer trigger (both answered), the
reveal trigger (someone timed out, so the answer trigger never fires), and the
reconciler (every tab died) — and is idempotent on `answers/{qi}/correct_reveal`,
which is written in the same multi-path update as the points. A duel with
neither key nor hash is recovered from the deck by question text.

The client only opens the reveal phase now. While the server resolves the
answer, the reveal UI holds its judgement rather than painting the player's pick
red. Regular duels (`duels/`) are untouched — they still score in the browser and
still use `correct_hash`, because there is no Cloud Function behind them.

Evidence: `scratch/tests/tmp-w10-server-scoring.mjs` 16/16 (including a match
where one player never answers, scored by the reveal trigger),
`suite-tournament-w6` 37/37 in real browsers, `functions/test_main_pure.py`
18/18. The suite failed on the first run at exactly the right place — the
harness could no longer work out the correct answer, because it was
brute-forcing a hash that no longer exists. It now reads the key through the
Admin SDK, the same way the functions do; that a test needs admin credentials to
know the answer is the proof a browser cannot.

## Round 5 (2026-09-02) — the result left the browser too

**Was:** `bracket_matches` granted the two players an unrestricted `update`, so
`PATCH {status:'finished', winner_uid:self}` was accepted from the console —
mid-match, before a single question was answered — and `_finalize_match` then
trusted the stored `winner_uid` and advanced the round around it.

**Now:** host and owner only, for create, update and delete alike. Nothing was
lost by taking it away: `_finalize_match` already wrote the same result off the
duel node's status, resolved the same way (surrender, then score, then FFA rank,
then total reaction time), and advanced the winner. The client half was a
duplicate that happened to be forgeable. `TournamentDuelWrapper` waits for the
verdict instead of computing one; the client tie-break path and the two
advancement writes went with it, and those writes had been rule-denied for a
while already — they only ever logged a warning.

**The latency question, answered rather than assumed:** the concern with moving
a result server-side is the players staring at a spinner. Measured on
production, the delta from the duel turning `finished` to the verdict landing on
the match doc was **506 ms**. The status trigger fires on every question, so by
the last one it has been warm for the whole match. The wait is staged as a beat
— FINAL VERDICT, "جاري اعتماد النتيجة" — with a 45s ceiling after which the tab
falls back to the wait screen; the reconciler runs every minute, so nothing is
stranded.

Evidence: `scratch/tests/tmp-w11-verdict.mjs` 13/13 — participant refused 403 on
the self-crown write, outsider refused, the match doc untouched afterwards, and
a match played to the end finalised server-side with the champion written on the
tournament doc.

## Round 6 (2026-09-02) — the tournament no longer needs a tab

Not a leak: a stall. Both of these were on the list of things only a browser did.

**A scheduled tournament never began.** `scheduled_start_at` was a countdown in
the host's lobby tab and nothing more — the auto-launch was a React effect on
`timeLeft <= 0`. Host closes the tab, and the players watch a countdown reach
zero and sit there. `tournament_starter` (every minute) now picks up anything due
inside the next 65s and **waits out the remainder in-function**, so the launch
lands on the scheduled second rather than on the next cron tick: measured 1.18s
late on production. It creates the room, seeds the players from the
registrations, claims the phase, and starts the room 10s later so nobody has to
press start.

It refuses the same things the manual button refuses: fewer than two
registrations, and any round without assigned questions. That second one matters
— without the check a scheduled tournament would quietly fall through to the
legacy random-question fallback, which is exactly the behaviour constraint 13
exists to prevent.

**The launch is now a claim, not an announcement.** Two launchers exist, so the
tournament doc is claimed in a transaction (status still `registration`, no
`ffa_room_id`) and the loser deletes the room it just created. The client side
does this too. An unconditional write would have pointed the tournament at one
room while the players were already in the other.

**A walkover left its winner nowhere.** ⚡ حسم against an absent player writes a
result with no duel behind it, and the finalizer hangs off the duel node's
status — so the winner sat in a finished match until the once-a-minute
reconciler noticed. `on_bracket_match_written` now handles an already-finished
match: seat the winner, progress the round. Measured 1.3s instead of up to 60s.

Evidence: `scratch/tests/tmp-w12-scheduled-start.mjs` 13/13 (two tournaments due
at the same second, no tab open anywhere — the assigned one launches and starts
itself, the unassigned one is refused) and `tmp-w13-walkover.mjs` 12/12 (host
awards both round-1 matches; the winner is seated in 1.3s, the round holds while
a sibling is unplayed, and advances when it is not).

## Round 7 (2026-09-02) — the score left the browser

The plainest hole of the lot, and the last one inside a match.

**Was:** `tournament_duels/{tid}/{duelId}` granted `.write` to either player. An
RTDB child rule cannot revoke what an ancestor granted, and `players/{me}/score`
sits inside that node — so the `.validate` capping a single write at `+2` was
capping the wrong thing. Nothing capped the *number* of writes: nine PATCHes were
nine points. The same grant covered `questions` (write your own `correct` in),
`total_questions` (end the match early), `tiebreaker_questions`, `host_uid`, and
every field under the opponent's answer.

**Now:** the node grant is creation-by-the-declared-host plus the host, and the
fields a player's tab actually drives are granted one at a time — `status`, the
two clocks, `current_question_index`, `forfeit_by`, `surrender_by`, and its own
answer. Two facts about RTDB rules make this shape work: a child `.write` grants
where the parent does not, and a multi-path update is evaluated per child path
(so the reveal claim and the forfeit still go through as single atomic writes).

**What had to change in the client, and why it was free:** both remaining
whole-node writes were transactions that the server already did.
`waiting → playing` is now the same atomic claim on `status`, and only the tab
that wins it writes the clock — a player may write `question_started_at` while it
is still absent (or the duel is not yet playing) and never again, so a tab that
wakes up late cannot restart a running question. `triggerNextOrFinish` is gone
for tournament duels, because the write that advanced the question was also a
write that could set a score. The reveal trigger appends the tiebreaker,
finishes, or moves on, and the reconciler repeats it if that invocation is
lost. Regular duels keep the client path — nothing runs
behind them.

**And while the answer node was open:** reaction time was self-reported, and the
first-correct bonus (2 vs 1) is what decides a tied question. The client now
stamps `at` with RTDB's server timestamp, the rule accepts nothing but `now`, and
`_score_question` measures `at - question_started_at`. `question_started_at`
itself became unwritable by a player once the question is running — rewriting it
mid-question restarted the timer for both players and would have skewed every
measurement. (The e2e caught the first version of that rule: both tabs raced the
5s auto-start, and the loser's clock write was refused with a console error. The
loser should never have been writing it — the claim decides who does.)
`is_correct`, `points_earned` and the measured `reaction_ms_server` are
`.validate: false`: no client can write them, admin writes bypass validate,
so the bonus and the speed tiebreaker are both decided on numbers no player can
shape.

Evidence: `scratch/tests/tmp-w14-score-lock.mjs` 29/29 (run twice, once per
version of the clock rule) — fifteen refusals
(own score, opponent score, the whole node, an injected `correct`, the question
count, the tiebreaker pool, `host_uid`, `match_id`, `is_correct`,
`points_earned`, `reaction_ms_server`, a forged `at`, `correct_reveal`, an
outsider, and restarting a running question's clock), the duel unchanged after
all of them, then every legitimate write going through and the match playing to a
server-resolved forfeit. The harness reported 900ms on an answer the server
measured at 199ms, and the server's number is the one that was used.

## What is NOT closed — read before the next event

* **A published (global) deck still exposes its answers** to anyone who opens it
  in the deck browser — that is what publishing means today, because the client
  builds a duel from the plain deck. Server-side duel creation would fix it.
* **The FFA room is still wide open, and it is the gate into the bracket.**
  `rooms/{code}` grants `.write` to any signed-in user at the node itself, so the
  same trick Round 7 closed for a duel — PATCH `players/{me}/score` — works on the
  qualifier, and the qualifier decides who enters the bracket at all. It is not a
  small fix: `rooms` is shared with the whole host-run game system, where a player
  tab legitimately writes reveal data, scores (`increment`), the question index
  and the runner locks (`useUnattendedGameRunner` — that is what lets a host walk
  away). Locking the node means moving that loop server-side for every game mode,
  not just tournaments. Until then the FFA is only as honest as the people in the
  room, and `on_ffa_room_finished` ranks whatever scores it finds. **This is the
  next one to do**, and it is bigger than everything in rounds 1–7 put together.
* **An answer written without `at` still falls back to the self-reported reaction
  time.** The rule accepts `at` only as the server's own stamp, and the new client
  always sends it, but it is not yet *required* — a tab from before this change
  would otherwise have its answers refused outright. So a hand-crafted write that
  simply omits `at` can still claim 50ms and take the first-correct bonus.
  Requiring it is one line (`reaction_time_ms`'s `.validate`, checking
  `newData.parent().child('at').val() == now`) and should be done once the client
  rollout has settled.
* **The FFA game loop still needs at least one player tab.** The room is created,
  started and finalised server-side now, but the question timer and the reveal are
  driven by `useUnattendedGameRunner` inside whichever player tab claims the lock. That
  is inherent while the players are the ones answering — a fully server-run FFA would
  mean scoring N players in a Cloud Function — but it is worth knowing: an FFA where
  every tab closes freezes on the current question until one reopens.

## Evidence

* `functions/test_main_pure.py` — **18/18** pass: surrender / forfeit / 0–0 FFA-rank
  fallback, answer-key index alignment including an appended tiebreaker (and the legacy
  hash still decoding), out-of-range round assignment.
* `scratch/tests/suite-tournament-w6.mjs` — **37/37**, real browsers, a whole tournament
  from the assignment panel to the champion, re-run after every round below. It is the
  regression gate: it caught the one bug rounds 4–7 introduced (both tabs racing the
  auto-start, the loser's clock write refused).
* `scratch/tests/tmp-w5-ffa-double.mjs` — host tab + two player tabs against the local dev
  server. **Before the fix: FAIL** — `reveal_locks` is `null` for every question and
  `next_locks` is `[null, p02, p02]`, i.e. the host revealed and advanced outside the lock
  (the same `[null, "p05"]` shape recorded in the live run). **After: PASS** — every
  question's lock holds exactly one uid and all counters are single-counted.
  The numeric ×2 is not reproduced by the harness (it needs both tabs to fire in the same
  instant); the live room measurement above is the reproduction, and what the test proves
  is that the double-execution window is now closed.
* `firestore.rules` + `database.rules.json` compile; `npm run build` and eslint clean.
* **The deployed rules were read back and compared, not assumed.** Firestore via
  `getSecurityRules().getFirestoreRuleset()`, RTDB via
  `GET {databaseURL}/.settings/rules.json` with a service-account access token — both
  identical to the repo files after the last deploy of each.

## Deploy order (matters)

**Push the client first, then the rules** — for every change in this document. A new path
needs its rule deployed *before* the code that uses it, but every round here is a
*restriction*, and for those the order is the other way round: the still-cached old client
is the one that gets denied. Two concrete reasons from these rounds:

* the RTDB rule lets the host write to a duel only when `host_uid` is present, and that
  field is written by the new client and CF code — rules first would lock the host out of
  every duel launched by an old tab;
* the duel node lock refuses the old client's whole-node transactions (auto-start,
  advance). Both have server fallbacks, so an old tab degrades rather than breaks — but it
  degrades to a 25s start and a reconciler-paced advance.

Check the rollout actually landed before deploying rules: compare the `dist/assets` hashes
against the ones in the production `index.html`. And check nothing is live first —
`status in ('registration','ffa','bracket')` must be empty.

The probes for rounds 4–7 (`tmp-w10`…`tmp-w14`) live in the gitignored harness
(`scratch/tests/`, which holds `tokens.json` and so cannot be tracked). They are the
evidence for every claim above; run them from that directory with the Admin credentials in
place.
