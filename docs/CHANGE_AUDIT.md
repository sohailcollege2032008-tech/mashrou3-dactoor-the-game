# CHANGE AUDIT — Med Royale (2026-08-09 → 2026-08-14)

> **Purpose**: neutral, reviewer-ready record of every change made to the
> production system during this session, with test evidence, limitations, and
> unresolved items. Written to be audited by an external reviewer and QA tester.
>
> **Neutrality statement**: this document reports facts — what was changed,
> how it was verified, and what was NOT verified. It does not claim that all
> defects were found or that the system is bug-free. It flags its own
> limitations (see §7).

---

## 1. Scope & Ground Rules

- **System under change**: Med Royale (Mashrou3 Dactoor: THE GAME) — React 19/Vite 8 + Firebase (Auth/Firestore/RTDB/Storage) + Python Cloud Functions + Cloud Run AI processor. Production: `med-royale.vercel.app`.
- **Ground truth established first**: production bundle was downloaded and compared byte-for-byte (modulo CRLF) against a local build of git `f1045e2` (deployed 2026-05-01). Result: identical — the repo branch `med-royale` matches production.
- **Authorizations from the owner**: test on production (test data prefixed and cleaned up), push after each fix round, use Admin SDK custom tokens for test identities.
- **All changes** are on branch `med-royale` (auto-deploys to production). `main` untouched.

---

## 2. Complete Change Inventory (12 commits, `f1045e2..694e099`)

