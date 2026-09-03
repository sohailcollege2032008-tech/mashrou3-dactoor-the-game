> Read docs/ARCHITECTURE.md for the complete current-system reference (data model, state machines, Cloud Functions, rules, deployment).
> Read docs/LESSONS.md BEFORE changing anything — mandatory testing/risk discipline from a production incident (host-tab-dependent bracket).

# CLAUDE.md — Mashrou3 Dactoor: THE GAME

> Local workspace instructions. Overrides global `~/.claude/CLAUDE.md` where they conflict.

---

## 🎯 Project Identity

**Name:** Mashrou3 Dactoor — THE GAME (brand name: **Med Royale**)
**Type:** Competitive MCQ trivia platform for medical students (Al-Azhar University)
**Owner/Dev:** Sohail Ahmed (`sohailcollege2032008@gmail.com`)
**Deployment:** Vercel — branch `med-royale` auto-deploys on push to `origin/med-royale`
**Active branch:** `med-royale` (development) / `main` (stable)

---

## 🛠 Tech Stack

| Layer | Tool |
|---|---|
| Framework | React 19 + Vite 8 |
| Routing | React Router v7 |
| State | Zustand v5 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Animations | Framer Motion |
| Auth | Firebase Auth (Google OAuth only) |
| Database (static) | Firestore |
| Database (live/realtime) | Firebase Realtime Database (RTDB) |
| File Storage | Firebase Storage |
| AI Processor | Google Cloud Run (Python) — `VITE_CLOUD_RUN_URL` |
| Deployment | Vercel |

---

## ⚙️ Environment Variables

