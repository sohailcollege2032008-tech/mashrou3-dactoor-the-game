# Med Royale — Architecture (current system)

> Written 2026-08 after a full production audit. This documents the **current**
> Firebase-based system. The old `Mashrou3_Dactoor_THE_GAME_PRD_v2.md` describes
> the superseded Supabase stack — ignore it for anything except history.

---

## 1. Stack & Deployment

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4 (editorial "paper/ink" design system), Zustand 5, React Router 7, Framer Motion, MathJax 3, canvas-confetti, html2canvas, lucide-react |
| Auth | Firebase Auth — Google OAuth only (`signInWithPopup`, CDN/bundled SDK) |
| Static data | Firestore (`profiles`, `question_sets`, `authorized_hosts`, `tournaments`, `notifications`) |
| Live data | Firebase Realtime Database (`rooms`, `duels`, `duel_queue`, `duel_presence`, `tournament_duels`, `tournament_registrations`, `tournament_presence`, `host_rooms`) |
| Files | Firebase Storage (`question_images/{bankId}/q{index}_{timestamp}`) |
| Server logic | Python Cloud Functions (Gen 2, europe-west1, python311, 256MB) |
| AI extraction | Google Cloud Run (Python) — accepts PDF/PPTX/DOCX/TXT/images → `{title, questions}` |
| Hosting | Vercel project `med-royale`; production = branch `med-royale` (auto-deploy on push) |
| Firebase project | `mashrou3-dactoor` (RTDB instance `mashrou3-dactoor-default-rtdb` in europe-west1) |

Environment: all `VITE_*` in `.env.local` (never committed). `VITE_OWNER_EMAIL` gates the owner role.

---

## 2. Roles & Auth Flow

`src/stores/authStore.js` computes the role **fresh on every login**:

```
user.email === VITE_OWNER_EMAIL        → owner
authorized_hosts where email + active  → host
otherwise                              → player
```

- `fetchProfile` creates `profiles/{uid}` on first login (email/display_name from Google).
- `OwnerDashboard` CRUDs `authorized_hosts` (`{ email, is_active, created_at }`).
- Routes guarded by `ProtectedRoute` (role-aware). Players may open host pages? No — host/owner routes require host+; player routes are open to all roles (hosts can play).

---

## 3. Firestore Data Model

### `profiles/{uid}`
```js
{ id, email, display_name, avatar_url, role, created_at, last_login,
  played_decks: { [deckId]: count },        // host-room play count (repeat-entry control)
  hosted_by: { [hostUid]: hostName } }
// subcollections:
//   played_questions/{deckId} → { texts: string[], updated_at }   (duel exclusion union)
//   game_history/{entryId}    → competition | duel | tournament_ffa | tournament_match | tournament_summary
```

### `question_sets/{id}` (banks/decks)
```js
{ host_id, title, questions: { title, questions: [ { id, question, question_ar, choices[], correct, image_url?, needs_image? } ] },
  question_count, source_type: 'ai'|'json', is_global, tags[], force_rtl, created_at }
```

### `authorized_hosts/{docId}` → `{ email, is_active, created_at }`

### `notifications/{uid}/items/{notifId}` → `{ type: 'game_finished', ... }`

### `tournaments/{id}` (status machine: `registration → ffa → bracket → finished`)
```js
{ code (6-char), host_id, title, deck_id, deck_title,
  top_cut (2/4/8/16/32/64/128 — a cap, editable while status='registration'),
  is_auto_top_cut (legacy, always false), actual_top_cut, total_rounds,
  ffa_question_duration, duel_question_duration, phase_transition_wait, round_break_time (ms),
  scheduled_start_at?, ffa_room_id, current_round, winner_uid, winner_name,
  round_questions: { ffa: number[], '1': number[], ... } }
// subcollections:
//   registrations/{uid}         (written but not read — RTDB is the source of truth)
//   ffa_results/{uid}           → { uid, nickname, avatar_url, score, correct_count, total_reaction_ms, rank, advanced }
//   bracket_matches/{matchId}   → r{round}m{num}: { match_id, round, match_number,
//       player_a_uid/name, player_b_uid/name, duel_id, status: pending|active|finished,
//       winner_uid, loser_uid, player_a_score, player_b_score, tie_broken_by, finished_at, next_match_id }
```

