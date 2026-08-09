# Med Royale — Mashrou3 Dactoor: THE GAME

Competitive real-time MCQ trivia platform for medical students (Al-Azhar University). Like Kahoot, but **the first correct answer wins the point** — with a full tournament system (FFA → single-elimination bracket) that runs on autopilot.

**Live:** https://med-royale.vercel.app

---

## Quick Facts

| | |
|---|---|
| Frontend | React 19 + Vite 8 + Tailwind CSS 4 + Zustand 5 + React Router 7 |
| Backend | Firebase (Auth · Firestore · Realtime DB · Storage) — project `mashrou3-dactoor` |
| Server logic | 3 Python Cloud Functions (europe-west1, python311) |
| AI question processing | Google Cloud Run (Python) — `VITE_CLOUD_RUN_URL` |
| Hosting | Vercel — project `med-royale` (auto-deploys on push to `origin/med-royale`) |
| Auth | Google OAuth only |
| Anti-cheat | SHA-256 answer hashing (`correct_hash`) + signed answers + suspicion scoring |

## Roles

- **owner** — everything; hardcoded email `sohailcollege2032008@gmail.com`
- **host** — question banks, game rooms, tournaments (listed in Firestore `authorized_hosts`)
- **player** — joins rooms/duels/tournaments

## Game Modes

1. **Host Game Room** — `rooms/{code}` in RTDB; host runs a live quiz; join-request approval, leaderboard, ranked/classic/custom scoring, unattended mode (players' browsers drive progression when the host leaves).
2. **Duel (1v1)** — `duels/{id}` + matchmaking queue `duel_queue/{deckId}`; invite-link join; 2pts first-correct / 1pt others / 1pt previously-played; surrender (draw) / forfeit (loss).
3. **Tournament** — Firestore `tournaments/{id}`; **Phase I: FFA** (all players, ranked room) → **Phase II: bracket** (top-cut 8/16/32, seeded by FFA rank, 1v1 duels per match) → champion. Duels progress **server-side via Cloud Functions**; the FFA phase is fully unattended.

## Development

```bash
npm install
npm run dev       # Vite dev server
npm run build     # production build
npm run lint      # eslint (react-hooks + react-refresh + jsx-uses-vars)
```

Branch rules:
- `med-royale` → **auto-deploys to production** on every push. Fixes go here.
- `main` → stable; never push breaking changes.

## Backend deploy

```bash
firebase deploy --only firestore:rules   # security rules
firebase deploy --only functions         # Python Cloud Functions (needs venv, see docs/ARCHITECTURE.md §Deploy)
```

> ⚠️ On this Windows machine, `functions:deploy` requires a local patch of firebase-tools and a venv — see `docs/ARCHITECTURE.md` → "Deploying Cloud Functions (Windows)".

## Documentation

- `docs/ARCHITECTURE.md` — full current system: data model, state machines, Cloud Functions, security rules, scoring
- `docs/FINAL_TEST_REPORT.md` — 2026-08 full audit: bugs found, fixes shipped, E2E evidence
- `docs/MIGRATION_GUIDE.md` — history of the Supabase → Firebase migration
- `CLAUDE.md` / `GEMINI.md` — workspace instructions for AI agents

## Testing

The E2E harness lives in `scratch/tests/` (git-ignored — contains secrets). See `docs/FINAL_TEST_REPORT.md` → "How to re-run".
