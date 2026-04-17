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
origin      → GitHub (https://github.com/sohailcollege2032008-tech/mashrou3-dactoor-the-game.git)
med-royale  → Local Med Royale repo (D:\Projects\Antigravity\Web Apps\Med Royale)
```

**Always push to BOTH after committing:**
```bash
git push origin med-royale
# local med-royale push (only when needed):
git push med-royale med-royale:main
```

**Vercel auto-deploys** on every push to `origin/med-royale`.
Main branch (`main`) is stable — do NOT push breaking changes there.

---

## 🔒 Security Rules Summary

- `profiles/{uid}`: read by any auth user, write by owner only
- `profiles/{uid}/played_questions/{deckId}`: read by any auth (opponent needs it), write by owner only
- `profiles/{uid}/game_history/{entryId}`: read by any auth, write by owner only
- `question_sets/{setId}`: read + write by any auth user
- `authorized_hosts/{docId}`: read by any auth, write by owner email only

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
2. **No mock database** — always use real Firebase (Firestore + RTDB).
3. **No hardcoded secrets** — all via `import.meta.env.VITE_*`.
4. **Question images** go to Firebase Storage under `question_images/{bankId}/q{index}_{timestamp}`.
5. **`increment()` in RTDB** can create ghost player entries — always filter answers to `realPlayers = new Set(Object.keys(duel.players))`.
6. **iOS fullscreen** is not supported — don't attempt a workaround.
7. **Duel question array** is stored flat in RTDB (not nested like Firestore `questions.questions`).