---

## 4. RTDB Data Model

### `rooms/{code}` — host game (incl. tournament FFA)
```js
{ code, host_id, question_set_id, title, tournament_id?, force_rtl,
  questions: { title, questions: [...] },   // correct stripped → correct_hash at start
  status: 'lobby'|'playing'|'revealing'|'finished', current_question_index, question_started_at,
  reveal_data: { winner_nickname, winner_time_ms, correct_count, winners[] },
  revealed_answers/{qi}, revealed_correct_index, countdown_started_at/duration,
  config: { scoring_mode, first_correct_points, other_correct_points, points_decrement,
            timer_seconds, auto_accept, shuffle_questions, auto_mode, auto_timer, unattended_mode, repeat_entry },
  players/{uid}: { user_id, nickname, avatar_url, score, correct_count, total_reaction_ms, rank, joined_at_question_index? },
  answers/{qi}/{uid}: { user_id, player_name, selected_choice, reaction_time_ms, is_anomalous, signature, is_correct?, points_earned?, rank?, is_first_correct?, submitted_at },
  join_requests/{uid}: { status: pending|approved|rejected, player_name, player_avatar, player_email },
  presence/host, presence/players/{uid},
  reveal_locks/{qi}, next_locks/{qi},   // unattended-runner atomic claims
  leaderboard/top5, activity_log/{uid} }
```

### `duels/{duelId}` — 1v1
```js
{ creator_uid, deck_id, deck_title, questions: [ { ...q, correct_hash, played_by_uids[] } ],
  total_questions, config: { questionCount, shuffleQuestions, shuffleAnswers, excludePlayed }, force_rtl,
  status: 'waiting'|'playing'|'revealing'|'finished', current_question_index,
  question_started_at, reveal_started_at,
  players/{uid}: { uid, nickname, avatar_url, score },
  answers/{qi}/{uid}: { uid, selected_choice, reaction_time_ms, is_correct?, points_earned?, timed_out? },
  answers/{qi}/correct_reveal,          // revealed index (written after all answered)
  forfeit_by, surrender_by, tiebreaker_questions?, tiebreaker_used?, is_tiebreaker? }
```

### `duel_queue/{deckId}/{uid}` — matchmaking
`{ duel_id, nickname, avatar_url, joined_at, config }`

### `duel_presence/{duelId}/{uid}` — `{ connected: bool }` (onDisconnect)

### Tournament live paths
- `tournament_duels/{tournamentId}/{duelId}` — same shape as `duels` (scoring is CF-authoritative)
- `tournament_registrations/{tournamentId}/{uid}` — join source of truth for the FFA
- `tournament_presence/{tournamentId}/{uid}` — waiting-room presence
- `host_rooms/{hostUid}/active` — host rejoin banner (NOT written for tournament FFA rooms)

---

## 5. Host Game System

### Flow
1. Host uploads a bank (`UploadQuestionsModal` — JSON paste/upload or AI via Cloud Run).
2. `HostDashboard` → "HOST GAME" → `rooms/{code}` created (6-char code, `host_rooms/{uid}/active`).
3. Players: `/player/join` → code → `join_requests` → host approves (or `auto_accept`) → `/player/game/{code}`.
4. Host **Start Game**: shuffles (optional), **hashes correct answers** (`correct_hash = sha256("${roomId}:${created_at}:${roomId}-q${qi}:${index}")`), strips `correct`, sets `playing`.
5. Per question: host REVEAL (or auto) → `performReveal` (gameRunner) scores → `revealing` → NEXT → `playing` … → `finished`.

### Scoring (`gameRunner.performReveal`)
- `classic`: only fastest correct +1
- `custom`: first-correct N, others M
- `ranked`: max(0, N − rank·X)  (FFA uses 3−rank)
- Tie-break order: score desc → correct_count desc → total_reaction_ms asc
- `total_reaction_ms` accumulates over ALL answers (correct + wrong) so genuine ties are impossible.

### Unattended mode
`config.unattended_mode` + `auto_mode` + `auto_timer`:
- **Host page** auto-reveals at `auto_timer`, advances 8s later.
- **Player pages** (`useUnattendedGameRunner`) run the same transitions via atomic RTDB locks (`reveal_locks/{qi}`, `next_locks/{qi}`) so exactly one client acts when the host is away.
- Tournament FFA rooms are created with these flags ON (fixed 2026-08).

