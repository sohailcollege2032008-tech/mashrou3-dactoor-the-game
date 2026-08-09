# FINAL TEST REPORT — Mashrou3 Dactoor (Med Royale)

**Date:** 2026-08-09
**Baseline:** production `med-royale.vercel.app` == git `f1045e2` (deployed 2026-05-01), verified byte-identical (built bundle matches live assets except CRLF).
**Fixed & deployed:** commit `2aa6b86` on `med-royale` (auto-deployed to Vercel; live bundle `index-DO4s4582.js`).
**Backend:** Firebase project `mashrou3-dactoor` — 3 Python Cloud Functions deployed (europe-west1, python311).

---

## 1. What was tested (all against production)

| Suite | Coverage | Result |
|---|---|---|
| Unit (19 tests) | bracket seeding, top-cut, tie-break, sort, duel config, question assignment | ✅ 19/19 |
| Smoke (3 roles) | owner → /owner, host → /host, player → /player dashboards | ✅ 3/3 |
| Tournament E2E | 8 real browser players: register → FFA → bracket → 3 rounds → champion | ✅ full pass after fixes |
| Duel timeout probe | opponent never answers → timer expiry behavior | ✅ reveal + advance after fix |
| Visual sweep | 10 screens × desktop/mobile, console-error capture | ✅ no console errors |
| Backend | deployed CFs present, Firestore rules repo==deployed, data inventory | ✅ |

---

## 2. Bugs found & fixed (deployed)

### BUG-1 (HIGH) — Tournament FFA never auto-progressed
FFA room config lacked `auto_mode` / `unattended_mode`, so after the host clicked **Start Game** the game froze on Q1 unless the host manually clicked REVEAL every question.
**E2E evidence:** 8 connected players, zero host interaction for 50s → `status=playing, qIdx=0`, config `{"auto_mode":false,"unattended_mode":false}`.
**Fix:** `TournamentLobby.launchFFA` now sets `auto_mode: true, unattended_mode: true, auto_timer: timerSeconds`.
**Verified:** FFA completes unattended; final FFA leaderboard correct (ranked scoring).

### BUG-2 (HIGH) — Tournament duels hung forever when an opponent never answered
The timer-expiry path wrote only a `timed_out` marker; the scoring CF only fires when **all** players have answered → duel stuck in `playing` indefinitely.
**E2E evidence:** player answered correctly, opponent absent → after 35s the duel was still `playing`, qIdx 0; the answer also got `timed_out:true` appended by a stale closure.
**Fix:** `DuelGame` unifies the timer-expiry path to **reveal** (scoring whatever exists) for regular and tournament duels; the no-answer marker is now guarded by a `hasAnsweredRef` (fixes the stale-closure).
**Verified:** after expiry the answer was preserved with `is_correct:true, points_earned:2`, `correct_reveal` written, duel advanced to Q2.

### BUG-3 (MED) — Tournament could not be marked finished by players
`tournaments/{id}` update rules allowed only the host/owner, so the champion's finish write was silently denied (players' advancement writes to next-round matches are also denied by design — host bracket page does it).
**Fix:** Firestore rule now lets the champion (`winner_uid == auth.uid`) finalize the tournament.
**Verified:** tournament reached `status=finished`, `winner_uid` set, all 7 matches finished.

### BUG-4 (MED) — FFA → bracket transition depended on the host's browser
`ffa_results` + `status→bracket` were written only by `HostGameRoom` (host tab).
**Fix:** new CF `on_ffa_room_finished` (RTDB trigger on `rooms/{code}/status`) writes `ffa_results` + flips the tournament to bracket server-side; skips if the host client already wrote them (avoids conflicting tie shuffles).
**Verified:** deployed (v2, europe-west1); suite's FFA→bracket transition completed.

---

## 3. Confirmed-correct (no change needed)

- Bracket seeding integrity: r1 pairs (1v8)(4v5)(2v7)(3v6); winners advance to the correct slots; summaries `champion/finalist/semi_finalist/eliminated_bracket` + FFA ranks written for every player path.
- CF duel scoring (first-correct 2pts, others 1pt), tiebreaker extension logic, forfeit handling.
- `user_id` vs `uid` consistency across host/player code; RTDB registration paths; route/role gating; `authorized_hosts` `is_active` flow; deployed Firestore rules == repo.
- Visual: editorial design renders cleanly on desktop + mobile (minor notes in §5).

## 4. Static-audit candidates (not yet E2E-proven, low/medium priority)

- DeckBrowser/DuelLobby duel **join** is a non-transactional read→write (a 3rd player could join a 1v1 in a race). Consider a `runTransaction` like DuelGame's auto-start.
- `DeckBrowser` creator cancel can remove a duel that a joiner already started.
- Creator-created duels store plain `correct` in RTDB until a joiner overwrites (network-readable).
- `QuestionImage` state isn't reset on `src` change (one broken image kills later images).
- `TournamentCountdown` `onComplete` can re-fire if the parent passes a fresh callback identity.
- `activityLogger` never tears down intervals/console hooks between games.

## 5. Known architectural note (recommendation, not rushed)

Advancement between bracket rounds and auto-launch of next-round duels still run from the **host's bracket page** (round-break countdown). With the champion rule + `on_ffa_room_finished`, a tournament now completes without the host **during** duels, but the host should keep the bracket page open between rounds (or a future CF can own advancement+launch for full host-free operation).

## 6. Visual/UX notes (low)

- Mobile player dashboard: notification badge overlaps the avatar; floating theme/fullscreen buttons sit close to the footer; section I numeral contrast on the dark card; III numeral slightly cramped.
- Landing: sign-in card padding could be tighter; hero rule length.

## 7. Security notes

- The Firebase Admin SDK service account (`functions/sa-key.json`) was printed once into terminal output during harness debugging — consider rotating the key (`firebase-adminsdk-fbsvc@mashrou3-dactoor`).
- `scratch/tests/tokens.json` (test identity tokens) is git-ignored — never commit.
- The harness creates test identities (`medroyale-test-*`) and cleans them up after each session.

## 8. How to re-run

```bash
cd "scratch/tests"
npm i                      # firebase-admin, playwright, vitest
npx playwright install chromium
node identities.cjs --tokens   # mint test identities (owner/host/p01..p12)
node suite-tournament.mjs      # full tournament E2E (≈12 min)
node suite-smoke.mjs / suite-visual.mjs
node cleanup.cjs               # removes all test artifacts
```

## 9. Machine note (Windows dev)

Firebase CLI `functions:deploy` on this machine required a small local patch of
`%APPDATA%\npm\node_modules\firebase-tools\lib\functions\python.js`
(`runWithVirtualEnv` now calls `venv/Scripts/python.exe` directly — cross-spawn's quoted `.bat` spawning is broken with Node 24 on Windows). Backup saved as `python.js.bak`. Deploy also requires a fresh `functions/venv` (Python 3.11, `pip install -r requirements.txt`) and a source path **without spaces** (e.g. `C:\opencode-tmp\fn-deploy`).