All secrets in `.env` (never committed):

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_CLOUD_RUN_URL        # Python AI processor endpoint
VITE_CLOUD_RUN_SECRET     # Shared secret for Cloud Run auth
VITE_OWNER_EMAIL          # sohailcollege2032008@gmail.com
```

---

## 👥 User Roles (3 tiers)

| Role | Access | How Assigned |
|---|---|---|
| `owner` | Everything — OwnerDashboard + all host/player routes | Email matches `VITE_OWNER_EMAIL` |
| `host` | HostDashboard, HostGameRoom, all player routes | Listed in `authorized_hosts` Firestore collection |
| `player` | PlayerDashboard, PlayerGameView, DeckBrowser, Duel routes | Everyone else who signs in |

Role is computed fresh on every login in `authStore.fetchProfile()`.

---

## 🗂 File Structure

```
src/
├── App.jsx                         # Router + ErrorBoundary + FullscreenButton (global)
├── lib/
│   └── firebase.js                 # auth, db (Firestore), rtdb (RTDB), storage
├── stores/
│   └── authStore.js                # Zustand: session, profile, role
├── hooks/
│   ├── useAuth.js                  # Thin wrapper over authStore
│   └── useServerClock.js           # Firebase .info/serverTimeOffset sync
├── utils/
│   ├── duelUtils.js                # fetchPlayedQuestions, recordPlayedQuestions, applyDuelConfig
│   ├── activityLogger.js           # Structured activity logging
│   ├── crypto.js                   # Answer signing (anti-cheat)
│   ├── imageCompressor.js          # Client-side image compression before upload
│   ├── suspicionCalculator.js      # Anti-cheat suspicion scoring
│   └── rtlUtils.js                 # RTL/LTR text detection helpers
├── components/
│   ├── FullscreenButton.jsx        # Global fullscreen toggle (fixed bottom-right, z-40)
│   ├── QuestionImage.jsx           # Lazy-loaded question image with blur-to-sharp
│   ├── HostGameReport.jsx          # Post-game report for host
│   ├── ActivityLogViewer.jsx       # Host view of player activity logs
│   ├── common/
│   │   └── MathText.jsx            # MathJax rendering for math in questions
│   └── host/
│       ├── UploadQuestionsModal.jsx  # AI-powered (Cloud Run) + JSON upload
│       └── QuestionBankModal.jsx     # View/edit deck: questions, title, global toggle, force_rtl
├── pages/
│   ├── Landing.jsx
│   ├── AuthCallback.jsx
│   ├── NotAuthorized.jsx
│   ├── owner/
│   │   └── OwnerDashboard.jsx
│   ├── host/
│   │   ├── HostDashboard.jsx       # Manage question banks, start game rooms
│   │   └── HostGameRoom.jsx        # Live game control panel (host view)
│   └── player/
│       ├── PlayerDashboard.jsx
│       ├── PlayerProfile.jsx       # Own profile (edit nickname, avatar)
│       ├── PublicProfile.jsx       # Public profile view /player/profile/:uid
│       ├── JoinGame.jsx            # Enter room code to join host game
│       ├── WaitingRoom.jsx         # Pre-game lobby for host game
│       ├── PlayerGameView.jsx      # Live MCQ game (host-run mode)
│       └── DeckBrowser.jsx         # Browse global decks + start/join Duel
│   └── duel/
│       ├── DuelLobby.jsx           # Waiting room for 1v1 duel (invite link)
│       ├── DuelGame.jsx            # Live 1v1 duel game
│       └── DuelResults.jsx         # Post-duel results screen
```

---

## 🗃 Database Schemas

### Firestore

**`profiles/{uid}`**
```js
{
  id, display_name, email, avatar_url, role,
  created_at, last_login,
  // subcollections:
  // played_questions/{deckId} → { texts: string[], updated_at }
  // game_history/{duelId}    → { ... }
}
```

**`question_sets/{id}`**
```js
{
  host_id, title,
  questions: {               // nested object, not array
    title,
    questions: [ { id, question, choices[], correct, needs_image, image_url, question_ar } ]
  },
  question_count,
  source_type,               // 'ai' | 'json'
  is_global,                 // true = visible to players in DeckBrowser
  tags: string[],            // filter tags shown in DeckBrowser
  force_rtl: boolean,        // true = force RTL on question/choice text, false = dir="auto"
  created_at
}
```

**`authorized_hosts/{docId}`**
```js
{ email }
```

### Firebase RTDB

**`rooms/{code}`** — Host-run game room
```js
{
  code, host_id, question_set_id, title,
  questions: { questions: [...] },   // full question set object
  force_rtl: boolean,                // copied from question_set at game start
  status: 'lobby' | 'question' | 'revealing' | 'finished',
  current_question_index,
  question_started_at,
  reveal_data,
  config: { timer_seconds },
  created_at
}
```

**`duels/{duelId}`** — 1v1 Duel
```js
{
  creator_uid, deck_id, deck_title,
  questions: [ { ...q, played_by_uids: string[] } ],  // annotated per-question
  total_questions,
  config: { questionCount, shuffleQuestions, shuffleAnswers, excludePlayed },
  force_rtl: boolean,           // copied from deck at duel creation
  status: 'waiting' | 'playing' | 'revealing' | 'finished',
  current_question_index,
  question_started_at,          // Firebase server timestamp (ms)
  reveal_started_at,
  players: { [uid]: { uid, nickname, avatar_url, score } },
  answers: { [qi]: { [uid]: { uid, selected_choice, reaction_time_ms, is_correct, points_earned } } },
  forfeit_by: uid | null,       // uid who forfeited (loses)
  surrender_by: uid | null      // uid who surrendered (draw for both)
}
```

**`duel_queue/{deckId}/{uid}`** — Matchmaking queue
```js
{ duel_id, nickname, avatar_url, joined_at, config }
```

**`duel_presence/{duelId}/{uid}`**
```js
{ connected: boolean }
```

**`host_rooms/{hostUid}/active`**
```js
{ code, title }
```

---

## ⚔️ Duel System — Key Logic

### Scoring
- Correct answer (first time playing this question): **+2 pts**
- Correct answer (previously played question): **+1 pt** (shown in yellow)
- Wrong answer / no answer: **0 pts**
- `played_by_uids[]` is annotated per-question at duel creation

### Question Exclusion (Cross-device Union)
- When creator creates duel: annotates `played_by_uids` with creator's history
- When joiner joins: fetches BOTH players' histories → computes union → re-runs `applyDuelConfig` → updates duel questions
- Fallback: if union covers all questions (< 3 remain), uses all questions

### `applyDuelConfig(rawQuestions, config, playedTexts)`
1. Filter played (if `excludePlayed` + ≥3 remaining)
2. Shuffle if `shuffleQuestions` or subset selected
3. Slice to `questionCount`
4. Shuffle answer choices if `shuffleAnswers`

### Sync & Timing
- `serverTimeOffset` via `.info/serverTimeOffset` subscription → `serverNow = Date.now() + offset`
- Question timer: 30s (`QUESTION_DURATION_MS`)
- Reveal phase: 3s (`REVEAL_DURATION_MS`)
- Separate guards: `revealInProgressRef` and `nextInProgressRef` (prevent deadlocks)
- Early reveal: fires when both real players have answered

### Visitor Protection
- Non-players opening invite link after game starts → full-screen "انتهت صلاحية رابط الدعوة" page
- Answer scoring filters to `realPlayers = new Set(Object.keys(duel.players))`
- Disconnect: opponent has 120s (`FORFEIT_TIMEOUT_S`) before auto-forfeit

### Outcomes (DuelResults)
| Field | Outcome |
|---|---|
| `forfeit_by: myUid` | I lose |
| `forfeit_by: opponentUid` | I win |
| `surrender_by: anyUid` | Draw |
| scores compared | Normal win/lose/tie |

---

## 🎮 Host Game System

- Host creates room → RTDB `rooms/{code}` with 6-char alphanumeric code
- Players join via `/player/join` (enter code) or direct URL
- Host controls: start question, reveal answers, next question, finish
- Anti-cheat: answer signing (`crypto.js`) + suspicion scoring (`suspicionCalculator.js`)
- Auto-Accept Players toggle (host can open room to auto-join without approval)
- MathJax rendering for math content (`MathText.jsx`)
- Activity logs per player per game (`activityLogger.js`)

---

## 🌐 RTL / Direction System

| Deck Setting | Effect on question & choices |
|---|---|
| `force_rtl: true` | `dir="rtl"` — always right-to-left |
| `force_rtl: false` | `dir="auto"` — Arabic text auto-RTL, English stays LTR |

Applied in: `PlayerGameView.jsx` (all states), `DuelGame.jsx`.
Configured per-deck in `QuestionBankModal` → Global Deck Settings section.
Propagated: `question_sets.force_rtl` → `rooms.force_rtl` (host game) and `duels.force_rtl` (duel).

---

## 🖥 UI Patterns

- **Fullscreen**: Global `FullscreenButton` (`fixed bottom-5 right-5 z-40`) in `App.jsx`. Double-tap on any empty area also toggles fullscreen. Works on Android Chrome; iOS Safari does not support Fullscreen API.
- **Color palette**: `bg-background` (dark navy), `text-primary` (cyan `#00B8D9`), accents in gray-700/800/900
- **RTL layout**: All player-facing pages use `dir="rtl"` on root div. Host dashboard is LTR.
- **Bottom Sheets**: Overlays that slide up from bottom (used in DuelGame confirm, DeckBrowser)
- **Transitions**: `active:scale-95` on buttons, `hover:border-primary/40` on cards

