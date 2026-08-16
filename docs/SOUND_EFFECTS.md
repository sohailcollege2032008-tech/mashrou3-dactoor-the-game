# Sound Effects (SFX) — Map, Sources & QA

Every sound the app can make, when it fires, and how to test it.

## Files

All files live in `public/sounds/` — each moment has **MP3** (primary, Safari-safe)
and **OGG** (fallback) so the browser picks the one it supports.

| File (MP3/OGG)            | Plays when                                   | Source pack        |
|---------------------------|----------------------------------------------|--------------------|
| `join-success`            | You join a tournament (registration done)    | Kenney Digital    |
| `phase-transition`        | FFA ends → bracket opens (round-1 window)    | Kenney Digital    |
| `countdown-tick`          | Phase countdown's last 5 seconds (1/sec)     | Kenney UI         |
| `answer-correct`          | Correct answer revealed (FFA & duels)        | Kenney Digital    |
| `answer-wrong`            | Wrong / no answer revealed (FFA & duels)     | Kenney Digital    |
| `ui-click`                | Any button press                             | Kenney UI         |
| `match-win`               | You win a duel (results screen)              | Kenney Digital    |
| `match-lose`              | You lose a duel (results screen)             | Kenney Digital    |
| `champion`                | You are declared tournament champion         | Kenney Digital    |
| `eliminated`              | You are knocked out of the tournament        | Kenney Digital    |

Pre-existing legacy files (not wired to moments, kept for the owner sound page):
`applause.mp3`, `boo.mp3`, `gasp.mp3`, `tada.mp3`, `victory.mp3`, `wrong.mp3`.

## License

All new files are from **Kenney.nl** — [UI Audio](https://kenney.nl/assets/ui-audio)
and [Digital Audio](https://kenney.nl/assets/digital-audio) packs, **CC0 (public
domain)** — free to use in any project, no attribution required.

## How the code plays them

`src/utils/soundManager.js`:

1. Tries the **file** (`/sounds/{name}.mp3` or `.ogg`).
2. If the file is missing/unplayable → falls back to the **synthesized**
   Web-Audio beep (the original implementation) — the app never goes silent.
3. Both layers respect the sound store (`soundEnabled`, `sfxVolume`) and the
   global mute toggle (`SoundToggle`).

The `SoundPreviewModal` (masthead bell icon) and the owner page `/sound-test`
let you preview moments without entering a match.

## Moment triggers (code reference)

| Moment                     | Trigger location                                             |
|----------------------------|--------------------------------------------------------------|
| `join-success`             | `TournamentJoin.jsx` — after `addActiveTournamentId()`       |
| `phase-transition`         | `TournamentPlayerWait.jsx` (once per `phase_started_at`) + `PlayerGameView.jsx` (FFA finished) + `TournamentBracket.jsx` |
| `countdown-tick`           | `TournamentPlayerWait.jsx` (last 5s of phase wait) + `DuelGame.jsx` |
| `answer-correct` / `-wrong`| `PlayerGameView.jsx` (FFA reveal) + `DuelGame.jsx` (duel reveal) |
| `ui-click`                 | `SoundToggle.jsx` + duel answer buttons                       |
| `match-win` / `match-lose` | `TournamentDuelWrapper.jsx` (result) + `DuelResults.jsx`      |
| `champion`                 | `TournamentDuelWrapper.jsx` (final win) + `TournamentPlayerWait.jsx` (tournament finished + you are winner) |
| `eliminated`               | `TournamentPlayerWait.jsx` (finished + eliminated / FFA eliminated) |

## How to test (QA checklist)

1. **Owner page** — log in as owner → `/sound-test`: each moment's file should
   play from `/sounds/`. Wrong-volume files = bad conversion, flag them.
2. **Mute + volume** — bell toggle mutes everything (incl. tick); the volume
   slider in `SoundPreviewModal` scales volume.
3. **Live flow (2 accounts)** — run the real tournament flow:
   - Player A joins → hear `join-success`.
   - FFA question reveals → correct answer = `answer-correct`, wrong = `answer-wrong`.
   - FFA ends → players land on wait screen → `phase-transition` once, then
     `countdown-tick` at the last 5 seconds.
   - Duel starts → auto-navigate plays `match-win`/`match-lose` on the result screen.
   - Tournament finishes → winner hears `champion`, eliminated players `eliminated`.
4. **No double-fire** — phase-transition must fire exactly once per phase
   (guarded by `phase_started_at`); correct/wrong once per reveal.
5. **Fallback** — temporarily rename one MP3 in `public/sounds/` and rebuild:
   the moment should still make the synthesized beep, not silence.