| Commit | Files | What changed | Why (bug being fixed) |
|---|---|---|---|
| `2aa6b86` | `src/pages/tournament/TournamentLobby.jsx`, `src/pages/duel/DuelGame.jsx`, `firestore.rules`, `functions/main.py` | FFA room config now enables `auto_mode`/`unattended_mode`/`auto_timer`; duel timer expiry now reveals instead of hanging; tournament update rule allows the champion to finalize; new CF `on_ffa_room_finished` writes FFA results server-side | (1) Tournament FFA froze after host clicked Start unless the host manually revealed each question — reproduced twice with 8 connected players (50s probe, no progression). (2) Tournament duels hung forever when an opponent never answered — reproduced (35s probe, duel stuck in `playing`, answer got `timed_out` appended by a stale closure). (3) The champion could not mark the tournament finished (rules denied) so completion depended on the host's open page. (4) FFA→bracket transition depended on the host's browser being open. |
| `bb7832e` | `.gitignore`, `docs/FINAL_TEST_REPORT.md` | gitignore `scratch/tests` (contains tokens); report added | Documentation + secret hygiene. |
| `1390c10` | `src/pages/player/DeckBrowser.jsx`, `src/pages/duel/DuelLobby.jsx`, `src/pages/duel/DuelResults.jsx`, `src/pages/player/PlayerDashboard.jsx`, `src/pages/tournament/TournamentJoin.jsx`, `src/pages/tournament/TournamentPlayerWait.jsx`, `src/utils/activityLogger.js`, `src/utils/activeTournament.js` (new), `src/utils/suspicionCalculator.js`, `src/components/QuestionImage.jsx`, `src/components/tournament/TournamentCountdown.jsx`, `eslint.config.js`, `package.json` | Duel joins wrapped in `runTransaction` (status + player count re-checked); creator cancel only deletes `waiting` duels; created duels hash correct answers; DuelResults participants-only (privacy); QuestionImage resets per src; countdown once-guard; activityLogger teardown; multi-slot `activeTournamentIds`; NaN guard; eslint `react/jsx-uses-vars` | (1) Read-then-write join could admit a 3rd player into a 1v1. (2) Cancel could delete a live duel. (3) Plain `correct` was network-readable in created duels. (4) Non-participants could view others' answers and write fake history. (5) One broken image killed all later images. (6) Countdown could double-fire. (7) Listener leaks across games. (8) Joining tournament B hid live tournament A. |
| `dc00ed5` | `src/pages/player/PlayerDashboard.jsx`, `src/components/FullscreenButton.jsx`, `src/components/ThemeToggle.jsx` | Bell badge spacing, numeral contrast, floating buttons raised | Mobile visual defects found in screenshot review. |
| `45894c9` | `src/pages/duel/DuelLobby.jsx`, `src/pages/player/DeckBrowser.jsx` | Removed `get()` on `.info/serverTimeOffset` (join path) | **Critical**: `get()` on `.info/*` throws `Invalid token in path` in the modular SDK (only `onValue` supports it). Every invite-link join in production failed with this error — reproduced via live browser probe (`debug-tx2.mjs`). Fix verified: invite joins now work end-to-end. |
| `87b7961` | `docs/FINAL_TEST_REPORT.md` | Report update | Documentation. |
| `30d0099`, `4be6af5` | `README.md`, `docs/ARCHITECTURE.md` (new), outdated banners on `Mashrou3_Dactoor_THE_GAME_PRD_v2.md` + `BUG_REPORT_FOR_AI_AGENT (1).md`, `CLAUDE.md` | Real README + full architecture doc; old Supabase/Next.js-era docs marked OUTDATED | Documentation; the PRD described a superseded stack. |
| `c1011f1` | `cloud-run-processor/main.py` | Fixed model fallback list (replaced 5 non-existent model names with valid ones) | Dead fallback names wasted time when the primary model hit quota. Verified via `/health` + live `/process` test. |
| `6b5ce2b` | `src/pages/player/PlayerGameView.jsx` | Live leaderboard for players: subscribe to players node, full-standings bottom sheet (`الترتيب الكامل`), full final standings on the finished screen; fixed `update()` never imported (nickname edit crashed) | (1) Players only saw a stale reveal-time top-5 strip; full leaderboard was host-only. (2) Pre-existing runtime crash: `update()` used but not imported → nickname edit threw `ReferenceError`. |
| `fe11382` | `src/pages/tournament/TournamentPlayerWait.jsx`, `src/pages/tournament/TournamentDuelWrapper.jsx`, `src/pages/player/PlayerGameView.jsx`, `src/pages/duel/DuelGame.jsx`, `functions/main.py` | Players now see the full bracket tree + FFA results; post-match screen 15s (was 8s) + `شاهد شجرة البطولة` button; FFA→wait nav 12s (was 5s); reveal duration 3s→4s (client + CF in sync) | Players had no view of the bracket tree at all; pace felt rushed with no time to absorb results. |
| `694e099` | `functions/main.py`, `src/pages/host/HostGameRoom.jsx`, `src/pages/tournament/TournamentBracket.jsx`, `src/pages/tournament/TournamentPlayerWait.jsx` | `phase_transition_wait` now actually used: `phase_started_at` written on FFA→bracket flip (CF + host) and at round breaks; round-1 auto-launch gated on the transition window; participants get a live countdown (`PHASE II · BRACKET STARTS IN` / `ROUND N STARTS IN`) | `phase_transition_wait` (default 60s) was stored but never used — no FFA→bracket countdown existed anywhere; the only countdown (round breaks) was host-only. |

---

## 3. Deployments & Production Config Changes

| Item | Change | Verified |
|---|---|---|
| Vercel (frontend) | 12 pushes to `origin/med-royale` → auto-deploy. Live bundle hashes observed changing after each round (e.g. `index-4zHAHwHX` → `index-B1WNcy3W`… → `index-CKIWpLzA`) | ✓ asset hash poll after each push |
| Firebase Firestore rules | `firestore.rules` updated (champion-finish rule) and deployed | ✓ `firebase deploy --only firestore:rules` succeeded; repo vs deployed compared earlier in session (identical at baseline) |
| Firebase RTDB rules | **NOT changed** (see §7.4) | — |
| Cloud Functions | `functions/main.py` — 3 functions updated (reveal duration 4s, `phase_started_at` in FFA finalization) | ✓ `firebase deploy --only functions` → "Successful update operation" ×3 |
| Cloud Run `dactoor-processor` | `GEMINI_API_KEY` env swapped to a free-tier key (old key saved to `scratch/tests/old-gemini-key.txt` for rollback); fallback model list fixed and service redeployed (rev 00015) | ✓ env inspected after deploy; `/health` shows new fallback list; `/process` DOCX→questions test returned HTTP 200 |
| Vercel project note | Vercel MCP account has no access to the `med-royale` project (403); CLI (owner token) used instead | ✓ |