### Anti-cheat
- `correct` never written to RTDB — only `correct_hash`; verified at reveal.
- Answers signed (HMAC) and logged with `activityLogger`; `suspicionCalculator` produces per-player indicators; host sees a "security investigation" tab.

---

## 6. Duel System

### Creation & join
- DeckBrowser (global decks): create → `duels/{id}` (status `waiting`, answers **hashed** on create) + `duel_queue/{deckId}/{uid}` → `/duel/lobby/{id}` (invite link).
- Joiner (lobby or queue): builds questions with **played-question union** of both players (`played_by_uids` per question), then joins with a **runTransaction** (status + player count re-checked atomically — no 3-player duels) and flips to `playing`.
- Visitors after start → full-screen "انتهت صلاحية الرابط".

### Game loop
- 30s questions, 3s reveal (server-clock aligned via `.info/serverTimeOffset` onValue).
- Timer expiry → **reveal** (both regular and tournament duels; fixed 2026-08) — no infinite hangs when an opponent never answers.
- All-answered → early reveal; atomic claim via transaction on `status`.
- Scoring (client for regular duels, CF for tournament duels): first correct **2 pts**, other correct **1 pt**, previously-played (in `played_by_uids`) **1 pt**; `correct_reveal` written.
- Presence: `duel_presence`; opponent disconnect → 120s forfeit countdown.
- Surrender → `surrender_by` (draw); forfeit/exit → `forfeit_by` (loss).
- Results: `/duel/results/{id}` — **participants only** (privacy), writes `game_history` + `played_questions`.

---

## 7. Tournament System (the crown)

### State machine
```
registration ──(launch FFA)──▶ ffa ──(room finished)──▶ bracket ──(final match won)──▶ finished
```

### Phase I — FFA (registration → ffa)
1. Host creates tournament (deck, top-cut, timings, optional scheduled start) → `tournament_registrations/{id}/{uid}` written by players via `/tournament/join` (code).
2. Host "ابدأ مرحلة FFA" — or, for a scheduled tournament, **`tournament_starter` CF** with
   no tab open anywhere:
   - `actual_top_cut` = largest power of 2 ≤ min(top_cut, registrations)
   - `total_rounds = log2(actual_top_cut)`
   - Creates `rooms/{code}` with all registrants pre-seeded + **autopilot config** (auto/unattended).
   - Both paths **claim** the phase in a transaction on the tournament doc (status still
     `registration`, no `ffa_room_id`); the loser deletes the room it just created and joins
     the winner's. An unconditional write here would point the tournament at one room while
     the players were already in the other.
