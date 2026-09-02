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

## What is NOT closed — read before the next event

* **A participant can still recover the correct answer for their own current
  question.** They may read their own duel node, and the hash salt is derived
  from ids they know, so four SHA-256 calls give them the answer before they
  answer. Closing this means the salt has to include a server-only secret, which
  in turn means the client can no longer score a question by itself — the
  timeout path (`DuelGame.triggerReveal`) currently does exactly that when a
  player never answers. So it needs server-authoritative scoring for the timeout
  case first. This is the single biggest remaining fairness hole.
* **A published (global) deck still exposes its answers** to anyone who opens it
  in the deck browser — that is what publishing means today, because the client
  builds a duel from the plain deck. Server-side duel creation would fix it.
* **A match player can still crown themselves in Firestore.** `bracket_matches` grants the
  two players an unrestricted `update`, so a `PATCH {status:'finished', winner_uid:self}`
  is accepted and `_finalize_match` trusts the stored `winner_uid`. Closing it means match
  results become CF-only, which changes who advances the bracket — it needs a full bracket
  re-test and is therefore deliberately left for the next round.
* **A player inside a match is still trusted.** `.validate` caps `score` at `+2` per write
  but not the number of writes, and RTDB cannot revoke an ancestor's `.write` grant, so a
  participant can pump their own score or write fields under the opponent's answer node.
  The rules changes above stop *outsiders*, not participants.
* **The FFA phase still depends on the host's tab** (launch, scheduled start, finalisation).
  Only the recovery paths are server-side.

## Evidence

* `functions/test_main_pure.py` — 14/14 pass: surrender / forfeit / 0–0 FFA-rank fallback,
  hash-index preservation including an appended tiebreaker, out-of-range round assignment.
* `scratch/tests/tmp-w5-ffa-double.mjs` — host tab + two player tabs against the local dev
  server. **Before the fix: FAIL** — `reveal_locks` is `null` for every question and
  `next_locks` is `[null, p02, p02]`, i.e. the host revealed and advanced outside the lock
  (the same `[null, "p05"]` shape recorded in the live run). **After: PASS** — every
  question's lock holds exactly one uid and all counters are single-counted.
  The numeric ×2 is not reproduced by the harness (it needs both tabs to fire in the same
  instant); the live room measurement above is the reproduction, and what the test proves
  is that the double-execution window is now closed.
* `firestore.rules` + `database.rules.json` compile; `npm run build` and eslint clean.

## Deploy order (matters)

Push the client first, then the rules. The new RTDB rule lets the host write to a duel only
when `host_uid` is present, and that field is written by the new client and CF code — rules
first would lock the host out of every duel launched by an old tab.