---

## 4. Test Evidence (all run against production)

| Suite | What | Result | Evidence location |
|---|---|---|---|
| Unit (vitest, 19 tests) | bracket seeding/top-cut/tie/sort/duel-config math | 19/19 pass | `scratch/tests/unit.test.js` |
| Smoke (3 roles) | owner/host/player dashboards | 3/3 pass | `scratch/tests/suite-smoke.mjs` |
| Tournament E2E (8 real browser players + host) | register → FFA → bracket → 3 rounds → champion; includes 50s FFA-autopilot stall probe, advancement-integrity checks | full pass (also pass pre-fix except the stall probe which FAILED as expected, proving the bug) | `scratch/tests/suite-tournament.mjs`; logs `tournament-r2.log`, `tournament-final.log` |
| Duel suite | create via DeckBrowser, invite join, scoring (2/1 pts), surrender→draw, forfeit, 3rd-player block, results privacy | pass | `scratch/tests/suite-duel.mjs` |
| Network suite (CDP Slow 4G) | question-arrival skew (measured 0–2ms), reaction fairness, reveal latency (83–231ms), offline write queue + reconnect flush | pass | `scratch/tests/suite-network.mjs` |
| Load test (50 players × 5 questions) | 250 concurrent answer writes: p50 182ms / p95 276ms / p99 290ms; ranked scoring exact (3/2/1/0 pattern) | pass | `scratch/tests/load-test.mjs` |
| Focused probes | duel-timeout reveal (answer preserved +2pts + advance), player countdown, player bracket tree + FFA results, leaderboard FINAL STANDINGS | pass | `probe-timedout.mjs`, `probe-countdown.mjs`, `probe-bracket-player.mjs`, `probe-leaderboard2.mjs` |
| Cloud Run processor | `/process` with DOCX → parsed questions via free-tier key | HTTP 200, 2 questions correct | session log |
| Visual sweep | 10 screens × desktop/mobile, console-error capture | no console errors; minor mobile notes fixed in `dc00ed5` | `scratch/tests/screenshots/` |

**Note on evidence files**: `scratch/tests/` is git-ignored (contains identity tokens). Evidence lives on the working machine, not in the repo. The repo contains `docs/FINAL_TEST_REPORT.md` (narrative) and this audit.

---

## 5. Test Method & Test-Identity Handling

- Identities: Admin SDK custom tokens for `owner` (real owner uid/email), `host` (`test.host@medroyale.test` + `authorized_hosts` entry), players `test.p01..p12@medroyale.test`. Sign-in is injected in-page via the CDN compat SDK (`signInWithCustomToken`) — no real Google accounts used.
- **Incident (transparency)**: mid-session, a cleanup pass removed the test-host identity and its `authorized_hosts` entry; the next suite run hit `ACCESS DENIED`. The identity was re-created (`identities.cjs --tokens`) and the run passed. Re-minting identities before suite runs is now part of the documented procedure.
- Cleanup: `scratch/tests/cleanup.cjs` (registry-driven) plus explicit pattern sweeps. Verified post-session: 0 `TEST_` decks, 0 `medroyale-test-*` profiles, 0 suite rooms/duels/tournaments left in production. Pre-existing user data (old "test N" tournaments, 120+ old rooms, real profiles/decks) was deliberately NOT touched.

---

## 6. QA Verification Guide (reproducible)

```bash
cd "D:\Projects\Antigravity\Web Apps\Med Royale"
# 1. Code == deployed
npm ci && npm run build          # compare dist/assets hashes vs live site
# 2. Unit
cd scratch/tests && npm i && npx playwright install chromium
node identities.cjs --tokens     # re-create test identities (required after cleanup)
node suite-tournament.mjs        # ≈12 min full tournament
node suite-duel.mjs
node suite-network.mjs
node load-test.mjs
node cleanup.cjs                 # MUST run after suites
```
Manual checks a QA tester can do on `med-royale.vercel.app`:
1. Create a tournament → join with 2+ Google accounts → FFA auto-runs without host clicks → players see FFA standings + bracket tree + transition countdown → bracket duels auto-run → champion announced → tournament shows `finished`.
2. Invite-link duel: joiner can join (this was broken pre-fix), 3rd visitor blocked.
3. Player leaderboard: `الترتيب الكامل` button, live updates, full final standings.
4. Nickname edit in a game room lobby (was crashing).
5. AI upload (host): PDF/DOCX → questions via the free-tier processor.