---

## 🔀 Git Workflow

Two remotes:
```
origin          → GitHub (https://github.com/sohailcollege2032008-tech/mashrou3-dactoor-the-game.git)
source_project  → the repo this workspace was copied FROM
                  (d:\Projects\Antigravity\Web Apps\Mashrou3 Dactoor THE GAME)
```

**Push to `origin` only.**
```bash
git push origin med-royale
```

`source_project` is the *other* project's repository, not a mirror of this one —
do not push this work into it. (An earlier version of this file described a
`med-royale` remote pointing at a local Med Royale repo; there is no such remote,
and `git push med-royale …` fails with "repository does not exist".)

**Vercel auto-deploys** on every push to `origin/med-royale`.
Main branch (`main`) is stable — do NOT push breaking changes there.

---

## 🔒 Security Rules Summary

### Firestore (`firestore.rules`)
- `profiles/{uid}`: read by any auth user, write by owner only
- `profiles/{uid}/played_questions/{deckId}`: read by any auth (opponent needs it), write by owner only
- `profiles/{uid}/game_history/{entryId}`: read by any auth, write by owner only
- `question_sets/{setId}`: read by the deck's host, the owner email, or anyone when
  `is_global == true`; a **non-existent** deck is also readable (`resource == null`) so a
  deleted deck reads as missing instead of denied — see `src/utils/deckLoader.js`.
  Create by any auth user; update/delete by the deck's host or the owner email