3. Host clicks Start Game once — or, for a server-launched room, it starts itself
   `FFA_LOBBY_GRACE_MS` (10s) after the flip, which is what `config.auto_start_at` marks.
   A host-launched lobby carries no `auto_start_at` and is never force-started, however
   long the host holds it open. The FFA then **runs itself** (players' runners).
4. Room `finished` → **`on_ffa_room_finished` CF** (or host page) writes `ffa_results/{uid}` (rank, advanced) with random tie-break at the cut → tournament → `bracket`, `current_round: 1`.

### Phase II — Bracket

**Every step below runs server-side.** The client paths still exist and usually
win the race when the host tab is open, but nothing depends on them: each step
has a Cloud Function that performs the same action idempotently, plus a
once-a-minute reconciler that repairs whatever is still stuck.

1. Tournament enters `bracket` → **`on_tournament_written` CF** generates matches from
   `ffa_results`, seeded by rank (r1 pairs are (1vN)(n/2+1 vs n/2)… — standard
   single-elimination seeding). The field is trimmed to the largest power of two that fits.
2. Match has both players → **`on_bracket_match_written` CF** waits out
   `phase_transition_wait` (round 1) or `round_break_time` (later rounds), then creates
   the duel: 5 questions from `getQuestionsForRound` + 3 tiebreakers.
   **The duel key is the `match_id`**, so a client and the CF racing to launch the same
   match can only ever produce one duel (create-if-absent transaction).
3. Players auto-navigate from `/tournament/{id}/wait` to their duel (`TournamentDuelWrapper` → `DuelGame`).
4. Duel still `waiting` after 25s → **`on_tournament_duel_status` CF** force-starts it.
   A match neither player opens no longer freezes while showing LIVE on the bracket.
5. **Question progression (CFs)**: answers → reveal → scoring → next question → finish;
   tiebreaker question appended when scores tie > 0. A tournament duel is advanced
   **server-side only** — the client opens the reveal phase (`status` + `reveal_started_at`)
   and nothing else; `triggerNextOrFinish` in `DuelGame` returns early for a tournament
   duel, because the whole-node transaction it used to run was also a write that could set
   a score. Scoring reads the key from `duel_keys` and measures reaction time from the
   server-stamped `at`.
6. Duel `finished` → **`on_tournament_duel_status` CF** writes the result onto the match,
   seeds the winner into the next match (**slot chosen by match-number parity**, not by
   which slot happens to be free) and bumps `current_round` when the round is complete.
7. Final match winner → tournament `finished` + `winner_uid/name` + **`awards`** — the
   honours list (`_compute_awards`), written in the same update as the champion so a
   viewer never sees a finished tournament with an empty honours board. Every entry is
   derived from a field only the server writes (`is_correct`, `reaction_ms_server`, the
   qualifier ranks, the match results), so a medal cannot be farmed from a browser:
   champion, runner-up, top qualifier, fastest correct answer of the whole event, most
   correct answers, and the biggest seed upset (walkovers excluded — no duel behind them).
   Rendered by `HonoursBoard` on the live page and on every player's end screen.
8. **`tournament_reconciler`** (every minute) re-runs any of the above that did not
   happen: missing bracket, overdue launch, frozen duel, unfinalized result, stalled round.

### Tie-breaking (matches)
- Scores differ → higher score wins.
- Equal > 0 → CF appends a tiebreaker question; if still tied after the reserve pool → `resolveMatchTie` (speed = sum of correct reaction ms; both zero → random).
- Equal 0 (0–0) → FFA rank decides.

### Question assignment
`round_questions: { ffa: [...], '1': [...], ... }` — deck indices per slot, assigned in `QuestionAssignmentPanel` (drag, tap, or the "من / إلى" range tool).

**Assignment is mandatory.** `validateRoundAssignments` (in `tournamentUtils.js`)
requires ≥ 1 question for `ffa` and ≥ `QUESTIONS_PER_MATCH` (5) for every round
implied by `top_cut`; `TournamentLobby` blocks the FFA launch — manual button and
scheduled auto-launch alike — until it passes. The CF's random-unused fallback in
`_questions_for_round` survives only as a safety net for legacy tournaments.

A bracket round plays **all** the questions in its slot, so assigning 12 to round
1 makes every round-1 match 12 questions long (the panel labels this `N سؤال / ماتش`).

**Bracket cap.** `top_cut` is a cap, not a promise: `actual_top_cut` shrinks to the
largest power of 2 ≤ registrations, but never grows past it. The host can change it
from the lobby for as long as `status === 'registration'` — the moment the real
turnout is known. Lowering it deletes the trailing rounds from `round_questions`
(the panel's `reshapeAssignments`), returning those questions to the side pool.
Once the bracket exists the cap is locked (`editableTopCut={false}` in `TournamentBracket`).

### What the players and spectators actually see
- **The qualifier cut line.** `PlayerGameView` reads `actual_top_cut` once per game and
  shows every player where the last qualifying seat is: in / on the bubble / out, the gap
  in points either way, and a dashed cut line drawn across the full leaderboard. The
  qualifier is the tensest part of an event and it used to be played blind — a live rank
  tells you where you are, not whether you are through.
- **The pre-match story.** The 5s VS countdown before a knockout match carries each
  player's seed, how they got here ("فاز على … 6–2", "تأهل بالغياب", "تأهل من التصفيات في
  المركز 3") and what the winner walks away with. Computed in `TournamentDuelWrapper`
  (two qualifier docs + the previous round) and passed to `DuelGame` as `vsIntro`; regular
  duels pass nothing and are unchanged.
- **The honours board.** See step 7 above.
- **The live bracket** at `/tournament/:id/live` — one RTDB subscription, no question text,
  open to any signed-in viewer including eliminated players.
- **The bracket, on a phone.** `BracketBoard` (`src/components/tournament/`) is the
  on-screen bracket everywhere now — the live page, the player's wait screen, and the
  host's bracket page on a narrow viewport. A column tree is the right shape on a laptop
  and it keeps it there; on a phone it was a sideways scroller with the final off the
  edge of the screen, so narrow viewports get **ROUND** (one round at a time, full-width
  rows, from a rail that shows each round's progress and where the live matches are) and
  **PATH** (one player's route, one row per round — the only view whose size does not
  grow with the bracket: 32 players is still five rows). Tap any name to follow them.
  It normalises both match shapes, so the spectator mirror (`a_uid/a_name/a_score`) and
  Firestore (`player_a_uid/…`) render through the same component, and takes a `tone`
  because the wait screen shows it inside a dark panel.
  `BracketTree` stays as the host's image-export source: on a narrow host viewport it is
  parked inside a zero-height clipping wrapper — rendered, so html2canvas still has
  something to draw, but out of the page's scroll (absolute positioning alone still
  stretched the document to the tree's ~2000px height).
- **The round report.** The break between rounds was a countdown and nothing else.
  `_round_recap` runs when a round closes and is written in the same update that opens
  the next one — so it can never be a round behind — carrying that round's biggest upset,
  its fastest correct answer, who went out, and how many matches it held. Same discipline
  as the honours board: every field comes from something only the server writes. It is
  mirrored into `bracket_live/{tid}/meta/round_recaps` and rendered by `RoundRecap` on the
  live page (only while nothing is being played, so the live heroes take the screen back
  the moment a match starts) and on the player's wait screen under the round countdown.
- **The opponent's lamp, from inside the match.** The spectators could see who had locked
  an answer in; the two people actually playing could not. `DuelGame`'s opponent pill now
  carries the same lamp while the question is open, and on the reveal it says who got
  there first (`reaction_ms_server` when the server measured it, the client's own number
  in a regular duel). It says *whether* they answered, never what they picked.
- **The answer lamps.** With no question on screen, a spectator had nothing to watch
  between one score change and the next. Each competitor now carries a lamp while the
  question is open — filled when their answer is in, pulsing while they are still
  thinking — and the question counter moves with the players instead of a question
  behind them (nothing used to mirror the advance itself). The lamps are dropped during
  the reveal: the numbers are moving then, and repeating what everyone can see is noise.

### Player histories
- `game_history` entries: `tournament_ffa` (after FFA), `tournament_match` (per match), `tournament_summary` (eliminated players + finalists + champion: `final_result` ∈ champion|finalist|semi_finalist|eliminated_bracket|eliminated_ffa).

---

## 8. Cloud Functions (functions/main.py)

All Gen 2, europe-west1, python311. Firestore access via `firebase_admin.firestore` (admin — bypasses rules).

| Function | Trigger | Purpose |
|---|---|---|
| `on_tournament_answer_written` | `tournament_duels/{tid}/{duelId}/answers/{qi}/{uid}` | When ALL real players answered: atomic claim (`playing → revealing` + `reveal_started_at`), score server-side (first correct 2 / other 1, reaction-time clamped to [50ms, 65s]), write `correct_reveal`. |
| `on_tournament_reveal_started` | `tournament_duels/{tid}/{duelId}/reveal_started_at` (null→value) | Sleeps remaining reveal time, then atomically advances to next question — or finishes with optional **tiebreaker extension** (equal non-zero scores append a reserve question). |
| `on_ffa_room_finished` | `rooms/{code}/status` (→ `finished`, with `tournament_id`) | Writes `ffa_results` + flips tournament to `bracket` server-side (skips if the host client already wrote them to avoid conflicting tie shuffles). |
| `on_tournament_written` | `tournaments/{tid}` | Status → `bracket` and no matches yet ⇒ generate `bracket_matches` from `ffa_results`, and sync `actual_top_cut` / `total_rounds` / `current_round` / `phase_started_at`. |
| `on_bracket_match_written` | `tournaments/{tid}/bracket_matches/{matchId}` | Mirrors the match for spectators. Pending match with both players ⇒ sleep out the phase wait (+3s so the host tab wins when open), then create the duel at `tournament_duels/{tid}/{match_id}` and flip the match to `active`. Already finished with a winner ⇒ seat the winner in the next match and progress the round — that is the **walkover** path (⚡ حسم against an absent player writes a result with no duel behind it, so the duel-status finalizer never fires). |
| `on_tournament_duel_status` | `tournament_duels/{tid}/{duelId}/status` | `waiting` ⇒ force-start after 25s. `finished` ⇒ resolve the winner (forfeit → score → FFA rank at 0–0 → speed), write the match result, advance the winner and progress the round or crown the champion. |
| `tournament_starter` | schedule `* * * * *` | Launches scheduled tournaments with no tab open. Picks up anything due inside the next 65s, **waits out the remainder in-function** so the start lands on the scheduled second (measured: ~1.2s late), then creates the room, claims the phase, and starts the room after the lobby grace. Refuses to launch with fewer than 2 registrations or any round without assigned questions. |
| `tournament_reconciler` | schedule `* * * * *` | Safety net over every bracket-phase tournament: regenerate missing brackets, launch overdue matches, restart frozen duels, finalize finished ones, reopen matches whose duel vanished, move rounds along. Also flips a stuck `ffa` to `bracket` when results exist, and starts a server-launched FFA room whose starter died before it could. |

---

## 9. Security Rules (summary)

### Firestore (`firestore.rules`)
- `profiles/{uid}`: read any auth; write owner only. Subcollections likewise (+ `played_questions` readable by any auth for duel unions).
- `question_sets`: read only when `is_global == true`, or by the deck's host, or the owner
  email — **plus `resource == null`**, so a deck that has been deleted reads as *missing*
  rather than *forbidden*. Without that clause the rule cannot evaluate `is_global` on a
  document that is not there, and a host who deleted a deck a tournament still pointed at
  got `PERMISSION_DENIED` in the console and nothing on screen. Existence was never the
  secret; the questions are, and they are still gated. (A query never reaches that clause:
  `resource` is the document being returned, so it is never null for a listed doc.)
  `src/utils/deckLoader.js` turns every outcome — missing, denied, empty, offline — into
  one sentence, and the host's lobby and bracket pages render it as a banner and refuse to
  launch with the short form of the same fact
  (a deck carries every plain `correct`); create any auth; update/delete creator or owner email.
- `authorized_hosts`: read any auth; write owner email only.
- `notifications/{uid}/items`: read owner only; write any auth (needed for unattended mode).
- `tournaments/{id}`: read any auth; create any auth; update/delete host or owner email **or champion** (`request.resource.data.winner_uid == request.auth.uid`).
- `tournaments/{id}/registrations`: write self only.
- `tournaments/{id}/ffa_results`: read any auth; write host or owner.
- `tournaments/{id}/bracket_matches`: **host or owner only**, create / update / delete alike.
  The two participants used to be allowed to update their own match — that is how the
  winner's tab recorded the result, and it also meant either player could write
  `{status:'finished', winner_uid:self}` mid-match. Results are server-side now
  (`_finalize_match`), and `TournamentDuelWrapper` waits for that verdict.
- `tournaments/{id}`: update/delete host or owner only. There is **no** "the declared winner
  may finish the tournament" clause — it was a self-crowning vector and was removed.

### RTDB (`database.rules.json`)
- `rooms/{code}`: read/write any auth (per-user answer write-once, host-only scoring fields).
- `duels`, `duel_queue`: read/write any auth.
- `tournament_registrations/{tid}`: read any auth; write only your own `{uid}` entry.
- `tournament_meta`: read any auth, write denied (unused path).
- `bracket_live/{tid}`: read any auth, **client writes denied**. Written only by the
  Cloud Functions (`_mirror_meta` / `_mirror_match` / `_mirror_live` in `functions/main.py`)
  and read by the public live-bracket page `/tournament/:id/live`. It mirrors names,
  status, scores and the current question NUMBER — never question text — which is what
  makes it safe to show an in-progress match to eliminated players, and what makes a
  live bracket affordable: one RTDB subscription instead of one Firestore read per
  match per viewer per refresh (63 reads for a 32-player bracket). `meta.awards` carries
  the honours list once the tournament is finished. `matches/{id}/live.locked` is the
  answer-lock map for the open question — `{uid: true}`, written by the answer trigger
  as each answer lands and cleared on the advance. It says who has answered, never what
  they picked or whether it was right; a spectator with a second device learns nothing
  from it.
- `tournament_duels/{tid}/{duelId}`: read by a player of the duel, the host, or anyone when
  the node does not exist yet. **Write at the node itself is the host only** (plus creation
  by whoever declares themselves `host_uid`) — a participant grant there reached
  `players/{me}/score`, `questions`, `total_questions` and `host_uid`, and an RTDB child
  rule cannot revoke what an ancestor granted. A player's tab is granted the fields it
  actually drives, one at a time:
  `status`, `reveal_started_at`, `current_question_index`, `forfeit_by`, `surrender_by`,
  and `answers/{qi}/{own uid}`. `question_started_at` too, but only while it is still
  absent or the duel is not yet `playing` — that is the `waiting → playing` claim, and only
  the tab that wins the `status` transaction writes it; rewriting a running question's clock
  would restart the timer for both players and skew every measured reaction time.
  `forfeit_by` accepts self, the other player of the duel, or the host; `surrender_by` is
  self-only. Under an answer, `is_correct`, `points_earned` and `reaction_ms_server` are
  `.validate: false` (admin writes bypass validate), and `at` is accepted only as
  RTDB's own server timestamp — that is what makes reaction time server-measured rather
  than self-reported.
  > Two rule facts this shape depends on: a child `.write` **grants** where the parent does
  > not, and a multi-path `update()` is evaluated **per child path** — which is why the
  > reveal claim (`{status, reveal_started_at}`) and the forfeit (`{status, forfeit_by}`)
  > still work as single atomic writes.
- `duel_presence`, `tournament_presence`: write self only.
- `host_rooms/{hostId}`: owner only.
- `duel_keys/{tid}/{duelId}`: **read denied to every client**, write host only. The plain
  answer key of a tournament duel lives here and is read by the Admin SDK when scoring.
- The `correct` field is **not** written to RTDB for a tournament duel (`_split_answer_key`
  separates it out; the client's `splitAnswerKey` does the same). There is no rule blocking
  it — an earlier version of this document claimed there was. Anything that writes questions
  to RTDB must strip it itself. Regular duels (`duels/`) still carry `correct_hash`.

Rules are deployed from the repo (`firebase deploy --only firestore:rules`, `--only database`). Any new path needs a rule before the code lands (a missing rule fails silently as `PERMISSION_DENIED`).

---

## 10. Deploying

### Frontend (Vercel)
- Vercel project `med-royale` (dashboard: `vercel.com/sohailcollege2032008-9032s-projects/med-royale`), production branch `med-royale`.
- Push to `origin/med-royale` → auto-deploy → production alias `med-royale.vercel.app`.
- `vercel.json` rewrites everything to `/index.html` (SPA).

### Firebase
```bash
firebase deploy --only firestore:rules
firebase deploy --only database
firebase deploy --only functions
```

### Deploying Cloud Functions (Windows dev machine)
Two local quirks (documented in `docs/FINAL_TEST_REPORT.md` §9):
1. `functions/venv` must exist with Python **3.11** + deps (`python -m venv venv; venv\Scripts\pip install -r requirements.txt`).
2. firebase-tools' quoted `.bat` spawn is broken with Node 24 → `%APPDATA%\npm\node_modules\firebase-tools\lib\functions\python.js` is patched locally to call `venv/Scripts/python.exe` directly (backup: `python.js.bak`).
3. The source path must have **no spaces** — deploy from a scratch dir (e.g. `C:\opencode-tmp\fn-deploy`) with a minimal `firebase.json`.

---

## 11. Testing Harness

`scratch/tests/` (git-ignored — contains `tokens.json` secrets):
- `identities.cjs --tokens` — creates test accounts (owner/host/p01..p12) + tokens
- `suite-tournament.mjs` — full 8-player tournament E2E (≈12 min)
- `suite-duel.mjs` — duel join/play/surrender/forfeit/privacy
- `suite-network.mjs` — Slow 4G + offline/reconnect duel (CDP)
- `load-test.mjs` — 50-player room load test
- `cleanup.cjs` — removes all test artifacts (registry-driven)
- Unit tests: `npx vitest run` (19 tests for seeding/top-cut/tie/sort/duel-config)

All tests run against production with clearly-prefixed test data; cleanup is mandatory after each run.