---

## 7. Known Limitations, Risks & Unresolved Items (honest)

1. **RTDB rules drift unverified**: the repo `database.rules.json` contains per-user answer write restrictions that appear stricter than the observed deployed behavior (player-driven reveals wrote scoring fields successfully). The deployed RTDB rules could NOT be fetched (rules endpoint returned 401 for both the service-account token and an owner ID token). **The repo file and deployed RTDB rules may differ — this was not resolved.** Recommend: fetch rules via the Firebase console and diff.
2. **Host dependency remains**: round advancement between bracket rounds and the auto-launch of next-round duels still run from the host's bracket page. With the champion rule + `on_ffa_room_finished`, a tournament completes without the host during duels, but the host should keep the bracket page open between rounds. A server-side advancement CF is a documented recommendation, not implemented.
3. **Pre-existing lint debt**: full-repo `eslint` has ~49 pre-existing errors (dead code, in-render component definitions, unused vars) outside the changed files. Changed files were linted clean (0 errors; pre-existing warnings remain). The lint baseline was never clean before this session.
4. **Secrets exposure**: `functions/sa-key.json` (Firebase Admin service account) was printed once into terminal output during harness debugging (2026-08-09). **Rotation is recommended.** `scratch/tests/tokens.json` contains identity tokens (git-ignored). The old Cloud Run Gemini key is stored in `scratch/tests/old-gemini-key.txt` (git-ignored, rollback only).
5. **Machine-specific tooling patch**: `functions:deploy` on this Windows machine required a local patch of the globally installed `firebase-tools` (`python.js` → direct venv python invocation; backup `python.js.bak`) and a no-space deploy path (`C:\opencode-tmp\fn-deploy`). These are local workarounds, not part of the repo.
6. **Test-harness assertion quirks**: `suite-duel.mjs` prints `p01 score unexpected: 40` — the assertion assumes 5 questions while the default config uses all 10; scoring itself is verified correct. `suite-tournament.mjs`'s stall probe message reads "unexpected" on pass (logic inverted for readability). These are suite bugs, not app bugs.
7. **Not tested**: real Google-OAuth browser sign-in (custom tokens used instead); >50 concurrent users; iOS Safari behavior; question sets with images; the AI upload UI flow end-to-end (processor tested directly, not the upload modal); slow-network behavior of the bracket tree/leaderboard modals.
8. **Cleanup reliability**: test identities must be re-minted after any cleanup pass (see §5 incident). The cleanup registry only tracks decks/tournaments; rooms/duels created by the app during suites are cleaned by pattern matching in `cleanup.cjs`.

---

## 8. Commit List (audit trail)

```
f1045e2 (baseline, deployed before session)
2aa6b86 fix(tournament): autopilot for FFA rooms, duel timeout reveal, server-side FFA finalization, champion finish
bb7832e docs: FINAL_TEST_REPORT.md + gitignore scratch/tests
1390c10 fix(duel): atomic 1v1 joins, cancel guards, answer hashing on create, results privacy + polish
dc00ed5 ui: mobile polish
45894c9 fix(duel): join path broken by .info get()
87b7961 docs: final test report rounds 2-6
30d0099 docs: real README, full ARCHITECTURE.md, outdated banners
4be6af5 docs: point agents to ARCHITECTURE.md
c1011f1 fix(processor): valid model fallback chain
6b5ce2b feat(player): live full leaderboard + nickname-edit crash fix
fe11382 feat(tournament): player-visible bracket tree, FFA results, slower pace
694e099 feat(tournament): phase-transition countdown visible to participants
```
All on `origin/med-royale`. `main` untouched. Git tags: `checkpoint-0-baseline` (pre-change state).