- `authorized_hosts/{docId}`: read by any auth, write by owner email only
- `tournaments/{id}`: read any auth; create any auth; update/delete **host, owner email, or the declared winner**
- `tournaments/{id}/registrations/{uid}`: read by any auth, write by owner uid only
- `tournaments/{id}/ffa_results/{uid}`: read any auth; **write host or owner email only**
- `tournaments/{id}/bracket_matches/{matchId}`: read any auth; **create/update/delete host or owner email only** — a player cannot write a match at all (the result comes from `_finalize_match`)

> Players cannot write `ffa_results` or `bracket_matches` at all. Anything that must
> happen without the host's tab open therefore belongs in a Cloud Function
> (admin SDK bypasses rules) — see the bracket orchestration functions.

### RTDB (`database.rules.json`)
- `rooms/{code}`: read + write by any auth (answers/reveal_locks restricted per-user)
- `host_rooms/{hostId}`: read + write by owner uid only
- `duels/{duelId}`: read + write by any auth
- `duel_queue/`: read + write by any auth
- `duel_presence/{duelId}/{uid}`: read by any auth, write by owner uid only
- `tournament_registrations/{tournamentId}`: read any auth; **write only your own `{uid}` entry** (the host's bulk `remove()` on cancel is rule-denied and already treated as non-fatal)
- `tournament_duels/{tournamentId}/{duelId}`: read + write by any auth
- `tournament_presence/{tournamentId}/{uid}`: read by any auth, write by owner uid only
- `tournament_meta/{tournamentId}`: read any auth, **write denied** (dead path — nothing reads or writes it)
- `bracket_live/{tournamentId}`: read any auth, **write denied** — CF-written spectator mirror for the live bracket page (`/tournament/:id/live`); carries no question text. Also carries `meta.seats` (uid → qualifier seat) and, while the qualifier runs, `ffa` standings — both server-written, still no question text
- `bracket_live/{tournamentId}/meta/announcement`: **write by that tournament's host only** (checked against the mirrored `meta.host_id`), `text` capped at 200 chars — the host's one-line channel to everyone watching

### Deploy commands
```bash
firebase deploy --only firestore:rules   # Firestore rules
firebase deploy --only database          # RTDB rules
firebase deploy --only functions         # Python Cloud Functions
```

**Windows gotcha:** `deploy --only functions` can hang forever at
"Loading and analyzing source code" — the CLI's local Python discovery server
starts but the fetch to it never returns. Generate the manifest yourself first,
then deploy (the CLI uses `functions.yaml` and skips HTTP discovery):

```bash
cd functions && FIREBASE_CONFIG='{"projectId":"mashrou3-dactoor"}' GCLOUD_PROJECT=mashrou3-dactoor venv/Scripts/python.exe -c "from firebase_functions.private.serving import get_functions, functions_as_yaml; open('functions.yaml','w',encoding='utf-8').write(functions_as_yaml(get_functions()))"
```

Regenerate `functions.yaml` after adding or changing any function signature —
a stale manifest silently deploys the wrong trigger set.

---

## 📦 Cloud Run Processor (Python)

Endpoint: `VITE_CLOUD_RUN_URL`
Auth: `X-API-Secret: VITE_CLOUD_RUN_SECRET` header

Accepts: PDF, PPTX, DOCX, TXT, images
Returns: `{ title, questions: [...], model_used }`
Models tried in order: Gemini 3.1 → 2.5 → 2 → Gemma 4 (auto-fallback)
Used in: `UploadQuestionsModal.jsx` (AI tab)

---

## ⚠️ Known Constraints & Rules

1. **Never push breaking changes to `main`** — it's the stable branch connected to Vercel production.
0. **Security rules checklist (MANDATORY before every commit):** Any new Firestore collection/subcollection or new RTDB path needs a matching rule in `firestore.rules` or `database.rules.json`. After adding rules, run `firebase deploy --only firestore:rules` and/or `firebase deploy --only database` BEFORE pushing the code that uses the new path. A missing rule causes a silent `PERMISSION_DENIED` at runtime that is hard to debug.
2. **No mock database** — always use real Firebase (Firestore + RTDB).
3. **No hardcoded secrets** — all via `import.meta.env.VITE_*`.
4. **Question images** go to Firebase Storage under `question_images/{bankId}/q{index}_{timestamp}`.
5. **`increment()` in RTDB** can create ghost player entries — always filter answers to `realPlayers = new Set(Object.keys(duel.players))`.
6. **iOS fullscreen** is not supported — don't attempt a workaround.
7. **Duel question array** is stored flat in RTDB (not nested like Firestore `questions.questions`).
8. **Never make tournament progression depend on an open browser tab.** Bracket
   generation, match launch, duel start, result writing and round advance must
   each have a Cloud Function that performs them. A tournament stalled for an
   entire live event because those steps only ran inside the host's React
   effects, and the host's tab was on a different tournament.
9. **Tournament duel ids are the `match_id`**, not `push()` ids — that is what
   makes launching idempotent when the host tab and the Cloud Function race.
   Never reintroduce `push()` under `tournament_duels/{tid}`.
10. **RTDB transactions in Python abort by RAISING, not by returning `None`.**
    `firebase_admin.db.Reference.transaction` feeds the return value straight to
    `set_if_unchanged`, so `return None` throws
    `ValueError: Value must not be none.` and kills the invocation. Use the
    `_Abort` exception + `_try_transaction()` helper in `functions/main.py`.
    (This is the opposite of the JS SDK, where returning `undefined` aborts.)
11. **Answer keys are bound to the question's final index.** A tournament duel
    carries no `correct` at all: the plain key lives at `duel_keys/{tid}/{duelId}`
    (no client may read it) and the server scores from it. Tiebreakers are
    appended to `questions`, so they are keyed at `len(main) + i` — split them in
    one pass with the main set (`_split_answer_key` / `splitAnswerKey`).
    Regular duels (`duels/`) still use `correct_hash` and score in the browser.
12. **One live tournament at a time.** The host dashboard lists every active
    tournament and `TournamentCreate` warns before a second one is started;
    with two live, players and host can end up in different brackets.
13. **Round question assignment is mandatory.** `validateRoundAssignments` gates
    the FFA launch (manual *and* scheduled auto-launch). Don't reintroduce
    "leave it empty for random" as a supported path — the CF fallback in
    `_questions_for_round` is a legacy safety net, not a feature.
14. **`top_cut` is a cap, editable only while `status === 'registration'`.**
    That's the window where the host learns the real turnout. Once the bracket
    exists the round count is fixed — questions are already assigned per round
    and matches may have played. Lowering the cap must release the dropped
    rounds' questions back to the pool (`reshapeAssignments`).
15. **Two launchers, so the FFA launch is a claim.** `TournamentLobby` and the
    `tournament_starter` CF can both launch. Each claims the tournament doc in a
    transaction (`status === 'registration'` and no `ffa_room_id`) and the loser
    deletes the room it just created. Never go back to an unconditional
    `updateDoc` of `{status:'ffa', ffa_room_id}` — it points the tournament at
    one room while the players are already in the other.
16. **`config.auto_start_at` marks a room nobody has to start.** Only rooms
    carrying it are force-started (by the starter itself, or the reconciler if
    that invocation died). A host-launched lobby has no `auto_start_at` and is
    the host's to open, however long they hold it.
17. **A walkover has no duel.** ⚡ حسم writes a result with nothing behind it, so
    the duel-status finalizer never fires for it. `on_bracket_match_written`
    handles the already-finished case (seat the winner, progress the round) —
    without that branch a walkover waits up to a minute for the reconciler.
18. **A player's tab never writes the tournament duel node itself.** The node
    grant is host-only (plus creation by the declared `host_uid`); each field a
    player drives is granted individually, because an RTDB child rule cannot
    revoke an ancestor's grant and `players/{uid}/score` lives in that node.
    So: no `runTransaction` on `tournament_duels/{tid}/{duelId}` from a player
    tab — use a transaction on the specific child (`status` is the claim) and a
    multi-path `update()` for the rest, which is evaluated per child path.
    `is_correct`, `points_earned`, `reaction_ms_server` are `.validate: false`
    and `at` must be RTDB's server timestamp; the server measures reaction time
    from `at - question_started_at`, so never make the client the source of it.
19. **The honours board is server-computed, and must stay that way.** `_compute_awards`
    runs when the champion is crowned and reads only fields a client cannot write
    (`is_correct`, `reaction_ms_server`, the qualifier ranks, the match results).
    Don't move any of it into the browser — a medal computed from a self-reported
    number is a medal anyone can mint. New award? Add it there, and add a case to
    `functions/test_main_pure.py`.
